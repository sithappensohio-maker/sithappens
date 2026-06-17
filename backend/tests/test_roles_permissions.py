"""Sprint 110ex — Phase 7: Roles & permissions regression."""
import os
import uuid
import pytest
import requests


BASE = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://sit-happens-crm.preview.emergentagent.com",
).rstrip("/")


@pytest.fixture(scope="module")
def admin_headers():
    r = requests.post(
        f"{BASE}/api/auth/login",
        json={"email": "admin@sithappens.com", "password": "admin123"},
        timeout=15,
    )
    r.raise_for_status()
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_admin_gets_full_permissions(admin_headers):
    r = requests.get(f"{BASE}/api/me/permissions", headers=admin_headers, timeout=15).json()
    assert r["role"] == "admin"
    assert r["staff_role"] == "owner"
    for k in ("settings", "finance_reports", "delete_records", "payroll", "data_export"):
        assert r["permissions"][k] is True, f"Owner must have {k} permission"


def test_roles_matrix_endpoint(admin_headers):
    r = requests.get(f"{BASE}/api/staff/roles", headers=admin_headers, timeout=15).json()
    assert set(r["roles"]) == {"owner", "manager", "trainer", "daycare_staff",
                                "boarding_staff", "front_desk", "read_only"}
    # 13 permission keys as documented
    assert len(r["permission_keys"]) == 13
    # Owner gets everything; read_only is locked down
    assert all(r["matrix"]["owner"].values())
    assert r["matrix"]["read_only"]["delete_records"] is False
    assert r["matrix"]["read_only"]["settings"] is False
    assert r["matrix"]["read_only"]["clients_view"] is True       # can see, can't edit
    # Trainer sees but can't touch settings/finance
    assert r["matrix"]["trainer"]["settings"] is False
    assert r["matrix"]["trainer"]["finance_reports"] is False
    assert r["matrix"]["trainer"]["incidents"] is True
    assert r["matrix"]["trainer"]["dogs_edit"] is True


def test_assign_role_and_permission_endpoint(admin_headers):
    suffix = uuid.uuid4().hex[:6]
    # Create an employee
    emp = requests.post(
        f"{BASE}/api/admin/employees", headers=admin_headers,
        json={
            "email": f"role-{suffix}@e.com",
            "password": "RoleTest1234",
            "name": f"RoleTest {suffix}",
            "display_name": "RT",
            "hourly_rate": 15.0,
            "tax_status": "1099",
            "phone": "5550000000",
            "address_street": "", "address_city": "", "address_state": "", "address_zip": "",
            "notes": "",
        },
        timeout=15,
    )
    if emp.status_code != 200:
        pytest.skip(f"Couldn't create employee: {emp.status_code} {emp.text}")
    eid = emp.json()["id"]
    try:
        # Default staff_role on a new employee
        listed = requests.get(f"{BASE}/api/admin/employees", headers=admin_headers, timeout=15).json()
        match = next((u for u in listed if u["id"] == eid), None)
        assert match is not None
        # Default to "read_only" so a freshly created account can't do anything destructive
        assert match["staff_role"] == "read_only"

        # Assign front_desk
        r = requests.put(
            f"{BASE}/api/staff/{eid}/role", headers=admin_headers,
            json={"staff_role": "front_desk"}, timeout=15,
        )
        r.raise_for_status()
        assert r.json()["staff_role"] == "front_desk"
        assert r.json()["permissions"]["clients_edit"] is True
        assert r.json()["permissions"]["finance_reports"] is False

        # Bad role rejected
        bad = requests.put(
            f"{BASE}/api/staff/{eid}/role", headers=admin_headers,
            json={"staff_role": "wizard"}, timeout=15,
        )
        assert bad.status_code == 400

        # The employee should now see those permissions via /me/permissions
        token = requests.post(
            f"{BASE}/api/auth/login",
            json={"email": f"role-{suffix}@e.com", "password": "RoleTest1234"},
            timeout=15,
        ).json()["token"]
        emp_headers = {"Authorization": f"Bearer {token}"}
        me = requests.get(f"{BASE}/api/me/permissions", headers=emp_headers, timeout=15).json()
        assert me["staff_role"] == "front_desk"
        assert me["permissions"]["clients_edit"] is True
        assert me["permissions"]["settings"] is False
        assert me["permissions"]["delete_records"] is False
    finally:
        requests.delete(f"{BASE}/api/admin/employees/{eid}", headers=admin_headers, timeout=15)
