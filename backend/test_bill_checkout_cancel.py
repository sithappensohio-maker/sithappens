"""Backing out of a bill's card page frees the bill at once (audit #36;
owner option A, 2026-09-28).

Before: the portal said "Payment canceled — nothing was charged." and never
told the app, so the bill stayed held ("an online payment is already under
way") until Stripe's page timed out 30 minutes later — no way to try again.

Now: coming back through the cancel link tells the app, which closes the
Stripe page and lets the bill go. A payment that actually went through is
recorded, never cancelled; if Stripe can't be reached the page times out as
before.

Self-contained fixtures (never import another test module). Stripe is
always faked.
"""
import uuid

import pytest
from fastapi import HTTPException

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

OWNER = {"id": "owner-billcancel", "role": "admin", "name": "Owner", "email": "owner@billcancel.test"}
TAG = "TEST_BILL_CHECKOUT_CANCEL"


class _Obj(dict):
    def __getattr__(self, item):
        try:
            return self[item]
        except KeyError as e:
            raise AttributeError(item) from e

    def to_dict(self):
        return dict(self)


class _FakeStripe:
    """`expire` / `retrieve`: the session Stripe reports, or an exception."""

    def __init__(self, expire=None, retrieve=None):
        outer = self
        self.created, self.expired, self.retrieved = [], [], []

        def _answer(sid, what):
            if isinstance(what, Exception):
                raise what
            return _Obj({"id": sid, "payment_intent": "pi_billcancel", **(what or {})})

        class PaymentIntent:
            @staticmethod
            def retrieve(pi_id, expand=None):
                return _Obj({"id": pi_id, "status": "succeeded", "payment_method": None,
                             "latest_charge": {"amount_refunded": 0, "disputed": False}})

        class Session:
            @staticmethod
            def retrieve(sid):
                outer.retrieved.append(sid)
                return _answer(sid, retrieve)

            @staticmethod
            def expire(sid):
                outer.expired.append(sid)
                return _answer(sid, expire)

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

        self.PaymentIntent, self.checkout, self.Customer = PaymentIntent, checkout, Customer


@pytest.fixture(autouse=True)
def _online(monkeypatch):
    monkeypatch.setattr(server, "STRIPE_ONLINE_ENABLED", True)

    async def _open(_date):
        return None
    monkeypatch.setattr(server, "_require_register_day_open", _open)


def _cancel(attempt_id, user):
    for r in server.app.routes:
        if getattr(r, "path", "").endswith("/portal/stripe-payment-attempts/{attempt_id}/cancel") and "POST" in r.methods:
            return run(r.endpoint(attempt_id, user=user))
    raise AssertionError("the portal has no way to say the customer backed out")


def _client():
    cid = f"{TAG}-c-{uuid.uuid4().hex[:8]}"
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} Client", "email": f"{cid}@example.com",
                                      "account_balance": 0.0, "credits": 0}))
    return cid, {"id": f"u-{cid}", "role": "client", "client_id": cid}


def _bill(cid, total=60.0):
    """A checked-out visit left unpaid (off the tab) and its bill."""
    bid = f"{TAG}-b-{uuid.uuid4().hex[:8]}"
    ts = server.now_iso()
    run(server.db.bookings.insert_one({
        "id": bid, "client_id": cid, "dog_id": f"{TAG}-dog", "dog_name": "Pep", "client_name": "x",
        "service_type": "daycare", "date": server.business_today().isoformat(), "status": "completed",
        "checked_out_at": ts, "financial_locked": True, "financial_locked_at": ts,
        "actual_price": total, "amount_paid": 0.0, "balance_due": total, "payment_method": "cash",
        "payment_status": "unpaid"}))
    return run(server._create_invoice_for_bookings([bid], user=OWNER, ts=ts))


def _start(inv, user):
    return run(server.create_stripe_checkout_session(
        inv["id"], server.StripeCheckoutSessionIn(idempotency_key=uuid.uuid4().hex), user=user))


def _inv(iid):
    return run(server.db.invoices.find_one({"id": iid}, {"_id": 0}))


def _att(aid):
    return run(server.db.stripe_payment_attempts.find_one({"id": aid}, {"_id": 0}))


def test_backing_out_frees_the_bill_to_pay_again_at_once(monkeypatch):
    fake = _FakeStripe(expire={"status": "expired", "payment_status": "unpaid"})
    monkeypatch.setattr(server, "stripe", fake)
    cid, user = _client()
    inv = _bill(cid)
    aid = _start(inv, user)["attempt_id"]
    with pytest.raises(HTTPException) as busy:
        _start(inv, user)   # the page is open: a second try is refused
    assert busy.value.status_code == 409
    out = _cancel(aid, user)
    assert out == {"status": "expired", "paid": False}
    assert fake.expired == [_att(aid)["stripe_checkout_session_id"]], "Stripe's page is closed"
    assert not _inv(inv["id"]).get("stripe_active_attempt_id"), "the bill is let go"
    again = _start(inv, user)
    assert again["url"] and again["attempt_id"] != aid, "the customer can pay again straight away"


def test_a_payment_that_went_through_is_recorded_not_cancelled(monkeypatch):
    fake = _FakeStripe(expire=RuntimeError("session is not open"),
                       retrieve={"status": "complete", "payment_status": "paid", "amount_total": 6000})
    monkeypatch.setattr(server, "stripe", fake)
    cid, user = _client()
    inv = _bill(cid)
    aid = _start(inv, user)["attempt_id"]
    assert _cancel(aid, user) == {"status": "applied", "paid": True}
    bill = _inv(inv["id"])
    assert bill["balance"] == 0.0 and bill["amount_paid"] == 60.0 and not bill.get("stripe_active_attempt_id")
    # recorded ahead of Stripe's own notice: it still carries Stripe's reference, so it can be refunded
    pay = run(server.db.payments.find_one({"invoice_id": inv["id"], "processor": "stripe"}, {"_id": 0}))
    assert pay["processor_payment_id"] == "pi_billcancel"
    assert pay["source"]["stripe_payment_intent_id"] == "pi_billcancel"
    run(server._handle_checkout_session_paid_event(
        {"id": _att(aid)["stripe_checkout_session_id"], "payment_status": "paid", "payment_intent": "pi_billcancel"}))
    assert _inv(inv["id"])["amount_paid"] == 60.0, "Stripe's notice arriving afterwards records nothing twice"
    assert run(server.db.payments.count_documents({"invoice_id": inv["id"], "processor": "stripe"})) == 1


def test_paid_but_not_recorded_yet_never_says_nothing_was_charged(monkeypatch):
    fake = _FakeStripe(expire=RuntimeError("session is not open"),
                       retrieve={"status": "complete", "payment_status": "paid", "amount_total": 6000})
    monkeypatch.setattr(server, "stripe", fake)
    cid, user = _client()
    inv = _bill(cid)
    aid = _start(inv, user)["attempt_id"]

    async def db_hiccup(_attempt):
        raise RuntimeError("database unavailable")
    monkeypatch.setattr(server, "_verify_and_reconcile_stripe_session", db_hiccup)
    assert _cancel(aid, user) == {"status": "pending", "paid": True}
    assert _inv(inv["id"])["stripe_active_attempt_id"] == aid, "still held for the money Stripe took"


@pytest.mark.parametrize("retrieve", [RuntimeError("Stripe is unreachable"), {"status": "open", "payment_status": "unpaid"},
                                      {"status": "complete", "payment_status": "unpaid"}])
def test_a_page_the_app_cannot_close_stays_held(monkeypatch, retrieve):
    fake = _FakeStripe(expire=RuntimeError("could not reach Stripe"), retrieve=retrieve)
    monkeypatch.setattr(server, "stripe", fake)
    cid, user = _client()
    inv = _bill(cid)
    aid = _start(inv, user)["attempt_id"]
    assert _cancel(aid, user) == {"status": "pending", "paid": False}
    assert _inv(inv["id"])["stripe_active_attempt_id"] == aid, "never let go while it could still be paid"


def test_only_the_customer_who_started_it_can_back_it_out(monkeypatch):
    fake = _FakeStripe(expire={"status": "expired", "payment_status": "unpaid"})
    monkeypatch.setattr(server, "stripe", fake)
    cid, user = _client()
    inv = _bill(cid)
    aid = _start(inv, user)["attempt_id"]
    _other_cid, other = _client()
    for who, code in ((other, 404), (OWNER, 403)):
        with pytest.raises(HTTPException) as e:
            _cancel(aid, who)
        assert e.value.status_code == code
    assert not fake.expired and _att(aid)["status"] == "pending" and _inv(inv["id"])["stripe_active_attempt_id"] == aid


def test_backing_out_twice_or_after_it_finished_is_harmless(monkeypatch):
    fake = _FakeStripe(expire={"status": "expired", "payment_status": "unpaid"})
    monkeypatch.setattr(server, "stripe", fake)
    cid, user = _client()
    inv = _bill(cid)
    aid = _start(inv, user)["attempt_id"]
    assert _cancel(aid, user)["status"] == "expired"
    newer = _start(inv, user)["attempt_id"]          # paid again: a new page holds the bill
    assert _cancel(aid, user)["status"] == "expired"
    assert len(fake.expired) == 1, "Stripe is not asked again"
    assert _inv(inv["id"])["stripe_active_attempt_id"] == newer, "the newer payment keeps its hold"
