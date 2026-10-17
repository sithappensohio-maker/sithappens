"""delete_program's new hard=True path — owner, 2026-10-17: "can we make it
so any item in the shop can be deleted so i can clean up unused stuff."
Matches the physical-product rule (delete_pos_product): permanently delete
only when there's no real history, refuse with 409 pointing at the existing
soft-delete (hide) otherwise. hard=False (every pre-existing caller) is
untouched — this file only covers the new behavior.

Disposable tag TEST_PROG_HARD_DELETE.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from fastapi import HTTPException
from _test_loop import run

TAG = "TEST_PROG_HARD_DELETE"
ADMIN = {"id": f"{TAG}-admin", "role": "admin", "name": f"{TAG} admin", "email": "proghd@test"}


def _create(**overrides):
    body = {"name": f"{TAG} Program {uuid.uuid4().hex[:6]}", "type": "private_lessons"}
    body.update(overrides)
    return run(server.create_program(server.ProgramIn(**body), ADMIN))


def _cleanup(program_ids):
    run(server.db.programs.delete_many({"id": {"$in": program_ids}}))
    run(server.db.dog_programs.delete_many({"program_id": {"$in": program_ids}}))


def test_hard_false_default_keeps_the_exact_old_soft_delete_behavior():
    p = _create()
    try:
        result = run(server.delete_program(p["id"], _=ADMIN))
        assert result == {"ok": True}
        refreshed = run(server.db.programs.find_one({"id": p["id"]}, {"_id": 0}))
        assert refreshed is not None  # still in the database — soft delete only
        assert refreshed["active"] is False
    finally:
        _cleanup([p["id"]])


def test_hard_true_permanently_deletes_a_program_with_no_enrollment_history():
    p = _create()
    try:
        result = run(server.delete_program(p["id"], hard=True, _=ADMIN))
        assert result == {"ok": True, "action": "deleted"}
        assert run(server.db.programs.find_one({"id": p["id"]})) is None
    finally:
        _cleanup([p["id"]])


def test_hard_true_refuses_a_program_with_real_enrollment_history():
    p = _create()
    try:
        # A dog_programs row in ANY status counts — completed history must
        # keep reading back correctly even after the catalog listing is gone.
        run(server.db.dog_programs.insert_one({
            "id": str(uuid.uuid4()), "program_id": p["id"], "dog_id": str(uuid.uuid4()),
            "status": "completed",
        }))
        try:
            run(server.delete_program(p["id"], hard=True, _=ADMIN))
            assert False, "should have been refused"
        except HTTPException as e:
            assert e.status_code == 409
            assert "enrollment history" in e.detail
        # Refused, so it's still there, still active — never silently fell
        # back to soft-deleting it either.
        refreshed = run(server.db.programs.find_one({"id": p["id"]}, {"_id": 0}))
        assert refreshed is not None
        assert refreshed["active"] is True
    finally:
        _cleanup([p["id"]])


def test_hard_true_404s_for_an_unknown_program():
    try:
        run(server.delete_program("nonexistent-id", hard=True, _=ADMIN))
        assert False, "should have been refused"
    except HTTPException as e:
        assert e.status_code == 404
