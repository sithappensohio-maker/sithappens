"""A boarding dog checked out after its stay ended: ask, never assume.

A boarding stay that is still checked in after its last day can mean two
different things — the dog really stayed extra nights, or it went home on
time and nobody pressed Check Out. Before this, checkout offered a nights
counter that started at 0, so a late dog could leave with the extra nights
uncharged and nobody asked (owner, 2026-11-25). Now checkout of such a stay
is refused until someone answers:

  stayed           the extra nights are added to the stay and billed by the
                   existing extra-night rule in checkout (boarding credits
                   first, then the stay's own nightly rate). The screen
                   pre-fills the count; staff can correct it.
  missed_checkout  the dog left on time: only the booked nights are charged
                   and no nights are added.

Nights sent with no answer count as "stayed" — adding nights IS the answer.
What is refused is the silent case: a late stay, no nights, no answer.

Unlike the daycare question (late_day.py) nothing is saved before checkout:
the answer rides on the checkout request and is stamped on the booking as
`late_stay_checkout` by the checkout's own update, so a refused or rolled-
back checkout leaves no trace.

When it applies: a BOARDING booking, checked in, not checked out, whose last
day is before today and that was checked in before today. Not a daycare
visit converted to a stay (it is re-priced to today by late_day.py), and not
a reopened checkout whose departure is already known.
"""
from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Optional

from fastapi import Depends, HTTPException

from domains.bookings import reopen as booking_reopen
from domains.bookings.blocks import pretty_date

RESOLUTIONS = ("stayed", "missed_checkout")
QUESTION_CODE = "late_stay_checkout_resolution_required"
MSG_MISSED_WITH_NIGHTS = ("You chose Missed check out, so no extra nights can be added. "
                          "Change the answer to Stayed extra nights to add them.")
MSG_STAYED_NO_NIGHTS = "You chose Stayed extra nights — add at least one night, or change the answer to Missed check out."

_server_globals: Optional[dict] = None


def configure(*, server_globals: dict) -> None:
    global _server_globals
    _server_globals = server_globals


def _g(name: str):
    return _server_globals[name]


def _today() -> str:
    return _g("business_today")().isoformat()


def _end_day(booking: dict) -> str:
    return str(booking.get("end_date") or booking.get("date") or "")[:10]


def applies(booking: Optional[dict], today: Optional[str] = None) -> bool:
    """True when this is a boarding dog still checked in after its last day."""
    if not booking or booking.get("service_type") != "boarding":
        return False
    if booking.get("late_day_resolution"):
        return False  # a converted daycare visit: late_day.py prices it to today
    if not booking.get("checked_in_at") or booking.get("checked_out_at"):
        return False
    if booking.get("status") in ("completed", "cancelled", "rejected"):
        return False
    if booking_reopen.departure_known(booking):
        return False
    today = today or _today()
    end_day = _end_day(booking)
    if not end_day or end_day >= today:
        return False
    checked_in_day = _g("_business_date_from_timestamp")(booking.get("checked_in_at"), end_day)
    return checked_in_day < today


def days_late(booking: dict, today: str) -> int:
    try:
        return max(1, (date.fromisoformat(today) - date.fromisoformat(_end_day(booking))).days)
    except ValueError:
        return 1


def _answered(body: Any) -> bool:
    return bool(body) and (getattr(body, "late_stay_resolution", None) in RESOLUTIONS
                           or int(getattr(body, "extra_nights", 0) or 0) > 0)


def needs_answer(booking: Optional[dict], body: Any = None, today: Optional[str] = None) -> bool:
    return applies(booking, today) and not _answered(body)


def question_detail(bookings: List[dict], today: str) -> Dict[str, Any]:
    """The 409 body that asks the question (same shape idea as late_day.py)."""
    first = bookings[0]
    names = [b.get("dog_name") or "This dog" for b in bookings]
    who = names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]
    one = len(names) == 1
    nights = days_late(first, today)
    message = (
        f"{who} {'was' if one else 'were'} due to go home on {pretty_date(_end_day(first))} and "
        f"{'is' if one else 'are'} still checked in. Did {'the dog' if one else 'they'} stay "
        f"{nights} extra night{'' if nights == 1 else 's'}, or was this a missed check out?"
    )
    return {
        "code": QUESTION_CODE,
        "message": message,
        "msg": message,
        "booking_ids": [b.get("id") for b in bookings],
        "dog_names": names,
        "original_end_date": _end_day(first),
        "business_day": today,
        "nights": nights,
        "resolutions": [
            {"value": "stayed", "label": "Stayed extra nights — add them to the stay"},
            {"value": "missed_checkout", "label": "Missed check out — charge the booked nights only"},
        ],
    }


def ensure_checkout_answer(booking: dict, body: Any, user: Optional[dict]) -> Optional[Dict[str, Any]]:
    """Checkout gate. Returns None when the question doesn't apply, otherwise
    the record checkout stamps on the booking as `late_stay_checkout`.
    Refuses (409, the question) a late stay with no nights and no answer, and
    (400) an answer that contradicts the nights sent with it. Writes nothing."""
    today = _today()
    if not applies(booking, today):
        return None
    nights = int(getattr(body, "extra_nights", 0) or 0) if body else 0
    resolution = getattr(body, "late_stay_resolution", None) if body else None
    if resolution not in RESOLUTIONS:
        if nights <= 0:
            raise HTTPException(status_code=409, detail=question_detail([booking], today))
        resolution = "stayed"
    if resolution == "missed_checkout" and nights > 0:
        raise HTTPException(status_code=400, detail=MSG_MISSED_WITH_NIGHTS)
    if resolution == "stayed" and nights <= 0:
        raise HTTPException(status_code=400, detail=MSG_STAYED_NO_NIGHTS)
    user = user or {}
    return {
        "resolution": resolution, "original_end_date": _end_day(booking), "business_day": today,
        "days_late": days_late(booking, today), "extra_nights": nights,
        "by": user.get("id"), "by_name": user.get("display_name") or user.get("name"), "at": _g("now_iso")(),
    }


# ── HTTP: ask before the checkout screen prices anything ──────────────────

def register_late_stay_routes(*, api, server_globals: dict) -> None:
    require_employee_or_admin = server_globals["require_employee_or_admin"]

    async def get_late_stay_checkout(booking_id: str, _: dict = Depends(require_employee_or_admin)):
        """Does this checkout need the question? Read-only — the answer is
        sent with the checkout itself."""
        anchor = await _g("db").bookings.find_one({"id": booking_id}, {"_id": 0})
        if not anchor:
            raise HTTPException(status_code=404, detail="Booking not found")
        today = _today()
        rows = await _g("_active_household_checkout_rows")(anchor) or []
        if anchor.get("id") not in {r.get("id") for r in rows}:
            rows = [anchor, *rows]
        # The dog whose button was pressed leads, so the nights are its own.
        pending = sorted((r for r in rows if applies(r, today)), key=lambda r: r.get("id") != anchor.get("id"))
        if not pending:
            return {"applies": False}
        return {**question_detail(pending, today), "applies": True}

    api.add_api_route("/bookings/{booking_id}/late-stay-checkout", get_late_stay_checkout, methods=["GET"])
