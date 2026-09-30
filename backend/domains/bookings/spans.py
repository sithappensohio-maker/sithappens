"""Which bookings span days, and the dates a move may give them.

Only a stay carries an end date: boarding (including a daycare visit
answered "stayed overnight", which becomes boarding) and Board & Train (a
training booking whose service is a Board & Train package — the same test
its checkout uses). Everything else is a day visit: one date, no end date.

The Schedule calendar sent `end = event end − 1 day` for every event it
moved. For a timed lesson that is the day BEFORE its start; resizing an
all-day lesson gave it several days. A day visit ending before it starts
shows as a missed checkout, an urgent "may be stuck" alert and a past visit
in the client's portal; one spanning days takes daycare capacity and shows
on every day's roster. So every date write goes through `dates_update`:

  * a day visit keeps no end date, whatever was sent;
  * a stay needs its pickup after its drop-off; moved without a pickup
    date, it keeps its length (Board & Train falls back to its program
    length);
  * a dog that is checked in can't have its visit start after today (it
    would drop off the Kennel Board while still here).

Kept free of server imports: callers pass the database.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Dict, Optional

from board_train_scheduling import board_train_stay_info
from domains.bookings import guards
from domains.bookings.blocks import BookingBlocked

ZERO_NIGHTS = ("Boarding needs at least one night — please pick a pickup date after the drop-off date. "
               "For a same-day visit, book Daycare instead.")
BT_NO_PICKUP = "A Board & Train stay needs a pickup date after its drop-off date."


def _d(value: Any) -> Optional[date]:
    try:
        return date.fromisoformat(str(value or "")[:10])
    except ValueError:
        return None


async def _stay_info(db, booking: Dict[str, Any], service: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if service is None and booking.get("service_id"):
        service = await db.services.find_one({"id": booking["service_id"]}, {"_id": 0})
    if not service:
        return None
    try:
        return await board_train_stay_info(db, service)
    except Exception:
        return None


async def span_kind(db, booking: Dict[str, Any], service: Optional[Dict[str, Any]] = None) -> str:
    """"boarding", "board_train" or "day"."""
    svc = str(booking.get("service_type") or "").lower()
    if svc == "boarding":
        return "boarding"
    if svc != "training":
        return "day"
    if service is not None or booking.get("service_id"):
        found = service if service is not None else await db.services.find_one({"id": booking["service_id"]}, {"_id": 0})
        if found:
            return "board_train" if await _stay_info(db, booking, found) else "day"
    # No service on file: a booking that already spans days is a stay.
    start, end = _d(booking.get("date")), _d(booking.get("end_date"))
    return "board_train" if (start and end and end > start) else "day"


async def dates_update(db, booking: Dict[str, Any], update: Dict[str, Any], *, today: str,
                       service: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """`update` with date / end_date as this booking may carry them. Leaves
    an update that touches neither alone."""
    if "date" not in update and "end_date" not in update:
        return update
    out = dict(update)
    old_start, old_end = _d(booking.get("date")), _d(booking.get("end_date"))
    start = _d(out.get("date", booking.get("date")))
    if not start:
        raise BookingBlocked(400, "That date isn't valid. Please pick it from the calendar.", code="invalid_date", action="pick_date")
    if "date" in out:
        out["date"] = start.isoformat()
    kind = await span_kind(db, booking, service)
    if guards.on_site(booking) and start != old_start and start.isoformat() > today:
        dog = booking.get("dog_name") or "This dog"
        instead = "Change the pickup date instead, or check" if kind != "day" else "Check"
        raise BookingBlocked(
            409, f"{dog} is checked in, so this visit can't move to a later day. {instead} {dog} out{'' if kind != 'day' else ' first'}.",
            code="checked_in", action="check_out")
    if kind == "day":
        out["end_date"] = None
        return out
    sent = out.get("end_date")
    if sent:
        end = _d(sent)
        if not end:
            raise BookingBlocked(400, "That end date isn't valid. Please pick it from the calendar.", code="invalid_date", action="pick_date")
    else:
        # Moved without a pickup date: keep the stay's length.
        length = (old_end - old_start).days if (old_start and old_end and old_end > old_start) else 0
        if kind == "board_train" and length <= 0:
            length = int(((await _stay_info(db, booking, service)) or {}).get("duration_days") or 0)
        end = start + timedelta(days=length)
    if end <= start:
        raise BookingBlocked(400, ZERO_NIGHTS if kind == "boarding" else BT_NO_PICKUP,
                             code="boarding_zero_nights", action="pick_date")
    out["end_date"] = end.isoformat()
    return out


def on_day_query(day: str) -> Dict[str, Any]:
    """Visits whose span covers `day` (date <= day <= end_date, or a one-day
    visit on it) — what a day's board asks the database for, so no amount of
    history can push today's dogs past a cap (audit #43). Callers keep their
    own exact on-site test on the rows."""
    return {"date": {"$lte": day}, "$or": [{"end_date": {"$gte": day}}, {"date": day}]}


def on_site_query(day: str) -> Dict[str, Any]:
    """Visits that may be on site `day`: not checked out, and covering the day
    or still checked in after their stay ended. The Care Board and the Kennel
    Board read this one rule (audit #46); `on_site` decides each row."""
    return {"date": {"$lte": day}, "checked_out_at": {"$in": [None, ""]},
            "$or": [*on_day_query(day)["$or"], {"checked_in_at": {"$nin": [None, ""]}}]}


def on_site(b: Dict[str, Any], day: str) -> Optional[str]:
    """"here" (booked for the day, not gone home), "missed_checkout" (still
    checked in after the stay ended) or None. Checked out = gone, whatever
    the day or hour it happened."""
    if b.get("checked_out_at"):
        return None
    d = b.get("date") or ""
    e = b.get("end_date") or d
    if d <= day <= e:
        return "here"
    if b.get("checked_in_at") and e < day:
        return "missed_checkout"
    return None
