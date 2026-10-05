"""The hourly rate a shift is paid at (audit #24).

A shift is paid at the rate in force when it was worked. Clock-in stamps that rate on the time-clock
entry (`pay_rate`), so a later raise does not move past pay. An entry with no stamp (worked before the
stamp existed) keeps the employee's live rate, as before. A stamp of zero or less is no stamp: a hire
clocked in before a rate was set must not be locked at $0.

No imports: pay code in server.py, pl_report.py and the staff routes all use this module.
"""
from typing import Any, Dict, Iterable, Optional


def stamp_rate(value: Any) -> Optional[float]:
    """The rate to stamp on a new shift, or None when there is no usable rate yet."""
    try:
        rate = float(value)
    except (TypeError, ValueError):
        return None
    return rate if rate > 0 else None


def entry_rate(entry: dict, fallback: Any) -> float:
    """The rate this shift is paid at: its own stamp, else the fallback (the live rate)."""
    stamped = stamp_rate(entry.get("pay_rate"))
    return stamped if stamped is not None else float(fallback or 0)


def entry_gross(entry: dict, fallback: Any) -> float:
    """One shift's pay: its hours at its own rate, to the cent."""
    return round(float(entry.get("hours") or 0) * entry_rate(entry, fallback), 2)


def pay_by_user(entries: Iterable[dict], live_rates: Dict[Any, Any], hours_ndigits: Optional[int] = None,
                round_result: bool = True) -> Dict[Any, float]:
    """Gross pay per user over many shifts, each shift at its own rate.

    Shifts are grouped by (user, rate) and each group's hours are multiplied once. A period with one
    rate therefore gives the same figure as the old `hours_total * live_rate`. `hours_ndigits` rounds the
    hours of each group first, for readers that always rounded their hour totals (the timecard). Pass
    round_result=False for a figure used as a base for a further calculation (the wage-cap base)."""
    bands: Dict[tuple, float] = {}
    for e in entries:
        uid = e.get("user_id")
        rate = entry_rate(e, live_rates.get(uid))
        bands[(uid, rate)] = bands.get((uid, rate), 0.0) + float(e.get("hours") or 0)
    gross: Dict[Any, float] = {}
    for (uid, rate), hours in bands.items():
        if hours_ndigits is not None:
            hours = round(hours, hours_ndigits)
        gross[uid] = gross.get(uid, 0.0) + hours * rate
    if round_result:
        return {uid: round(value, 2) for uid, value in gross.items()}
    return gross
