"""Program Welcome page — backend contract tests.

The welcome/index screen (client School) is fed by a new `welcome` block on
GET /portal/school/{id}: orientation copy plus a full read-only table of
contents built from the enrollment's frozen snapshot. These tests prove the
three load-bearing rules:

  * the index lists EVERY module's lessons (names/minutes only) — including
    modules the roadmap still returns locked-and-empty — with matching totals
  * syllabus lesson entries carry no ids and no lock state (orientation only;
    the roadmap keeps sole ownership of locks/progression)
  * `outcomes` reads the LIVE program's welcome_outcomes, so an admin adding
    bullets reaches already-enrolled students without a cascade; the
    ProgramIn validator drops the Studio textarea's blank lines

Same in-process harness as test_school_phase2b.py; reuses Phase-4 fixtures.
"""
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


def test_welcome_index_lists_every_module_including_locked_ones():
    with _p4_program(n_modules=2, n_lessons_per_module=2, checkpoint_lesson_idx=99) as (prog, admin), \
         _p4_client_and_dog() as (client_doc, dog):
        se_row, enr = _p4_enroll(prog, dog, admin)
        try:
            cu = _p4_client_user(client_doc["id"])
            detail = run(server.portal_school_detail(se_row["id"], cu))
            w = detail["welcome"]
            assert w is not None

            # The roadmap still redacts the locked module's lessons…
            locked_roadmap_module = detail["roadmap"]["modules"][1]
            assert locked_roadmap_module["status"] == "locked"
            assert locked_roadmap_module["lessons"] == []

            # …while the welcome index names the whole journey.
            assert w["totals"] == {"modules": 2, "lessons": 4, "minutes": 0}
            assert [m["name"] for m in w["syllabus"]] == ["Module 1", "Module 2"]
            assert [l["name"] for l in w["syllabus"][1]["lessons"]] == ["Lesson 2.1", "Lesson 2.2"]
            assert w["syllabus"][1]["lesson_count"] == 2

            # Orientation only: names + minutes, never ids or lock state.
            for m in w["syllabus"]:
                assert m["quiz_question_count"] == 0
                for l in m["lessons"]:
                    assert set(l.keys()) == {"name", "estimated_minutes"}
        finally:
            _p4_cleanup(se_row["id"], enr["id"])


def test_welcome_outcomes_read_live_program_not_snapshot():
    with _p4_program(n_modules=1, n_lessons_per_module=2, checkpoint_lesson_idx=99) as (prog, admin), \
         _p4_client_and_dog() as (client_doc, dog):
        se_row, enr = _p4_enroll(prog, dog, admin)
        try:
            cu = _p4_client_user(client_doc["id"])
            assert run(server.portal_school_detail(se_row["id"], cu))["welcome"]["outcomes"] == []

            # Admin adds outcomes AFTER enrollment — the frozen snapshot
            # predates them, so seeing them proves the live read.
            run(server.db.programs.update_one(
                {"id": prog["id"]}, {"$set": {"welcome_outcomes": ["Name response", "Loose-leash basics"]}},
            ))
            detail = run(server.portal_school_detail(se_row["id"], cu))
            assert detail["welcome"]["outcomes"] == ["Name response", "Loose-leash basics"]
        finally:
            _p4_cleanup(se_row["id"], enr["id"])


def test_program_in_drops_blank_outcome_lines():
    body = server.ProgramIn(
        name="Welcome outcomes validator", type="private_lessons",
        welcome_outcomes=["  Reliable recall  ", "", "   ", "Calm greetings"],
    )
    assert body.welcome_outcomes == ["Reliable recall", "Calm greetings"]
