"""Taking payment at drop-off (owner request, 2026-11-25).

"I need an easy way to take payment at drop off as some customers pay cash
or card during drop off."

The owner chose the small, safe version: at drop-off the desk sells the
credits that cover the visit — through the Register, exactly the way a pack
is sold today (cash with change, or the card reader) — and at pickup the
checkout uses those credits by itself, so the visit has nothing left to
collect.

Why not write "paid" on the visit? Money on a booking before checkout locks
it (no cancel, no extend, no add-on removal), and checkout does not read
money already on a booking: it would count the full price again, on the
pickup day. Selling credits needs none of that — the sale and the credit
redemption are both existing, tested paths, and the staff checkout is not
changed.

This file answers ONE read-only question for the Front Desk: "for this
family's dogs that are here right now, which pack — and how many — covers
their visits?" It takes no money and writes nothing. The Register does the
selling.

Rules, each one there because checkout behaves that way:

  * the whole family at once. Every dog of the client that is on site for
    the same kind of service is counted together, whether or not they were
    booked as one group — they all draw on the same credits, so one press
    sells what the family needs and a second press never sells it twice;
  * credits are counted the way checkout will take them: an extra dog of a
    group is half a credit only when a dog ahead of it actually came
    (group_rank.settle — the same call checkout makes), otherwise a whole one;
  * a friends & family visit (any row carrying bill_to_client_id — the
    payer's own dog included) goes on the payer's bill in dollars and never
    uses credits, so nothing is sold for it and it is not counted;
  * a prepaid program session is already paid;
  * credits cover the visit itself. Add-ons, late fees and surcharges are
    still dollars at pickup, and the answer says how much is already known;
  * daycare paid by a credit is a full credit however short the day. Where
    short days are half price, the desk is told so before selling.

The matching rule is the client booking screen's own (pay_now.pack_option /
rank_packs), read from the REGISTER catalogue: the packs the desk sells, at
this client's prices.
"""
from __future__ import annotations

from typing import List

from fastapi import Depends, HTTPException

from domains.bookings import group_rank, pay_now

DOLLARS_ONLY = "{service} is paid in dollars at pickup, so there are no credits to sell for it."
NOT_ON_BILL = {"$in": [None, ""]}


def _no(reason: str, **extra) -> dict:
    return {"offer": False, "reason": reason, "packs": [], **extra}


def _on_site(booking: dict) -> bool:
    return bool(booking.get("checked_in_at")) and not booking.get("checked_out_at") and booking.get("status") == "approved"


def _addon_total(booking: dict) -> float:
    total = 0.0
    for a in booking.get("add_ons") or []:
        try:
            total += float(a.get("line_total") if a.get("line_total") is not None
                           else float(a.get("price") or 0) * int(a.get("qty") or 1))
        except (TypeError, ValueError):
            continue
    return round(total, 2)


async def options_for(g: dict, booking: dict) -> dict:
    """What the desk can sell right now to cover this family's checked-in visits."""
    db = g["db"]
    dog = booking.get("dog_name") or "This dog"
    if not _on_site(booking):
        return _no(f"{dog} isn't checked in right now.")
    if booking.get("is_prepaid_program_session"):
        return _no(f"{dog}'s session is already paid for as part of a program.")
    if booking.get("bill_to_client_id"):
        # Every row of a friends & family booking carries this — the payer's
        # own dog too — and checkout never uses credits for any of them.
        return _no(f"{dog}'s visit is on a friends & family bill, so it is paid on that bill, not with credits.")
    service_type = booking.get("service_type") or ""
    pool_field = g["_credit_balance_field"](service_type)
    if not pool_field:
        return _no(DOLLARS_ONLY.format(service=service_type.replace("_", " ").title() or "This service"))
    client = await db.clients.find_one({"id": booking.get("client_id")}, {"_id": 0})
    if not client:
        return _no("This visit has no client account to sell credits to.")

    units_for = g["pricing_domain_services"].service_base_credit_units_for_booking
    now = g["now_iso"]()
    together: List[dict] = []
    async for row in db.bookings.find(
            {"client_id": client["id"], "service_type": service_type, "status": "approved",
             "checked_in_at": {"$nin": [None, ""]}, "checked_out_at": NOT_ON_BILL,
             "bill_to_client_id": NOT_ON_BILL}, {"_id": 0}):
        if _on_site(row) and not row.get("is_prepaid_program_session"):
            together.append(row)
    if not any(b["id"] == booking["id"] for b in together):
        together.append(booking)
    together.sort(key=lambda b: (b["id"] != booking["id"], b.get("dog_name") or ""))

    needed = 0.0
    for row in together:
        settled, _fields = await group_rank.settle(db, row, now=now)   # read-only: nothing is saved
        try:
            needed += max(0.0, float(units_for(settled) or 0))
        except (TypeError, ValueError):
            continue
    needed = round(needed, 2)
    on_account = round(float(client.get(pool_field) or 0), 2)
    short = round(max(0.0, needed - on_account), 2)
    extras = round(sum(_addon_total(b) for b in together), 2)
    notes: List[str] = []
    if extras > 0.005:
        notes.append(f"Add-ons (${extras:.2f}) are still paid at pickup.")
    if service_type == "boarding":
        notes.append("A late pickup fee or an extra night would still be paid at pickup.")
    if service_type == "daycare":
        rules = (await g["get_settings"]()).get("booking_rules") or {}
        if bool(rules.get("stay_pricing_enabled", True)):
            try:
                hours, pct = float(rules.get("daycare_half_day_max_hours", 5)), float(rules.get("half_day_pct", 50))
            except (TypeError, ValueError):
                hours, pct = 5.0, 50.0
            if pct < 100:
                notes.append(f"A credit covers the whole day. A stay of {hours:g} hours or less is only "
                             f"{pct:g}% of the day price when it is paid at pickup instead.")
    base = {
        "client_id": client["id"], "client_name": client.get("name") or "",
        "dogs": [b.get("dog_name") or "" for b in together], "booking_ids": [b["id"] for b in together],
        "service_type": service_type, "pool_label": pay_now.POOL_LABEL.get(service_type, service_type),
        "credits_needed": needed, "credits_on_account": on_account, "credits_available": on_account,
        "credits_short": short, "still_due_at_pickup": extras, "notes": notes,
    }
    names = " and ".join(n for n in base["dogs"] if n) or dog
    if needed <= 0:
        return _no("There is nothing to pay for on this visit yet.", **base)
    if short <= 0.0001:
        tail = f" Add-ons (${extras:.2f}) are still paid at pickup." if extras > 0.005 else ""
        return _no(f"{names}'s visit is already covered by credits on the account.{tail}", covered=True, **base)

    catalog = await g["_build_register_catalog"](client["id"])
    packs: List[dict] = []
    for item in catalog.get("items") or []:
        option = pay_now.pack_option(item, service_type, short)
        if option and option["covers"]:
            packs.append(option)   # a pack that only covers part is not sold here: the rest would still be owed at pickup
    pay_now.rank_packs(packs)
    if not packs:
        return _no(f"No {base['pool_label']} pack at the register covers this visit. Take payment at pickup.", **base)
    return {"offer": True, "reason": "", **base, "packs": packs}


def register_dropoff_pay_routes(*, api, server_globals: dict) -> dict:
    g = server_globals

    @api.get("/bookings/{booking_id}/dropoff-pay-options")
    async def dropoff_pay_options(booking_id: str, user: dict = Depends(g["require_employee_or_admin"])):
        g["_require_take_payments"](user)
        booking = await g["db"].bookings.find_one({"id": booking_id}, {"_id": 0})
        if not booking:
            raise HTTPException(status_code=404, detail="Booking not found")
        return await options_for(g, booking)

    return {"dropoff_pay_options": dropoff_pay_options}
