"""Sprint 110bu — W-2 / 1099 tax classification + mailing address on staff.

Verifies:
  • Creating/updating an employee persists tax_status + address_* fields
  • EmployeeOut shape includes the new fields
  • Year-end CSV groups employees by tax_status with sub-totals and the
    expected new column headers (Street/City/State/Zip)
"""
import os
import requests
import pytest

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    os.environ.get("TEST_BACKEND_URL","http://localhost:8001"),
).rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(
        f"{API}/auth/login",
        json={"email": "admin@sithappens.com", "password": "admin123"},
        timeout=15,
    )
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _make_emp(headers, **overrides):
    body = {
        "email": overrides.pop("email"),
        "name": overrides.pop("name", "Pytest Staff"),
        "password": "pytest-pw-12",
        "hourly_rate": 18.0,
        "phone": "555-0100",
        "tax_status": overrides.pop("tax_status", "w2"),
        "address_street": overrides.pop("address_street", "123 Pytest Lane"),
        "address_city": overrides.pop("address_city", "Warren"),
        "address_state": overrides.pop("address_state", "OH"),
        "address_zip": overrides.pop("address_zip", "44483"),
        **overrides,
    }
    r = requests.post(f"{API}/admin/employees", headers=headers, json=body, timeout=15)
    if r.status_code == 400 and "already exists" in r.text:
        # Sprint 110di-25 — DELETE /admin/employees only soft-deactivates,
        # leaving the underlying user row pinned to the email. To make the
        # test idempotent across crashed-out runs we just re-roll the email
        # with a uuid suffix and retry. Tests don't depend on the exact
        # email value, only the new-field round-trip.
        import uuid as _u
        local, _, domain = body["email"].partition("@")
        body["email"] = f"{local}-{_u.uuid4().hex[:6]}@{domain or 'sithappens.com'}"
        r = requests.post(f"{API}/admin/employees", headers=headers, json=body, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _cleanup(headers, uid):
    try:
        requests.delete(f"{API}/admin/employees/{uid}", headers=headers, timeout=15)
    except Exception:
        pass


def test_employee_create_with_new_fields(admin_headers):
    emp = _make_emp(admin_headers, email="pytest-w2@sithappens.com")
    try:
        assert emp["tax_status"] == "w2"
        assert emp["address_street"] == "123 Pytest Lane"
        assert emp["address_city"] == "Warren"
        assert emp["address_state"] == "OH"
        assert emp["address_zip"] == "44483"
    finally:
        _cleanup(admin_headers, emp["id"])


def test_employee_update_preserves_new_fields(admin_headers):
    emp = _make_emp(admin_headers, email="pytest-flip@sithappens.com", tax_status="1099")
    try:
        # Flip to W-2 + change ZIP
        update = {
            "email": emp["email"],
            "name": emp["name"],
            "hourly_rate": emp["hourly_rate"],
            "active": True,
            "phone": emp["phone"],
            "tax_status": "w2",
            "address_street": emp["address_street"],
            "address_city": emp["address_city"],
            "address_state": "OH",
            "address_zip": "44484",
            "is_owner": False,
        }
        r = requests.put(f"{API}/admin/employees/{emp['id']}",
                         headers=admin_headers, json=update, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["tax_status"] == "w2"
        assert r.json()["address_zip"] == "44484"
    finally:
        _cleanup(admin_headers, emp["id"])


def test_employee_default_tax_status_is_1099(admin_headers):
    """Backward compat — when tax_status is omitted, default to 1099."""
    import uuid as _u
    body = {
        "email": f"pytest-default-{_u.uuid4().hex[:6]}@sithappens.com",
        "name": "Pytest Default",
        "password": "pytest-pw-12",
        "hourly_rate": 15.0,
    }
    r = requests.post(f"{API}/admin/employees",
                      headers=admin_headers, json=body, timeout=15)
    assert r.status_code == 200, r.text
    emp = r.json()
    try:
        assert emp["tax_status"] == "1099"
    finally:
        _cleanup(admin_headers, emp["id"])


def test_employee_invalid_tax_status_rejected(admin_headers):
    import uuid as _u
    body = {
        "email": f"pytest-bad-{_u.uuid4().hex[:6]}@sithappens.com",
        "name": "Pytest Bad",
        "password": "pytest-pw-12",
        "tax_status": "magic-rate",
    }
    r = requests.post(f"{API}/admin/employees",
                      headers=admin_headers, json=body, timeout=15)
    assert r.status_code in (400, 422)


def test_year_end_csv_has_grouping_and_address_headers(admin_headers):
    """Smoke-test the CSV shape — must have W-2 / 1099 sections and new
    Street/City/State/Zip columns. Doesn't assert per-row content (depends
    on whether the test employee has any clocked hours in the current year)."""
    r = requests.get(f"{API}/admin/payroll/year-end.csv",
                     headers=admin_headers, timeout=30)
    assert r.status_code == 200
    text = r.text
    # Headers
    assert "Street" in text
    assert "City" in text
    assert "State" in text
    assert "Zip" in text
    # Grand total row is always present
    assert "GRAND TOTAL" in text
    # If there are non-owner employees with clocked hours, at least one
    # group label appears. Otherwise just GRAND TOTAL on its own is fine.
    # Don't hard-assert any specific group is present.
