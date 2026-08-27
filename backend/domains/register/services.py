"""Register-domain business rules extracted in modernization Phase 5."""
from __future__ import annotations

from typing import Any, Dict, Optional
from fastapi import HTTPException

_active_register_closeout_fn = None
_closeout_rollover_cash_fn = None


def configure(*, active_register_closeout, closeout_rollover_cash) -> None:
    global _active_register_closeout_fn, _closeout_rollover_cash_fn
    _active_register_closeout_fn = active_register_closeout
    _closeout_rollover_cash_fn = closeout_rollover_cash

async def require_register_day_open(date_value: str) -> None:
    closeout = await _active_register_closeout_fn(date_value)
    if closeout:
        raise HTTPException(
            status_code=409,
            detail=(
                f"The register for {date_value} is closed. Reopen the day with a reason "
                "before recording another sale, payment, refund, expense, or till adjustment."
            ),
        )

def effective_register_opening(
    session: Optional[Dict[str, Any]],
    previous_closeout: Optional[Dict[str, Any]],
) -> Dict[str, Any]:
    """Resolve today's opening drawer without trusting stale browser state.

    A saved session may differ from the previous closeout only when it carries
    an explicit, auditable override reason. Legacy/stale rows that silently
    replaced the rollover are recovered to the last confirmed count.
    """
    suggested = _closeout_rollover_cash_fn(previous_closeout)
    session_cash = None
    if session and session.get("opening_cash") is not None:
        try:
            session_cash = round(float(session.get("opening_cash") or 0), 2)
        except (TypeError, ValueError):
            session_cash = None

    override_reason = str((session or {}).get("opening_override_reason") or "").strip()
    override_marked = bool((session or {}).get("opening_was_overridden"))
    valid_override = override_marked and len(override_reason) >= 3

    recovered = False
    recorded_cash = session_cash
    if suggested is not None:
        if session_cash is None:
            opening_cash = suggested
            source = "previous_closeout"
        elif abs(session_cash - suggested) <= 0.005:
            opening_cash = session_cash
            source = "drawer_session"
        elif valid_override:
            opening_cash = session_cash
            source = "drawer_session_override"
        else:
            # Old UI/PWA state could write yesterday's opening amount into the
            # next day without a reason. Never let that silently defeat the
            # confirmed closeout rollover.
            opening_cash = suggested
            source = "previous_closeout_recovered"
            recovered = True
    elif session_cash is not None:
        opening_cash = session_cash
        source = "drawer_session"
    else:
        opening_cash = 0.0
        source = "not_set"

    effective_session = dict(session) if session else None
    if effective_session is not None and recovered:
        effective_session["recorded_opening_cash"] = recorded_cash
        effective_session["opening_cash"] = opening_cash
        effective_session["opening_recovered_from_rollover"] = True

    return {
        "opening_cash": round(float(opening_cash), 2),
        "source": source,
        "suggested_cash": suggested,
        "suggested_from_date": (previous_closeout or {}).get("date"),
        "suggested_from_closeout_id": (previous_closeout or {}).get("id"),
        "valid_override": valid_override,
        "override_reason": override_reason if valid_override else "",
        "recovered": recovered,
        "recorded_cash": recorded_cash,
        "session": effective_session,
    }
