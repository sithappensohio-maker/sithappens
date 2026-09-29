"""One rule for every price at checkout (audit #23, owner's choice A, 2026-09-29).

Only staff with the "pricing" permission (the owner always has it) change a
price at checkout, for one dog or a household leaving together. Everyone else
checks out at the normal price, and a changed price is refused with a plain
"you don't have permission" before any dog leaves. The prices a checkout can
carry:

  * the visit price (base_price) — except the server's own early-checkout
    quote, which the screen sends for a boarding dog leaving early;
  * an extra cash amount on top (additional_cash_charge — the same box on
    the screen, when the visit is paid from credits);
  * the per-night rate for extra nights (extra_nights_rate);
  * an add-on's price. Nobody types one on the screen: it sends today's
    catalogue price (it asks for the price list again before Complete).
    The paying family's own rate is normal too. Any other price is refused
    with the price it is now, never charged differently from what the
    screen showed (that would record money nobody took); so is an add-on
    that isn't offered anymore.

Merchandise at pickup already follows the Register's rule (a custom item or
a discount needs the pricing permission).
"""
from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from domains.bookings import checkout_discount, friends_family

MSG_PRICE = "You don't have permission to override the checkout price."
MSG_EXTRA = "You don't have permission to add an amount to the checkout price."
MSG_NIGHT_RATE = "You don't have permission to change the extra-night rate."
MSG_DISCOUNT = "You don't have permission to give a discount at checkout."
MSG_ADDON_GONE = "One of the add-ons you picked isn't offered anymore. Please remove it and try again."
MSG_ADDON_PRICE = "The price of {name} is now ${price:.2f}. Check the total and press Complete again."


def configure(*, server_globals: dict) -> None:
    global _server_globals
    _server_globals = server_globals


def _g(name: str):
    return _server_globals[name]


def _same(a: float, b: float) -> bool:
    return abs(float(a) - float(b)) < 0.005


async def refuse_price_changes(booking_id: str, body: Any, user: dict) -> None:
    """Refuse a changed price from someone without the pricing permission.
    Called by every checkout entrance before anything is locked."""
    if _g("_perms_for")(user).get("pricing"):
        checkout_discount.requested(body)   # (a discount needs its reason: refused before anything is locked)
        return
    if float(getattr(body, "checkout_discount_amount", 0) or 0) > 0:
        raise HTTPException(status_code=403, detail=MSG_DISCOUNT)
    if body.base_price is not None and not await _g("_is_early_checkout_price")(booking_id, body, user):
        raise HTTPException(status_code=403, detail=MSG_PRICE)
    if float(body.additional_cash_charge or 0) > 0:
        raise HTTPException(status_code=403, detail=MSG_EXTRA)
    if body.extra_nights_rate is not None:
        raise HTTPException(status_code=403, detail=MSG_NIGHT_RATE)
    if not body.add_ons:
        return
    db = _g("db")
    booking = await db.bookings.find_one({"id": booking_id}, {"_id": 0, "client_id": 1, "bill_to_client_id": 1}) or {}
    payer = friends_family.pricing_client_id(booking)
    for ao in body.add_ons:
        svc = await db.services.find_one({"id": ao.service_id, "active": True}, {"_id": 0, "base_price": 1, "name": 1})
        if not svc:
            raise HTTPException(status_code=400, detail=MSG_ADDON_GONE)
        list_price = float(svc.get("base_price") or 0)
        own = (await _g("resolve_client_price")(payer, "service", ao.service_id, list_price))["effective_price"]
        if not (_same(ao.price, list_price) or _same(ao.price, own)):
            raise HTTPException(status_code=409, detail=MSG_ADDON_PRICE.format(name=svc.get("name") or ao.name, price=list_price))
