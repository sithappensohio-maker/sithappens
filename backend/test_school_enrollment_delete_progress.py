"""An Online School enrollment with lesson progress cannot be hard-deleted (audit #31). The
hard delete refused only checkpoint history, so a course a student had worked through
could be removed along with its progress. Withdraw keeps the history. Disposable tag
TEST_SCHOOL_DEL."""
import uuid

import pytest
from fastapi import HTTPException

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

TAG = "TEST_SCHOOL_DEL"
ADMIN = {"id": f"{TAG}-admin", "role": "admin", "name": "Owner QA", "email": "owner-del@test"}


def _course(lessons_done: int):
    dog_id = f"{TAG}-d-{uuid.uuid4().hex[:6]}"
    prog_id = f"{TAG}-p-{uuid.uuid4().hex[:6]}"
    se_id = f"{TAG}-se-{uuid.uuid4().hex[:6]}"
    lessons = [{"id": f"{TAG}-l{i}", "name": f"Lesson {i}"} for i in range(3)]
    snapshot = {"modules": [{"id": f"{TAG}-m", "order": 1, "name": "Module", "lessons": lessons}]}
    cur = lessons[lessons_done]["id"] if lessons_done < len(lessons) else None
    run(server.db.dog_programs.insert_one({
        "id": prog_id, "dog_id": dog_id, "delivery_channel": "online_school", "program_snapshot": snapshot,
        "current_module_id": f"{TAG}-m", "current_lesson_id": cur, "status": "active", "tag": TAG}))
    run(server.db.school_enrollments.insert_one({
        "id": se_id, "enrollment_id": prog_id, "dog_id": dog_id, "status": "active", "tag": TAG}))
    return se_id, prog_id


def teardown_module():
    for coll in ("dog_programs", "school_enrollments", "training_session_log", "checkpoint_submissions"):
        run(getattr(server.db, coll).delete_many({"tag": TAG}))


def test_a_course_with_a_completed_lesson_cannot_be_deleted():
    se_id, prog_id = _course(lessons_done=1)
    with pytest.raises(HTTPException) as err:
        run(server.delete_school_enrollment(se_id, ADMIN))
    assert err.value.status_code == 409
    assert run(server.db.dog_programs.find_one({"id": prog_id})) is not None
    assert run(server.db.school_enrollments.find_one({"id": se_id})) is not None


def test_a_course_not_yet_started_can_still_be_removed():
    se_id, prog_id = _course(lessons_done=0)
    assert run(server.delete_school_enrollment(se_id, ADMIN)) == {"ok": True}
    assert run(server.db.dog_programs.find_one({"id": prog_id})) is None
