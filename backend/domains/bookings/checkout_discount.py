"""The one-time discount at checkout (restored 2026-09-29, owner-approved).

Commit f690a86 ("audit fix", 2026-07-17) was made on an older copy of
server.py and silently took out the server side of this discount, which
fffca9d had added three days before; the checkout screen kept offering it.
From then on every discount typed at checkout was ignored: the visit was
recorded at its full price as if all of it had been paid (the drawer came
up short by the discount), a discounted add-on on a credits visit became a
completed "other" payment nobody made, and on a tab the discount became
debt. Restored with the same rules, fitted to today's checkout:

  * only staff with the pricing permission give one (checkout_prices), and
    it needs a reason of at least 3 characters;
  * it comes off the money due for the stay at this pickup, after every
    other pricing step (base price, surcharges, extra nights, add-ons, the
    multi-dog discount, an extra amount) and before payment is settled, so
    the tab, a gift card and the money recorded all see the discounted
    amount. Merchandise is a Register sale of its own, never discounted
    here;
  * credits are never discounted: on a visit credits pay, it only comes off
    what sits on top of what the credits cover (credit_cover);
  * it stops at what is due: a discount can bring the stay to $0, never
    below (the record keeps what was asked for next to what was taken). It
    is never refused for being too large: the screen's price can run above
    the server's (a short daycare visit the server bills as a half day), and
    in a household a late refusal would come after the earlier dogs had
    already gone home, their emails and rewards sent;
  * a discount that covers everything due, with money taken for the stay
    as well ("Partial / on tab" on one dog, or credits plus cash), is
    refused before anything is saved, with the real amount due and the
    largest discount that still lets that payment through. The screen
    treats a payment above the visit's total as paying down the account or
    prepaid credit, which a comped stay can't carry;
  * a stay whose money due reaches $0 with no credits used is "comped";
  * a household leaving together shares one discount, in checkout order:
    each dog takes what its own money due allows, and passes the rest on;
  * never on a friends & family visit: nothing is paid at that pickup;
  * the bill shows it as its own line; reopening the checkout clears it.
"""
from __future__ import annotations

from typing import Any, Dict, List, Tuple

from fastapi import HTTPException

from domains.bookings import credit_cover

FIELD = "checkout_discount"
MSG_REASON = "Enter a reason for the checkout discount (at least 3 characters)."
MSG_FRIENDS = ("Nothing is paid at a friends & family pickup, so there is no discount to give here. "
               "Change the price instead, or adjust the bill.")


def _money(value: Any) -> float:
    try:
        return round(float(value or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def requested(body: Any) -> Tuple[float, str]:
    """The discount a checkout asks for, and its reason (refused without one)."""
    amount = max(0.0, _money(getattr(body, "checkout_discount_amount", 0)))
    reason = (getattr(body, "checkout_discount_reason", None) or "").strip()
    if amount > 0 and len(reason) < 3:
        raise HTTPException(status_code=400, detail=MSG_REASON)
    return amount, reason


def refuse_on_friends_family(body: Any) -> None:
    if max(0.0, _money(getattr(body, "checkout_discount_amount", 0))) > 0:
        raise HTTPException(status_code=400, detail=MSG_FRIENDS)


def apply(booking: dict, update: dict, body: Any, user: dict, ts: str) -> float:
    """Take the discount off this stay's money due, up to all of it; returns
    what it took (a household passes the rest on to its next dog)."""
    amount, reason = requested(body)
    if amount <= 0:
        return 0.0
    merged = {**booking, **update}
    before = _money(merged.get("actual_price"))
    credits = merged.get("payment_method") == "credits"
    covered = credit_cover.covered_value(merged) if credits else 0.0
    due = max(0.0, round(before - covered, 2))
    taken = round(min(amount, due), 2)
    paid = _money(getattr(body, "amount_paid", None))
    if paid > 0.005 and taken >= due - 0.005:
        raise HTTPException(status_code=400, detail=(
            f"The ${amount:.2f} discount covers all ${due:.2f} due for this visit, so no payment can be taken for it here. "
            f"To take ${paid:.2f}, lower the discount to ${max(0.0, due - paid):.2f} or less, "
            "or record the payment on the family's account."))
    if taken <= 0:
        return 0.0
    after = round(before - taken, 2)
    update["actual_price"] = after
    update[FIELD] = {
        "amount": taken, "reason": reason, "requested_amount": amount,
        "price_before": before, "price_after": after, "credit_value_preserved": covered,
        "applied_at": ts, "applied_by": (user or {}).get("id"),
        "applied_by_name": (user or {}).get("display_name") or (user or {}).get("name") or (user or {}).get("email"),
    }
    if after <= 0.005 and not credits:
        update.update({"actual_price": 0.0, "payment_status": "comped", "payment_method": "other",
                       "amount_paid": 0.0, "balance_due": 0.0, "paid_at": ts})
    return taken


def invoice_lines(booking: dict) -> List[Dict[str, Any]]:
    """The discount's own line on the bill (the service line keeps the price
    before it, so the lines still add up to what the visit cost)."""
    record = booking.get(FIELD) if isinstance(booking.get(FIELD), dict) else {}
    amount = _money(record.get("amount"))
    if amount <= 0:
        return []
    reason = (record.get("reason") or "").strip()
    return [{"kind": "discount", "description": f"Discount · {reason}" if reason else "Discount",
             "booking_id": booking.get("id"), "qty": 1, "unit_price": 0.0, "amount": -amount, "source": record}]


class HouseholdShare:
    """One discount shared by the dogs of a household leaving together."""

    def __init__(self, body: Any) -> None:
        self.amount, self.reason = requested(body)
        self.left = self.amount

    def payload_for(self, payload: dict) -> dict:
        payload["checkout_discount_amount"] = self.left
        payload["checkout_discount_reason"] = self.reason if self.left > 0 else None
        return payload

    def took(self, row: dict) -> dict:
        taken = _money(((row or {}).get(FIELD) or {}).get("amount"))
        self.left = round(max(0.0, self.left - taken), 2)
        return row
