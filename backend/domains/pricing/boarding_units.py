"""Boarding stay units: how many billable nights a stay has, and the clock-time
rules for the pickup day. Pure functions: no database, no server state.

Pickup-day rule (owner request 2026-11-03) — three tiers, boarding only:
  * at/before the FREE cutoff (default noon)      -> no charge
  * between the free cutoff and the FULL-DAY       -> one late-pickup
    cutoff (default 7 PM)                             DAYCARE-rate fee
                                                        (see
                                                        late_pickup_daycare_fee
                                                        in domains/pricing/
                                                        services.py)
  * after the FULL-DAY cutoff                      -> one more full
                                                        BOARDING night
                                                        (_billable_boarding_units
                                                        below), not a fee
"""
from datetime import datetime
from typing import Optional


def _billable_boarding_nights(start: str, end: Optional[str], *, legacy_minimum: int = 0) -> int:
    """Exclusive pickup-date math for overnight boarding nights only.

    July 1 → July 2 = 1 night. July 1 → July 4 = 3 nights. A very-late
    pickup adds one more night on top of this — see `_billable_boarding_units`.
    """
    try:
        s = datetime.fromisoformat(str(start)[:10]).date()
        e = datetime.fromisoformat(str(end or start)[:10]).date()
    except Exception:
        return legacy_minimum
    return max(legacy_minimum, (e - s).days)


DEFAULT_BOARDING_FREE_PICKUP_CUTOFF = "12:00"
DEFAULT_BOARDING_FULL_DAY_PICKUP_CUTOFF = "19:00"


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


def _boarding_free_pickup_cutoff_from_rules(rules: Optional[dict]) -> str:
    """Return the admin-configured FREE boarding pickup cutoff as valid HH:MM
    (pickup at/before this is always free, no charge at all)."""
    raw = str((rules or {}).get("boarding_free_pickup_cutoff") or "").strip()
    return raw[:5] if _clock_minutes(raw) is not None else DEFAULT_BOARDING_FREE_PICKUP_CUTOFF


def _boarding_full_day_cutoff_from_rules(rules: Optional[dict]) -> str:
    """Return the admin-configured FULL-DAY boarding pickup cutoff as valid
    HH:MM (pickup after this bills a full extra boarding night)."""
    raw = str((rules or {}).get("boarding_full_day_pickup_cutoff") or "").strip()
    return raw[:5] if _clock_minutes(raw) is not None else DEFAULT_BOARDING_FULL_DAY_PICKUP_CUTOFF


def _boarding_pickup_day_units(
    pickup_time: Optional[str],
    free_cutoff: Optional[str] = DEFAULT_BOARDING_FREE_PICKUP_CUTOFF,
    full_day_cutoff: Optional[str] = DEFAULT_BOARDING_FULL_DAY_PICKUP_CUTOFF,
    grace_minutes: int = 0,
) -> float:
    """1.0 when the pickup falls in the DAYCARE-FEE window (after the free
    cutoff + grace, at/before the full-day cutoff), else 0.0.

    At/after the full-day cutoff this deliberately returns 0.0 too — that
    tier bills a full extra boarding NIGHT instead (`_billable_boarding_units`),
    never both. Missing pickup time keeps legacy overnight-only pricing
    rather than inventing a charge on old records.
    """
    pickup_minutes = _clock_minutes(pickup_time)
    if pickup_minutes is None:
        return 0.0
    free_minutes = _clock_minutes(free_cutoff)
    if free_minutes is None:
        free_minutes = _clock_minutes(DEFAULT_BOARDING_FREE_PICKUP_CUTOFF) or (12 * 60)
    full_day_minutes = _clock_minutes(full_day_cutoff)
    if full_day_minutes is None:
        full_day_minutes = _clock_minutes(DEFAULT_BOARDING_FULL_DAY_PICKUP_CUTOFF) or (19 * 60)
    try:
        grace = max(0, int(grace_minutes or 0))
    except Exception:
        grace = 0
    if pickup_minutes <= free_minutes + grace:
        return 0.0
    if pickup_minutes > full_day_minutes:
        return 0.0  # billed as a full extra boarding night instead — see _billable_boarding_units
    return 1.0


def _billable_boarding_units(
    start: str,
    end: Optional[str],
    pickup_time: Optional[str],
    *,
    legacy_minimum: int = 0,
    cutoff_time: Optional[str] = DEFAULT_BOARDING_FULL_DAY_PICKUP_CUTOFF,
) -> float:
    """Boarding bills overnight NIGHTS at the boarding rate, plus one more
    full night when the pickup happens AFTER the full-day cutoff (default
    7 PM) — a very-late pickup is treated exactly like one more night of
    boarding, same rate, same credit eligibility.

    `cutoff_time` here is specifically the FULL-DAY cutoff (not the earlier
    free-pickup cutoff — the free/daycare-fee boundary is handled
    separately by `_boarding_pickup_day_units`/`late_pickup_daycare_fee`,
    which bills the cheaper daycare-rate fee for a pickup between the two
    cutoffs instead of an extra night). Strict `>` so a quote/preview that
    defaults an unset pickup time to exactly the cutoff (a common fallback
    elsewhere) never spuriously adds a night. Missing/unknown pickup time
    keeps legacy overnight-only pricing rather than inventing a charge on
    old records.
    """
    nights = _billable_boarding_nights(start, end, legacy_minimum=legacy_minimum)
    pickup_minutes = _clock_minutes(pickup_time)
    if pickup_minutes is not None:
        cutoff_minutes = _clock_minutes(cutoff_time)
        if cutoff_minutes is None:
            cutoff_minutes = _clock_minutes(DEFAULT_BOARDING_FULL_DAY_PICKUP_CUTOFF) or (19 * 60)
        if pickup_minutes > cutoff_minutes:
            nights += 1
    return float(nights)
