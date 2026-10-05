"""One shared pool of timed appointments (audit #34).

Lessons, grooming, portraits and Meet & Greets all take the one operator's
time, so each blocks the others. Every overlap check and every free-time
list reads the day's appointments from here: the booking check
(`_assert_capacity_available`), the staff/portal time picker
(`list_time_slots`), the Meet & Greet slot finder and Photo Specials.

A Meet & Greet is stored as service_type "other" with `is_meet_greet`, and
the checks used to ask only for training/grooming/photography — so a lesson,
a grooming or a portrait could be booked right on top of one (only the Meet
& Greet finder looked the other way). It blocks for the length it was booked
with; it is never a seat in a class.

Imports nothing from server: callers pass the database, settings and the
default-length lookup (the test suite swaps `server.db` per loop).
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any, Awaitable, Callable, Dict, List, Optional

TIMED = ("training", "grooming", "photography")
LIVE = ("pending", "approved", "completed")
MEET_GREET_MINUTES = 30


def _hhmm(value) -> Optional[int]:
    try:
        hh, mm = str(value).split(":")[:2]
        return int(hh) * 60 + int(mm)
    except Exception:
        return None


def meet_greet_minutes(settings: Optional[dict]) -> int:
    """How long a new Meet & Greet is (Settings → Meet & Greet → slot length)."""
    try:
        n = int(((settings or {}).get("meet_greet") or {}).get("slot_minutes") or 0)
    except Exception:
        n = 0
    return n if n > 0 else MEET_GREET_MINUTES


def meet_greet_length(booking: dict, settings: Optional[dict]) -> int:
    """A booked Meet & Greet keeps the length it was booked with."""
    return int(booking.get("duration_minutes") or 0) or meet_greet_minutes(settings)


def pool_key(day: str) -> str:
    """The lease every timed booking of one day shares."""
    return f"timepool:{day}"


async def appointments(db, day: str, *, settings: Optional[dict],
                       default_minutes: Callable[[str], Awaitable[int]],
                       exclude_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """The day's live timed appointments — lessons, grooming, portraits and
    Meet & Greets, pending or booked, not yet checked out — each with
    `start` (minutes after midnight) and `minutes` (how long it holds the
    time). Read in full: never a capped list."""
    q: Dict[str, Any] = {"date": day, "status": {"$in": list(LIVE)}, "time": {"$nin": ["", None]},
                         "$or": [{"service_type": {"$in": list(TIMED)}}, {"is_meet_greet": True}]}
    if exclude_id:
        q["id"] = {"$ne": exclude_id}
    out: List[Dict[str, Any]] = []
    defaults: Dict[str, int] = {}
    async for b in db.bookings.find(q, {"_id": 0, "id": 1, "time": 1, "duration_minutes": 1, "service_type": 1,
                                        "service_id": 1, "dog_id": 1, "dog_name": 1, "photo_special_id": 1,
                                        "is_meet_greet": 1, "checked_out_at": 1, "group_id": 1}):
        if b.get("checked_out_at"):
            continue          # gone home early: the time is free again
        start = _hhmm(b.get("time"))
        if start is None:
            continue
        if b.get("is_meet_greet"):
            minutes = meet_greet_length(b, settings)
            b["service_id"] = None     # never a seat in someone's class
        else:
            minutes = int(b.get("duration_minutes") or 0)
            if minutes <= 0:
                st = b.get("service_type") or ""
                if st not in defaults:
                    defaults[st] = int(await default_minutes(st) or 0)
                minutes = defaults[st]
        if minutes > 0:
            out.append({**b, "start": start, "minutes": minutes})
    return out


@asynccontextmanager
async def lease(day: str, acquire, release):
    """Hold the day's time pool for a check-then-save, as create_booking does."""
    keys = [pool_key(day)]
    owner = await acquire(keys)
    try:
        yield
    finally:
        await release(owner, keys)
