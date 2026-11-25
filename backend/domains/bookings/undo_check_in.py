"""Undo a check-in made by mistake, and keep the booking (owner request, 2026-11-25).

Until now the only way to take a check-in back was to CANCEL the booking
with "the check-in was a mistake" ticked — so a dog checked in by a slip of
the finger, but still coming today, had to be booked again. And the Front
Desk rows had no way to take one back at all.

This puts the dog back to "expected": the check-in stamp comes off, a record
of it stays on the visit (who checked in, when, and who undid it — the same
record the cancel path writes, booking_guards.undo_check_in_update), and
everything else about the booking is left exactly as it was: status, dates,
price, add-ons (including any added at the desk), and anything paid ahead.

It is deliberately narrow:

  * only a dog that is here right now. A visit that was checked OUT is
    finished business — that is "reopen checkout", not this;
  * never once money is on the visit, or its checkout was reopened: taking
    the check-in off a visit a bill is waiting on would strand that bill;
  * not for a visit from an earlier day (that is a missed checkout: check
    the dog out), nor a prepaid session whose lesson a trainer recorded;
  * not while a checkout of the same visit is in progress;
  * the same people who may check a dog in may undo it;
  * the write only lands if the visit is still as it was read, so an undo
    racing a checkout (or a second undo) changes nothing;
  * credits or add-ons paid for at drop-off are not touched — they stay on
    the account / on the booking for when the dog does come.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException
from pymongo import ReturnDocument

from domains.bookings import guards as booking_guards


def register_undo_check_in_routes(*, api, server_globals: dict) -> dict:
    g = server_globals

    @api.post("/bookings/{booking_id}/undo-check-in")
    async def undo_check_in(booking_id: str, user: dict = Depends(g["require_employee_or_admin"])):
        perms = g["_perms_for"](user)
        if not (perms.get("care_complete") or perms.get("booking_edit")):
            raise HTTPException(status_code=403, detail="Missing permission: booking_edit or care_complete")
        db = g["db"]
        booking = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
        if not booking:
            raise HTTPException(status_code=404, detail="Booking not found")
        dog = booking.get("dog_name") or "This dog"
        if booking.get("checked_out_at") or booking.get("status") == "completed":
            raise HTTPException(status_code=409, detail=f"{dog} has already been checked out, so the check-in can't be undone.")
        if booking.get("status") != "approved":
            raise HTTPException(status_code=409, detail="This booking isn't active, so there is no check-in to undo.")
        if not booking.get("checked_in_at"):
            return booking   # already not checked in (a second tap): nothing to do
        if booking.get("financial_reopened_at"):
            raise HTTPException(
                status_code=409,
                detail=f"This visit's checkout was reopened, so the check-in can't be undone. Check {dog} out again instead.")
        if g["_booking_is_financially_locked"](booking):
            raise HTTPException(
                status_code=409,
                detail="Money has already been recorded on this visit, so the check-in can't be undone. Use a refund or adjustment instead.")
        # A visit from an earlier day that is still "here" is a missed checkout,
        # not a mistaken check-in. Taking its check-in off would drop it from
        # every Front Desk list (they only keep a past visit while it is
        # checked in) with nothing left to prompt the checkout it still needs.
        last_day = str(booking.get("end_date") or booking.get("date") or "")[:10]
        if last_day and last_day < g["business_today"]().isoformat():
            raise HTTPException(
                status_code=409,
                detail=f"{dog}'s visit was for an earlier day, so the check-in can't be undone. Check {dog} out instead "
                       "(at $0 if nothing is owed).")
        # A lesson a trainer already recorded is a lesson that happened (the
        # cancel path refuses the same thing: prepaid_sessions.refuse_cancel_if_taught).
        if booking.get("is_prepaid_program_session") and await db.training_session_log.find_one(
                {"$or": [{"booking_id": booking_id}, {"prepaid_session_id": booking_id}]}, {"_id": 1}):
            raise HTTPException(
                status_code=409,
                detail=f"A trainer already recorded {dog}'s lesson for this session, so the check-in can't be undone. "
                       f"Check {dog} out instead.")
        # A checkout holds the visit while it works out credits and payment and
        # only stamps checked_out_at at the end. An undo landing inside that
        # window would leave a paid, finished visit with no arrival on it. Same
        # hold rule, same 15-minute stale cutoff, as every other writer (late_day.py).
        stale = (datetime.now(timezone.utc) - timedelta(minutes=15)).isoformat()
        if booking.get("checkout_in_progress") and str(booking.get("checkout_started_at") or "") >= stale:
            raise HTTPException(status_code=409, detail=f"{dog} is being checked out right now. Wait a moment and refresh.")
        not_held = {"$or": [{"checkout_in_progress": {"$exists": False}}, {"checkout_in_progress": False},
                            {"checkout_started_at": {"$lt": stale}}]}
        undone, unset = booking_guards.undo_check_in_update(booking, user, g["now_iso"]())
        result = await db.bookings.find_one_and_update(
            {"$and": [{"id": booking_id, "status": "approved", **booking_guards.still_as_read(booking)}, not_held]},
            {"$set": undone, "$unset": unset},
            projection={"_id": 0}, return_document=ReturnDocument.AFTER)
        if result is None:
            # It changed while this was being pressed (checked out, or undone already).
            raise HTTPException(status_code=409, detail="This visit just changed. Refresh and try again.")
        return result

    return {"undo_check_in": undo_check_in}
