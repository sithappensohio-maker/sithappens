"""A permission change applies on every request, in every worker (audit #7:
"Changes to staff permissions apply to only half the server, so a revoked
permission keeps working at random"). The matrix used to be held in each
process and reloaded only where it was saved. Here a second process still holds
the old rules; the next request must refuse on the saved matrix. Disposable tag
TEST_PERM_MATRIX."""
import datetime
import uuid

import httpx
import jwt
import pytest

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

TAG = "TEST_PERM_MATRIX"


@pytest.fixture()
def staff_matrix():
    prev = run(server.db.settings.find_one({"id": "global"}, {"_id": 0, "staff_role_permissions": 1})) or {}
    run(server.db.settings.update_one({"id": "global"}, {"$set": {
        "staff_role_permissions": {"front_desk": {"finance_reports": True}}}}, upsert=True))
    run(server._load_role_overrides_from_settings())
    yield
    if "staff_role_permissions" in prev:
        run(server.db.settings.update_one({"id": "global"}, {"$set": {"staff_role_permissions": prev["staff_role_permissions"]}}))
    else:
        run(server.db.settings.update_one({"id": "global"}, {"$unset": {"staff_role_permissions": ""}}))
    run(server._load_role_overrides_from_settings())


def _admin_token():
    uid = f"{TAG}-{uuid.uuid4().hex[:6]}"
    run(server.db.users.insert_one({"id": uid, "role": "admin", "staff_role": "front_desk", "name": TAG,
                                    "email": f"{uid}@example.com", "password_hash": "x", "active": True, "token_version": 0}))
    now = datetime.datetime.now(datetime.timezone.utc)
    token = jwt.encode({"sub": uid, "email": f"{uid}@example.com", "role": "admin", "ver": 0, "iat": now,
                        "exp": now + datetime.timedelta(hours=2), "type": "access"}, server.JWT_SECRET, algorithm=server.JWT_ALG)
    return uid, token


def _get(token):
    async def _go():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test") as http:
            return await http.get("/api/retail-sales", params={"start_date": "2031-01-01", "end_date": "2031-01-01"},
                                  headers={"Authorization": f"Bearer {token}"})
    return run(_go())


def test_a_revoked_permission_is_refused_even_by_a_worker_holding_the_old_rules(staff_matrix):
    uid, token = _admin_token()
    try:
        assert _get(token).status_code == 200, "granted: the front desk can read finance"
        # The owner revokes it in the saved matrix. This worker still holds the old rules,
        # as the other worker would after its own save.
        run(server.db.settings.update_one({"id": "global"}, {"$set": {"staff_role_permissions": {"front_desk": {"finance_reports": False}}}}))
        server._ROLE_OVERRIDES = {"front_desk": {"finance_reports": True}}
        assert _get(token).status_code == 403, "the saved matrix decides, not this worker's copy"
    finally:
        run(server.db.users.delete_many({"id": uid}))
