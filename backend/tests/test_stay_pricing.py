"""Stay pricing regression coverage.

Boarding uses calendar nights plus pickup-day care: before 5 PM is a half day,
and 5 PM or later is a full day. Daycare continues to use elapsed-hour rules.
Manual checkout overrides always win.
"""
import os
import sys
import uuid
import asyncio
import pytest
import requests
from datetime import datetime, timedelta, timezone

# Allow motor to update checked_in_at to a back-dated time (the live API has
# no admin path to back-date a check-in, so we use direct DB writes — same
# pattern other tests in this folder use).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    os.environ.get("TEST_BACKEND_URL","http://localhost:8001"),
).rstrip("/")
API = f"{BASE_URL}/api"


def _backdate_checkin(booking_id, hours_ago):
    """Direct pymongo write to back-date checked_in_at. We use pymongo
    (sync) instead of motor to avoid event-loop conflicts in pytest."""
    from pymongo import MongoClient
    ci_ts = (datetime.now(timezone.utc) - timedelta(hours=hours_ago)).isoformat()
    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ.get("DB_NAME", "sit_happens")
    client = MongoClient(mongo_url)
    try:
        client[db_name].bookings.update_one(
            {"id": booking_id},
            {"$set": {"status": "checked_in", "checked_in_at": ci_ts}},
        )
    finally:
        client.close()


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{API}/auth/login",
                      json={"email": "admin@sithappens.com", "password": "admin123"},
                      timeout=15)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _set_rules(headers, **overrides):
    rules = {
        "stay_pricing_enabled": True,
        "half_day_pct": 50,
        "daycare_half_day_max_hours": 5,
        "boarding_half_day_max_hours": 12,
        "daycare_cost": 1, "boarding_cost_per_night": 1, "training_cost": 1,
        "max_advance_days": 60, "cancellation_cutoff_hours": 24, "auto_approve": False,
    }
    rules.update(overrides)
    r = requests.put(f"{API}/settings", headers=headers,
                       json={"booking_rules": rules}, timeout=15)
    r.raise_for_status()


def _seed_default_service(headers, svc_type, base_price):
    # Find an existing default service of this type and update its price, or create a new one
    svcs = requests.get(f"{API}/services", headers=headers, timeout=15).json()
    existing = [s for s in svcs if s.get("service_type") == svc_type and s.get("is_default")]
    if existing:
        sid = existing[0]["id"]
        payload = {**existing[0], "base_price": base_price, "active": True}
        payload.pop("id", None); payload.pop("_id", None); payload.pop("created_at", None)
        r = requests.put(f"{API}/services/{sid}", headers=headers, json=payload, timeout=15)
        r.raise_for_status()
        return sid
    r = requests.post(f"{API}/services", headers=headers,
                      json={"service_type": svc_type, "name": svc_type.title(),
                            "base_price": base_price, "is_default": True, "active": True},
                      timeout=15)
    r.raise_for_status()
    return r.json()["id"]


def _make_client(headers):
    suffix = uuid.uuid4().hex[:6]
    r = requests.post(f"{API}/clients", headers=headers,
                      json={"name": f"StayTest {suffix}",
                            "email": f"stay-{suffix}@e.com"},
                      timeout=15)
    r.raise_for_status()
    return r.json()


def _make_dog(headers, client_id):
    suffix = uuid.uuid4().hex[:6]
    r = requests.post(f"{API}/dogs", headers=headers,
                      json={"owner_id": client_id, "name": f"Rex {suffix}", "breed": "mix"},
                      timeout=15)
    r.raise_for_status()
    return r.json()


def _make_booking_then_checkin(headers, client_id, dog_id, svc_type, hours_ago, *, end_days=1, pickup_time="16:00"):
    """Create a booking dated today, force a back-dated check-in via direct
    motor write (no admin API exposes this), return booking id."""
    today_iso = datetime.now(timezone.utc).date().isoformat()
    end_iso = (datetime.now(timezone.utc).date() + timedelta(days=end_days)).isoformat()
    r = requests.post(f"{API}/bookings", headers=headers,
                      json={"dog_id": dog_id,
                            "service_type": svc_type,
                            "date": today_iso,
                            "end_date": end_iso,
                            "pickup_time": pickup_time if svc_type == "boarding" else "",
                            "override_capacity": True,
                            "override_vaccines": True},
                      timeout=15)
    r.raise_for_status()
    bid = r.json()["id"]
    _backdate_checkin(bid, hours_ago)
    return bid


def _checkout(headers, booking_id, base_price=None):
    payload = {"payment_method": "cash"}
    if base_price is not None:
        payload["base_price"] = base_price
    r = requests.post(f"{API}/bookings/{booking_id}/check-out",
                      headers=headers, json=payload, timeout=20)
    r.raise_for_status()
    return r.json()


def _get_booking(headers, bid):
    r = requests.get(f"{API}/bookings/{bid}", headers=headers, timeout=15)
    r.raise_for_status()
    return r.json()


def test_boarding_two_nights_before_five(admin_headers):
    """2 nights + half pickup day at 4 PM = 2.5 × $50 = $125."""
    _set_rules(admin_headers)
    _seed_default_service(admin_headers, "boarding", 50.0)
    client = _make_client(admin_headers)
    dog = _make_dog(admin_headers, client["id"])
    bid = _make_booking_then_checkin(
        admin_headers, client["id"], dog["id"], "boarding",
        hours_ago=62, end_days=2, pickup_time="16:00",
    )
    _checkout(admin_headers, bid)
    bk = _get_booking(admin_headers, bid)
    assert bk.get("actual_price") == 125.0, f"got {bk.get('actual_price')}"


def test_boarding_two_nights_at_or_after_five(admin_headers):
    """2 nights + full pickup day at 5 PM = 3 × $50 = $150."""
    _set_rules(admin_headers)
    _seed_default_service(admin_headers, "boarding", 50.0)
    client = _make_client(admin_headers)
    dog = _make_dog(admin_headers, client["id"])
    bid = _make_booking_then_checkin(
        admin_headers, client["id"], dog["id"], "boarding",
        hours_ago=30, end_days=2, pickup_time="17:00",
    )
    _checkout(admin_headers, bid)
    bk = _get_booking(admin_headers, bid)
    assert bk.get("actual_price") == 150.0, f"got {bk.get('actual_price')}"


def test_boarding_pickup_rule_ignores_elapsed_hours(admin_headers):
    """Scheduled 4 PM pickup remains half-day even if checkout is clicked later."""
    _set_rules(admin_headers)
    _seed_default_service(admin_headers, "boarding", 50.0)
    client = _make_client(admin_headers)
    dog = _make_dog(admin_headers, client["id"])
    bid = _make_booking_then_checkin(
        admin_headers, client["id"], dog["id"], "boarding",
        hours_ago=80, end_days=1, pickup_time="16:00",
    )
    _checkout(admin_headers, bid)
    bk = _get_booking(admin_headers, bid)
    assert bk.get("actual_price") == 75.0, f"got {bk.get('actual_price')}"


def test_daycare_half_day(admin_headers):
    """4h daycare stay → ≤ 5h threshold → half day → 0.5 × $40 = $20."""
    _set_rules(admin_headers)
    _seed_default_service(admin_headers, "daycare", 40.0)
    client = _make_client(admin_headers)
    dog = _make_dog(admin_headers, client["id"])
    bid = _make_booking_then_checkin(admin_headers, client["id"], dog["id"], "daycare", hours_ago=4)
    _checkout(admin_headers, bid)
    bk = _get_booking(admin_headers, bid)
    assert bk.get("actual_price") == 20.0, f"got {bk.get('actual_price')}"


def test_daycare_full_day(admin_headers):
    """8h daycare stay → > 5h threshold → full day → $40."""
    _set_rules(admin_headers)
    _seed_default_service(admin_headers, "daycare", 40.0)
    client = _make_client(admin_headers)
    dog = _make_dog(admin_headers, client["id"])
    bid = _make_booking_then_checkin(admin_headers, client["id"], dog["id"], "daycare", hours_ago=8)
    _checkout(admin_headers, bid)
    bk = _get_booking(admin_headers, bid)
    assert bk.get("actual_price") == 40.0, f"got {bk.get('actual_price')}"


def test_manual_base_price_override_wins(admin_headers):
    """If admin explicitly passes base_price at checkout, that wins over auto-pricing."""
    _set_rules(admin_headers)
    _seed_default_service(admin_headers, "boarding", 50.0)
    client = _make_client(admin_headers)
    dog = _make_dog(admin_headers, client["id"])
    bid = _make_booking_then_checkin(admin_headers, client["id"], dog["id"], "boarding", hours_ago=30)
    _checkout(admin_headers, bid, base_price=99.99)
    bk = _get_booking(admin_headers, bid)
    assert bk.get("actual_price") == 99.99, f"got {bk.get('actual_price')}"
