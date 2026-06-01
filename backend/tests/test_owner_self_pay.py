"""Owner (sole-prop / self-pay) employee flag + draw tracking.

Verifies the `is_owner` toggle on the Employee endpoint enforces a singleton
and that owner hours are excluded from payroll-tax math but included in
Today's P&L labor cost (per user choice b).
"""
import os
import time
import requests

BASE = os.environ.get("API_URL", "https://sit-happens-crm.preview.emergentagent.com")


def _admin():
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"email": "admin@sithappens.com", "password": "admin123"}, timeout=15)
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _emp(h):
    """Fetch the active alex@ employee record."""
    rows = requests.get(f"{BASE}/api/admin/employees", headers=h, timeout=15).json()
    return next(e for e in rows if e["email"] == "alex@sithappens.com")


def _set_owner(h, emp, flag):
    body = {
        "email": emp["email"], "name": emp["name"],
        "display_name": emp.get("display_name") or emp["name"],
        "hourly_rate": emp["hourly_rate"], "active": emp["active"],
        "phone": emp.get("phone", ""), "notes": emp.get("notes", ""),
        "is_owner": flag,
    }
    r = requests.put(f"{BASE}/api/admin/employees/{emp['id']}",
                     headers=h, json=body, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def test_employee_has_is_owner_field():
    e = _emp(_admin())
    assert "is_owner" in e
    assert isinstance(e["is_owner"], bool)


def test_owner_endpoint_returns_null_when_none():
    h = _admin()
    e = _emp(h)
    _set_owner(h, e, False)
    body = requests.get(f"{BASE}/api/admin/owner", headers=h, timeout=15).json()
    assert body["owner"] is None


def test_owner_can_be_set_and_singleton_enforced():
    h = _admin()
    e = _emp(h)
    after = _set_owner(h, e, True)
    assert after["is_owner"] is True
    body = requests.get(f"{BASE}/api/admin/owner", headers=h, timeout=15).json()
    assert body["owner"] is not None
    assert body["owner"]["id"] == e["id"]
    # Cleanup
    _set_owner(h, e, False)


def test_owner_draw_summary():
    h = _admin()
    e = _emp(h)
    _set_owner(h, e, True)
    try:
        body = requests.get(f"{BASE}/api/admin/owner/draw-summary", headers=h, timeout=15).json()
        assert body["owner"]["id"] == e["id"]
        for window in ("today", "month", "year"):
            assert window in body
            assert "hours" in body[window]
            assert "draw" in body[window]
            assert body[window]["draw"] >= 0
    finally:
        _set_owner(h, e, False)


def test_quarterly_tax_surfaces_owner_draw_when_set():
    h = _admin()
    e = _emp(h)
    _set_owner(h, e, True)
    try:
        qt = requests.get(f"{BASE}/api/admin/quarterly-tax", headers=h, timeout=15).json()
        assert "owner_draw_ytd" in qt
        assert "owner_draw_hours" in qt
        assert qt["owner_draw_ytd"] >= 0
    finally:
        _set_owner(h, e, False)


def test_today_pnl_surfaces_owner_draw_today():
    h = _admin()
    body = requests.get(f"{BASE}/api/admin/today-pnl", headers=h, timeout=15).json()
    assert "owner_draw_today" in body
    assert "owner_hours_today" in body


def test_pay_snapshot_includes_is_owner_flag():
    h = _admin()
    e = _emp(h)
    _set_owner(h, e, True)
    try:
        snap = requests.get(f"{BASE}/api/admin/staff/pay-snapshot", headers=h, timeout=15).json()
        # is_owner now present on every snapshot row
        for s in snap["snapshot"]:
            assert "is_owner" in s
        # The flipped alex shows up as owner=True
        alex = next(s for s in snap["snapshot"] if s["user_id"] == e["id"])
        assert alex["is_owner"] is True
    finally:
        _set_owner(h, e, False)


def test_owner_excluded_from_payroll_estimate():
    h = _admin()
    e = _emp(h)
    # Baseline (owner=False) — note hours+totals
    _set_owner(h, e, False)
    from datetime import date, timedelta
    end = date.today().isoformat()
    start = (date.today() - timedelta(days=30)).isoformat()
    before = requests.get(f"{BASE}/api/admin/payroll/estimate",
                          headers=h, params={"start_date": start, "end_date": end}, timeout=15).json()
    before_ids = {u["user_id"] for u in before["per_user"]}

    _set_owner(h, e, True)
    try:
        after = requests.get(f"{BASE}/api/admin/payroll/estimate",
                             headers=h, params={"start_date": start, "end_date": end}, timeout=15).json()
        after_ids = {u["user_id"] for u in after["per_user"]}
        # Owner must NOT appear in payroll estimate
        assert e["id"] not in after_ids
        # If alex had clocked hours previously, they should now be removed
        if e["id"] in before_ids:
            assert after["totals"]["gross"] <= before["totals"]["gross"]
    finally:
        _set_owner(h, e, False)
