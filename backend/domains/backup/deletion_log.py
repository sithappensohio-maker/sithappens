"""The log of hard deletes that a merge restore must respect.

A merge restore writes the backed-up copy of each row back into the live database. Without a record, a row
the owner hard-deleted after that backup was taken would come back. So each hard delete of a merge-covered
row leaves an entry in `deleted_records` first, and domains/backup/rules.py decides, per backed-up row,
whether the entry stops the merge from writing it.

Soft deletes (a `deleted_at` stamp) need no entry: a merge never clears a `deleted_at` that the backup does
not carry (see routes._restore_collections_inner).

The writers below log BEFORE they delete. A failed log write then stops the delete, so a removed row always
has an entry. The reverse order could leave a removed row with no entry, and a later merge would bring it
back. An entry for a row that was not removed only makes a later merge leave that row alone.

A row is logged under rules.record_key: its `id`, else its natural key (rules.MERGE_KEYS, e.g. a claim token's
`token`), else its string `_id`. That is the same key the merge matches the backed-up copy by, so rows that have
no `id` (claim tokens, notification log, shop favourites, email templates) are covered too.

Every hard delete of a collection the merge restores (server.BACKUP_COLLECTIONS) goes through these helpers. The
source guard in test_backup_deletion_log.py fails a new bypass. Soft deletes and archive moves are not hard deletes.
"""
import uuid
from datetime import datetime, timezone
from typing import Any, Iterable, Optional

from domains.backup import rules as backup_rules

COLLECTION = "deleted_records"


def _stamp() -> str:
    return datetime.now(timezone.utc).isoformat()


async def ensure_index(db) -> None:
    """The lookup a merge makes per collection: which of these ids were deleted live, and when."""
    await db[COLLECTION].create_index([("collection", 1), ("record_id", 1)], name="collection_record")


async def record(db, collection: str, record_ids: Iterable[Any]) -> None:
    """Log that these rows of `collection` are being hard-deleted now."""
    ids = [str(i) for i in record_ids if i not in (None, "")]
    if not ids:
        return
    stamp = _stamp()
    await db[COLLECTION].insert_many([
        {"id": str(uuid.uuid4()), "collection": collection, "record_id": i, "deleted_at": stamp}
        for i in ids
    ])


def _projection(collection: str) -> dict:
    """The fields a delete needs to name the row: its _id, its id, and its natural key when it has one."""
    return {"_id": 1, "id": 1, **{f: 1 for f in backup_rules.MERGE_KEYS.get(collection, ())}}


async def delete_one(db, collection: str, flt: dict) -> int:
    """Hard-delete the first row matching `flt`, logging it first. Returns the number deleted (0 or 1).

    The removal re-checks `flt` ($and), so a row that changed between the lookup and the removal is not removed."""
    doc = await db[collection].find_one(flt, _projection(collection))
    if not doc:
        return 0
    await record(db, collection, [backup_rules.record_key(collection, doc)])
    res = await db[collection].delete_one({"$and": [flt, {"_id": doc["_id"]}]})
    return res.deleted_count


async def delete_many(db, collection: str, flt: dict) -> int:
    """Hard-delete every row matching `flt`, logging them first. Returns the number deleted."""
    docs = await db[collection].find(flt, _projection(collection)).to_list(None)
    if not docs:
        return 0
    await record(db, collection, [backup_rules.record_key(collection, d) for d in docs])
    res = await db[collection].delete_many({"_id": {"$in": [d["_id"] for d in docs]}})
    return res.deleted_count


async def take_one(db, collection: str, flt: dict, projection: Optional[dict] = None) -> Optional[dict]:
    """Hard-delete the first row matching `flt` and return it (for a find-and-delete caller), logging it first.

    `projection` shapes the returned row only. Returns None when nothing matched. The removal re-checks `flt`,
    so a row changed in between is kept."""
    doc = await db[collection].find_one(flt, _projection(collection))
    if not doc:
        return None
    await record(db, collection, [backup_rules.record_key(collection, doc)])
    return await db[collection].find_one_and_delete({"$and": [flt, {"_id": doc["_id"]}]}, projection=projection)
