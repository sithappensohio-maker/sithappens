"""Finding things, saving things, and coming back to things.

Four ideas share this file because they share one rule: none of them may
show a customer anything they could not already see in the catalogue.

  discovery    what else to look at, and the items behind a locally-kept
               "recently viewed" list
  favourites   what one client asked us to keep
  (orders live next door in orders.py, read by the routes in server.py and
   guest_routes.py, which are already the two places order authorization
   is decided)

Every route here resolves through the caller's OWN catalogue — the signed-in
client's, with their pricing, or the public one for a guest. That is not a
convenience; it is the security model. An inactive, hidden or account-only
item is absent from that list, so no amount of crafting a request body can
make one come back. There is no second visibility check here to get wrong.

One request, one catalogue read. The recently-viewed list a browser keeps is
sent here as references and resolved in a single pass, because six saved
items fetched one at a time is six round trips and six chances to be slow.
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel, Field

from domains.shop import favorites as favorites_mod
from domains.shop import recommendations as rec_mod
from domains.shop import relationships as rel_mod

# How many references a client may ask us to resolve at once. Comfortably
# more than the recently-viewed cap, small enough that this is never a bulk
# catalogue export by another name.
MAX_REFS = 24


class ItemRef(BaseModel):
    kind: str = Field(max_length=40)
    ref_id: str = Field(min_length=1, max_length=128)


class DiscoveryIn(BaseModel):
    """What the page is showing, and what this browser remembers."""
    kind: Optional[str] = Field(default=None, max_length=40)
    ref_id: Optional[str] = Field(default=None, max_length=128)
    recent: List[ItemRef] = Field(default_factory=list, max_length=MAX_REFS)
    limit: int = Field(default=rec_mod.DEFAULT_LIMIT, ge=1, le=rec_mod.MAX_LIMIT)


class FavoriteIn(BaseModel):
    kind: str = Field(max_length=40)
    ref_id: str = Field(min_length=1, max_length=128)


def register_shop_discovery_routes(*, api, server_globals: dict) -> None:
    def _s(name):
        return server_globals[name]

    async def _limit(request: Request, bucket: str, *, limit: int, window: int) -> None:
        await _s("_enforce_rate_limit")(
            request, bucket, _s("_client_ip")(request), limit=limit, window_seconds=window)

    def _require_client(user: dict) -> str:
        if user.get("role") != "client":
            raise HTTPException(status_code=403, detail="Client account required")
        client_id = user.get("client_id")
        if not client_id:
            # A client-role session with no client_id has no account to own
            # anything. Letting it through would mean querying on None and
            # matching whatever else happens to have no client_id.
            raise HTTPException(status_code=403, detail="Client account required")
        return client_id

    def _resolve_refs(refs, catalog_items):
        """References to items, in the order asked for, silently dropping
        anything this viewer cannot see. Silence is the correct answer: a
        recently-viewed entry for a product that has since been hidden
        should vanish, not announce that it exists."""
        by_ref = {(i.get("kind"), i.get("id")): i for i in catalog_items}
        out, seen = [], set()
        for ref in refs:
            key = (ref.kind, ref.ref_id)
            if key in seen:
                continue
            seen.add(key)
            item = by_ref.get(key)
            if item is not None:
                out.append(item)
        return out

    async def _discovery(body: DiscoveryIn, *, catalog_items, client_id: Optional[str]):
        recommendations = []
        if body.kind and body.ref_id:
            item = next((i for i in catalog_items
                         if i.get("kind") == body.kind and i.get("id") == body.ref_id), None)
            if item is not None:
                item_doc = await _item_document(body.kind, body.ref_id)
                dogs = []
                if client_id:
                    dogs = await _s("db").dogs.find(
                        {"owner_id": client_id}, {"_id": 0, "id": 1, "name": 1, "dob": 1},
                    ).to_list(50)
                recommendations = await rec_mod.for_item(
                    db=_s("db"), item=item, item_doc=item_doc, catalog_items=catalog_items,
                    viewer_client_id=client_id, dogs=dogs,
                    missing_prerequisites=_s("_missing_program_prerequisites"),
                    min_age_ok=_min_age_ok, limit=body.limit,
                )
        recent = _resolve_refs(body.recent, catalog_items)
        # The page someone is on is not something to suggest they return to.
        recent = [i for i in recent
                  if not (i.get("kind") == body.kind and i.get("id") == body.ref_id)]
        return {
            "recommendations": [{"rel": r["rel"], "label": rel_mod.REL_LABELS.get(r["rel"], "You may also like"),
                                 "item": r["item"]} for r in recommendations],
            "recently_viewed": recent,
        }

    async def _item_document(kind: str, ref_id: str) -> Optional[dict]:
        """The raw row the curated relationships are stored on."""
        db = _s("db")
        if kind == "product":
            return await db.pos_products.find_one({"id": ref_id}, {"_id": 0})
        if kind == "training_program":
            return await db.programs.find_one({"id": ref_id}, {"_id": 0})
        if kind == "credit_pack":
            return await db.credit_packs.find_one({"id": ref_id}, {"_id": 0})
        return None

    def _min_age_ok(dog: dict, program: dict) -> bool:
        """Whether a dog is old enough, without raising.

        The server's own check raises an HTTPException, which is right at a
        checkout and wrong here: a recommendation row must not 400 because
        one puppy is too young for one course. Same rule, quieter failure.
        """
        try:
            _s("_require_program_min_age")(dog, program)
            return True
        except Exception:
            return False

    # ─────────────────────────────────────────────────────────── discovery

    @api.post("/shop/discovery")
    async def shop_discovery(body: DiscoveryIn, request: Request,
                             user: dict = Depends(_s("get_current_user"))):
        """Recommendations and recently-viewed, for a signed-in client."""
        client_id = _require_client(user)
        await _limit(request, "shop_discovery", limit=120, window=60)
        catalog = await _s("_build_shop_catalog")(client_id)
        return await _discovery(body, catalog_items=catalog["items"], client_id=client_id)

    @api.post("/public/shop/discovery")
    async def public_shop_discovery(body: DiscoveryIn, request: Request):
        """The same, for someone with no account.

        Guests get the public catalogue, so anything account-only is absent.
        They also get no dog-required training recommended at all: without an
        account there are no dogs to check eligibility against, and the rule
        for unknown eligibility is to omit rather than guess.
        """
        await _limit(request, "public_shop_discovery", limit=60, window=60)
        items = await _s("_public_visible_shop_items")()
        return await _discovery(body, catalog_items=items, client_id=None)

    # ─────────────────────────────────────────────────────────── favourites

    @api.get("/shop/favorites")
    async def list_shop_favorites(request: Request,
                                  user: dict = Depends(_s("get_current_user"))):
        """Everything this client saved, with today's prices and stock.

        One catalogue read for the whole list. Six favourites do not mean
        six requests, here or in the browser.
        """
        client_id = _require_client(user)
        await _limit(request, "shop_favorites_read", limit=120, window=60)
        refs = await favorites_mod.list_refs(_s("db"), client_id)
        catalog = await _s("_build_shop_catalog")(client_id)
        return {"favorites": favorites_mod.resolve(refs, catalog["items"])}

    @api.post("/shop/favorites")
    async def add_shop_favorite(body: FavoriteIn, request: Request,
                                user: dict = Depends(_s("get_current_user"))):
        """Save one. Saving it twice is saving it once."""
        client_id = _require_client(user)
        await _limit(request, "shop_favorites_write", limit=60, window=60)
        catalog = await _s("_build_shop_catalog")(client_id)
        return await favorites_mod.add(
            _s("db"), client_id, body.kind, body.ref_id, catalog_items=catalog["items"])

    @api.delete("/shop/favorites/{kind}/{ref_id}")
    async def remove_shop_favorite(kind: str, ref_id: str, request: Request,
                                   user: dict = Depends(_s("get_current_user"))):
        """Forget one. Forgetting something already forgotten succeeds.

        The delete filter always carries this session's client_id, so a
        request naming another client's favourite removes nothing — it does
        not 403, because saying "that is not yours" confirms it exists.
        """
        client_id = _require_client(user)
        await _limit(request, "shop_favorites_write", limit=60, window=60)
        return await favorites_mod.remove(_s("db"), client_id, kind, ref_id)
