"""A removed or merged-away dog can't lock a family out of booking.

Audit finding (2026-09-25): removing a dog, or merging a duplicate into the
main dog, hides it (deleted_at) but the portal's setup check still counted
it. Its missing shots or details kept the family's setup open, so every Book
button sent them back to a checklist they couldn't finish (they can't see
that dog) — while the staff Clients list, which skips removed dogs, showed
them Ready to Book. The admin "what the client sees" snapshot also listed it.
"""
import uuid

import pytest

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import server
from _test_loop import run

TAG = "TEST_REMOVED_DOG_SETUP"
ADMIN = {"id": "removed-dog-admin", "role": "admin", "name": "Pat Owner"}


@pytest.fixture()
def family():
    cid = str(uuid.uuid4())
    client = {"id": cid, "name": f"{TAG} Client", "phone": "3305550100", "email": f"{uuid.uuid4().hex[:8]}@example.com",
              "emerg": "Sam 330-555-0101"}
    run(server.db.clients.insert_one(dict(client)))
    good = {"id": str(uuid.uuid4()), "name": "Biscuit", "owner_id": cid, "breed": "Mix", "age_y": 3,
            "vaccines": {"rabies": "2030-01-01", "dhpp": "2030-01-01", "bordetella": "2030-01-01"}}
    # Removed with nothing on file — the kind of record that used to hold setup open.
    removed = {"id": str(uuid.uuid4()), "name": "Old Duplicate", "owner_id": cid, "breed": "", "vaccines": {},
               "deleted_at": server.now_iso(), "archived": True}
    run(server.db.dogs.insert_many([dict(good), dict(removed)]))
    yield client, good, removed
    run(server.db.dogs.delete_many({"owner_id": cid}))
    run(server.db.clients.delete_one({"id": cid}))


def _status(client_id):
    client = run(server.db.clients.find_one({"id": client_id}, {"_id": 0}))
    return run(server._compute_setup_status_for_client(client))


def test_a_removed_dog_does_not_hold_the_familys_setup_open(family):
    client, _good, removed = family
    with_removed = _status(client["id"])
    run(server.db.dogs.delete_one({"id": removed["id"]}))
    without = _status(client["id"])
    assert with_removed["booking_locked"] == without["booking_locked"]
    assert with_removed["ready_to_book"] == without["ready_to_book"]
    assert "Old Duplicate" not in repr(with_removed["steps"])


def test_the_portal_snapshot_shows_only_the_dogs_the_client_sees(family):
    client, good, removed = family
    snap = run(server.admin_client_portal_snapshot(client["id"], ADMIN))
    names = repr(snap)
    assert "Biscuit" in names and "Old Duplicate" not in names
