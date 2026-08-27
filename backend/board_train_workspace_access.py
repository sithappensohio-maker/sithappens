"""Keep Board & Train workspace content aligned with the School pointer.

Trainer Delivery owns the two required AM/PM slots. After both are complete,
staff still need to reopen the workspace. Phase 4 moved production orchestration
into ``domains.training.services``; this module keeps the proven helper logic
and legacy installer compatibility while production no longer monkey-patches
``_get_or_create_session_draft`` after import.
"""
from __future__ import annotations

from datetime import date
from typing import Any, Optional

from trainer_delivery_enforcement import (
    _booking_drafts_for_day,
    _draft_status,
    is_board_train_booking,
    normalize_bt_label,
    required_training_dates,
    slots_from_drafts,
)

SUPPLEMENTAL_LABEL = "SUPPLEMENTAL"


def _plan_activities(draft: Optional[dict]) -> list[dict]:
    plan = (draft or {}).get("plan") or {}
    if isinstance(plan, dict):
        rows = plan.get("activities") or []
    elif isinstance(plan, list):
        rows = plan
    else:
        rows = []
    return [row for row in rows if isinstance(row, dict)]


def _draft_lesson_id(draft: Optional[dict]) -> str:
    for activity in _plan_activities(draft):
        lesson_id = str(activity.get("lesson_id") or "").strip()
        if lesson_id:
            return lesson_id
    return str((draft or {}).get("school_lesson_id") or "").strip()


async def _get_or_create_supplemental_draft(
    *,
    server_module: Any,
    db: Any,
    enrollment: dict,
    booking_id: str,
    actor: dict,
    day: str,
    current_lesson_id: str,
    prior_pm_draft: dict,
) -> dict:
    """Return one same-day supplemental draft for the current School lesson.

    Supplemental drafts deliberately use a non-AM/PM label, so Board & Train
    daily status/checkout continue to be based only on the two required slots.
    A completed supplemental draft is returned again while the School pointer
    remains on the same lesson, matching normal session idempotency.
    """
    query = {
        "enrollment_id": enrollment.get("id"),
        "occurrence_date": day,
        "session_label": SUPPLEMENTAL_LABEL,
        "school_lesson_id": current_lesson_id,
        "status": {"$in": ["draft", "completing", "completed"]},
    }
    existing = await db.training_session_drafts.find_one(query, {"_id": 0})
    if existing:
        return existing

    now_fn = getattr(server_module, "now_iso", None)
    gid_fn = getattr(server_module, "_gid", None)
    plan_fn = getattr(server_module, "_generate_suggested_plan", None)
    if not all(callable(fn) for fn in (now_fn, gid_fn, plan_fn)):
        raise RuntimeError("Board & Train workspace access could not find canonical draft builders")

    ts = now_fn()
    doc = {
        "id": gid_fn(),
        "enrollment_id": enrollment.get("id"),
        "dog_id": enrollment.get("dog_id"),
        "program_id": enrollment.get("program_id"),
        "booking_id": booking_id,
        "session_label": SUPPLEMENTAL_LABEL,
        "occurrence_date": day,
        "status": "draft",
        "created_at": ts,
        "created_by": actor.get("id"),
        "created_by_name": actor.get("name") or actor.get("display_name") or "",
        "updated_at": ts,
        "plan": {"activities": plan_fn(enrollment)},
        "actuals": {},
        "session_note": "",
        "client_recap_note": "",
        "what_went_well": "",
        "needs_work": "",
        "next_lesson_focus": "",
        "practice_note": "",
        "supplemental": True,
        "supplemental_reason": "school_progress_changed_after_daily_completion",
        "school_lesson_id": current_lesson_id,
        "source_completed_draft_id": prior_pm_draft.get("id") or prior_pm_draft.get("draft_id"),
    }
    try:
        await db.training_session_drafts.insert_one(doc)
        doc.pop("_id", None)
        return doc
    except Exception as exc:
        duplicate_error = getattr(server_module, "DuplicateKeyError", None)
        if duplicate_error is None or not isinstance(exc, duplicate_error):
            raise
        winner = await db.training_session_drafts.find_one(query, {"_id": 0})
        if winner:
            return winner
        raise


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

        # Explicit AM/PM requests keep Trainer Delivery's existing behavior.
        # Only repair the no-label entry path used by Open Plan/Today.
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
                        current_lesson_id = str(enrollment.get("current_lesson_id") or "").strip()
                        pm_lesson_id = _draft_lesson_id(pm)
                        if current_lesson_id and pm_lesson_id and current_lesson_id != pm_lesson_id:
                            return await _get_or_create_supplemental_draft(
                                server_module=server_module,
                                db=db,
                                enrollment=enrollment,
                                booking_id=booking_id,
                                actor=actor,
                                day=day,
                                current_lesson_id=current_lesson_id,
                                prior_pm_draft=pm,
                            )

                        # No School-pointer change: review the existing completed
                        # PM slot. This never creates a duplicate required slot.
                        label = str(pm.get("session_label") or "PM").strip() or "PM"

        return await original_get_draft(enrollment, booking_id, label, actor)

    server_module._get_or_create_session_draft = get_or_create_with_completed_day_access
    server_module._board_train_workspace_access_installed = True
