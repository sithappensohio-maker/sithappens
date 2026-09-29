"""A visit paid with credits the owner added by hand, or earned as a reward,
records no money taken (owner-approved fix, 2026-09-29).

Those credits are $0-value lots (no sale backs them). Money taken on a
credits visit used to be price − the credits' dollar value, so a $40 day on
such a credit was recorded as $40 collected: cash revenue, a completed
"other" payment nobody made, the register day required. A credit pays for
the visit whatever its dollar value; only what sits on top of it is money
taken. Paid packs behave exactly as before.

Self-contained fixtures (never import another test module).
"""
import contextlib
import uuid
from datetime import datetime, timedelta, timezone

import pytest

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run
from domains.bookings import credit_cover

TAG = "TEST_ZERO_CREDIT"
OWNER = {"id": "zc-owner", "role": "admin", "name": "Pat Owner", "display_name": "Pat Owner"}
VAX = {"rabies": "2030-01-01", "dhpp": "2030-01-01", "bordetella": "2030-01-01"}


def _day():
    return server.business_today().isoformat()


@contextlib.contextmanager
def _daycare(price=40.0):
    sid = f"{TAG}-daycare-{uuid.uuid4().hex[:6]}"
    run(server.db.services.insert_one({"id": sid, "name": f"{TAG} Daycare", "service_type": "daycare",
                                       "base_price": price, "active": True, "is_default": True}))
    try:
        yield sid
    finally:
        run(server.db.services.delete_one({"id": sid}))


@contextlib.contextmanager
def _family(dogs=1):
    cid = str(uuid.uuid4())
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} family", "email": f"{uuid.uuid4().hex[:8]}@example.com",
                                      "client_status": "active", "account_balance": 0.0, "credits": 0}))
    ids = [str(uuid.uuid4()) for _ in range(dogs)]
    for i, did in enumerate(ids):
        run(server.db.dogs.insert_one({"id": did, "name": f"{TAG} dog {i}", "owner_id": cid, "breed": "Mix", "age_y": 3,
                                       "vaccines": dict(VAX)}))
    try:
        yield cid, ids
    finally:
        for coll in ("bookings", "invoices", "payments", "payment_ledger", "credit_lots", "checkout_groups", "retail_sales"):
            run(server.db[coll].delete_many({"client_id": cid}))
        run(server.db.bookings.delete_many({"dog_id": {"$in": ids}}))
        run(server.db.dogs.delete_many({"id": {"$in": ids}}))
        run(server.db.clients.delete_one({"id": cid}))


def _grant(cid, qty=1, source="manual"):
    """Credits added by hand (or a reward): a $0-value lot."""
    run(server._mutate_client_credits(cid, "daycare", qty, source=source, reason=f"{TAG} {source}"))


def _paid_pack(cid, value_each, qty=1):
    """Credits from a paid pack: a lot worth what was paid per credit."""
    run(server.db.credit_lots.insert_one({
        "id": str(uuid.uuid4()), "client_id": cid, "pack_id": None, "pack_name": f"{TAG} pack", "service_type": "daycare",
        "qty_total": qty, "qty_remaining": qty, "price_paid": value_each * qty, "list_price": value_each * qty,
        "value_each": value_each, "payment_method": "card", "purchased_at": server.now_iso(), "recognize_at_sale": True}))
    run(server.db.clients.update_one({"id": cid}, {"$inc": {"credits": qty}}))


def _visit(svc, dog_id):
    made = run(server.create_booking(server.BookingIn(dog_id=dog_id, date=_day(), service_type="daycare", service_id=svc,
                                                      override_capacity=True, override_vaccines=True), OWNER))
    run(server.check_in(made["id"], server.CheckInIn(vaccine_ack=True), OWNER))
    ts = (datetime.now(timezone.utc) - timedelta(hours=8)).isoformat()
    run(server.db.bookings.update_one({"id": made["id"]}, {"$set": {"checked_in_at": ts}}))
    return made["id"]


@contextlib.contextmanager
def _register_closed():
    """Today's register day has been closed out."""
    cid = str(uuid.uuid4())
    run(server.db.daily_closeouts.insert_one({"id": cid, "date": _day(), "created_at": server.now_iso(), "notes": TAG}))
    try:
        yield
    finally:
        run(server.db.daily_closeouts.delete_one({"id": cid}))


@contextlib.contextmanager
def _register_open():
    marker = f"{TAG}-{uuid.uuid4()}"
    before = run(server.db.cash_drawer_sessions.find_one_and_update(
        {"date": _day()}, {"$setOnInsert": {"date": _day(), "opening_cash": 0.0, "opened_at": server.now_iso(),
                                            "opened_by": marker, "opened_by_name": TAG, "notes": TAG}},
        upsert=True, projection={"_id": 0}))
    try:
        yield
    finally:
        if before is None:
            run(server.db.cash_drawer_sessions.delete_one({"date": _day(), "opened_by": marker}))


def _row(bid):
    return run(server.db.bookings.find_one({"id": bid}, {"_id": 0}))


def _bill(bid):
    return run(server.db.invoices.find_one({"booking_ids": bid, "status": {"$ne": "VOID"}}, {"_id": 0}))


def _payments(invoice_id):
    return run(server.db.payments.find({"invoice_id": invoice_id}, {"_id": 0}).to_list(20))


def _checkout(bid, **body):
    return run(server.check_out(bid, server.CheckoutIn(use_credits=True, **body), OWNER))


# ------------------------------------------------------------ the reported bug

@pytest.mark.parametrize("source", ["manual", "referral"])
def test_a_visit_paid_with_hand_added_or_reward_credits_records_no_money_taken(source):
    with _daycare() as svc, _family() as (cid, dogs):
        _grant(cid, source=source)
        bid = _visit(svc, dogs[0])
        _checkout(bid)
        row = _row(bid)
        assert row["status"] == "completed" and row["payment_method"] == "credits" and row["credits_deducted"] == 1
        assert row["actual_price"] == 40.0 and row[credit_cover.COVERED_FIELD] == 40.0
        assert float(row.get("amount_paid") or 0) == 0.0 and float(row.get("balance_due") or 0) == 0.0
        assert not row.get("cash_payment_method")
        assert server._cash_revenue(row) == 0.0
        assert run(server.db.clients.find_one({"id": cid}))["credits"] == 0
        bill = _bill(bid)
        assert bill["credit_applied"] == 40.0 and float(bill["amount_paid"]) == 0.0 and float(bill["balance"]) == 0.0
        rows = _payments(bill["id"])
        assert [(p["method"], p["amount"]) for p in rows] == [("credits", 40.0)], "no money row nobody paid"


def test_a_closed_register_day_never_stops_a_checkout_paid_all_in_credits():
    with _daycare() as svc, _family() as (cid, dogs), _register_closed():
        _grant(cid)
        bid = _visit(svc, dogs[0])
        _checkout(bid)
        assert _row(bid)["status"] == "completed"


def test_what_sits_on_top_of_the_credits_is_still_money_taken():
    """A $10 add-on booked with the visit: the credits cover the day, the
    add-on is paid today — and counted once (it was counted twice before)."""
    with _daycare() as svc, _family() as (cid, dogs), _register_open():
        _grant(cid)
        bid = _visit(svc, dogs[0])
        run(server.db.bookings.update_one({"id": bid}, {"$set": {
            "estimated_price": 50.0,
            "add_ons": [{"service_id": "x-bath", "name": "Bath", "price": 10.0, "qty": 1, "line_total": 10.0, "added_stage": "booking"}]}}))
        _checkout(bid, payment_method="cash", payment_status="paid")   # (what the screen sends when money is due)
        row = _row(bid)
        assert row["actual_price"] == 50.0 and row[credit_cover.COVERED_FIELD] == 40.0
        assert row["amount_paid"] == 10.0 and row["cash_payment_method"] == "cash"
        assert server._cash_revenue(row) == 10.0
        bill = _bill(bid)
        assert bill["total"] == 50.0 and bill["credit_applied"] == 40.0 and bill["amount_paid"] == 10.0


def test_a_paid_pack_credit_covers_the_whole_day_as_before():
    """A $35 credit from a $350 ten-pack covers a $40 day: the $5 is never charged."""
    with _daycare() as svc, _family() as (cid, dogs):
        _paid_pack(cid, 35.0)
        bid = _visit(svc, dogs[0])
        _checkout(bid)
        row = _row(bid)
        assert row["actual_price"] == 35.0 and row["credit_value"] == 35.0
        assert float(row.get("amount_paid") or 0) == 0.0 and server._cash_revenue(row) == 0.0


def test_a_family_leaving_together_on_hand_added_credits_pays_only_the_extra():
    with _daycare() as svc, _family(dogs=2) as (cid, dogs), _register_open():
        _grant(cid, qty=2)
        ids = [_visit(svc, d) for d in dogs]
        bath = [server.CheckoutAddOn(service_id="x-bath", name="Bath", price=10.0)]
        run(server.check_out_group(ids[0], server.CheckoutIn(use_credits=True, payment_method="cash", payment_status="paid",
                                                               add_ons=bath), OWNER))
        taken = {b: float(_row(b).get("amount_paid") or 0) for b in ids}
        assert taken == {ids[0]: 10.0, ids[1]: 0.0}
        assert sum(server._cash_revenue(_row(b)) for b in ids) == 10.0


# ------------------------------------------------------------ the rule itself

def test_older_rows_read_exactly_as_before():
    old = {"payment_method": "credits", "actual_price": 50.0, "credit_value": 40.0, "amount_paid": 0.0}
    assert credit_cover.covered_value(old) == 40.0 and server._cash_revenue(old) == 10.0


def test_a_typed_price_above_the_credit_is_money_due_and_below_it_is_not():
    assert credit_cover.priced(50.0, 40.0, True, 40.0) == {"actual_price": 50.0, credit_cover.COVERED_FIELD: 40.0}
    assert credit_cover.priced(30.0, 40.0, True, 40.0) == {"actual_price": 30.0, credit_cover.COVERED_FIELD: 30.0}
    # a $0-value credit covers the visit's normal value; the typed price above it is due
    assert credit_cover.priced(50.0, 0.0, True, 40.0) == {"actual_price": 50.0, credit_cover.COVERED_FIELD: 40.0}
    assert credit_cover.priced(40.0, 0.0, False, 40.0) == {"actual_price": 40.0, credit_cover.COVERED_FIELD: 40.0}


def test_the_visit_value_on_a_zero_value_credit_never_counts_booked_add_ons_twice():
    assert credit_cover.zero_lot_base({"estimated_price": 50.0}, 10.0) == 40.0
    assert credit_cover.zero_lot_base({"estimated_price": 5.0}, 10.0) == 0.0
    assert credit_cover.zero_lot_base({}, 0) == 0.0
