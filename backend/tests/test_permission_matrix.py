"""Sprint 110di-20 — Staff Permission Matrix UI backend contract.

Pins:
- GET /api/staff/roles returns roles[], permission_keys[], matrix, defaults, overrides.
- PUT /api/staff/roles/{role}/permissions persists overrides.
- Owner role is immutable (PUT returns 400).
- Non-admin caller cannot edit the matrix.
- Override persists across calls and is reflected in matrix.
"""
import os
import uuid
import bcrypt
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://sit-happens-crm.preview.emergentagent.com",
).rstrip("/")


def _admin_h():
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": "admin@sithappens.com", "password": "admin123"}, timeout=15)
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_get_staff_roles_returns_full_matrix():
    h = _admin_h()
    r = requests.get(f"{BASE_URL}/api/staff/roles", headers=h, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    for k in ("roles", "permission_keys", "matrix", "defaults", "overrides"):
        assert k in body, f"missing {k}"
    # Spec: 7 roles, 14 keys
    assert "owner" in body["roles"]
    assert "trainer" in body["roles"]
    assert len(body["permission_keys"]) == 14
    # Owner always has all perms in the matrix
    for k in body["permission_keys"]:
        assert body["matrix"]["owner"][k] is True


def test_put_role_permissions_persists_and_overrides_defaults():
    h = _admin_h()
    # Grant trainer finance_reports
    r = requests.put(f"{BASE_URL}/api/staff/roles/trainer/permissions", headers=h,
                     json={"permissions": {"finance_reports": True, "clients_view": True, "dogs_view": True,
                                            "dogs_edit": True, "care_complete": True, "booking_edit": True,
                                            "messages": True, "incidents": True}}, timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["permissions"]["finance_reports"] is True
    # Confirm matrix endpoint reflects it
    r2 = requests.get(f"{BASE_URL}/api/staff/roles", headers=h, timeout=15)
    assert r2.json()["matrix"]["trainer"]["finance_reports"] is True
    assert "trainer" in r2.json()["overrides"]
    # Revert
    requests.put(f"{BASE_URL}/api/staff/roles/trainer/permissions", headers=h,
                 json={"permissions": {"clients_view": True, "dogs_view": True, "dogs_edit": True,
                                       "care_complete": True, "booking_edit": True, "messages": True,
                                       "incidents": True}}, timeout=15)


def test_owner_role_immutable():
    h = _admin_h()
    r = requests.put(f"{BASE_URL}/api/staff/roles/owner/permissions", headers=h,
                     json={"permissions": {"settings": False}}, timeout=15)
    assert r.status_code == 400, r.text
    assert "immutable" in r.json().get("detail", "").lower()


def test_unknown_role_rejected():
    h = _admin_h()
    r = requests.put(f"{BASE_URL}/api/staff/roles/superuser/permissions", headers=h,
                     json={"permissions": {"settings": True}}, timeout=15)
    assert r.status_code == 400


def test_non_admin_cannot_edit_matrix():
    """Seed an employee, log in, try to PUT — must 403."""
    import os
    from motor.motor_asyncio import AsyncIOMotorClient
    from dotenv import load_dotenv
    import asyncio
    from datetime import datetime, timezone
    load_dotenv("/app/backend/.env")
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]

    async def seed():
        email = f"permtest-{uuid.uuid4().hex[:6]}@example.com"
        now = datetime.now(timezone.utc).isoformat()
        uid = str(uuid.uuid4())
        await db.users.insert_one({
            "id": uid, "email": email, "name": "Perm Test", "role": "employee",
            "staff_role": "trainer",
            "password_hash": bcrypt.hashpw(b"perm1234", bcrypt.gensalt()).decode(),
            "created_at": now,
        })
        return email

    email = asyncio.run(seed())
    try:
        login = requests.post(f"{BASE_URL}/api/auth/login",
                              json={"email": email, "password": "perm1234"}, timeout=15)
        assert login.status_code == 200, login.text
        h = {"Authorization": f"Bearer {login.json()['token']}"}
        r = requests.put(f"{BASE_URL}/api/staff/roles/trainer/permissions",
                         headers=h, json={"permissions": {"finance_reports": True}}, timeout=15)
        assert r.status_code in (401, 403), r.text
    finally:
        async def cleanup():
            from motor.motor_asyncio import AsyncIOMotorClient as _MC
            db2 = _MC(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
            await db2.users.delete_many({"email": email})
        asyncio.run(cleanup())


def test_default_state_matches_role_permissions_baseline():
    """Daycare staff role default permission set is preserved."""
    h = _admin_h()
    body = requests.get(f"{BASE_URL}/api/staff/roles", headers=h, timeout=15).json()
    ds = body["matrix"]["daycare_staff"]
    assert ds["care_complete"] is True
    assert ds["settings"] is False
    assert ds["finance_reports"] is False
