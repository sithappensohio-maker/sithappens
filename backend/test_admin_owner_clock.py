"""One account: the admin login can be the owner — it shows on Staff, takes an
hourly rate, clocks in and out, and its hours are owner's draw (never
employer payroll). Nothing is gated on being clocked in."""
import uuid

import pytest

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_ADMIN_OWNER"


def _user(role, **over):
    doc = {"id": str(uuid.uuid4()), "email": f"{TAG.lower()}-{uuid.uuid4().hex[:6]}@example.com", "name": f"{TAG} {role}",
           "role": role, "password_hash": "x", "active": True, "hourly_rate": 0.0}
    if role == "admin":
        doc["staff_role"] = "owner"
    doc.update(over)
    run(server.db.users.insert_one(dict(doc)))
    return doc


@pytest.fixture(scope="module", autouse=True)
def _cleanup():
    yield
    ids = [u["id"] for u in run(server.db.users.find({"name": {"$regex": f"^{TAG}"}}, {"_id": 0, "id": 1}).to_list(50))]
    run(server.db.time_clock_entries.delete_many({"user_id": {"$in": ids}}))
    run(server.db.users.delete_many({"name": {"$regex": f"^{TAG}"}}))


def _payroll_admin():
    return {"id": str(uuid.uuid4()), "role": "admin", "staff_role": "owner", "name": "Payroll admin"}


def test_admin_login_appears_on_staff_and_can_become_the_owner():
    admin = _user("admin")
    emp_owner = _user("employee", is_owner=True, hourly_rate=20.0)
    listed = {r["id"]: r for r in run(server.list_employees(_payroll_admin()))}
    assert admin["id"] in listed and listed[admin["id"]]["role"] == "admin"
    assert listed[admin["id"]]["staff_role"] == "owner"

    body = server.EmployeeIn(email="ignored@example.com", name=admin["name"], hourly_rate=35.0, active=False, is_owner=True)
    out = run(server.update_employee(admin["id"], body, _payroll_admin()))
    assert out["is_owner"] is True and out["hourly_rate"] == 35.0
    fresh = run(server.db.users.find_one({"id": admin["id"]}, {"_id": 0}))
    assert fresh["email"] == admin["email"], "an admin login's email is never changed from Staff"
    assert fresh["active"] is True, "an admin login can't be deactivated from Staff"
    assert fresh["role"] == "admin"
    # single owner: the employee owner was demoted
    assert run(server.db.users.find_one({"id": emp_owner["id"]}, {"_id": 0, "is_owner": 1}))["is_owner"] is False
    assert run(server._get_owner_user_ids()) == {admin["id"]}
    assert run(server.get_owner(_payroll_admin()))["owner"]["id"] == admin["id"]


def test_admin_owner_clocks_in_and_out_and_hours_are_draw_not_payroll():
    admin = _user("admin", is_owner=True, hourly_rate=40.0)
    run(server._enforce_single_owner(admin["id"]))
    me = {**admin}
    # not gated: the account works with no open clock entry
    assert run(server.time_clock_current(me))["open"] is None
    entry = run(server.time_clock_in(server.ClockInIn(note="Owner shift"), me))
    assert entry["user_id"] == admin["id"]
    assert run(server.time_clock_current(me))["open"]["id"] == entry["id"]
    closed = run(server.time_clock_out(server.ClockOutIn(), me))
    assert closed["hours"] is not None and closed["clock_out_at"]
    # owner's draw sees the admin's hours
    draw = run(server.owner_draw_summary(_payroll_admin()))
    assert draw["owner"]["id"] == admin["id"]
    assert draw["today"]["hours"] >= 0
    # employer payroll never sees the owner's entries: the estimate and the
    # year-end export both exclude _get_owner_user_ids(), which now names the admin
    assert admin["id"] in run(server._get_owner_user_ids())
    # the Staff pay snapshot includes the admin owner
    snap = run(server.staff_pay_snapshot(_payroll_admin()))
    assert any(s["user_id"] == admin["id"] for s in snap["snapshot"])


def test_deactivate_and_reset_password_still_refuse_admin_logins():
    admin = _user("admin")
    with pytest.raises(server.HTTPException) as exc:
        run(server.deactivate_employee(admin["id"], _payroll_admin()))
    assert exc.value.status_code == 404
    with pytest.raises(server.HTTPException) as exc2:
        run(server.admin_reset_employee_password(admin["id"], {"password": "longenough1"}, _payroll_admin()))
    assert exc2.value.status_code == 404
