"""Booking guards that refuse with a way forward (see blocks.py).

Kept out of server.py (which has a hard line ceiling) and free of server
imports: callers pass in the few server helpers these rules need.
"""
from __future__ import annotations

from datetime import date, datetime, time as dtime
from types import SimpleNamespace
from typing import Any, Callable, Dict, List, Optional, Tuple

from fastapi import HTTPException

from domains.bookings.blocks import BookingBlocked, block_of, pretty_date


def dog_vaccine_block(
    dog: dict,
    required: List[str],
    *,
    today: str,
    pending_fn: Callable[[dict, str], Any],
    block_on_expiry_day: bool = True,
    document_required: bool = False,
) -> Optional[BookingBlocked]:
    """The first vaccine problem that stops this dog booking, or None.

    Checks the canonical approved record. A certificate waiting for review
    only blocks when the approved record is not good enough on its own — a
    dog whose current approved vaccine is valid can keep booking while its
    renewal is reviewed (the portal readiness check says the same).
    `block_on_expiry_day` and `document_required` are live Day-to-Day
    compliance controls.
    """
    vaccines = dog.get("vaccines") or {}
    certs = dog.get("vaccine_certs") or {}
    name = dog.get("name") or "This dog"
    for v in required:
        label = str(v).replace("_", " ").title()
        pending = pending_fn(dog, v)
        pending_block = BookingBlocked(
            400,
            f"We're still reviewing the {label} certificate you uploaded for {name}. "
            "You'll be able to book as soon as we approve it, so there's no need to upload it again.",
            code="vaccine_pending", action="wait", dog_id=dog.get("id"), vaccine=v,
        )
        d = str(vaccines.get(v, "") or "")[:10]
        expired = bool(d and (d <= today if block_on_expiry_day else d < today))
        if not d or expired:
            if pending:
                return pending_block
            if not d:
                message = f"{name} has no {label} vaccine on file. Upload a current {label} certificate, then book again."
                code = "vaccine_missing"
            else:
                when = "expires today" if d == today else f"expired on {pretty_date(d)}"
                message = f"{name}'s {label} vaccine {when}. Upload a current {label} certificate, then book again."
                code = "vaccine_expired"
            return BookingBlocked(400, message, code=code, action="upload_vaccines", dog_id=dog.get("id"), vaccine=v)
        if document_required:
            cert = certs.get(v) or {}
            if not isinstance(cert, dict) or cert.get("status") != "approved":
                if pending:
                    return pending_block
                return BookingBlocked(
                    400,
                    f"We need a copy of {name}'s {label} certificate before booking. "
                    "Upload it, and you can book once we approve it.",
                    code="vaccine_document_needed", action="upload_vaccines", dog_id=dog.get("id"), vaccine=v,
                )
    return None


def booking_vaccine_block(settings: dict, dog: dict, required: List[str], **kw) -> Optional[BookingBlocked]:
    """Vaccine problem under the live booking policy: the block-if-expired
    switch plus the Day-to-Day compliance flags. Shared by create_booking,
    recurring and the availability check so the portal's pre-check can never
    disagree with the booking itself. `required` is the per-service list."""
    day_to_day = settings.get("day_to_day") or {}
    if not bool((day_to_day.get("guardrails") or {}).get("block_bookings_if_vaccines_expired", True)):
        return None
    compliance = day_to_day.get("compliance") or {}
    return dog_vaccine_block(
        dog, required,
        block_on_expiry_day=bool(compliance.get("block_on_expiry_day", True)),
        document_required=bool(compliance.get("vaccine_doc_upload_required", False)),
        **kw,
    )


def require_cancel_rights(user: dict, forfeit: bool, perms_for: Callable[[dict], dict]) -> None:
    """Who may cancel a booking. Runs before the booking's money lock is taken.

    Clients go on to the own-booking rules inside the cancel (their booking,
    the notice cutoff, never a charge). Staff need booking_edit to cancel, and
    take_payments as well to add a cancellation charge — it lands on the
    client's tab like a checkout charge. Any other account is refused. Before
    this, every non-client account could cancel any booking and add a fee,
    Read-only staff included.
    """
    role = (user or {}).get("role")
    if role == "client":
        return
    if role not in ("admin", "employee"):
        raise HTTPException(status_code=403, detail="Not allowed")
    perms = perms_for(user)
    if not perms.get("booking_edit"):
        raise HTTPException(status_code=403, detail="Missing permission: booking_edit")
    if forfeit and not perms.get("take_payments"):
        raise HTTPException(status_code=403, detail="Adding a cancellation charge needs the Take payments permission.")


async def load_booking_dog(db, dog_id: str, user: dict) -> dict:
    """The dog being booked, refusing (with a way forward) a missing dog or
    one that isn't on the signed-in client's account."""
    dog = await db.dogs.find_one({"id": dog_id}, {"_id": 0})
    if not dog:
        raise BookingBlocked(404, "We couldn't find that dog. Refresh the page and pick your dog again.", code="dog_not_found", action="refresh")
    if user.get("role") != "admin" and dog.get("owner_id") != user.get("client_id"):
        raise BookingBlocked(
            403, "That dog isn't on your account. Pick one of your own dogs, or contact Sit Happens if this looks wrong.",
            code="not_your_dog", action="contact_us",
        )
    return dog


def validate_booking_dates(body) -> None:
    """Reject malformed dates up front with a clear message instead of a 500
    from deeper date math (only the first 10 characters used to be checked)."""
    for field, label in (("date", "date"), ("end_date", "end date")):
        raw = getattr(body, field, None)
        if raw in (None, ""):
            continue
        try:
            date.fromisoformat(str(raw))
        except ValueError:
            raise BookingBlocked(400, f"That {label} isn't valid. Please pick it from the calendar.", code="invalid_date", action="pick_date")


def skip_entry(day: str, exc) -> dict:
    """One skipped day of a multi-day request: the readable reason plus the
    fix-it block when the refusal carries one."""
    entry = {"date": day, "reason": exc.detail}
    if block_of(exc):
        entry["block"] = block_of(exc)
    return entry


# ─────────────────────────── a dog on site stays on site until checked out
#
# A visit whose dog is checked in and not checked out is what every on-site
# screen (End of Day, Care Board, Kennel Board, roster, Today) lists. Moving
# it to cancelled / rejected / no-show / completed any other way than
# checkout made a dog who was still here vanish from all of them. Only
# checkout (or the stuck-checkout tool, for a stay past its end) closes it;
# a check-in made by mistake is taken back explicitly by the staff cancel.

CHECK_IN_FIELDS = (
    "checked_in_at", "checked_in_by", "checked_in_by_name",
    "checked_in_lat", "checked_in_lng", "checked_in_accuracy_m",
)
NOT_ON_SITE = {"$or": [{"checked_in_at": {"$in": [None, ""]}}, {"checked_out_at": {"$nin": [None, ""]}}]}


def on_site(booking: Optional[dict]) -> bool:
    return bool(booking) and bool(booking.get("checked_in_at")) and not booking.get("checked_out_at")


def _dog(booking: dict) -> str:
    return (booking or {}).get("dog_name") or "This dog"


def on_site_cancel_block(booking: dict, *, client: bool) -> BookingBlocked:
    dog = _dog(booking)
    if client:
        return BookingBlocked(
            409, f"{dog} is checked in with us right now, so this visit can't be cancelled online. "
                 "Please message us or talk to the front desk.",
            code="checked_in", action="contact_us",
        )
    return BookingBlocked(
        409, f"{dog} is checked in right now. If {dog} is going home, use Check out instead "
             "(check out at $0 if nothing is owed). If the check-in was a mistake, cancel again "
             "and choose to take the check-in back.",
        code="checked_in", action="undo_check_in",
    )


def refuse_while_on_site(booking: dict, what: str) -> None:
    """`what`: the thing that can't happen, e.g. "declined"."""
    if on_site(booking):
        dog = _dog(booking)
        if booking.get("financial_reopened_at"):
            raise BookingBlocked(409, f"This checkout was reopened, so this visit can't be {what}. Check {dog} out again "
                                      "instead (at $0 if nothing is owed).",
                                 code="checked_in", action="check_out")
        raise BookingBlocked(409, f"{dog} is checked in right now, so this visit can't be {what}. Check {dog} out instead.",
                             code="checked_in", action="check_out")


def refuse_no_show_after_check_in(booking: dict) -> None:
    if (booking or {}).get("checked_in_at"):
        dog = _dog(booking)
        raise BookingBlocked(409, f"{dog} was checked in, so this can't be a no-show. Check {dog} out instead.",
                             code="checked_in", action="check_out")


def still_as_read(booking: dict) -> dict:
    """A write filter that only matches while the visit's on-site state is
    what was read — a check-in (or checkout) landing in between wins."""
    if on_site(booking):
        return {"checked_in_at": booking["checked_in_at"], "checked_out_at": {"$in": [None, ""]}}
    return dict(NOT_ON_SITE)


def undo_check_in_update(booking: dict, user: dict, ts: str) -> Tuple[Dict[str, Any], Dict[str, str]]:
    """($set, $unset) that take back a check-in made by mistake, keeping a
    record of it on the visit."""
    record = {
        "at": ts, "by": (user or {}).get("id"),
        "by_name": (user or {}).get("display_name") or (user or {}).get("name") or (user or {}).get("email"),
        "checked_in_at": booking.get("checked_in_at"), "checked_in_by": booking.get("checked_in_by"),
    }
    return {"check_in_undone": record}, {f: "" for f in CHECK_IN_FIELDS}


async def changed_refusal(db, booking_id: str, *, what: str, client: bool = False, cancel: bool = False) -> HTTPException:
    """The refusal for a write that lost to a check-in (or checkout) that
    landed after the visit was read."""
    now = await db.bookings.find_one({"id": booking_id}, {"_id": 0, "dog_name": 1, "checked_in_at": 1, "checked_out_at": 1}) or {}
    if on_site(now):
        if cancel:
            return on_site_cancel_block(now, client=client)
        dog = _dog(now)
        return BookingBlocked(409, f"{dog} was just checked in, so this visit can't be {what}. Check {dog} out instead.",
                              code="checked_in", action="check_out")
    return HTTPException(status_code=409, detail="This visit just changed. Refresh and try again.")


# ─────────────────────────── when a client may still cancel online
#
# The cutoff ("Cancellation cutoff (hours)" in Settings) counted back from
# midnight UTC of the visit's date — 8 PM the evening before (7 PM in
# winter) — so a client cancelling a 7 AM Tuesday daycare 34 hours ahead was
# told it was under 24 hours. It counts back from when the visit really
# starts: its appointment or drop-off time, else the day's opening time.

def visit_start(booking: dict, start_fn: Callable[[Any], datetime], tz) -> Optional[datetime]:
    """When this visit starts, in the business time zone (None: no valid date).
    `start_fn` is the booking-time rule (server `_booking_start_local`); a
    visit it can't place (a day since closed, a lesson with no time) starts
    at 7:00 AM that day."""
    try:
        day = date.fromisoformat(str((booking or {}).get("date") or "")[:10])
    except ValueError:
        return None
    body = SimpleNamespace(
        date=day.isoformat(), time=booking.get("time") or "", dropoff_time=booking.get("dropoff_time") or "",
        service_type=booking.get("service_type") or "", service_id=booking.get("service_id"),
    )
    try:
        return start_fn(body)
    except Exception:
        return datetime.combine(day, dtime(7, 0), tzinfo=tz)


def cancel_cutoff_block(cutoff_hours: int, start: datetime) -> BookingBlocked:
    when = f"{pretty_date(start.date())} at {start.strftime('%I:%M %p').lstrip('0')}"
    return BookingBlocked(
        400, f"Online cancellations close {cutoff_hours} hours before the visit starts ({when}), so this one "
             "can't be cancelled here. Please message us and we'll take care of it.",
        code="cancel_cutoff", action="contact_us",
    )


# ─────────────────────────── services that exist only for Photo Specials
#
# Photo Specials point their 15-minute slots at one "Portrait Session"
# service (domains.photo_specials). It is $0 on purpose — the Register prices
# the package — so on its own it was a free portrait anyone could book, and
# the public Photography page advertised it at $0. It is never offered or
# booked on its own; Photo Specials insert their reservations directly.

PHOTO_SPECIAL_ONLY_SLUG = "portrait-session"
NOT_PHOTO_SPECIAL_ONLY = {"photo_special_only": {"$ne": True}, "slug": {"$ne": PHOTO_SPECIAL_ONLY_SLUG}}


def photo_special_only(service: Optional[dict]) -> bool:
    return bool(service) and (bool(service.get("photo_special_only")) or service.get("slug") == PHOTO_SPECIAL_ONLY_SLUG)


def refuse_photo_special_only(service: Optional[dict]) -> None:
    if photo_special_only(service):
        raise BookingBlocked(
            400, f"{service.get('name') or 'Portrait Session'} is only booked through a Photo Special. "
                 "Please pick another service.",
            code="photo_special_only", action="pick_service",
        )
