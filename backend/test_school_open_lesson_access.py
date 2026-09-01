"""Open lesson access — backend contract tests.

A staff-granted per-enrollment flag lets a chosen client take lessons in ANY
order. These tests pin its exact blast radius:

  * off (default): future modules stay locked-and-empty, direct fetch 403s
  * on: every lesson is served ("upcoming" modules with full lessons,
    "available" statuses), direct fetch and start-practice work out of
    order — but the POINTER NEVER MOVES and sequential completion
    (complete-lesson) still refuses non-current lessons
  * the admin PATCH writes an audited grant and can revoke it

Same in-process harness as the other ad hoc suites.
"""
import uuid

import pytest

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

from school_suite_base import SchoolStudentPatch

from test_online_school_phase4 import (  # noqa: E402
    _school_program as _p4_program,
    _client_and_dog as _p4_client_and_dog,
    _enroll as _p4_enroll,
    _client_user as _p4_client_user,
    _cleanup_school as _p4_cleanup,
)


def _patch_route():
    return next(r for r in server.app.routes if getattr(r, "path", "") == "/api/admin/school/students/{sid}"
                and "PATCH" in getattr(r, "methods", set())).endpoint


def _admin_user():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": "open access admin"}


def _module2_lesson_id(enr):
    snap = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0, "program_snapshot": 1}))
    return snap["program_snapshot"]["modules"][1]["lessons"][0]["id"]


def test_open_access_unlocks_every_lesson_without_moving_the_pointer():
    with _p4_program(n_modules=2, n_lessons_per_module=2, checkpoint_lesson_idx=99) as (prog, admin), \
         _p4_client_and_dog() as (client_doc, dog):
        se_row, enr = _p4_enroll(prog, dog, admin)
        try:
            cu = _p4_client_user(client_doc["id"])
            future_lid = _module2_lesson_id(enr)

            # Default: module 2 locked and empty; direct fetch refused.
            detail = run(server.portal_school_detail(se_row["id"], cu))
            assert detail["open_lesson_access"] is False
            assert detail["roadmap"]["modules"][1]["status"] == "locked"
            assert detail["roadmap"]["modules"][1]["lessons"] == []
            with pytest.raises(server.HTTPException) as exc:
                run(server.portal_school_lesson_detail(se_row["id"], future_lid, cu))
            # A lesson inside a fully-locked module isn't even LISTED in the
            # roadmap, so the accessor 404s (403 is for named-but-locked
            # lessons in the current module). Either way: refused.
            assert exc.value.status_code in (403, 404)

            # Grant open access through the real admin PATCH.
            run(_patch_route()(se_row["id"], SchoolStudentPatch(open_lesson_access=True), _admin_user()))
            dp = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0, "open_lesson_access": 1}))
            assert dp["open_lesson_access"]["enabled"] is True
            assert dp["open_lesson_access"]["updated_by_name"] == "open access admin"

            detail = run(server.portal_school_detail(se_row["id"], cu))
            assert detail["open_lesson_access"] is True
            m2 = detail["roadmap"]["modules"][1]
            assert m2["status"] == "upcoming" and m2["locked_reason"] is None
            assert [l["status"] for l in m2["lessons"]] == ["available", "available"]
            # No lesson anywhere is locked any more.
            assert all(l["status"] != "locked" for m in detail["roadmap"]["modules"] for l in m["lessons"])
            # The pointer did not move: lesson 1.1 is still current.
            assert detail["roadmap"]["current_lesson"]["name"] == "Lesson 1.1"

            # The future lesson opens, its guided steps complete, and its
            # Practice starts — fully out of order.
            ld = run(server.portal_school_lesson_detail(se_row["id"], future_lid, cu))
            assert ld["status"] == "available" and ld["is_current"] is False
            for key in ld["instructional_steps"]:
                run(server.portal_school_complete_lesson_step(se_row["id"], future_lid, key, cu))
            out = run(server.portal_school_start_practice(se_row["id"], future_lid, cu))
            assert out["homework_id"]

            # …but formal completion stays sequential: the pointer is still on
            # lesson 1.1 and complete-lesson refuses a non-current lesson.
            fresh = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0, "current_lesson_id": 1}))
            assert fresh["current_lesson_id"] != future_lid
            with pytest.raises(server.HTTPException) as exc:
                run(server.portal_school_complete_lesson(se_row["id"], future_lid, cu))
            assert exc.value.status_code == 422

            # Revoke → module 2 locks again.
            run(_patch_route()(se_row["id"], SchoolStudentPatch(open_lesson_access=False), _admin_user()))
            detail = run(server.portal_school_detail(se_row["id"], cu))
            assert detail["open_lesson_access"] is False
            assert detail["roadmap"]["modules"][1]["status"] == "locked"
        finally:
            _p4_cleanup(se_row["id"], enr["id"])
