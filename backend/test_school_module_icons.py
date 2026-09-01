"""Module icons — backend contract tests.

Icons are pure decoration with one load-bearing rule: they read LIVE from
the program (matched by stable module id) so an admin decorating a program
AFTER import reaches already-enrolled students instantly, with no snapshot
cascade. These tests pin that, plus the client-safe passthrough on the
roadmap and welcome index.

Same in-process harness as the other ad hoc suites.
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


def test_module_icon_rides_the_model_and_reads_live_after_import():
    with _p4_program(n_modules=2, n_lessons_per_module=1, checkpoint_lesson_idx=99) as (prog, admin), \
         _p4_client_and_dog() as (client_doc, dog):
        se_row, enr = _p4_enroll(prog, dog, admin)
        try:
            cu = _p4_client_user(client_doc["id"])
            mid = prog["modules"][0]["id"]

            # No icon anywhere yet — roadmap and welcome carry None, never a
            # missing key (the client derives from content in that case).
            detail = run(server.portal_school_detail(se_row["id"], cu))
            assert detail["roadmap"]["modules"][0]["icon"] is None
            assert detail["welcome"]["syllabus"][0]["icon"] is None
            assert detail["welcome"]["syllabus"][0]["id"] == mid

            # The admin decorates the LIVE program AFTER enrollment — exactly
            # the "add my own icons after the programs are imported" flow. The
            # frozen snapshot still has no icon, so seeing it proves the live
            # merge by module id.
            run(server.db.programs.update_one(
                {"id": prog["id"], "modules.id": mid},
                {"$set": {"modules.$.icon": {"kind": "image", "image_id": "media-123"}}},
            ))
            snap = run(server.db.dog_programs.find_one({"id": enr["id"]}, {"_id": 0, "program_snapshot.modules": 1}))
            assert "icon" not in snap["program_snapshot"]["modules"][0] or not snap["program_snapshot"]["modules"][0].get("icon")

            detail = run(server.portal_school_detail(se_row["id"], cu))
            assert detail["roadmap"]["modules"][0]["icon"] == {"kind": "image", "image_id": "media-123"}
            assert detail["welcome"]["syllabus"][0]["icon"] == {"kind": "image", "image_id": "media-123"}
            # The undecorated module is untouched.
            assert detail["welcome"]["syllabus"][1]["icon"] is None

            # ProgramIn round-trips the field (so Studio saves persist it).
            body = server.ModuleIconIn(kind="builtin", builtin="focus")
            assert body.model_dump() == {"kind": "builtin", "builtin": "focus", "image_id": None}

            # _stamp_ids rebuilds modules from an explicit field list on EVERY
            # program save — the icon must ride through it, or Studio's "Save
            # Live Now" silently drops the admin's choice (the exact bug the
            # first browser QA pass caught).
            stamped = server._stamp_ids([{
                "name": "M", "goals": [], "lessons": [],
                "icon": {"kind": "builtin", "builtin": "recall"},
            }])
            assert stamped[0]["icon"] == {"kind": "builtin", "builtin": "recall"}
        finally:
            _p4_cleanup(se_row["id"], enr["id"])
