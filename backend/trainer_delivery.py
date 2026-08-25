"""Enforced trainer delivery for in-person and Board & Train programs.

This module is an additive runtime extension over the canonical training spine:
training_session_drafts -> complete_training_session -> training_session_log ->
dog_programs progress. It never creates a second progress/training model.

Operational guarantees:
1. Staff-led sessions cannot complete without a real trainer record.
2. Resident Board & Train dogs get required AM/PM work in the existing Hub.
3. Staff-led training checkout cannot bypass unresolved trainer work.
4. Legitimate Recovery/Unable-to-Train sessions never require fake scores.
"""
from __future__ import annotations

import json
import re
import uuid
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

from fastapi import Depends, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field


STAFF_SCHOOL_CHANNELS = {"in_person_school", "hybrid_school"}
BOARD_TRAIN_SLOTS = ("am", "pm")
_SYNTH_RE = re.compile(r"^/api/bookings/([^/]+)~bt~(am|pm|outing)/training-session/draft$")
_COMPLETE_RE = re.compile(r"^/api/training-session-drafts/([^/]+)/complete$")
_CHECKOUT_RE = re.compile(r"^/api/bookings/([^/]+)/(check-out|check-out-group)$")
_BT_LABEL_RE = re.compile(r"^bt:(\d{4}-\d{2}-\d{2}):(am|pm|outing)$")


class BoardTrainExcuseIn(BaseModel):
    reason: str = Field(min_length=5, max_length=2000)


class BoardTrainCloseoutIn(BaseModel):
    biggest_win: str = Field(min_length=2, max_length=3000)
    biggest_challenge: str = Field(min_length=2, max_length=3000)
    tomorrow_focus: str = Field(min_length=2, max_length=3000)
    client_update: str = Field(min_length=5, max_length=5000)


class CheckoutOverrideIn(BaseModel):
    reason: str = Field(min_length=10, max_length=2000)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean(value: Any) -> str:
    return str(value or "").strip()


def _safe_int(value: Any, default: int, minimum: int = 0, maximum: int = 20) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return default
    return max(minimum, min(maximum, n))


def _staff_permission(server_module, user: dict) -> dict:
    try:
        perms = server_module._perms_for(user)
    except Exception:
        perms = {}
    if not perms.get("manage_training_sessions"):
        raise HTTPException(status_code=403, detail="Training-session permission required")
    return user


def _owner_permission(server_module, user: dict) -> dict:
    try:
        if callable(getattr(server_module, "_is_owner", None)) and server_module._is_owner(user):
            return user
    except Exception:
        pass
    if user.get("role") == "admin" and user.get("staff_role") in (None, "", "owner"):
        return user
    raise HTTPException(status_code=403, detail="Owner permission required")


async def _request_user(server_module, request: Request) -> dict:
    raw = _clean(request.headers.get("authorization"))
    if not raw.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = raw.split(None, 1)[1]
    credentials = server_module.HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
    user = await server_module.get_current_user(credentials)
    return _staff_permission(server_module, user)


async def _business_clock(db) -> datetime:
    row = await db.settings.find_one({}, {"_id": 0, "business_timezone": 1, "timezone": 1}) or {}
    tz_name = _clean(row.get("business_timezone") or row.get("timezone")) or "America/New_York"
    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = ZoneInfo("America/New_York")
    return datetime.now(tz)


def _trainer_policy(enrollment: dict) -> dict:
    snap = enrollment.get("program_snapshot") or {}
    cfg = ((snap.get("school_support") or {}).get("trainer_delivery") or {})
    program_type = snap.get("type") or enrollment.get("program_type")
    is_bt = program_type == "board_train"
    staff_led = enrollment.get("delivery_channel") in STAFF_SCHOOL_CHANNELS or is_bt
    enabled = bool(cfg.get("enabled", staff_led))

    # V1 deliberately exposes one staff-led appointment session, or AM+PM for
    # Board & Train. Never accept hidden third/fourth required slots that the UI
    # cannot represent and therefore staff could never satisfy.
    sessions = _safe_int(cfg.get("required_sessions_per_day"), 2 if is_bt else 1, 1, 2 if is_bt else 1)
    slots = list(BOARD_TRAIN_SLOTS[:sessions]) if is_bt else []
    return {
        "enabled": enabled,
        "program_type": program_type,
        "is_board_train": is_bt,
        "required_sessions_per_day": sessions,
        "required_slots": slots,
        "daily_closeout_required": bool(cfg.get("daily_closeout_required", is_bt)),
        "require_score": bool(cfg.get("require_score", True)),
        "require_outcome": bool(cfg.get("require_outcome", True)),
        "require_client_observation": bool(cfg.get("require_client_observation", not is_bt)),
        "require_session_summary": bool(cfg.get("require_session_summary", True)),
        "require_client_recap": bool(cfg.get("require_client_recap", not is_bt)),
        "require_explicit_advancement": bool(cfg.get("require_explicit_advancement", True)),
        "am_overdue_hour": _safe_int(cfg.get("am_overdue_hour"), 14, 0, 23),
        "pm_overdue_hour": _safe_int(cfg.get("pm_overdue_hour"), 19, 0, 23),
    }


def _board_train_label(session_date: str, slot: str) -> str:
    return f"bt:{session_date}:{slot}"


def _board_train_label_parts(label: Optional[str]) -> Optional[Tuple[str, str]]:
    match = _BT_LABEL_RE.match(_clean(label))
    return (match.group(1), match.group(2)) if match else None


def validate_trainer_session(draft: dict, completion: dict, policy: dict) -> dict:
    """Validate required trainer documentation before canonical completion.

    Recovery is explicit through the plan itself: when every planned activity
    is marked skipped and every skip has a real reason, the session is excused.
    No score/outcome/mastery value is manufactured. Board & Train PM still
    requires the owner-facing daily update even on a recovery day.
    """
    if not policy.get("enabled") or draft.get("status") == "completed":
        return {"ok": True, "missing": [], "excused": False}

    activities = list(((draft.get("plan") or {}).get("activities") or []))
    actuals = draft.get("actuals") or {}
    missing: List[str] = []
    worked = []
    all_skipped = bool(activities)
    skip_reasons_complete = bool(activities)

    if not activities:
        missing.append("Add at least one planned training activity")

    for activity in activities:
        activity_id = activity.get("id")
        name = _clean(activity.get("name")) or "planned activity"
        if activity.get("skipped"):
            if len(_clean(activity.get("skip_reason"))) < 3:
                skip_reasons_complete = False
                missing.append(f"Explain why {name} was skipped")
            continue

        all_skipped = False
        skip_reasons_complete = False
        actual = actuals.get(activity_id) or {}
        worked.append((activity, actual))
        if not actual:
            missing.append(f"Record {name} or mark it skipped with a reason")
            continue
        if policy.get("require_score") and not activity.get("manual_only") and actual.get("score") is None:
            missing.append(f"Score {name} from 0–5")
        if policy.get("require_outcome") and not _clean(actual.get("outcome")):
            missing.append(f"Choose an outcome for {name}")

    excused = bool(all_skipped and activities and not worked and skip_reasons_complete)
    if not worked and not excused:
        missing.append("Record at least one training activity")

    bt = _board_train_label_parts(draft.get("session_label"))
    is_bt_pm = bool(bt and bt[1] == "pm")

    if not excused:
        if policy.get("require_client_observation") and not any(
            len(_clean(actual.get("client_observation"))) >= 2 for _, actual in worked
        ):
            missing.append("Add at least one client-safe skill observation")
        if policy.get("require_session_summary"):
            if len(_clean(draft.get("what_went_well"))) < 2:
                missing.append("Complete What Went Well")
            if len(_clean(draft.get("needs_work"))) < 2:
                missing.append("Complete Needs Work")
            if len(_clean(draft.get("next_lesson_focus"))) < 2:
                missing.append("Complete Next Focus")

    # The daily owner update is required for PM even when the dog could not
    # train. Clients should still hear what happened and what tomorrow's plan is.
    recap_required = policy.get("require_client_recap") or is_bt_pm
    if recap_required and len(_clean(draft.get("client_recap_note"))) < 5:
        missing.append("Write the client recap/update")

    if policy.get("require_explicit_advancement") and not _clean(completion.get("advancement_action")):
        missing.append("Choose what happens next for the curriculum")

    deduped = list(dict.fromkeys(missing))
    return {"ok": not deduped, "missing": deduped, "excused": excused}


async def _policy_for_draft(db, draft: dict) -> Tuple[dict, Optional[dict]]:
    enrollment = await db.dog_programs.find_one({"id": draft.get("enrollment_id")}, {"_id": 0})
    if not enrollment:
        return {"enabled": False}, None
    return _trainer_policy(enrollment), enrollment


async def _record_delivery_audit(db, draft: dict, user: Optional[dict], *, excused: bool = False) -> None:
    await db.trainer_delivery_audit.update_one(
        {"draft_id": draft.get("id")},
        {"$set": {
            "draft_id": draft.get("id"),
            "enrollment_id": draft.get("enrollment_id"),
            "dog_id": draft.get("dog_id"),
            "booking_id": draft.get("booking_id"),
            "session_label": draft.get("session_label") or "",
            "occurrence_date": draft.get("occurrence_date"),
            "trainer_id": (user or {}).get("id"),
            "trainer_name": (user or {}).get("display_name") or (user or {}).get("name") or (user or {}).get("email"),
            "excused": bool(excused),
            "enforcement_version": 1,
            "completed_at": _now(),
        }},
        upsert=True,
    )


async def _required_slot_state(db, enrollment_id: str, session_date: str, policy: dict) -> dict:
    labels = [_board_train_label(session_date, slot) for slot in policy.get("required_slots") or []]
    drafts = await db.training_session_drafts.find(
        {"enrollment_id": enrollment_id, "session_label": {"$in": labels}}, {"_id": 0}
    ).to_list(max(10, len(labels) + 2))
    by_label = {row.get("session_label"): row for row in drafts}
    excuses = await db.trainer_delivery_excuses.find(
        {"enrollment_id": enrollment_id, "session_date": session_date}, {"_id": 0}
    ).to_list(20)
    by_slot_excuse = {row.get("slot"): row for row in excuses}

    out = {}
    for slot in policy.get("required_slots") or []:
        draft = by_label.get(_board_train_label(session_date, slot))
        excuse = by_slot_excuse.get(slot)
        if draft and draft.get("status") == "completed":
            status = "completed"
        elif excuse:
            status = "excused"
        elif draft:
            status = "in_progress" if (draft.get("actuals") or {}) else "plan_ready"
        else:
            status = "not_started"
        out[slot] = {"status": status, "draft": draft, "excuse": excuse}
    return out


async def _maybe_auto_close_board_train_day(db, enrollment: dict, draft: dict, user: dict, policy: dict) -> None:
    parts = _board_train_label_parts(draft.get("session_label"))
    if not parts or not policy.get("daily_closeout_required"):
        return
    session_date, _slot = parts
    states = await _required_slot_state(db, enrollment.get("id"), session_date, policy)
    if not states or not all(value.get("status") in {"completed", "excused"} for value in states.values()):
        return

    existing = await db.trainer_delivery_day_closeouts.find_one(
        {"enrollment_id": enrollment.get("id"), "session_date": session_date}, {"_id": 0, "id": 1}
    )
    if existing:
        return

    completed = [
        value.get("draft") for value in states.values()
        if value.get("draft") and value["draft"].get("status") == "completed"
    ]
    preferred = next(
        (row for row in completed if (_board_train_label_parts(row.get("session_label")) or (None, None))[1] == "pm"),
        None,
    )
    preferred = preferred or (completed[-1] if completed else draft)
    client_update = _clean((preferred or {}).get("client_recap_note"))
    if len(client_update) < 5:
        return

    row = {
        "id": str(uuid.uuid4()),
        "enrollment_id": enrollment.get("id"),
        "dog_id": enrollment.get("dog_id"),
        "program_id": enrollment.get("program_id"),
        "session_date": session_date,
        "biggest_win": _clean((preferred or {}).get("what_went_well")),
        "biggest_challenge": _clean((preferred or {}).get("needs_work")),
        "tomorrow_focus": _clean((preferred or {}).get("next_lesson_focus")),
        "client_update": client_update,
        "closed_by": user.get("id"),
        "closed_by_name": user.get("display_name") or user.get("name") or user.get("email"),
        "closed_at": _now(),
        "source": "required_sessions_complete",
    }
    await db.trainer_delivery_day_closeouts.update_one(
        {"enrollment_id": enrollment.get("id"), "session_date": session_date},
        {"$setOnInsert": row},
        upsert=True,
    )


async def _board_train_context_for_booking(db, booking: dict) -> Tuple[Optional[dict], Optional[dict], Optional[dict]]:
    service = None
    if booking.get("service_id"):
        service = await db.services.find_one({"id": booking.get("service_id")}, {"_id": 0})
    program_id = (service or {}).get("package_program_id")
    program = await db.programs.find_one({"id": program_id}, {"_id": 0}) if program_id else None
    if not program or program.get("type") != "board_train":
        return service, program, None
    enrollment = await db.dog_programs.find_one(
        {"dog_id": booking.get("dog_id"), "program_id": program_id, "status": "active"},
        {"_id": 0}, sort=[("started_at", -1)]
    )
    return service, program, enrollment


async def _board_train_residents(db, clock: datetime) -> List[dict]:
    today = clock.date().isoformat()
    bookings = await db.bookings.find(
        {
            "service_type": "training",
            "status": {"$nin": ["cancelled", "rejected"]},
            "date": {"$lte": today},
            "end_date": {"$gt": today},
            "checked_in_at": {"$exists": True, "$nin": [None, ""]},
            "$or": [{"checked_out_at": {"$exists": False}}, {"checked_out_at": None}, {"checked_out_at": ""}],
        },
        {"_id": 0},
    ).to_list(500)
    if not bookings:
        return []

    service_ids = list({row.get("service_id") for row in bookings if row.get("service_id")})
    services = await db.services.find(
        {"id": {"$in": service_ids}, "package_program_id": {"$nin": [None, ""]}}, {"_id": 0}
    ).to_list(max(1, len(service_ids)))
    by_service = {row.get("id"): row for row in services}
    program_ids = list({row.get("package_program_id") for row in services if row.get("package_program_id")})
    programs = await db.programs.find(
        {"id": {"$in": program_ids}, "type": "board_train"}, {"_id": 0}
    ).to_list(max(1, len(program_ids)))
    by_program = {row.get("id"): row for row in programs}

    out = []
    for booking in bookings:
        if not booking.get("checked_in_at"):
            continue
        service = by_service.get(booking.get("service_id"))
        program = by_program.get((service or {}).get("package_program_id"))
        if not service or not program:
            continue
        enrollment = await db.dog_programs.find_one(
            {"dog_id": booking.get("dog_id"), "program_id": program.get("id"), "status": "active"},
            {"_id": 0}, sort=[("started_at", -1)]
        )
        if not enrollment:
            continue
        school = await db.school_enrollments.find_one({"enrollment_id": enrollment.get("id")}, {"_id": 0})
        dog = await db.dogs.find_one(
            {"id": booking.get("dog_id")}, {"_id": 0, "id": 1, "name": 1, "photo": 1, "owner_id": 1}
        ) or {}
        client = await db.clients.find_one(
            {"id": dog.get("owner_id")}, {"_id": 0, "id": 1, "name": 1}
        ) or {}
        try:
            start = date.fromisoformat(_clean(booking.get("date"))[:10])
            end = date.fromisoformat(_clean(booking.get("end_date"))[:10])
            day_number = max(1, (clock.date() - start).days + 1)
            total_days = max(1, (end - start).days)
        except Exception:
            day_number, total_days = 1, 1
        out.append({
            "booking": booking,
            "service": service,
            "program": program,
            "enrollment": enrollment,
            "school_enrollment": school,
            "dog": dog,
            "client": client,
            "day_number": day_number,
            "total_days": total_days,
        })
    return out


def _current_names(enrollment: dict) -> Tuple[str, str]:
    snap = enrollment.get("program_snapshot") or {}
    module = next(
        (row for row in (snap.get("modules") or []) if row.get("id") == enrollment.get("current_module_id")), None
    ) or {}
    lesson = next(
        (row for row in (module.get("lessons") or []) if row.get("id") == enrollment.get("current_lesson_id")), None
    ) or {}
    return _clean(module.get("name")), _clean(lesson.get("name"))


def _recommended_focus(enrollment: dict) -> List[str]:
    snap = enrollment.get("program_snapshot") or {}
    module = next(
        (row for row in (snap.get("modules") or []) if row.get("id") == enrollment.get("current_module_id")), None
    ) or {}
    progress = enrollment.get("goal_progress") or {}
    names = []
    for goal in module.get("goals") or []:
        if (progress.get(goal.get("id")) or {}).get("status") != "mastered" and goal.get("name"):
            names.append(goal.get("name"))
    return names[:4]


async def _board_train_rows(db, clock: datetime) -> Tuple[List[dict], List[str]]:
    today = clock.date().isoformat()
    residents = await _board_train_residents(db, clock)
    rows: List[dict] = []
    real_booking_ids: List[str] = []
    for resident in residents:
        booking, enrollment = resident["booking"], resident["enrollment"]
        real_booking_ids.append(booking.get("id"))
        policy = _trainer_policy(enrollment)
        states = await _required_slot_state(db, enrollment.get("id"), today, policy)
        closeout = await db.trainer_delivery_day_closeouts.find_one(
            {"enrollment_id": enrollment.get("id"), "session_date": today}, {"_id": 0, "id": 1}
        )
        module_name, lesson_name = _current_names(enrollment)
        assigned = None
        school = resident.get("school_enrollment") or {}
        if school.get("assigned_trainer_id"):
            trainer = await db.users.find_one(
                {"id": school.get("assigned_trainer_id")}, {"_id": 0, "name": 1, "display_name": 1}
            ) or {}
            assigned = trainer.get("display_name") or trainer.get("name")

        for slot in policy.get("required_slots") or list(BOARD_TRAIN_SLOTS):
            state = states.get(slot) or {"status": "not_started"}
            session_status = state.get("status")
            if session_status == "not_started":
                session_status = "plan_ready"
                overdue_hour = policy.get("am_overdue_hour") if slot == "am" else policy.get("pm_overdue_hour")
                if overdue_hour is not None and clock.hour >= int(overdue_hour):
                    session_status = "resolution_needed"
            elif session_status == "excused":
                session_status = "completed"

            slot_label = "AM Training" if slot == "am" else "PM Training"
            if slot == (policy.get("required_slots") or [""])[-1] and policy.get("daily_closeout_required"):
                slot_label += " + Daily Closeout"
            reason = f"board_train_{slot}_training_overdue" if session_status == "resolution_needed" else None
            rows.append({
                "booking_id": f"{booking.get('id')}~bt~{slot}",
                "real_booking_id": booking.get("id"),
                "dog_id": resident["dog"].get("id"),
                "dog_name": resident["dog"].get("name") or "Dog",
                "dog_photo": resident["dog"].get("photo"),
                "client_name": resident["client"].get("name") or "",
                "time": "AM" if slot == "am" else "PM",
                "checked_in": True,
                "session_status": session_status,
                "resolution_reason": reason,
                "program_name": f"{(enrollment.get('program_snapshot') or {}).get('name') or resident['program'].get('name') or 'Board & Train'} · Day {resident['day_number']} of {resident['total_days']} · {slot_label}",
                "current_module_name": module_name,
                "current_lesson_name": lesson_name,
                "recommended_focus": _recommended_focus(enrollment),
                "homework_completion": None,
                "media_awaiting_review": 0,
                "client_question": None,
                "assigned_trainer": assigned,
                "reopen_count": int(((state.get("draft") or {}).get("reopen_count") or 0)),
                "draft_created_at": (state.get("draft") or {}).get("created_at"),
                "needs_reassessment_count": 0,
                "homework_difficulty_flags": 0,
                "trainer_delivery_kind": "board_train",
                "trainer_delivery_slot": slot,
                "trainer_delivery_day": resident["day_number"],
                "trainer_delivery_total_days": resident["total_days"],
                "trainer_delivery_closeout_complete": bool(closeout),
            })
    return rows, real_booking_ids


async def _staff_led_enrollments_for_dog(db, dog_id: str) -> List[dict]:
    rows = await db.dog_programs.find(
        {"dog_id": dog_id, "status": "active", "delivery_channel": {"$in": list(STAFF_SCHOOL_CHANNELS)}},
        {"_id": 0},
    ).to_list(50)
    return [row for row in rows if _trainer_policy(row).get("enabled")]


async def _checkout_bookings(db, anchor: dict, group: bool) -> List[dict]:
    if not group or not anchor.get("group_id"):
        return [anchor]
    rows = await db.bookings.find(
        {
            "group_id": anchor.get("group_id"),
            "client_id": anchor.get("client_id"),
            "service_type": anchor.get("service_type"),
            "date": anchor.get("date"),
            "status": {"$ne": "completed"},
            "checked_in_at": {"$exists": True, "$nin": [None, ""]},
            "$or": [{"checked_out_at": {"$exists": False}}, {"checked_out_at": None}, {"checked_out_at": ""}],
        },
        {"_id": 0},
    ).to_list(100)
    return rows or [anchor]


async def _checkout_blockers_for_booking(db, booking: dict, clock: datetime) -> List[str]:
    if booking.get("service_type") != "training" or not booking.get("checked_in_at"):
        return []

    _service, program, bt_enrollment = await _board_train_context_for_booking(db, booking)
    if program and bt_enrollment:
        policy = _trainer_policy(bt_enrollment)
        today = clock.date().isoformat()
        states = await _required_slot_state(db, bt_enrollment.get("id"), today, policy)
        missing = [
            slot.upper() for slot, state in states.items()
            if state.get("status") not in {"completed", "excused"}
        ]
        blockers = [f"{slot} Board & Train session is not complete or excused" for slot in missing]
        closeout = await db.trainer_delivery_day_closeouts.find_one(
            {"enrollment_id": bt_enrollment.get("id"), "session_date": today}, {"_id": 0, "id": 1}
        )
        if policy.get("daily_closeout_required") and not closeout:
            blockers.append("Board & Train daily closeout/client update is not complete")
        return blockers

    enrollments = await _staff_led_enrollments_for_dog(db, booking.get("dog_id"))
    if not enrollments:
        return []
    enrollment_ids = [row.get("id") for row in enrollments if row.get("id")]
    completed = await db.training_session_drafts.find_one(
        {"booking_id": booking.get("id"), "enrollment_id": {"$in": enrollment_ids}, "status": "completed"},
        {"_id": 0, "id": 1},
    )
    return [] if completed else ["Required trainer session record is not complete"]


async def _unused_checkout_override(db, booking_id: str) -> Optional[dict]:
    return await db.trainer_delivery_checkout_overrides.find_one(
        {"booking_id": booking_id, "$or": [{"used_at": {"$exists": False}}, {"used_at": None}, {"used_at": ""}]},
        {"_id": 0}, sort=[("created_at", -1)]
    )


async def _response_body(response) -> bytes:
    if getattr(response, "body", None) is not None:
        return response.body
    chunks = []
    async for chunk in response.body_iterator:
        chunks.append(chunk)
    return b"".join(chunks)


def _copy_headers(response) -> Dict[str, str]:
    headers = dict(response.headers or {})
    headers.pop("content-length", None)
    return headers


async def _replay_body(request: Request, body: bytes) -> None:
    sent = False

    async def receive():
        nonlocal sent
        if sent:
            return {"type": "http.request", "body": b"", "more_body": False}
        sent = True
        return {"type": "http.request", "body": body, "more_body": False}

    request._receive = receive


async def _manual_closeout(
    db, enrollment: dict, session_date: str, body: BoardTrainCloseoutIn, user: dict, policy: dict
) -> dict:
    states = await _required_slot_state(db, enrollment.get("id"), session_date, policy)
    unresolved = [
        slot for slot, state in states.items()
        if state.get("status") not in {"completed", "excused"}
    ]
    if unresolved:
        raise HTTPException(status_code=409, detail={
            "code": "board_train_sessions_incomplete",
            "msg": f"Finish or excuse these required sessions first: {', '.join(unresolved).upper()}",
            "slots": unresolved,
        })
    row = {
        "id": str(uuid.uuid4()),
        "enrollment_id": enrollment.get("id"),
        "dog_id": enrollment.get("dog_id"),
        "program_id": enrollment.get("program_id"),
        "session_date": session_date,
        **body.model_dump(),
        "closed_by": user.get("id"),
        "closed_by_name": user.get("display_name") or user.get("name") or user.get("email"),
        "closed_at": _now(),
        "source": "manual_closeout",
    }
    await db.trainer_delivery_day_closeouts.update_one(
        {"enrollment_id": enrollment.get("id"), "session_date": session_date}, {"$set": row}, upsert=True
    )
    return row


def install_trainer_delivery(*, server_module, db) -> None:
    if getattr(server_module, "_trainer_delivery_installed", False):
        return
    app = server_module.app

    @app.middleware("http")
    async def trainer_delivery_middleware(request: Request, call_next):
        path = request.url.path

        synthetic = _SYNTH_RE.match(path) if request.method == "POST" else None
        if synthetic:
            try:
                user = await _request_user(server_module, request)
                real_booking_id, slot = synthetic.group(1), synthetic.group(2)
                booking = await db.bookings.find_one({"id": real_booking_id}, {"_id": 0})
                if not booking:
                    raise HTTPException(status_code=404, detail="Board & Train booking not found")
                if not booking.get("checked_in_at"):
                    raise HTTPException(status_code=409, detail="Board & Train dog must be checked in before training starts")
                _service, _program, enrollment = await _board_train_context_for_booking(db, booking)
                if not enrollment:
                    raise HTTPException(status_code=409, detail="Active Board & Train enrollment not found")
                clock = await _business_clock(db)
                label = _board_train_label(clock.date().isoformat(), slot)
                result = await server_module.start_training_session_draft_for_booking(
                    real_booking_id, enrollment.get("id"), label, user
                )
                return JSONResponse(content=jsonable_encoder(result))
            except HTTPException as exc:
                return JSONResponse(status_code=exc.status_code, content={"detail": jsonable_encoder(exc.detail)})

        completion_match = _COMPLETE_RE.match(path) if request.method == "POST" else None
        if completion_match:
            draft_id = completion_match.group(1)
            draft = await db.training_session_drafts.find_one({"id": draft_id}, {"_id": 0})
            if draft and draft.get("status") != "completed":
                raw = await request.body()
                try:
                    completion = json.loads(raw.decode("utf-8") or "{}")
                except Exception:
                    completion = {}
                policy, enrollment = await _policy_for_draft(db, draft)
                check = validate_trainer_session(draft, completion, policy)
                if not check.get("ok"):
                    return JSONResponse(status_code=422, content={"detail": {
                        "code": "trainer_delivery_incomplete",
                        "msg": "Complete the required trainer record before finishing this session: " + "; ".join(check.get("missing") or []),
                        "missing": check.get("missing") or [],
                    }})

                bt = _board_train_label_parts(draft.get("session_label"))
                if bt:
                    # Board & Train has one dedicated DAILY client update. Do
                    # not also fire the legacy per-session recap email from the
                    # canonical completion route or owners receive duplicates.
                    completion["send_recap"] = False
                    raw = json.dumps(completion).encode("utf-8")
                await _replay_body(request, raw)
                response = await call_next(request)
                if 200 <= response.status_code < 300:
                    try:
                        user = await _request_user(server_module, request)
                    except Exception:
                        user = None
                    refreshed = await db.training_session_drafts.find_one({"id": draft_id}, {"_id": 0}) or draft
                    await _record_delivery_audit(db, refreshed, user, excused=bool(check.get("excused")))
                    if enrollment and user and bt:
                        await _maybe_auto_close_board_train_day(db, enrollment, refreshed, user, policy)
                return response

        checkout_match = _CHECKOUT_RE.match(path) if request.method == "POST" else None
        if checkout_match:
            booking_id, action = checkout_match.group(1), checkout_match.group(2)
            anchor = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
            if anchor:
                clock = await _business_clock(db)
                bookings = await _checkout_bookings(db, anchor, action == "check-out-group")
                blockers = []
                override_rows = []
                for booking in bookings:
                    reasons = await _checkout_blockers_for_booking(db, booking, clock)
                    if not reasons:
                        continue
                    override = await _unused_checkout_override(db, booking.get("id"))
                    if override:
                        override_rows.append(override)
                        continue
                    dog = await db.dogs.find_one({"id": booking.get("dog_id")}, {"_id": 0, "name": 1}) or {}
                    dog_name = dog.get("name") or "Dog"
                    blockers.extend([f"{dog_name}: {reason}" for reason in reasons])
                if blockers:
                    return JSONResponse(status_code=409, content={"detail": {
                        "code": "trainer_delivery_checkout_blocked",
                        "msg": "Training checkout is blocked until the trainer record is finished: " + "; ".join(blockers),
                        "blockers": blockers,
                        "owner_override_available": True,
                    }})
                response = await call_next(request)
                if 200 <= response.status_code < 300:
                    for override in override_rows:
                        await db.trainer_delivery_checkout_overrides.update_one(
                            {"id": override.get("id")}, {"$set": {"used_at": _now(), "used_on_booking_id": booking_id}}
                        )
                return response

        response = await call_next(request)
        if request.method == "GET" and path == "/api/admin/training/today" and response.status_code == 200:
            try:
                body = await _response_body(response)
                existing = json.loads(body.decode("utf-8") or "[]")
                if not isinstance(existing, list):
                    return Response(
                        content=body,
                        status_code=response.status_code,
                        headers=_copy_headers(response),
                        media_type=response.media_type,
                    )
                clock = await _business_clock(db)
                bt_rows, real_ids = await _board_train_rows(db, clock)
                real_ids = set(real_ids)
                existing = [row for row in existing if row.get("booking_id") not in real_ids]
                return JSONResponse(
                    content=jsonable_encoder(existing + bt_rows),
                    headers={key: value for key, value in _copy_headers(response).items() if key.lower() != "content-type"},
                )
            except Exception:
                try:
                    body
                except UnboundLocalError:
                    body = await _response_body(response)
                return Response(
                    content=body,
                    status_code=response.status_code,
                    headers=_copy_headers(response),
                    media_type=response.media_type,
                )
        return response

    def trainer_dep(user: dict = Depends(server_module.get_current_user)):
        return _staff_permission(server_module, user)

    def owner_dep(user: dict = Depends(server_module.get_current_user)):
        return _owner_permission(server_module, user)

    @app.get("/api/admin/trainer-delivery/board-train/today")
    async def board_train_today(user: dict = Depends(trainer_dep)):
        clock = await _business_clock(db)
        residents = await _board_train_residents(db, clock)
        today = clock.date().isoformat()
        out = []
        for resident in residents:
            enrollment = resident["enrollment"]
            policy = _trainer_policy(enrollment)
            states = await _required_slot_state(db, enrollment.get("id"), today, policy)
            closeout = await db.trainer_delivery_day_closeouts.find_one(
                {"enrollment_id": enrollment.get("id"), "session_date": today}, {"_id": 0}
            )
            out.append({
                "booking_id": resident["booking"].get("id"),
                "school_enrollment_id": (resident.get("school_enrollment") or {}).get("id"),
                "enrollment_id": enrollment.get("id"),
                "dog_id": resident["dog"].get("id"),
                "dog_name": resident["dog"].get("name"),
                "client_name": resident["client"].get("name"),
                "program_name": (enrollment.get("program_snapshot") or {}).get("name") or resident["program"].get("name"),
                "day_number": resident["day_number"],
                "total_days": resident["total_days"],
                "required_slots": {
                    slot: {"status": state.get("status"), "reason": (state.get("excuse") or {}).get("reason")}
                    for slot, state in states.items()
                },
                "daily_closeout": closeout,
                "policy": policy,
            })
        return out

    @app.post("/api/admin/trainer-delivery/board-train/{school_enrollment_id}/days/{session_date}/slots/{slot}/excuse")
    async def excuse_board_train_slot(
        school_enrollment_id: str,
        session_date: str,
        slot: str,
        body: BoardTrainExcuseIn,
        user: dict = Depends(trainer_dep),
    ):
        if slot not in BOARD_TRAIN_SLOTS:
            raise HTTPException(status_code=400, detail="Only AM or PM required sessions may be excused")
        school = await db.school_enrollments.find_one({"id": school_enrollment_id}, {"_id": 0})
        enrollment = await db.dog_programs.find_one(
            {"id": (school or {}).get("enrollment_id")}, {"_id": 0}
        ) if school else None
        if not enrollment or _trainer_policy(enrollment).get("program_type") != "board_train":
            raise HTTPException(status_code=404, detail="Board & Train enrollment not found")
        existing = await db.training_session_drafts.find_one(
            {
                "enrollment_id": enrollment.get("id"),
                "session_label": _board_train_label(session_date, slot),
                "status": "completed",
            },
            {"_id": 0, "id": 1},
        )
        if existing:
            raise HTTPException(status_code=409, detail="That required session is already completed and cannot be excused")
        row = {
            "id": str(uuid.uuid4()),
            "school_enrollment_id": school_enrollment_id,
            "enrollment_id": enrollment.get("id"),
            "dog_id": enrollment.get("dog_id"),
            "session_date": session_date,
            "slot": slot,
            "reason": body.reason.strip(),
            "excused_by": user.get("id"),
            "excused_by_name": user.get("display_name") or user.get("name") or user.get("email"),
            "excused_at": _now(),
        }
        await db.trainer_delivery_excuses.update_one(
            {"enrollment_id": enrollment.get("id"), "session_date": session_date, "slot": slot},
            {"$set": row},
            upsert=True,
        )
        return row

    @app.post("/api/admin/trainer-delivery/board-train/{school_enrollment_id}/days/{session_date}/closeout")
    async def close_board_train_day(
        school_enrollment_id: str,
        session_date: str,
        body: BoardTrainCloseoutIn,
        user: dict = Depends(trainer_dep),
    ):
        school = await db.school_enrollments.find_one({"id": school_enrollment_id}, {"_id": 0})
        enrollment = await db.dog_programs.find_one(
            {"id": (school or {}).get("enrollment_id")}, {"_id": 0}
        ) if school else None
        if not enrollment or _trainer_policy(enrollment).get("program_type") != "board_train":
            raise HTTPException(status_code=404, detail="Board & Train enrollment not found")
        return await _manual_closeout(db, enrollment, session_date, body, user, _trainer_policy(enrollment))

    @app.post("/api/admin/trainer-delivery/checkout-overrides/{booking_id}")
    async def trainer_delivery_checkout_override(
        booking_id: str,
        body: CheckoutOverrideIn,
        user: dict = Depends(owner_dep),
    ):
        booking = await db.bookings.find_one(
            {"id": booking_id}, {"_id": 0, "id": 1, "dog_id": 1, "service_type": 1}
        )
        if not booking:
            raise HTTPException(status_code=404, detail="Booking not found")
        row = {
            "id": str(uuid.uuid4()),
            "booking_id": booking_id,
            "dog_id": booking.get("dog_id"),
            "reason": body.reason.strip(),
            "authorized_by": user.get("id"),
            "authorized_by_name": user.get("display_name") or user.get("name") or user.get("email"),
            "created_at": _now(),
            "used_at": None,
        }
        await db.trainer_delivery_checkout_overrides.insert_one(row)
        return {**row, "_id": None}

    @app.get("/api/admin/trainer-delivery/compliance")
    async def trainer_delivery_compliance(user: dict = Depends(trainer_dep)):
        clock = await _business_clock(db)
        today = clock.date().isoformat()
        residents = await _board_train_residents(db, clock)
        dogs = []
        required = completed = excused = open_closeouts = 0
        for resident in residents:
            enrollment = resident["enrollment"]
            policy = _trainer_policy(enrollment)
            states = await _required_slot_state(db, enrollment.get("id"), today, policy)
            closeout = await db.trainer_delivery_day_closeouts.find_one(
                {"enrollment_id": enrollment.get("id"), "session_date": today}, {"_id": 0, "id": 1}
            )
            required += len(states)
            completed += sum(1 for state in states.values() if state.get("status") == "completed")
            excused += sum(1 for state in states.values() if state.get("status") == "excused")
            if policy.get("daily_closeout_required") and not closeout:
                open_closeouts += 1
            dogs.append({
                "dog_id": resident["dog"].get("id"),
                "dog_name": resident["dog"].get("name"),
                "program_name": (enrollment.get("program_snapshot") or {}).get("name") or resident["program"].get("name"),
                "day_number": resident["day_number"],
                "total_days": resident["total_days"],
                "slots": {slot: state.get("status") for slot, state in states.items()},
                "closeout_complete": bool(closeout),
            })
        return {
            "date": today,
            "board_train_dogs": len(residents),
            "required_sessions": required,
            "completed_sessions": completed,
            "excused_sessions": excused,
            "remaining_sessions": max(0, required - completed - excused),
            "open_daily_closeouts": open_closeouts,
            "dogs": dogs,
        }

    server_module._trainer_delivery_installed = True
    server_module._trainer_delivery_validate = validate_trainer_session
    server_module._trainer_delivery_policy = _trainer_policy
