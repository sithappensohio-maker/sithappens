"""Canonical Training-domain policies used directly by server.py.

This module replaces post-import monkey-patching for the actively evolving
trainer/School workflow.  It deliberately receives DB/callback dependencies
instead of importing ``server`` so the dependency direction is one-way:
server -> domain service, never domain service -> server.
"""
from __future__ import annotations

import logging
from typing import Any, Awaitable, Callable, Dict, List, Optional

from fastapi import HTTPException

from board_train_scheduling import apply_board_train_span, repair_open_board_train_booking_spans
from board_train_workspace_access import SUPPLEMENTAL_LABEL, _draft_lesson_id
from trainer_delivery_enforcement import (
    BOARD_TRAIN_SLOTS,
    _auto_closeout_if_ready,
    _booking_drafts_for_day,
    _draft_status,
    _today_row_board_train_status,
    board_train_readiness,
    daily_status,
    is_board_train_booking,
    normalize_bt_label,
    required_training_dates,
    slots_from_drafts,
)

logger = logging.getLogger("sithappens")
SESSION_COMPLETION_RULE_VERSION = 1


def _text(value: Any) -> str:
    return str(value or "").strip()


def trainer_controls_in_person_progression(enrollment: dict, action: str) -> bool:
    """Pure In-Person School uses the trainer's Ready decision, not checkpoints."""
    return (
        (enrollment or {}).get("delivery_channel") == "in_person_school"
        and _text(action) == "advance_next"
    )


def session_completion_gaps(canonical_gaps: List[str], draft: dict, body: Any) -> List[str]:
    """Return the same Trainer Delivery completion requirements as the old wrapper.

    ``canonical_gaps`` is supplied by server.py so this service does not reach
    back into the application module.  Keeping that boundary explicit is the
    point of the Phase-4 extraction.
    """
    gaps: List[str] = []
    for gap in canonical_gaps or []:
        msg = _text(gap)
        if msg and msg not in gaps:
            gaps.append(msg)

    # Preserve the previous wrapper exactly: historical list-shaped plans
    # receive the extra required-curriculum mastery checks. Newer dict-shaped
    # plans continue to rely on the canonical server assessment gate, just as
    # they did before Phase 4. Modernization must not silently tighten rules.
    activities = draft.get("plan") or []
    actuals = draft.get("actuals") or {}
    for activity in activities:
        if not isinstance(activity, dict) or not activity.get("required_curriculum"):
            continue
        aid = _text(activity.get("id") or activity.get("skill_id") or activity.get("goal_id"))
        actual = actuals.get(aid) if aid and isinstance(actuals.get(aid), dict) else {}
        if not actual:
            for key in ("skill_id", "goal_id"):
                raw = _text(activity.get(key))
                if raw and isinstance(actuals.get(raw), dict):
                    actual = actuals.get(raw) or {}
                    break
        label = _text(
            activity.get("title") or activity.get("name") or activity.get("skill_name") or aid or "Required skill"
        )
        skipped = bool(activity.get("skipped")) or _text(actual.get("outcome")).lower() == "skipped"
        if skipped:
            reason = _text(actual.get("skip_reason") or activity.get("skip_reason"))
            if not reason:
                gaps.append(f"{label}: add a reason for skipping this required skill")
            continue
        mastery = _text(actual.get("mastery_decision")).lower()
        if mastery not in {"mastered", "not_yet"}:
            gaps.append(f"{label}: choose Confirm Mastered or Not Yet")

    for field, message in (
        ("what_went_well", "Add What Went Well"),
        ("needs_work", "Add Needs Work"),
        ("next_lesson_focus", "Add Next Session Focus"),
    ):
        if not _text(draft.get(field)):
            gaps.append(message)

    send_recap = bool(body.get("send_recap", True)) if isinstance(body, dict) else bool(getattr(body, "send_recap", True))
    if send_recap and not _text(draft.get("client_recap_note")):
        gaps.append("Add the client recap, or turn off Send Recap for this session")

    out: List[str] = []
    seen = set()
    for gap in gaps:
        if gap not in seen:
            seen.add(gap)
            out.append(gap)
    return out


def enforce_session_completion_record(canonical_gaps: List[str], draft: dict, body: Any) -> None:
    gaps = session_completion_gaps(canonical_gaps, draft, body)
    if gaps:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "session_completion_incomplete",
                "message": "Finish the required trainer record before completing this session.",
                "msg": "Finish the required trainer record: " + " · ".join(gaps),
                "gaps": gaps,
            },
        )


def stamp_completion_plan(plan: Dict[str, Any]) -> Dict[str, Any]:
    plan["trainer_delivery_rule_version"] = SESSION_COMPLETION_RULE_VERSION
    log_doc = plan.get("log_doc")
    if isinstance(log_doc, dict):
        log_doc["trainer_delivery_rule_version"] = SESSION_COMPLETION_RULE_VERSION
        log_doc["completion_requirements_verified"] = True
    return plan


async def apply_booking_service_rules(db: Any, body: Any, service: Optional[dict]) -> Optional[dict]:
    """Apply residential Board & Train span immediately after exact service resolution."""
    if service:
        await apply_board_train_span(db, body, service)
    return service


def effective_booking_service_type(body: Any) -> str:
    """Board & Train keeps training pricing but uses residential time semantics."""
    return "boarding" if bool(getattr(body, "_board_train_residential", False)) else getattr(body, "service_type", "")


async def prepare_session_draft_request(
    *, db: Any, enrollment: dict, booking_id: Optional[str], session_label: str, business_day: str
) -> Dict[str, Any]:
    """Resolve Board & Train AM/PM/supplemental behavior before draft lookup.

    This is the explicit replacement for the old two-layer monkey-patch chain
    around ``_get_or_create_session_draft``.  It returns either a direct
    existing draft, a supplemental request, or the canonical label to use.
    """
    label = _text(session_label)
    if not booking_id:
        return {"session_label": label}

    booking = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
    if not booking or not await is_board_train_booking(db, booking):
        return {"session_label": label}
    if business_day not in set(required_training_dates(booking)):
        return {"session_label": label}

    drafts = await _booking_drafts_for_day(db, booking, business_day, enrollment_id=enrollment.get("id"))
    slots = slots_from_drafts(drafts)

    # Board Train Workspace Access used to be the OUTER wrapper. Preserve that
    # ordering before the AM/PM resolver below.
    if not normalize_bt_label(label):
        am, pm = slots.get("AM"), slots.get("PM")
        if am and pm and _draft_status(am) == "completed" and _draft_status(pm) == "completed":
            current_lesson_id = _text(enrollment.get("current_lesson_id"))
            pm_lesson_id = _draft_lesson_id(pm)
            if current_lesson_id and pm_lesson_id and current_lesson_id != pm_lesson_id:
                return {
                    "supplemental": True,
                    "session_label": SUPPLEMENTAL_LABEL,
                    "school_lesson_id": current_lesson_id,
                    "source_completed_draft_id": pm.get("id") or pm.get("draft_id"),
                }
            label = _text(pm.get("session_label")) or "PM"

    requested = normalize_bt_label(label)
    if requested and requested not in BOARD_TRAIN_SLOTS:
        raise HTTPException(status_code=400, detail="Board & Train session_label must be AM or PM")

    if not requested:
        am, pm = slots.get("AM"), slots.get("PM")
        if am and _draft_status(am) != "completed":
            label = _text(am.get("session_label"))
        elif not am:
            label = "AM"
        elif pm and _draft_status(pm) != "completed":
            label = _text(pm.get("session_label")) or "PM"
        elif not pm:
            label = "PM"
        else:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "board_train_day_complete",
                    "message": "Both AM and PM Board & Train sessions are already complete for today.",
                    "msg": "Both AM and PM Board & Train sessions are already complete for today.",
                },
            )
    elif requested == "AM" and slots.get("AM") and not normalize_bt_label(slots["AM"].get("session_label")):
        label = ""
    else:
        label = requested
    return {"session_label": label}


async def create_supplemental_draft(
    *,
    db: Any,
    enrollment: dict,
    booking_id: str,
    actor: dict,
    business_day: str,
    school_lesson_id: str,
    source_completed_draft_id: Optional[str],
    now_iso: Callable[[], str],
    gid: Callable[[], str],
    suggested_plan: Callable[[dict], list],
    duplicate_key_error: type,
) -> dict:
    query = {
        "enrollment_id": enrollment.get("id"),
        "occurrence_date": business_day,
        "session_label": SUPPLEMENTAL_LABEL,
        "school_lesson_id": school_lesson_id,
        "status": {"$in": ["draft", "completing", "completed"]},
    }
    existing = await db.training_session_drafts.find_one(query, {"_id": 0})
    if existing:
        return existing
    ts = now_iso()
    doc = {
        "id": gid(), "enrollment_id": enrollment.get("id"), "dog_id": enrollment.get("dog_id"),
        "program_id": enrollment.get("program_id"), "booking_id": booking_id,
        "session_label": SUPPLEMENTAL_LABEL, "occurrence_date": business_day, "status": "draft",
        "created_at": ts, "created_by": actor.get("id"),
        "created_by_name": actor.get("name") or actor.get("display_name") or "", "updated_at": ts,
        "plan": {"activities": suggested_plan(enrollment)}, "actuals": {},
        "session_note": "", "client_recap_note": "", "what_went_well": "", "needs_work": "",
        "next_lesson_focus": "", "practice_note": "", "supplemental": True,
        "supplemental_reason": "school_progress_changed_after_daily_completion",
        "school_lesson_id": school_lesson_id, "source_completed_draft_id": source_completed_draft_id,
    }
    try:
        await db.training_session_drafts.insert_one(doc)
        doc.pop("_id", None)
        return doc
    except Exception as exc:
        if not isinstance(exc, duplicate_key_error):
            raise
        winner = await db.training_session_drafts.find_one(query, {"_id": 0})
        if winner:
            return winner
        raise


async def after_completion_worker(*, db: Any, draft_id: str, plan: Dict[str, Any]) -> None:
    """Auto-close a Board & Train day after its second required session."""
    try:
        draft = await db.training_session_drafts.find_one({"draft_id": draft_id}, {"_id": 0})
        if not draft:
            draft = await db.training_session_drafts.find_one({"id": draft_id}, {"_id": 0})
        booking_id = (draft or {}).get("booking_id")
        if not booking_id:
            return
        booking = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
        if not booking or not await is_board_train_booking(db, booking):
            return
        day = _text((draft or {}).get("occurrence_date"))
        if day:
            await _auto_closeout_if_ready(
                db, booking, day,
                actor={"id": plan.get("completed_by"), "name": plan.get("completed_by_name")},
                enrollment_id=(draft or {}).get("enrollment_id"),
            )
    except Exception:
        logger.exception("Board & Train daily closeout failed after session %s", draft_id)


async def ensure_board_train_checkout_ready(*, db: Any, booking: dict, business_day: str) -> None:
    if not booking or not await is_board_train_booking(db, booking):
        return
    readiness = await board_train_readiness(db, booking, business_day=business_day)
    if readiness.get("ready"):
        return
    incomplete = readiness.get("incomplete_days") or []
    missing = "; ".join(
        f"{row.get('date')}: AM {row.get('am')}, PM {row.get('pm')}" for row in incomplete[:8]
    )
    raise HTTPException(
        status_code=409,
        detail={
            "code": "board_train_training_incomplete",
            "message": "Board & Train checkout is blocked until every required AM/PM training day is complete.",
            "msg": "Board & Train checkout is blocked until every required AM/PM training day is complete."
                   + (f" Missing: {missing}" if missing else ""),
            "incomplete_days": incomplete,
        },
    )


async def enrich_training_today_rows(*, db: Any, rows: List[dict], business_day: str) -> List[dict]:
    if not isinstance(rows, list) or not rows:
        return rows
    booking_ids = [r.get("booking_id") for r in rows if isinstance(r, dict) and r.get("booking_id")]
    bookings = await db.bookings.find({"id": {"$in": booking_ids}}, {"_id": 0}).to_list(max(1, len(booking_ids)))
    by_id = {b.get("id"): b for b in bookings}
    out = []
    for row in rows:
        booking = by_id.get((row or {}).get("booking_id"))
        if booking and await is_board_train_booking(db, booking):
            try:
                row = await _today_row_board_train_status(db, None, row, booking, business_day)
            except Exception:
                logger.exception("Could not enrich Board & Train Today row for %s", booking.get("id"))
        out.append(row)
    return out


async def board_train_daily_status_payload(*, db: Any, booking: dict, business_day: str) -> dict:
    readiness = await board_train_readiness(db, booking, through=business_day, business_day=business_day)
    drafts = await _booking_drafts_for_day(db, booking, business_day)
    return {
        "booking_id": booking.get("id"),
        "today": daily_status(booking, business_day, drafts),
        "readiness_through_today": readiness,
        "checkout": await board_train_readiness(db, booking, business_day=business_day),
    }


async def repair_open_residential_spans(db: Any) -> int:
    return await repair_open_board_train_booking_spans(db)
