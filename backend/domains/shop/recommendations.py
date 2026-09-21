"""What else to show someone, and — mostly — what not to.

The bar this file tries to clear: every card shown here should be something
a person at the counter would actually have said. That rules out most of
what shops do. There is no "customers also bought" (with this order volume
that sentence would describe four people), no "best seller" (nothing here
measures sales yet), and nothing a model inferred. What is left is what a
trainer curated, plus a careful fallback to the same department.

The ordering, and the reason for it:

  1. complements   someone said "use these together"
  2. related       someone said "you may also like"
  3. alternate     someone said "or this one instead"
  4. same department, only to top up a short row, and only for merchandise

Curation always wins. The fallback exists so a page with one curated item
does not show a row of one, and it is switched off entirely for training,
where "similar department" is not a good enough reason to suggest a course.

Every candidate is resolved through the VIEWER's own catalogue, so an
inactive, hidden or account-only item cannot appear here at all — see
relationships.resolve. On top of that, this file refuses anything it cannot
positively establish the viewer could act on. When eligibility is unknown,
the recommendation is omitted. A missing card costs nothing; a card offering
a course a dog cannot take, or has already finished, costs trust.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence

from domains.shop import relationships as rel_mod

# A row of three or four. Enough to be useful, few enough to still read as a
# recommendation rather than a second catalogue.
DEFAULT_LIMIT = 4
MAX_LIMIT = 8


def _needs_dog(item: dict) -> bool:
    """Does buying this require naming a dog?

    True for an Online School course (the entitlement belongs to one dog)
    and for any program flagged requires_dog.
    """
    if item.get("kind") != "training_program":
        return False
    return bool(item.get("requires_dog")) or item.get("purchase_fulfillment") == "online_school"


async def _dog_eligibility(
    *, db, client_id: Optional[str], item: dict, dogs: Sequence[dict],
    missing_prerequisites, min_age_ok,
) -> bool:
    """Could AT LEAST ONE of this client's dogs actually take this course?

    Asking per dog rather than per account is the whole point: a household
    with two dogs where one has finished the course and the other has not
    should still be shown it. A household where every dog is already
    enrolled should not.

    Returns False whenever the answer cannot be established — no client, no
    dogs, a program that needs a dog but has no online purchase path. The
    caller then omits the card rather than showing an offer that would be
    refused at checkout.
    """
    if not client_id or not dogs:
        return False
    # Only Online School courses have a dog-selection path through the cart.
    # Any other requires_dog program cannot be bought online at all (see
    # _validate_shop_item_eligibility), so recommending it as a purchase
    # would be an offer nobody can accept.
    if item.get("purchase_fulfillment") != "online_school":
        return False

    program = await db.programs.find_one({"id": item["id"]}, {"_id": 0})
    if not program:
        return False

    for dog in dogs:
        existing = await db.dog_programs.find_one(
            {"dog_id": dog["id"], "program_id": item["id"], "delivery_channel": "online_school",
             # The same three statuses the checkout refuses a repurchase for.
             # Reading them from a different list here is how the shop ends
             # up advertising something the till will not sell.
             "status": {"$in": ["active", "completed", "withdrawn"]}},
            {"_id": 0, "status": 1},
        )
        if existing:
            continue
        if not min_age_ok(dog, program):
            continue
        if await missing_prerequisites(dog["id"], program):
            continue
        return True
    return False


async def eligible_for(
    *, db, item: dict, viewer_client_id: Optional[str], dogs: Sequence[dict],
    missing_prerequisites, min_age_ok,
) -> bool:
    """The one gate every recommended item passes through."""
    # Shopify merchandise has its own checkout on its own site. It is a real
    # product and browsing to it is fine, but it does not belong in a row
    # whose implied promise is "add this to the cart you already have".
    if item.get("kind") == "product" and item.get("sales_destination") == "shopify_external":
        return False
    # A price we cannot show is a card that reads as broken.
    if item.get("price") is None:
        return False
    if _needs_dog(item):
        return await _dog_eligibility(
            db=db, client_id=viewer_client_id, item=item, dogs=dogs,
            missing_prerequisites=missing_prerequisites, min_age_ok=min_age_ok)
    return True


def _same_department(item: dict, catalog_items: List[dict], exclude: set) -> List[dict]:
    """The quiet fallback: more of what you are already looking at.

    Deliberately narrow. Same kind, and where the item has one, the same
    category — "another leash" is a reasonable thing to show beside a leash.
    Merchandise only: two courses sharing a category is not a reason to
    suggest one while somebody reads about the other.
    """
    if item.get("kind") != "product":
        return []
    category = item.get("category_id")
    out = []
    for candidate in catalog_items:
        if candidate.get("kind") != "product":
            continue
        if (candidate.get("kind"), candidate.get("id")) in exclude:
            continue
        if category and candidate.get("category_id") != category:
            continue
        out.append(candidate)
    # Stable and not alphabetical-by-accident: the shop's own configured
    # order, with a deterministic tie-break so two equal items never swap
    # places between requests.
    out.sort(key=lambda i: (i.get("online_sort_order") if isinstance(i.get("online_sort_order"), int) else 9999,
                            (i.get("name") or "").lower(), i.get("id") or ""))
    return out


async def for_item(
    *, db, item: dict, item_doc: Optional[dict], catalog_items: List[dict],
    viewer_client_id: Optional[str], dogs: Sequence[dict],
    missing_prerequisites, min_age_ok,
    limit: int = DEFAULT_LIMIT, allow_fallback: bool = True,
) -> List[Dict[str, Any]]:
    """The recommendation row for one product page.

    `item_doc` is the raw database document the relationships live on;
    `catalog_items` is what the viewer is allowed to see. Both are passed in
    rather than fetched here so this function stays pure enough to test
    without a database behind it.
    """
    limit = max(1, min(int(limit or DEFAULT_LIMIT), MAX_LIMIT))
    exclude = {(item.get("kind"), item.get("id"))}
    out: List[Dict[str, Any]] = []

    async def take(candidate: dict, rel: str) -> bool:
        key = (candidate.get("kind"), candidate.get("id"))
        if key in exclude:
            return False
        if not await eligible_for(db=db, item=candidate, viewer_client_id=viewer_client_id,
                                  dogs=dogs, missing_prerequisites=missing_prerequisites,
                                  min_age_ok=min_age_ok):
            return False
        exclude.add(key)
        out.append({"rel": rel, "item": candidate})
        return True

    resolved = rel_mod.resolve(rel_mod.stored(item_doc), catalog_items)
    for rel_name in rel_mod.REL_KINDS:
        for entry in resolved:
            if len(out) >= limit:
                break
            if entry["rel"] == rel_name:
                await take(entry["item"], rel_name)

    if allow_fallback and len(out) < limit:
        for candidate in _same_department(item, catalog_items, exclude):
            if len(out) >= limit:
                break
            await take(candidate, "same_department")

    return out[:limit]
