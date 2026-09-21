"""Things a client asked us to remember.

A favourite is a reference and a timestamp. That is the entire record:

    {client_id, kind, ref_id, created_at}

No name, no price, no picture, no copy of the product. Everything shown on
the favourites page is read from the live catalogue at the moment it is
shown, which is what makes a favourite safe to keep for a year: the price
cannot go stale because there is no price, and an item that stops being
visible to this client stops appearing, without anything needing to go back
and clean up.

Ownership is by construction. Every query is scoped to the `client_id` on
the authenticated session and never to anything a caller sent, so there is
no request shape that reaches another account's favourites — not a crafted
id, not a guessed one, not a stale one from a different login.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import HTTPException

# What can be saved. Gift cards are deliberately absent: a gift card is money
# with a value printed on it, not an item you come back to later.
FAVORITE_KINDS = ("product", "credit_pack", "training_program")

# Generous for a person, low enough that a script cannot turn this table into
# storage. A client who hits it is told, not silently truncated.
MAX_FAVORITES = 200


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def list_refs(db, client_id: str) -> List[Dict[str, Any]]:
    """The client's saved references, newest first. One query, always."""
    rows = await db.shop_favorites.find(
        {"client_id": client_id}, {"_id": 0, "kind": 1, "ref_id": 1, "created_at": 1},
    ).sort("created_at", -1).to_list(MAX_FAVORITES)
    return [r for r in rows if r.get("kind") in FAVORITE_KINDS and r.get("ref_id")]


async def add(db, client_id: str, kind: str, ref_id: str, *, catalog_items: List[dict]) -> dict:
    """Save one, idempotently.

    Saving the same thing twice is not an error — a double tap on a heart is
    a double tap on a heart, and it should leave one favourite and a heart
    that is filled in. The unique index makes that true even when two taps
    race each other.

    What IS refused is saving something this client cannot see. The check is
    membership of their OWN catalogue, so a hidden product, an account-only
    product belonging to somebody else's pricing, and an id that never
    existed all fail the same way and are indistinguishable in the response.
    """
    kind = (kind or "").strip()
    ref_id = (ref_id or "").strip()
    if kind not in FAVORITE_KINDS or not ref_id:
        raise HTTPException(status_code=404, detail="This item is unavailable.")
    if not any(i.get("kind") == kind and i.get("id") == ref_id for i in catalog_items):
        raise HTTPException(status_code=404, detail="This item is unavailable.")

    existing = await db.shop_favorites.find_one(
        {"client_id": client_id, "kind": kind, "ref_id": ref_id}, {"_id": 0, "created_at": 1})
    if existing:
        return {"saved": True, "created_at": existing.get("created_at")}

    count = await db.shop_favorites.count_documents({"client_id": client_id})
    if count >= MAX_FAVORITES:
        raise HTTPException(
            status_code=409,
            detail=f"You can save up to {MAX_FAVORITES} items — remove one to save another.")

    created_at = _now()
    try:
        await db.shop_favorites.insert_one(
            {"client_id": client_id, "kind": kind, "ref_id": ref_id, "created_at": created_at})
    except Exception as exc:  # pragma: no cover - exercised by the race test
        # A duplicate key here means the other tap won. That is the correct
        # outcome, not a failure, so it is reported as one saved favourite.
        if "duplicate" not in str(exc).lower() and "E11000" not in str(exc):
            raise
        return {"saved": True, "created_at": created_at}
    return {"saved": True, "created_at": created_at}


async def remove(db, client_id: str, kind: str, ref_id: str) -> dict:
    """Forget one, idempotently.

    Removing something that is not there succeeds. It has to: the only other
    option is an error on the second click of a button that is already doing
    what was asked, and an error that means "it is already gone" is noise.

    Note what this cannot do. The filter always carries this session's
    client_id, so passing another client's favourite deletes nothing at all
    rather than deleting theirs.
    """
    kind = (kind or "").strip()
    ref_id = (ref_id or "").strip()
    result = await db.shop_favorites.delete_one(
        {"client_id": client_id, "kind": kind, "ref_id": ref_id})
    return {"saved": False, "removed": result.deleted_count}


def resolve(refs: List[dict], catalog_items: List[dict]) -> List[Dict[str, Any]]:
    """Attach the live catalogue item to each saved reference.

    An unresolved favourite is kept in the list, marked unavailable, and
    given no name — because we never stored one and the catalogue will not
    give us one for an item this client may no longer see. That is the
    honest rendering: the client knows something they saved has gone and can
    remove it, and nothing about a hidden product has leaked to tell them
    what it was.
    """
    by_ref = {(i.get("kind"), i.get("id")): i for i in catalog_items}
    out = []
    for ref in refs:
        item = by_ref.get((ref["kind"], ref["ref_id"]))
        out.append({
            "kind": ref["kind"], "ref_id": ref["ref_id"],
            "created_at": ref.get("created_at"),
            "available": item is not None,
            "item": item,
        })
    return out
