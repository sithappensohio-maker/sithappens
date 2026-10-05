"""Merging a duplicate dog moves its Online School enrollment to the kept dog (audit
#28: "Merging a duplicate dog leaves its Online School enrollment on the archived copy").
Disposable tag TEST_MERGE_SCHOOL."""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from _test_loop import run

TAG = "TEST_MERGE_SCHOOL"
ADMIN = {"id": f"{TAG}-admin", "role": "admin", "name": "QA", "email": "qa@test"}


@pytest.fixture()
def two_dogs():
    cid, keep, dup = (f"{TAG}-{x}-{uuid.uuid4().hex[:6]}" for x in ("c", "keep", "dup"))
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} owner", "email": f"{cid}@example.com",
                                      "client_status": "active", "account_balance": 0.0, "tag": TAG}))
    run(server.db.dogs.insert_many([
        {"id": keep, "owner_id": cid, "name": f"{TAG} keep", "tag": TAG, "created_at": "2026-01-01T00:00:00+00:00"},
        {"id": dup, "owner_id": cid, "name": f"{TAG} dup", "tag": TAG, "created_at": "2026-02-01T00:00:00+00:00"}]))
    enr = f"{TAG}-enr-{uuid.uuid4().hex[:6]}"
    run(server.db.school_enrollments.insert_one({"id": enr, "dog_id": dup, "client_id": cid, "status": "active", "tag": TAG}))
    yield {"keep": keep, "dup": dup, "enr": enr, "cid": cid}
    run(server.db.school_enrollments.delete_many({"tag": TAG}))
    run(server.db.dogs.delete_many({"tag": TAG}))
    run(server.db.clients.delete_many({"tag": TAG}))


def test_the_school_enrollment_follows_the_kept_dog(two_dogs):
    body = server.DuplicateDogMergeIn(primary_dog_id=two_dogs["keep"], duplicate_dog_id=two_dogs["dup"], confirm_text="MERGE DOG")
    run(server.admin_duplicate_dog_merge(body, ADMIN))
    enr = run(server.db.school_enrollments.find_one({"id": two_dogs["enr"]}, {"_id": 0}))
    assert enr["dog_id"] == two_dogs["keep"], "the course moves with the dog that is kept"
