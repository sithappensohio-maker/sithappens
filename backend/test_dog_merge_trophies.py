"""Trophies follow a dog merge without ever doubling up on one dog (audit #28).

A merge used to repoint awarded_trophies.dog_id but never recipient_id, so the
kept dog's trophy wall (which reads recipient_id) lost the duplicate's awards.
The rule now: a moved award is revoked when the kept dog already holds an active
award of the same trophy_code; otherwise it moves to the kept dog. A one-off
repoint covers dogs merged before the fix. Disposable tag TEST_MERGE_TROPHY."""
import uuid

import _test_env  # noqa: F401 — must run before `import server`
import pytest
import server
import trophy_service
from _test_loop import run

TAG = "TEST_MERGE_TROPHY"
ADMIN = {"id": f"{TAG}-admin", "role": "admin", "name": "QA", "email": "qa@test"}


def _award(holder_id, client_id, code, **extra):
    row = {
        "id": str(uuid.uuid4()), "trophy_code": code, "trophy_name": f"{TAG} {code}", "trophy_tier": "bronze",
        "recipient_type": "dog", "recipient_id": holder_id, "dog_id": holder_id, "client_id": client_id,
        "awarded_at": "2026-01-05T00:00:00+00:00", "revoked": False, "tag": TAG,
    }
    row.update(extra)
    return row


@pytest.fixture()
def two_dogs():
    cid, keep, dup = (f"{TAG}-{x}-{uuid.uuid4().hex[:6]}" for x in ("c", "keep", "dup"))
    run(server.db.clients.insert_one({"id": cid, "name": f"{TAG} owner", "email": f"{cid}@example.com",
                                      "client_status": "active", "account_balance": 0.0, "tag": TAG}))
    run(server.db.dogs.insert_many([
        {"id": keep, "owner_id": cid, "name": f"{TAG} keep", "tag": TAG, "created_at": "2026-01-01T00:00:00+00:00"},
        {"id": dup, "owner_id": cid, "name": f"{TAG} dup", "tag": TAG, "created_at": "2026-02-01T00:00:00+00:00"}]))
    yield {"keep": keep, "dup": dup, "cid": cid}
    run(server.db.awarded_trophies.delete_many({"tag": TAG}))
    run(server.db.duplicate_merge_audit.delete_many({"primary_dog_id": {"$in": [keep, dup]}}))
    run(server.db.dogs.delete_many({"tag": TAG}))
    run(server.db.clients.delete_many({"tag": TAG}))


def _merge(ids):
    body = server.DuplicateDogMergeIn(primary_dog_id=ids["keep"], duplicate_dog_id=ids["dup"], confirm_text="MERGE DOG")
    return run(server.admin_duplicate_dog_merge(body, ADMIN))


def test_kept_dog_already_holding_the_trophy_revokes_the_moved_copy(two_dogs):
    keep_award = _award(two_dogs["keep"], two_dogs["cid"], "TEST_SAME")
    dup_award = _award(two_dogs["dup"], two_dogs["cid"], "TEST_SAME", awarded_at="2026-02-05T00:00:00+00:00")
    run(server.db.awarded_trophies.insert_many([keep_award, dup_award]))

    resp = _merge(two_dogs)

    kept_row = run(server.db.awarded_trophies.find_one({"id": keep_award["id"]}, {"_id": 0}))
    assert kept_row["recipient_id"] == two_dogs["keep"]
    assert kept_row.get("revoked") is False, "the kept dog's own award is untouched"
    moved_row = run(server.db.awarded_trophies.find_one({"id": dup_award["id"]}, {"_id": 0}))
    assert moved_row is not None, "the moved copy is revoked, not deleted"
    assert moved_row["revoked"] is True
    assert moved_row["recipient_id"] == two_dogs["keep"]
    assert moved_row["merged_from_dog_id"] == two_dogs["dup"]
    assert resp["trophies"] == {"moved": 1, "revoked": 1}
    audit = run(server.db.duplicate_merge_audit.find_one({"primary_dog_id": two_dogs["keep"]}, {"_id": 0}))
    assert audit is not None


def test_merge_without_a_duplicate_award_repoints_the_trophy(two_dogs):
    dup_award = _award(two_dogs["dup"], two_dogs["cid"], "TEST_ONLY_DUP")
    run(server.db.awarded_trophies.insert_one(dup_award))

    resp = _merge(two_dogs)

    moved_row = run(server.db.awarded_trophies.find_one({"id": dup_award["id"]}, {"_id": 0}))
    assert moved_row["recipient_id"] == two_dogs["keep"]
    assert moved_row["dog_id"] == two_dogs["keep"]
    assert moved_row["merged_from_dog_id"] == two_dogs["dup"]
    assert moved_row["revoked"] is False
    assert resp["trophies"] == {"moved": 1, "revoked": 0}


def test_a_revoked_duplicate_award_does_not_block_the_move(two_dogs):
    kept_revoked = _award(two_dogs["keep"], two_dogs["cid"], "TEST_REVOKED", revoked=True)
    dup_award = _award(two_dogs["dup"], two_dogs["cid"], "TEST_REVOKED")
    run(server.db.awarded_trophies.insert_many([kept_revoked, dup_award]))

    _merge(two_dogs)

    moved_row = run(server.db.awarded_trophies.find_one({"id": dup_award["id"]}, {"_id": 0}))
    assert moved_row["recipient_id"] == two_dogs["keep"]
    assert moved_row["revoked"] is False, "only an active award on the kept dog counts as already held"


def test_one_off_repoints_a_dog_merged_before_the_fix_and_is_idempotent(two_dogs):
    # State left by a merge before the fix: dog_id already moved to the kept dog,
    # recipient_id still names the archived duplicate.
    run(server.db.dogs.update_one({"id": two_dogs["dup"]}, {"$set": {
        "archived": True, "deleted_at": "2026-03-01T00:00:00+00:00", "duplicate_of_dog_id": two_dogs["keep"],
    }}))
    old_award = _award(two_dogs["dup"], two_dogs["cid"], "TEST_OLD_MOVE", dog_id=two_dogs["keep"])
    kept_same = _award(two_dogs["keep"], two_dogs["cid"], "TEST_OLD_SAME")
    dup_same = _award(two_dogs["dup"], two_dogs["cid"], "TEST_OLD_SAME", dog_id=two_dogs["keep"])
    run(server.db.awarded_trophies.insert_many([old_award, kept_same, dup_same]))

    dry = run(trophy_service.repoint_merged_dog_trophies(server.db, dry_run=True))
    assert dry["dry_run"] is True
    assert dry["moved"] == 2 and dry["revoked"] == 1
    still = run(server.db.awarded_trophies.find_one({"id": old_award["id"]}, {"_id": 0}))
    assert still["recipient_id"] == two_dogs["dup"], "a dry run writes nothing"

    applied = run(trophy_service.repoint_merged_dog_trophies(server.db, dry_run=False))
    assert applied["moved"] == 2 and applied["revoked"] == 1
    moved = run(server.db.awarded_trophies.find_one({"id": old_award["id"]}, {"_id": 0}))
    assert moved["recipient_id"] == two_dogs["keep"]
    assert moved["revoked"] is False
    dup_row = run(server.db.awarded_trophies.find_one({"id": dup_same["id"]}, {"_id": 0}))
    assert dup_row["revoked"] is True
    kept_row = run(server.db.awarded_trophies.find_one({"id": kept_same["id"]}, {"_id": 0}))
    assert kept_row["revoked"] is False

    again = run(trophy_service.repoint_merged_dog_trophies(server.db, dry_run=False))
    assert again["moved"] == 0 and again["revoked"] == 0, "a second run finds nothing left to move"


def test_one_off_leaves_a_restored_live_dog_alone(two_dogs):
    # A dog that points at a main dog but is not archived (restored) keeps its trophies.
    run(server.db.dogs.update_one({"id": two_dogs["dup"]}, {"$set": {"duplicate_of_dog_id": two_dogs["keep"]}}))
    live_award = _award(two_dogs["dup"], two_dogs["cid"], "TEST_LIVE")
    run(server.db.awarded_trophies.insert_one(live_award))

    applied = run(trophy_service.repoint_merged_dog_trophies(server.db, dry_run=False))

    assert applied["moved"] == 0
    row = run(server.db.awarded_trophies.find_one({"id": live_award["id"]}, {"_id": 0}))
    assert row["recipient_id"] == two_dogs["dup"]


def test_one_off_follows_a_chain_of_merges_to_the_live_dog(two_dogs):
    # dup was merged into keep, and keep was later merged into top: dup's trophies
    # belong on top, the dog that is still live.
    top = f"{TAG}-top-{uuid.uuid4().hex[:6]}"
    run(server.db.dogs.insert_one({"id": top, "owner_id": two_dogs["cid"], "name": f"{TAG} top", "tag": TAG}))
    run(server.db.dogs.update_one({"id": two_dogs["dup"]}, {"$set": {"archived": True, "duplicate_of_dog_id": two_dogs["keep"]}}))
    run(server.db.dogs.update_one({"id": two_dogs["keep"]}, {"$set": {"archived": True, "duplicate_of_dog_id": top}}))
    chained = _award(two_dogs["dup"], two_dogs["cid"], "TEST_CHAIN")
    run(server.db.awarded_trophies.insert_one(chained))

    applied = run(trophy_service.repoint_merged_dog_trophies(server.db, dry_run=False))

    assert applied["moved"] == 1
    row = run(server.db.awarded_trophies.find_one({"id": chained["id"]}, {"_id": 0}))
    assert row["recipient_id"] == top
    run(server.db.dogs.delete_one({"id": top}))
