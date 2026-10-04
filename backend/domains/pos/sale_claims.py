"""One money action at a time on a Register sale.

A hand refund, a return and a void each read what the sale has already given
back, then write. Run at the same moment, two of them each see the sale whole
and both pay out, so the sale is refunded twice (audit #86: "a refund and a
void on the same sale can both go through"). Each one takes this claim before
it reads anything, and gives it back when it has written, so only one runs on a
sale at a time. The claim is one row per sale (unique on pos_sale_id). A claim
left behind by a crash expires, so a sale can't be stuck forever.
"""
import logging
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError

logger = logging.getLogger(__name__)

COLLECTION = "sale_action_claims"
CLAIM_SECONDS = 180
BUSY_DETAIL = "Another refund, return or void on this sale is being saved. Wait a moment and try again."


async def _try_insert(db, doc: dict) -> bool:
    try:
        await db[COLLECTION].insert_one(dict(doc))
        return True
    except DuplicateKeyError:
        return False


async def _take(db, sale_id: str, action: str, token: str) -> bool:
    now = datetime.now(timezone.utc)
    doc = {"pos_sale_id": sale_id, "action": action, "token": token,
           "claimed_at": now, "expires_at": now + timedelta(seconds=CLAIM_SECONDS)}
    if await _try_insert(db, doc):
        return True
    # Someone holds it. Only a claim that has run past its expiry may be taken over.
    # find_one_and_delete is atomic, so two takers can't both win the same stale claim.
    stale = await db[COLLECTION].find_one_and_delete({"pos_sale_id": sale_id, "expires_at": {"$lt": now}})
    if stale is None:
        return False
    return await _try_insert(db, doc)


@asynccontextmanager
async def held(db, sale_id: str, action: str):
    """Hold the sale's money claim for the length of the block.

    Raises 409 (busy) if another refund, return or void on the same sale holds it.
    """
    # Created here, not only at startup: ad hoc test runs never start the app.
    await db[COLLECTION].create_index("pos_sale_id", unique=True)
    token = uuid.uuid4().hex
    if not await _take(db, sale_id, action, token):
        raise HTTPException(status_code=409, detail=BUSY_DETAIL)
    try:
        yield
    finally:
        try:
            await db[COLLECTION].delete_one({"pos_sale_id": sale_id, "token": token})
        except Exception:
            logger.exception("Could not release the %s claim on sale %s; it expires on its own", action, sale_id)
