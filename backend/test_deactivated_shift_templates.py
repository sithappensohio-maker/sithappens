"""A deactivated employee's shift templates do not generate shifts (audit #60). Deactivation
only flagged the user; the generator kept creating shifts from their templates. Goes over
HTTP. Disposable tag TEST_DEACT_TPL."""
import uuid
from datetime import date

import httpx

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

TAG = "TEST_DEACT_TPL"
_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")
MONDAY = date(2031, 6, 2)   # a Monday, far in the future


def _user(role, active=True):
    u = {"id": f"{TAG}-{uuid.uuid4().hex[:6]}", "email": f"{uuid.uuid4().hex[:8]}@example.com", "name": "Staff QA",
         "role": role, "password_hash": "x", "active": active, "tag": TAG}
    run(server.db.users.insert_one(dict(u)))
    return u


def _auth(u):
    return {"Authorization": f"Bearer {server.create_access_token(u['id'], u['email'], u['role'], server._token_version(u))}"}


def teardown_module():
    run(server.db.users.delete_many({"tag": TAG}))
    run(server.db.shift_templates.delete_many({"tag": TAG}))
    run(server.db.shifts.delete_many({"tag": TAG}))


def test_a_deactivated_employees_template_creates_no_shift():
    admin = _user("admin")
    gone = _user("employee", active=False)
    kept = _user("employee", active=True)
    for u in (gone, kept):
        run(server.db.shift_templates.insert_one({"id": f"{TAG}-tpl-{uuid.uuid4().hex[:6]}", "user_id": u["id"],
                                                  "day_of_week": 0, "start_time": "08:00", "end_time": "12:00",
                                                  "active": True, "tag": TAG}))

    async def scenario():
        return await _http.post("/api/admin/shifts/generate", headers=_auth(admin),
                                json={"start_date": MONDAY.isoformat(), "end_date": MONDAY.isoformat()})
    res = run(scenario())
    assert res.status_code == 200, res.text
    assert run(server.db.shifts.count_documents({"user_id": gone["id"]})) == 0
    assert run(server.db.shifts.count_documents({"user_id": kept["id"]})) == 1


def test_a_deactivated_employees_existing_shift_is_not_counted_in_readiness():
    """Shifts already on the schedule stop counting once the employee is deactivated (audit #60)."""
    admin = _user("admin")
    gone = _user("employee", active=False)
    kept = _user("employee", active=True)
    for u in (gone, kept):
        run(server.db.shifts.insert_one({"id": f"{TAG}-sh-{uuid.uuid4().hex[:6]}", "user_id": u["id"], "date": MONDAY.isoformat(),
                                         "start_time": "08:00", "end_time": "12:00", "source": "manual", "status": "scheduled",
                                         "tag": TAG}))

    async def scenario():
        return await _http.get(f"/api/admin/staff/readiness?date={MONDAY.isoformat()}", headers=_auth(admin))
    res = run(scenario())
    assert res.status_code == 200, res.text
    body = res.json()
    scheduled_ids = {row.get("user_id") for row in body["scheduled"]}
    assert gone["id"] not in scheduled_ids, "a deactivated employee's shift is not on the readiness list"
    assert kept["id"] in scheduled_ids, "an active employee's shift still is"
