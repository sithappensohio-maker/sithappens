"""Reopening a checkout undoes what that checkout did, so checking out again
comes out as if it were the first time (audit #14).

Owner decision 2026-09-27 (option A): the second checkout works surcharges out
fresh and the same bill follows it. A reopen used to clear only the price
fields, leaving behind things the first checkout had applied — so the second
checkout either skipped them or applied them twice:

  * the late-pickup fee, daycare hours and an early boarding checkout were
    measured from when staff redid the checkout, not when the dog left (the
    real departure was lost). The reopen now keeps it on the visit
    (`reopen_departure_at`) and `pricing_ts` returns it — unless staff say at
    the reopen that the dog hasn't really left yet, which clears it (and
    every departure recorded before: the dog was still here);
  * a sibling discount the first checkout gave stayed on the visit, so the
    bill showed a discount nobody got (and a reopened full-price dog then
    found its discounted sibling and was discounted too — see
    server._compute_multi_dog_discount);
  * extra nights added at checkout: the stay keeps its extended dates, so
    the next checkout bills those nights once from the dates; the record is
    marked `in_stay` so the checkout screen says they are already included
    (entering them again would bill them twice);
  * add-ons sold at that checkout stayed on the visit but outside
    estimated_price, so the next checkout's base (estimated_price minus all
    add-ons) came out too low.

`undo_checkout` returns what the reopen must set, unset and record; the
reopen's own rollback restores the visit exactly if anything fails.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional, Tuple

# Add-ons rung at a checkout that was since reopened: now part of
# estimated_price, like add-ons attached at booking.
FOLDED_STAGE = "checkout_folded"
# When the dog really left, kept across reopens (shown on the reopen screen).
DEPARTURE_FIELD = "reopen_departure_at"


def _when(value: Any) -> Optional[datetime]:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def pricing_ts(booking: Dict[str, Any], fallback: str) -> str:
    """When the dog really left: the departure a reopen kept, else `fallback`
    (the checkout happening now). Never a time before the dog's check-in."""
    left = booking.get(DEPARTURE_FIELD) if booking.get("financial_reopened_at") else None
    if left:
        came, at = _when(booking.get("checked_in_at")), _when(left)
        if not (came and at and at < came):
            return left
    return fallback


def departure_known(booking: Dict[str, Any]) -> bool:
    """A reopened visit whose real departure is on record — its day is known,
    so it is never asked the late-day question again. A reopen from before
    this rule (no answer on record) counts as known, as it always did."""
    if pricing_ts(booking, ""):
        return True
    latest = (booking.get("financial_reopen_history") or [{}])[-1]
    return bool(booking.get("financial_reopened_at")) and "departure_stands" not in latest


def _line_total(a: Dict[str, Any]) -> float:
    if a.get("line_total") is not None:
        return float(a.get("line_total") or 0)
    return float(a.get("price") or 0) * int(a.get("qty") or 1)


def undo_checkout(booking: Dict[str, Any], *, departure_stands: bool = True
                  ) -> Tuple[Dict[str, Any], Dict[str, str], Dict[str, Any]]:
    """(to set, to unset, to record in the reopen history)."""
    to_set: Dict[str, Any] = {}
    to_unset: Dict[str, str] = {}
    note: Dict[str, Any] = {"prior_checked_out_at": booking.get("checked_out_at"),
                            "departure_stands": bool(departure_stands)}

    if departure_stands:
        # The first real departure wins: a checkout redone after an earlier
        # reopen is only the redo.
        left = booking.get(DEPARTURE_FIELD) or booking.get("checked_out_at")
        if left:
            to_set[DEPARTURE_FIELD] = left
    elif booking.get(DEPARTURE_FIELD) is not None:
        to_unset[DEPARTURE_FIELD] = ""

    md = booking.get("multi_dog_discount")
    if isinstance(md, dict) and md and not md.get("pre_applied"):
        # Worked out again at the next checkout. A pre_applied discount is
        # booking-time group pricing and stays.
        to_unset["multi_dog_discount"] = ""
        note["prior_multi_dog_discount"] = md

    cd = booking.get("checkout_discount")
    if isinstance(cd, dict) and cd:
        # Given again (or not) at the next checkout.
        to_unset["checkout_discount"] = ""
        note["prior_checkout_discount"] = cd

    ext = booking.get("extra_nights") if isinstance(booking.get("extra_nights"), dict) else None
    if ext and int(ext.get("count") or 0) > 0 and not ext.get("in_stay"):
        # The stay keeps its extended end date (any extension, whichever
        # checkout added it, is already in the dates), so the next checkout
        # bills those nights from the dates — never restore the old end date.
        to_set["extra_nights"] = {**ext, "in_stay": True}
        note["prior_extra_nights"] = ext

    addons = list(booking.get("add_ons") or [])
    sold = round(sum(_line_total(a) for a in addons if a.get("added_stage") == "checkout"), 2)
    if sold > 0:
        to_set["estimated_price"] = round(float(booking.get("estimated_price") or 0) + sold, 2)
        to_set["add_ons"] = [{**a, "added_stage": FOLDED_STAGE} if a.get("added_stage") == "checkout" else a
                             for a in addons]
        note["prior_estimated_price"] = booking.get("estimated_price")
        late = booking.get("late_day_checkout") if isinstance(booking.get("late_day_checkout"), dict) else None
        original = (late or {}).get("original")
        if isinstance(original, dict) and original.get("estimated_price") is not None:
            # A daycare visit converted to a stay keeps its daycare original
            # for the late-day Undo: the folded add-ons belong in it too, or
            # undoing the answer would put the base back without them.
            to_set["late_day_checkout"] = {**late, "original": {
                **original, "estimated_price": round(float(original.get("estimated_price") or 0) + sold, 2)}}
    return to_set, to_unset, note
