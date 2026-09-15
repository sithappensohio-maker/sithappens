"""Training Experience Clarity Pass — Stage 4: what the client Practice
destination reads.

  * `portal_school_home.active_practice` rows carry three ADDITIVE, read-only
    presentation flags (assigned_by_trainer / is_optional / session_linked) —
    the raw assigned_by string itself still never reaches the client;
  * `GET /portal/school/{id}/practice-history` returns THIS enrollment's
    completed Practice, newest first, in small pages with an exact total —
    never another dog's or program's rows, never active rows;
  * everything is the same client-safe serializer the active rows use.

Nothing here touches counting, completion, gating or review behaviour.
"""
import contextlib
import uuid

import pytest

import _test_env  # noqa: F401 — must run before `import server`
import server
import _school_client_flow
from _test_loop import run

from test_online_school_phase4 import (  # noqa: E402
    _school_program, _client_and_dog, _client_user, _cleanup_school, TAG,
)


def _enroll(prog, dog, admin, delivery_mode="online"):
    res = run(server.school_enroll(server.SchoolEnrollIn(dog_id=dog["id"], program_id=prog["id"], delivery_mode=delivery_mode), admin))
    return res["school_enrollment"], res["enrollment"]


@contextlib.contextmanager
def _course(delivery_mode="online"):
    with _school_program(n_modules=1, n_lessons_per_module=2, checkpoint_lesson_idx=99) as (prog, admin):
        with _client_and_dog() as (client, dog):
            se, enr = _enroll(prog, dog, admin, delivery_mode)
            cu = _client_user(client["id"])
            try:
                lid = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0, "current_lesson_id": 1}))["current_lesson_id"]
                yield se, enr, cu, lid, admin, prog, dog
            finally:
                run(server.db.homework.delete_many({"dog_id": dog["id"]}))
                _cleanup_school(se["id"], enr["id"])


def _start(se, lid, cu):
    run(_school_client_flow.complete_instructional_steps(se["id"], lid, cu))
    return run(server.portal_school_start_practice(se["id"], lid, cu))["homework_id"]


def _completed_row(se, enr, dog, title, when):
    doc = {"id": str(uuid.uuid4()), "dog_id": dog["id"], "client_id": dog["owner_id"], "title": title, "status": "completed",
           "completed_at": when, "created_at": when, "assigned_by": "Trainer", "school_enrollment_id": se["id"],
           "school_enrollment_record_id": enr["id"], "section_logs": [], "required": True}
    run(server.db.homework.insert_one(doc))
    return doc


def test_active_rows_carry_plain_flags_and_never_the_raw_assigned_by():
    with _course() as (se, enr, cu, lid, admin, prog, dog):
        hw_id = _start(se, lid, cu)
        rows = {r["id"]: r for r in run(server.portal_school_home(se["id"], cu))["active_practice"]}
        row = rows[hw_id]
        assert row["assigned_by_trainer"] is False        # School's own lesson Practice
        assert row["is_optional"] is False and row["session_linked"] is False
        assert "assigned_by" not in row
        run(server.db.homework.update_one({"id": hw_id}, {"$set": {"assigned_by": "Garrett", "required": False, "source_session_log_id": "sesslog-x"}}))
        row = {r["id"]: r for r in run(server.portal_school_home(se["id"], cu))["active_practice"]}[hw_id]
        assert row["assigned_by_trainer"] is True and row["is_optional"] is True and row["session_linked"] is True


def test_practice_history_is_enrollment_scoped_paged_and_exact():
    with _course() as (se, enr, cu, lid, admin, prog, dog):
        for i in range(7):
            _completed_row(se, enr, dog, f"Done {i}", f"2026-09-{i + 1:02d}T10:00:00+00:00")
        hw_id = _start(se, lid, cu)  # active — must never appear in history
        page1 = run(server.portal_school_practice_history(se["id"], 5, 0, cu))
        assert page1["total"] == 7 and page1["limit"] == 5 and page1["offset"] == 0
        assert [r["title"] for r in page1["items"]] == ["Done 6", "Done 5", "Done 4", "Done 3", "Done 2"]
        page2 = run(server.portal_school_practice_history(se["id"], 5, 5, cu))
        assert [r["title"] for r in page2["items"]] == ["Done 1", "Done 0"]
        assert all(r["id"] != hw_id for r in page1["items"] + page2["items"])
        # Same client-safe shape as active rows (+ summary flags), nothing internal.
        allowed = set(server._CLIENT_SAFE_HOMEWORK_FIELDS) | {"template_snapshot", "section_logs", "daily_progress",
                   "school_lesson_id", "school_lesson_name", "is_current_lesson_practice", "sessions_logged", "last_session_at",
                   "required_practice_satisfied", "assigned_by_trainer", "is_optional", "session_linked"}
        for r in page1["items"]:
            assert set(r.keys()) <= allowed, set(r.keys()) - allowed
        # Limit is clamped so a client can never pull the whole ledger in one go.
        big = run(server.portal_school_practice_history(se["id"], 5000, 0, cu))
        assert big["limit"] == 50


def test_history_never_blends_another_dog_or_another_program():
    with _course() as (se1, enr1, cu, lid, admin, prog, dog):
        _completed_row(se1, enr1, dog, "Program one history", "2026-09-01T10:00:00+00:00")
        with _school_program(n_modules=1, n_lessons_per_module=2, checkpoint_lesson_idx=99) as (prog2, admin2):
            se2, enr2 = _enroll(prog2, dog, admin, "online")
            try:
                _completed_row(se2, enr2, dog, "Program two history", "2026-09-05T10:00:00+00:00")
                h1 = run(server.portal_school_practice_history(se1["id"], 5, 0, cu))
                h2 = run(server.portal_school_practice_history(se2["id"], 5, 0, cu))
                assert [r["title"] for r in h1["items"]] == ["Program one history"] and h1["total"] == 1
                assert [r["title"] for r in h2["items"]] == ["Program two history"] and h2["total"] == 1
            finally:
                _cleanup_school(se2["id"], enr2["id"])
        # (_cleanup_school sweeps every Trainer/Online-School homework row in the
        # disposable DB, so restore program one's history before the dog test.)
        _completed_row(se1, enr1, dog, "Program one history", "2026-09-01T10:00:00+00:00")
        dog_b = {"id": str(uuid.uuid4()), "name": f"{TAG} Dog B", "owner_id": dog["owner_id"], "breed": "Mix", "age_y": 2,
                 "vaccines": {"rabies": "2028-01-01", "dhpp": "2028-01-01", "bordetella": "2028-01-01"}}
        run(server.db.dogs.insert_one(dog_b))
        se_b, enr_b = _enroll(prog, dog_b, admin, "online")
        try:
            _completed_row(se_b, enr_b, dog_b, "Dog B history", "2026-09-06T10:00:00+00:00")
            assert [r["title"] for r in run(server.portal_school_practice_history(se1["id"], 5, 0, cu))["items"]] == ["Program one history"]
            assert [r["title"] for r in run(server.portal_school_practice_history(se_b["id"], 5, 0, cu))["items"]] == ["Dog B history"]
        finally:
            run(server.db.homework.delete_many({"dog_id": dog_b["id"]}))
            _cleanup_school(se_b["id"], enr_b["id"])
            run(server.db.dogs.delete_one({"id": dog_b["id"]}))


def test_another_client_cannot_read_this_enrollments_history():
    with _course() as (se, enr, cu, lid, admin, prog, dog):
        stranger = _client_user(str(uuid.uuid4()))
        with pytest.raises(Exception):
            run(server.portal_school_practice_history(se["id"], 5, 0, stranger))


def test_daily_tracker_rows_on_today_carry_the_canonical_per_day_progress():
    with _course() as (se, enr, cu, lid, admin, prog, dog):
        hw = run(server.create_daily_tracker(server.DailyTrackerCreateIn(
            dog_id=dog["id"], title="Recall Around Distractions", instructions="Three short sessions.",
            days=[server.DailyTrackerSectionIn(day_number=n, day_focus=f"Day {n}", fields=[{"id": "reps", "label": "Reps", "kind": "number"}]) for n in (1, 2, 3)],
        ), admin))
        run(server.db.homework.update_one({"id": hw["id"]}, {"$set": {"school_enrollment_id": se["id"], "school_enrollment_record_id": enr["id"], "assigned_by": "Garrett"}}))
        row = {r["id"]: r for r in run(server.portal_school_home(se["id"], cu))["active_practice"]}[hw["id"]]
        assert row["total_days"] == 3 and [d["status"] for d in row["daily_progress"]] == ["available", "locked", "locked"]
        run(server.submit_day(hw["id"], 1, server.DaySubmitIn(field_values={"reps": 8}, note="Eight clean reps."), cu))
        row = {r["id"]: r for r in run(server.portal_school_home(se["id"], cu))["active_practice"]}[hw["id"]]
        assert [d["status"] for d in row["daily_progress"]] == ["submitted", "available", "locked"]
        assert row["daily_progress"][0]["log"] and "note" in row["daily_progress"][0]["log"]
        assert "reviewed_by_id" not in str(row)
