"""Shipping for self-fulfilled Shop products (owner request 2026-10-15,
Shop gap-list item 5: "shipping for regular Shop products"). Printify's
own items ship through Printify already; this is for everything else —
an admin explicitly marks a product Shippable (and gives it a weight),
and a client or guest can choose to have their whole cart shipped
instead of picked up, priced by a real FedEx Ground rate quote
(domains.shop.fedex).

All-or-nothing by design: a cart with even one non-shippable physical
item can't be shipped at all — no split-shipment support here. The
customer removes it or picks up the whole order instead; _price_shop_
cart's own line-level `shippable` snapshot (frozen at pricing time, same
as every other per-line fact) is what this checks against. Never taxed
— shipping is a service charge, not merchandise, same rule tax already
uses for a credit pack or training program line.

Fails CLOSED, never silently free: if FedEx isn't configured
(domains.shop.fedex.FEDEX_ENABLED) or the quote call itself fails, the
cart simply refuses the ship option with a clear reason. It never
charges $0 or guesses a rate.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from pydantic import BaseModel, Field

from domains.shop import fedex
from domains.shop import pickup as shop_pickup

logger = logging.getLogger(__name__)


class ShopShippingAddressIn(BaseModel):
    address1: str = Field(min_length=1, max_length=120)
    address2: Optional[str] = Field(default=None, max_length=120)
    city: str = Field(min_length=1, max_length=80)
    region: str = Field(min_length=2, max_length=40)   # state
    zip: str = Field(min_length=3, max_length=12)
    country: str = Field(default="US", max_length=2)


def cart_shippable(lines: List[dict]) -> bool:
    """Every PHYSICAL line must itself be shippable — a gift card, credit
    pack, or training program line never blocks shipping (none of them is
    a pickup/ship decision at all); one non-shippable product in an
    otherwise-shippable cart does."""
    physical = [l for l in lines if l.get("kind") == "product"]
    return bool(physical) and all(l.get("shippable") for l in physical)


def cart_weight_lbs(lines: List[dict]) -> float:
    return round(sum(
        float(l.get("shipping_weight_lbs") or 0) * float(l.get("quantity") or 1)
        for l in lines if l.get("kind") == "product"
    ), 2)


async def quote_for_cart(lines: List[dict], address: ShopShippingAddressIn) -> float:
    if not cart_shippable(lines):
        raise HTTPException(
            status_code=400,
            detail="One or more items in this cart can't be shipped — remove them or choose pickup.")
    weight = cart_weight_lbs(lines)
    if weight <= 0:
        raise HTTPException(status_code=400, detail="This cart has nothing that needs shipping.")
    if not fedex.FEDEX_ENABLED:
        raise HTTPException(status_code=400, detail="Shipping isn't available right now — please choose pickup instead.")
    try:
        return await fedex.quote_ground_rate(
            ship_to=fedex.ShipToAddress(
                street=address.address1, city=address.city, state=address.region,
                zip=address.zip, country=address.country),
            weight_lbs=weight,
        )
    except fedex.FedexApiError:
        raise HTTPException(status_code=400, detail="Could not get a shipping rate right now — please choose pickup instead.")


def _ship_to_from_order_address(address: dict) -> fedex.ShipToAddress:
    return fedex.ShipToAddress(
        street=address.get("address1") or "", city=address.get("city") or "",
        state=address.get("region") or "", zip=address.get("zip") or "",
        country=address.get("country") or "US",
    )


async def create_label_for_order(order: dict) -> fedex.ShipmentLabel:
    """Creates a real FedEx Ground label for a self-fulfilled `order`
    (owner, 2026-10-18: "do the labels... in the app"). Same fail-closed
    rules as quote_for_cart — not configured, or nothing to ship, refuses
    with a clear reason rather than faking a label.

    This is NOT idempotent on its own — every call commits a real
    shipment against the FedEx account. The one caller
    (server.create_shop_order_shipping_label) is what makes it safe to
    click twice, by checking for an already-stored label first and never
    reaching this function a second time for the same order.
    """
    address = order.get("shipping_address")
    if not address:
        raise HTTPException(status_code=400, detail="This order has no shipping address on file.")
    weight = cart_weight_lbs(order.get("lines") or [])
    if weight <= 0:
        raise HTTPException(status_code=400, detail="This order has nothing that needs shipping.")
    if not fedex.FEDEX_ENABLED:
        raise HTTPException(status_code=400, detail="FedEx shipping isn't configured yet — ship this one manually for now.")
    try:
        return await fedex.create_ground_label(
            ship_to=_ship_to_from_order_address(address), weight_lbs=weight, reference=order.get("id") or "")
    except fedex.FedexApiError:
        raise HTTPException(status_code=400, detail="Could not create a FedEx label right now — try again, or ship it manually.")


async def email_shipped(db, order: dict) -> Dict[str, Any]:
    """Email the customer that `order` has shipped; never raises. Returns
    what happened, for the staff toast — same contract as
    domains.shop.pickup.email_ready, and the same client-vs-guest
    recipient resolution (a client's current address on file wins over
    the one frozen on the order)."""
    import email_service
    try:
        to, name = await shop_pickup.recipient(db, order)
        if not to:
            return {"state": "no_email"}
        sent = await email_service.send_shop_order_shipped(
            to, order, client_name=name, tracking_number=order.get("tracking_number"))
        if sent:
            return {"state": "sent", "to": to}
        held = await db.email_outbox.find_one(
            {"key": f"shop_order_shipped:{order.get('id')}", "status": "pending"}, {"_id": 0, "last_error": 1})
        if held:
            quiet = "quiet hours" in (held.get("last_error") or "").lower()
            return {"state": "queued", "to": to, "reason": "quiet_hours" if quiet else "retrying"}
        return {"state": "failed", "to": to}
    except Exception as exc:   # the order is shipped either way
        logger.warning("Shipped email for order %s not sent: %s", order.get("id"), exc)
        return {"state": "failed"}
