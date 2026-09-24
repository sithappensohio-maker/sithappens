"""Booking guards that refuse with a way forward (see blocks.py).

Kept out of server.py (which has a hard line ceiling) and free of server
imports: callers pass in the few server helpers these rules need.
"""
from __future__ import annotations

from datetime import date
from typing import Any, Callable, List, Optional

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
