"""A boarding stay paid with credits and picked up after the cutoff owes the
late-pickup daycare day in cash (audit #3: "Boarding paid with credits and a pickup
after 5 PM: screen says $0, app quietly bills the late-pickup daycare day as
unpaid"). Checkout must ask how the fee is paid BEFORE it takes any credit: with no
payment method it refuses and the credits stay where they were; with one, the stay
is paid from credits and the fee is taken in that method. Disposable tag
TEST_BOARD_CREDIT_FEE."""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from fastapi import HTTPException
from _test_loop import run
import contextlib

from test_late_day_checkout import ADMIN, _days_ago, _et

TAG = "TEST_BOARD_CREDIT_FEE"


@contextlib.contextmanager
def _services():
    """The default daycare service is set up by the autouse fixture below, not here."""
    yield {}


@pytest.fixture(autouse=True)
def _daycare_default():
    """The late fee is a daycare day at the default daycare price. Another file can
    leave a different default behind, so park the others and set this test's own at $40."""
    parked = run(server.db.services.find({"service_type": "daycare", "is_default": True}, {"_id": 0, "id": 1}).to_list(500))
    run(server.db.services.update_many({"service_type": "daycare"}, {"$set": {"is_default": False}}))
    sid = f"{TAG}-daycare-{uuid.uuid4().hex[:6]}"
    run(server.db.services.insert_one({"id": sid, "name": f"{TAG} daycare", "service_type": "daycare",
                                       "base_price": 40.0, "active": True, "is_default": True}))
    yield
    run(server.db.services.delete_many({"id": sid}))
    for row in parked:
        run(server.db.services.update_one({"id": row["id"]}, {"$set": {"is_default": True}}))


@pytest.fixture(autouse=True)
def _late_pickup_policy():
    """Pin the late-pickup policy this test depends on (the full daycare day, no grace, 5 PM cutoff),
    and put back whatever was saved, so another file's settings can't zero the fee."""
    prev = run(server.db.settings.find_one({"id": "global"}, {"_id": 0, "booking_rules": 1})) or {}
    rules = dict(prev.get("booking_rules") or {})
    rules.update({"boarding_late_pickup_mode": "full_daycare_day", "boarding_late_pickup_grace_minutes": 0,
                  "boarding_full_day_pickup_cutoff": "17:00"})
    run(server.db.settings.update_one({"id": "global"}, {"$set": {"booking_rules": rules}}, upsert=True))
    yield
    if "booking_rules" in prev:
        run(server.db.settings.update_one({"id": "global"}, {"$set": {"booking_rules": prev["booking_rules"]}}))
    else:
        run(server.db.settings.update_one({"id": "global"}, {"$unset": {"booking_rules": ""}}))


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


def _stay_on_credits(svc, *, credits=4):
    cid = str(uuid.uuid4())
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} owner", "email": f"{cid}@example.com",
                                      "credits": 0, "boarding_credits": credits, "account_balance": 0.0}))
    run(server.db.credit_lots.insert_one({
        "id": str(uuid.uuid4()), "client_id": cid, "service_type": "boarding", "pack_name": f"{TAG} pack",
        "qty_total": credits, "qty_remaining": credits, "value_each": 50.0, "recognize_at_sale": True,
        "purchased_at": server.now_iso()}))
    did, bid = str(uuid.uuid4()), str(uuid.uuid4())
    run(server.db.dogs.insert_one({"id": did, "owner_id": cid, "name": f"{TAG} dog", "vaccines": {"rabies": "2099-01-01"}}))
    run(server.db.bookings.insert_one({
        "id": bid, "client_id": cid, "client_name": f"{TAG} owner", "dog_id": did, "dog_name": f"{TAG} dog",
        "service_type": "boarding", "date": _days_ago(2), "end_date": _days_ago(0), "status": "approved",
        "pickup_time": "19:00", "estimated_price": 100.0, "unit_price": 50.0,
        "pricing_snapshot": {"unit_price": 50.0}, "checked_in_at": _et(_days_ago(2), "10:00"),
        "checked_in_by": "test", "checked_out_at": None, "created_at": server.now_iso()}))
    return cid, bid


def _cleanup(cid, bid):
    run(server.db.bookings.delete_many({"id": bid}))
    run(server.db.credit_lots.delete_many({"client_id": cid}))
    run(server.db.clients.delete_many({"id": cid}))
    run(server.db.dogs.delete_many({"owner_id": cid}))
    run(server.db.payments.delete_many({"client_id": cid}))
    run(server.db.payment_ledger.delete_many({"client_id": cid}))


def test_the_fee_is_asked_for_before_any_credit_is_taken():
    with _services() as svc:
        cid, bid = _stay_on_credits(svc)
        try:
            with pytest.raises(HTTPException) as err:
                run(server.check_out(bid, server.CheckoutIn(use_credits=True, payment_method=None,
                                                             payment_status="paid"), ADMIN))
            assert err.value.status_code == 400
            assert "late-pickup fee" in err.value.detail
            client = run(server.db.clients.find_one({"id": cid}, {"_id": 0}))
            assert client["boarding_credits"] == 4, "no credit was taken"
            lot = run(server.db.credit_lots.find_one({"client_id": cid}, {"_id": 0}))
            assert lot["qty_remaining"] == 4
            assert run(server.db.bookings.find_one({"id": bid}, {"_id": 0}))["status"] == "approved"
        finally:
            _cleanup(cid, bid)


def test_with_a_payment_method_the_stay_is_paid_from_credits_and_the_fee_in_cash():
    with _services() as svc:
        cid, bid = _stay_on_credits(svc)
        try:
            out = run(server.check_out(bid, server.CheckoutIn(use_credits=True, payment_method="cash",
                                                               payment_status="paid"), ADMIN))
            assert out["status"] == "completed"
            assert out["actual_price"] > 0, "the late-pickup fee is charged"
            client = run(server.db.clients.find_one({"id": cid}, {"_id": 0}))
            assert client["boarding_credits"] < 4, "the nights came off the credits"
        finally:
            _cleanup(cid, bid)


def test_the_screen_is_told_the_fee_is_cash_due_even_on_credits():
    with _services() as svc:
        cid, bid = _stay_on_credits(svc)
        try:
            out = run(server.discount_preview(bid, ADMIN))
            assert out["late_pickup_fee_cash"] > 0, "the fee is shown as cash due, not as covered by credits"
        finally:
            _cleanup(cid, bid)
