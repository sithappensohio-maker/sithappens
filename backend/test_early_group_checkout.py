"""A household that leaves early together: every dog leaving early gets its early price.

Two dogs boarded together (one group, one client, same stay) leave on the same
day, two nights into a five-night stay. When the screen charges the early price
for the dog whose button was pressed, each other dog in the group that is
leaving early is charged its own early price too, as a single dog would be. A
group checkout that charges the full booked stay keeps every dog on its booked
price.
"""
import contextlib
import uuid
from datetime import timedelta

import pytest

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_EARLY_GROUP"
ADMIN = {"id": "early-group-admin", "name": "Group QA", "display_name": "Group QA",
         "email": "eg@test", "role": "admin"}

_PEAK_SETTINGS = {"day_to_day.seasonal.holiday_surcharges": [],
                  "day_to_day.seasonal.peak_season_ranges": [],
                  "day_to_day.money.late_pickup_fee_per_15min": 0,
                  "booking_rules.stay_pricing_enabled": False}


@pytest.fixture(autouse=True)
def _open_register(monkeypatch):
    async def _open(_date):
        return None
    monkeypatch.setattr(server, "_require_register_day_open", _open)


def _et(day_iso, hhmm):
    from datetime import datetime, timezone
    return (datetime.fromisoformat(f"{day_iso}T{hhmm}:00")
            .replace(tzinfo=server.BUSINESS_TZ).astimezone(timezone.utc).isoformat())


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


@contextlib.contextmanager
def _two_dogs_boarded_five_nights_checked_in_two_nights_ago(unit=50.0):
    """Two dogs, one household, one group: five nights booked, both checked in two nights ago."""
    cid, gid = str(uuid.uuid4()), str(uuid.uuid4())
    dogs = [str(uuid.uuid4()), str(uuid.uuid4())]
    bids = [str(uuid.uuid4()), str(uuid.uuid4())]
    today = server.business_today()
    start, end = (today - timedelta(days=2)).isoformat(), (today + timedelta(days=3)).isoformat()
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} household", "email": f"{cid}@example.com",
                                      "credits": 0, "boarding_credits": 0, "account_balance": 0.0}))
    for did, name in zip(dogs, ("Moss", "Pip")):
        run(server.db.dogs.insert_one({"id": did, "owner_id": cid, "name": name, "vaccines": {"rabies": "2099-01-01"}}))
    for bid, did, name in zip(bids, dogs, ("Moss", "Pip")):
        run(server.db.bookings.insert_one({
            "id": bid, "client_id": cid, "client_name": f"{TAG} household", "dog_id": did, "dog_name": name,
            "service_type": "boarding", "date": start, "end_date": end, "status": "approved",
            "group_id": gid, "dropoff_time": "08:00", "pickup_time": "09:00", "time": "",
            "estimated_price": unit * 5, "unit_price": unit, "pricing_snapshot": {"unit_price": unit},
            "credit_units_required": 5, "checked_in_at": _et(start, "08:00"), "checked_in_by": "test",
            "checked_out_at": None, "created_at": server.now_iso()}))
    try:
        yield bids
    finally:
        async def go():
            for c in ("bookings", "invoices", "payments", "payment_ledger", "booking_financial_events", "checkout_groups"):
                await server.db[c].delete_many({"client_id": cid})
            await server.db.booking_financial_events.delete_many({"booking_id": {"$in": bids}})
            await server.db.dogs.delete_many({"owner_id": cid})
            await server.db.clients.delete_many({"id": cid})
        run(go())


def _row(bid):
    return run(server.db.bookings.find_one({"id": bid}, {"_id": 0}))


def test_every_dog_leaving_early_with_the_early_price_is_charged_its_own_early_price():
    with _settings(**_PEAK_SETTINGS), _boarding_service(50.0), _two_dogs_boarded_five_nights_checked_in_two_nights_ago(50.0) as (a, b):
        qa = run(server.early_checkout_quote(a, ADMIN))
        qb = run(server.early_checkout_quote(b, ADMIN))
        assert qa["applicable"] is True and qb["applicable"] is True
        run(server.check_out_group(a, server.CheckoutIn(payment_method="card", payment_status="paid",
                                                        base_price=round(float(qa["base_price"]), 2)), user=ADMIN))
        row_a, row_b = _row(a), _row(b)
        assert row_a.get("checked_out_at") and row_b.get("checked_out_at"), "both dogs should leave together"
        # Whichever dog the group loop checks out second takes the additional-dog discount
        # off its early price (the discount is taken from the price it is based on), so
        # each dog's charge plus its discount is its own early price, in either order.
        for row, quote in ((row_a, qa), (row_b, qb)):
            disc = row.get("multi_dog_discount") or {}
            assert round(float(disc.get("based_on_price") or row["actual_price"]), 2) == round(float(quote["base_price"]), 2), \
                f"{row['dog_name']} was priced from the booked five nights, not its early price"
            assert round(row["actual_price"] + float(disc.get("amount") or 0), 2) == round(float(quote["base_price"]), 2), \
                f"{row['dog_name']} was charged the booked five nights, not its early price"


def test_a_group_that_charges_the_full_booked_stay_keeps_every_dog_on_its_booked_price():
    with _settings(**_PEAK_SETTINGS), _boarding_service(50.0), _two_dogs_boarded_five_nights_checked_in_two_nights_ago(50.0) as (a, b):
        qb = run(server.early_checkout_quote(b, ADMIN))
        assert qb["applicable"] is True
        run(server.check_out_group(a, server.CheckoutIn(payment_method="card", payment_status="paid"), user=ADMIN))
        row_b = _row(b)
        assert row_b["actual_price"] > round(float(qb["base_price"]), 2), \
            "a full-stay group checkout charged the second dog the early price"


def test_the_group_preview_shows_each_dog_its_early_price_beside_the_booked_one():
    with _settings(**_PEAK_SETTINGS), _boarding_service(50.0), _two_dogs_boarded_five_nights_checked_in_two_nights_ago(50.0) as (a, b):
        qb = run(server.early_checkout_quote(b, ADMIN))
        preview = run(server.checkout_group_preview(a, ADMIN))
        row_b = next(r for r in preview["bookings"] if r["id"] == b)
        assert row_b["early_checkout_total"] is not None
        assert row_b["early_checkout_total"] <= round(float(qb["base_price"]), 2) + 0.005
        assert row_b["early_checkout_total"] < row_b["checkout_preview_total"]
