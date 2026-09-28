"""Bills paid online take cards only, and a bill payment that lands after the
app gave up on it is recorded — or flagged — never ignored (audit #62, the
bill half; owner option A, 2026-09-28).

Before: a bank payment offered on the bill's card page cleared days later;
the portal's check expired it after 30 minutes while it was clearing, and
when the money landed the app ignored it — the customer charged, the bill
still open (and payable a second time).

Now: the bill's card page is cards only (Apple/Google Pay are cards); a
payment Stripe reports as completed is never treated as abandoned; money for
a payment already given up on holds the bill again and is recorded, or waits
in Front Desk → Online payments ("Paid online, not recorded yet") for Retry
or Refund when the bill changed meanwhile.

Self-contained fixtures (never import another test module). Stripe is
always faked.
"""
import uuid

import pytest
from fastapi import HTTPException

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run
from domains.billing import resolve

OWNER = {"id": "owner-billcard", "role": "admin", "name": "Owner", "email": "owner@billcard.test"}
TAG = "TEST_BILL_CARD_ONLY"


@pytest.fixture(autouse=True)
def _open_register(monkeypatch):
    async def _open(_date):
        return None
    monkeypatch.setattr(server, "_require_register_day_open", _open)


class _Obj(dict):
    def __getattr__(self, item):
        try:
            return self[item]
        except KeyError as e:
            raise AttributeError(item) from e

    def to_dict(self):
        return dict(self)


class _FakeStripe:
    def __init__(self, session=None, refunded=0):
        outer = self
        self.created, self.refunds = [], []

        class PaymentIntent:
            @staticmethod
            def retrieve(pi_id, expand=None):
                return _Obj({"id": pi_id, "status": "succeeded", "latest_charge": {"amount_refunded": refunded, "disputed": False}})

        class Session:
            @staticmethod
            def retrieve(sid):
                return _Obj({"id": sid, "payment_intent": "pi_billcard", **(session or {})})

            @staticmethod
            def create(**kw):
                outer.created.append(kw)
                return _Obj({"id": "cs_fake_" + uuid.uuid4().hex[:8], "url": "https://checkout.stripe.com/test/fake"})

        class checkout:  # noqa: N801
            pass
        checkout.Session = Session

        class Customer:
            @staticmethod
            def create(**kw):
                return _Obj({"id": "cus_fake_" + uuid.uuid4().hex[:6]})

        class Refund:
            @staticmethod
            def create(**kw):
                outer.refunds.append(kw)
                return {"id": "re_billcard", "status": "succeeded"}

        self.PaymentIntent, self.checkout, self.Customer, self.Refund = PaymentIntent, checkout, Customer, Refund


def _client():
    cid = f"{TAG}-c-{uuid.uuid4().hex[:8]}"
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} Client", "email": f"{cid}@example.com",
                                      "account_balance": 0.0, "credits": 0}))
    return cid


def _bill(cid, total=60.0):
    """A checked-out visit left unpaid (off the tab) and its bill."""
    bid = f"{TAG}-b-{uuid.uuid4().hex[:8]}"
    ts = server.now_iso()
    booking = {"id": bid, "client_id": cid, "dog_id": f"{TAG}-dog", "dog_name": "Pep", "client_name": "x",
               "service_type": "daycare", "date": server.business_today().isoformat(), "status": "completed",
               "checked_out_at": ts, "financial_locked": True, "financial_locked_at": ts,
               "actual_price": total, "amount_paid": 0.0, "balance_due": total, "payment_method": "cash",
               "payment_status": "unpaid"}
    run(server.db.bookings.insert_one(dict(booking)))
    return run(server._create_invoice_for_bookings([bid], user=OWNER, ts=ts))


def _attempt(cid, inv, amount, status, *, held=False):
    aid = f"{TAG}-att-{uuid.uuid4().hex[:8]}"
    sid = f"cs_{TAG}_{uuid.uuid4().hex[:8]}"
    ts = server.now_iso()
    run(server.db.stripe_payment_attempts.insert_one({
        "id": aid, "idempotency_key": uuid.uuid4().hex, "request_fingerprint": "x", "invoice_id": inv["id"],
        "client_id": cid, "amount_cents": int(round(amount * 100)), "status": status,
        "stripe_checkout_session_id": sid, "stripe_payment_intent_id": None,
        "stripe_customer_id": None, "card_brand": None, "card_last4": None, "applied_payment_id": None,
        "created_at": ts, "updated_at": ts, "expires_at": "2000-01-01T00:00:00+00:00"}))
    if held:
        run(server.db.invoices.update_one({"id": inv["id"]}, {"$set": {
            "stripe_active_attempt_id": aid, "stripe_reserved_amount_cents": int(round(amount * 100))}}))
    return aid, sid


def _inv(iid):
    return run(server.db.invoices.find_one({"id": iid}, {"_id": 0}))


def _att(aid):
    return run(server.db.stripe_payment_attempts.find_one({"id": aid}, {"_id": 0}))


def _paid(sid, amount):
    return {"id": sid, "payment_status": "paid", "payment_intent": "pi_billcard", "amount_total": int(round(amount * 100))}


def test_the_bill_card_page_offers_cards_only(monkeypatch):
    fake = _FakeStripe()
    monkeypatch.setattr(server, "stripe", fake)
    monkeypatch.setattr(server, "STRIPE_ONLINE_ENABLED", True)
    cid = _client()
    inv = _bill(cid)
    run(server.create_stripe_checkout_session(inv["id"], server.StripeCheckoutSessionIn(idempotency_key=uuid.uuid4().hex),
                                              user={"id": "u", "role": "client", "client_id": cid}))
    assert fake.created and fake.created[-1].get("payment_method_types") == ["card"]


def test_a_completed_payment_still_clearing_is_never_given_up_on(monkeypatch):
    monkeypatch.setattr(server, "stripe", _FakeStripe(session={"status": "complete", "payment_status": "unpaid"}))
    cid = _client()
    inv = _bill(cid)
    aid, _sid = _attempt(cid, inv, 60.0, "pending", held=True)
    run(server._verify_and_reconcile_stripe_session(_att(aid)))
    assert _att(aid)["status"] == "pending"
    assert _inv(inv["id"])["stripe_active_attempt_id"] == aid, "the bill stays held for it"


def test_an_expired_page_is_still_let_go(monkeypatch):
    monkeypatch.setattr(server, "stripe", _FakeStripe(session={"status": "expired", "payment_status": "unpaid"}))
    cid = _client()
    inv = _bill(cid)
    aid, _sid = _attempt(cid, inv, 60.0, "pending", held=True)
    run(server._verify_and_reconcile_stripe_session(_att(aid)))
    assert _att(aid)["status"] == "expired" and not _inv(inv["id"]).get("stripe_active_attempt_id")


def test_money_that_lands_after_the_app_gave_up_is_recorded_on_the_bill(monkeypatch):
    monkeypatch.setattr(server, "stripe", _FakeStripe())
    cid = _client()
    inv = _bill(cid)
    aid, sid = _attempt(cid, inv, 60.0, "expired")
    run(server._handle_checkout_session_paid_event(_paid(sid, 60.0)))
    assert _att(aid)["status"] == "applied"
    bill = _inv(inv["id"])
    assert bill["balance"] == 0.0 and bill["amount_paid"] == 60.0 and not bill.get("stripe_active_attempt_id")
    assert all(p["id"] != aid for p in run(resolve.stuck_payments()))


def test_late_money_for_a_bill_paid_another_way_waits_for_a_refund(monkeypatch):
    fake = _FakeStripe()
    monkeypatch.setattr(server, "stripe", fake)
    cid = _client()
    inv = _bill(cid)
    aid, sid = _attempt(cid, inv, 60.0, "expired")
    run(server.create_invoice_payment(inv["id"], server.InvoicePaymentIn(
        amount=60.0, method="check", idempotency_key=uuid.uuid4().hex), user=OWNER))   # paid at the desk meanwhile
    run(server._handle_checkout_session_paid_event(_paid(sid, 60.0)))
    assert _att(aid)["status"] == "reconciliation_required" and _att(aid)["paid_after_close"] == "expired"
    row = next(p for p in run(resolve.stuck_payments()) if p["id"] == aid)
    assert row["can_refund"] is True and row["can_retry"] is False
    assert _inv(inv["id"])["amount_paid"] == 60.0, "never recorded twice"
    run(resolve.refund_payment(aid, OWNER))
    assert fake.refunds and _att(aid)["status"] == "refunded"


def test_late_money_waits_while_the_bill_is_busy_then_retry_records_it(monkeypatch):
    monkeypatch.setattr(server, "stripe", _FakeStripe())
    cid = _client()
    inv = _bill(cid)
    aid, sid = _attempt(cid, inv, 60.0, "expired")
    other, _ = _attempt(cid, inv, 60.0, "pending", held=True)   # a second online try holds the bill
    run(server._handle_checkout_session_paid_event(_paid(sid, 60.0)))
    assert _att(aid)["status"] == "reconciliation_required"
    # the second try goes nowhere and lets the bill go
    run(server.db.stripe_payment_attempts.update_one({"id": other}, {"$set": {"status": "expired"}}))
    run(server._release_stripe_reservation_if_owned(inv["id"], other))
    run(resolve.retry_payment(aid))
    assert _att(aid)["status"] == "applied" and _inv(inv["id"])["balance"] == 0.0


def test_late_money_never_lands_on_a_bill_whose_visit_was_reopened(monkeypatch):
    fake = _FakeStripe()
    monkeypatch.setattr(server, "stripe", fake)
    cid = _client()
    inv = _bill(cid)
    aid, sid = _attempt(cid, inv, 60.0, "expired")
    bid = inv["booking_ids"][0]
    run(server.reopen_booking_checkout(bid, server.BookingReopenCheckoutIn(reason="wrong price"), user=OWNER))
    run(server._handle_checkout_session_paid_event(_paid(sid, 60.0)))
    assert _att(aid)["status"] == "reconciliation_required"
    bill = _inv(inv["id"])
    assert not bill.get("amount_paid") and not bill.get("stripe_active_attempt_id"), "not recorded, not held"
    row = next(p for p in run(resolve.stuck_payments()) if p["id"] == aid)
    assert row["reason_code"] == "reopened" and row["can_retry"] is False and row["can_refund"] is True
    err = None
    try:
        run(resolve.retry_payment(aid))
    except HTTPException as e:
        err = e
    assert err is not None and err.status_code == 409 and not _inv(inv["id"]).get("amount_paid")


def test_retry_never_records_a_late_payment_a_refund_just_took_back(monkeypatch):
    monkeypatch.setattr(server, "stripe", _FakeStripe())
    cid = _client()
    inv = _bill(cid)
    aid, sid = _attempt(cid, inv, 60.0, "expired")
    other, _ = _attempt(cid, inv, 60.0, "pending", held=True)
    run(server._handle_checkout_session_paid_event(_paid(sid, 60.0)))     # waits: the bill is busy
    run(server.db.stripe_payment_attempts.update_one({"id": other}, {"$set": {"status": "expired"}}))
    run(server._release_stripe_reservation_if_owned(inv["id"], other))
    real_hold = resolve._hold_bill_for

    async def hold_then_refund_lands(a):
        ok = await real_hold(a)
        # a second staff member's Refund finishes at this very moment
        await server.db.stripe_payment_attempts.update_one({"id": aid}, {"$set": {"status": "refunded"}})
        return ok
    monkeypatch.setattr(resolve, "_hold_bill_for", hold_then_refund_lands)
    err = None
    try:
        run(resolve.retry_payment(aid))
    except HTTPException as e:
        err = e
    assert err is not None and err.status_code == 409
    bill = _inv(inv["id"])
    assert not bill.get("amount_paid") and not bill.get("stripe_active_attempt_id")
    assert _att(aid)["status"] == "refunded"
