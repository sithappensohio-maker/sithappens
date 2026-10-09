"""Per-employee permission overrides (2026-10-09): letting the owner grant
ONE specific employee an extra permission beyond what their role normally
gives them — e.g. a `daycare_staff` worker who should ALSO get Front Desk's
`sell_credits` (and/or `clients_edit`), without moving their whole role (and
every other daycare_staff worker) to `front_desk`.

`_perms_for` now layers role defaults -> role-matrix overrides
(`_apply_role_overrides`, admin-editable per role) -> per-user overrides
(`user["permission_overrides"]`, admin-editable per employee, this layer).
The owner's own two early-returns in `_perms_for` happen before the per-user
layer is ever consulted, so an owner's doc can never be locked out by a
stray `permission_overrides` entry — that's covered directly below with a
unit-level call into `server._perms_for`, not via HTTP.

Same pattern as test_booking_create_permission_gap.py / test_staff_
permission_gaps.py: real HTTP, real tokens (httpx.ASGITransport), so the
Depends()/in-body gate is what's under test.
"""
import datetime
import uuid

import httpx
import jwt
import pytest

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

TAG = "TEST_PERM_OVERRIDES"


def _matrix(overrides):
    run(server.db.settings.update_one({"id": "global"}, {"$set": {"staff_role_permissions": overrides}}, upsert=True))
    run(server._load_role_overrides_from_settings())


@pytest.fixture(autouse=True)
def _clean_overrides():
    prev = run(server.db.settings.find_one({"id": "global"}, {"_id": 0, "staff_role_permissions": 1})) or {}
    _matrix({})
    yield
    if "staff_role_permissions" in prev:
        run(server.db.settings.update_one({"id": "global"}, {"$set": {"staff_role_permissions": prev["staff_role_permissions"]}}))
    else:
        run(server.db.settings.update_one({"id": "global"}, {"$unset": {"staff_role_permissions": ""}}))
    run(server._load_role_overrides_from_settings())


def _mk_user(role, staff_role=None, client_id=None):
    uid = str(uuid.uuid4())
    doc = {"id": uid, "role": role, "name": f"{TAG} {staff_role or role}",
           "email": f"{TAG.lower()}-{uuid.uuid4().hex[:10]}@example.invalid",
           "password_hash": "x", "active": True, "token_version": 0}
    if staff_role:
        doc["staff_role"] = staff_role
    if client_id:
        doc["client_id"] = client_id
    run(server.db.users.insert_one(dict(doc)))
    now = datetime.datetime.now(datetime.timezone.utc)
    doc["_token"] = jwt.encode(
        {"sub": uid, "email": doc["email"], "role": role, "ver": 0, "iat": now,
         "exp": now + datetime.timedelta(hours=2), "type": "access"},
        server.JWT_SECRET, algorithm=server.JWT_ALG)
    return doc


def _call(method, path, user=None, json_body=None):
    async def _go():
        transport = httpx.ASGITransport(app=server.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as http:
            headers = {"Authorization": f"Bearer {user['_token']}"} if user else {}
            return await http.request(method, f"/api{path}", headers=headers, json=json_body)
    return run(_go())


def _cleanup(*, user_ids=()):
    if user_ids:
        run(server.db.users.delete_many({"id": {"$in": list(user_ids)}}))


def test_owner_grants_daycare_staff_an_extra_permission_and_it_takes_effect_immediately():
    # Verified against the REAL ROLE_PERMISSIONS["daycare_staff"] (read in
    # server.py around line 52975): clients_view/dogs_view/incidents/
    # care_complete/booking_edit/messages/take_payments/manage_events = True;
    # sell_credits and clients_edit are both False by default. take_payments
    # is already True for daycare_staff, so it's a bad choice to prove an
    # override does anything — use sell_credits and clients_edit instead,
    # both genuinely absent from the role.
    owner = _mk_user("admin")
    employee = _mk_user("employee", "daycare_staff")
    try:
        r = _call("PUT", f"/staff/{employee['id']}/permission-overrides", owner,
                   {"overrides": {"sell_credits": True, "clients_edit": True}})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["permission_overrides"] == {"sell_credits": True, "clients_edit": True}
        assert body["permissions"]["sell_credits"] is True
        assert body["permissions"]["clients_edit"] is True
        # Untouched role-default key stays as the role grants it.
        assert body["permissions"]["dogs_view"] is True
        # Neither the role nor the override grants this one.
        assert body["permissions"]["settings"] is False

        # And separately, the employee's OWN token sees it live via
        # GET /me/permissions (no restart, no re-login needed).
        r2 = _call("GET", "/me/permissions", employee)
        assert r2.status_code == 200, r2.text
        perms = r2.json()["permissions"]
        assert perms["sell_credits"] is True
        assert perms["clients_edit"] is True
        assert perms["dogs_view"] is True
        assert perms["settings"] is False
    finally:
        _cleanup(user_ids=[owner["id"], employee["id"]])


def test_a_non_owner_cannot_set_permission_overrides():
    non_owner = _mk_user("employee", "manager")
    employee = _mk_user("employee", "daycare_staff")
    try:
        r = _call("PUT", f"/staff/{employee['id']}/permission-overrides", non_owner,
                   {"overrides": {"sell_credits": True}})
        assert r.status_code == 403, r.text
    finally:
        _cleanup(user_ids=[non_owner["id"], employee["id"]])


def test_cannot_set_overrides_on_an_admin_account():
    owner = _mk_user("admin")
    other_admin = _mk_user("admin")
    try:
        r = _call("PUT", f"/staff/{other_admin['id']}/permission-overrides", owner,
                   {"overrides": {"sell_credits": True}})
        assert r.status_code == 400, r.text
        assert "staff accounts" in r.text.lower()
    finally:
        _cleanup(user_ids=[owner["id"], other_admin["id"]])


def test_owner_lockout_protection_per_user_overrides_never_consulted_for_an_owner():
    # Direct unit-level call — a fabricated user dict shaped like an owner
    # whose doc carries hostile permission_overrides. _perms_for must return
    # before ever looking at permission_overrides, by construction (both
    # owner early-returns fire first).
    fake_owner = {
        "role": "admin", "staff_role": "owner",
        "permission_overrides": {"take_payments": False, "settings": False, "delete_records": False},
    }
    perms = server._perms_for(fake_owner)
    for key in server.PERMISSION_KEYS:
        assert perms[key] is True, key

    # Same proof for the legacy-implicit-owner path (admin, no staff_role).
    fake_legacy_owner = {
        "role": "admin",
        "permission_overrides": {"take_payments": False, "settings": False},
    }
    perms2 = server._perms_for(fake_legacy_owner)
    for key in server.PERMISSION_KEYS:
        assert perms2[key] is True, key


def test_saving_an_empty_override_map_resets_the_employee_to_pure_role_defaults():
    owner = _mk_user("admin")
    employee = _mk_user("employee", "daycare_staff")
    try:
        r = _call("PUT", f"/staff/{employee['id']}/permission-overrides", owner,
                   {"overrides": {"sell_credits": True}})
        assert r.status_code == 200, r.text
        assert r.json()["permissions"]["sell_credits"] is True

        r2 = _call("GET", "/me/permissions", employee)
        assert r2.json()["permissions"]["sell_credits"] is True

        r3 = _call("PUT", f"/staff/{employee['id']}/permission-overrides", owner, {"overrides": {}})
        assert r3.status_code == 200, r3.text
        assert r3.json()["permission_overrides"] == {}
        assert r3.json()["permissions"]["sell_credits"] is False

        r4 = _call("GET", "/me/permissions", employee)
        assert r4.status_code == 200, r4.text
        assert r4.json()["permissions"]["sell_credits"] is False

        # Direct re-fetch-and-check too, matching the role default exactly.
        refetched = run(server.db.users.find_one({"id": employee["id"]}, {"_id": 0}))
        assert refetched["permission_overrides"] == {}
        assert server._perms_for(refetched) == server.ROLE_PERMISSIONS["daycare_staff"]
    finally:
        _cleanup(user_ids=[owner["id"], employee["id"]])


def test_unknown_keys_in_the_override_body_are_silently_dropped():
    owner = _mk_user("admin")
    employee = _mk_user("employee", "daycare_staff")
    try:
        r = _call("PUT", f"/staff/{employee['id']}/permission-overrides", owner,
                   {"overrides": {"not_a_real_key": True, "sell_credits": True}})
        assert r.status_code == 200, r.text
        assert r.json()["permission_overrides"] == {"sell_credits": True}
        assert "not_a_real_key" not in r.json()["permission_overrides"]

        refetched = run(server.db.users.find_one({"id": employee["id"]}, {"_id": 0}))
        assert refetched["permission_overrides"] == {"sell_credits": True}
        assert "not_a_real_key" not in refetched["permission_overrides"]
    finally:
        _cleanup(user_ids=[owner["id"], employee["id"]])


def test_putting_overrides_for_a_nonexistent_user_is_404():
    owner = _mk_user("admin")
    try:
        r = _call("PUT", f"/staff/{TAG}-nonexistent/permission-overrides", owner,
                   {"overrides": {"sell_credits": True}})
        assert r.status_code == 404, r.text
    finally:
        _cleanup(user_ids=[owner["id"]])
