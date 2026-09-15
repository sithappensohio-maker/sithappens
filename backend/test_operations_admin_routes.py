"""Behaviour pins for the small admin operations endpoints, written BEFORE those
routes moved out of server.py into the operations domain so the move could be
proved equivalent rather than assumed.

Covers the scheduler status/run-now pair and the trophy re-check, which had no
direct coverage of their own.
"""
import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from _test_loop import run
from fastapi import HTTPException

ADMIN = {"id": "ops-admin", "name": "Ops Admin", "email": "ops-admin@example.invalid", "role": "admin"}


def _staff(staff_role):
    return {"id": f"ops-{staff_role}", "name": staff_role, "role": "employee", "staff_role": staff_role}


# ---------------------------------------------------------------------------
# scheduler status / run-now
# ---------------------------------------------------------------------------

def test_scheduler_status_reports_this_worker_and_every_registered_job():
    st = run(server.admin_scheduler_status(ADMIN))
    assert isinstance(st, dict)
    # the flags the Settings screen reads
    assert st["enabled"] is (server.os.environ.get("SCHEDULER_ENABLED", "1") == "1")
    assert isinstance(st["running_in_this_worker"], bool)
    # every job the loop would run is named, and they are the scheduler's own list
    assert st["jobs"] == [n for n, _ in server._scheduler_jobs()]
    assert st["jobs"], "the scheduler must register at least one job"
    assert set(server.SCHEDULER_MARKER_IDS)


def test_scheduler_run_now_runs_one_tick_of_the_same_jobs_and_is_attributed():
    out = run(server.admin_scheduler_run_now(ADMIN))
    assert isinstance(out, dict) and out, "a manual tick reports what it ran"
    # every registered job is accounted for, each with an ok flag — never an exception
    for name, _fn in server._scheduler_jobs():
        assert name in out, f"{name} missing from the manual tick report"
        assert "ok" in out[name]
    # running twice in a row stays safe (the jobs are idempotent by contract)
    again = run(server.admin_scheduler_run_now(ADMIN))
    assert isinstance(again, dict) and set(again) == set(out)


def test_scheduler_endpoints_are_admin_only():
    for dep_user in (_staff("trainer"), _staff("front_desk")):
        with pytest.raises(HTTPException) as e:
            run(server.require_admin(dep_user))
        assert e.value.status_code == 403


# ---------------------------------------------------------------------------
# trophy re-check
# ---------------------------------------------------------------------------

def test_trophy_recheck_returns_a_summary_and_records_when_it_last_ran():
    run(server.db.system_runs.delete_one({"_id": "trophy_recheck"}))
    summary = run(server.admin_recheck_trophies(ADMIN))
    assert isinstance(summary, dict) and "awarded" in summary

    marker = run(server.db.system_runs.find_one({"_id": "trophy_recheck"}))
    assert marker is not None
    assert marker["date"] == server.business_today().isoformat()
    assert marker["ran_at"]
    assert marker["awarded"] == summary["awarded"]


def test_trophy_recheck_is_idempotent_on_a_second_run():
    first = run(server.admin_recheck_trophies(ADMIN))
    second = run(server.admin_recheck_trophies(ADMIN))
    # nothing new is awarded the second time for the same data
    def _count(v):
        return v if isinstance(v, int) else len(v)
    assert _count(second["awarded"]) <= _count(first["awarded"])
    marker = run(server.db.system_runs.find_one({"_id": "trophy_recheck"}))
    assert marker["date"] == server.business_today().isoformat()
