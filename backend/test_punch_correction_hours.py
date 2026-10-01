"""An approved punch correction counts on pay (audit #48).

Approving a staff member's missed-punch fix changed the times but never
worked the hours out again, so a forgotten clock-out counted 0 hours, a
corrected clock-in kept the old hours, and a whole missed shift counted 0 —
while the year-end file (which reads the times) did count them. Approval now
uses the same rule as editing a shift (domains/staff/routes.shift_hours).

Disposable tag TEST_PUNCH_HOURS.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

TAG = "TEST_PUNCH_HOURS"
ADMIN = {"id": f"{TAG}-owner", "role": "admin", "name": "Owner", "email": "punch-hours@test"}


def _entry(**extra):
    e = {"id": f"{TAG}-e-{uuid.uuid4().hex[:6]}", "user_id": f"{TAG}-staff", "user_name": "Sam", "clock_in_at": "2026-09-28T12:00:00+00:00",
         "clock_out_at": None, "break_minutes": 0, "hours": None, "created_at": server.now_iso(), **extra}
    run(server.db.time_clock_entries.insert_one(dict(e)))
    return e


def _correction(target="", clock_in="", clock_out=""):
    c = {"id": f"{TAG}-c-{uuid.uuid4().hex[:6]}", "user_id": f"{TAG}-staff", "user_name": "Sam", "target_entry_id": target,
         "target_date": "2026-09-28", "requested_clock_in": clock_in, "requested_clock_out": clock_out, "reason": "forgot",
         "status": "pending", "created_at": server.now_iso()}
    run(server.db.punch_corrections.insert_one(dict(c)))
    return c


def _decide(c, decision="approved"):
    return run(server.employee_decide_punch_correction(c["id"], server.PunchCorrectionDecisionIn(decision=decision), ADMIN))


def _get(eid):
    return run(server.db.time_clock_entries.find_one({"id": eid}, {"_id": 0}))


def teardown_module(_m):
    run(server.db.time_clock_entries.delete_many({"user_id": f"{TAG}-staff"}))
    run(server.db.punch_corrections.delete_many({"user_id": f"{TAG}-staff"}))


def test_a_forgotten_clock_out_fixed_by_approval_counts_its_hours_less_the_break():
    e = _entry(break_minutes=30)
    _decide(_correction(target=e["id"], clock_out="2026-09-28T20:30:00Z"))
    assert _get(e["id"])["hours"] == 8.0


def test_a_corrected_clock_in_replaces_the_old_hours():
    e = _entry(clock_out_at="2026-09-28T20:00:00+00:00", hours=8.0)
    _decide(_correction(target=e["id"], clock_in="2026-09-28T13:00:00Z"))
    assert _get(e["id"])["hours"] == 7.0


def test_a_whole_missed_shift_added_by_approval_counts_its_hours():
    c = _correction(clock_in="2026-09-28T14:00:00Z", clock_out="2026-09-28T18:15:00Z")
    _decide(c)
    row = run(server.db.time_clock_entries.find_one({"corrected_via_request_id": c["id"]}, {"_id": 0}))
    assert row["hours"] == 4.25 and row["break_minutes"] == 0


def test_a_shift_still_open_stays_open_and_a_denied_one_is_untouched():
    still_open = _entry()
    _decide(_correction(target=still_open["id"], clock_in="2026-09-28T13:00:00Z"))
    after = _get(still_open["id"])
    assert after["clock_in_at"] == "2026-09-28T13:00:00Z" and after["hours"] is None
    closed = _entry(clock_out_at="2026-09-28T20:00:00+00:00", hours=8.0)
    _decide(_correction(target=closed["id"], clock_in="2026-09-28T15:00:00Z"), decision="denied")
    assert _get(closed["id"])["hours"] == 8.0


def test_the_rule_in_one_place():
    from domains.staff.routes import shift_hours
    assert shift_hours("2026-09-28T12:00:00+00:00", "2026-09-28T20:30:00Z", 30) == 8.0
    assert shift_hours("2026-09-28T12:00:00", "2026-09-28T13:00:00+00:00") == 1.0, "a time with no offset reads as UTC"
    assert shift_hours("2026-09-28T12:00:00Z", "2026-09-28T11:00:00Z") == 0.0
    assert shift_hours("2026-09-28T12:00:00Z", None) is None and shift_hours("garbage", "2026-09-28T11:00:00Z") is None
