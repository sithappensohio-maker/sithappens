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
"""
import uuid
from datetime import datetime, timezone
from typing import Any, Iterable

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


async def delete_one(db, collection: str, flt: dict) -> int:
    """Hard-delete the first row matching `flt`, logging it first. Returns the number deleted (0 or 1)."""
    doc = await db[collection].find_one(flt, {"_id": 1, "id": 1})
    if not doc:
        return 0
    await record(db, collection, [doc.get("id")])
    res = await db[collection].delete_one({"_id": doc["_id"]})
    return res.deleted_count


async def delete_many(db, collection: str, flt: dict) -> int:
    """Hard-delete every row matching `flt`, logging them first. Returns the number deleted."""
    docs = await db[collection].find(flt, {"_id": 1, "id": 1}).to_list(None)
    if not docs:
        return 0
    await record(db, collection, [d.get("id") for d in docs])
    res = await db[collection].delete_many({"_id": {"$in": [d["_id"] for d in docs]}})
    return res.deleted_count
