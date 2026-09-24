"""Actionable booking refusals.

Every reason a booking can be refused should tell the person booking WHAT is
stopping them and HOW to fix it. ``BookingBlocked`` keeps the response's
``detail`` a plain, readable sentence (so every existing caller, test and
``formatErr`` keeps working) and adds a sibling ``block`` object:

    {"detail": "Rex's rabies vaccine expired on Mar 3, 2026. Upload ...",
     "block": {"code": "vaccine_expired", "action": "upload_vaccines",
               "dog_id": "...", "vaccine": "rabies"}}

``action`` is the fix the client portal offers as a button. Keep this list in
sync with ``frontend/src/lib/bookingBlocks.js``:

    upload_vaccines   open the vaccine upload for ``dog_id``
    sign_waiver       open the waiver
    sign_agreements   open Agreements
    pay_balance       open billing / pay balance
    request_evaluation  request a Meet & Greet
    pick_date         go back and choose another date
    pick_time         go back and choose another time
    pick_service      go back and choose another service
    edit_addons       go back and change the add-ons
    contact_us        call / message the business
    refresh           reload the page
    wait              nothing to do yet (e.g. certificate under review)
"""
from __future__ import annotations

from datetime import date
from typing import Any, Optional

from fastapi import HTTPException


class BookingBlocked(HTTPException):
    def __init__(self, status_code: int, message: str, *, code: str, action: Optional[str] = None, **extra: Any):
        super().__init__(status_code=status_code, detail=message)
        self.block = {"code": code, "action": action, **{k: v for k, v in extra.items() if v is not None}}


def block_of(exc: BaseException) -> Optional[dict]:
    """The ``block`` payload of a refusal, if it carries one."""
    return getattr(exc, "block", None)


def pretty_date(value: Any) -> str:
    """'2026-03-03' -> 'Tue, Mar 3, 2026'; anything unparseable is returned as-is."""
    raw = str(value or "")[:10]
    try:
        d = date.fromisoformat(raw)
    except ValueError:
        return str(value or "")
    return f"{d.strftime('%a, %b')} {d.day}, {d.year}"


def pretty_time(value: Any) -> str:
    """A time (or 'HH:MM' string) as '7:00 AM'. Portable: no '%-I', which Windows lacks."""
    if isinstance(value, str):
        try:
            hh, mm = value.strip().split(":")[:2]
            h, m = int(hh), int(mm)
        except ValueError:
            return value
    else:
        h, m = value.hour, value.minute
    suffix = "AM" if h < 12 else "PM"
    return f"{(h % 12) or 12}:{m:02d} {suffix}"
