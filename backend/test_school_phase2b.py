"""Online School Phase 2B — native Lesson/Course/Today backend support.

The 2B UI is driven by existing endpoints; the only backend change is the
lesson-detail response now exposing the Learn/Practice boundary
(`learn_completed`, `has_practice`). These tests prove those fields plus the
2B flows the native screens depend on:

  * lesson detail: fresh → learn_completed False; after the real
    Start-Practice transition → True (Scenario B's state refresh)
  * a no-practice lesson reports has_practice False (drives Complete Lesson)
  * direct fetch of a LOCKED lesson stays 403 with a human-readable reason
    (Scenario G — no client bypass)
  * reviewing a COMPLETED lesson never moves the pointer or resets Learn
    (Scenario I)

Same harness as test_school_phase2a.py; reuses the Phase-4 fixtures.
"""
import uuid

import pytest

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

from test_online_school_phase4 import (  # noqa: E402
    _school_program as _p4_program,
    _client_and_dog as _p4_client_and_dog,
    _enroll as _p4_enroll,
    _client_user as _p4_client_user,
    _cleanup_school as _p4_cleanup,
)
from test_school_phase2a import _strip_practice  # noqa: E402


def _lesson_detail(se_id, lesson_id, cu):
    return run(server.portal_school_lesson_detail(se_id, lesson_id, cu))


def _current_lesson_id(enr_id):
    return run(server.db.dog_programs.find_one({"id": enr_id}, {"_id": 0, "current_lesson_id": 1}))["current_lesson_id"]


def test_lesson_detail_learn_practice_boundary():
    with _p4_program(n_lessons_per_module=2, checkpoint_lesson_idx=99) as (prog, admin), _p4_client_and_dog() as (client_doc, dog):
        se_row, enr = _p4_enroll(prog, dog, admin)
        try:
            cu = _p4_client_user(client_doc["id"])
            lid = _current_lesson_id(enr["id"])
            d = _lesson_detail(se_row["id"], lid, cu)
            assert d["has_practice"] is True
            assert d["learn_completed"] is False and d["practiced"] is False
            # the real Start-Practice transition completes the Learn step
            run(server.portal_school_start_practice(se_row["id"], lid, cu))
            d2 = _lesson_detail(se_row["id"], lid, cu)
            assert d2["learn_completed"] is True and d2["practiced"] is False
        finally:
            _p4_cleanup(se_row["id"], enr["id"])


def test_lesson_detail_no_practice_lesson():
    with _p4_program(n_lessons_per_module=2, checkpoint_lesson_idx=99) as (prog, admin), _p4_client_and_dog() as (client_doc, dog):
        se_row, enr = _p4_enroll(prog, dog, admin)
        try:
            cu = _p4_client_user(client_doc["id"])
            _strip_practice(enr["id"])
            lid = _current_lesson_id(enr["id"])
            d = _lesson_detail(se_row["id"], lid, cu)
            assert d["has_practice"] is False and d["learn_completed"] is False
            run(server.portal_school_complete_lesson(se_row["id"], lid, cu))
            assert _lesson_detail(se_row["id"], lid, cu)["learn_completed"] is True
        finally:
            _p4_cleanup(se_row["id"], enr["id"])


def test_locked_lesson_direct_fetch_403():
    with _p4_program(n_lessons_per_module=2, checkpoint_lesson_idx=99) as (prog, admin), _p4_client_and_dog() as (client_doc, dog):
        se_row, enr = _p4_enroll(prog, dog, admin)
        try:
            cu = _p4_client_user(client_doc["id"])
            snap = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0, "program_snapshot": 1, "current_lesson_id": 1}))
            lessons = snap["program_snapshot"]["modules"][0]["lessons"]
            locked_id = next(l["id"] for l in lessons if l["id"] != snap["current_lesson_id"])
            with pytest.raises(server.HTTPException) as exc:
                _lesson_detail(se_row["id"], locked_id, cu)
            assert exc.value.status_code == 403
            assert "Complete" in str(exc.value.detail)  # human-readable locked_reason
        finally:
            _p4_cleanup(se_row["id"], enr["id"])


def test_completed_course_roadmap_fully_reviewable():
    """After graduation the roadmap must read fully completed — no lesson
    presented as current, none locked — and every lesson stays fetchable."""
    with _p4_program(n_lessons_per_module=2, checkpoint_lesson_idx=99) as (prog, admin), _p4_client_and_dog() as (client_doc, dog):
        se_row, enr = _p4_enroll(prog, dog, admin)
        try:
            cu = _p4_client_user(client_doc["id"])
            for _ in range(2):  # two lessons, no checkpoints → practice + advance both
                lid = _current_lesson_id(enr["id"])
                started = run(server.portal_school_start_practice(se_row["id"], lid, cu))
                run(server.log_section(started["homework_id"], server.SectionLogIn(section_id="practice"), cu))
                run(server.portal_school_advance(se_row["id"], cu))
            detail = run(server.portal_school_detail(se_row["id"], cu))
            assert detail["status"] == "completed"
            statuses = [l["status"] for m in detail["roadmap"]["modules"] for l in m["lessons"]]
            assert statuses and all(s == "completed" for s in statuses), statuses
            assert all(m["status"] == "completed" for m in detail["roadmap"]["modules"])
            # every lesson remains individually reviewable
            for m in detail["roadmap"]["modules"]:
                for l in m["lessons"]:
                    assert _lesson_detail(se_row["id"], l["id"], cu)["status"] == "completed"
        finally:
            _p4_cleanup(se_row["id"], enr["id"])


def test_review_completed_lesson_is_side_effect_free():
    with _p4_program(n_lessons_per_module=2, checkpoint_lesson_idx=99) as (prog, admin), _p4_client_and_dog() as (client_doc, dog):
        se_row, enr = _p4_enroll(prog, dog, admin)
        try:
            cu = _p4_client_user(client_doc["id"])
            l1 = _current_lesson_id(enr["id"])
            started = run(server.portal_school_start_practice(se_row["id"], l1, cu))
            run(server.log_section(started["homework_id"], server.SectionLogIn(section_id="practice"), cu))
            run(server.portal_school_advance(se_row["id"], cu))
            l2 = _current_lesson_id(enr["id"])
            assert l2 != l1
            # Reviewing the completed lesson: viewable, marked completed, and
            # reading it changes nothing.
            d = _lesson_detail(se_row["id"], l1, cu)
            assert d["status"] == "completed" and d["practiced"] is True and d["learn_completed"] is True
            fresh = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0, "current_lesson_id": 1, "learn_completed_lesson_ids": 1}))
            assert fresh["current_lesson_id"] == l2                       # no pointer rewind
            assert fresh["learn_completed_lesson_ids"] == [l1]            # no learn reset / no future marks
        finally:
            _p4_cleanup(se_row["id"], enr["id"])
