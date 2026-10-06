"""A tab bill paid after checkout stops showing as owed (audit #18).

Before: paying the bill never touched the visit's own stored balance_due, and
Today's "Amount Due", Action Required's "Unpaid money needs follow-up" and the
tax estimate's "Unpaid service balances" all read that stored number — so a
visit paid later still counted as owed, and the Action Required count only
ever grew. End of Day already went by the bill's live balance.

Now all of them go by the same rule as End of Day (end_of_day.owed /
owing_visit_count).

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
from domains.operations import end_of_day
from domains.billing import tab_sync
import pl_report

TAG = "TEST_OWED_AFTER_PAID"
ADMIN = {"id": "owed-admin", "name": "Owed QA", "display_name": "Owed QA", "email": "owed@test", "role": "admin"}


@pytest.fixture(autouse=True)
def _open_register(monkeypatch):
    async def _open(_date):
        return None
    monkeypatch.setattr(server, "_require_register_day_open", _open)


def _et(day_iso, hhmm):
    return (datetime.fromisoformat(f"{day_iso}T{hhmm}:00")
            .replace(tzinfo=server.BUSINESS_TZ).astimezone(timezone.utc).isoformat())


@contextlib.contextmanager
def _plain():
    run(server.get_settings())
    before = run(server.db.settings.find_one({"id": "global"}, {"_id": 0}))
    run(server.db.settings.update_one({"id": "global"}, {"$set": {
        "day_to_day.seasonal.holiday_surcharges": [], "day_to_day.money.late_pickup_fee_per_15min": 0,
        "booking_rules.stay_pricing_enabled": False}}))
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
    day = server.business_today().isoformat()
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} owner", "email": f"{cid}@example.com",
                                      "credits": 0, "boarding_credits": 0, "account_balance": 0.0,
                                      "created_at": server.now_iso()}))
    run(server.db.dogs.insert_one({"id": did, "owner_id": cid, "name": "Pip", "vaccines": {"rabies": "2099-01-01"}}))
    run(server.db.bookings.insert_one({
        "id": bid, "client_id": cid, "client_name": f"{TAG} owner", "dog_id": did, "dog_name": "Pip",
        "service_type": "daycare", "date": day, "end_date": day, "status": "approved",
        "dropoff_time": "08:00", "pickup_time": "23:59", "time": "", "estimated_price": price, "unit_price": price,
        "pricing_snapshot": {"unit_price": price}, "credit_units_required": 1,
        "checked_in_at": _et(day, "08:00"), "checked_in_by": "test", "checked_out_at": None,
        "created_at": server.now_iso()}))
    try:
        yield {"client_id": cid, "booking_id": bid}
    finally:
        async def go():
            for c in ("bookings", "invoices", "payments", "payment_ledger", "booking_financial_events"):
                await server.db[c].delete_many({"client_id": cid})
            await server.db.dogs.delete_many({"owner_id": cid})
            await server.db.clients.delete_many({"id": cid})
        run(go())


def _on_the_tab_then_paid(v):
    """Checked out on the tab ($40 owed), then the bill paid at the desk."""
    bid = v["booking_id"]
    run(server.check_out(bid, server.CheckoutIn(payment_method="cash", payment_status="paid_partial", amount_paid=0), user=ADMIN))
    bill = run(server.db.invoices.find_one({"booking_ids": bid}, {"_id": 0}))
    assert bill["balance"] == 40.0
    before = _row(bid)
    return bill, before


def _row(bid):
    return run(server.db.bookings.find_one({"id": bid}, {"_id": 0}))


def _pay(bill):
    run(server.create_invoice_payment(bill["id"], server.InvoicePaymentIn(
        amount=40.0, method="check", idempotency_key=uuid.uuid4().hex), user=ADMIN))


def test_todays_amount_due_drops_when_the_bill_is_paid_later():
    with _plain(), _daycare_service(40.0), _visit() as v:
        bill, visit = _on_the_tab_then_paid(v)
        due_before = run(server.dashboard_stats(ADMIN))["amount_due_today"]
        assert run(end_of_day.owed([visit])) == 40.0
        _pay(bill)
        assert _row(v["booking_id"])["balance_due"] == 40.0, "the visit's own stored due is left behind"
        assert run(end_of_day.owed([_row(v["booking_id"])])) == 0.0
        due_after = run(server.dashboard_stats(ADMIN))["amount_due_today"]
        assert round(due_before - due_after, 2) == 40.0


def test_action_required_stops_counting_a_visit_paid_later():
    with _plain(), _daycare_service(40.0), _visit() as v:
        bill, _ = _on_the_tab_then_paid(v)
        owing_before = run(end_of_day.owing_visit_count())
        _pay(bill)
        assert run(end_of_day.owing_visit_count()) == owing_before - 1
        brain = run(server.admin_today_brain(ADMIN))
        item = next((i for i in brain.get("items") or [] if i.get("kind") == "unpaid_balance"), None)
        count = int(item["id"].split(":")[1]) if item else 0
        assert count == owing_before - 1


def test_the_tax_estimate_stops_listing_a_visit_paid_later_as_unpaid():
    with _plain(), _daycare_service(40.0), _visit() as v:
        bill, _ = _on_the_tab_then_paid(v)
        before = run(server.admin_quarterly_tax(ADMIN))
        _pay(bill)
        after = run(server.admin_quarterly_tax(ADMIN))
        key = "service_unpaid_balance"
        got = lambda r: (r.get("income") or {}).get(key, r.get(key))  # noqa: E731
        assert round(got(before) - got(after), 2) == 40.0


def test_a_visit_never_on_a_bill_still_counts_its_own_due():
    # older visits from before bills existed: the stored due is all there is
    visit = {"id": "x", "status": "completed", "payment_status": "paid_partial", "actual_price": 40.0, "amount_paid": 10.0, "balance_due": 30.0,
             "checked_out_at": server.now_iso(), "client_id": None}
    assert run(end_of_day.owed([visit])) == 30.0
    assert run(end_of_day.owed([{**visit, "status": "approved"}])) == 0.0, "not checked out: nothing owed yet"


# ─────────────────────────────── review follow-ups ───────────────────────────────

def _prepaid_session(v, svc_id=None):
    """Turn the fixture's visit into a sold program session (priced 0)."""
    run(server.db.bookings.update_one({"id": v["booking_id"]}, {"$set": {
        "service_type": "training", "is_prepaid_program_session": True, "estimated_price": 0.0,
        "unit_price": 0.0, "pricing_snapshot": {"unit_price": 0.0}}}))


def test_a_prepaid_lesson_with_an_add_on_on_the_tab_is_owed_until_its_bill_is_paid():
    with _plain(), _daycare_service(40.0) as svc, _visit() as v:
        _prepaid_session(v)
        bid = v["booking_id"]
        treat = server.CheckoutAddOn(service_id=svc["id"], name="Treat bag", price=15.0, qty=1)
        run(server.check_out(bid, server.CheckoutIn(payment_method="cash", payment_status="paid_partial",
                                                    amount_paid=0, add_ons=[treat]), user=ADMIN))
        visit = _row(bid)
        assert visit["actual_price"] == 15.0
        owing = run(end_of_day.owing_visit_count())
        assert run(end_of_day.owed([visit])) == 15.0
        bill = run(server.db.invoices.find_one({"booking_ids": bid}, {"_id": 0}))
        run(server.create_invoice_payment(bill["id"], server.InvoicePaymentIn(
            amount=15.0, method="check", idempotency_key=uuid.uuid4().hex), user=ADMIN))
        assert run(end_of_day.owed([_row(bid)])) == 0.0
        assert run(end_of_day.owing_visit_count()) == owing - 1


def test_a_charge_added_after_a_prepaid_lesson_is_owed_until_the_tab_is_paid():
    with _plain(), _daycare_service(40.0), _visit() as v:
        _prepaid_session(v)
        bid, cid = v["booking_id"], v["client_id"]
        run(server.check_out(bid, server.CheckoutIn(payment_method="cash", payment_status="paid"), user=ADMIN))
        run(server.booking_financial_adjustment(bid, server.BookingFinancialAdjustmentIn(
            kind="charge", amount=10.0, reason="extra lesson time", idempotency_key=uuid.uuid4().hex), user=ADMIN))
        visit = _row(bid)
        assert visit["balance_due"] == 10.0
        assert run(end_of_day.owed([visit])) == 10.0
        run(server.apply_tab_payment(cid, server.TabPaymentIn(amount=10.0, method="check"), user=ADMIN))
        assert run(end_of_day.owed([_row(bid)])) == 0.0, "paid on the tab"


def test_counting_what_is_owed_never_loads_report_card_photos(monkeypatch):
    assert "report_card" in end_of_day._CHECKOUT_FIELDS and "report_card" not in end_of_day._OWING_FIELDS
    real_g = end_of_day._g
    seen = []

    class _Bookings:
        def find(self, query, projection=None, *a, **k):
            seen.append(projection)
            return real_g("db").bookings.find(query, projection, *a, **k)

    class _Db:
        bookings = _Bookings()

        def __getattr__(self, name):
            return getattr(real_g("db"), name)
    fake = _Db()
    monkeypatch.setattr(end_of_day, "_g", lambda name: fake if name == "db" else real_g(name))
    run(end_of_day.owing_visit_count())
    assert seen and all("report_card" not in (p or {}) for p in seen)


def test_a_prepaid_lesson_credited_at_zero_then_charged_is_owed_until_the_tab_is_paid():
    # as the app stores a sold program session: price 0, paid from the program's credits
    with _plain(), _daycare_service(40.0), _visit() as v:
        _prepaid_session(v)
        bid, cid = v["booking_id"], v["client_id"]
        run(server.check_out(bid, server.CheckoutIn(payment_method="cash", payment_status="paid"), user=ADMIN))
        run(server.db.bookings.update_one({"id": bid}, {"$set": {"payment_method": "credits"}}))
        run(server.booking_financial_adjustment(bid, server.BookingFinancialAdjustmentIn(
            kind="charge", amount=10.0, reason="extra lesson time", idempotency_key=uuid.uuid4().hex), user=ADMIN))
        visit = _row(bid)
        assert visit["actual_price"] == 0.0 and visit["balance_due"] == 10.0
        assert run(end_of_day.owed([visit])) == 10.0
        run(server.apply_tab_payment(cid, server.TabPaymentIn(amount=10.0, method="check"), user=ADMIN))
        assert run(end_of_day.owed([_row(bid)])) == 0.0


# ─────────────────────────────── second review ───────────────────────────────

def _charge(bid, amount, kind="charge"):
    run(server.booking_financial_adjustment(bid, server.BookingFinancialAdjustmentIn(
        kind=kind, amount=amount, reason="after checkout", idempotency_key=uuid.uuid4().hex), user=ADMIN))


def test_a_visit_with_no_bill_keeps_its_checkout_debt_after_a_correction():
    from unittest.mock import AsyncMock, patch
    with _plain(), _daycare_service(40.0), _visit() as v:
        bid = v["booking_id"]
        with patch.object(server, "_create_invoice_for_bookings", new=AsyncMock(side_effect=RuntimeError("bill step failed"))):
            run(server.check_out(bid, server.CheckoutIn(payment_method="cash", payment_status="paid_partial", amount_paid=0), user=ADMIN))
        assert run(server.db.invoices.find_one({"booking_ids": bid})) is None
        _charge(bid, 10.0, "discount")
        assert _row(bid)["balance_due"] == 30.0
        assert run(end_of_day.owed([_row(bid)])) == 30.0, "a discount must not wipe out the checkout's own debt"
        _charge(bid, 10.0)
        assert run(end_of_day.owed([_row(bid)])) == 40.0


def test_a_charge_kept_on_a_prepaid_lesson_stays_owed_after_the_tab_is_paid():
    with _plain(), _daycare_service(40.0), _visit() as v:
        _prepaid_session(v)
        bid, cid = v["booking_id"], v["client_id"]
        run(server.check_out(bid, server.CheckoutIn(payment_method="cash", payment_status="paid"), user=ADMIN))
        _charge(bid, 10.0)   # goes on the tab
        _charge(bid, 5.0)    # stays on the visit
        assert _row(bid)["balance_due"] == 15.0
        assert run(end_of_day.owed([_row(bid)])) == 15.0
        run(server.apply_tab_payment(cid, server.TabPaymentIn(amount=10.0, method="check"), user=ADMIN))
        assert run(end_of_day.owed([_row(bid)])) == 5.0, "$5 is still owed on the visit"


def test_a_part_paid_tab_is_shared_across_a_familys_charges():
    with _plain(), _daycare_service(40.0), _visit() as v:
        cid = v["client_id"]
        _prepaid_session(v)
        first = v["booking_id"]
        second = str(uuid.uuid4())
        run(server.db.bookings.insert_one({**{k: val for k, val in _row(first).items() if k != "_id"}, "id": second}))
        for bid in (first, second):
            run(server.check_out(bid, server.CheckoutIn(payment_method="cash", payment_status="paid"), user=ADMIN))
            _charge(bid, 10.0)
        assert run(end_of_day.owed([_row(first), _row(second)])) == 20.0
        run(server.apply_tab_payment(cid, server.TabPaymentIn(amount=10.0, method="check"), user=ADMIN))
        assert run(end_of_day.owed([_row(first), _row(second)])) == 10.0, "the family owes 10, not 10 per visit"


def test_a_tab_charge_on_one_dog_never_takes_the_other_dogs_share_of_a_group_bill():
    cid, inv = str(uuid.uuid4()), str(uuid.uuid4())
    now = server.now_iso()
    lesson = {"id": str(uuid.uuid4()), "client_id": cid, "status": "completed", "checked_out_at": now,
              "payment_method": "credits", "payment_status": "paid_partial", "actual_price": 0.0, "amount_paid": 0.0,
              "balance_due": 10.0, "is_prepaid_program_session": True}
    ace = {"id": str(uuid.uuid4()), "client_id": cid, "status": "completed", "checked_out_at": now,
           "payment_method": "cash", "payment_status": "paid_partial", "actual_price": 40.0, "amount_paid": 0.0,
           "balance_due": 40.0}
    run(server.db.clients.insert_one({"id": cid, "name": TAG, "account_balance": 50.0}))
    run(server.db.invoices.insert_one({"id": inv, "client_id": cid, "booking_ids": [lesson["id"], ace["id"]],
                                       "balance": 40.0, "status": "OPEN", "created_at": now}))
    run(server.db.payment_ledger.insert_one({"id": str(uuid.uuid4()), "client_id": cid, "booking_id": lesson["id"],
                                             "type": "charge", "amount": 10.0, "source": "correction",
                                             "created_at": server.now_iso()}))
    try:
        rows = {r["booking_id"]: r["amount"] for r in run(end_of_day.unpaid([lesson, ace]))}
        assert rows == {ace["id"]: 40.0, lesson["id"]: 10.0}
    finally:
        run(server.db.clients.delete_many({"id": cid}))
        run(server.db.invoices.delete_many({"id": inv}))
        run(server.db.payment_ledger.delete_many({"client_id": cid}))


@contextlib.contextmanager
def _two_dog_family():
    cid = str(uuid.uuid4())
    day = server.business_today().isoformat()
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} family", "email": f"{cid}@example.com",
                                      "credits": 0, "boarding_credits": 0, "account_balance": 0.0,
                                      "created_at": server.now_iso()}))
    ids = []
    for name, came in (("Ace", "08:00"), ("Bee", "09:00")):
        did, bid = str(uuid.uuid4()), str(uuid.uuid4())
        run(server.db.dogs.insert_one({"id": did, "owner_id": cid, "name": name, "vaccines": {"rabies": "2099-01-01"}}))
        run(server.db.bookings.insert_one({
            "id": bid, "client_id": cid, "client_name": f"{TAG} family", "dog_id": did, "dog_name": name,
            "service_type": "daycare", "date": day, "end_date": day, "status": "approved",
            "dropoff_time": came, "pickup_time": "23:59", "time": "", "estimated_price": 40.0, "unit_price": 40.0,
            "pricing_snapshot": {"unit_price": 40.0}, "credit_units_required": 1,
            "checked_in_at": _et(day, came), "checked_in_by": "test", "checked_out_at": None,
            "created_at": server.now_iso()}))
        ids.append(bid)
    try:
        yield ids[0], ids[1], cid
    finally:
        async def go():
            for c in ("bookings", "invoices", "payments", "payment_ledger", "booking_financial_events", "retail_sales"):
                await server.db[c].delete_many({"client_id": cid})
            await server.db.dogs.delete_many({"owner_id": cid})
            await server.db.clients.delete_many({"id": cid})
        run(go())


# ─────────────────────────────── third review ───────────────────────────────

def test_every_charge_added_after_a_paid_bill_counts_not_just_the_latest():
    with _plain(), _daycare_service(40.0), _visit() as v:
        bid, cid = v["booking_id"], v["client_id"]
        run(server.check_out(bid, server.CheckoutIn(payment_method="check", payment_status="paid"), user=ADMIN))
        run(server.db.bookings.update_one({"id": bid}, {"$set": {"payment_method": "credits"}}))  # a package visit
        _charge(bid, 20.0)
        _charge(bid, 20.0)
        assert _row(bid)["balance_due"] == 20.0, "the visit keeps only the latest charge"
        assert run(end_of_day.owed([_row(bid)])) == 40.0
        run(server.apply_tab_payment(cid, server.TabPaymentIn(amount=40.0, method="check"), user=ADMIN))
        assert run(end_of_day.owed([_row(bid)])) == 0.0


def test_a_charge_paid_on_the_tab_stays_paid_when_the_family_runs_up_a_new_bill():
    with _plain(), _daycare_service(40.0), _two_dog_family() as (a, b, cid):
        run(server.check_out(a, server.CheckoutIn(payment_method="check", payment_status="paid"), user=ADMIN))
        _charge(a, 10.0)
        run(server.apply_tab_payment(cid, server.TabPaymentIn(amount=10.0, method="check"), user=ADMIN))
        assert run(end_of_day.owed([_row(a)])) == 0.0
        run(server.check_out(b, server.CheckoutIn(payment_method="cash", payment_status="paid_partial", amount_paid=0), user=ADMIN))
        assert run(end_of_day.owed([_row(a)])) == 0.0, "the new bill's debt is not the paid charge's"
        assert run(end_of_day.owed([_row(a), _row(b)])) == _row(b)["actual_price"]


def test_a_priced_dogs_own_tab_charge_never_takes_its_siblings_share_of_a_group_bill():
    cid, inv = str(uuid.uuid4()), str(uuid.uuid4())
    now = server.now_iso()
    x = {"id": str(uuid.uuid4()), "client_id": cid, "status": "completed", "checked_out_at": now,
         "payment_method": "cash", "payment_status": "paid_partial", "actual_price": 50.0, "amount_paid": 0.0,
         "balance_due": 10.0}
    y = {"id": str(uuid.uuid4()), "client_id": cid, "status": "completed", "checked_out_at": now,
         "payment_method": "cash", "payment_status": "paid_partial", "actual_price": 20.0, "amount_paid": 0.0,
         "balance_due": 20.0}
    # group bill of 60 back open (its payment voided); X's later $10 charge went on the tab
    run(server.db.clients.insert_one({"id": cid, "name": TAG, "account_balance": 10.0}))
    run(server.db.invoices.insert_one({"id": inv, "client_id": cid, "booking_ids": [x["id"], y["id"]],
                                       "balance": 60.0, "status": "OPEN", "created_at": now}))
    run(server.db.payment_ledger.insert_one({"id": str(uuid.uuid4()), "client_id": cid, "booking_id": x["id"],
                                             "type": "charge", "amount": 10.0, "source": "correction",
                                             "created_at": server.now_iso()}))
    try:
        rows = {r["booking_id"]: r["amount"] for r in run(end_of_day.unpaid([x, y]))}
        assert rows == {x["id"]: 50.0, y["id"]: 20.0}
    finally:
        run(server.db.clients.delete_many({"id": cid}))
        run(server.db.invoices.delete_many({"id": inv}))
        run(server.db.payment_ledger.delete_many({"client_id": cid}))


# ─────────────────────────────── checked against the old numbers ───────────────────────────────

def _sale_on_account(cid, amount):
    run(server.create_retail_sale(server.RetailSaleIn(
        date=server.business_today().isoformat(), description="Food bag", amount=amount, payment_method="check",
        client_id=cid, amount_paid=0.0), ADMIN))


def test_a_discount_after_a_charge_on_a_zero_price_visit_is_taken_off():
    with _plain(), _daycare_service(40.0), _visit() as v:
        bid = v["booking_id"]
        run(server.check_out(bid, server.CheckoutIn(payment_method="check", payment_status="paid", base_price=0), user=ADMIN))
        _charge(bid, 10.0)             # on the tab
        _charge(bid, 4.0, "discount")  # on the visit
        assert _row(bid)["balance_due"] == 6.0
        assert run(end_of_day.owed([_row(bid)])) == 6.0


def test_paid_charges_stay_paid_when_the_family_later_buys_on_account():
    with _plain(), _daycare_service(40.0), _visit() as v:
        bid, cid = v["booking_id"], v["client_id"]
        run(server.check_out(bid, server.CheckoutIn(payment_method="check", payment_status="paid"), user=ADMIN))
        _charge(bid, 10.0)
        _charge(bid, 10.0)
        run(server.apply_tab_payment(cid, server.TabPaymentIn(amount=20.0, method="check"), user=ADMIN))
        assert run(end_of_day.owed([_row(bid)])) == 0.0
        _sale_on_account(cid, 30.0)
        assert run(end_of_day.owed([_row(bid)])) == 0.0, "the $30 on the tab is the food bag's, not the visit's"
        due_today = run(server.dashboard_stats(ADMIN))["amount_due_today"]
        _charge(bid, 5.0)
        assert round(run(server.dashboard_stats(ADMIN))["amount_due_today"] - due_today, 2) == 5.0


def test_the_dog_whose_charge_is_still_on_the_tab_is_the_one_listed():
    with _plain(), _daycare_service(40.0), _two_dog_family() as (a, b, cid):
        for bid in (a, b):
            run(server.check_out(bid, server.CheckoutIn(payment_method="check", payment_status="paid"), user=ADMIN))
        _charge(b, 10.0)
        run(server.apply_tab_payment(cid, server.TabPaymentIn(amount=10.0, method="check"), user=ADMIN))
        _charge(a, 10.0)   # the older visit, charged after the newer one's charge was paid
        rows = {r["booking_id"]: r["amount"] for r in run(end_of_day.unpaid([_row(a), _row(b)]))}
        assert rows == {a: 10.0}


# ─────────────────────────────── second comparison ───────────────────────────────

def test_a_reopened_siblings_undone_charge_never_hides_anothers_charge():
    with _plain(), _daycare_service(40.0), _two_dog_family() as (a, lesson, cid):
        _prepaid_session({"booking_id": lesson})
        run(server.check_out(a, server.CheckoutIn(payment_method="check", payment_status="paid"), user=ADMIN))
        _charge(a, 10.0)
        run(server.check_out(lesson, server.CheckoutIn(payment_method="check", payment_status="paid"), user=ADMIN))
        _charge(lesson, 10.0)
        run(server.reopen_booking_checkout(lesson, server.BookingReopenCheckoutIn(reason="wrong lesson time"), user=ADMIN))
        assert run(end_of_day.owed([_row(a)])) == 10.0, "the reopen undid the lesson's charge, not Ace's"


def test_a_charge_taken_back_on_the_tab_never_hides_anothers_charge():
    from unittest.mock import AsyncMock, patch
    with _plain(), _daycare_service(40.0), _two_dog_family() as (a, b, cid):
        # B first (full price), paid in full at checkout through the tab (charge +
        # payment rows) — its bill step failed, so it has no bill
        with patch.object(server, "_create_invoice_for_bookings", new=AsyncMock(side_effect=RuntimeError("bill step failed"))):
            run(server.check_out(b, server.CheckoutIn(payment_method="check", payment_status="paid_partial",
                                                      amount_paid=40.0), user=ADMIN))
        run(server.check_out(a, server.CheckoutIn(payment_method="check", payment_status="paid"), user=ADMIN))
        _charge(a, 10.0)               # A's charge on the tab
        _charge(b, 10.0)               # then B's, newer
        _charge(b, 10.0, "discount")   # B's mistaken charge taken back, on the tab too
        client = run(server.db.clients.find_one({"id": cid}, {"_id": 0, "account_balance": 1}))
        assert round(float(client["account_balance"]), 2) == 10.0, "only A's charge is left on the tab"
        assert run(end_of_day.owed([_row(a)])) == 10.0
        assert run(end_of_day.owed([_row(a), _row(b)])) == 10.0


def test_a_charge_folded_into_a_bill_by_fix_bill_counts_once():
    from domains.billing import resolve
    with _plain(), _daycare_service(40.0), _two_dog_family() as (ace, old, cid):
        run(server.check_out(ace, server.CheckoutIn(payment_method="check", payment_status="paid"), user=ADMIN))
        _charge(ace, 10.0)                       # Ace's own charge on the tab
        run(server.check_out(old, server.CheckoutIn(payment_method="cash", payment_status="paid_partial", amount_paid=0), user=ADMIN))
        bill = run(server.db.invoices.find_one({"booking_ids": old}, {"_id": 0}))
        pay = run(server.create_invoice_payment(bill["id"], server.InvoicePaymentIn(
            amount=bill["balance"], method="check", idempotency_key=uuid.uuid4().hex), user=ADMIN))
        _charge(old, 15.0)                       # goes on the tab: the bill is paid
        pid = (pay.get("payment") or {}).get("id") or pay.get("payment_id") or pay.get("id")
        run(server.void_payment(pid, server.PaymentVoidIn(reason="bounced cheque", idempotency_key=uuid.uuid4().hex), user=ADMIN))
        fresh = run(server.db.invoices.find_one({"id": bill["id"]}, {"_id": 0}))
        run(resolve.fix_bill(bill["id"], resolve.BillFixIn(action="match", expected_balance=fresh["balance"]), ADMIN))
        matched = run(server.db.invoices.find_one({"id": bill["id"]}, {"_id": 0}))["balance"]
        assert matched == bill["balance"] + 15.0
        assert run(end_of_day.owed([_row(ace)])) == 10.0, "Old's $15 is inside its bill now, not general tab debt"
        assert run(end_of_day.owed([_row(old)])) == matched


# ─────────────────────────────── third comparison ───────────────────────────────

def _general_write_off(cid, amount):
    run(server.apply_tab_adjustment(cid, server.TabAdjustmentIn(
        amount=-amount, notes="reversed", idempotency_key=uuid.uuid4().hex), user=ADMIN))


def test_a_write_off_that_cancels_a_sale_on_account_never_hides_a_visits_charge():
    with _plain(), _daycare_service(40.0), _visit() as v:
        bid, cid = v["booking_id"], v["client_id"]
        run(server.check_out(bid, server.CheckoutIn(payment_method="check", payment_status="paid"), user=ADMIN))
        _charge(bid, 10.0)
        _sale_on_account(cid, 30.0)
        _general_write_off(cid, 30.0)   # the sale rung up by mistake, taken back
        assert run(end_of_day.owed([_row(bid)])) == 10.0


def test_a_write_off_that_reverses_another_dogs_charge_never_hides_this_ones():
    with _plain(), _daycare_service(40.0), _two_dog_family() as (a, b, cid):
        for bid in (a, b):
            run(server.check_out(bid, server.CheckoutIn(payment_method="check", payment_status="paid"), user=ADMIN))
        _charge(a, 10.0)
        _charge(b, 25.0)                # meant for another family
        _general_write_off(cid, 25.0)   # only the account screen can take it back once the bill is paid
        assert run(end_of_day.owed([_row(a)])) == 10.0


def test_a_bill_out_of_step_with_the_tab_never_brings_back_a_paid_charge():
    with _plain(), _daycare_service(40.0), _two_dog_family() as (vee, wes, cid):
        run(server.check_out(vee, server.CheckoutIn(payment_method="check", payment_status="paid"), user=ADMIN))
        _charge(vee, 10.0)
        run(server.apply_tab_payment(cid, server.TabPaymentIn(amount=10.0, method="check"), user=ADMIN))
        _charge(vee, 10.0)              # Vee owes this one only
        run(server.check_out(wes, server.CheckoutIn(payment_method="cash", payment_status="paid_partial", amount_paid=0), user=ADMIN))
        bill = run(server.db.invoices.find_one({"booking_ids": wes}, {"_id": 0}))
        pay = run(server.create_invoice_payment(bill["id"], server.InvoicePaymentIn(
            amount=bill["balance"], method="check", idempotency_key=uuid.uuid4().hex), user=ADMIN))
        _charge(wes, 5.0)
        pid = (pay.get("payment") or {}).get("id") or pay.get("payment_id") or pay.get("id")
        run(server.void_payment(pid, server.PaymentVoidIn(reason="bounced cheque", idempotency_key=uuid.uuid4().hex), user=ADMIN))
        assert run(tab_sync.client_bills_in_step(cid))[0] is False, "the bill needs Fix bill now"
        assert run(end_of_day.owed([_row(vee)])) == 10.0


def test_a_package_visit_on_a_group_bill_never_claims_its_siblings_share():
    cid, inv = str(uuid.uuid4()), str(uuid.uuid4())
    now = server.now_iso()
    ace = {"id": str(uuid.uuid4()), "client_id": cid, "status": "completed", "checked_out_at": now,
           "payment_method": "credits", "payment_status": "paid_partial", "actual_price": 40.0, "amount_paid": 0.0,
           "credit_value": 40.0, "balance_due": 3.0}
    bee = {"id": str(uuid.uuid4()), "client_id": cid, "status": "completed", "checked_out_at": now,
           "payment_method": "cash", "payment_status": "paid_partial", "actual_price": 20.0, "amount_paid": 0.0,
           "balance_due": 20.0}
    run(server.db.clients.insert_one({"id": cid, "name": TAG, "account_balance": 13.0}))
    run(server.db.invoices.insert_one({"id": inv, "client_id": cid, "booking_ids": [ace["id"], bee["id"]],
                                       "balance": 10.0, "status": "PARTIALLY_PAID", "created_at": now}))
    run(server.db.payment_ledger.insert_one({"id": str(uuid.uuid4()), "client_id": cid, "booking_id": ace["id"],
                                             "type": "charge", "amount": 3.0, "source": "correction",
                                             "created_at": server.now_iso()}))
    try:
        rows = {r["booking_id"]: r["amount"] for r in run(end_of_day.unpaid([ace, bee]))}
        assert rows == {ace["id"]: 3.0, bee["id"]: 10.0}
    finally:
        run(server.db.clients.delete_many({"id": cid}))
        run(server.db.invoices.delete_many({"id": inv}))
        run(server.db.payment_ledger.delete_many({"client_id": cid}))


# ─────────────────────────── weekly tile + P&L outstanding ───────────────────────────
# The Unpaid tile (weekly_summary) and the P&L "outstanding" line both read the
# stored payment_status, so a visit whose bill was paid later kept counting, and
# weekly_summary skipped paid_partial visits that P&L counted. Both now go by
# end_of_day.owed, the same rule as Today's amount due and Action Required.

def _week_of(day_iso):
    from datetime import date as _date
    return server._week_bounds(_date.fromisoformat(day_iso))


def _weekly_unpaid(day_iso):
    return run(server.weekly_summary(ADMIN, ref_date=day_iso))["unpaid_total"]


def _pl_unpaid(day_iso):
    mon, sun = _week_of(day_iso)
    return run(pl_report.build_pl_data(server.db, mon, sun))["income"]["unpaid_total"]


def test_bill_paid_later_leaves_weekly_summary_unpaid():
    with _plain(), _daycare_service(40.0), _visit() as v:
        bill, _ = _on_the_tab_then_paid(v)
        day = server.business_today().isoformat()
        before = _weekly_unpaid(day)
        _pay(bill)
        assert round(before - _weekly_unpaid(day), 2) == 40.0, "a paid bill must stop the visit counting as unpaid"


def test_bill_paid_later_leaves_pl_outstanding_and_agrees_with_weekly():
    with _plain(), _daycare_service(40.0), _visit() as v:
        bill, _ = _on_the_tab_then_paid(v)
        day = server.business_today().isoformat()
        pl_before = _pl_unpaid(day)
        assert round(_weekly_unpaid(day) - pl_before, 2) == 0.0, "weekly and P&L must agree before payment"
        _pay(bill)
        pl_after = _pl_unpaid(day)
        assert round(pl_before - pl_after, 2) == 40.0, "P&L outstanding must drop when the bill is paid"
        assert round(_weekly_unpaid(day) - pl_after, 2) == 0.0, "weekly and P&L must agree after payment"


def test_bill_payment_revenue_counted_once():
    with _plain(), _daycare_service(40.0), _visit() as v:
        bill, _ = _on_the_tab_then_paid(v)
        day = server.business_today().isoformat()
        mon, sun = _week_of(day)
        weekly_before = run(server.weekly_summary(ADMIN, ref_date=day))
        pl_before = run(pl_report.build_pl_data(server.db, mon, sun))["income"]
        _pay(bill)
        weekly_after = run(server.weekly_summary(ADMIN, ref_date=day))
        pl_after = run(pl_report.build_pl_data(server.db, mon, sun))["income"]
        # the bill payment is one retail row: +40 once in each report, never a second booking row
        assert round(weekly_after["completed_total"] - weekly_before["completed_total"], 2) == 40.0
        assert round(weekly_after["paid_total"] - weekly_before["paid_total"], 2) == 40.0
        assert round(pl_after["net_total"] - pl_before["net_total"], 2) == 40.0


# ───────── one Unpaid measure: the weekly tile and the P&L outstanding line ─────────
# Both read end_of_day.window_owed over the same service-date rows, so the two
# never drift. Account balances (client tabs) are NOT in either figure: they
# stay on the AR screen and are reported beside the tile, never added to it.

def _tiles(day_iso):
    return _weekly_unpaid(day_iso), _pl_unpaid(day_iso)


def test_an_unpaid_checkout_off_the_tab_counts_once_in_both_at_its_owed_amount():
    with _plain(), _daycare_service(40.0), _visit() as v:
        day = server.business_today().isoformat()
        before = _tiles(day)
        bid = v["booking_id"]
        # payment_status="unpaid" with NO amount_paid in the request: the visit
        # gets its own bill (an ordinary open invoice), but nothing is pushed
        # onto the client's account_balance/AR ledger (that only happens when
        # amount_paid is passed, even as 0 — Sprint 110di-51's tab intent).
        run(server.check_out(bid, server.CheckoutIn(payment_method="cash", payment_status="unpaid"), user=ADMIN))
        client = run(server.db.clients.find_one({"id": v["client_id"]}, {"_id": 0, "account_balance": 1}))
        assert (client or {}).get("account_balance", 0) == 0, "premise: not put on a tab (no AR)"
        weekly, pl = _tiles(day)
        assert round(weekly - before[0], 2) == 40.0, "the weekly Unpaid tile counts the visit once, at its owed amount"
        assert round(pl - before[1], 2) == 40.0, "P&L outstanding counts the visit once, at its owed amount"
        assert round(weekly - pl, 2) == 0.0


def test_a_bill_paid_later_drops_both_tiles_by_exactly_its_amount_and_they_agree():
    with _plain(), _daycare_service(40.0), _visit() as v:
        bill, _ = _on_the_tab_then_paid(v)
        day = server.business_today().isoformat()
        w0, p0 = _tiles(day)
        assert round(w0 - p0, 2) == 0.0
        _pay(bill)
        w1, p1 = _tiles(day)
        assert round(w0 - w1, 2) == 40.0
        assert round(p0 - p1, 2) == 40.0
        assert round(w1 - p1, 2) == 0.0


def test_a_visit_with_a_stored_due_and_no_bill_counts_in_both():
    from unittest.mock import AsyncMock, patch
    with _plain(), _daycare_service(40.0), _visit() as v:
        day = server.business_today().isoformat()
        before = _tiles(day)
        bid = v["booking_id"]
        with patch.object(server, "_create_invoice_for_bookings", new=AsyncMock(side_effect=RuntimeError("bill step failed"))):
            run(server.check_out(bid, server.CheckoutIn(payment_method="cash", payment_status="unpaid"), user=ADMIN))
        assert run(server.db.invoices.find_one({"booking_ids": bid})) is None, "premise: no bill"
        assert _row(bid)["balance_due"] == 40.0, "premise: the visit stores its own due"
        client = run(server.db.clients.find_one({"id": v["client_id"]}, {"_id": 0, "account_balance": 1}))
        assert (client or {}).get("account_balance", 0) == 0, "premise: not on the tab either"
        weekly, pl = _tiles(day)
        assert round(weekly - before[0], 2) == 40.0, "a visit with a stored due and no bill still counts in the weekly tile"
        assert round(pl - before[1], 2) == 40.0, "and in P&L outstanding"


def test_an_account_balance_with_no_visit_changes_neither_tile():
    cid = str(uuid.uuid4())
    day = server.business_today().isoformat()
    before = _tiles(day)
    ar_before = run(server.weekly_summary(ADMIN, ref_date=day))["ar_outstanding_total"]
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} tab only", "email": f"{cid}@example.com",
                                      "account_balance": 25.0, "created_at": server.now_iso()}))
    try:
        after = _tiles(day)
        ar_after = run(server.weekly_summary(ADMIN, ref_date=day))["ar_outstanding_total"]
        assert round(after[0] - before[0], 2) == 0.0, "a client tab alone is not in the Unpaid tile"
        assert round(after[1] - before[1], 2) == 0.0, "a client tab alone is not in P&L outstanding"
        assert round(ar_after - ar_before, 2) == 25.0, "the tab is still reported as account receivable beside the tile"
    finally:
        run(server.db.clients.delete_many({"id": cid}))
