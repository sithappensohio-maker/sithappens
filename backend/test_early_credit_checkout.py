"""A boarding dog paid with credits that leaves early is charged credits for the nights it stayed.

A dog booked for five nights, checked in two nights ago, leaves today. The client
pays from boarding credits. When the screen sends early_checkout_credit (the early
price is in use), checkout takes only the two nights stayed, so the rest of the
client's credit stays on their balance (nothing was taken for the booked span). A
full-stay credit checkout, and a flagged checkout whose stay is not early, keep
taking the booked span as before.
"""
import contextlib
import uuid
from datetime import datetime, timedelta, timezone

import pytest

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_EARLY_CREDIT"
ADMIN = {"id": "early-credit-admin", "name": "Credit QA", "display_name": "Credit QA",
         "email": "ec@test", "role": "admin"}

_PEAK_SETTINGS = {"day_to_day.seasonal.holiday_surcharges": [],
                  "day_to_day.seasonal.peak_season_ranges": [],
                  "day_to_day.money.late_pickup_fee_per_15min": 0,
                  "booking_rules.stay_pricing_enabled": False}


@pytest.fixture(autouse=True)
def _open_register(monkeypatch):
    async def _open(_date):
        return None
    monkeypatch.setattr(server, "_require_register_day_open", _open)


@pytest.fixture(autouse=True)
def _cash_drawer_open():
    """A cash checkout (the late fee or a shortfall) needs today's drawer open."""
    day = server.business_today().isoformat()
    run(server.db.cash_drawer_sessions.find_one_and_update(
        {"date": day},
        {"$setOnInsert": {"date": day, "opening_cash": 100.0, "opened_at": server.now_iso(),
                          "opened_by": TAG, "opened_by_name": TAG, "notes": TAG}},
        upsert=True, projection={"_id": 0}))
    yield
    run(server.db.cash_drawer_sessions.delete_many({"notes": TAG}))


def _et(day_iso, hhmm):
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
def _credit_dog(*, credits=5, checked_in_days_ago=2, nights_booked=5):
    """One dog on boarding credits. `nights_booked` nights from (today - checked_in_days_ago);
    the stay ends `nights_booked - checked_in_days_ago` nights from today (so today is early)."""
    cid, did, bid, lot_id = (str(uuid.uuid4()) for _ in range(4))
    today = server.business_today()
    start = (today - timedelta(days=checked_in_days_ago)).isoformat()
    end = (today + timedelta(days=nights_booked - checked_in_days_ago)).isoformat()
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} owner", "email": f"{cid}@example.com",
                                      "credits": 0, "boarding_credits": credits, "account_balance": 0.0}))
    run(server.db.credit_lots.insert_one({
        "id": lot_id, "client_id": cid, "service_type": "boarding", "pack_name": f"{TAG} pack",
        "qty_total": credits, "qty_remaining": credits, "value_each": 50.0, "recognize_at_sale": True,
        "purchased_at": server.now_iso()}))
    run(server.db.dogs.insert_one({"id": did, "owner_id": cid, "name": f"{TAG} dog", "vaccines": {"rabies": "2099-01-01"}}))
    run(server.db.bookings.insert_one({
        "id": bid, "client_id": cid, "client_name": f"{TAG} owner", "dog_id": did, "dog_name": f"{TAG} dog",
        "service_type": "boarding", "date": start, "end_date": end, "status": "approved",
        "dropoff_time": "08:00", "pickup_time": "09:00", "time": "",
        "estimated_price": 50.0 * nights_booked, "unit_price": 50.0, "pricing_snapshot": {"unit_price": 50.0},
        "checked_in_at": _et(start, "08:00"), "checked_in_by": "test", "checked_out_at": None,
        "created_at": server.now_iso()}))
    try:
        yield cid, bid
    finally:
        async def go():
            for c in ("bookings", "invoices", "payments", "payment_ledger", "booking_financial_events", "checkout_groups"):
                await server.db[c].delete_many({"client_id": cid})
            await server.db.booking_financial_events.delete_many({"booking_id": bid})
            await server.db.credit_lots.delete_many({"client_id": cid})
            await server.db.dogs.delete_many({"owner_id": cid})
            await server.db.clients.delete_many({"id": cid})
        run(go())


def _client(cid):
    return run(server.db.clients.find_one({"id": cid}, {"_id": 0}))


def _lot_remaining(cid):
    return sum(float(l.get("qty_remaining") or 0) for l in run(server.db.credit_lots.find({"client_id": cid}, {"_id": 0}).to_list(50)))


def test_a_credit_dog_checked_out_early_uses_credits_for_the_nights_stayed_only():
    with _settings(**_PEAK_SETTINGS), _boarding_service(50.0), _credit_dog(credits=5) as (cid, bid):
        quote = run(server.early_checkout_quote(bid, ADMIN))
        assert quote["applicable"] is True and quote["units"] == 2
        out = run(server.check_out(bid, server.CheckoutIn(use_credits=True, payment_method="cash",
                                                          payment_status="paid", early_checkout_credit=True), ADMIN))
        assert out["status"] == "completed"
        assert _client(cid)["boarding_credits"] == 3, "only the two nights stayed came off the credits"
        assert _lot_remaining(cid) == 3, "the rest of the booked credit is still on the client's pack"


def test_a_full_stay_credit_checkout_still_takes_the_booked_nights():
    with _settings(**_PEAK_SETTINGS), _boarding_service(50.0), _credit_dog(credits=5) as (cid, bid):
        run(server.check_out(bid, server.CheckoutIn(use_credits=True, payment_method="cash",
                                                    payment_status="paid"), ADMIN))
        assert _client(cid)["boarding_credits"] == 0, "a full-stay checkout charges the five booked nights"


def test_the_early_credit_flag_on_a_stay_that_is_not_early_charges_the_booked_nights():
    # The stay ends today, so there is no early stay to charge: the flag changes nothing.
    with _settings(**_PEAK_SETTINGS), _boarding_service(50.0), _credit_dog(credits=5, nights_booked=2) as (cid, bid):
        assert run(server.early_checkout_quote(bid, ADMIN)).get("applicable") is False
        run(server.check_out(bid, server.CheckoutIn(use_credits=True, payment_method="cash",
                                                    payment_status="paid", early_checkout_credit=True), ADMIN))
        assert _client(cid)["boarding_credits"] == 3, "the two booked nights came off the credits"


def test_an_early_credit_checkout_short_of_credits_pays_only_the_shortfall_in_cash():
    with _settings(**_PEAK_SETTINGS), _boarding_service(50.0), _credit_dog(credits=1) as (cid, bid):
        out = run(server.check_out(bid, server.CheckoutIn(use_credits=True, payment_method="cash",
                                                          payment_status="paid", early_checkout_credit=True), ADMIN))
        assert _client(cid)["boarding_credits"] == 0, "the one credit covered the first of the two nights"
        assert out["credit_shortfall"] == 1.0, "one night is uncovered by credits"
        assert out["actual_price"] >= 50.0, "the uncovered night is charged in cash at the boarding rate"


@contextlib.contextmanager
def _credit_household(*, credits=10):
    """Two dogs of one client in one group, five nights booked, both checked in two nights ago."""
    cid, gid = str(uuid.uuid4()), str(uuid.uuid4())
    dogs = [str(uuid.uuid4()), str(uuid.uuid4())]
    bids = [str(uuid.uuid4()), str(uuid.uuid4())]
    lot_id = str(uuid.uuid4())
    today = server.business_today()
    start, end = (today - timedelta(days=2)).isoformat(), (today + timedelta(days=3)).isoformat()
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} household", "email": f"{cid}@example.com",
                                      "credits": 0, "boarding_credits": credits, "account_balance": 0.0}))
    run(server.db.credit_lots.insert_one({
        "id": lot_id, "client_id": cid, "service_type": "boarding", "pack_name": f"{TAG} pack",
        "qty_total": credits, "qty_remaining": credits, "value_each": 50.0, "recognize_at_sale": True,
        "purchased_at": server.now_iso()}))
    for did, bid, name in zip(dogs, bids, ("Moss", "Pip")):
        run(server.db.dogs.insert_one({"id": did, "owner_id": cid, "name": name, "vaccines": {"rabies": "2099-01-01"}}))
        run(server.db.bookings.insert_one({
            "id": bid, "client_id": cid, "client_name": f"{TAG} household", "dog_id": did, "dog_name": name,
            "service_type": "boarding", "date": start, "end_date": end, "status": "approved",
            "group_id": gid, "dropoff_time": "08:00", "pickup_time": "09:00", "time": "",
            "estimated_price": 250.0, "unit_price": 50.0, "pricing_snapshot": {"unit_price": 50.0},
            "checked_in_at": _et(start, "08:00"), "checked_in_by": "test", "checked_out_at": None,
            "created_at": server.now_iso()}))
    try:
        yield cid, bids
    finally:
        async def go():
            for c in ("bookings", "invoices", "payments", "payment_ledger", "booking_financial_events", "checkout_groups"):
                await server.db[c].delete_many({"client_id": cid})
            await server.db.booking_financial_events.delete_many({"booking_id": {"$in": bids}})
            await server.db.credit_lots.delete_many({"client_id": cid})
            await server.db.dogs.delete_many({"owner_id": cid})
            await server.db.clients.delete_many({"id": cid})
        run(go())


def test_a_household_paid_from_credits_keeps_every_dog_on_its_booked_nights():
    # The early credit price is for the one dog the screen checks out; a household
    # paid from credits still takes the booked five nights per dog (ten credits).
    with _settings(**_PEAK_SETTINGS), _boarding_service(50.0), _credit_household(credits=10) as (cid, bids):
        run(server.check_out_group(bids[0], server.CheckoutIn(use_credits=True, payment_method="cash",
                                                              payment_status="paid", early_checkout_credit=True), user=ADMIN))
        assert _client(cid)["boarding_credits"] == 0, "the flag was honoured for a household; it must not be"
