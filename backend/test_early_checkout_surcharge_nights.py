"""An early boarding checkout's surcharge is worked out on the nights stayed.

A dog booked for five nights who goes home after two is charged for the two
nights (the early checkout quote). The holiday / peak surcharge on that
checkout must be worked out on those two nights too, not on the five the stay
was booked for.
"""
import contextlib
import uuid
from datetime import timedelta

import pytest

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_EARLY_SURCHARGE"
ADMIN = {"id": "early-surcharge-admin", "name": "Surcharge QA", "display_name": "Surcharge QA",
         "email": "es@test", "role": "admin"}


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
def _stay_booked_five_nights_checked_in_two_nights_ago(unit=50.0):
    cid, did, bid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    today = server.business_today()
    start, end = (today - timedelta(days=2)).isoformat(), (today + timedelta(days=3)).isoformat()
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} boarder", "email": f"{cid}@example.com",
                                      "credits": 0, "boarding_credits": 0, "account_balance": 0.0}))
    run(server.db.dogs.insert_one({"id": did, "owner_id": cid, "name": "Moss", "vaccines": {"rabies": "2099-01-01"}}))
    run(server.db.bookings.insert_one({
        "id": bid, "client_id": cid, "client_name": f"{TAG} boarder", "dog_id": did, "dog_name": "Moss",
        "service_type": "boarding", "date": start, "end_date": end, "status": "approved",
        "dropoff_time": "08:00", "pickup_time": "09:00", "time": "", "estimated_price": unit * 5,
        "unit_price": unit, "pricing_snapshot": {"unit_price": unit}, "credit_units_required": 5,
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


def test_an_early_checkout_surcharge_is_worked_out_on_the_two_nights_stayed():
    today = server.business_today()
    # A peak season that covers the whole booked stay, so every night is surcharged.
    peak = [{"start": (today - timedelta(days=2)).isoformat(), "end": (today + timedelta(days=3)).isoformat(),
             "multiplier": 1.5, "label": "Peak"}]
    with _settings(**{"day_to_day.seasonal.holiday_surcharges": [],
                      "day_to_day.seasonal.peak_season_ranges": peak,
                      "day_to_day.money.late_pickup_fee_per_15min": 0,
                      "booking_rules.stay_pricing_enabled": False}), \
            _boarding_service(50.0), _stay_booked_five_nights_checked_in_two_nights_ago(50.0) as bid:
        quote = run(server.early_checkout_quote(bid, ADMIN))
        assert quote["applicable"] is True
        assert quote["units"] == 2.0, "two nights stayed, not the five booked"
        early_base = round(float(quote["base_price"]), 2)
        assert early_base > 0

        run(server.check_out(bid, server.CheckoutIn(payment_method="card", payment_status="paid",
                                                    base_price=early_base), user=ADMIN))
        row = run(server.db.bookings.find_one({"id": bid}, {"_id": 0}))
        breakdown = row["money_modifier_breakdown"]
        assert breakdown["base_before"] == early_base, "the surcharge was worked out on the booked five nights"
        assert breakdown["seasonal_multiplier"] == 1.5
        assert breakdown["seasonal_amount"] == round(early_base * 0.5, 2)
        assert row["actual_price"] == breakdown["total_after"]


_PEAK_SETTINGS = {"day_to_day.seasonal.holiday_surcharges": [],
                  "day_to_day.money.late_pickup_fee_per_15min": 0,
                  "booking_rules.stay_pricing_enabled": False}


def _peak_for_the_whole_stay():
    today = server.business_today()
    return [{"start": (today - timedelta(days=2)).isoformat(), "end": (today + timedelta(days=3)).isoformat(),
             "multiplier": 1.5, "label": "Peak"}]


def test_a_full_stay_checkout_is_surcharged_on_the_nights_booked_not_the_early_nights():
    # The operator charges the full stay: no early price is sent, so the
    # surcharge follows the five nights that are charged.
    with _settings(**{**_PEAK_SETTINGS, "day_to_day.seasonal.peak_season_ranges": _peak_for_the_whole_stay()}), \
            _boarding_service(50.0), _stay_booked_five_nights_checked_in_two_nights_ago(50.0) as bid:
        quote = run(server.early_checkout_quote(bid, ADMIN))
        assert quote["applicable"] is True

        run(server.check_out(bid, server.CheckoutIn(payment_method="card", payment_status="paid"), user=ADMIN))
        row = run(server.db.bookings.find_one({"id": bid}, {"_id": 0}))
        booked_base = run(server._boarding_auto_base(row, run(server.get_settings())))
        breakdown = row["money_modifier_breakdown"]
        assert breakdown["base_before"] == booked_base, "a full-stay charge was surcharged on the early nights"
        assert breakdown["base_before"] > float(quote["base_price"])


def test_the_checkout_preview_offers_the_early_surcharge_on_the_nights_stayed():
    # The modal shows the surcharge the early price will be charged with.
    with _settings(**{**_PEAK_SETTINGS, "day_to_day.seasonal.peak_season_ranges": _peak_for_the_whole_stay()}), \
            _boarding_service(50.0), _stay_booked_five_nights_checked_in_two_nights_ago(50.0) as bid:
        quote = run(server.early_checkout_quote(bid, ADMIN))
        preview = run(server.money_modifier_preview(bid, ADMIN))
        early = preview["early"]
        assert early["base_before"] == round(float(quote["base_price"]), 2)
        assert early["seasonal_multiplier"] == 1.5
        assert early["seasonal_amount"] == round(float(quote["base_price"]) * 0.5, 2)
        assert preview["base_before"] > early["base_before"]


def test_a_peak_season_that_starts_after_the_dog_left_does_not_surcharge_the_early_checkout():
    # The peak season starts the day after the early checkout: none of the two
    # nights the dog stayed is in it, so the early checkout carries no surcharge.
    today = server.business_today()
    peak = [{"start": (today + timedelta(days=1)).isoformat(), "end": (today + timedelta(days=30)).isoformat(),
             "multiplier": 1.5, "label": "Peak"}]
    with _settings(**{**_PEAK_SETTINGS, "day_to_day.seasonal.peak_season_ranges": peak}), \
            _boarding_service(50.0), _stay_booked_five_nights_checked_in_two_nights_ago(50.0) as bid:
        quote = run(server.early_checkout_quote(bid, ADMIN))
        early_base = round(float(quote["base_price"]), 2)
        run(server.check_out(bid, server.CheckoutIn(payment_method="card", payment_status="paid",
                                                    base_price=early_base), user=ADMIN))
        row = run(server.db.bookings.find_one({"id": bid}, {"_id": 0}))
        breakdown = row["money_modifier_breakdown"]
        assert breakdown["base_before"] == early_base
        assert breakdown["seasonal_amount"] == 0.0, "the nights after the dog left were surcharged"
        assert row["actual_price"] == early_base
