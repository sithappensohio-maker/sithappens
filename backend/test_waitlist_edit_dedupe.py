"""Moving a waitlist entry to other dates keeps the duplicate check on the new
dates (audit: "editing an entry's date keeps its old duplicate key"). A move
onto another live entry for the same dog and service is refused. Disposable
tag TEST_WL_EDIT; rows are removed afterwards."""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
from _test_loop import run

TAG = "TEST_WL_EDIT"
ADMIN = {"id": f"{TAG}-admin", "name": "WL QA", "email": "wl@test", "role": "admin"}


def _key(dog_id, start, end):
    return "|".join([dog_id, "daycare", "", start, end, ""])


def _entry(dog_id, start, end, status="waiting"):
    doc = {"id": f"{TAG}-{uuid.uuid4().hex[:8]}", "dog_id": dog_id, "service_type": "daycare", "service_id": "",
           "requested_date": start, "requested_end_date": end, "time": "", "status": status,
           "dedupe_key": _key(dog_id, start, end), "tag": TAG, "created_at": server.now_iso()}
    run(server.db.waitlist.insert_one(dict(doc)))
    return doc


@pytest.fixture(autouse=True)
def _cleanup():
    yield
    run(server.db.waitlist.delete_many({"tag": TAG}))


def test_a_moved_entry_gets_the_key_for_its_new_dates():
    dog = f"{TAG}-dog-{uuid.uuid4().hex[:6]}"
    e = _entry(dog, "2031-07-01", "2031-07-03")
    out = run(server.update_waitlist_entry(e["id"], server.WaitlistPatch(requested_date="2031-08-01", requested_end_date="2031-08-03"), ADMIN))
    assert out["requested_date"] == "2031-08-01"
    assert out["dedupe_key"] == _key(dog, "2031-08-01", "2031-08-03"), "the duplicate check follows the new dates"
    # the same dog can now be added for the old dates again, and not for the new ones
    assert run(server.db.waitlist.find_one({"dedupe_key": _key(dog, "2031-07-01", "2031-07-03")}, {"_id": 0}, )) is None


def test_moving_onto_another_live_entry_for_the_same_dog_is_refused():
    dog = f"{TAG}-dog-{uuid.uuid4().hex[:6]}"
    _entry(dog, "2031-09-05", "2031-09-05")
    e = _entry(dog, "2031-09-10", "2031-09-10")
    with pytest.raises(server.HTTPException) as err:
        run(server.update_waitlist_entry(e["id"], server.WaitlistPatch(requested_date="2031-09-05", requested_end_date="2031-09-05"), ADMIN))
    assert err.value.status_code == 409
    still = run(server.db.waitlist.find_one({"id": e["id"]}, {"_id": 0}))
    assert still["requested_date"] == "2031-09-10", "a refused move changes nothing"


def test_a_move_of_a_finished_entry_is_not_a_duplicate_clash():
    dog = f"{TAG}-dog-{uuid.uuid4().hex[:6]}"
    _entry(dog, "2031-10-05", "2031-10-05", status="booked")
    e = _entry(dog, "2031-10-10", "2031-10-10")
    out = run(server.update_waitlist_entry(e["id"], server.WaitlistPatch(requested_date="2031-10-05", requested_end_date="2031-10-05"), ADMIN))
    assert out["requested_date"] == "2031-10-05"
