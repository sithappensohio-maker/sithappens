"""Reopening a checkout and checking out again keeps surcharges and the bill
right (audit #14).

Before: reopening cleared the surcharge breakdown but not the "surcharges
already added" marker, so the second checkout left holiday / late-pickup
surcharges off; and the bill kept the first checkout's lines and total, so
the receipt was wrong and a tab bill said "We're updating this bill" until
staff pressed Fix bill.

Now: surcharges are worked out again, and the same bill (same number) is
rebuilt from the visit as it is now.

Self-contained fixtures (never import another test module).
"""
import contextlib
import uuid
from datetime import datetime, timezone

import pytest

import _test_env  # noqa: F401 — configure disposable DB before importing server
import app_entry
server = app_entry.server
from _test_loop import run
from domains.billing import tab_sync

TAG = "TEST_REOPEN_BILL"
ADMIN = {"id": "reopen-bill-admin", "name": "Reopen QA", "display_name": "Reopen QA", "email": "rb@test", "role": "admin"}


@pytest.fixture(autouse=True)
def _open_register(monkeypatch):
    async def _open(_date):
        return None
    monkeypatch.setattr(server, "_require_register_day_open", _open)


def _et(day_iso, hhmm):
    return (datetime.fromisoformat(f"{day_iso}T{hhmm}:00")
            .replace(tzinfo=server.BUSINESS_TZ).astimezone(timezone.utc).isoformat())


def _today():
    return server.business_today().isoformat()


@contextlib.contextmanager
def _settings(**patch):
    run(server.get_settings())
    before = run(server.db.settings.find_one({"id": "global"}, {"_id": 0}))
    run(server.db.settings.update_one({"id": "global"}, {"$set": {k.replace("__", "."): v for k, v in patch.items()}}))
    try:
        yield
    finally:
        run(server.db.settings.replace_one({"id": "global"}, before))


@contextlib.contextmanager
def _daycare_service(price=40.0):
    parked = run(server.db.services.find({"service_type": "daycare"}, {"_id": 0, "id": 1, "active": 1, "is_default": 1}).to_list(500))
    run(server.db.services.update_many({"id": {"$in": [p["id"] for p in parked]}}, {"$set": {"active": False, "is_default": False}}))
    svc = run(server.create_service(server.ServiceIn(
        name=f"{TAG} daycare {uuid.uuid4().hex[:5]}", service_type="daycare", base_price=price, active=True), ADMIN))
    run(server.db.services.update_one({"id": svc["id"]}, {"$set": {"is_default": True}}))
    try:
        yield svc
    finally:
        run(server.db.services.delete_many({"id": svc["id"]}))
        for p in parked:
            run(server.db.services.update_one({"id": p["id"]}, {"$set": {"active": p.get("active", True), "is_default": p.get("is_default", False)}}))


@contextlib.contextmanager
def _visit(price=40.0):
    cid, did, bid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    day = _today()
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} owner", "email": f"{cid}@example.com",
                                      "credits": 0, "boarding_credits": 0, "account_balance": 0.0}))
    run(server.db.dogs.insert_one({"id": did, "owner_id": cid, "name": "Pep", "vaccines": {"rabies": "2099-01-01"}}))
    run(server.db.bookings.insert_one({
        "id": bid, "client_id": cid, "client_name": f"{TAG} owner", "dog_id": did, "dog_name": "Pep",
        "service_type": "daycare", "date": day, "end_date": day, "status": "approved",
        "dropoff_time": "08:00", "pickup_time": "23:59", "time": "",
        "estimated_price": price, "unit_price": price, "pricing_snapshot": {"unit_price": price},
        "credit_units_required": 1, "checked_in_at": _et(day, "08:00"), "checked_in_by": "test",
        "checked_out_at": None, "created_at": server.now_iso()}))
    try:
        yield {"client_id": cid, "booking_id": bid}
    finally:
        async def go():
            for c in ("bookings", "invoices", "payments", "payment_ledger", "retail_sales", "booking_financial_events"):
                await server.db[c].delete_many({"client_id": cid})
            await server.db.booking_financial_events.delete_many({"booking_id": bid})
            await server.db.dogs.delete_many({"owner_id": cid})
            await server.db.clients.delete_many({"id": cid})
        run(go())


def _checkout(bid, **body):
    return run(server.check_out(bid, server.CheckoutIn(**body), user=ADMIN))


def _reopen(bid):
    return run(server.reopen_booking_checkout(bid, server.BookingReopenCheckoutIn(reason="wrong pickup time"), user=ADMIN))


def _row(bid):
    return run(server.db.bookings.find_one({"id": bid}, {"_id": 0}))


def _bills(bid):
    return run(server.db.invoices.find({"booking_ids": bid}, {"_id": 0}).to_list(10))


def _holiday():
    # A full day at $40 plus a 1.5x holiday — the half-day rule is off so the
    # dog checked in minutes ago still pays the full day.
    return _settings(**{"day_to_day.seasonal.holiday_surcharges": [{"date": _today(), "multiplier": 1.5, "label": "Holiday"}],
                        "day_to_day.money.late_pickup_fee_per_15min": 0,
                        "booking_rules.stay_pricing_enabled": False})


def test_a_second_checkout_keeps_the_holiday_surcharge():
    with _holiday(), _daycare_service(40.0), _visit() as v:
        bid = v["booking_id"]
        _checkout(bid, payment_method="cash", payment_status="unpaid")
        assert _row(bid)["actual_price"] == 60.0
        _reopen(bid)
        _checkout(bid, payment_method="cash", payment_status="unpaid")
        again = _row(bid)
        assert again["actual_price"] == 60.0, "the holiday surcharge was left off the second checkout"
        assert (again.get("money_modifier_breakdown") or {}).get("modifier_total") == 20.0


def test_the_same_bill_follows_the_second_checkout():
    with _holiday(), _daycare_service(40.0), _visit() as v:
        bid = v["booking_id"]
        _checkout(bid, payment_method="cash", payment_status="unpaid")
        first = _bills(bid)
        assert len(first) == 1 and first[0]["total"] == 60.0
        _reopen(bid)
        _checkout(bid, payment_method="cash", payment_status="unpaid", additional_cash_charge=15.0)
        bills = _bills(bid)
        assert len(bills) == 1 and bills[0]["id"] == first[0]["id"], "the same bill, not a second one"
        assert bills[0]["total"] == _row(bid)["actual_price"] == 75.0
        assert bills[0]["balance"] == 75.0 and bills[0].get("rebuilt_at")


def test_a_tab_bill_is_payable_again_without_fix_bill():
    with _holiday(), _daycare_service(40.0), _visit() as v:
        bid = v["booking_id"]
        _checkout(bid, payment_method="cash", payment_status="paid_partial", amount_paid=0)
        _reopen(bid)
        _checkout(bid, payment_method="cash", payment_status="paid_partial", amount_paid=0, additional_cash_charge=5.0)
        bill = _bills(bid)[0]
        assert bill["total"] == 65.0 and bill["balance"] == 65.0
        ok, code, _msg = run(tab_sync.payable_now(bill))
        assert ok is True, code
        client = run(server.db.clients.find_one({"id": v["client_id"]}, {"_id": 0, "account_balance": 1}))
        assert round(float(client["account_balance"]), 2) == 65.0


def test_a_bill_that_took_money_is_never_rebuilt():
    bill = {"id": "x", "status": "PARTIALLY_PAID", "amount_paid": 10.0, "booking_ids": ["b"], "created_at": "2026-01-01"}
    assert run(tab_sync.bill_needs_rebuild(bill)) is False
    assert run(tab_sync.bill_needs_rebuild({**bill, "amount_paid": 0.0, "stripe_active_attempt_id": "a"})) is False
    assert run(tab_sync.bill_needs_rebuild({**bill, "amount_paid": 0.0, "status": "VOID"})) is False


# ─────────────────────────────── review follow-ups ───────────────────────────────

from fastapi import HTTPException  # noqa: E402
from datetime import timedelta  # noqa: E402
from domains.bookings import reopen as booking_reopen  # noqa: E402
from domains.operations import end_of_day  # noqa: E402


def _refused(fn):
    with pytest.raises(HTTPException) as exc:
        fn()
    return exc.value


def _plain():
    # Full day at $40, no holiday, no late fee, no half-day rule.
    return _settings(**{"day_to_day.seasonal.holiday_surcharges": [],
                        "day_to_day.money.late_pickup_fee_per_15min": 0,
                        "booking_rules.stay_pricing_enabled": False})


def test_a_comped_second_checkout_closes_the_old_bill():
    with _plain(), _daycare_service(40.0), _visit() as v:
        bid = v["booking_id"]
        _checkout(bid, payment_method="cash", payment_status="unpaid")
        first = _bills(bid)[0]
        _reopen(bid)
        _checkout(bid, payment_method="cash", payment_status="unpaid", base_price=0)
        bill = _bills(bid)[0]
        assert bill["id"] == first["id"] and bill["total"] == 0 and bill["balance"] == 0 and bill["status"] == "PAID"
        ok, code, _ = run(tab_sync.payable_now(bill))
        assert ok is False and code == "paid"


def test_a_tab_visit_redone_as_unpaid_is_payable():
    with _plain(), _daycare_service(40.0), _visit() as v:
        bid = v["booking_id"]
        _checkout(bid, payment_method="cash", payment_status="paid_partial", amount_paid=0)
        _reopen(bid)
        _checkout(bid, payment_method="cash", payment_status="unpaid")
        bill = _bills(bid)[0]
        assert run(tab_sync.invoice_ar_status(bill))["ar_backed"] is False
        ok, code, _ = run(tab_sync.payable_now(bill))
        assert ok is True, code


def test_no_payment_is_taken_on_a_bill_while_its_visit_is_reopened():
    with _plain(), _daycare_service(40.0), _visit() as v:
        bid = v["booking_id"]
        _checkout(bid, payment_method="cash", payment_status="unpaid")
        bill = _bills(bid)[0]
        _reopen(bid)
        body = server.InvoicePaymentIn(amount=40.0, method="check", idempotency_key=uuid.uuid4().hex)
        err = _refused(lambda: run(server.create_invoice_payment(bill["id"], body, user=ADMIN)))
        assert err.status_code == 409 and "reopened" in err.detail


def test_a_write_off_on_the_bill_survives_the_rebuild():
    with _plain(), _daycare_service(40.0), _visit() as v:
        bid, cid = v["booking_id"], v["client_id"]
        _checkout(bid, payment_method="cash", payment_status="paid_partial", amount_paid=0)
        bill = _bills(bid)[0]
        run(server.apply_tab_adjustment(cid, server.TabAdjustmentIn(
            amount=-10.0, notes="goodwill", invoice_id=bill["id"], idempotency_key=uuid.uuid4().hex), user=ADMIN))
        _reopen(bid)
        _checkout(bid, payment_method="cash", payment_status="paid_partial", amount_paid=0, additional_cash_charge=5.0)
        bill = _bills(bid)[0]
        assert bill["total"] == 35.0 and bill["balance"] == 35.0
        assert any((li.get("source") or {}).get("kind") == "tab_writeoff" for li in bill["line_items"])
        ok, code, _ = run(tab_sync.payable_now(bill))
        assert ok is True, code


def test_end_of_day_trusts_the_rebuilt_bill_once_it_is_paid():
    with _plain(), _daycare_service(40.0), _visit() as v:
        bid = v["booking_id"]
        _checkout(bid, payment_method="cash", payment_status="unpaid")
        _reopen(bid)
        _checkout(bid, payment_method="cash", payment_status="unpaid")
        bill = _bills(bid)[0]
        run(server.create_invoice_payment(bill["id"], server.InvoicePaymentIn(
            amount=40.0, method="check", idempotency_key=uuid.uuid4().hex), user=ADMIN))
        visits = run(end_of_day.checked_out_on(_today()))
        listed = [r.get("booking_id") or r.get("id") for r in run(end_of_day.unpaid(visits))]
        assert bid not in listed


def test_the_late_fee_follows_when_the_dog_really_left_not_the_redo():
    now_local = datetime.now(server.BUSINESS_TZ)
    if now_local.hour == 0 and now_local.minute < 40:
        pytest.skip("needs 40 minutes of today behind us")
    pickup = (now_local - timedelta(minutes=30)).strftime("%H:%M")
    with _settings(**{"day_to_day.seasonal.holiday_surcharges": [],
                      "day_to_day.money.late_pickup_fee_per_15min": 5, "day_to_day.money.late_pickup_grace_min": 0,
                      "booking_rules.stay_pricing_enabled": False}), _daycare_service(40.0), _visit() as v:
        bid = v["booking_id"]
        run(server.db.bookings.update_one({"id": bid}, {"$set": {"pickup_time": pickup}}))
        _checkout(bid, payment_method="cash", payment_status="unpaid")
        # The dog actually left 10 minutes after pickup; staff redo the checkout now.
        left = (now_local - timedelta(minutes=20)).astimezone(timezone.utc).isoformat()
        run(server.db.bookings.update_one({"id": bid}, {"$set": {"checked_out_at": left}}))
        _reopen(bid)
        _checkout(bid, payment_method="cash", payment_status="unpaid")
        again = _row(bid)
        assert (again.get("money_modifier_breakdown") or {}).get("late_pickup_fee") == 5.0
        assert again["actual_price"] == 45.0


@contextlib.contextmanager
def _two_visits():
    """Two dogs of one family, booked separately, both on site today."""
    cid = str(uuid.uuid4())
    day = _today()
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} family", "email": f"{cid}@example.com",
                                      "credits": 0, "boarding_credits": 0, "account_balance": 0.0}))
    ids = []
    for name in ("Ace", "Bee"):
        did, bid = str(uuid.uuid4()), str(uuid.uuid4())
        run(server.db.dogs.insert_one({"id": did, "owner_id": cid, "name": name, "vaccines": {"rabies": "2099-01-01"}}))
        run(server.db.bookings.insert_one({
            "id": bid, "client_id": cid, "client_name": f"{TAG} family", "dog_id": did, "dog_name": name,
            "service_type": "daycare", "date": day, "end_date": day, "status": "approved",
            "dropoff_time": "08:00", "pickup_time": "23:59", "time": "", "estimated_price": 40.0,
            "unit_price": 40.0, "pricing_snapshot": {"unit_price": 40.0}, "credit_units_required": 1,
            "checked_in_at": _et(day, "08:00"), "checked_in_by": "test", "checked_out_at": None,
            "created_at": server.now_iso()}))
        ids.append(bid)
    try:
        yield ids
    finally:
        async def go():
            for c in ("bookings", "invoices", "payments", "payment_ledger", "retail_sales", "checkout_groups"):
                await server.db[c].delete_many({"client_id": cid})
            await server.db.dogs.delete_many({"owner_id": cid})
            await server.db.clients.delete_many({"id": cid})
        run(go())


def test_reopening_the_full_price_dog_never_discounts_both():
    with _plain(), _daycare_service(40.0), _two_visits() as (a, b):
        _checkout(a, payment_method="cash", payment_status="unpaid")
        _checkout(b, payment_method="cash", payment_status="unpaid")
        assert _row(a)["actual_price"] == 40.0 and _row(b)["actual_price"] == 20.0
        _reopen(a)
        _checkout(a, payment_method="cash", payment_status="unpaid")
        assert _row(a)["actual_price"] == 40.0, "the discounted sibling must not make this dog discounted too"


def test_a_reopen_forgets_the_sibling_discount_its_checkout_gave():
    with _plain(), _daycare_service(40.0), _two_visits() as (a, b):
        _checkout(a, payment_method="cash", payment_status="unpaid")
        _checkout(b, payment_method="cash", payment_status="unpaid")
        _reopen(b)
        _reopen(a)
        assert not _row(b).get("multi_dog_discount")
        _checkout(b, payment_method="cash", payment_status="unpaid")   # now the first out: full price
        _checkout(a, payment_method="cash", payment_status="unpaid")   # second: discounted
        assert _row(b)["actual_price"] == 40.0 and _row(a)["actual_price"] == 20.0
        lines = [li for bill in (_bills(a) + _bills(b)) for li in bill["line_items"] if li.get("kind") == "discount"]
        assert len(lines) == 1, "one discount given, one discount line"


def test_add_ons_sold_at_the_first_checkout_are_billed_once_at_full_base():
    with _plain(), _daycare_service(40.0) as svc, _visit() as v:
        bid = v["booking_id"]
        trim = server.CheckoutAddOn(service_id=svc["id"], name="Nail trim", price=15.0, qty=1)
        _checkout(bid, payment_method="cash", payment_status="unpaid", add_ons=[trim])
        assert _row(bid)["actual_price"] == 55.0
        _reopen(bid)
        _checkout(bid, payment_method="cash", payment_status="unpaid")
        assert _row(bid)["actual_price"] == 55.0
        assert _bills(bid)[0]["total"] == 55.0


def test_a_reopen_never_moves_the_stay_end_date():
    # The extra nights stay in the dates (billed once from them at the next
    # checkout) — whether this checkout or an older one added them.
    b = {"service_type": "boarding", "end_date": "2026-10-05", "checked_out_at": "2026-10-05T16:00:00+00:00",
         "extra_nights": {"count": 2, "original_end_date": "2026-10-03", "charge": 120.0,
                          "added_at": "2026-10-05T16:00:00+00:00"}}
    older = {**b, "checked_out_at": "2026-10-07T16:00:00+00:00", "extra_nights": {"count": 2, "charge": 120.0}}
    for visit in (b, older):
        to_set, to_unset, note = booking_reopen.undo_checkout(visit)
        assert "end_date" not in to_set and "extra_nights" not in to_unset
        assert to_set["extra_nights"]["in_stay"] is True and note["prior_extra_nights"]["count"] == 2
        again = booking_reopen.undo_checkout({**visit, "extra_nights": to_set["extra_nights"]})
        assert "extra_nights" not in again[0], "already marked — nothing more to do"


def test_a_visit_being_checked_out_that_is_on_no_bill_is_never_dropped():
    with _plain(), _daycare_service(40.0), _two_visits() as (a, c):
        _checkout(a, payment_method="cash", payment_status="unpaid")
        x = _bills(a)[0]
        _reopen(a)
        day = _today()
        run(server.db.cash_drawer_sessions.find_one_and_update(
            {"date": day}, {"$setOnInsert": {"date": day, "opening_cash": 100.0, "opened_at": server.now_iso(),
                                             "opened_by": TAG, "opened_by_name": TAG, "notes": TAG}}, upsert=True))
        try:
            # both dogs checked out as a household: the reopened dog's bill is rebuilt and C lands on it
            run(server.check_out_group(a, server.CheckoutIn(payment_method="cash", payment_status="unpaid"), ADMIN))
        finally:
            run(server.db.cash_drawer_sessions.delete_many({"notes": TAG}))
        bill = run(server.db.invoices.find_one({"id": x["id"]}, {"_id": 0}))
        assert set(bill["booking_ids"]) == {a, c}
        assert bill["total"] == round(_row(a)["actual_price"] + _row(c)["actual_price"], 2)


# ─────────────────────────────── second review ───────────────────────────────

import asyncio  # noqa: E402
from unittest.mock import AsyncMock, patch  # noqa: E402


@contextlib.contextmanager
def _drawer():
    day = _today()
    run(server.db.cash_drawer_sessions.find_one_and_update(
        {"date": day}, {"$setOnInsert": {"date": day, "opening_cash": 100.0, "opened_at": server.now_iso(),
                                         "opened_by": TAG, "opened_by_name": TAG, "notes": TAG}}, upsert=True))
    try:
        yield
    finally:
        run(server.db.cash_drawer_sessions.delete_many({"notes": TAG}))


def _emails(monkeypatch):
    sent = []

    def _capture(kind, ref_id, client_id, claim_key=None, fallback_email=None):
        sent.append((kind, ref_id, claim_key))
        return asyncio.sleep(0)
    monkeypatch.setattr(server, "_maybe_auto_email_receipt", _capture)
    return sent


def test_a_bill_still_showing_the_undone_checkout_is_never_payable_and_is_brought_up_to_date():
    with _plain(), _daycare_service(40.0), _visit() as v, _drawer():
        bid = v["booking_id"]
        _checkout(bid, payment_method="cash", payment_status="paid_partial", amount_paid=0)   # on the tab
        x = _bills(bid)[0]
        _reopen(bid)
        # The second checkout's bill step never happened (a reopen from before
        # this fix, or the step failed): the bill still shows the old checkout.
        with patch.object(tab_sync, "bill_needs_rebuild", new=AsyncMock(return_value=False)):
            _checkout(bid, payment_method="cash", payment_status="paid", amount_paid=40.0)   # paid at the counter
        stale = _bills(bid)[0]
        assert stale["balance"] == 40.0 and not stale.get("amount_paid")
        ok, code, _ = run(tab_sync.payable_now(stale))
        assert ok is False and code == "needs_review", "the $40 was paid at the counter — never ask for it again"
        body = server.InvoicePaymentIn(amount=40.0, method="check", idempotency_key=uuid.uuid4().hex)
        assert _refused(lambda: run(server.create_invoice_payment(x["id"], body, user=ADMIN))).status_code == 409
        # the scheduler job brings it up to date
        run(tab_sync.rebuild_stale_bills())
        bill = _bills(bid)[0]
        assert bill["id"] == x["id"] and bill["amount_paid"] == 40.0 and bill["balance"] == 0 and bill["status"] == "PAID"
        row = run(server.db.payments.find_one({"idempotency_ref": f"{x['id']}:{bid}:cash"}, {"_id": 0}))
        assert row and row["amount"] == 40.0 and row["date"] == _today()
        assert run(tab_sync.bill_needs_rebuild(_bills(bid)[0])) is False, "nothing left to do"


def test_a_write_off_is_never_forgiven_twice_when_the_redo_is_off_the_tab():
    with _plain(), _daycare_service(40.0), _visit() as v:
        bid, cid = v["booking_id"], v["client_id"]
        _checkout(bid, payment_method="cash", payment_status="paid_partial", amount_paid=0)
        bill = _bills(bid)[0]
        run(server.apply_tab_adjustment(cid, server.TabAdjustmentIn(
            amount=-10.0, notes="goodwill", invoice_id=bill["id"], idempotency_key=uuid.uuid4().hex), user=ADMIN))
        _reopen(bid)
        _checkout(bid, payment_method="cash", payment_status="unpaid")   # not on the tab this time
        bill = _bills(bid)[0]
        assert bill["total"] == 40.0 and bill["balance"] == 40.0
        assert not any((li.get("source") or {}).get("kind") == "tab_writeoff" for li in bill["line_items"])
        # the $10 goodwill is still the family's — once, as credit on the account
        assert run(tab_sync.credit_on_file(cid)) == 10.0


def test_the_corrected_bill_goes_out_as_its_own_receipt(monkeypatch):
    sent = _emails(monkeypatch)
    with _plain(), _daycare_service(40.0), _visit() as v:
        bid = v["booking_id"]
        _checkout(bid, payment_method="cash", payment_status="unpaid")
        x = _bills(bid)[0]["id"]
        _reopen(bid)
        _checkout(bid, payment_method="cash", payment_status="unpaid", additional_cash_charge=5.0)
        bill = _bills(bid)[0]
        assert [(k, r) for k, r, _ in sent] == [("invoice", x), ("invoice", x)]
        assert sent[0][2] is None and sent[1][2] == f"{x}:{bill['rebuilt_at']}", "not swallowed as the first receipt again"


def test_a_dog_redone_before_its_reopened_sibling_has_its_cash_recorded_then(monkeypatch):
    sent = _emails(monkeypatch)
    with _plain(), _daycare_service(40.0), _two_visits() as (a, b), _drawer():
        run(server.check_out_group(a, server.CheckoutIn(payment_method="cash", payment_status="unpaid"), ADMIN))
        x = _bills(a)[0]
        assert set(x["booking_ids"]) == {a, b}
        _reopen(a)
        _reopen(b)
        sent.clear()
        redone_a = _checkout(a, payment_method="cash", payment_status="paid", amount_paid=40.0, tendered_amount=50.0)
        row = run(server.db.payments.find_one({"idempotency_ref": f"{x['id']}:{a}:cash"}, {"_id": 0}))
        assert row, "the cash taken for this dog was not recorded"
        assert row["amount"] == 40.0 and row["tendered_amount"] == 50.0 and row["change_given"] == 10.0
        assert row["date"] == _today() and row["business_date"] == _today()
        assert sent == [], "no receipt for a bill still showing the old checkout"
        assert _row(a) and redone_a.get("pos_receipt_waiting") is True
        assert _refused(lambda: run(server.view_receipt("invoice", x["id"], user=ADMIN))).status_code == 409
        assert _refused(lambda: run(server.issue_pos_tokens_for_invoice(
            x["id"], {"actions": ["print_receipt"]}, user=ADMIN))).status_code == 409
        # no refund either: it would stop the bill ever being brought up to date
        refund = server.BookingRefundIn(amount=10.0, payment_method="cash", reason="refund on a waiting bill",
                                        refund_idempotency_key=uuid.uuid4().hex)
        assert _refused(lambda: run(server.booking_refund(a, refund, user=ADMIN))).status_code == 409
        _checkout(b, payment_method="cash", payment_status="unpaid")
        bill = run(server.db.invoices.find_one({"id": x["id"]}, {"_id": 0}))
        assert bill.get("rebuilt_at") and bill["amount_paid"] == 40.0
        rows = run(server.db.payments.find({"invoice_id": x["id"], "booking_id": a}, {"_id": 0}).to_list(10))
        assert [r["id"] for r in rows] == [row["id"]], "the same row, not a second one"
        assert sent and sent[-1][2] == f"{x['id']}:{bill['rebuilt_at']}"
        assert run(server.view_receipt("invoice", x["id"], user=ADMIN))["receipt_number"]


def _reopened(visit, *, stands=True, redo_at=None):
    """The visit after a reopen (and, with redo_at, checked out again then)."""
    to_set, to_unset, note = booking_reopen.undo_checkout(visit, departure_stands=stands)
    out = {k: v for k, v in {**visit, **to_set, "financial_reopened_at": "r"}.items() if k not in to_unset}
    out["financial_reopen_history"] = [*(visit.get("financial_reopen_history") or []), note]  # as the reopen records it
    out["checked_out_at"] = redo_at
    return out, note


def test_a_departure_staff_said_was_a_mistake_is_never_priced_from():
    came, t1, t3 = "2026-10-01T12:00:00+00:00", "2026-10-01T14:00:00+00:00", "2026-10-01T21:30:00+00:00"
    visit = {"checked_in_at": came, "checked_out_at": t1}
    # the departure stands: every redo is priced from it, however often it is reopened
    once, note = _reopened(visit, redo_at=t3)
    assert note["departure_stands"] is True and booking_reopen.pricing_ts(once, "NOW") == t1
    assert booking_reopen.pricing_ts(_reopened(once)[0], "NOW") == t1
    # "hasn't left yet": priced from the next checkout — even after an earlier reopen said it stood
    assert booking_reopen.pricing_ts(_reopened(visit, stands=False)[0], "NOW") == "NOW"
    assert booking_reopen.pricing_ts(_reopened(once, stands=False)[0], "NOW") == "NOW"
    # the dog then really left at the redo: that departure is kept from here on
    later, _ = _reopened(_reopened(visit, stands=False, redo_at=t3)[0])
    assert booking_reopen.pricing_ts(later, "NOW") == t3
    # never a time before the check-in
    assert booking_reopen.pricing_ts({**once, "checked_in_at": "2026-10-02T11:00:00Z"}, "NOW") == "NOW"
    assert booking_reopen.departure_known(once) and not booking_reopen.departure_known(_reopened(once, stands=False)[0])
    # a reopen from before this rule: its day counts as known, as it always did
    legacy = {"financial_reopened_at": "r", "financial_reopen_history": [{"at": "r", "reason": "old"}]}
    assert booking_reopen.departure_known(legacy) and booking_reopen.pricing_ts(legacy, "NOW") == "NOW"
    assert not booking_reopen.departure_known({"checked_in_at": came})


def test_a_checkout_done_by_mistake_is_priced_from_when_the_dog_really_leaves():
    now_local = datetime.now(server.BUSINESS_TZ)
    if now_local.hour == 0 and now_local.minute < 50:
        pytest.skip("needs 50 minutes of today behind us")
    pickup = (now_local - timedelta(minutes=30)).strftime("%H:%M")
    with _settings(**{"day_to_day.seasonal.holiday_surcharges": [],
                      "day_to_day.money.late_pickup_fee_per_15min": 5, "day_to_day.money.late_pickup_grace_min": 0,
                      "booking_rules.stay_pricing_enabled": False}), _daycare_service(40.0), _visit() as v:
        bid = v["booking_id"]
        run(server.db.bookings.update_one({"id": bid}, {"$set": {"pickup_time": pickup}}))
        _checkout(bid, payment_method="cash", payment_status="unpaid")
        # checked out by mistake before pickup time; the dog is still here
        mistake = (now_local - timedelta(minutes=40)).astimezone(timezone.utc).isoformat()
        run(server.db.bookings.update_one({"id": bid}, {"$set": {"checked_out_at": mistake}}))
        run(server.reopen_booking_checkout(bid, server.BookingReopenCheckoutIn(
            reason="checked out by mistake", departure_stands=False), user=ADMIN))
        assert _row(bid)["financial_reopen_history"][-1]["departure_stands"] is False
        _checkout(bid, payment_method="cash", payment_status="unpaid")
        fee = (_row(bid).get("money_modifier_breakdown") or {}).get("late_pickup_fee") or 0
        assert fee > 0, "the dog really left 30 minutes after pickup time"


@contextlib.contextmanager
def _boarding_stay(unit=50.0):
    cid, did, bid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    today = server.business_today()
    start, end = (today - timedelta(days=4)).isoformat(), (today - timedelta(days=2)).isoformat()
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} boarder", "email": f"{cid}@example.com",
                                      "credits": 0, "boarding_credits": 0, "account_balance": 0.0}))
    run(server.db.dogs.insert_one({"id": did, "owner_id": cid, "name": "Moss", "vaccines": {"rabies": "2099-01-01"}}))
    run(server.db.bookings.insert_one({
        "id": bid, "client_id": cid, "client_name": f"{TAG} boarder", "dog_id": did, "dog_name": "Moss",
        "service_type": "boarding", "date": start, "end_date": end, "status": "approved",
        "dropoff_time": "08:00", "pickup_time": "09:00", "time": "", "estimated_price": unit * 2,
        "unit_price": unit, "pricing_snapshot": {"unit_price": unit}, "credit_units_required": 2,
        "checked_in_at": _et(start, "08:00"), "checked_in_by": "test", "checked_out_at": None,
        "created_at": server.now_iso()}))
    try:
        yield bid
    finally:
        async def go():
            for c in ("bookings", "invoices", "payments", "payment_ledger", "booking_financial_events"):
                await server.db[c].delete_many({"client_id": cid})
            await server.db.booking_financial_events.delete_many({"booking_id": bid})
            await server.db.dogs.delete_many({"owner_id": cid})
            await server.db.clients.delete_many({"id": cid})
        run(go())


def test_a_redo_that_changes_nothing_bills_the_extra_nights_once():
    with _plain(), _boarding_stay(50.0) as bid:
        _checkout(bid, payment_method="cash", payment_status="unpaid", extra_nights=2, extra_nights_use_credits=False)
        first = _row(bid)
        assert first["actual_price"] == 200.0 and first["end_date"] == _today()
        _reopen(bid)
        assert _row(bid)["end_date"] == _today() and _row(bid)["extra_nights"]["in_stay"] is True
        _checkout(bid, payment_method="cash", payment_status="unpaid")   # nothing re-entered
        again = _row(bid)
        assert again["actual_price"] == 200.0, "the two extra nights must be billed once — not dropped"
        assert _bills(bid)[0]["total"] == 200.0


# ─────────────────────────────── third review ───────────────────────────────

def test_a_write_off_left_off_one_rebuild_comes_back_on_the_next():
    with _plain(), _daycare_service(40.0), _visit() as v:
        bid, cid = v["booking_id"], v["client_id"]
        _checkout(bid, payment_method="cash", payment_status="paid_partial", amount_paid=0)
        bill = _bills(bid)[0]
        run(server.apply_tab_adjustment(cid, server.TabAdjustmentIn(
            amount=-10.0, notes="goodwill", invoice_id=bill["id"], idempotency_key=uuid.uuid4().hex), user=ADMIN))
        _reopen(bid)
        _checkout(bid, payment_method="cash", payment_status="unpaid")          # off the tab: not on the bill
        assert _bills(bid)[0]["total"] == 40.0
        _reopen(bid)
        _checkout(bid, payment_method="cash", payment_status="paid_partial", amount_paid=0)   # back on the tab
        bill = _bills(bid)[0]
        assert bill["total"] == 30.0 and bill["balance"] == 30.0
        assert [li["description"] for li in bill["line_items"] if (li.get("source") or {}).get("kind") == "tab_writeoff"] \
            == ["Write-off · goodwill"]
        assert run(tab_sync.invoice_ar_status(bill))["reconciled"] is True
        ok, code, _ = run(tab_sync.payable_now(bill))
        assert ok is True, code


def test_the_rebuild_job_waits_for_a_checkout_in_progress():
    with _plain(), _daycare_service(40.0), _visit() as v, _drawer():
        bid, cid = v["booking_id"], v["client_id"]
        _checkout(bid, payment_method="cash", payment_status="unpaid")
        _reopen(bid)
        with patch.object(tab_sync, "bill_needs_rebuild", new=AsyncMock(return_value=False)):
            _checkout(bid, payment_method="cash", payment_status="paid", amount_paid=40.0)
        run(server.db.clients.update_one({"id": cid}, {"$set": {
            "financial_checkout_in_progress": True, "financial_checkout_started_at": server.now_iso()}}))
        run(tab_sync.rebuild_stale_bills())
        assert run(tab_sync.bill_needs_rebuild(_bills(bid)[0])) is True, "a checkout holds this family's money lock"
        run(server.db.clients.update_one({"id": cid}, {"$unset": {
            "financial_checkout_in_progress": "", "financial_checkout_started_at": ""}}))
        run(tab_sync.rebuild_stale_bills())
        assert _bills(bid)[0]["amount_paid"] == 40.0
        client = run(server.db.clients.find_one({"id": cid}, {"_id": 0}))
        assert not client.get("financial_correction_in_progress"), "the job lets go of the lock"


@contextlib.contextmanager
def _boarding_service(price=50.0):
    parked = run(server.db.services.find({"service_type": "boarding"}, {"_id": 0, "id": 1, "active": 1, "is_default": 1}).to_list(500))
    run(server.db.services.update_many({"id": {"$in": [p["id"] for p in parked]}}, {"$set": {"active": False, "is_default": False}}))
    svc = run(server.create_service(server.ServiceIn(
        name=f"{TAG} boarding {uuid.uuid4().hex[:5]}", service_type="boarding", base_price=price, active=True), ADMIN))
    run(server.db.services.update_one({"id": svc["id"]}, {"$set": {"is_default": True}}))
    try:
        yield svc
    finally:
        run(server.db.services.delete_many({"id": svc["id"]}))
        for p in parked:
            run(server.db.services.update_one({"id": p["id"]}, {"$set": {"active": p.get("active", True), "is_default": p.get("is_default", False)}}))


def test_an_early_boarding_checkout_redone_later_is_quoted_from_when_the_dog_left():
    today = server.business_today()
    yesterday = (today - timedelta(days=1)).isoformat()
    with _plain(), _boarding_service(50.0), _boarding_stay(50.0) as bid:
        # booked through two days from now; the dog went home yesterday at 10:00
        run(server.db.bookings.update_one({"id": bid}, {"$set": {"end_date": (today + timedelta(days=2)).isoformat()}}))
        _checkout(bid, payment_method="cash", payment_status="unpaid", base_price=100.0)
        run(server.db.bookings.update_one({"id": bid}, {"$set": {"checked_out_at": _et(yesterday, "10:00")}}))
        _reopen(bid)
        quote = run(server.early_checkout_quote(bid, ADMIN))
        assert quote["applicable"] is True
        assert quote["actual_end_date"] == yesterday and quote["pickup_time_used"] == "10:00"
        assert quote["units"] == 3.0, "three nights to yesterday, not four to today"
        # reopened as "hasn't left yet": the quote is today's, as for any dog leaving now
        _checkout(bid, payment_method="cash", payment_status="unpaid", base_price=150.0)
        run(server.reopen_booking_checkout(bid, server.BookingReopenCheckoutIn(
            reason="still here actually", departure_stands=False), user=ADMIN))
        assert run(server.early_checkout_quote(bid, ADMIN))["actual_end_date"] == today.isoformat()


def test_a_dog_reopened_as_not_left_yet_is_asked_the_late_day_question():
    with _plain(), _daycare_service(40.0), _visit() as v:
        bid = v["booking_id"]
        _checkout(bid, payment_method="cash", payment_status="unpaid")
        # the (mistaken) checkout was yesterday — the dog is still here today
        y = (server.business_today() - timedelta(days=1)).isoformat()
        run(server.db.bookings.update_one({"id": bid}, {"$set": {
            "date": y, "end_date": y, "checked_in_at": _et(y, "08:00"), "checked_out_at": _et(y, "11:00")}}))
        run(server.reopen_booking_checkout(bid, server.BookingReopenCheckoutIn(
            reason="checked out by mistake", departure_stands=False), user=ADMIN))
        err = _refused(lambda: _checkout(bid, payment_method="cash", payment_status="unpaid"))
        assert err.status_code == 409 and (err.detail or {}).get("code") == "late_day_checkout_resolution_required"


def test_undoing_a_stayed_overnight_answer_after_a_reopen_keeps_the_folded_add_ons():
    visit = {"checked_out_at": "t", "estimated_price": 80.0, "late_day_resolution": "stayed_overnight",
             "add_ons": [{"name": "Bath", "price": 15.0, "qty": 1, "added_stage": "checkout"}],
             "late_day_checkout": {"at": "a", "original": {"service_type": "daycare", "estimated_price": 40.0}}}
    to_set, _, _ = booking_reopen.undo_checkout(visit)
    assert to_set["estimated_price"] == 95.0
    assert to_set["late_day_checkout"]["original"]["estimated_price"] == 55.0
    assert to_set["late_day_checkout"]["at"] == "a", "the record the late-day undo matches on is kept"


def test_two_reopened_bills_checked_out_together_each_get_their_receipt(monkeypatch):
    sent = _emails(monkeypatch)
    with _plain(), _daycare_service(40.0), _two_visits() as (a, b), _drawer():
        _checkout(a, payment_method="cash", payment_status="unpaid")
        _checkout(b, payment_method="cash", payment_status="unpaid")
        x1, x2 = _bills(a)[0]["id"], _bills(b)[0]["id"]
        assert x1 != x2
        _reopen(a)
        _reopen(b)
        sent.clear()
        out = run(server.check_out_group(a, server.CheckoutIn(payment_method="cash", payment_status="unpaid"), ADMIN))
        main = out["pos_invoice_id"]
        assert {main, *out["pos_extra_invoice_ids"]} == {x1, x2}
        bills = {i: run(server.db.invoices.find_one({"id": i}, {"_id": 0})) for i in (x1, x2)}
        assert all(bill.get("rebuilt_at") for bill in bills.values())
        assert sorted(k for _, _, k in sent) == sorted(f"{i}:{bill['rebuilt_at']}" for i, bill in bills.items())


# ─────────────────────────────── fourth review ───────────────────────────────

def test_a_reopened_visit_on_a_bill_leaves_by_checkout_never_by_cancel():
    with _plain(), _daycare_service(40.0), _two_visits() as (a, b), _drawer():
        run(server.check_out_group(a, server.CheckoutIn(payment_method="cash", payment_status="unpaid"), ADMIN))
        x = _bills(a)[0]
        _reopen(b)
        err = _refused(lambda: run(server._cancel_booking_impl(b, False, ADMIN, undo_check_in=True)))
        assert err.status_code == 409 and "$0" in err.detail
        assert _row(b)["status"] == "approved" and _row(b).get("checked_in_at")
        # a visit cancelled that way before this rule: it comes off the bill at the rebuild
        run(server.db.bookings.update_one({"id": b}, {"$set": {"status": "cancelled", "checked_in_at": None}}))
        assert run(tab_sync.any_visit_reopened(x)) is False and run(tab_sync.bill_needs_rebuild(x)) is True
        assert _refused(lambda: run(server.view_receipt("invoice", x["id"], user=ADMIN))).status_code == 409
        pay = server.InvoicePaymentIn(amount=60.0, method="check", idempotency_key=uuid.uuid4().hex)
        assert _refused(lambda: run(server.create_invoice_payment(x["id"], pay, user=ADMIN))).status_code == 409
        run(tab_sync.rebuild_stale_bills())
        bill = run(server.db.invoices.find_one({"id": x["id"]}, {"_id": 0}))
        # which of two dogs checked in the same minute gets the sibling discount varies
        assert bill["booking_ids"] == [a] and bill["total"] == _row(a)["actual_price"] in (20.0, 40.0)
        assert run(server.view_receipt("invoice", x["id"], user=ADMIN))["receipt_number"]


def test_no_refund_or_correction_while_a_bill_waits_for_its_rebuild():
    with _plain(), _daycare_service(40.0), _visit() as v, _drawer():
        bid, cid = v["booking_id"], v["client_id"]
        _checkout(bid, payment_method="cash", payment_status="paid_partial", amount_paid=0)
        x = _bills(bid)[0]
        _reopen(bid)
        with patch.object(tab_sync, "bill_needs_rebuild", new=AsyncMock(return_value=False)):
            _checkout(bid, payment_method="cash", payment_status="paid_partial", amount_paid=20.0)
        assert run(tab_sync.bill_needs_rebuild(_bills(bid)[0])) is True
        refund = server.BookingRefundIn(amount=5.0, payment_method="cash", reason="refund too early",
                                        refund_idempotency_key=uuid.uuid4().hex)
        assert _refused(lambda: run(server.booking_refund(bid, refund, user=ADMIN))).detail == tab_sync.MSG_REBUILDING
        fix = server.BookingFinancialAdjustmentIn(kind="discount", amount=5.0, reason="goodwill", idempotency_key=uuid.uuid4().hex)
        assert _refused(lambda: run(server.booking_financial_adjustment(bid, fix, user=ADMIN))).detail == tab_sync.MSG_REBUILDING
        off = server.TabAdjustmentIn(amount=-5.0, notes="goodwill", invoice_id=x["id"], idempotency_key=uuid.uuid4().hex)
        assert _refused(lambda: run(server.apply_tab_adjustment(cid, off, user=ADMIN))).detail == tab_sync.MSG_REBUILDING
        run(tab_sync.rebuild_stale_bills())
        bill = _bills(bid)[0]
        assert bill["amount_paid"] == 20.0 and bill["balance"] == 20.0
        run(server.booking_refund(bid, server.BookingRefundIn(amount=5.0, payment_method="cash", reason="now it can",
                                                              refund_idempotency_key=uuid.uuid4().hex), user=ADMIN))


# ─────────────────────────────── fifth review ───────────────────────────────

def test_a_sibling_redone_after_a_reopened_dog_was_cancelled_gets_its_cash_on_the_bill():
    with _plain(), _daycare_service(40.0), _two_visits() as (a, b), _drawer():
        run(server.check_out_group(a, server.CheckoutIn(payment_method="cash", payment_status="unpaid"), ADMIN))
        x = _bills(a)[0]
        _reopen(a)
        _reopen(b)
        # a was cancelled before that was refused (older data)
        run(server.db.bookings.update_one({"id": a}, {"$set": {"status": "cancelled", "checked_in_at": None}}))
        _checkout(b, payment_method="cash", payment_status="paid", amount_paid=40.0, tendered_amount=40.0)
        bill = run(server.db.invoices.find_one({"id": x["id"]}, {"_id": 0}))
        assert bill["booking_ids"] == [b] and bill["total"] == 40.0 and bill["amount_paid"] == 40.0 and bill["status"] == "PAID"
        assert run(server.db.payments.find_one({"idempotency_ref": f"{x['id']}:{b}:cash"}, {"_id": 0}))["amount"] == 40.0


def test_a_bill_whose_only_visit_was_cancelled_after_a_reopen_is_void_not_payable():
    with _plain(), _daycare_service(40.0), _visit() as v:
        bid = v["booking_id"]
        _checkout(bid, payment_method="cash", payment_status="unpaid")
        x = _bills(bid)[0]
        _reopen(bid)
        run(server.db.bookings.update_one({"id": bid}, {"$set": {"status": "cancelled", "checked_in_at": None}}))
        pay = server.InvoicePaymentIn(amount=40.0, method="check", idempotency_key=uuid.uuid4().hex)
        assert _refused(lambda: run(server.create_invoice_payment(x["id"], pay, user=ADMIN))).status_code == 409
        run(tab_sync.rebuild_stale_bills())
        bill = _bills(bid)[0]
        assert bill["status"] == "VOID" and bill["balance"] == 0 and bill["line_items"] == []
        assert _refused(lambda: run(server.create_invoice_payment(x["id"], pay, user=ADMIN))).status_code == 400


# ─────────────────────────────── sixth review ───────────────────────────────

def test_a_cancelled_reopened_visit_since_archived_still_voids_its_bill():
    with _plain(), _daycare_service(40.0), _visit() as v:
        bid = v["booking_id"]
        _checkout(bid, payment_method="cash", payment_status="unpaid")
        x = _bills(bid)[0]
        _reopen(bid)
        row = {**_row(bid), "status": "cancelled", "checked_in_at": None}
        run(server.db.bookings_archive.insert_one(dict(row)))
        run(server.db.bookings.delete_one({"id": bid}))
        try:
            ok, code, _ = run(tab_sync.payable_now(x))
            assert ok is False and code == "reopened"
            assert _refused(lambda: run(server.view_receipt("invoice", x["id"], user=ADMIN))).status_code == 409
            run(tab_sync.rebuild_stale_bills())
            assert run(server.db.invoices.find_one({"id": x["id"]}, {"_id": 0}))["status"] == "VOID"
        finally:
            run(server.db.bookings_archive.delete_many({"id": bid}))


def test_a_bill_that_took_money_and_bills_a_cancelled_visit_takes_no_more():
    with _plain(), _daycare_service(40.0), _visit() as v:
        bid = v["booking_id"]
        _checkout(bid, payment_method="cash", payment_status="unpaid")
        x = _bills(bid)[0]
        _reopen(bid)
        # older data: $10 was taken on the bill after the reopen, then the visit was cancelled
        run(server.db.invoices.update_one({"id": x["id"]}, {"$set": {"amount_paid": 10.0, "balance": 30.0}}))
        run(server.db.bookings.update_one({"id": bid}, {"$set": {"status": "cancelled", "checked_in_at": None}}))
        x = _bills(bid)[0]
        ok, code, _ = run(tab_sync.payable_now(x))
        assert ok is False and code == "reopened"
        pay = server.InvoicePaymentIn(amount=30.0, method="check", idempotency_key=uuid.uuid4().hex)
        assert _refused(lambda: run(server.create_invoice_payment(x["id"], pay, user=ADMIN))).status_code == 409
        run(tab_sync.rebuild_stale_bills())
        after = _bills(bid)[0]
        assert after["status"] != "VOID" and after["amount_paid"] == 10.0, "a bill that took money is never rebuilt"
