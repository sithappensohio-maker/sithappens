"""The bulk-email filter "has a dog with missing or expired vaccines" finds families whose
dogs store vaccines as a dict of type to date, the shape the dog record uses (audit #39).
It read the list shape only, so an expired dict-shaped vaccine was never flagged.
Disposable tag TEST_BULK_VAX."""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run

TAG = "TEST_BULK_VAX"
CURRENT = {"rabies": "2030-01-01", "dhpp": "2030-01-01", "bordetella": "2030-01-01"}


def _family(vaccines):
    cid, did = f"{TAG}-c-{uuid.uuid4().hex[:6]}", f"{TAG}-d-{uuid.uuid4().hex[:6]}"
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} Pat", "email": f"{cid}@example.com",
                                      "client_status": "active", "created_at": server.now_iso(), "tag": TAG}))
    run(server.db.dogs.insert_one({"id": did, "name": f"{TAG} Rex", "owner_id": cid, "breed": "Mix",
                                   "vaccines": vaccines, "tag": TAG, "deleted_at": None}))
    return cid


def _flagged(cid):
    rows = run(server._bulk_email_resolve_recipients(["missing_vaccines"]))
    return any(r["id"] == cid for r in rows)


def teardown_module():
    run(server.db.clients.delete_many({"tag": TAG}))
    run(server.db.dogs.delete_many({"tag": TAG}))


def test_a_dict_vaccine_that_has_expired_is_flagged():
    expired = _family({**CURRENT, "rabies": "2025-01-01"})
    assert _flagged(expired)


def test_a_dict_vaccine_with_no_date_is_flagged():
    blank = _family({**CURRENT, "dhpp": ""})
    assert _flagged(blank)


def test_a_dog_with_every_vaccine_current_is_not_flagged():
    current = _family(dict(CURRENT))
    assert not _flagged(current)
