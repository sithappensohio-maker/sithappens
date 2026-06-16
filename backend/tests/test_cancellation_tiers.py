"""Sprint 110dm — 3-tier cancellation fee policy.

Validates the cancellation endpoint applies the correct % based on hours
until the booking, reading thresholds from `day_to_day.money`.
"""
import os
import uuid
import pytest
import requests
from datetime import datetime, timedelta, timezone
from pymongo import MongoClient

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://sit-happens-crm.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(f"{API}/auth/login",
                      json={"email": "admin@sithappens.com", "password": "admin123"},
                      timeout=15)
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _set_money_rules(headers, **overrides):
    """Read current settings then PUT only the day_to_day.money block."""
    cur = requests.get(f"{API}/settings", headers=headers, timeout=15).json()
    d2d = cur.get("day_to_day") or {}
    money = d2d.get("money") or {}
    money.update(overrides)
    d2d["money"] = money
    r = requests.put(f"{API}/settings", headers=headers,
                     json={"day_to_day": d2d}, timeout=15)
    r.raise_for_status()


def _seed_default_service(headers, svc_type, base_price):
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
                      json={"name": f"CancelTest {suffix}",
                            "email": f"cancel-{suffix}@e.com"},
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


def _make_booking_with_actual_price(headers, dog_id, svc_type, date_offset_days, actual_price):
    today = datetime.now(timezone.utc).date()
    booking_date = (today + timedelta(days=date_offset_days)).isoformat()
    r = requests.post(f"{API}/bookings", headers=headers,
                      json={"dog_id": dog_id,
                            "service_type": svc_type,
                            "date": booking_date,
                            "end_date": booking_date,
                            "override_capacity": True,
                            "override_vaccines": True},
                      timeout=15)
    r.raise_for_status()
    bid = r.json()["id"]
    # Patch actual_price directly via pymongo
    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ.get("DB_NAME", "sit_happens")
    mc = MongoClient(mongo_url)
    try:
        mc[db_name].bookings.update_one(
            {"id": bid}, {"$set": {"actual_price": actual_price, "status": "approved"}}
        )
    finally:
        mc.close()
    return bid


def _forfeit_cancel(headers, booking_id):
    r = requests.delete(f"{API}/bookings/{booking_id}?forfeit=true",
                        headers=headers, timeout=15)
    r.raise_for_status()
    return r.json()


def _get_booking(headers, bid):
    r = requests.get(f"{API}/bookings/{bid}", headers=headers, timeout=15)
    r.raise_for_status()
    return r.json()


def test_cancel_tier1_free(admin_headers):
    """Booking 5 days away → tier-1 (≥48h) → 0% fee."""
    _set_money_rules(admin_headers,
                     cancellation_tier1_hours=48, cancellation_tier1_pct=0,
                     cancellation_tier2_hours=24, cancellation_tier2_pct=50,
                     cancellation_tier3_pct=100)
    _seed_default_service(admin_headers, "daycare", 40.0)
    client = _make_client(admin_headers)
    dog = _make_dog(admin_headers, client["id"])
    bid = _make_booking_with_actual_price(admin_headers, dog["id"], "daycare", 5, 40.0)
    resp = _forfeit_cancel(admin_headers, bid)
    bk = _get_booking(admin_headers, bid)
    assert bk.get("cancellation_fee") == 0.0, f"got {bk.get('cancellation_fee')}"
    assert bk.get("cancellation_fee_pct") == 0


def test_cancel_tier2_half(admin_headers):
    """Booking 36h away (between 48h and 24h) → tier-2 → 50%."""
    _set_money_rules(admin_headers,
                     cancellation_tier1_hours=48, cancellation_tier1_pct=0,
                     cancellation_tier2_hours=24, cancellation_tier2_pct=50,
                     cancellation_tier3_pct=100)
    _seed_default_service(admin_headers, "daycare", 40.0)
    client = _make_client(admin_headers)
    dog = _make_dog(admin_headers, client["id"])
    # Booking is 2 days from now → ~48h away. Falls in tier 1 boundary (>=48 → tier1).
    # Use ~36h offset by patching the date 1 day + setting time 12h ago via dt math is tricky;
    # easier: set thresholds smaller to force tier-2 with 1-day offset.
    _set_money_rules(admin_headers,
                     cancellation_tier1_hours=72, cancellation_tier1_pct=0,
                     cancellation_tier2_hours=12, cancellation_tier2_pct=50,
                     cancellation_tier3_pct=100)
    bid = _make_booking_with_actual_price(admin_headers, dog["id"], "daycare", 1, 100.0)
    _forfeit_cancel(admin_headers, bid)
    bk = _get_booking(admin_headers, bid)
    # 1-day booking → ~24h away → between 12h (tier2) and 72h (tier1) → tier-2 = 50%
    assert bk.get("cancellation_fee") == 50.0, f"got {bk.get('cancellation_fee')}"
    assert bk.get("cancellation_fee_pct") == 50


def test_cancel_tier3_full(admin_headers):
    """Booking today → tier-3 → 100%."""
    _set_money_rules(admin_headers,
                     cancellation_tier1_hours=48, cancellation_tier1_pct=0,
                     cancellation_tier2_hours=24, cancellation_tier2_pct=50,
                     cancellation_tier3_pct=100)
    _seed_default_service(admin_headers, "daycare", 40.0)
    client = _make_client(admin_headers)
    dog = _make_dog(admin_headers, client["id"])
    bid = _make_booking_with_actual_price(admin_headers, dog["id"], "daycare", 0, 40.0)
    _forfeit_cancel(admin_headers, bid)
    bk = _get_booking(admin_headers, bid)
    assert bk.get("cancellation_fee") == 40.0, f"got {bk.get('cancellation_fee')}"
    assert bk.get("cancellation_fee_pct") == 100
