"""A tip, added on the spot at checkout (owner, 2026-10-18: "allow tips as
an add on on the spot").

Unlike the one-time discount this deliberately mirrors the shape of
(domains/bookings/checkout_discount.py), a tip is a flat ADD, not something
capped by what credits already cover, and it needs no reason. A few rules
keep it simple and safe:

  * anyone who can take payments at all may add one — never gated behind
    the "pricing" permission the way a price override or a discount is
    (checkout_prices.refuse_price_changes never looks at this field, by
    construction: see that module's own field list);
  * it is applied dead last, strictly after the one-time discount, so a
    staff discount can never eat into money meant as a tip — the discount's
    own "money due" math never even sees it;
  * never on a friends & family visit: nothing is paid at that pickup, so
    there is nothing to add a tip to (the caller is expected to have
    already stripped it there, the same way additional_cash_charge is);
  * a household leaving together shares the one tip the screen asked for —
    only the dog whose checkout button was pressed carries it; every other
    dog in the group gets it zeroed before its own row is built (the same
    "anchor keeps it" pattern additional_cash_charge already uses, not the
    discount's splitting HouseholdShare — a tip has no "due" to cap against);
  * the bill shows it as its own line, same as the discount does for a
    comp; reopening the checkout clears it, same as additional_cash_charge.
"""
from __future__ import annotations

from typing import Any, Dict, List

FIELD = "tip_amount"


def _money(value: Any) -> float:
    try:
        return round(float(value or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def requested(body: Any) -> float:
    return max(0.0, _money(getattr(body, "tip_amount", 0)))


def apply(booking: dict, update: dict, body: Any) -> float:
    """Adds the tip on top of whatever this stay's price already resolved
    to; returns what it added. Called last, after checkout_discount."""
    tip = requested(body)
    if tip <= 0:
        return 0.0
    prev_price = float(update.get("actual_price") if "actual_price" in update else booking.get("actual_price") or 0)
    update["actual_price"] = round(prev_price + tip, 2)
    update[FIELD] = tip
    # A discount that zeroed the stay (checkout_discount's own "comped"
    # branch, just before this runs) still leaves a tip as real money that
    # changed hands — correct the state it left behind rather than report a
    # comped visit that actually took cash. Left unnormalized on purpose
    # (same as checkout_discount's own placeholder "other" here): whatever
    # reads payment_method downstream already normalizes it.
    if update.get("payment_status") == "comped":
        update["payment_status"] = "paid"
        update["payment_method"] = getattr(body, "payment_method", None) or "other"
        update["amount_paid"] = tip
    return tip


def invoice_lines(booking: dict) -> List[Dict[str, Any]]:
    """The tip's own line on the bill — a positive amount, the discount
    line's mirror image."""
    tip = _money(booking.get(FIELD))
    if tip <= 0:
        return []
    return [{"kind": "tip", "description": "Tip", "booking_id": booking.get("id"),
             "qty": 1, "unit_price": 0.0, "amount": tip, "source": None}]
