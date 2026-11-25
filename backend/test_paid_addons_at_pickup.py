"""Add-ons paid online are not charged again at pickup — proved through the
REAL staff checkout (server.check_out), for a visit paid in dollars and for a
visit paid by a credit. Setup borrowed from test_checkin_addon_not_off_base.py.

The trap this pins: a booking's `estimated_price` includes the add-ons booked
with it, and checkout prices the visit as "estimate minus booked add-ons". If
a paid add-on merely dropped to $0, the visit's own price would swallow it and
the customer would pay for the bath twice.
"""
import uuid
from datetime import datetime, timedelta, timezone

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from _test_loop import run
from test_late_day_checkout import ADMIN  # noqa: F401 — shared helper

from domains.shop import booking_addons

TAG = "TEST_PAID_ADDON_PICKUP"
DAYCARE = 40.0
BATH = 15.0
NAILS = 8.0


@pytest.fixture(autouse=True)
def _register_open():
    day = server.business_today().isoformat()
    run(server.db.cash_drawer_sessions.find_one_and_update(
        {"date": day},
        {"$setOnInsert": {"date": day, "opening_cash": 100.0, "opened_at": server.now_iso(),
                          "opened_by": TAG, "opened_by_name": TAG, "notes": TAG}},
        upsert=True, projection={"_id": 0}))
    yield
    run(server.db.cash_drawer_sessions.delete_many({"notes": TAG}))


@pytest.fixture()
def visit():
    parked = run(server.db.services.find({"service_type": "daycare", "is_default": True}, {"_id": 0, "id": 1}).to_list(500))
    run(server.db.services.update_many({"service_type": "daycare"}, {"$set": {"is_default": False}}))
    day_svc, bath_svc, nail_svc = (f"{TAG}-{n}-{uuid.uuid4().hex[:6]}" for n in ("daycare", "bath", "nails"))
    run(server.db.services.insert_many([
        {"id": day_svc, "name": f"{TAG} daycare", "service_type": "daycare", "base_price": DAYCARE, "active": True, "is_default": True},
        {"id": bath_svc, "name": "Bath", "service_type": "grooming", "base_price": BATH, "active": True, "is_addon": True, "addon_for": ["daycare"]},
        {"id": nail_svc, "name": "Nail trim", "service_type": "grooming", "base_price": NAILS, "active": True, "is_addon": True, "addon_for": ["daycare"]},
    ]))
    cid, did, bid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} owner", "email": f"{cid}@example.com",
                                      "credits": 0, "boarding_credits": 0, "account_balance": 0.0}))
    run(server.db.dogs.insert_one({"id": did, "owner_id": cid, "name": "Rex", "vaccines": {"rabies": "2099-01-01"}}))
    today = server.business_today().isoformat()
    bath = {"service_id": bath_svc, "name": "Bath", "icon": "fa-bath", "price": BATH, "list_price": BATH,
            "price_override_id": None, "qty": 1, "added_at": server.now_iso()}
    # Booked WITH the bath: the estimate holds it, exactly as create_booking writes it.
    run(server.db.bookings.insert_one({
        "id": bid, "client_id": cid, "client_name": f"{TAG} owner", "dog_id": did, "dog_name": "Rex",
        "service_type": "daycare", "service_id": day_svc, "date": today, "end_date": today, "status": "approved",
        "estimated_price": DAYCARE + BATH, "unit_price": DAYCARE, "pricing_snapshot": {"unit_price": DAYCARE},
        "credit_units_required": 1,
        "checked_in_at": (datetime.now(timezone.utc) - timedelta(hours=8)).isoformat(), "checked_in_by": "test", "checked_out_at": None,
        "created_at": server.now_iso(), "add_ons": [bath]}))
    yield {"cid": cid, "bid": bid, "nails": nail_svc}
    run(server.db.bookings.delete_many({"id": bid}))
    run(server.db.services.delete_many({"id": {"$in": [day_svc, bath_svc, nail_svc]}}))
    run(server.db.clients.delete_many({"id": cid}))
    run(server.db.dogs.delete_many({"owner_id": cid}))
    for coll in ("payments", "payment_ledger", "credit_lots", "invoices"):
        run(server.db[coll].delete_many({"client_id": cid}))
    for row in parked:
        run(server.db.services.update_one({"id": row["id"]}, {"$set": {"is_default": True}}))


def _pay_online(visit):
    """What the card payment landing does (the Shop's own path is test_shop_booking_addons.py)."""
    order = {"id": f"order-{uuid.uuid4().hex[:8]}", "client_id": visit["cid"]}
    booking = run(server.db.bookings.find_one({"id": visit["bid"]}, {"_id": 0}))
    plan = [{"booking_id": visit["bid"], "service_id": a["service_id"], "name": a["name"], "amount": booking_addons._addon_amount(a)}
            for a in booking_addons.unpaid_addons(booking)]
    line = {"item_id": "line-1", "kind": "booking_addons", "addon_plan": plan}
    run(booking_addons.fulfill_line(order, line))
    return order, line


def test_unpaid_addon_is_charged_at_pickup_as_before(visit):
    out = run(server.check_out(visit["bid"], server.CheckoutIn(use_credits=False, payment_method="cash", payment_status="paid"), ADMIN))
    assert out["actual_price"] == DAYCARE + BATH


def test_dollar_visit_with_the_bath_paid_online_collects_only_the_visit(visit):
    _pay_online(visit)
    out = run(server.check_out(visit["bid"], server.CheckoutIn(use_credits=False, payment_method="cash", payment_status="paid"), ADMIN))
    assert out["actual_price"] == DAYCARE, "the $40 visit only — the $15 bath was paid online"
    assert out["amount_paid"] == DAYCARE and out["cash_revenue"] == DAYCARE
    assert [a["name"] for a in out["add_ons"]] == ["Bath (paid online)"]


def test_credit_visit_with_the_bath_paid_online_collects_nothing(visit):
    run(server.db.clients.update_one({"id": visit["cid"]}, {"$set": {"credits": 1}}))
    run(server.db.credit_lots.insert_one({
        "id": str(uuid.uuid4()), "client_id": visit["cid"], "service_type": "daycare", "qty_total": 1, "qty_remaining": 1,
        "price_paid": DAYCARE, "value_each": DAYCARE, "purchased_at": server.now_iso(), "pack_name": TAG}))
    _pay_online(visit)
    out = run(server.check_out(visit["bid"], server.CheckoutIn(use_credits=True), ADMIN))
    assert out["payment_method"] == "credits"
    assert float(out.get("amount_paid") or 0) == 0 and float(out.get("cash_revenue") or 0) == 0, "nothing to collect at the desk"
    assert run(server.db.clients.find_one({"id": visit["cid"]}, {"_id": 0}))["credits"] == 0


def test_an_addon_added_at_the_desk_is_still_charged_on_top(visit):
    _pay_online(visit)
    run(server.attach_booking_addons(visit["bid"], server.BookingAddonsIn(addon_service_ids=[visit["nails"]]),
                                     {"id": "admin", "role": "admin", "name": "QA"}))
    out = run(server.check_out(visit["bid"], server.CheckoutIn(use_credits=False, payment_method="cash", payment_status="paid"), ADMIN))
    assert out["actual_price"] == DAYCARE + NAILS, "the visit plus the nail trim; the paid bath adds nothing"


def test_refunding_the_online_payment_makes_pickup_charge_the_bath_again(visit):
    order, line = _pay_online(visit)
    run(booking_addons.revoke_line(order, line, "refund-1"))
    out = run(server.check_out(visit["bid"], server.CheckoutIn(use_credits=False, payment_method="cash", payment_status="paid"), ADMIN))
    assert out["actual_price"] == DAYCARE + BATH
