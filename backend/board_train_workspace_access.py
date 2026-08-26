"""Allow staff to reopen a completed Board & Train daily workspace.

Trainer Delivery owns the two-slot AM/PM lifecycle. Its default no-label
resolver deliberately chooses the next unfinished slot; once both slots are
complete there is no next slot, but staff still need to reopen the workspace
for review and trainer-controlled School progression. This extension converts
that one no-label/completed-day case into an explicit PM lookup so the
canonical draft loader returns the already-completed PM draft instead of
creating another session.
"""
from __future__ import annotations

from datetime import date
from typing import Any

from trainer_delivery_enforcement import (
    _booking_drafts_for_day,
    _draft_status,
    is_board_train_booking,
    normalize_bt_label,
    required_training_dates,
    slots_from_drafts,
)


def install_board_train_workspace_access(*, server_module: Any, db: Any) -> None:
    """Install completed-day workspace access exactly once."""
    if getattr(server_module, "_board_train_workspace_access_installed", False):
        return

    original_get_draft = getattr(server_module, "_get_or_create_session_draft", None)
    if not callable(original_get_draft):
        raise RuntimeError("Board & Train workspace access could not find canonical draft helper")

    def business_day() -> str:
        resolver = getattr(server_module, "business_today", None)
        return resolver().isoformat() if callable(resolver) else date.today().isoformat()

    async def get_or_create_with_completed_day_access(enrollment, booking_id, session_label, actor):
        label = str(session_label or "").strip()

        # Explicit AM/PM requests keep the existing Trainer Delivery behavior.
        # Only repair the no-label entry path that the Today workspace uses.
        if booking_id and not normalize_bt_label(label):
            booking = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
            if booking and await is_board_train_booking(db, booking):
                day = business_day()
                if day in set(required_training_dates(booking)):
                    drafts = await _booking_drafts_for_day(
                        db,
                        booking,
                        day,
                        enrollment_id=enrollment.get("id"),
                    )
                    slots = slots_from_drafts(drafts)
                    am = slots.get("AM")
                    pm = slots.get("PM")
                    if (
                        am
                        and pm
                        and _draft_status(am) == "completed"
                        and _draft_status(pm) == "completed"
                    ):
                        # Passing an explicit PM label avoids the "day complete"
                        # rejection in Trainer Delivery and makes its canonical
                        # loader return the existing completed PM draft. No third
                        # daily session is created and completion remains intact.
                        label = str(pm.get("session_label") or "PM").strip() or "PM"

        return await original_get_draft(enrollment, booking_id, label, actor)

    server_module._get_or_create_session_draft = get_or_create_with_completed_day_access
    server_module._board_train_workspace_access_installed = True
