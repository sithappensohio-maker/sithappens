"""Which things in the shop belong with which other things.

Every relationship here was put there by a person. Nothing is inferred, no
model guessed it, and nothing is derived from what other customers bought —
because with this shop's order volume, "customers also bought" would be a
claim about three people, dressed up as a trend. A trainer saying "that
harness is the one to use with that course" is worth more than that, and it
is the only kind of claim this file stores.

The shape, stored on the item's own document as `shop_relationships`:

    [{"rel": "complements", "kind": "product", "ref_id": "...", "position": 0}]

Absent means no relationships, so nothing needs migrating. `rel` is what the
person meant:

    complements   use these together — the leash for the course
    related       you may also like this instead of browsing on
    alternate     the other size, the cheaper one, the replacement

A reference is a (kind, ref_id) pair and nothing else: no name, no price, no
picture. Those belong to the item being pointed AT, are read from it at the
moment of display, and are subject to that item's own visibility. This is
what makes it impossible for a relationship to leak a hidden product or to
show a price that is no longer true — a relationship that pointed at a
snapshot would do both.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException

# The three a person can choose between, in the order they are shown when an
# item has several kinds. Adding a fourth means deciding where it displays,
# so the list is deliberately short.
REL_KINDS = ("complements", "related", "alternate")

REL_LABELS = {
    "complements": "Pairs well with",
    "related": "You may also like",
    "alternate": "Other options",
}

# What a relationship may point at. Same discriminator the cart, the catalog
# and the checkout already use, so a reference is resolvable everywhere.
REF_KINDS = ("product", "credit_pack", "training_program")

# Per item, across all three kinds. A shop page with forty "related" items is
# not a curated shop, and the cap is what stops one from arriving by accident.
MAX_RELATIONSHIPS = 24


def _pair(rel: dict) -> Tuple[str, str, str]:
    return (rel.get("rel"), rel.get("kind"), rel.get("ref_id"))


def normalize(raw: Any, *, self_kind: str, self_id: str) -> List[Dict[str, Any]]:
    """Validate what an admin submitted and put it in storage order.

    Refuses rather than silently repairs, because the caller is a person
    using an editor: a relationship that is quietly dropped on save looks
    exactly like one that saved fine, and they find out weeks later.

    The two refusals that matter:

      * an item related to ITSELF, which renders as a product recommending
        you buy the product you are looking at
      * the SAME relationship twice, which renders as the same card twice
    """
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise HTTPException(status_code=422, detail="Related items must be a list.")
    if len(raw) > MAX_RELATIONSHIPS:
        raise HTTPException(
            status_code=422,
            detail=f"An item can have at most {MAX_RELATIONSHIPS} related items.")

    out: List[Dict[str, Any]] = []
    seen = set()
    for entry in raw:
        if not isinstance(entry, dict):
            raise HTTPException(status_code=422, detail="Related items must be a list of references.")
        rel = (entry.get("rel") or "related").strip()
        kind = (entry.get("kind") or "").strip()
        ref_id = (entry.get("ref_id") or "").strip()
        if rel not in REL_KINDS:
            raise HTTPException(status_code=422, detail=f"Unknown relationship type '{rel}'.")
        if kind not in REF_KINDS:
            raise HTTPException(status_code=422, detail=f"Cannot relate to a '{kind}'.")
        if not ref_id:
            raise HTTPException(status_code=422, detail="A related item needs a reference.")
        if kind == self_kind and ref_id == self_id:
            raise HTTPException(status_code=422, detail="An item cannot be related to itself.")
        key = (rel, kind, ref_id)
        if key in seen:
            raise HTTPException(status_code=422, detail="That item is already on this list.")
        seen.add(key)
        out.append({"rel": rel, "kind": kind, "ref_id": ref_id, "position": len(out)})
    return out


def stored(doc: Optional[dict]) -> List[Dict[str, Any]]:
    """Read relationships off an item, tolerating everything.

    Reading is not saving. A doc written by an older build, by a partial
    import, or by hand can hold anything; a malformed entry is skipped so the
    page still renders, where the same entry on the way IN would have been
    refused. Never raises — a shop that will not load because one relationship
    is wrong is a worse shop than one showing three cards instead of four.
    """
    raw = (doc or {}).get("shop_relationships")
    if not isinstance(raw, list):
        return []
    out = []
    seen = set()
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        rel, kind, ref_id = entry.get("rel"), entry.get("kind"), entry.get("ref_id")
        if rel not in REL_KINDS or kind not in REF_KINDS or not isinstance(ref_id, str) or not ref_id:
            continue
        if (rel, kind, ref_id) in seen:
            continue
        seen.add((rel, kind, ref_id))
        position = entry.get("position")
        out.append({"rel": rel, "kind": kind, "ref_id": ref_id,
                    "position": position if isinstance(position, int) else len(out)})
    out.sort(key=lambda r: r["position"])
    return out


def resolve(relations: List[dict], catalog_items: List[dict]) -> List[Dict[str, Any]]:
    """Turn references into real items, using ONLY what this viewer can see.

    `catalog_items` is the caller's own catalogue — the signed-in client's,
    with their pricing, or the public one for a guest. Resolving against it
    rather than against the database is the whole security model of this
    file: an inactive, hidden, account-only or deleted item simply is not in
    that list, so it cannot come back from a relationship. There is no
    separate visibility check to forget to write, and none to get wrong.

    A reference that resolves to nothing is dropped in silence. That is the
    graceful failure for a deleted product: one fewer card.
    """
    by_ref = {(i.get("kind"), i.get("id")): i for i in catalog_items}
    out = []
    for rel in relations:
        item = by_ref.get((rel["kind"], rel["ref_id"]))
        if item is None:
            continue
        out.append({"rel": rel["rel"], "item": item})
    return out


def merge_into(update: dict, submitted, *, self_kind: str, self_id: str) -> dict:
    """Put validated relationships into an update, or leave them alone.

    `None` means the caller did not mention relationships, so whatever is
    stored stays stored. An explicit list — including `[]` — is a decision,
    and replaces them.

    That distinction is the whole reason this helper exists. Several of this
    app's editors build their update with `model_dump()`, which turns an
    unmentioned field into `None`; without this, saving a program's schedule
    from a screen that knows nothing about merchandising would silently wipe
    an admin's curation.
    """
    if submitted is None:
        update.pop("shop_relationships", None)
        return update
    update["shop_relationships"] = normalize(submitted, self_kind=self_kind, self_id=self_id)
    return update
