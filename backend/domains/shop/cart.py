"""The Shop cart: what a basket may contain, and how it is normalized.

Lifted out of server.py unchanged so the Shop cart has a home of its own —
server.py is at its size ceiling and a cart line needs more fields than it
had room for. Every rule here is the rule that was there before; the gift
card handling added on top is marked where it appears.

`_normalize_cart_lines` is the single choke point every checkout passes
through before pricing, stock, eligibility, idempotency or Stripe. A line
kind that is not accepted HERE cannot be bought, however well the rest of
the system understands it — which is exactly how gift cards were catalogued,
priced and fulfillable while still being unbuyable.
"""
from __future__ import annotations

from typing import Dict, List, Literal, Optional, Tuple

from fastapi import HTTPException
from pydantic import BaseModel, Field


class ShopCartItemIn(BaseModel):
    kind: Literal["product", "credit_pack", "training_program", "gift_card"]
    ref_id: str = Field(min_length=1)
    quantity: int = Field(ge=1, le=50)
    # Phase 5 — Online School commerce. Only meaningful for a
    # training_program line whose program is configured
    # purchase_fulfillment="online_school" (see _validate_shop_item_eligibility);
    # every other line kind/fulfillment ignores this field entirely, same
    # as before it existed. Never trusted as proof of ownership by itself —
    # ownership is re-validated server-side at eligibility-check time.
    dog_id: Optional[str] = None
    # gift_card lines only. Left out, the card goes to the buyer — the common
    # case of buying one for yourself, or to hand on yourself. Filled in, it
    # is a present: it goes straight to them with the name and message on it.
    #
    # These MUST survive normalization. A cart line rebuilt without them is a
    # gift card that quietly arrives at the wrong address with no message,
    # and nothing downstream can tell that anything was lost.
    recipient_email: Optional[str] = Field(default=None, max_length=200)
    recipient_name: Optional[str] = Field(default=None, max_length=120)
    gift_message: Optional[str] = Field(default=None, max_length=300)


class ShopCheckoutIn(BaseModel):
    items: List[ShopCartItemIn] = Field(min_length=1, max_length=40)
    idempotency_key: str = Field(min_length=8, max_length=128)


def _gift_identity(item) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """Who a gift card line is for, as a hashable key — and the one place
    gift details are validated.

    Returning a tuple rather than reading three fields separately means the
    aggregation key and the rebuilt line are guaranteed to agree: there is
    no way to key on one thing and rebuild with another.
    """
    email = (getattr(item, "recipient_email", None) or "").strip().lower() or None
    name = (getattr(item, "recipient_name", None) or "").strip() or None
    message = (getattr(item, "gift_message", None) or "").strip() or None
    if email and ("@" not in email or email.startswith("@") or email.endswith("@")):
        raise HTTPException(
            status_code=422,
            detail="Enter a valid email address for the gift card recipient.")
    if (name or message) and not email:
        # A name and a message with nowhere to send them is a present the
        # recipient never receives. Better to say so at the cart than to
        # deliver a blank card to the buyer.
        raise HTTPException(
            status_code=422,
            detail="Enter the email address to send this gift card to.")
    return (email, name, message)


def _normalize_cart_lines(items: List[ShopCartItemIn]) -> List[ShopCartItemIn]:
    """Aggregates duplicate (kind, ref_id) cart lines into ONE summed-
    quantity line each, in first-seen order — called before pricing, stock
    checks, idempotency fingerprinting, reservation, entitlement creation,
    or Stripe session creation, so a cart split into several small
    duplicate lines can never bypass a stock ceiling or eligibility check
    that only looked at each line individually.

    Explicitly validates kind/ref_id/quantity itself rather than trusting
    the caller's Pydantic model instance — the combined line below is built
    via `model_construct` (bypassing Pydantic's own per-line `le=50` cap,
    which was only ever a per-request-line sanity bound, not a true
    aggregate ceiling — the real ceiling is the stock check downstream),
    so this function is the one place a malformed line is guaranteed to be
    rejected with a clean 422, never an unhandled construction error.

    Phase 5 — the aggregation key includes `dog_id` so two different dogs
    buying the same online_school-fulfillment program stay as separate
    lines (each needs its own enrollment) rather than being summed into a
    single quantity>1 line, which _validate_shop_item_eligibility rejects
    for that fulfillment kind. Every non-dog-targeted line (dog_id=None,
    i.e. every line kind/program that existed before Phase 5) aggregates
    exactly as it always has.

    Commerce-integrity hardening — a dog_id-carrying line represents ONE
    Online School entitlement for that one dog (dog_id is only ever set by
    the client for that purpose; see ShopCartItemIn.dog_id). Quantity must
    equal exactly 1 for such a line, enforced HERE, before pricing/stock/
    eligibility/Stripe ever run — not merely by _validate_shop_item_eligibility
    (defense-in-depth, kept below) and never only by hiding the UI quantity
    stepper. Rejects a single request line requesting >1, and rejects two
    requests for the SAME (kind, ref_id, dog_id) combining to >1 — neither
    a single oversized line nor a client re-submitting the same dog+course
    twice can turn into a quantity>1 charge for one entitlement."""
    combined: Dict[Tuple[str, str, Optional[str]], int] = {}
    order_seen: List[Tuple[str, str, Optional[str]]] = []
    for it in items:
        kind = it.kind
        ref_id = (it.ref_id or "").strip()
        qty = it.quantity
        dog_id = (it.dog_id or "").strip() or None
        if kind not in ("product", "credit_pack", "training_program", "gift_card"):
            raise HTTPException(status_code=422, detail="Invalid item kind in cart.")
        if not ref_id:
            raise HTTPException(status_code=422, detail="Invalid item in cart.")
        if not isinstance(qty, int) or isinstance(qty, bool) or qty <= 0:
            raise HTTPException(status_code=422, detail="Invalid quantity in cart.")
        if dog_id and qty != 1:
            raise HTTPException(status_code=422, detail="An Online School course can only be purchased one at a time per dog.")
        # Two gift cards of the same value for DIFFERENT people are two
        # different things, so the gift identity is part of the key. Summing
        # them into one line would send both to whichever recipient happened
        # to be first.
        gift = _gift_identity(it) if kind == "gift_card" else None
        key = (kind, ref_id, dog_id, gift)
        if key not in combined:
            order_seen.append(key)
            combined[key] = 0
        combined[key] += qty
        if dog_id and combined[key] > 1:
            raise HTTPException(status_code=422, detail="An Online School course can only be purchased one at a time per dog.")
    return [
        ShopCartItemIn.model_construct(
            kind=k, ref_id=rid, quantity=combined[(k, rid, did, gift)], dog_id=did,
            # Carried through explicitly. model_construct builds a NEW line
            # from exactly the fields named here, so anything left out is
            # gone — silently, with no error anywhere.
            recipient_email=(gift or (None, None, None))[0],
            recipient_name=(gift or (None, None, None))[1],
            gift_message=(gift or (None, None, None))[2])
        for (k, rid, did, gift) in order_seen
    ]
