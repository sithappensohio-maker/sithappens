"""Sprint 110ba — Staff timecard now surfaces pay (hourly × hours)
plus weekly / YTD totals and a CSV download.
"""
import os
import requests
import pytest

BASE = os.environ.get("API_URL", "https://sit-happens-crm.preview.emergentagent.com")


def _admin():
    r = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": "admin@sithappens.com", "password": "admin123"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _seed_employee_with_rate(headers, rate=18.50):
    """Return a {token, user_id, hourly_rate} dict for an employee account."""
    emps = requests.get(f"{BASE}/api/admin/employees", headers=headers, timeout=15).json()
    emps = emps if isinstance(emps, list) else emps.get("items", [])
    emp = next((u for u in emps if u.get("role") == "employee" and u.get("active", True)), None)
    if not emp:
        # Create one for the test
        create = requests.post(
            f"{BASE}/api/admin/employees",
            json={"name": "Pytest Staff", "email": "pytest.staff@sithappens.local",
                  "password": "TestStaff!123", "hourly_rate": rate},
            headers=headers, timeout=15,
        )
        if create.status_code != 200:
            pytest.skip(f"could not create test employee: {create.text}")
        emp = create.json()
    # Set hourly rate
    requests.put(
        f"{BASE}/api/admin/employees/{emp['id']}",
        json={"hourly_rate": rate, "name": emp.get("name") or "Pytest Staff",
              "email": emp["email"]}, headers=headers, timeout=15,
    )
    new_pw = "TestStaff!123"
    requests.post(
        f"{BASE}/api/admin/employees/{emp['id']}/reset-password",
        json={"password": new_pw}, headers=headers, timeout=15,
    )
    login = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": emp["email"], "password": new_pw}, timeout=15,
    )
    if login.status_code != 200:
        pytest.skip(f"could not log in as employee: {login.text}")
    return {
        "token": login.json()["token"],
        "user_id": emp["id"],
        "email": emp["email"],
        "rate": rate,
    }


def test_time_clock_me_returns_pay_fields():
    admin = _admin()
    emp = _seed_employee_with_rate(admin, rate=25.00)
    headers = {"Authorization": f"Bearer {emp['token']}"}
    r = requests.get(f"{BASE}/api/time-clock/me?days=30", headers=headers, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    # New pay fields required for the upgraded UI
    for key in ("hourly_rate", "total_gross", "this_week", "last_week", "ytd", "live"):
        assert key in body, f"missing {key}"
    assert body["hourly_rate"] == 25.0
    for key in ("hours", "gross", "start", "end"):
        assert key in body["this_week"]
        assert key in body["last_week"]
    assert "hours" in body["ytd"] and "gross" in body["ytd"] and "year" in body["ytd"]
    # Each entry must carry per-entry gross
    for e in body["entries"]:
        assert "gross" in e
        if e.get("hours") and not e.get("clock_out_at") is None:
            assert e["gross"] == round(float(e["hours"]) * 25.0, 2)


def test_time_clock_me_live_shift():
    admin = _admin()
    emp = _seed_employee_with_rate(admin, rate=20.00)
    h = {"Authorization": f"Bearer {emp['token']}"}
    # Ensure starting fresh — clock out any open shift first
    cur = requests.get(f"{BASE}/api/time-clock/current", headers=h, timeout=15).json()
    if cur and cur.get("open_entry"):
        requests.post(f"{BASE}/api/time-clock/clock-out", json={"note": "test cleanup"}, headers=h, timeout=15)
    # Clock in
    r = requests.post(f"{BASE}/api/time-clock/clock-in",
                      json={"note": "pytest"}, headers=h, timeout=15)
    assert r.status_code == 200, r.text
    try:
        body = requests.get(f"{BASE}/api/time-clock/me?days=7", headers=h, timeout=15).json()
        live = body.get("live")
        assert live is not None, "live block should be present when clocked in"
        assert "hours_so_far" in live and "gross_so_far" in live
        # Gross should match (hours * rate) within rounding tolerance
        expected = round(live["hours_so_far"] * 20.0, 2)
        assert abs(live["gross_so_far"] - expected) < 0.05
    finally:
        requests.post(f"{BASE}/api/time-clock/clock-out", json={"note": "pytest done"}, headers=h, timeout=15)


def test_time_clock_csv_download():
    admin = _admin()
    emp = _seed_employee_with_rate(admin, rate=22.00)
    h = {"Authorization": f"Bearer {emp['token']}"}
    r = requests.get(f"{BASE}/api/time-clock/me.csv?days=30", headers=h, timeout=15)
    assert r.status_code == 200, r.text
    assert "text/csv" in r.headers.get("content-type", "")
    body = r.text
    assert "Timecard" in body
    assert "Hourly rate" in body
    assert "Gross ($)" in body or "Gross" in body
    assert "TOTAL" in body
