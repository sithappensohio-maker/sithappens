"""Shop discount codes — a customer-entered code that takes money off a
Shop cart's retail (physical-goods) lines, same two shapes (percent/fixed)
as the register's discount math (domains.pos.services.price_pos_cart) —
ported here rather than shared directly, since the register's version is
staff-entered per sale and applies cart-wide at the staff's discretion,
while this one is a stored, reusable, unattended code scoped to retail
only: a gift card is money, not a purchase (same rule as tax), and a
credit pack or training program is prepaid service, not retail —
discounting either gives away cash the client redeems 1-for-1 later
(owner report 2026-10-20).

A code is a plain document:

    {id, code, kind, value, active, clients_only,
     max_uses_total, max_uses_per_client, uses_total,
     expires_at, created_at, created_by, created_by_name, updated_at}

`clients_only=True` (the only kind that exists today — owner request
2026-10-15: "10% off for existing clients only") refuses a guest or an
unauthenticated preview outright; a code with it False would also work for
guest checkout, which nothing creates yet but the field doesn't rule out.

Usage is counted at PAYMENT, not at checkout-start — unlike inventory
(domains.shop.abandon), a code isn't a scarce physical thing, so there is
no reservation/release lifecycle here. A max_uses_total cap could in
theory be oversold by two checkouts finishing in the same instant right at
the cap — an accepted, deliberate tradeoff for a marketing code, not
inventory; see record_redemption.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional

from fastapi import HTTPException
from pydantic import BaseModel, Field


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class ShopDiscountCodeIn(BaseModel):
    code: str = Field(min_length=2, max_length=40)
    kind: Literal["percent", "fixed"] = "percent"
    value: float = Field(gt=0)
    active: bool = True
    # The only mode that exists today (owner request) — a code with this
    # off would also work for a guest/unauthenticated checkout, which
    # nothing creates yet but is deliberately not ruled out here.
    clients_only: bool = True
    max_uses_total: Optional[int] = Field(default=None, ge=1)
    max_uses_per_client: Optional[int] = Field(default=None, ge=1)
    expires_at: Optional[str] = None  # ISO date/datetime string, or None = never


def _normalize_code(raw: str) -> str:
    return (raw or "").strip().upper()


async def create_code(db, body: ShopDiscountCodeIn, *, actor_id: str, actor_name: str) -> dict:
    code = _normalize_code(body.code)
    if not code:
        raise HTTPException(status_code=400, detail="Enter a code.")
    if body.kind == "percent" and body.value > 100:
        raise HTTPException(status_code=400, detail="A percentage discount can't exceed 100%.")
    existing = await db.shop_discount_codes.find_one({"code": code}, {"_id": 0, "id": 1})
    if existing:
        raise HTTPException(status_code=409, detail=f'A code "{code}" already exists.')
    ts = _now_iso()
    doc = {
        "id": str(uuid.uuid4()), "code": code, "kind": body.kind, "value": round(float(body.value), 2),
        "active": bool(body.active), "clients_only": bool(body.clients_only),
        "max_uses_total": body.max_uses_total, "max_uses_per_client": body.max_uses_per_client,
        "uses_total": 0, "expires_at": body.expires_at or None,
        "created_at": ts, "created_by": actor_id, "created_by_name": actor_name, "updated_at": ts,
    }
    await db.shop_discount_codes.insert_one(doc.copy())
    doc.pop("_id", None)
    return doc


async def list_codes(db) -> List[Dict[str, Any]]:
    return await db.shop_discount_codes.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)


async def set_active(db, code_id: str, active: bool) -> dict:
    doc = await db.shop_discount_codes.find_one_and_update(
        {"id": code_id}, {"$set": {"active": bool(active), "updated_at": _now_iso()}},
        projection={"_id": 0}, return_document=True,
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Discount code not found")
    return doc


async def validate_code(db, raw_code: str, *, client_id: Optional[str], is_guest: bool) -> dict:
    """Looks up and checks a code — existence, active, not expired, the
    clients_only gate, and both usage ceilings. Raises a clean 400 with a
    customer-facing reason on any failure; returns the stored doc on
    success. Does NOT compute or apply the discount amount — see
    compute_discount_amount/apply_to_lines, called separately once the
    cart's discountable total is known."""
    code = _normalize_code(raw_code)
    if not code:
        raise HTTPException(status_code=400, detail="Enter a discount code.")
    doc = await db.shop_discount_codes.find_one({"code": code}, {"_id": 0})
    if not doc or not doc.get("active"):
        raise HTTPException(status_code=400, detail="That code isn't valid.")
    if doc.get("expires_at") and str(doc["expires_at"]) < _now_iso():
        raise HTTPException(status_code=400, detail="That code has expired.")
    if doc.get("clients_only") and (is_guest or not client_id):
        raise HTTPException(status_code=400, detail="Sign in to your account to use this code.")
    if doc.get("max_uses_total") is not None and int(doc.get("uses_total") or 0) >= doc["max_uses_total"]:
        raise HTTPException(status_code=400, detail="That code has reached its use limit.")
    if doc.get("max_uses_per_client") is not None and client_id:
        used = await db.shop_discount_code_redemptions.count_documents({"code_id": doc["id"], "client_id": client_id})
        if used >= doc["max_uses_per_client"]:
            raise HTTPException(status_code=400, detail="You've already used this code.")
    return doc


def compute_discount_amount(kind: str, value: float, discountable: float) -> float:
    if discountable <= 0:
        return 0.0
    if kind == "percent":
        return round(discountable * (value / 100.0), 2)
    return round(min(value, discountable), 2)


def apply_to_lines(lines: List[dict], discount_amount: float) -> None:
    """Mutates `lines` in place, setting `allocated_discount` on each —
    proportional to each line's pre-discount line_subtotal, the last
    discountable line absorbs the rounding remainder. Retail (kind
    "product") lines only: unlike the register's broader, staff-discretion
    discount (domains.pos.services.price_pos_cart), this one drives an
    unattended, client-facing discount that must never apply to a gift
    card (money, not a purchase, same rule as tax) or to a credit pack /
    training program (prepaid service — discounting it gives away cash the
    client redeems 1-for-1 later). Must run before tax is computed: the
    caller derives the taxable base from each taxable line's line_subtotal
    minus this allocated_discount."""
    for line in lines:
        line["allocated_discount"] = 0.0
    if discount_amount <= 0:
        return
    discountable_lines = [l for l in lines if l["kind"] == "product"]
    discountable = round(sum(l["line_subtotal"] for l in discountable_lines), 2)
    if discountable <= 0 or not discountable_lines:
        return
    allocated_so_far = 0.0
    last = discountable_lines[-1]
    for line in discountable_lines:
        if line is last:
            line["allocated_discount"] = round(discount_amount - allocated_so_far, 2)
        else:
            share = round(discount_amount * (line["line_subtotal"] / discountable), 2)
            line["allocated_discount"] = share
            allocated_so_far = round(allocated_so_far + share, 2)


async def record_redemption(db, *, code_id: str, code: str, client_id: Optional[str], order_id: str) -> None:
    """Counts a code as used — called once, from the same exactly-once-per-
    order moment a Shop order transitions to paid (see
    server._apply_shop_payment's Step A), never at checkout-start. Not a
    reservation: see this module's docstring for why that tradeoff is
    accepted here."""
    await db.shop_discount_codes.update_one({"id": code_id}, {"$inc": {"uses_total": 1}, "$set": {"updated_at": _now_iso()}})
    await db.shop_discount_code_redemptions.insert_one({
        "id": str(uuid.uuid4()), "code_id": code_id, "code": code,
        "client_id": client_id, "order_id": order_id, "created_at": _now_iso(),
    })
