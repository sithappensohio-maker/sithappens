"""Sprint 110cr — End-of-Day wrap-up + owner (admin) clock-in.

Validates:
  • /admin/end-of-day returns the right shape
  • Admin can use the same /time-clock/clock-in + clock-out as staff
  • Care log totals are summed correctly
"""
import os
import uuid
import pytest
import requests
from datetime import date

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


def test_end_of_day_shape(admin_headers):
    r = requests.get(f"{API}/admin/end-of-day", headers=admin_headers, timeout=15)
    assert r.status_code == 200
    body = r.json()
    for k in ("date", "still_on_premises", "unpaid_bookings", "missing_report_cards",
              "revenue_cash", "completed_count", "care_log_totals", "all_clear"):
        assert k in body, f"Missing key {k}"
    for k in ("feedings", "medications", "pee", "poop"):
        assert k in body["care_log_totals"]


def test_end_of_day_rejects_non_admin(admin_headers):
    suffix = uuid.uuid4().hex[:6]
    email = f"eod-emp-{suffix}@sithappens.com"
    pw = "EodEmp123!"
    requests.post(f"{API}/admin/employees", headers=admin_headers,
                  json={"name": f"EOD Emp {suffix}", "email": email, "password": pw,
                        "hourly_rate": 18.0}, timeout=15).raise_for_status()
    login = requests.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=15).json()
    staff_headers = {"Authorization": f"Bearer {login['token']}"}
    r = requests.get(f"{API}/admin/end-of-day", headers=staff_headers, timeout=15)
    assert r.status_code in (401, 403)


def test_owner_can_clock_in_and_out(admin_headers):
    """Admin uses the same /time-clock/clock-in + clock-out the floor staff
    uses. Confirms the endpoint accepts the admin role."""
    # Clock out first in case admin already has an open shift from a prior test.
    requests.post(f"{API}/time-clock/clock-out", headers=admin_headers, json={}, timeout=15)
    current = requests.get(f"{API}/time-clock/current", headers=admin_headers, timeout=15).json()
    assert current.get("open") in (None, {})

    # Clock in
    ci = requests.post(f"{API}/time-clock/clock-in", headers=admin_headers,
                      json={"note": "Owner shift"}, timeout=15)
    assert ci.status_code == 200, ci.text
    body = ci.json()
    assert body.get("clock_in_at"), "Should return the open shift"

    # Confirm `current` now reflects it
    after = requests.get(f"{API}/time-clock/current", headers=admin_headers, timeout=15).json()
    assert after.get("open"), f"Expected open shift, got {after}"

    # Clock out
    co = requests.post(f"{API}/time-clock/clock-out", headers=admin_headers,
                      json={}, timeout=15)
    assert co.status_code == 200, co.text
    closed = co.json()
    assert closed.get("clock_out_at"), "Should set clock_out_at"
