"""Pay while booking (owner request, 2026-11-25).

"When clients book a service, instead of them booking then going to the Shop
to pay for it, it should give them the option right when they book to pay if
they don't already have the credits to cover it."

The owner chose the small version: when the booking a client is about to make
needs more credits than they hold, the Review step offers the credit packs
that would cover it, and a "Book and pay now" button. Paying stays optional —
the booking is saved either way, and a client who backs out of the card page
simply pays at pickup like before.

This file answers ONE read-only question: "is this booking short on credits,
and which packs can this client buy online right now to fix that?" It takes
no money and writes nothing. The payment itself is the Shop's own checkout
(``POST /shop/checkout`` → ``domains.shop.checkout.create_checkout``), so
there is still exactly one online payment path, with its one idempotency
claim and its one eligibility rule.

Every pack offered here comes out of the client's own Shop catalogue (their
price, the Shop's visibility switches) and is then put through the very
check checkout runs (``_validate_shop_item_eligibility``). So a pack shown in
the booking screen is a pack checkout will accept, and the price shown is the
price charged.

Dollars-only services (grooming, photography) and add-ons have no credits and
get no offer: there is no bill to pay against until staff check the dog out.
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field

from domains.bookings import credits_promised

POOL_LABEL = {"daycare": "daycare", "boarding": "boarding", "training": "training"}

NO_OFFER = {"offer": False, "packs": []}


class BookingPayOptionsIn(BaseModel):
    service_type: str
    date: str
    end_date: Optional[str] = None
    # "Book multiple specific days" (daycare): every picked day.
    dates: List[str] = Field(default_factory=list, max_length=120)
    dog_count: int = Field(default=1, ge=1, le=12)
    pickup_time: Optional[str] = None


async def options_for(g: dict, client: dict, body: BookingPayOptionsIn) -> dict:
    """What to offer this client for the booking described by `body`."""
    if not (g["STRIPE_ONLINE_ENABLED"] and g["STRIPE_SECRET_KEY"]):
        return dict(NO_OFFER)  # no card page to send them to
    pool_field = g["_credit_balance_field"](body.service_type)
    if not pool_field:
        return dict(NO_OFFER)  # a dollars-only service

    settings = await g["get_settings"]()
    cutoff = g["_boarding_full_day_cutoff_from_rules"](settings.get("booking_rules") or {})
    pickup = (body.pickup_time or cutoff) if body.service_type == "boarding" else body.pickup_time
    try:
        per_booking = float(g["_credit_units_required"](
            body.service_type, body.date, body.end_date,
            dog_count=body.dog_count, pickup_time=pickup, pickup_cutoff_time=cutoff,
        ) or 0)
    except (TypeError, ValueError):
        return dict(NO_OFFER)  # half-picked dates: nothing to offer yet
    days = len(set(body.dates)) if (body.service_type == "daycare" and body.dates) else 1
    needed = round(per_booking * days, 2)
    on_account = round(float(client.get(pool_field) or 0), 2)
    if needed <= 0:
        return dict(NO_OFFER)
    # Credits the client's other upcoming visits will use are not free for
    # this one (same rule as the price estimate — domains/bookings/credits_promised).
    promised = 0.0
    if on_account > 0:
        promised = await credits_promised.promised(
            g["db"], client["id"], body.service_type, today=g["business_today"]().isoformat(),
            units_for=g["pricing_domain_services"].service_base_credit_units_for_booking)
    available = credits_promised.free_after(on_account, promised)
    short = round(max(0.0, needed - available), 2)
    if short <= 0.0001:
        return dict(NO_OFFER)  # credits already cover it: nothing new is shown

    catalog = await g["_build_shop_catalog"](client["id"])
    db = g["db"]
    packs = []
    for item in catalog.get("items") or []:
        if item.get("kind") != "credit_pack" or (item.get("service_type") or "daycare") != body.service_type:
            continue
        price = round(float(item.get("effective_price") or 0), 2)
        if price <= 0.005:
            continue  # checkout refuses a $0 cart
        doc = await db.credit_packs.find_one({"id": item["id"]}, {"_id": 0})
        try:
            await g["_validate_shop_item_eligibility"](client, "credit_pack", doc, 1)
        except HTTPException:
            continue  # checkout would refuse it, so it is not offered
        qty = float(item.get("qty") or 0)
        packs.append({
            "id": item["id"], "name": item.get("name") or "Credit pack",
            "price": price, "qty": qty,
            "display_quantity": item.get("display_quantity"),
            "display_unit": item.get("display_unit"),
            "display_dog_count": item.get("display_dog_count"),
            "covers": qty + 0.0001 >= short,
        })
    # The pack that MATCHES the booking first: of the packs that cover it, the
    # smallest one (2 dogs for 1 day → the "2 dogs 1 day" pack, not a 10-day
    # pack), cheapest on a tie. Then the bigger packs, then any that only
    # cover part of it (biggest first). The screen pre-selects the first one.
    packs.sort(key=lambda p: (not p["covers"], p["qty"] if p["covers"] else -p["qty"], p["price"], p["name"]))
    if packs and packs[0]["covers"]:
        packs[0]["best_match"] = True
    return {
        "offer": bool(packs),
        "service_type": body.service_type,
        "pool_label": POOL_LABEL.get(body.service_type, body.service_type),
        "credits_needed": needed,
        "credits_available": available,
        "credits_on_account": on_account,
        "credits_promised": promised,
        "credits_short": short,
        "packs": packs,
    }


def register_pay_now_routes(*, api, server_globals: dict) -> dict:
    g = server_globals
    get_current_user = g["get_current_user"]

    @api.post("/portal/booking-pay-options")
    async def booking_pay_options(body: BookingPayOptionsIn, user: dict = Depends(get_current_user)):
        if user.get("role") != "client":
            raise HTTPException(status_code=403, detail="Client account required")
        client = await g["db"].clients.find_one({"id": user.get("client_id")}, {"_id": 0}) if user.get("client_id") else None
        if not client:
            raise HTTPException(status_code=404, detail="Client not found")
        return await options_for(g, client, body)

    return {"booking_pay_options": booking_pay_options}
