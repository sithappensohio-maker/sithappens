"""School HQ's copy of a student's status follows the real one (audit #54).

Graduating (or pausing, withdrawing, reopening) an in-person dog changed
only the dog's program; School HQ counts from its own copy, so it kept the
dog as an active student — and on the "needs a nudge" list — until the
client opened School, which many in-person clients never do. Every staff
status change now updates the copy in the same step, and a daily pass
(re-armed by a backup restore) puts right any copy already out of step.

Reuses the Trainer Day fixtures (tag TLW).
"""
import contextlib

import httpx
import pytest
from motor.motor_asyncio import AsyncIOMotorCollection

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run
from domains.school import mirror_sync
from test_trainer_lesson_workspace import (  # noqa: F401
    ADMIN, _auth, _clean, _complete, _enrollment, _open_draft, _record, _seed,
)


def _http(method, path, **kw):
    async def go():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test") as c:
            return await c.request(method, f"/api{path}", headers=_auth(ADMIN["id"], ADMIN["email"], "admin"), **kw)
    return run(go())


def _se(s):
    return run(server.db.school_enrollments.find_one({"id": s["se_id"]}, {"_id": 0}))


def _put_status(s, status):
    r = _http("PUT", f"/dogs/{s['dog_id']}/programs/{s['enrollment_id']}", json={"status": status})
    assert r.status_code == 200, r.text[:300]
    return r.json()


def _hq_active():
    r = _http("GET", "/admin/school/hq/summary")
    assert r.status_code == 200, r.text[:200]
    return r.json()["active_students"]


def _listed(s, status):
    r = _http("GET", "/admin/school/students", params={"status": status, "limit": 300})
    assert r.status_code == 200, r.text[:200]
    return s["se_id"] in {row["school_enrollment_id"] for row in r.json()}


def _job():
    run(server.db.system_runs.delete_many({"_id": mirror_sync.SYNC_JOB}))
    return run(dict(server._scheduler_jobs())["school_enrollment_mirror_sync"]())


# ---- every staff status change updates HQ's copy at once ----------------------

def test_graduating_an_in_person_dog_takes_it_off_hq_s_active_students_at_once():
    s = _seed("in_person")
    before = _hq_active()
    assert _se(s)["status"] == "active" and _listed(s, "active")
    # Quiet for months: HQ flags it "needs a nudge" while it's still active.
    run(server.db.school_enrollments.update_one({"id": s["se_id"]}, {"$set": {"enrolled_at": "2026-01-01T00:00:00+00:00"}}))
    run(server.db.school_events.delete_many({"school_enrollment_id": s["se_id"]}))
    nudged = {row["school_enrollment_id"] for row in _http("GET", "/admin/school/interventions").json()}
    assert s["se_id"] in nudged
    _put_status(s, "completed")
    se = _se(s)
    assert se["status"] == "completed" and se["completed_at"] == _enrollment(s)["completed_at"]
    assert _hq_active() == before - 1
    assert _listed(s, "completed") and not _listed(s, "active")
    r = _http("GET", "/admin/school/interventions")
    assert s["se_id"] not in {row["school_enrollment_id"] for row in r.json()}, "a graduate is never 'needs a nudge'"


def test_pause_withdraw_and_resume_each_follow():
    s = _seed("hybrid")
    for status in ("on_hold", "withdrawn", "active"):
        _put_status(s, status)
        assert _se(s)["status"] == status, status
    assert _se(s).get("completed_at") is None


def test_a_notes_only_edit_never_touches_the_copy():
    s = _seed("in_person")
    run(server.db.school_enrollments.update_one({"id": s["se_id"]}, {"$set": {"status": "weird-on-purpose"}}))
    r = _http("PUT", f"/dogs/{s['dog_id']}/programs/{s['enrollment_id']}", json={"trainer_notes": "Good boy"})
    assert r.status_code == 200
    assert _se(s)["status"] == "weird-on-purpose"


def test_trainer_day_complete_program_updates_the_copy():
    s = _seed("in_person", lessons=1)
    draft = _open_draft(s)
    act = next(a for a in draft["plan"]["activities"] if a.get("source") == "skill")
    _record(draft["id"], {act["id"]: {"score": 5, "outcome": "reliable"}},
            what_went_well="w", needs_work="n", next_lesson_focus="f", client_recap_note="c")
    _complete(draft["id"], action="complete_program")
    assert _enrollment(s)["status"] == "completed"
    assert _se(s)["status"] == "completed"


@pytest.mark.parametrize("how", ["staff", "client_read", "stale_copy"])
def test_reopening_a_graduated_program_reopens_the_copy(how):
    s = _seed("in_person")
    _put_status(s, "completed")
    if how == "client_read":   # the copy was already healed by a client opening School
        run(server._reconcile_school_enrollment_mirror(_enrollment(s), _se(s)))
    if how == "stale_copy":    # a copy left at some older status before this fix
        run(server.db.school_enrollments.update_one({"id": s["se_id"]}, {"$set": {"status": "on_hold"}}))
    r = _http("POST", f"/training/enrollments/{s['enrollment_id']}/reopen-program", json={"reason": "Graduated by mistake"})
    assert r.status_code == 200, r.text[:300]
    se = _se(s)
    assert se["status"] == "active" and se.get("completed_at") is None


def test_a_program_with_no_copy_is_left_without_one():
    s = _seed("in_person")
    run(server.db.school_enrollments.delete_many({"id": s["se_id"]}))
    _put_status(s, "completed")
    assert run(server.db.school_enrollments.count_documents({"enrollment_id": s["enrollment_id"]})) == 0
    assert run(mirror_sync.sync_one(server.db, s["enrollment_id"])) == "no_mirror"


@contextlib.contextmanager
def _patched(collection, method, wrapper):
    """Patch a Motor collection method on the CLASS (server.db.<name> hands
    back a fresh collection object per access)."""
    orig = getattr(AsyncIOMotorCollection, method)

    async def call(self, *a, **kw):
        if self.name == collection:
            return await wrapper(orig, self, *a, **kw)
        return await orig(self, *a, **kw)
    setattr(AsyncIOMotorCollection, method, call)
    try:
        yield
    finally:
        setattr(AsyncIOMotorCollection, method, orig)


def test_the_copy_never_ends_up_older_than_the_real_row():
    s = _seed("in_person")
    run(server.db.dog_programs.update_one({"id": s["enrollment_id"]}, {"$set": {"status": "withdrawn"}}))
    calls = {"n": 0}

    async def racing(orig, self, *a, **kw):
        res = await orig(self, *a, **kw)
        calls["n"] += 1
        if calls["n"] == 1:   # the program changes again right after the first copy
            await server.db.dog_programs.update_one({"id": s["enrollment_id"]}, {"$set": {"status": "on_hold"}})
        return res
    with _patched("school_enrollments", "update_one", racing):
        assert run(mirror_sync.sync_one(server.db, s["enrollment_id"])) == "fixed"
    assert calls["n"] == 2 and _se(s)["status"] == "on_hold"


def test_a_failed_copy_never_fails_the_staff_action():
    s = _seed("in_person")

    async def broken(orig, self, *a, **kw):
        raise RuntimeError("mongo hiccup")
    with _patched("school_enrollments", "find_one", broken):
        assert run(mirror_sync.sync_one(server.db, s["enrollment_id"])) == "error"
        _put_status(s, "completed")   # the graduation itself still goes through
    assert _enrollment(s)["status"] == "completed"
    assert _job()["fixed"] >= 1 and _se(s)["status"] == "completed", "the daily pass finishes the copy"


# ---- the online final step: the real row first --------------------------------

def test_an_online_student_finishing_the_course_updates_the_copy():
    s = _seed("online", lessons=1)
    enr = _enrollment(s)
    assert run(server._advance_school_enrollment(_se(s), enr, run(server._school_roadmap(enr, s["dog_id"]))))["finished"] is True
    se, enr = _se(s), _enrollment(s)
    assert enr["status"] == se["status"] == "completed" and se["completed_at"] == enr["completed_at"]


def test_a_client_opening_school_copies_the_finish_date_too():
    s = _seed("in_person")
    run(server.db.dog_programs.update_one({"id": s["enrollment_id"]}, {"$set": {"status": "completed", "completed_at": "2026-09-29T15:00:00+00:00"}}))
    healed = run(server._reconcile_school_enrollment_mirror(_enrollment(s), _se(s)))
    assert healed["status"] == _se(s)["status"] == "completed"
    assert _se(s)["completed_at"] == "2026-09-29T15:00:00+00:00"


def test_the_online_final_step_writes_the_real_row_first_and_a_retry_still_says_finished():
    s = _seed("online", lessons=1)

    async def lost(orig, self, *a, **kw):
        raise RuntimeError("crash between the two writes")

    # A duplicate request read the course before the first one finished.
    enr = _enrollment(s)
    roadmap = run(server._school_roadmap(enr, s["dog_id"]))

    def advance():
        return run(server._advance_school_enrollment(_se(s), enr, roadmap))
    with _patched("school_enrollments", "update_one", lost):
        first = advance()   # the copy's write is lost (sync_one swallows it)
    assert first["finished"] is True
    assert _enrollment(s)["status"] == "completed", "the program itself finished"
    assert _se(s)["status"] == "active", "only the copy was left behind"
    assert advance()["finished"] is True, "a retry reads the real row, not the copy left behind"
    assert run(mirror_sync.sync_one(server.db, s["enrollment_id"])) == "fixed"
    assert _se(s)["status"] == "completed"


# ---- the daily pass (and the one-time repair) ---------------------------------

def test_the_daily_pass_puts_right_every_copy_out_of_step_and_never_touches_programs():
    grad, reopened, orphan = _seed("in_person"), _seed("in_person"), _seed("in_person")
    run(server.db.dog_programs.update_one({"id": grad["enrollment_id"]}, {"$set": {"status": "completed", "completed_at": "2026-09-30T12:00:00+00:00"}}))
    run(server.db.school_enrollments.update_one({"id": reopened["se_id"]}, {"$set": {"status": "completed", "completed_at": "2026-09-01T00:00:00+00:00"}}))
    run(server.db.dog_programs.delete_many({"id": orphan["enrollment_id"]}))
    run(server.db.clients.update_one({"id": grad["client"]["id"]}, {"$set": {"client_status": "archived"}}))
    programs_before = sorted(run(server.db.dog_programs.find({}, {"_id": 0}).to_list(None)), key=lambda d: d["id"])
    orphan_before = _se(orphan)

    out = _job()
    assert out["fixed"] >= 2 and out["reverted_to_active"] >= 1 and out["skipped"]["no_enrollment"] >= 1, out
    assert _se(grad)["status"] == "completed" and _se(grad)["completed_at"] == "2026-09-30T12:00:00+00:00", "an archived family's row too"
    assert _se(reopened)["status"] == "active" and _se(reopened).get("completed_at") is None
    assert _se(orphan) == orphan_before, "an orphan is counted, never changed or deleted"
    assert sorted(run(server.db.dog_programs.find({}, {"_id": 0}).to_list(None)), key=lambda d: d["id"]) == programs_before

    again = _job()
    assert again["fixed"] == 0, again


def test_a_backup_restore_re_arms_the_daily_pass_even_if_it_fails():
    s = _seed("in_person")
    run(server.db.system_runs.update_one({"_id": mirror_sync.SYNC_JOB}, {"$set": {"date": "2099-01-01"}}, upsert=True))
    old = {**_se(s), "status": "withdrawn"}
    run(server._restore_collections({"school_enrollments": [old]}, "merge"))
    assert run(server.db.system_runs.find_one({"_id": mirror_sync.SYNC_JOB})) is None
    assert _se(s)["status"] == "withdrawn", "the restore brought the stale copy back"
    _job()
    assert _se(s)["status"] == "active"

    async def tick_then_die(*a, **kw):
        # the daily pass ran while the restore was half done, then it died
        await server.db.system_runs.update_one({"_id": mirror_sync.SYNC_JOB}, {"$set": {"date": "2099-01-01"}}, upsert=True)
        raise RuntimeError("restore died partway")

    def boom(*a, **kw):
        return tick_then_die()
    with pytest.raises(Exception):
        run(server._restore_collections({"dog_programs": [_enrollment(s)]}, "merge", progress=boom))
    assert run(server.db.system_runs.find_one({"_id": mirror_sync.SYNC_JOB})) is None


def test_the_rule_for_the_copy():
    assert mirror_sync.diff({"status": "completed", "completed_at": "t1"}, {"status": "active"}) == {"status": "completed", "completed_at": "t1"}
    assert mirror_sync.diff({"status": "completed"}, {"status": "completed", "completed_at": "t0"}) == {}, "the copy keeps its own date"
    assert mirror_sync.diff({"status": "active", "completed_at": "t1"}, {"status": "completed", "completed_at": "t1"}) == {"status": "active", "completed_at": None}
    assert mirror_sync.diff({}, {"status": "active"}) == {}, "a missing status is active"
    assert mirror_sync.diff({"access_state": "revoked"}, {"status": "active"}) == {"access_state": "revoked"}
    assert mirror_sync.diff({"status": "active"}, {"status": "active", "access_state": "active"}) == {}
