"""An add-on added at check-in or later is charged on top of the daycare visit, and
does not come off the visit's price (audit #77: "Extras added at check-in may come off
a daycare visit's price at checkout"). The booked estimate does not include it, so
checkout must take only the booked add-ons off the estimate. Disposable tag
TEST_ADDON_BASE."""
import uuid
from datetime import datetime, timedelta, timezone

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from _test_loop import run
from test_late_day_checkout import ADMIN, _days_ago, _et  # noqa: F401 — shared helpers

TAG = "TEST_ADDON_BASE"
DAYCARE = 40.0
BATH = 15.0


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
    day_svc = f"{TAG}-daycare-{uuid.uuid4().hex[:6]}"
    bath_svc = f"{TAG}-bath-{uuid.uuid4().hex[:6]}"
    run(server.db.services.insert_many([
        {"id": day_svc, "name": f"{TAG} daycare", "service_type": "daycare", "base_price": DAYCARE,
         "active": True, "is_default": True},
        {"id": bath_svc, "name": f"{TAG} bath", "service_type": "grooming", "base_price": BATH,
         "active": True, "is_addon": True, "addon_for": ["daycare"]},
    ]))
    cid, did, bid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} owner", "email": f"{cid}@example.com",
                                      "credits": 0, "boarding_credits": 0, "account_balance": 0.0}))
    run(server.db.dogs.insert_one({"id": did, "owner_id": cid, "name": f"{TAG} dog", "vaccines": {"rabies": "2099-01-01"}}))
    today = server.business_today().isoformat()
    run(server.db.bookings.insert_one({
        "id": bid, "client_id": cid, "client_name": f"{TAG} owner", "dog_id": did, "dog_name": f"{TAG} dog",
        "service_type": "daycare", "service_id": day_svc, "date": today, "end_date": today, "status": "approved",
        "estimated_price": DAYCARE, "unit_price": DAYCARE, "pricing_snapshot": {"unit_price": DAYCARE},
        "checked_in_at": (datetime.now(timezone.utc) - timedelta(hours=8)).isoformat(), "checked_in_by": "test", "checked_out_at": None,
        "created_at": server.now_iso(), "add_ons": []}))
    yield {"cid": cid, "bid": bid, "bath": bath_svc}
    run(server.db.bookings.delete_many({"id": bid}))
    run(server.db.services.delete_many({"id": {"$in": [day_svc, bath_svc]}}))
    run(server.db.clients.delete_many({"id": cid}))
    run(server.db.dogs.delete_many({"owner_id": cid}))
    run(server.db.payments.delete_many({"client_id": cid}))
    run(server.db.payment_ledger.delete_many({"client_id": cid}))
    for row in parked:
        run(server.db.services.update_one({"id": row["id"]}, {"$set": {"is_default": True}}))


def test_an_add_on_booked_at_check_in_is_charged_on_top_not_off_the_visit(visit):
    run(server.attach_booking_addons(visit["bid"], server.BookingAddonsIn(addon_service_ids=[visit["bath"]]),
                                     {"id": "admin", "role": "admin", "name": "QA"}))
    out = run(server.check_out(visit["bid"], server.CheckoutIn(use_credits=False, payment_method="cash",
                                                                payment_status="paid"), ADMIN))
    assert out["actual_price"] == DAYCARE + BATH, "the visit at $40 plus the $15 bath, not $40 with the bath inside it"
