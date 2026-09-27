"""Which dog of a multi-dog booking pays the first-dog price — decided by who came.

A family booking two or more dogs together gets the multi-dog discount: the
first dog pays full price, each extra dog gets the discount (dollars) and
uses half a credit. Who is "first" was fixed when the booking was made
(`pricing_snapshot.group_dog_index`, `multi_dog_discount.pre_applied`) and
never looked at again — so when the first dog cancelled or never came, the
dog that did come was still checked out at the extra-dog price or half
credits (audit 2026-09-25).

The owner's rule: the discount applies only when another dog from the same
booking actually came (was checked in). The first dog that came pays full
price; any others that came keep the discount.

`settle(db, booking)` runs when a dog is checked out (and in the checkout
previews). An extra dog with no dog ranked ahead of it that came is promoted
to first-dog pricing: full price, a full credit per unit, the discount
released (kept on record). A promoted dog is saved with rank 0, so a dog
behind it that comes later still gets the discount. Only promotions happen —
the first-ranked dog that came always paid full price already.
"""
from __future__ import annotations

from typing import Any, Dict, Tuple

GONE = ("cancelled", "canceled", "rejected")
REASON = "No dog ahead of it on this booking came, so it pays the first-dog price."


def _rank(row: Dict[str, Any]) -> int:
    ps = row.get("pricing_snapshot") or {}
    idx = ps.get("group_dog_index")
    if idx in (None, ""):
        return 1 if (row.get("multi_dog_discount") or {}).get("pre_applied") else 0
    try:
        return int(idx)
    except (TypeError, ValueError):
        return 0


def is_extra(row: Dict[str, Any]) -> bool:
    return _rank(row) > 0 or bool((row.get("multi_dog_discount") or {}).get("pre_applied"))


def group_priced(row: Dict[str, Any]) -> bool:
    """A row priced by the group rule (so the separate same-day sibling
    discount never applies to it on top)."""
    ps = row.get("pricing_snapshot") or {}
    try:
        return bool(row.get("group_id")) and int(ps.get("group_dog_count") or 0) > 1
    except (TypeError, ValueError):
        return False


async def settle(db, booking: Dict[str, Any], *, now: str) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """(the booking as it should be priced now, the fields to save with the
    checkout). Unchanged unless this is an extra dog with nobody ahead of it."""
    if not booking or not booking.get("group_id") or booking.get("actual_price") or not is_extra(booking):
        return booking, {}
    mine = _rank(booking)
    siblings = await db.bookings.find(
        {"group_id": booking["group_id"], "id": {"$ne": booking.get("id")}},
        {"_id": 0, "id": 1, "status": 1, "checked_in_at": 1, "pricing_snapshot": 1, "multi_dog_discount": 1},
    ).to_list(100)
    ahead_came = [s for s in siblings
                  if s.get("checked_in_at") and s.get("status") not in GONE and _rank(s) < mine]
    if ahead_came:
        return booking, {}

    ps = dict(booking.get("pricing_snapshot") or {})
    md = booking.get("multi_dog_discount") or {}
    addons = 0.0
    for ao in booking.get("add_ons") or []:
        try:
            addons += float(ao.get("price") or 0) * int(ao.get("qty") or 1)
        except (TypeError, ValueError):
            pass
    try:
        full_base = float(md.get("based_on_price") or 0)
    except (TypeError, ValueError):
        full_base = 0.0
    try:
        current = float(booking.get("estimated_price") or 0)
    except (TypeError, ValueError):
        current = 0.0
    if full_base <= 0 and current > 0:
        full_base = max(0.0, current - addons + float(md.get("amount") or 0))
    fields: Dict[str, Any] = {
        "multi_dog_discount": None,
        "multi_dog_discount_released": {**md, "released_at": now, "reason": REASON},
    }
    if full_base > 0:
        fields["estimated_price"] = round(full_base + addons, 2)
    try:
        credits = float(booking.get("credit_units_required") or ps.get("credit_units_required") or 0)
    except (TypeError, ValueError):
        credits = 0.0
    try:
        units = float(ps.get("billable_units") or 0)
    except (TypeError, ValueError):
        units = 0.0
    full_credits = round(units, 2) if units > 0 else (round(credits * 2, 2) if credits > 0 else None)
    if full_credits:
        fields["credit_units_required"] = full_credits
        ps["credit_units_required"] = full_credits
    ps["booked_group_dog_index"] = ps.get("group_dog_index", mine)
    ps["group_dog_index"] = 0
    fields["pricing_snapshot"] = ps
    return {**booking, **fields}, fields
