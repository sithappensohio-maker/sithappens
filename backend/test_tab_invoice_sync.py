"""Audit #7: a corrected tab left a bill nobody could pay, and online
payments for it got stuck (domains/billing/tab_sync.py, resolve.py).

States are built with the app's own checkout helpers
(_apply_booking_partial_payment, _create_invoice_for_bookings,
_apply_sale_partial_payment) so the ledger rows are exactly what checkout
writes. Stripe is replaced by a stand-in that answers "did this payment
stand, was it refunded".
"""
import asyncio
import uuid

import pytest
from fastapi import HTTPException

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run
from domains.billing import resolve, tab_sync

OWNER = {"id": "owner-audit7", "role": "admin", "name": "Owner", "email": "owner@audit7.test"}
TAG = "TEST_AUDIT7"


@pytest.fixture(autouse=True)
def _open_register(monkeypatch):
    async def _open(_date):
        return None
    monkeypatch.setattr(server, "_require_register_day_open", _open)


def _client():
    cid = f"{TAG}-c-{uuid.uuid4().hex[:8]}"
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} Client", "account_balance": 0.0, "credits": 0}))
    return cid


def _visit(cid, *, total, paid, tab):
    """A checked-out visit and its bill. tab=True: left on the account tab at
    checkout (the ledger charge + payment rows checkout writes)."""
    bid = f"{TAG}-b-{uuid.uuid4().hex[:8]}"
    ts = server.now_iso()
    due = round(total - paid, 2)
    booking = {"id": bid, "client_id": cid, "dog_id": f"{TAG}-dog", "dog_name": "Pep", "client_name": "x",
               "service_type": "daycare", "date": server.business_today().isoformat(), "status": "completed",
               "checked_out_at": ts, "financial_locked": True, "financial_locked_at": ts,
               "actual_price": total, "amount_paid": paid, "balance_due": due, "payment_method": "cash",
               "payment_status": ("paid_partial" if tab and due > 0 else "paid" if due <= 0 else "unpaid")}
    run(server.db.bookings.insert_one(dict(booking)))
    if tab:
        run(server._apply_booking_partial_payment(booking=booking, total_owed=total, paid_now=paid, method="cash", ts=ts))
    inv = run(server._create_invoice_for_bookings([bid], user=OWNER, ts=ts))
    return bid, inv


def _inv(iid):
    return run(server.db.invoices.find_one({"id": iid}, {"_id": 0}))


def _tab(cid):
    return round(float(run(server.db.clients.find_one({"id": cid}))["account_balance"] or 0), 2)


def _correct(bid, kind, amount, key=None):
    body = server.BookingFinancialAdjustmentIn(kind=kind, amount=amount, reason="audit seven test", idempotency_key=key)
    return run(server.booking_financial_adjustment(bid, body, user=OWNER))


def _pay(iid, amount):
    body = server.InvoicePaymentIn(amount=amount, method="check", idempotency_key=uuid.uuid4().hex)
    return run(server.create_invoice_payment(iid, body, user=OWNER))


def _status(iid):
    return run(tab_sync.invoice_ar_status(_inv(iid)))


def _refused(fn, *a, **kw):
    with pytest.raises(HTTPException) as exc:
        fn(*a, **kw)
    return exc.value


# ───────────────────────── correcting a visit ─────────────────────────

def test_a_discount_on_a_tab_bill_moves_the_bill_with_the_tab_and_it_can_be_paid():
    cid = _client()
    bid, inv = _visit(cid, total=100.0, paid=40.0, tab=True)
    assert _tab(cid) == 60.0 and _inv(inv["id"])["balance"] == 60.0
    _correct(bid, "discount", 20.0)
    bill = _inv(inv["id"])
    assert bill["balance"] == 40.0 and bill["total"] == 80.0
    assert _tab(cid) == 40.0
    assert _status(inv["id"])["reconciled"], "the bill must still line up with the tab"
    _pay(inv["id"], 40.0)
    assert _inv(inv["id"])["status"] == "PAID" and _tab(cid) == 0.0


def test_an_added_charge_on_an_open_tab_bill_is_collectable():
    cid = _client()
    bid, inv = _visit(cid, total=100.0, paid=0.0, tab=True)
    _correct(bid, "charge", 15.0)
    assert _inv(inv["id"])["balance"] == 115.0 and _tab(cid) == 115.0
    assert run(server.db.bookings.find_one({"id": bid}))["payment_status"] == "paid_partial"
    _pay(inv["id"], 115.0)
    assert _tab(cid) == 0.0


def test_reductions_use_the_bills_live_balance_not_the_visits_stale_one():
    cid = _client()
    bid, inv = _visit(cid, total=100.0, paid=40.0, tab=True)
    _pay(inv["id"], 60.0)  # paid on the bill; the visit still says 60 due
    assert run(server.db.bookings.find_one({"id": bid}))["balance_due"] == 60.0
    err = _refused(_correct, bid, "writeoff", 60.0)
    assert err.status_code == 409 and "Refund" in err.detail
    assert _tab(cid) == 0.0 and _inv(inv["id"])["balance"] == 0.0


def test_an_off_tab_bill_changes_the_bill_and_never_the_tab():
    cid = _client()
    bid, inv = _visit(cid, total=100.0, paid=0.0, tab=False)
    assert not _status(inv["id"])["ar_backed"]
    _correct(bid, "charge", 15.0)
    _correct(bid, "discount", 30.0)
    assert _inv(inv["id"])["balance"] == 85.0 and _inv(inv["id"])["total"] == 85.0
    assert _tab(cid) == 0.0, "this visit's debt was never on the tab"
    assert run(server.db.payment_ledger.count_documents({"booking_id": bid})) == 0
    _pay(inv["id"], 85.0)
    assert _inv(inv["id"])["status"] == "PAID"


def test_a_charge_on_a_paid_bill_goes_on_the_tab_and_a_reduction_is_a_refund():
    cid = _client()
    bid, inv = _visit(cid, total=100.0, paid=100.0, tab=False)
    _correct(bid, "charge", 15.0)
    assert _tab(cid) == 15.0 and _inv(inv["id"])["balance"] == 0.0
    row = run(server.db.payment_ledger.find_one({"booking_id": bid}))
    assert row["source"] == "correction" and not tab_sync.is_checkout_charge(row)
    assert run(server.db.bookings.find_one({"id": bid}))["payment_status"] == "paid_partial"
    assert _refused(_correct, bid, "discount", 5.0).status_code == 409


def test_refunds_and_online_payments_in_progress_block_corrections():
    cid = _client()
    bid, inv = _visit(cid, total=100.0, paid=40.0, tab=True)
    run(server.db.invoices.update_one({"id": inv["id"]}, {"$set": {"stripe_active_attempt_id": "att-x"}}))
    assert "online" in _refused(_correct, bid, "discount", 10.0).detail
    run(server.db.invoices.update_one({"id": inv["id"]}, {"$set": {"stripe_active_attempt_id": None, "refunded_total": 5.0}}))
    assert "refund" in _refused(_correct, bid, "charge", 10.0).detail
    assert _tab(cid) == 60.0 and _inv(inv["id"])["balance"] == 60.0


def test_the_same_correction_sent_twice_applies_once():
    cid = _client()
    bid, inv = _visit(cid, total=100.0, paid=0.0, tab=True)
    key = uuid.uuid4().hex
    _correct(bid, "discount", 10.0, key=key)
    _correct(bid, "discount", 10.0, key=key)
    assert _inv(inv["id"])["balance"] == 90.0 and _tab(cid) == 90.0
    assert run(server.db.payment_ledger.count_documents({"booking_id": bid, "source": "correction"})) == 1


def test_old_correction_rows_do_not_make_an_off_tab_bill_look_on_the_tab():
    cid = _client()
    bid, inv = _visit(cid, total=100.0, paid=0.0, tab=False)
    run(server._write_ledger_row(client_id=cid, type_="charge", amount=15.0, booking_id=bid,
                                 notes="Post-checkout charge adjustment · from before the fix"))
    assert not _status(inv["id"])["ar_backed"]
    _pay(inv["id"], 100.0)
    assert _inv(inv["id"])["status"] == "PAID"


# ───────────────────── account entries that used to poison bills ─────────────────────

def test_a_pack_sale_on_partial_pay_no_longer_blocks_an_earlier_bill():
    cid = _client()
    _bid, inv = _visit(cid, total=100.0, paid=40.0, tab=True)
    run(server._apply_sale_partial_payment(client_id=cid, total=80.0, paid=30.0, sale_kind="credit_pack",
                                           sale_id=uuid.uuid4().hex, label="10-pack", method="cash"))
    assert _status(inv["id"])["reconciled"]
    _pay(inv["id"], 60.0)
    assert _inv(inv["id"])["status"] == "PAID"


def test_an_overpaid_sales_extra_could_have_been_for_the_bill_so_it_is_flagged():
    cid = _client()
    _bid, inv = _visit(cid, total=100.0, paid=40.0, tab=True)
    run(server._apply_sale_partial_payment(client_id=cid, total=20.0, paid=50.0, sale_kind="retail",
                                           sale_id=uuid.uuid4().hex, label="Leash", method="cash"))
    st = _status(inv["id"])
    assert not st["reconciled"] and [r["amount"] for r in st["unexplained"]] == [-30.0]


def test_older_untagged_sale_rows_are_recognised():
    cid = _client()
    _bid, inv = _visit(cid, total=100.0, paid=40.0, tab=True)
    ts = server.now_iso()
    run(server._write_ledger_row(client_id=cid, type_="charge", amount=50.0, notes="Retail · bag", ts=ts))
    run(server._write_ledger_row(client_id=cid, type_="payment", amount=-20.0, method="cash",
                                 notes="Paid at sale · Retail · bag", ts=ts))
    assert _status(inv["id"])["reconciled"]


def test_an_accounts_receivable_write_off_names_its_bill():
    cid = _client()
    _bid, inv = _visit(cid, total=100.0, paid=40.0, tab=True)
    general = server.TabAdjustmentIn(amount=-25.0, notes="goodwill")
    err = _refused(lambda: run(server.apply_tab_adjustment(cid, general, user=OWNER)))
    assert err.status_code == 409 and inv["id"][:8].upper() in err.detail
    body = server.TabAdjustmentIn(amount=-25.0, notes="goodwill", invoice_id=inv["id"], idempotency_key=uuid.uuid4().hex)
    out = run(server.apply_tab_adjustment(cid, body, user=OWNER))
    assert out["balance"] == 35.0 and _inv(inv["id"])["balance"] == 35.0
    assert out["row"]["invoice_id"] == inv["id"] and _status(inv["id"])["reconciled"]
    # Debt that isn't on a bill can still come off the general balance.
    run(server.apply_tab_adjustment(cid, server.TabAdjustmentIn(amount=50.0, notes="old debt"), user=OWNER))
    run(server.apply_tab_adjustment(cid, server.TabAdjustmentIn(amount=-50.0, notes="forgiven"), user=OWNER))
    assert _tab(cid) == 35.0 and _status(inv["id"])["reconciled"]


# ───────────────────────── online payments ─────────────────────────

def test_the_portal_only_offers_payment_the_app_can_record():
    cid = _client()
    _bid, inv = _visit(cid, total=100.0, paid=40.0, tab=True)
    assert run(resolve.portal_flags(_inv(inv["id"]), True))["can_pay_online"] is True
    run(server._write_ledger_row(client_id=cid, type_="payment", amount=-5.0, method="cash", notes="old tab payment"))
    flags = run(resolve.portal_flags(_inv(inv["id"]), True))
    assert flags["can_pay_online"] is False and "contact us" in flags["pay_note"]
    ok, code, _msg = run(tab_sync.payable_now(_inv(inv["id"]), 60.0, ignore_reservation=True))
    assert not ok and code == "needs_review"


class _Obj(dict):
    def to_dict(self):
        return dict(self)


class _FakeStripe:
    def __init__(self, refunded=0, status="succeeded"):
        outer = self
        self.refunds = []

        class PaymentIntent:
            @staticmethod
            def retrieve(pi_id, expand=None):
                return _Obj({"id": pi_id, "status": status, "latest_charge": {"amount_refunded": refunded, "disputed": False}})

        class Session:
            @staticmethod
            def retrieve(sid):
                return _Obj({"id": sid, "payment_intent": "pi_audit7"})

        class checkout:  # noqa: N801
            pass
        checkout.Session = Session

        class Refund:
            @staticmethod
            def create(**kw):
                outer.refunds.append(kw)
                return {"id": "re_audit7"}

        self.PaymentIntent, self.checkout, self.Refund = PaymentIntent, checkout, Refund


def _stuck(cid, inv, amount):
    aid = f"{TAG}-att-{uuid.uuid4().hex[:8]}"
    ts = server.now_iso()
    run(server.db.stripe_payment_attempts.insert_one({
        "id": aid, "idempotency_key": uuid.uuid4().hex, "request_fingerprint": "x", "invoice_id": inv["id"],
        "client_id": cid, "amount_cents": int(round(amount * 100)), "status": "reconciliation_required",
        "stripe_checkout_session_id": "cs_audit7", "stripe_payment_intent_id": "pi_audit7",
        "stripe_customer_id": None, "card_brand": None, "card_last4": None, "applied_payment_id": None,
        "created_at": ts, "updated_at": ts, "expires_at": None}))
    run(server.db.invoices.update_one({"id": inv["id"]}, {"$set": {
        "stripe_active_attempt_id": aid, "stripe_reserved_amount_cents": int(round(amount * 100))}}))
    return aid


def test_a_stuck_online_payment_is_listed_and_retried_once_stripe_confirms_it(monkeypatch):
    monkeypatch.setattr(server, "stripe", _FakeStripe())
    cid = _client()
    _bid, inv = _visit(cid, total=100.0, paid=40.0, tab=True)
    aid = _stuck(cid, inv, 60.0)
    listed = next(p for p in run(resolve.stuck_payments()) if p["id"] == aid)
    assert listed["can_retry"] and listed["reason_code"] == "ready"
    count_before = run(server.admin_pending_actions_count(user=OWNER))["online_payments_stuck"]
    assert count_before >= 1
    run(resolve.retry_payment(aid))
    assert run(server.db.stripe_payment_attempts.find_one({"id": aid}))["status"] == "applied"
    bill = _inv(inv["id"])
    assert bill["balance"] == 0.0 and not bill.get("stripe_active_attempt_id")
    assert _tab(cid) == 0.0


def test_a_retry_is_refused_when_stripe_shows_a_refund(monkeypatch):
    monkeypatch.setattr(server, "stripe", _FakeStripe(refunded=6000))
    cid = _client()
    _bid, inv = _visit(cid, total=100.0, paid=40.0, tab=True)
    aid = _stuck(cid, inv, 60.0)
    assert "refunded" in _refused(lambda: run(resolve.retry_payment(aid))).detail
    assert _inv(inv["id"])["balance"] == 60.0


def test_refunding_a_stuck_payment_frees_the_bill_for_good(monkeypatch):
    fake = _FakeStripe()
    monkeypatch.setattr(server, "stripe", fake)
    cid = _client()
    bid, inv = _visit(cid, total=100.0, paid=40.0, tab=True)
    _correct(bid, "discount", 30.0)  # the bill is now 30 — the 60 paid online no longer fits
    run(server.db.invoices.update_one({"id": inv["id"]}, {"$set": {"stripe_active_attempt_id": None}}))
    aid = _stuck(cid, inv, 60.0)
    assert next(p for p in run(resolve.stuck_payments()) if p["id"] == aid)["reason_code"] == "too_big"
    run(resolve.refund_payment(aid, OWNER))
    assert fake.refunds and fake.refunds[0]["payment_intent"] == "pi_audit7"
    assert run(server.db.stripe_payment_attempts.find_one({"id": aid}))["status"] == "refunded"
    assert not _inv(inv["id"]).get("stripe_active_attempt_id")
    # Stripe re-sending "paid" for it must not record it now.
    run(server._handle_checkout_session_paid_event({"id": "cs_audit7", "payment_status": "paid", "payment_intent": "pi_audit7"}))
    assert _inv(inv["id"])["balance"] == 30.0


# ───────────────────────── repairing a bill ─────────────────────────

def test_a_bill_out_of_step_can_be_matched_linked_and_reviewed():
    cid = _client()
    bid, inv = _visit(cid, total=100.0, paid=40.0, tab=True)
    # From before the fix: a discount that moved the tab but not the bill.
    run(server._write_ledger_row(client_id=cid, type_="adjustment", amount=-10.0, booking_id=bid,
                                 notes="Post-checkout discount · old"))
    run(server._adjust_client_balance(cid, -10.0))
    pv = run(resolve.bill_preview(inv["id"]))
    assert pv["can_match"] and pv["match_to"] == 50.0
    run(resolve.fix_bill(inv["id"], resolve.BillFixIn(action="match", expected_balance=60.0), OWNER))
    assert _inv(inv["id"])["balance"] == 50.0 and _status(inv["id"])["reconciled"]

    # An older tab payment that was really for this bill.
    pay = run(server._write_ledger_row(client_id=cid, type_="payment", amount=-20.0, method="cash", notes="Tab payment"))
    run(server._adjust_client_balance(cid, -20.0))
    assert not _status(inv["id"])["reconciled"]
    run(resolve.fix_bill(inv["id"], resolve.BillFixIn(action="attribute", row_id=pay["id"]), OWNER))
    bill = _inv(inv["id"])
    assert bill["balance"] == 30.0 and bill["amount_paid"] == 60.0 and _status(inv["id"])["reconciled"]
    assert run(server.db.payment_ledger.find_one({"id": pay["id"]}))["invoice_id"] == inv["id"]

    # One that wasn't: mark it reviewed; anything newer is still caught.
    other = run(server._write_ledger_row(client_id=cid, type_="adjustment", amount=-5.0, notes="other debt"))
    pv = run(resolve.bill_preview(inv["id"]))
    run(resolve.fix_bill(inv["id"], resolve.BillFixIn(action="review", through=pv["review_through"]), OWNER))
    assert _status(inv["id"])["reconciled"]
    assert other["id"] in [r["id"] for r in pv["unexplained"]]
    run(server._write_ledger_row(client_id=cid, type_="payment", amount=-1.0, method="cash", notes="later"))
    assert not _status(inv["id"])["reconciled"]


def test_a_visit_whose_bill_took_money_cannot_be_reopened():
    cid = _client()
    bid, inv = _visit(cid, total=100.0, paid=0.0, tab=False)
    _pay(inv["id"], 30.0)
    body = server.BookingReopenCheckoutIn(reason="checked out the wrong dog")
    assert _refused(lambda: run(server.reopen_booking_checkout(bid, body, user=OWNER))).status_code == 409


# ───────────────────────── review round ─────────────────────────

def test_writing_off_the_rest_of_a_bill_paid_on_the_bill_never_books_the_visit_as_cash():
    cid = _client()
    bid, inv = _visit(cid, total=100.0, paid=0.0, tab=True)
    _pay(inv["id"], 60.0)
    _correct(bid, "writeoff", 40.0)
    b = run(server.db.bookings.find_one({"id": bid}, {"_id": 0}))
    assert b["payment_status"] != "paid"
    assert server._cash_revenue(b) == 0.0, "the $60 was collected on the bill, not at the visit"


def test_an_open_group_bill_is_refused_and_a_paid_one_takes_charges_on_the_tab():
    cid = _client()
    ts = server.now_iso()
    ids = []
    for _ in range(2):
        bid = f"{TAG}-g-{uuid.uuid4().hex[:8]}"
        run(server.db.bookings.insert_one({"id": bid, "client_id": cid, "dog_name": "Pep", "service_type": "daycare",
                                           "date": server.business_today().isoformat(), "status": "completed",
                                           "checked_out_at": ts, "financial_locked": True, "actual_price": 50.0,
                                           "amount_paid": 0.0, "balance_due": 50.0, "payment_status": "unpaid"}))
        ids.append(bid)
    inv = run(server._create_invoice_for_bookings(ids, user=OWNER, ts=ts))
    assert "billed together" in _refused(_correct, ids[0], "charge", 10.0).detail
    run(server.db.invoices.update_one({"id": inv["id"]}, {"$set": {"balance": 0.0, "amount_paid": 100.0, "status": "PAID"}}))
    _correct(ids[0], "charge", 10.0)
    b = run(server.db.bookings.find_one({"id": ids[0]}))
    assert b["balance_due"] == 10.0 and _tab(cid) == 10.0


def test_an_unpaid_visit_with_no_bill_keeps_its_debt_off_the_tab():
    cid = _client()
    bid = f"{TAG}-nb-{uuid.uuid4().hex[:8]}"
    run(server.db.bookings.insert_one({"id": bid, "client_id": cid, "dog_name": "Pep", "service_type": "daycare",
                                       "date": server.business_today().isoformat(), "status": "completed",
                                       "checked_out_at": server.now_iso(), "financial_locked": True, "actual_price": 100.0,
                                       "amount_paid": 0.0, "balance_due": 100.0, "payment_status": "unpaid"}))
    _correct(bid, "charge", 10.0)
    b = run(server.db.bookings.find_one({"id": bid}))
    assert b["payment_status"] == "unpaid" and b["balance_due"] == 110.0 and _tab(cid) == 0.0


def test_a_charge_on_a_credits_visit_is_not_counted_as_cash_collected():
    cid = _client()
    bid = f"{TAG}-cr-{uuid.uuid4().hex[:8]}"
    ts = server.now_iso()
    run(server.db.bookings.insert_one({"id": bid, "client_id": cid, "dog_name": "Pep", "service_type": "daycare",
                                       "date": server.business_today().isoformat(), "status": "completed",
                                       "checked_out_at": ts, "paid_at": ts, "financial_locked": True, "actual_price": 50.0,
                                       "credit_value": 50.0, "credits_deducted": 1, "amount_paid": 0.0, "balance_due": 0.0,
                                       "payment_method": "credits", "payment_status": "paid"}))
    run(server._create_invoice_for_bookings([bid], user=OWNER, ts=ts))
    before = server._cash_revenue(run(server.db.bookings.find_one({"id": bid}, {"_id": 0})))
    _correct(bid, "charge", 15.0)
    b = run(server.db.bookings.find_one({"id": bid}, {"_id": 0}))
    assert server._cash_revenue(b) == before and _tab(cid) == 15.0


def test_a_named_write_off_needs_a_bill_in_step_and_a_resend_must_match():
    cid = _client()
    _bid, inv = _visit(cid, total=100.0, paid=40.0, tab=True)
    run(server._write_ledger_row(client_id=cid, type_="payment", amount=-5.0, method="cash", notes="old tab payment"))
    body = server.TabAdjustmentIn(amount=-10.0, notes="goodwill", invoice_id=inv["id"])
    assert "needs fixing" in _refused(lambda: run(server.apply_tab_adjustment(cid, body, user=OWNER))).detail

    cid2 = _client()
    bid2, _inv2 = _visit(cid2, total=100.0, paid=0.0, tab=True)
    key = uuid.uuid4().hex
    _correct(bid2, "discount", 10.0, key=key)
    assert _refused(_correct, bid2, "discount", 15.0, key).status_code == 409


def test_credit_on_file_no_longer_hides_pay_online_and_can_be_applied_to_the_bill():
    cid = _client()
    _a, _ia = _visit(cid, total=50.0, paid=100.0, tab=True)   # overpaid: $50 credit on file
    _b, inv = _visit(cid, total=100.0, paid=0.0, tab=True)
    assert _tab(cid) == 50.0 and _inv(inv["id"])["balance"] == 100.0
    assert run(resolve.portal_flags(_inv(inv["id"]), True))["can_pay_online"] is True
    listed = run(resolve.annotate_bills([_inv(inv["id"])]))[0]
    assert listed["needs_attention"] is True
    pv = run(resolve.bill_preview(inv["id"]))
    assert pv["credit_on_file"] == 50.0 and pv["can_apply_credit"]
    run(resolve.fix_bill(inv["id"], resolve.BillFixIn(action="apply_credit"), OWNER))
    bill = _inv(inv["id"])
    assert bill["balance"] == 50.0 and bill["amount_paid"] == 50.0
    assert _tab(cid) == 50.0 and _status(inv["id"])["reconciled"]
    _pay(inv["id"], 50.0)
    assert _inv(inv["id"])["status"] == "PAID" and _tab(cid) == 0.0


def test_action_required_lists_a_stuck_payment_and_sends_staff_to_front_desk():
    cid = _client()
    _bid, inv = _visit(cid, total=100.0, paid=40.0, tab=True)
    aid = _stuck(cid, inv, 60.0)
    try:
        out = run(server.admin_pending_actions(type="online_payment_stuck", limit=100, user=OWNER))
        items = out["items"] if isinstance(out, dict) else out
        mine = [i for i in items if i["id"] == f"online_payment_stuck:{aid}"]
        assert mine and mine[0]["deep_link"]["screen"] == "pos" and "urgency_rank" in mine[0]
    finally:
        run(server.db.stripe_payment_attempts.update_one({"id": aid}, {"$set": {"status": "expired"}}))


def test_a_payment_being_refunded_can_never_also_be_recorded(monkeypatch):
    class _Failing(_FakeStripe):
        def __init__(self):
            super().__init__()

            class Refund:
                @staticmethod
                def create(**kw):
                    raise RuntimeError("stripe down")
            self.Refund = Refund
    monkeypatch.setattr(server, "stripe", _Failing())
    cid = _client()
    _bid, inv = _visit(cid, total=100.0, paid=40.0, tab=True)
    aid = _stuck(cid, inv, 60.0)
    assert _refused(lambda: run(resolve.refund_payment(aid, OWNER))).status_code == 502
    attempt = run(server.db.stripe_payment_attempts.find_one({"id": aid}, {"_id": 0}))
    assert attempt["status"] == "refunding"
    run(server._handle_checkout_session_paid_event({"id": "cs_audit7", "payment_status": "paid", "payment_intent": "pi_audit7"}))
    with pytest.raises(HTTPException):
        run(server._apply_stripe_payment(attempt))
    assert _inv(inv["id"])["balance"] == 60.0, "a refund in progress must block recording"
    monkeypatch.setattr(server, "stripe", _FakeStripe())
    run(resolve.refund_payment(aid, OWNER))  # pressing Refund again finishes it
    assert run(server.db.stripe_payment_attempts.find_one({"id": aid}))["status"] == "refunded"
    assert not _inv(inv["id"]).get("stripe_active_attempt_id")


def test_a_disputed_stuck_payment_follows_the_banks_decision(monkeypatch):
    monkeypatch.setattr(server, "stripe", _FakeStripe())
    cid = _client()
    _bid, inv = _visit(cid, total=100.0, paid=40.0, tab=True)
    aid = _stuck(cid, inv, 60.0)
    did = f"dp_{aid}"
    run(server.db.stripe_disputes.insert_one({"id": did, "stripe_payment_intent_id": "pi_audit7", "status": "needs_response"}))
    try:
        p = next(x for x in run(resolve.stuck_payments()) if x["id"] == aid)
        assert p["reason_code"] == "dispute_open" and not (p["can_close"] or p["can_refund"] or p["can_retry"])
        assert _refused(lambda: run(resolve.close_disputed_payment(aid, OWNER))).status_code == 409
        # Lost: the money went back to the customer; Close frees the bill.
        run(server.db.stripe_disputes.update_one({"id": did}, {"$set": {"status": "lost"}}))
        p = next(x for x in run(resolve.stuck_payments()) if x["id"] == aid)
        assert p["can_close"] and not p["can_refund"]
        run(resolve.close_disputed_payment(aid, OWNER))
        assert run(server.db.stripe_payment_attempts.find_one({"id": aid}))["status"] == "disputed"
        assert not _inv(inv["id"]).get("stripe_active_attempt_id")
    finally:
        run(server.db.stripe_disputes.delete_one({"id": did}))


def test_a_won_dispute_lets_staff_record_the_payment(monkeypatch):
    class _Won(_FakeStripe):
        def __init__(self):
            super().__init__()

            class PaymentIntent:
                @staticmethod
                def retrieve(pi_id, expand=None):
                    return _Obj({"id": pi_id, "status": "succeeded", "latest_charge": {"amount_refunded": 0, "disputed": True}})
            self.PaymentIntent = PaymentIntent
    monkeypatch.setattr(server, "stripe", _Won())
    cid = _client()
    _bid, inv = _visit(cid, total=100.0, paid=40.0, tab=True)
    aid = _stuck(cid, inv, 60.0)
    did = f"dp_{aid}"
    run(server.db.stripe_disputes.insert_one({"id": did, "stripe_payment_intent_id": "pi_audit7", "status": "won"}))
    try:
        assert next(x for x in run(resolve.stuck_payments()) if x["id"] == aid)["can_retry"]
        run(resolve.retry_payment(aid))
        assert run(server.db.stripe_payment_attempts.find_one({"id": aid}))["status"] == "applied"
    finally:
        run(server.db.stripe_disputes.delete_one({"id": did}))


def test_credit_is_never_offered_while_another_bill_is_out_of_step():
    cid = _client()
    _a, _ia = _visit(cid, total=50.0, paid=100.0, tab=True)   # $50 real credit
    bid_b, inv_b = _visit(cid, total=80.0, paid=0.0, tab=True)
    _c, inv_a = _visit(cid, total=100.0, paid=0.0, tab=True)
    # Old drift on bill B: the tab moved, the bill didn't.
    run(server._write_ledger_row(client_id=cid, type_="adjustment", amount=-50.0, booking_id=bid_b, notes="Post-checkout writeoff · old"))
    run(server._adjust_client_balance(cid, -50.0))
    assert run(tab_sync.credit_on_file(cid)) == 0.0
    assert not run(resolve.bill_preview(inv_a["id"]))["can_apply_credit"]
    assert _refused(lambda: run(resolve.fix_bill(inv_a["id"], resolve.BillFixIn(action="apply_credit"), OWNER))).status_code == 409
    general = server.TabAdjustmentIn(amount=-10.0, notes="goodwill")
    assert "needs fixing" in _refused(lambda: run(server.apply_tab_adjustment(cid, general, user=OWNER))).detail
    # A visit discount on the drifted bill waits for the fix, too.
    assert "needs fixing" in _refused(_correct, bid_b, "discount", 10.0).detail


def test_a_refund_stripe_reports_failed_puts_the_payment_back(monkeypatch):
    class _Fails(_FakeStripe):
        def __init__(self):
            super().__init__()

            class Refund:
                @staticmethod
                def create(**kw):
                    return {"id": "re_fail", "status": "failed"}
            self.Refund = Refund
    monkeypatch.setattr(server, "stripe", _Fails())
    cid = _client()
    _bid, inv = _visit(cid, total=100.0, paid=40.0, tab=True)
    aid = _stuck(cid, inv, 60.0)
    assert _refused(lambda: run(resolve.refund_payment(aid, OWNER))).status_code == 502
    assert run(server.db.stripe_payment_attempts.find_one({"id": aid}))["status"] == "reconciliation_required"
    assert _inv(inv["id"])["stripe_active_attempt_id"] == aid
    # And a refund Stripe accepted, then failed later (webhook).
    monkeypatch.setattr(server, "stripe", _FakeStripe())
    run(resolve.refund_payment(aid, OWNER))
    assert run(server.db.stripe_payment_attempts.find_one({"id": aid}))["status"] == "refunded"
    run(server._handle_refund_event({"id": "re_audit7", "status": "failed", "payment_intent": "pi_audit7",
                                     "metadata": {"sithappens_stuck_attempt_id": aid}}))
    assert run(server.db.stripe_payment_attempts.find_one({"id": aid}))["status"] == "reconciliation_required"
    assert _inv(inv["id"])["stripe_active_attempt_id"] == aid
    assert not run(server.db.stripe_unlinked_refunds.find_one({"refund_id": "re_audit7"}))


def test_applying_credit_leaves_nothing_behind_if_it_fails(monkeypatch):
    cid = _client()
    _a, _ia = _visit(cid, total=50.0, paid=100.0, tab=True)
    _b, inv = _visit(cid, total=100.0, paid=0.0, tab=True)
    real = server._write_ledger_row
    calls = {"n": 0}

    async def flaky(**kw):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("disk full")
        return await real(**kw)
    monkeypatch.setattr(server, "_write_ledger_row", flaky)
    with pytest.raises(RuntimeError):
        run(resolve.fix_bill(inv["id"], resolve.BillFixIn(action="apply_credit"), OWNER))
    bill = _inv(inv["id"])
    assert bill["balance"] == 100.0 and bill["amount_paid"] == 0.0 and not bill.get("reconciliations")
    assert run(server.db.payment_ledger.count_documents({"client_id": cid, "source": "credit_on_file"})) == 0
    assert _status(inv["id"])["reconciled"]
