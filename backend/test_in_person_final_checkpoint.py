"""An in-person dog's final checkpoint marks the dog ready to graduate; it does not
graduate it (audit #29: "Recording an in-person dog's final checkpoint as 'Pass'
graduates the dog immediately"). Same rule as hybrid. Disposable tag TEST_INPERSON_FINAL."""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from _test_loop import run

TAG = "TEST_INPERSON_FINAL"


@pytest.fixture()
def program(monkeypatch):
    async def quiet(*_a, **_k):
        return None
    monkeypatch.setattr(server, "_announce_graduation_ready", quiet)
    eid, did = f"{TAG}-{uuid.uuid4().hex[:6]}", f"{TAG}-dog-{uuid.uuid4().hex[:6]}"
    row = {"id": eid, "dog_id": did, "owner_id": f"{TAG}-c", "status": "active", "delivery_channel": "in_person_school",
           "program_id": f"{TAG}-prog", "tag": TAG, "created_at": server.now_iso()}
    run(server.db.dog_programs.insert_one(dict(row)))
    yield {"row": row, "se": {"id": eid, "dog_id": did}}
    run(server.db.dog_programs.delete_many({"tag": TAG}))


def test_the_final_lesson_makes_an_in_person_dog_ready_not_graduated(program):
    run(server._finish_school_advancement(program["se"]["id"], program["row"], program["se"], None, None, True))
    row = run(server.db.dog_programs.find_one({"id": program["row"]["id"]}, {"_id": 0}))
    assert row["status"] == "active", "the owner or trainer confirms the graduation"
    assert row.get("graduation_ready") is True
