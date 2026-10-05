"""A sole proprietor's own hours are a draw out of profit, never labor (audit #19): the income summary's
labor, the P&L payroll range and today's P&L labor leave the owner out, and the owner's shifts never add
employer tax. Compared before and after an owner shift in the same window, so the test does not depend on
the payroll tax settings. Disposable tag TEST_OWNER_LABOR, far-future dates."""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import pl_report
import server
from _test_loop import run

TAG = "TEST_OWNER_LABOR"
DAY = "2031-09-10"
ADMIN = {"id": f"{TAG}-admin", "role": "admin", "name": "Owner QA", "email": "owner-labor@test"}


def _user(role, owner=False, rate=20.0):
    u = {"id": f"{TAG}-{uuid.uuid4().hex[:6]}", "email": f"{uuid.uuid4().hex[:8]}@example.com", "name": "QA",
         "role": role, "is_owner": owner, "hourly_rate": rate, "active": True, "password_hash": "x", "tag": TAG}
    run(server.db.users.insert_one(dict(u)))
    return u


def _shift(user, hours):
    doc = {"id": f"{TAG}-s-{uuid.uuid4().hex[:8]}", "user_id": user["id"], "user_name": "QA",
           "clock_in_at": f"{DAY}T14:00:00+00:00", "clock_out_at": f"{DAY}T{14 + int(hours):02d}:00:00+00:00",
           "break_minutes": 0, "hours": float(hours), "tag": TAG}
    run(server.db.time_clock_entries.insert_one(doc))


def teardown_module():
    run(server.db.time_clock_entries.delete_many({"tag": TAG}))
    run(server.db.users.delete_many({"tag": TAG}))


def test_the_owners_hours_are_not_in_the_payroll_range():
    emp = _user("employee")
    _shift(emp, 4)
    before = run(pl_report._compute_payroll_for_range(server.db, DAY, DAY))
    owner = _user("admin", owner=True, rate=60.0)
    _shift(owner, 8)
    after = run(pl_report._compute_payroll_for_range(server.db, DAY, DAY))
    assert all(p["user_id"] != owner["id"] for p in after["per_employee"])
    assert after["total_hours"] == before["total_hours"]
    assert after["total_cost"] == before["total_cost"]


def test_the_owners_hours_are_not_labor_in_the_income_summary():
    emp = _user("employee")
    _shift(emp, 4)
    before = run(server.summary_range(ADMIN, start_date=DAY, end_date=DAY))
    owner = _user("admin", owner=True, rate=60.0)
    _shift(owner, 8)
    after = run(server.summary_range(ADMIN, start_date=DAY, end_date=DAY))
    assert after["labor_total"] == before["labor_total"]
    assert after["labor_total"] > 0
