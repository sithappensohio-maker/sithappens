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

import math
from typing import List, Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field

from domains.bookings import credits_promised

MAX_OF_ONE_PACK = 20   # the most of one pack offered in a single press

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
    # Every add-on picked, once PER DOG that picked it (two dogs with a bath
    # each = the bath's id twice). Priced here, never taken from the screen.
    addon_service_ids: List[str] = Field(default_factory=list, max_length=120)


async def options_for(g: dict, client: dict, body: BookingPayOptionsIn) -> dict:
    """What to offer this client for the booking described by `body`:
    the credit packs that cover it (when credits fall short) and/or the
    add-on dollars to pay ahead. Either part alone is an offer."""
    if not (g["STRIPE_ONLINE_ENABLED"] and g["STRIPE_SECRET_KEY"]):
        return dict(NO_OFFER)  # no card page to send them to
    credit = await _credit_part(g, client, body)
    addons = await _addon_part(g, client, body)
    if not credit["packs"] and not addons:
        return dict(NO_OFFER)
    return {"offer": True, "service_type": body.service_type, **credit, "addons": addons}


def pack_option(item: dict, service_type: str, short: float) -> Optional[dict]:
    """One catalogue pack as an offer for a visit that is `short` credits, or
    None when it is not a pack of that kind. Shared by the client booking
    screen and the Front Desk drop-off payment (dropoff_pay.py), so both
    offer the same thing for the same shortfall.

    Offered in the quantity that covers the visit: two single days for a
    two-day booking, like putting two in the basket (owner request). Past
    MAX_OF_ONE_PACK it is offered as one pack that covers part."""
    if item.get("kind") != "credit_pack" or (item.get("service_type") or "daycare") != service_type:
        return None
    price = round(float(item.get("effective_price") or 0), 2)
    qty = float(item.get("qty") or 0)
    if price <= 0.005 or qty <= 0:
        return None  # checkout refuses a $0 cart
    count = max(1, math.ceil((short - 0.0001) / qty))
    covers = count <= MAX_OF_ONE_PACK
    if not covers:
        count = 1
    return {
        "id": item["id"], "name": item.get("name") or "Credit pack",
        "price": price, "qty": qty,
        "quantity": count, "total": round(price * count, 2), "credits": round(qty * count, 2),
        "display_quantity": item.get("display_quantity"),
        "display_unit": item.get("display_unit"),
        "display_dog_count": item.get("display_dog_count"),
        "covers": covers,
    }


def rank_packs(packs: List[dict]) -> List[dict]:
    """The option that MATCHES the visit first: the cheapest way to cover it
    (two single days at $50 for a two-day booking, not a $220 ten-day pack;
    the "2 dogs 1 day" pack at $37.50 for two dogs, not two singles at $50).
    On a tie, the one that leaves the fewest spare credits, then the fewest
    packs. Options that only cover part go last. Sorts in place."""
    packs.sort(key=lambda p: (not p["covers"], p["total"], p["credits"], p["quantity"], p["name"]))
    if packs and packs[0]["covers"]:
        packs[0]["best_match"] = True
    return packs


def _days(body: BookingPayOptionsIn) -> int:
    return len(set(body.dates)) if (body.service_type == "daycare" and body.dates) else 1


async def _addon_part(g: dict, client: dict, body: BookingPayOptionsIn) -> Optional[dict]:
    """What this booking's add-ons will cost, to SHOW before the booking is
    saved. Add-ons are dollars, never credits, so this is offered whether or
    not credits cover the visit. Priced by the same resolver the booking
    uses, so the client's own add-on prices apply.

    This number is only shown. What is actually charged is read from the
    saved bookings themselves when the card payment starts
    (domains/shop/booking_addons.py), and the paid add-ons are then marked
    "(paid online)" at $0 on those bookings so pickup charges nothing more."""
    counts: dict = {}
    for sid in body.addon_service_ids:
        if sid:
            counts[sid] = counts.get(sid, 0) + 1
    if not counts:
        return None
    try:
        snaps = await g["resolve_addon_snapshots"](client["id"], list(counts), body.service_type)
    except HTTPException:
        return None  # an add-on that can't be booked: the booking itself will say so
    days = _days(body)
    lines, total = [], 0.0
    for a in snaps:
        sid = a.get("service_id") or a.get("id")
        each = round(float(a.get("price") or 0) * int(a.get("qty") or 1), 2)
        times = counts.get(sid, 1) * days
        amount = round(each * times, 2)
        if amount <= 0:
            continue
        lines.append({"name": a.get("name") or a.get("service_name") or "Add-on", "count": times, "amount": amount})
        total = round(total + amount, 2)
    if total <= 0.005:
        return None  # nothing to pay
    return {"total": total, "lines": lines}


async def _credit_part(g: dict, client: dict, body: BookingPayOptionsIn) -> dict:
    """Whether credits fall short for this booking, and the packs that fix it."""
    nothing = {"packs": []}
    pool_field = g["_credit_balance_field"](body.service_type)
    if not pool_field:
        return nothing  # a dollars-only service

    settings = await g["get_settings"]()
    cutoff = g["_boarding_full_day_cutoff_from_rules"](settings.get("booking_rules") or {})
    pickup = (body.pickup_time or cutoff) if body.service_type == "boarding" else body.pickup_time
    try:
        per_booking = float(g["_credit_units_required"](
            body.service_type, body.date, body.end_date,
            dog_count=body.dog_count, pickup_time=pickup, pickup_cutoff_time=cutoff,
        ) or 0)
    except (TypeError, ValueError):
        return nothing  # half-picked dates: nothing to offer yet
    days = _days(body)
    needed = round(per_booking * days, 2)
    on_account = round(float(client.get(pool_field) or 0), 2)
    if needed <= 0:
        return nothing
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
        return nothing  # credits already cover it: nothing new is shown

    catalog = await g["_build_shop_catalog"](client["id"])
    db = g["db"]
    packs = []
    for item in catalog.get("items") or []:
        option = pack_option(item, body.service_type, short)
        if not option:
            continue
        doc = await db.credit_packs.find_one({"id": item["id"]}, {"_id": 0})
        try:
            await g["_validate_shop_item_eligibility"](client, "credit_pack", doc, option["quantity"])
        except HTTPException:
            continue  # checkout would refuse it, so it is not offered
        packs.append(option)
    rank_packs(packs)
    # Owner (2026-11-25): "when a client books let's not show all the extras
    # … just what covers their booking." So the client is offered ONE thing:
    # the match. Bigger packs are still in the Shop; a pack that would only
    # cover part of the booking is not offered here at all.
    packs = packs[:1] if packs and packs[0]["covers"] else []
    return {
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
