"""A shift is paid at the rate in force when it was worked (audit #24). Clock-in stamps the employee's rate
on the shift, so a later raise does not move past pay; a shift with no stamp keeps the live rate; a rate of
zero is not stamped. Goes over HTTP for the staff and admin readers. Disposable tag TEST_PAY_RATE. Each test
makes its own employee, so no other test's shifts are counted."""
import uuid
from datetime import datetime, timedelta, timezone

import httpx

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

TAG = "TEST_PAY_RATE"
_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")


def _employee(rate):
    u = {"id": f"{TAG}-{uuid.uuid4().hex[:8]}", "email": f"{uuid.uuid4().hex[:8]}@example.com", "name": "Pay QA",
         "role": "employee", "hourly_rate": rate, "active": True, "password_hash": "x", "token_version": 0, "tag": TAG}
    run(server.db.users.insert_one(dict(u)))
    return u


def _admin():
    u = {"id": f"{TAG}-admin-{uuid.uuid4().hex[:6]}", "email": f"{uuid.uuid4().hex[:8]}@example.com", "name": "Pay Admin",
         "role": "admin", "password_hash": "x", "active": True, "token_version": 0, "tag": TAG}
    run(server.db.users.insert_one(dict(u)))
    return u


def _auth(u):
    return {"Authorization": f"Bearer {server.create_access_token(u['id'], u['email'], u['role'], server._token_version(u))}"}


def _shift(user, hours, rate_stamp=None, days_ago=1):
    when = datetime.now(timezone.utc) - timedelta(days=days_ago)
    doc = {"id": f"{TAG}-s-{uuid.uuid4().hex[:8]}", "user_id": user["id"], "user_name": "Pay QA",
           "clock_in_at": when.isoformat(), "clock_out_at": (when + timedelta(hours=hours)).isoformat(),
           "break_minutes": 0, "hours": float(hours), "tag": TAG}
    if rate_stamp is not None:
        doc["pay_rate"] = rate_stamp
    run(server.db.time_clock_entries.insert_one(doc))
    return doc


def teardown_module():
    run(server.db.time_clock_entries.delete_many({"tag": TAG}))
    run(server.db.users.delete_many({"tag": TAG}))


def _me(user):
    return run(_http.get("/api/time-clock/me", headers=_auth(user), params={"days": 400})).json()


def test_clock_in_stamps_the_rate_in_force():
    emp = _employee(20.0)
    res = run(_http.post("/api/time-clock/clock-in", headers=_auth(emp), json={}))
    assert res.status_code == 200, res.text
    row = run(server.db.time_clock_entries.find_one({"id": res.json()["id"]}, {"_id": 0}))
    assert row["pay_rate"] == 20.0


def test_a_raise_does_not_move_a_stamped_shift():
    emp = _employee(20.0)
    shift = _shift(emp, 8, rate_stamp=20.0)
    run(server.db.users.update_one({"id": emp["id"]}, {"$set": {"hourly_rate": 30.0}}))
    body = _me(emp)
    row = next(e for e in body["entries"] if e["id"] == shift["id"])
    assert row["gross"] == 160.0
    assert body["ytd"]["gross"] == 160.0


def test_a_shift_with_no_stamp_keeps_the_live_rate():
    emp = _employee(20.0)
    shift = _shift(emp, 8)   # worked before the stamp existed
    row = next(e for e in _me(emp)["entries"] if e["id"] == shift["id"])
    assert row["gross"] == 160.0 and row["hourly_rate"] == 20.0


def test_a_zero_rate_is_not_stamped_so_a_later_rate_applies():
    emp = _employee(0.0)
    res = run(_http.post("/api/time-clock/clock-in", headers=_auth(emp), json={}))
    row = run(server.db.time_clock_entries.find_one({"id": res.json()["id"]}, {"_id": 0}))
    assert "pay_rate" not in row, "a shift clocked in before a rate was set must not lock at $0"
    run(server.db.users.update_one({"id": emp["id"]}, {"$set": {"hourly_rate": 20.0}}))
    run(server.db.time_clock_entries.update_one({"id": row["id"]}, {"$set": {"clock_out_at": server.now_iso(), "hours": 8.0}}))
    shift = next(e for e in _me(emp)["entries"] if e["id"] == row["id"])
    assert shift["gross"] == 160.0


def test_a_mixed_period_pays_each_shift_at_its_own_rate():
    emp = _employee(30.0)
    _shift(emp, 3, rate_stamp=20.0)
    _shift(emp, 2, rate_stamp=30.0, days_ago=2)
    _shift(emp, 1, days_ago=3)   # unstamped: the live rate, 30
    body = _me(emp)
    assert body["ytd"]["hours"] == 6.0
    assert body["ytd"]["gross"] == 150.0   # 3 x 20 + 2 x 30 + 1 x 30


def test_admin_time_clock_prices_each_shift_and_shows_its_own_cost():
    emp = _employee(30.0)
    stamped = _shift(emp, 3, rate_stamp=20.0)
    admin = _admin()
    start = (datetime.now(timezone.utc) - timedelta(days=5)).date().isoformat()
    end = datetime.now(timezone.utc).date().isoformat()
    body = run(_http.get("/api/admin/time-clock", headers=_auth(admin), params={"start_date": start, "end_date": end, "user_id": emp["id"]})).json()
    row = next(e for e in body["entries"] if e["id"] == stamped["id"])
    assert row["cost"] == 60.0, "the shift's own cost, not hours times today's rate"


def test_the_employee_pay_snapshot_uses_each_shift_rate_in_its_window():
    emp = _employee(30.0)
    _shift(emp, 4, rate_stamp=20.0)
    admin = _admin()
    snap = run(_http.get("/api/admin/staff/pay-snapshot", headers=_auth(admin))).json()
    mine = next((s for s in snap["snapshot"] if s["user_id"] == emp["id"]), None)
    assert mine is not None
    assert mine["ytd_gross"] == 80.0


def test_the_payroll_estimate_prices_a_mixed_period_per_shift():
    emp = _employee(30.0)
    _shift(emp, 3, rate_stamp=20.0)
    _shift(emp, 2, rate_stamp=30.0, days_ago=2)
    _shift(emp, 1, days_ago=3)
    admin = _admin()
    start = (datetime.now(timezone.utc) - timedelta(days=5)).date().isoformat()
    end = datetime.now(timezone.utc).date().isoformat()
    body = run(_http.get("/api/admin/payroll/estimate", headers=_auth(admin), params={"start_date": start, "end_date": end})).json()
    mine = next(p for p in body["per_user"] if p["user_id"] == emp["id"])
    assert mine["gross"] == 150.0
    assert mine["hours"] == 6.0


def test_the_priced_payroll_tax_matches_the_old_one_on_single_rate_pay():
    tax = run(server._get_payroll_tax_settings())
    for hours, rate, ytd in ((40.0, 25.0, 0.0), (37.5, 18.75, 20000.0), (12.3, 31.0, 160000.0)):
        old = server._compute_payroll_tax(hours, rate, ytd, tax)
        new = server._compute_payroll_tax_on_gross(round(hours * rate, 2), ytd, tax)
        assert old == new
