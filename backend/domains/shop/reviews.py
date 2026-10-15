"""Shop product reviews — a star rating plus optional text from a client
who actually bought the product (owner request 2026-10-15, Shop gap-list
item 4: "product reviews/ratings"). Scoped to merchandise (`kind=
"product"`) only — a credit pack or training program isn't the kind of
thing people leave star ratings on here.

Nothing shows up unreviewed: a new review starts "pending" and is hidden
from the product page until an admin approves it (Shop Manager →
Reviews) — the same posture this app already takes with other client-
submitted content. Editing an already-published review sends it back to
pending, since a review that changed after approval was never actually
the one approved.

One review per (product_id, client_id); resubmitting edits the existing
row in place rather than creating a duplicate. "Bought it" means a PAID
order with this product on a line whose quantity isn't entirely refunded
— the same rule domains.shop.pickup.collectable_lines already uses for
"is there still something real here."
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from pydantic import BaseModel, Field


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class ShopReviewIn(BaseModel):
    rating: int = Field(ge=1, le=5)
    text: Optional[str] = Field(default=None, max_length=1000)


class ShopReviewModerateIn(BaseModel):
    status: str = Field(pattern="^(published|rejected)$")


async def has_purchased(db, client_id: Optional[str], product_id: str) -> bool:
    if not client_id:
        return False
    orders = await db.shop_orders.find(
        {"client_id": client_id, "status": "paid", "lines.kind": "product", "lines.ref_id": product_id},
        {"_id": 0, "lines": 1}).to_list(50)
    for order in orders:
        for line in order.get("lines") or []:
            if line.get("kind") != "product" or line.get("ref_id") != product_id:
                continue
            left = int(line.get("quantity") or 0) - int(line.get("quantity_refunded") or 0)
            if left > 0:
                return True
    return False


async def submit_review(db, product_id: str, client: dict, body: ShopReviewIn) -> dict:
    client_id = client["id"]
    if not await has_purchased(db, client_id, product_id):
        raise HTTPException(status_code=403, detail="You can review a product once you've bought it.")
    ts = _now_iso()
    text = (body.text or "").strip() or None
    existing = await db.shop_product_reviews.find_one(
        {"product_id": product_id, "client_id": client_id}, {"_id": 0, "id": 1})
    if existing:
        await db.shop_product_reviews.update_one(
            {"id": existing["id"]},
            {"$set": {"rating": body.rating, "text": text, "status": "pending", "updated_at": ts,
                      "moderated_at": None, "moderated_by": None}})
        return await db.shop_product_reviews.find_one({"id": existing["id"]}, {"_id": 0})
    doc = {
        "id": str(uuid.uuid4()), "product_id": product_id, "client_id": client_id,
        "client_name": client.get("name") or "A Sit Happens client",
        "rating": body.rating, "text": text,
        "status": "pending", "created_at": ts, "updated_at": ts,
        "moderated_at": None, "moderated_by": None,
    }
    await db.shop_product_reviews.insert_one(doc.copy())
    doc.pop("_id", None)
    return doc


async def my_review(db, product_id: str, client_id: Optional[str]) -> Optional[dict]:
    if not client_id:
        return None
    return await db.shop_product_reviews.find_one(
        {"product_id": product_id, "client_id": client_id}, {"_id": 0})


def aggregate_from(reviews: List[dict]) -> Dict[str, Any]:
    count = len(reviews)
    avg = round(sum(r["rating"] for r in reviews) / count, 2) if count else None
    return {"rating_avg": avg, "rating_count": count}


async def published_reviews_and_aggregate(db, product_id: str, limit: int = 50) -> Dict[str, Any]:
    reviews = await db.shop_product_reviews.find(
        {"product_id": product_id, "status": "published"},
        {"_id": 0, "client_id": 0}).sort("created_at", -1).to_list(limit)
    return {"reviews": reviews, **aggregate_from(reviews)}


async def rating_summaries(db, product_ids: List[str]) -> Dict[str, Dict[str, Any]]:
    """{product_id: {rating_avg, rating_count}} for every id with at least
    one PUBLISHED review — batched in one aggregation so attaching this to
    a catalog of N products never costs N extra round trips."""
    if not product_ids:
        return {}
    rows = await db.shop_product_reviews.aggregate([
        {"$match": {"product_id": {"$in": product_ids}, "status": "published"}},
        {"$group": {"_id": "$product_id", "avg": {"$avg": "$rating"}, "count": {"$sum": 1}}},
    ]).to_list(len(product_ids))
    return {r["_id"]: {"rating_avg": round(r["avg"], 2), "rating_count": r["count"]} for r in rows}


async def list_for_moderation(db, status: Optional[str] = "pending", limit: int = 200) -> List[dict]:
    q: Dict[str, Any] = {"status": status} if status else {}
    out = []
    for r in await db.shop_product_reviews.find(q, {"_id": 0}).sort("created_at", 1).to_list(limit):
        product = await db.pos_products.find_one({"id": r["product_id"]}, {"_id": 0, "name": 1})
        out.append({**r, "product_name": (product or {}).get("name") or "Deleted product"})
    return out


async def moderate(db, review_id: str, *, status: str, actor_name: str) -> dict:
    doc = await db.shop_product_reviews.find_one_and_update(
        {"id": review_id}, {"$set": {"status": status, "moderated_at": _now_iso(), "moderated_by": actor_name}},
        projection={"_id": 0}, return_document=True,
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Review not found")
    return doc
