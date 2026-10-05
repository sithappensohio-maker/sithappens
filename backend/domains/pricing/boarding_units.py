"""Boarding stay units: how many billable nights a stay has, and the clock-time
rules for the pickup day. Pure functions: no database, no server state.

The pickup-day charge is not here. A pickup after the checkout time bills a
separate daycare day, which lives in domains/pricing (see
_boarding_late_pickup_daycare_fee in server.py)."""
from datetime import datetime
from typing import Optional


def _billable_boarding_nights(start: str, end: Optional[str], *, legacy_minimum: int = 0) -> int:
    """Exclusive pickup-date math for overnight boarding nights only.

    July 1 → July 2 = 1 night. July 1 → July 4 = 3 nights. Pickup-day
    boarding is deliberately handled by `_billable_boarding_units` so every
    quote, credit calculation, and checkout uses the same clock-time rule.
    """
    try:
        s = datetime.fromisoformat(str(start)[:10]).date()
        e = datetime.fromisoformat(str(end or start)[:10]).date()
    except Exception:
        return legacy_minimum
    return max(legacy_minimum, (e - s).days)


DEFAULT_BOARDING_FULL_DAY_PICKUP_CUTOFF = "17:00"


def _clock_minutes(value: Optional[str]) -> Optional[int]:
    """Parse HH:MM (or an ISO-ish time prefix) into minutes after midnight."""
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        hh, mm = raw[:5].split(":", 1)
        hours = int(hh)
        minutes = int(mm)
        if not (0 <= hours <= 23 and 0 <= minutes <= 59):
            return None
        return hours * 60 + minutes
    except Exception:
        return None


def _boarding_full_day_cutoff_from_rules(rules: Optional[dict]) -> str:
    """Return the admin-configured boarding pickup cutoff as valid HH:MM."""
    raw = str((rules or {}).get("boarding_full_day_pickup_cutoff") or "").strip()
    return raw[:5] if _clock_minutes(raw) is not None else DEFAULT_BOARDING_FULL_DAY_PICKUP_CUTOFF


def _boarding_pickup_day_units(
    pickup_time: Optional[str],
    cutoff_time: Optional[str] = DEFAULT_BOARDING_FULL_DAY_PICKUP_CUTOFF,
    grace_minutes: int = 0,
) -> float:
    """1.0 when the boarding pickup is late enough to bill, else 0.0.

    The cutoff is the boarding checkout time. Pickup at or before it (plus the
    admin-configured grace window) is free; pickup after it means the dog
    spent the day in the daycare group, so the pickup day bills per the
    configured charge mode (see _boarding_late_pickup_daycare_fee). Missing
    times keep legacy overnight-only pricing rather than inventing a charge
    on old records.
    """
    pickup_minutes = _clock_minutes(pickup_time)
    cutoff_minutes = _clock_minutes(cutoff_time)
    if cutoff_minutes is None:
        cutoff_minutes = _clock_minutes(DEFAULT_BOARDING_FULL_DAY_PICKUP_CUTOFF) or (17 * 60)
    if pickup_minutes is None:
        return 0.0
    try:
        grace = max(0, int(grace_minutes or 0))
    except Exception:
        grace = 0
    return 0.0 if pickup_minutes <= cutoff_minutes + grace else 1.0


def _billable_boarding_units(
    start: str,
    end: Optional[str],
    pickup_time: Optional[str],
    *,
    legacy_minimum: int = 0,
    cutoff_time: Optional[str] = DEFAULT_BOARDING_FULL_DAY_PICKUP_CUTOFF,
) -> float:
    """Boarding bills overnight NIGHTS only, at the boarding rate.

    The old rule added pickup-day care as extra boarding units (half day
    before the cutoff, full day at/after). Industry-standard model now: a
    pickup after the checkout time bills a separate full DAYCARE day instead
    — see _boarding_late_pickup_daycare_fee. The pickup args are kept so
    stored pricing_snapshot call sites don't need signature churn.
    """
    return float(_billable_boarding_nights(start, end, legacy_minimum=legacy_minimum))
