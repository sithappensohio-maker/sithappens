"""What the credits settle on a visit (owner-approved fix, 2026-09-29).

A credit pays for the visit's service units, whatever its dollar value: a
$350/10 pack credit ($35) fully covers a $40 day, and so does a credit the
owner added by hand, a client-form balance or a referral/trivia reward —
those are minted as $0-value lots (``_mutate_client_credits``: no sale backs
them, so they recognise $0 revenue). Only what sits ON TOP of the covered
visit is money taken at pickup: add-ons, configured surcharges, uncovered
extra nights, an extra cash amount, a late-pickup fee.

Money taken on a credits visit used to be worked out as
``actual_price - credit_value``. That is right only when the visit's price
equals the credits' dollar value. On a $0-value credit it made the whole
visit price "money taken": amount_paid and cash revenue $40, a completed
"other" payment nobody made, the register day required. And extra nights
covered by credits raise credit_value but not actual_price, so real add-on
cash on such a stay was clamped away.

Now a full-coverage credits checkout records how much of its price the
credits covered (``credit_covered_value``). The leftover-money step and the
cash-revenue rule read it; a row without it (older checkouts, Case A,
partial coverage) reads ``credit_value`` exactly as before.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

COVERED_FIELD = "credit_covered_value"


def _money(value: Any) -> float:
    try:
        return round(float(value or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def zero_lot_base(booking: dict, addon_total: float) -> float:
    """The visit's own value when the credits used carry no dollar value: its
    estimate without the booking-time add-ons (the add-on step adds those
    again, so leaving them in counted them twice)."""
    return max(0.0, round(_money(booking.get("estimated_price")) - _money(addon_total), 2))


def priced(svc_value: float, credit_value: float, overridden: bool, base: float) -> Dict[str, float]:
    """The price of a visit the credits fully cover, and how much of it they
    settle. A price typed by someone with the pricing permission is the
    visit's price; the credits settle it only up to their own value (their
    dollar value, or the visit's normal value for a $0-value credit), and
    anything above is money due."""
    price = round(float(svc_value), 2)
    if not overridden:
        return {"actual_price": price, COVERED_FIELD: price}
    reach = _money(credit_value) if _money(credit_value) > 0 else _money(base)
    return {"actual_price": price, COVERED_FIELD: round(min(price, reach), 2)}


def covered_value(row: dict) -> float:
    """How much of a credits visit's price the credits settled."""
    value: Optional[Any] = row.get(COVERED_FIELD)
    return _money(value) if value is not None else _money(row.get("credit_value"))
