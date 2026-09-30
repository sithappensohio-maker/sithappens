"""Prepaid program sessions work like any training visit (audit #38).

A program sale books its weekly sessions stamped "paid" (the program was paid
for at the sale). Since the checkout lock counted "paid" as closed, those
sessions could not be checked in, checked out, cancelled or moved — and since
checkout never ran, the program credit each session is meant to use was never
used, so a family kept all its credits on top of all its sessions.

A session is OPEN from the sale until it is checked out, as long as no money
sits on it. While open it is an ordinary training visit: check-in, checkout,
Cancel and every reschedule path work. Its price and payment stay the
program's — nothing can give it a price, and its checkout uses one credit from
this session's own program and never charges; with no credit left it is
recorded at $0. A session a trainer already recorded can't be cancelled.
"""
from __future__ import annotations

from typing import Any, Dict, Iterable, Optional

from fastapi import HTTPException

from domains.bookings.blocks import BookingBlocked

MOVABLE = {"date", "end_date"}   # the only money-protected fields an open session may change (a move)


def is_open(b: Optional[dict]) -> bool:
    """A prepaid session not checked out and with no money on it."""
    if not b or not b.get("is_prepaid_program_session"):
        return False
    if b.get("checked_out_at") or b.get("financial_locked") or b.get("status") not in ("pending", "approved"):
        return False
    if b.get("payment_status") not in (None, "", "paid"):
        return False
    money = ("amount_paid", "cash_revenue", "credits_deducted", "credit_value", "financial_refund_total")
    return not any(float(b.get(k) or 0) > 0 for k in money)


def refuse_money_edit(booking: dict, touched: Iterable[str]) -> bool:
    """For an open session: a move is fine, a price or payment change is not.
    Returns True when the booking is an open session (the caller skips the
    ordinary lock)."""
    if not is_open(booking):
        return False
    if set(touched) - MOVABLE:
        raise HTTPException(status_code=409, detail=(
            "This session is part of a prepaid program, so its price and payment come from the program. "
            "It can still be moved or cancelled."))
    return True


async def _taught(db, booking: dict) -> bool:
    return bool(await db.training_session_log.find_one({"booking_id": booking["id"]}, {"_id": 1}))


async def refuse_cancel_if_taught(db, booking: dict, *, client: bool = False) -> None:
    """A lesson a trainer already recorded is a lesson that happened."""
    if not booking.get("is_prepaid_program_session") or not await _taught(db, booking):
        return
    dog = booking.get("dog_name") or "This dog"
    if client:
        raise BookingBlocked(409, f"{dog}'s lesson for this session already happened, so it can't be cancelled. "
                                  "Please contact Sit Happens if this looks wrong.", code="lesson_recorded", action="contact_us")
    raise BookingBlocked(409, f"A trainer already recorded {dog}'s lesson for this session, so it happened and can't be cancelled.",
                         code="lesson_recorded")


async def refuse_move(db, booking: dict) -> None:
    """A session that is under way or already taught stays on its date."""
    if not booking.get("is_prepaid_program_session"):
        return
    dog = booking.get("dog_name") or "This dog"
    if booking.get("checked_in_at") and not booking.get("checked_out_at"):
        raise BookingBlocked(409, f"{dog} is checked in for this session right now, so it can't be moved.", code="checked_in")
    if await _taught(db, booking):
        raise BookingBlocked(409, f"A trainer already recorded {dog}'s lesson for this session, so it can't be moved.",
                             code="lesson_recorded")


async def after_cancel(db, booking: dict, stamp: str) -> None:
    """A cancelled session can't be moved any more: its open reschedule
    requests are closed quietly (the client isn't emailed a decline)."""
    await db.reschedule_requests.update_many(
        {"booking_id": booking["id"], "status": "pending"},
        {"$set": {"status": "declined", "decline_reason": "session cancelled", "declined_at": stamp}})


def checkout_without_credit() -> Dict[str, Any]:
    """Checkout of a session whose family has no program credit left: it was
    paid for at the sale, so the session itself is $0. Anything added at pickup
    (an add-on) is then paid like on any visit — now, partly, or on the tab."""
    return {"actual_price": 0.0, "prepaid_no_credit_left": True}
