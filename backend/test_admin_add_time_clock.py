"""The owner can add a whole shift an employee never punched in or out for.

Before this, the Staff screen could only edit or delete a punch that already
existed; a fully missed shift needed the employee to file a correction request.
POST /admin/time-clock adds it directly. It must count its hours like any
other shift (domains/staff/routes.shift_hours), be paid at the rate in force
when it is added (audit #24), and never pay the same time twice.

Disposable tag TEST_ADD_CLOCK.
"""
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

TAG = "TEST_ADD_CLOCK"
_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")


def _user(role="employee", rate=20.0, **extra):
    u = {"id": f"{TAG}-{uuid.uuid4().hex[:8]}", "email": f"{uuid.uuid4().hex[:8]}@example.com", "name": "Add QA",
         "role": role, "hourly_rate": rate, "active": True, "password_hash": "x", "token_version": 0, "tag": TAG, **extra}
    run(server.db.users.insert_one(dict(u)))
    return u


ADMIN = {"id": f"{TAG}-owner", "role": "admin", "name": "Owner", "email": "add-clock@test"}


def _add(emp, clock_in, clock_out, **extra):
    body = server.TimeClockAddIn(user_id=emp["id"], clock_in_at=clock_in, clock_out_at=clock_out, **extra)
    return run(server.admin_add_time_clock(body, ADMIN))


def _refused(emp, clock_in, clock_out, **extra):
    with pytest.raises(HTTPException) as caught:
        _add(emp, clock_in, clock_out, **extra)
    return caught.value


def _rows(emp):
    return run(server.db.time_clock_entries.find({"user_id": emp["id"]}, {"_id": 0}).to_list(50))


def _existing(emp, clock_in, clock_out, hours=None):
    e = {"id": f"{TAG}-e-{uuid.uuid4().hex[:6]}", "user_id": emp["id"], "user_name": "Add QA", "clock_in_at": clock_in,
         "clock_out_at": clock_out, "break_minutes": 0, "hours": hours, "created_at": server.now_iso(), "tag": TAG}
    run(server.db.time_clock_entries.insert_one(dict(e)))
    return e


def teardown_module(_m):
    ids = [u["id"] for u in run(server.db.users.find({"tag": TAG}, {"_id": 0, "id": 1}).to_list(500))]
    run(server.db.time_clock_entries.delete_many({"user_id": {"$in": ids}}))
    run(server.db.punch_corrections.delete_many({"user_id": {"$in": ids}}))
    run(server.db.users.delete_many({"tag": TAG}))


def test_a_missed_shift_is_added_with_its_hours_less_the_break_and_the_rate_in_force():
    emp = _user(rate=18.5)
    row = _add(emp, "2026-10-05T13:00:00.000Z", "2026-10-05T21:30:00.000Z", break_minutes=30, note="  forgot her badge ")
    assert row["hours"] == 8.0 and row["break_minutes"] == 30 and row["pay_rate"] == 18.5
    assert row["user_id"] == emp["id"] and row["user_name"] == "Add QA"
    assert row["added_by_admin_id"] == ADMIN["id"] and row["admin_note"] == "forgot her badge"
    assert "_id" not in row
    saved = _rows(emp)
    assert len(saved) == 1 and saved[0]["id"] == row["id"] and saved[0]["hours"] == 8.0
    # Stored the way a punched shift is stored, so every reader sorts and filters it the same.
    assert saved[0]["clock_in_at"] == "2026-10-05T13:00:00+00:00" and saved[0]["clock_out_at"] == "2026-10-05T21:30:00+00:00"


def test_the_added_shift_shows_on_the_admin_timecard_and_counts_as_paid_hours():
    emp = _user(rate=20.0)
    row = _add(emp, "2026-10-06T13:00:00Z", "2026-10-06T17:00:00Z")
    listing = run(server.admin_time_clock_list("2026-10-06", "2026-10-06", emp["id"], ADMIN))
    assert [e["id"] for e in listing["entries"]] == [row["id"]]
    assert listing["grand_hours"] == 4.0 and listing["grand_cost"] == 80.0
    from domains.staff.routes import paid_hours
    assert paid_hours(_rows(emp)[0]) == 4.0


def test_a_later_raise_does_not_move_the_added_shift_and_no_rate_is_not_stamped_as_zero():
    emp = _user(rate=20.0)
    row = _add(emp, "2026-10-06T13:00:00Z", "2026-10-06T17:00:00Z")
    run(server.db.users.update_one({"id": emp["id"]}, {"$set": {"hourly_rate": 30.0}}))
    listing = run(server.admin_time_clock_list("2026-10-06", "2026-10-06", emp["id"], ADMIN))
    assert listing["grand_cost"] == 80.0 and row["pay_rate"] == 20.0
    unpaid = _user(rate=0)
    assert "pay_rate" not in _add(unpaid, "2026-10-06T13:00:00Z", "2026-10-06T17:00:00Z")


def test_an_overnight_shift_and_an_admin_owner_login_are_both_fine():
    owner = _user(role="admin", rate=25.0)
    row = _add(owner, "2026-10-07T02:00:00Z", "2026-10-07T10:00:00Z")
    assert row["hours"] == 8.0


def test_a_shift_that_overlaps_one_already_on_the_timecard_is_refused():
    emp = _user()
    _existing(emp, "2026-10-08T13:00:00+00:00", "2026-10-08T21:00:00+00:00", hours=8.0)
    for clock_in, clock_out in (
        ("2026-10-08T12:00:00Z", "2026-10-08T14:00:00Z"),   # runs into the start
        ("2026-10-08T20:00:00Z", "2026-10-08T23:00:00Z"),   # starts before the end
        ("2026-10-08T14:00:00Z", "2026-10-08T15:00:00Z"),   # sits inside
        ("2026-10-08T12:00:00Z", "2026-10-08T22:00:00Z"),   # swallows it
        ("2026-10-08T13:00:00Z", "2026-10-08T21:00:00Z"),   # the very same shift again (a double tap)
    ):
        err = _refused(emp, clock_in, clock_out)
        assert err.status_code == 409 and "overlaps" in err.detail, (clock_in, clock_out)
    assert len(_rows(emp)) == 1


def test_a_shift_that_only_touches_another_is_allowed():
    emp = _user()
    _existing(emp, "2026-10-09T13:00:00+00:00", "2026-10-09T17:00:00+00:00", hours=4.0)
    _add(emp, "2026-10-09T09:00:00Z", "2026-10-09T13:00:00Z")    # ends as the other starts
    _add(emp, "2026-10-09T17:00:00Z", "2026-10-09T20:00:00Z")    # starts as the other ends
    assert len(_rows(emp)) == 3


def test_overlap_is_read_from_the_real_time_however_the_other_shift_was_written():
    emp = _user()
    _existing(emp, "2026-10-10T09:00:00-04:00", "2026-10-10T17:00:00-04:00", hours=8.0)   # 13:00–21:00 UTC
    assert _refused(emp, "2026-10-10T20:00:00Z", "2026-10-10T22:00:00Z").status_code == 409
    _add(emp, "2026-10-10T21:00:00Z", "2026-10-10T22:00:00Z")
    other = _user()
    _existing(other, "2026-10-10T13:00:00", "2026-10-10T21:00:00", hours=8.0)             # no offset reads as UTC
    assert _refused(other, "2026-10-10T20:59:00Z", "2026-10-10T22:00:00Z").status_code == 409


def test_a_shift_left_open_blocks_a_later_one_but_not_an_earlier_one():
    emp = _user()
    _existing(emp, "2026-10-12T13:00:00+00:00", None)
    err = _refused(emp, "2026-10-13T13:00:00Z", "2026-10-13T21:00:00Z")
    assert err.status_code == 409 and "never clocked out" in err.detail
    _add(emp, "2026-10-11T13:00:00Z", "2026-10-11T21:00:00Z")    # finished before the open one began
    blank = _user()
    _existing(blank, "2026-10-12T13:00:00+00:00", "")            # a correction can leave the clock-out blank
    assert _refused(blank, "2026-10-12T15:00:00Z", "2026-10-12T16:00:00Z").status_code == 409


def test_another_employees_shift_never_blocks():
    a, b = _user(), _user()
    _existing(a, "2026-10-14T13:00:00+00:00", "2026-10-14T21:00:00+00:00", hours=8.0)
    assert _add(b, "2026-10-14T13:00:00Z", "2026-10-14T21:00:00Z")["hours"] == 8.0


def test_times_that_cannot_be_a_real_finished_shift_are_refused():
    emp = _user()
    assert _refused(emp, "2026-10-15T21:00:00Z", "2026-10-15T13:00:00Z").status_code == 400      # ends before it starts
    assert _refused(emp, "2026-10-15T13:00:00Z", "2026-10-15T13:00:00Z").status_code == 400      # no length
    assert _refused(emp, "2026-10-15T13:00:00Z", "2026-10-16T13:01:00Z").status_code == 400      # past 24 hours
    assert _refused(emp, "not-a-time-at-all", "2026-10-15T13:00:00Z").status_code == 400
    assert _refused(emp, "2026-10-15T13:00:00Z", "2026-10-15T14:00:00Z", break_minutes=60).status_code == 400
    now = datetime.now(timezone.utc)
    future = _refused(emp, (now - timedelta(hours=2)).isoformat(), (now + timedelta(hours=2)).isoformat())
    assert future.status_code == 400 and "hasn't finished" in future.detail
    assert _rows(emp) == []


def test_a_negative_break_and_an_unknown_or_client_user_are_refused():
    with pytest.raises(ValidationError):
        server.TimeClockAddIn(user_id="x", clock_in_at="2026-10-15T13:00:00Z", clock_out_at="2026-10-15T14:00:00Z", break_minutes=-30)
    assert _refused({"id": f"{TAG}-nobody"}, "2026-10-15T13:00:00Z", "2026-10-15T14:00:00Z").status_code == 404
    client = _user(role="client")
    assert _refused(client, "2026-10-15T13:00:00Z", "2026-10-15T14:00:00Z").status_code == 404
    assert _rows(client) == []


def test_a_year_that_cannot_be_a_real_shift_is_refused_not_a_crash():
    emp = _user()
    assert _refused(emp, "0001-01-01T00:00:00+14:00", "0001-01-01T08:00:00+14:00").status_code == 400
    assert _refused(emp, "0001-01-01T00:00:00", "0001-01-01T08:00:00").status_code == 400
    assert _refused(emp, "9999-12-31T20:00:00-14:00", "9999-12-31T23:00:00-14:00").status_code == 400
    assert _rows(emp) == []


def test_the_same_shift_saved_twice_at_the_same_instant_is_on_the_timecard_at_most_once():
    import asyncio
    emp = _user()

    async def both():
        body = server.TimeClockAddIn(user_id=emp["id"], clock_in_at="2026-10-19T13:00:00Z", clock_out_at="2026-10-19T21:00:00Z")
        return await asyncio.gather(server.admin_add_time_clock(body, ADMIN), server.admin_add_time_clock(body, ADMIN), return_exceptions=True)

    results = run(both())
    saved = [r for r in results if isinstance(r, dict)]
    refused = [r for r in results if isinstance(r, HTTPException)]
    assert len(saved) + len(refused) == 2 and len(refused) >= 1 and all(r.status_code == 409 for r in refused), results
    rows = _rows(emp)
    assert len(rows) == len(saved) <= 1, rows


def _correction(emp, clock_in="", clock_out="", target="", status="pending"):
    c = {"id": f"{TAG}-c-{uuid.uuid4().hex[:6]}", "user_id": emp["id"], "user_name": "Add QA", "target_entry_id": target,
         "target_date": "2026-10-21", "requested_clock_in": clock_in, "requested_clock_out": clock_out, "reason": "forgot",
         "status": status, "created_at": server.now_iso()}
    run(server.db.punch_corrections.insert_one(dict(c)))
    return c


def test_a_shift_the_employee_already_asked_for_is_settled_on_corrections_not_added_twice():
    emp = _user()
    _correction(emp, "2026-10-21T13:00:00Z", "2026-10-21T21:00:00Z")
    err = _refused(emp, "2026-10-21T13:05:00Z", "2026-10-21T21:00:00Z")
    assert err.status_code == 409 and "punch correction" in err.detail
    assert _rows(emp) == []
    _add(emp, "2026-10-22T13:00:00Z", "2026-10-22T21:00:00Z")          # a different day is not held up
    # A request that names only one time still holds the shift it falls in.
    half = _user()
    _correction(half, clock_out="2026-10-21T21:00:00Z")
    assert _refused(half, "2026-10-21T13:00:00Z", "2026-10-21T21:00:00Z").status_code == 409
    # A request already decided, or one about an existing punch, holds nothing up.
    done = _user()
    _correction(done, "2026-10-21T13:00:00Z", "2026-10-21T21:00:00Z", status="denied")
    _correction(done, "2026-10-21T13:00:00Z", "2026-10-21T21:00:00Z", target="some-other-punch")
    assert _add(done, "2026-10-21T13:00:00Z", "2026-10-21T21:00:00Z")["hours"] == 8.0


def test_approving_a_missed_shift_request_over_a_shift_already_there_is_refused_and_stays_pending():
    emp = _user()
    c = _correction(emp, "2026-10-23T13:00:00Z", "2026-10-23T21:00:00Z")
    _existing(emp, "2026-10-23T13:00:00+00:00", "2026-10-23T21:00:00+00:00", hours=8.0)
    decide = lambda decision: run(server.employee_decide_punch_correction(c["id"], server.PunchCorrectionDecisionIn(decision=decision), ADMIN))
    with pytest.raises(HTTPException) as caught:
        decide("approved")
    assert caught.value.status_code == 409 and "overlaps" in caught.value.detail
    assert len(_rows(emp)) == 1
    assert run(server.db.punch_corrections.find_one({"id": c["id"]}, {"_id": 0}))["status"] == "pending"
    assert decide("denied")["status"] == "denied"
    assert len(_rows(emp)) == 1


def test_adding_and_editing_a_shift_are_named_in_the_audit_log():
    assert server._audit_action_for("POST", "/api/admin/time-clock") == "timeclock_edited"
    assert server._audit_action_for("PUT", "/api/admin/time-clock/abc") == "timeclock_edited"
    assert server._audit_action_for("DELETE", "/api/admin/time-clock/abc") == "timeclock_edited"


def test_only_an_admin_login_can_add_a_shift_over_http():
    emp = _user()
    token = server.create_access_token(emp["id"], emp["email"], emp["role"], server._token_version(emp))
    body = {"user_id": emp["id"], "clock_in_at": "2026-10-16T13:00:00Z", "clock_out_at": "2026-10-16T21:00:00Z"}
    assert run(_http.post("/api/admin/time-clock", json=body)).status_code in (401, 403)
    assert run(_http.post("/api/admin/time-clock", json=body, headers={"Authorization": f"Bearer {token}"})).status_code == 403
    assert _rows(emp) == []
    admin = _user(role="admin")
    admin_token = server.create_access_token(admin["id"], admin["email"], admin["role"], server._token_version(admin))
    ok = run(_http.post("/api/admin/time-clock", json=body, headers={"Authorization": f"Bearer {admin_token}"}))
    assert ok.status_code == 200, ok.text
    assert ok.json()["hours"] == 8.0 and ok.json()["added_by_admin_id"] == admin["id"]
