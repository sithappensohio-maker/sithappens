"""Sprint 110bf extra coverage:
Confirm owner is filtered out of payroll/csv and year-end payroll CSV exports,
and that flipping is_owner=True increases quarterly-tax net_profit vs the
same data with is_owner=False (owner hours dropped from labor_gross+burden).
"""
import io
import csv
import os
from datetime import date, timedelta

import requests

BASE = os.environ.get("API_URL", "https://sit-happens-crm.preview.emergentagent.com")


def _admin():
    r = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": "admin@sithappens.com", "password": "admin123"},
        timeout=15,
    )
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _emp(h):
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
    r = requests.put(
        f"{BASE}/api/admin/employees/{emp['id']}",
        headers=h, json=body, timeout=15,
    )
    assert r.status_code == 200, r.text
    return r.json()


def test_payroll_csv_excludes_owner():
    h = _admin()
    e = _emp(h)
    end = date.today().isoformat()
    start = (date.today() - timedelta(days=60)).isoformat()
    _set_owner(h, e, True)
    try:
        r = requests.get(
            f"{BASE}/api/admin/payroll/csv",
            headers=h, params={"start_date": start, "end_date": end}, timeout=20,
        )
        assert r.status_code == 200, r.text
        reader = csv.reader(io.StringIO(r.text))
        rows = list(reader)
        assert len(rows) >= 1  # header row
        # No row should match owner's email
        for row in rows[1:]:
            joined = ",".join(row).lower()
            assert e["email"].lower() not in joined, (
                f"Owner appeared in payroll CSV row: {row}"
            )
    finally:
        _set_owner(h, e, False)


def test_year_end_payroll_csv_excludes_owner():
    h = _admin()
    e = _emp(h)
    _set_owner(h, e, True)
    try:
        year = date.today().year
        r = requests.get(
            f"{BASE}/api/admin/payroll/year-end.csv",
            headers=h, params={"year": year}, timeout=20,
        )
        # Endpoint may require/accept different params — accept 200 or 422.
        if r.status_code == 422:
            # Try with no params
            r = requests.get(
                f"{BASE}/api/admin/payroll/year-end.csv",
                headers=h, timeout=20,
            )
        assert r.status_code == 200, r.text
        body = r.text.lower()
        assert e["email"].lower() not in body, "Owner present in year-end CSV"
    finally:
        _set_owner(h, e, False)


def test_quarterly_tax_net_profit_higher_with_owner():
    """Setting is_owner=True should drop owner hours out of labor_gross+burden,
    so net_profit should be >= the same dataset with is_owner=False."""
    h = _admin()
    e = _emp(h)
    _set_owner(h, e, False)
    qt_off = requests.get(f"{BASE}/api/admin/quarterly-tax", headers=h, timeout=15).json()
    _set_owner(h, e, True)
    try:
        qt_on = requests.get(f"{BASE}/api/admin/quarterly-tax", headers=h, timeout=15).json()
        # Owner draw fields must exist
        assert "owner_draw_ytd" in qt_on
        # Net profit should not decrease when owner is excluded from labor cost
        assert qt_on["net_profit"] >= qt_off["net_profit"] - 0.01, (
            f"net_profit dropped: off={qt_off['net_profit']} on={qt_on['net_profit']}"
        )
    finally:
        _set_owner(h, e, False)


def test_owner_endpoint_shape_when_set_and_unset():
    h = _admin()
    e = _emp(h)
    _set_owner(h, e, False)
    body = requests.get(f"{BASE}/api/admin/owner", headers=h, timeout=15).json()
    assert body.get("owner") is None
    _set_owner(h, e, True)
    try:
        body = requests.get(f"{BASE}/api/admin/owner", headers=h, timeout=15).json()
        assert body["owner"]["id"] == e["id"]
        assert body["owner"]["is_owner"] is True
        # crown/badge-displayable info — should at least have name + email
        assert body["owner"].get("email") == e["email"]
    finally:
        _set_owner(h, e, False)
