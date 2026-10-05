"""A deleted (archived) incident stops counting against a dog everywhere (audit #80). Delete
archives the incident in place, but the dog's incident count, timeline, Kennel Board flag,
safety-flag suggestions and Action Center item still counted it. Disposable tag TEST_INC_ARCH."""
import uuid
from datetime import date

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

TAG = "TEST_INC_ARCH"
ADMIN = {"id": f"{TAG}-admin", "role": "admin", "name": "Owner QA", "email": "owner-arch@test"}


def _dog_with_two_incidents():
    cid, did = f"{TAG}-c-{uuid.uuid4().hex[:6]}", f"{TAG}-d-{uuid.uuid4().hex[:6]}"
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} Pat", "email": f"{cid}@example.com",
                                      "client_status": "active", "created_at": server.now_iso(), "tag": TAG}))
    run(server.db.dogs.insert_one({"id": did, "name": "Rex", "owner_id": cid, "breed": "Mix", "tag": TAG,
                                   "vaccines": {}, "safety_flags": []}))
    ids = []
    for kind in ("bite", "other"):
        iid = f"{TAG}-i-{uuid.uuid4().hex[:6]}"
        ids.append(iid)
        run(server.db.incidents.insert_one({
            "id": iid, "dog_id": did, "dog_name": "Rex", "client_id": cid, "client_name": "Pat", "type": kind,
            "severity": "severe", "date": date(2031, 7, 1).isoformat(), "time": "10:00", "description": "x",
            "reported_by": "Staff", "created_at": server.now_iso(), "tag": TAG, "follow_up_required": True,
            "witnesses": "", "action_taken": "", "internal_notes": "", "edit_history": []}))
    return did, ids


def teardown_module():
    for coll in ("clients", "dogs", "incidents"):
        run(getattr(server.db, coll).delete_many({"tag": TAG}))


def test_an_archived_incident_no_longer_counts_against_the_dog():
    did, (gone, kept) = _dog_with_two_incidents()
    assert run(server.dog_stats(did, ADMIN))["incidents"] == 2
    run(server.delete_incident(gone, ADMIN))
    assert run(server.dog_stats(did, ADMIN))["incidents"] == 1
