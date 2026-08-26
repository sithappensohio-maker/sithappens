"""Trainer Delivery hardening + Board & Train daily session orchestration.

Installed from app_entry.py after server.py is fully imported. This keeps the
canonical School enrollment/session/checkout code in server.py authoritative:
we wrap existing helpers and enrich the existing Today route rather than
creating a second progression or booking system.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
import logging
from typing import Any, Dict, Iterable, List, Optional

from fastapi import Depends, HTTPException

from board_train_scheduling import board_train_stay_info

logger = logging.getLogger("sithappens")

BOARD_TRAIN_SLOTS = ("AM", "PM")
_COMPLETION_RULE_VERSION = 1


def _text(value: Any) -> str:
    return str(value or "").strip()


def _activity_id(activity: dict) -> str:
    return _text(activity.get("id") or activity.get("skill_id") or activity.get("goal_id"))


def _actual_for(draft: dict, activity: dict) -> dict:
    actuals = draft.get("actuals") or {}
    aid = _activity_id(activity)
    if aid and isinstance(actuals.get(aid), dict):
        return actuals.get(aid) or {}
    for key in ("skill_id", "goal_id"):
        raw = _text(activity.get(key))
        if raw and isinstance(actuals.get(raw), dict):
            return actuals.get(raw) or {}
    return {}


def session_completion_gaps(server_module: Any, enrollment: dict, draft: dict, body: Any) -> List[str]:
    """Return every missing record that prevents a trainer from finalizing.

    The canonical server helper remains authoritative for which current-lesson
    skills require an outcome/score. This adds the fields the trainer workspace
    already exposes but previously allowed a "Remain" completion to omit:
    mastery decision, skip reason, structured recap, and client recap when sent.
    """
    gaps: List[str] = []

    canonical = getattr(server_module, "_current_lesson_assessment_gaps", None)
    if callable(canonical):
        for gap in canonical(enrollment, draft) or []:
            msg = _text(gap)
            if msg and msg not in gaps:
                gaps.append(msg)

    for activity in draft.get("plan") or []:
        if not isinstance(activity, dict) or not activity.get("required_curriculum"):
            continue
        actual = _actual_for(draft, activity)
        label = _text(
            activity.get("title")
            or activity.get("name")
            or activity.get("skill_name")
            or _activity_id(activity)
            or "Required skill"
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


def normalize_bt_label(value: Any) -> str:
    label = _text(value).upper().replace(".", "")
    if label in {"AM", "MORNING"}:
        return "AM"
    if label in {"PM", "AFTERNOON", "EVENING"}:
        return "PM"
    return label


def _draft_slot(draft: dict) -> Optional[str]:
    label = normalize_bt_label(draft.get("session_label"))
    if label in BOARD_TRAIN_SLOTS:
        return label
    if not label:
        return "AM"
    return None


def _draft_status(draft: Optional[dict]) -> str:
    if not draft:
        return "not_started"
    if draft.get("resolution_state") == "resolution_needed":
        return "resolution_needed"
    state = _text(draft.get("state") or draft.get("status")).lower()
    if state == "completed":
        return "completed"
    if state == "completing":
        return "in_progress"
    if state == "draft":
        return "in_progress" if draft.get("started_at") else "plan_ready"
    return state or "not_started"


def slots_from_drafts(drafts: Iterable[dict]) -> Dict[str, dict]:
    """Choose the current draft for AM and PM, preserving blank-as-AM legacy."""
    slots: Dict[str, dict] = {}
    for draft in drafts or []:
        slot = _draft_slot(draft)
        if not slot:
            continue
        current = slots.get(slot)
        if current is None:
            slots[slot] = draft
            continue
        cur_explicit = normalize_bt_label(current.get("session_label")) == slot
        new_explicit = normalize_bt_label(draft.get("session_label")) == slot
        if new_explicit and not cur_explicit:
            slots[slot] = draft
            continue
        if new_explicit == cur_explicit:
            new_ts = _text(draft.get("updated_at") or draft.get("completed_at") or draft.get("created_at"))
            cur_ts = _text(current.get("updated_at") or current.get("completed_at") or current.get("created_at"))
            if new_ts >= cur_ts:
                slots[slot] = draft
    return slots


def _closed_closeout(booking: dict, day: str) -> Optional[dict]:
    row = (booking.get("training_daily_closeouts") or {}).get(day)
    return row if isinstance(row, dict) and row.get("status") == "closed" else None


def required_training_dates(booking: dict, *, through: Optional[str] = None) -> List[str]:
    """Return drop-off through the day before pickup.

    Board & Train scheduling stores pickup as start + package duration, so a
    seven-day package has seven required training dates, not eight inclusive
    dates. A same-day legacy booking still yields one required day.
    """
    try:
        start = date.fromisoformat(_text(booking.get("date"))[:10])
    except ValueError:
        return []
    try:
        end = date.fromisoformat(_text(booking.get("end_date") or booking.get("date"))[:10])
    except ValueError:
        end = start
    last_exclusive = end if end > start else start + timedelta(days=1)
    if through:
        try:
            through_day = date.fromisoformat(_text(through)[:10])
            last_exclusive = min(last_exclusive, through_day + timedelta(days=1))
        except ValueError:
            pass
    out: List[str] = []
    cursor = start
    while cursor < last_exclusive:
        out.append(cursor.isoformat())
        cursor += timedelta(days=1)
    return out


def daily_status(booking: dict, day: str, drafts: Iterable[dict]) -> dict:
    slots = slots_from_drafts(drafts)
    shaped = {}
    for slot in BOARD_TRAIN_SLOTS:
        draft = slots.get(slot)
        shaped[slot] = {
            "status": _draft_status(draft),
            "draft_id": (draft or {}).get("draft_id") or (draft or {}).get("id"),
            "session_label": slot,
        }
    both_complete = all(shaped[s]["status"] == "completed" for s in BOARD_TRAIN_SLOTS)
    closeout = _closed_closeout(booking, day)
    closeout_valid = bool(closeout and both_complete)

    if any(shaped[s]["status"] == "resolution_needed" for s in BOARD_TRAIN_SLOTS):
        state = "needs_attention"
    elif both_complete and closeout_valid:
        state = "day_complete"
    elif both_complete:
        state = "closeout_pending"
    elif shaped["AM"]["status"] == "completed":
        state = "pm_due"
    elif shaped["AM"]["status"] in {"in_progress", "plan_ready"}:
        state = "am_in_progress"
    else:
        state = "am_due"

    return {
        "date": day,
        "slots": shaped,
        "both_sessions_complete": both_complete,
        "closeout": closeout,
        "closeout_complete": closeout_valid,
        "state": state,
    }


async def _service_for_booking(db: Any, booking: dict) -> Optional[dict]:
    service_id = booking.get("service_id")
    if not service_id:
        return None
    return await db.services.find_one({"id": service_id}, {"_id": 0})


async def is_board_train_booking(db: Any, booking: dict) -> bool:
    if _text(booking.get("service_type")).lower() != "training":
        return False
    service = await _service_for_booking(db, booking)
    if not service:
        return False
    try:
        return bool(await board_train_stay_info(db, service))
    except Exception:
        logger.exception("Could not resolve Board & Train service for booking %s", booking.get("id"))
        return False


async def _booking_drafts_for_day(
    db: Any,
    booking: dict,
    day: str,
    *,
    enrollment_id: Optional[str] = None,
) -> List[dict]:
    booking_id = booking.get("id")
    by_booking: List[dict] = []
    if booking_id:
        by_booking = await db.training_session_drafts.find(
            {"booking_id": booking_id, "occurrence_date": day}, {"_id": 0}
        ).to_list(20)
    if by_booking or not enrollment_id:
        return by_booking
    return await db.training_session_drafts.find(
        {"enrollment_id": enrollment_id, "occurrence_date": day}, {"_id": 0}
    ).to_list(20)


async def _auto_closeout_if_ready(
    db: Any,
    booking: dict,
    day: str,
    *,
    actor: Optional[dict] = None,
    enrollment_id: Optional[str] = None,
) -> Optional[dict]:
    drafts = await _booking_drafts_for_day(db, booking, day, enrollment_id=enrollment_id)
    status = daily_status(booking, day, drafts)
    if not status["both_sessions_complete"]:
        return None

    existing = _closed_closeout(booking, day)
    if existing:
        return existing

    slots = slots_from_drafts(drafts)
    now = datetime.now(timezone.utc).isoformat()
    actor = actor or {}
    closeout = {
        "status": "closed",
        "mode": "automatic_after_required_sessions",
        "required_slots": list(BOARD_TRAIN_SLOTS),
        "session_draft_ids": {
            slot: (slots.get(slot) or {}).get("draft_id") or (slots.get(slot) or {}).get("id")
            for slot in BOARD_TRAIN_SLOTS
        },
        "closed_at": now,
        "closed_by": actor.get("id") or "system",
        "closed_by_name": actor.get("name") or actor.get("email") or "System",
    }
    field = f"training_daily_closeouts.{day}"
    event = {**closeout, "business_date": day, "event": "board_train_daily_closeout"}
    result = await db.bookings.update_one(
        {"id": booking.get("id"), field: {"$exists": False}},
        {"$set": {field: closeout}, "$push": {"training_daily_closeout_history": event}},
    )
    if int(getattr(result, "modified_count", 0) or 0):
        return closeout
    refreshed = await db.bookings.find_one(
        {"id": booking.get("id")}, {"_id": 0, "training_daily_closeouts": 1}
    ) or {}
    return _closed_closeout(refreshed, day)


async def board_train_readiness(
    db: Any,
    booking: dict,
    *,
    through: Optional[str] = None,
    business_day: Optional[str] = None,
    enrollment_id: Optional[str] = None,
) -> dict:
    days = required_training_dates(booking, through=through)
    if not days:
        return {"ready": True, "required_days": [], "incomplete_days": [], "overdue_days": []}

    all_drafts = await db.training_session_drafts.find(
        {"booking_id": booking.get("id"), "occurrence_date": {"$in": days}}, {"_id": 0}
    ).to_list(max(20, len(days) * 6))

    by_day: Dict[str, List[dict]] = {}
    for draft in all_drafts:
        by_day.setdefault(_text(draft.get("occurrence_date")), []).append(draft)

    enrollment_id = enrollment_id or booking.get("training_enrollment_id") or booking.get("enrollment_id")
    if enrollment_id:
        missing = [d for d in days if not by_day.get(d)]
        if missing:
            legacy = await db.training_session_drafts.find(
                {"enrollment_id": enrollment_id, "occurrence_date": {"$in": missing}}, {"_id": 0}
            ).to_list(max(20, len(missing) * 6))
            for draft in legacy:
                by_day.setdefault(_text(draft.get("occurrence_date")), []).append(draft)

    incomplete = []
    for day in days:
        st = daily_status(booking, day, by_day.get(day) or [])
        if not (st["both_sessions_complete"] and st["closeout_complete"]):
            incomplete.append({
                "date": day,
                "state": st["state"],
                "am": st["slots"]["AM"]["status"],
                "pm": st["slots"]["PM"]["status"],
                "closeout_complete": st["closeout_complete"],
            })

    today_key = _text(business_day or through) or date.today().isoformat()
    overdue = [row for row in incomplete if row["date"] < today_key]
    return {
        "ready": not incomplete,
        "required_days": days,
        "incomplete_days": incomplete,
        "overdue_days": overdue,
    }


def _route_by_path(app: Any, path: str, method: str) -> Optional[Any]:
    method = method.upper()
    for route in getattr(app, "routes", []) or []:
        if getattr(route, "path", None) == path and method in (getattr(route, "methods", set()) or set()):
            return route
    return None


def _wrap_route_call(app: Any, path: str, method: str, decorator):
    """Wrap an already-registered FastAPI route without rebuilding Depends."""
    route = _route_by_path(app, path, method)
    if route is None:
        raise RuntimeError(f"Trainer Delivery extension could not find {method} {path}")
    original = route.dependant.call
    wrapped = decorator(original)
    route.dependant.call = wrapped
    route.endpoint = wrapped
    return original


async def _today_row_board_train_status(db: Any, server_module: Any, row: dict, booking: dict, day: str) -> dict:
    enrollment_id = row.get("enrollment_id")
    drafts = await _booking_drafts_for_day(db, booking, day, enrollment_id=enrollment_id)
    st = daily_status(booking, day, drafts)
    readiness = await board_train_readiness(
        db,
        booking,
        through=day,
        business_day=day,
        enrollment_id=enrollment_id,
    )
    overdue = [x for x in readiness.get("overdue_days") or [] if x.get("date") < day]

    start = date.fromisoformat(_text(booking.get("date"))[:10])
    current = date.fromisoformat(day)
    day_number = max(1, (current - start).days + 1)
    total_days = len(required_training_dates(booking))
    pickup_day = day not in set(required_training_dates(booking))

    if overdue:
        display_state = "needs_attention"
    elif pickup_day:
        display_state = "pickup_ready" if readiness.get("ready") else "needs_attention"
    else:
        display_state = st["state"]

    out = dict(row)
    out["residential_training"] = True
    out["session_status"] = display_state
    out["board_train_daily"] = {
        **st,
        "day_number": day_number,
        "total_training_days": total_days,
        "pickup_day": pickup_day,
        "overdue_days": overdue,
        "checkout_blocked": not readiness.get("ready"),
    }
    lesson = _text(row.get("current_lesson_name"))
    slot_summary = (
        f"Day {min(day_number, max(total_days, 1))}/{max(total_days, 1)} · "
        f"AM {st['slots']['AM']['status'].replace('_', ' ')} · "
        f"PM {st['slots']['PM']['status'].replace('_', ' ')}"
    )
    out["current_lesson_name"] = f"{lesson} · {slot_summary}" if lesson else slot_summary
    return out


def install_trainer_delivery_enforcement(*, server_module: Any, db: Any) -> None:
    """Install hard completion gates + residential AM/PM lifecycle exactly once."""
    if getattr(server_module, "_trainer_delivery_enforcement_installed", False):
        return

    original_compute = getattr(server_module, "_compute_completion_plan", None)
    original_get_draft = getattr(server_module, "_get_or_create_session_draft", None)
    original_worker = getattr(server_module, "_run_completion_worker", None)
    original_checkout = getattr(server_module, "_check_out_locked", None)
    if not all(callable(x) for x in (original_compute, original_get_draft, original_worker, original_checkout)):
        raise RuntimeError("Trainer Delivery extension could not find canonical session/checkout helpers")

    def business_day() -> str:
        resolver = getattr(server_module, "business_today", None)
        return resolver().isoformat() if callable(resolver) else date.today().isoformat()

    async def compute_with_required_record(enrollment, draft, draft_id, body, user):
        gaps = session_completion_gaps(server_module, enrollment, draft, body)
        if gaps:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "session_completion_incomplete",
                    "message": "Finish the required trainer record before completing this session.",
                    "gaps": gaps,
                },
            )
        plan = await original_compute(enrollment, draft, draft_id, body, user)
        if isinstance(plan, dict):
            plan["trainer_delivery_rule_version"] = _COMPLETION_RULE_VERSION
            log_doc = plan.get("log_doc")
            if isinstance(log_doc, dict):
                log_doc["trainer_delivery_rule_version"] = _COMPLETION_RULE_VERSION
                log_doc["completion_requirements_verified"] = True
        return plan

    async def get_or_create_with_board_train_slots(enrollment, booking_id, session_label, actor):
        label = _text(session_label)
        booking = None
        if booking_id:
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
                requested = normalize_bt_label(label)
                if requested and requested not in BOARD_TRAIN_SLOTS:
                    raise HTTPException(status_code=400, detail="Board & Train session_label must be AM or PM")

                if not requested:
                    am = slots.get("AM")
                    pm = slots.get("PM")
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
                            },
                        )
                elif requested == "AM" and slots.get("AM") and not normalize_bt_label(slots["AM"].get("session_label")):
                    label = ""
                else:
                    label = requested

        return await original_get_draft(enrollment, booking_id, label, actor)

    async def worker_with_daily_closeout(draft_id, plan, claim_token):
        result = await original_worker(draft_id, plan, claim_token)
        try:
            draft = await db.training_session_drafts.find_one({"draft_id": draft_id}, {"_id": 0})
            if not draft:
                draft = await db.training_session_drafts.find_one({"id": draft_id}, {"_id": 0})
            booking_id = (draft or {}).get("booking_id")
            if booking_id:
                booking = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
                if booking and await is_board_train_booking(db, booking):
                    day = _text((draft or {}).get("occurrence_date"))
                    if day:
                        await _auto_closeout_if_ready(
                            db,
                            booking,
                            day,
                            actor={
                                "id": plan.get("completed_by"),
                                "name": plan.get("completed_by_name"),
                            },
                            enrollment_id=(draft or {}).get("enrollment_id"),
                        )
        except Exception:
            logger.exception("Board & Train daily closeout failed after session %s", draft_id)
        return result

    async def checkout_with_board_train_gate(booking_id, body=None, user=None, create_invoice=True):
        booking = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
        if booking and await is_board_train_booking(db, booking):
            readiness = await board_train_readiness(db, booking, business_day=business_day())
            if not readiness.get("ready"):
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "board_train_training_incomplete",
                        "message": "Board & Train checkout is blocked until every required AM/PM training day is complete.",
                        "incomplete_days": readiness.get("incomplete_days") or [],
                    },
                )
        return await original_checkout(booking_id, body, user, create_invoice)

    server_module._compute_completion_plan = compute_with_required_record
    server_module._get_or_create_session_draft = get_or_create_with_board_train_slots
    server_module._run_completion_worker = worker_with_daily_closeout
    server_module._check_out_locked = checkout_with_board_train_gate

    app = getattr(server_module, "app", None)
    if app is None:
        raise RuntimeError("Trainer Delivery extension could not find FastAPI app")

    def decorate_training_today(original):
        async def wrapped(**kwargs):
            rows = await original(**kwargs)
            if not isinstance(rows, list) or not rows:
                return rows
            day = business_day()
            booking_ids = [r.get("booking_id") for r in rows if isinstance(r, dict) and r.get("booking_id")]
            bookings = await db.bookings.find(
                {"id": {"$in": booking_ids}}, {"_id": 0}
            ).to_list(max(1, len(booking_ids)))
            by_id = {b.get("id"): b for b in bookings}
            out = []
            for row in rows:
                booking = by_id.get((row or {}).get("booking_id"))
                if booking and await is_board_train_booking(db, booking):
                    try:
                        row = await _today_row_board_train_status(db, server_module, row, booking, day)
                    except Exception:
                        logger.exception("Could not enrich Board & Train Today row for %s", booking.get("id"))
                out.append(row)
            return out

        wrapped.__name__ = getattr(original, "__name__", "admin_training_today")
        return wrapped

    _wrap_route_call(app, "/api/admin/training/today", "GET", decorate_training_today)

    manage_sessions_dep = server_module.require_admin_and_permission("manage_training_sessions")

    @app.get("/api/admin/training/board-and-train/{booking_id}/daily-status")
    async def board_train_daily_status(booking_id: str, _: dict = Depends(manage_sessions_dep)):
        booking = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
        if not booking:
            raise HTTPException(status_code=404, detail="Booking not found")
        if not await is_board_train_booking(db, booking):
            raise HTTPException(status_code=422, detail="Booking is not a Board & Train residential program")
        today = business_day()
        readiness = await board_train_readiness(db, booking, through=today, business_day=today)
        drafts = await _booking_drafts_for_day(db, booking, today)
        return {
            "booking_id": booking_id,
            "today": daily_status(booking, today, drafts),
            "readiness_through_today": readiness,
            "checkout": await board_train_readiness(db, booking, business_day=today),
        }

    server_module._trainer_delivery_enforcement_installed = True
    server_module._session_completion_gaps = (
        lambda enrollment, draft, body: session_completion_gaps(server_module, enrollment, draft, body)
    )
    server_module._board_train_readiness = (
        lambda booking, through=None: board_train_readiness(
            db,
            booking,
            through=through,
            business_day=business_day(),
        )
    )
