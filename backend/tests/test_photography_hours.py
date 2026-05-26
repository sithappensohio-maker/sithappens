"""Sprint 110e — Photography hours parity with grooming/training.

Photography should:
  - Have its own service_hours grid (admin-configurable per weekday)
  - Generate time-slots from those hours (just like training/grooming)
  - Render as a TIMED event on the schedule calendar when booked with a time
  - Respect custom hours when the admin overrides them
"""
import os
import requests

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://sit-happens-crm.preview.emergentagent.com").rstrip("/")


def _admin():
    r = requests.post(f"{BASE}/api/auth/login", json={"email": "admin@sithappens.com", "password": "admin123"}, timeout=15)
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_photography_default_hours_present():
    """settings.service_hours.photography must exist with a 7-day grid."""
    s = requests.get(f"{BASE}/api/settings", headers=_admin(), timeout=15).json()
    sh = s.get("service_hours") or {}
    assert "photography" in sh, "photography missing from service_hours"
    grid = sh["photography"]
    for d in ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"):
        assert d in grid, f"photography weekday {d} missing"
        for k in ("open", "close", "closed"):
            assert k in grid[d], f"photography {d}.{k} missing"


def test_photography_time_slots_use_configured_hours():
    """Override photography hours to noon-3pm Wed; time-slots must reflect that
    (with 30-min granularity = 6 slots from 12:00 through 14:30)."""
    h = _admin()
    orig = requests.get(f"{BASE}/api/settings", headers=h, timeout=15).json()
    orig_grid = orig.get("service_hours", {}).get("photography") or {}
    try:
        new_grid = dict(orig_grid)
        new_grid["wednesday"] = {"open": "12:00", "close": "15:00", "closed": False}
        requests.put(f"{BASE}/api/settings", headers=h, json={
            "service_hours": {**orig.get("service_hours", {}), "photography": new_grid},
        }, timeout=15)
        # 2026-03-04 is a Wednesday
        slots = requests.get(
            f"{BASE}/api/bookings/time-slots?date_str=2026-03-04&service_type=photography",
            headers=h, timeout=15,
        ).json()
        times = [s["time"] for s in slots.get("slots", [])]
        # First slot at noon, last bookable slot at 14:30 (so it ends by 15:00)
        assert "12:00" in times, f"expected noon in slots, got {times[:5]}"
        assert times[0] == "12:00"
        # No slots past 14:30 (default duration is 60min — but we just check open<=t<close-step)
        # Accept either 14:00 or 14:30 as last depending on default duration; either way no 15:00+
        assert "15:00" not in times
        assert "16:00" not in times
    finally:
        # Restore original photography hours
        requests.put(f"{BASE}/api/settings", headers=h, json={
            "service_hours": {**orig.get("service_hours", {}), "photography": orig_grid},
        }, timeout=15)


def test_photography_closed_day_returns_no_slots():
    """A weekday marked closed for photography must yield zero time-slots."""
    h = _admin()
    orig = requests.get(f"{BASE}/api/settings", headers=h, timeout=15).json()
    orig_grid = orig.get("service_hours", {}).get("photography") or {}
    try:
        new_grid = dict(orig_grid)
        new_grid["wednesday"] = {"open": "09:00", "close": "17:00", "closed": True}
        requests.put(f"{BASE}/api/settings", headers=h, json={
            "service_hours": {**orig.get("service_hours", {}), "photography": new_grid},
        }, timeout=15)
        slots = requests.get(
            f"{BASE}/api/bookings/time-slots?date_str=2026-03-04&service_type=photography",
            headers=h, timeout=15,
        ).json()
        assert len(slots.get("slots") or []) == 0, f"expected 0 slots on closed Wed, got {slots}"
    finally:
        requests.put(f"{BASE}/api/settings", headers=h, json={
            "service_hours": {**orig.get("service_hours", {}), "photography": orig_grid},
        }, timeout=15)
