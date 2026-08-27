"""Today roster query for the Training domain.

Extracted from server.py in Phase 4 without changing its API response shape.
"""
from __future__ import annotations

from typing import Dict, List

from . import services as training_services

async def build_training_today(
    *, db, user: dict, business_today,
    staff_school_delivery_channels, school_delivery_channels,
    check_enrollment_module_readiness, enrollment_summary, effective_lessons,
    recommended_focus, booking_training_assignment_for_day,
):
    """One row per today's training booking — appointment time, dog,
    program, current module/lesson, recommended focus, homework completion,
    media awaiting review, an unanswered client question if any, session
    status (not_checked_in / plan_ready / in_progress / completed /
    resolution_needed), the real trainer assignment, and the last trainer who
    worked the dog for historical context. Batches
    homework/media lookups across all of today's dogs in one query each —
    no per-row fan-out.

    UI Phase 5 — dog_photo/client_name/reopen_count/draft_created_at/
    needs_reassessment_count/homework_difficulty_flags are additive: each is
    either already stored (dog photo, client name, draft reopen_count/
    created_at, goal_progress.needs_reassessment) or computed from a cursor
    this endpoint already iterates (the homework field_values loop below) —
    no new queries beyond one batched client-name lookup, no new storage."""
    today = business_today().isoformat()
    bookings = await db.bookings.find(
        {
            "service_type": "training",
            "status": {"$in": ["approved", "pending", "completed"]},
            "$or": [
                {"date": today},
                {"date": {"$lte": today}, "end_date": {"$gte": today}},
            ],
        },
        {"_id": 0},
    ).sort("time", 1).to_list(500)
    if not bookings:
        return []

    dog_ids = list({b["dog_id"] for b in bookings if b.get("dog_id")})
    dogs_by_id = {d["id"]: d for d in await db.dogs.find({"id": {"$in": dog_ids}}, {"_id": 0, "id": 1, "name": 1, "photo": 1, "owner_id": 1}).to_list(500)}
    owner_ids = list({d["owner_id"] for d in dogs_by_id.values() if d.get("owner_id")})
    client_name_by_id = {c["id"]: c.get("name") for c in await db.clients.find({"id": {"$in": owner_ids}}, {"_id": 0, "id": 1, "name": 1}).to_list(500)}
    # Online School hardening audit — this trainer dashboard resolves
    # bookings' trainer-led progress; excluding online_school prevents a
    # dog's simultaneous self-guided enrollment from falsely triggering
    # this row's "multiple active enrollments" state.
    active_enrs = await db.dog_programs.find(
        {"dog_id": {"$in": dog_ids}, "status": "active", "delivery_channel": {"$in": list(staff_school_delivery_channels)}}, {"_id": 0}
    ).to_list(500)
    # Retired legacy rows are intentionally NOT current training. Keep a
    # batched lookup only so Today's roster can tell Admin exactly why a dog
    # is blocked instead of incorrectly saying "no active training program."
    active_legacy_enrs = await db.dog_programs.find(
        {"dog_id": {"$in": dog_ids}, "status": "active",
         "delivery_channel": {"$nin": list(school_delivery_channels)}},
        {"_id": 0, "id": 1, "dog_id": 1, "program_id": 1, "program_snapshot.name": 1},
    ).to_list(500)
    legacy_by_dog: Dict[str, List[dict]] = {}
    for e in active_legacy_enrs:
        legacy_by_dog.setdefault(e["dog_id"], []).append(e)
    enrs_by_dog: Dict[str, List[dict]] = {}
    for e in active_enrs:
        enrs_by_dog.setdefault(e["dog_id"], []).append(e)
    enr_ids = [e["id"] for e in active_enrs]

    drafts_today = await db.training_session_drafts.find(
        {"enrollment_id": {"$in": enr_ids}, "occurrence_date": today}, {"_id": 0},
    ).to_list(500)
    draft_by_enr: Dict[str, dict] = {d["enrollment_id"]: d for d in drafts_today}

    # One batched homework query for every dog on today's roster, instead of
    # a query per row.
    homework_by_dog: Dict[str, List[dict]] = {}
    async for hw in db.homework.find({"dog_id": {"$in": dog_ids}, "status": {"$ne": "completed"}}, {"_id": 0}):
        homework_by_dog.setdefault(hw["dog_id"], []).append(hw)

    # Last trainer to touch this enrollment is historical context only. Daily
    # ownership now comes from the real date-scoped booking assignment below.
    last_logs = await db.training_session_log.find(
        {"enrollment_id": {"$in": enr_ids}}, {"_id": 0, "enrollment_id": 1, "by_user": 1, "at": 1},
    ).sort("at", -1).to_list(1000)
    last_trainer_by_enr: Dict[str, str] = {}
    for log in last_logs:
        last_trainer_by_enr.setdefault(log["enrollment_id"], log.get("by_user"))

    # Real assignment identity: today's booking assignment wins, then the
    # School/program-level assigned trainer is the fallback.  This replaces
    # the old "last person who touched the dog" proxy.
    daily_assignment_by_booking = {
        b["id"]: booking_training_assignment_for_day(b, today) for b in bookings
    }
    trainer_ids = {
        a.get("assigned_trainer_id") for a in daily_assignment_by_booking.values() if a.get("assigned_trainer_id")
    }
    trainer_ids.update(e.get("assigned_trainer_id") for e in active_enrs if e.get("assigned_trainer_id"))
    trainer_by_id = {}
    if trainer_ids:
        trainer_rows = await db.users.find(
            {"id": {"$in": list(trainer_ids)}, "active": {"$ne": False}},
            {"_id": 0, "id": 1, "name": 1, "display_name": 1, "email": 1},
        ).to_list(500)
        trainer_by_id = {u["id"]: (u.get("display_name") or u.get("name") or u.get("email") or "Trainer") for u in trainer_rows}

    rows = []
    for b in bookings:
        dog = dogs_by_id.get(b.get("dog_id")) or {}
        row = {
            "booking_id": b["id"], "time": b.get("time") or "", "dog_id": b.get("dog_id"),
            "dog_name": dog.get("name") or b.get("dog_name") or "",
            "dog_photo": dog.get("photo") or "",
            "client_name": client_name_by_id.get(dog.get("owner_id")) or "",
            "checked_in": bool(b.get("checked_in_at")),
            "assigned_trainer_id": (daily_assignment_by_booking.get(b["id"]) or {}).get("assigned_trainer_id"),
            "assigned_trainer": trainer_by_id.get((daily_assignment_by_booking.get(b["id"]) or {}).get("assigned_trainer_id")),
            "assignment_source": "daily" if (daily_assignment_by_booking.get(b["id"]) or {}).get("assigned_trainer_id") else "unassigned",
            "residential_training": bool(b.get("end_date") and str(b.get("end_date"))[:10] > str(b.get("date") or "")[:10]),
        }
        enrs = enrs_by_dog.get(b.get("dog_id")) or []
        if not enrs:
            legacy_rows = legacy_by_dog.get(b.get("dog_id")) or []
            if legacy_rows:
                legacy = legacy_rows[0]
                row.update({
                    "session_status": "resolution_needed",
                    "resolution_reason": "legacy_curriculum_requires_migration",
                    "legacy_enrollment_id": legacy.get("id"),
                    "legacy_program_id": legacy.get("program_id"),
                    "legacy_program_name": (legacy.get("program_snapshot") or {}).get("name") or "Retired legacy training",
                })
            else:
                row.update({"session_status": "resolution_needed", "resolution_reason": "no_active_enrollment"})
            rows.append(row)
            continue
        if len(enrs) > 1:
            row.update({"session_status": "resolution_needed", "resolution_reason": "multiple_active_enrollments"})
            rows.append(row)
            continue
        enr = enrs[0]
        readiness = check_enrollment_module_readiness(enr)
        if not readiness["ok"]:
            row.update({"session_status": "resolution_needed", "resolution_reason": readiness["reason"]})
            rows.append(row)
            continue

        summary = enrollment_summary(enr)
        cur_module = summary.get("current_module") or {}
        cur_lesson = None
        if enr.get("current_lesson_id"):
            for l in effective_lessons(cur_module):
                if l.get("id") == enr["current_lesson_id"]:
                    cur_lesson = l.get("name")
                    break

        draft = draft_by_enr.get(enr["id"])
        if not b.get("checked_in_at") and not draft:
            status = "not_checked_in"
        elif draft and draft.get("status") == "completed":
            status = "completed"
        elif draft and any(v for v in (draft.get("actuals") or {}).values()):
            status = "in_progress"
        elif draft:
            status = "plan_ready"
        else:
            status = "not_checked_in"

        hw_rows = homework_by_dog.get(b.get("dog_id")) or []
        hw_total_days = sum(int(h.get("total_days") or 0) for h in hw_rows if h.get("daily_tracker"))
        hw_completed_days = sum(
            sum(1 for l in (h.get("section_logs") or []) if l.get("submission_status") in ("submitted", "approved"))
            for h in hw_rows if h.get("daily_tracker")
        )
        media_awaiting = 0
        client_question = None
        difficulty_flags = 0
        for h in hw_rows:
            for l in (h.get("section_logs") or []):
                fv = l.get("field_values") or {}
                if fv.get("__video_id") or fv.get("__photo"):
                    media_awaiting += 1
                # UI Phase 5 — same __difficulty/__could_not_complete keys
                # GET /admin/homework/pending-reviews already surfaces per-day
                # to the homework review queue; here just counted (not the
                # per-day detail) for the trainer attention queue.
                if fv.get("__difficulty") in ("hard", "very_hard") or fv.get("__could_not_complete"):
                    difficulty_flags += 1
                for q in (l.get("questions") or []):
                    if not q.get("answer") and not client_question:
                        client_question = q.get("text")

        goal_progress = enr.get("goal_progress") or {}
        needs_reassessment_count = sum(
            1 for g in (cur_module.get("goals") or []) if (goal_progress.get(g.get("id")) or {}).get("needs_reassessment")
        )

        row.update({
            "program_name": (enr.get("program_snapshot") or {}).get("name"),
            "current_module_name": cur_module.get("name"),
            "current_lesson_name": cur_lesson,
            "recommended_focus": recommended_focus(enr),
            "homework_completion": {"days_completed": hw_completed_days, "total_days": hw_total_days} if hw_total_days else None,
            "media_awaiting_review": media_awaiting,
            "client_question": client_question,
            "homework_difficulty_flags": difficulty_flags,
            "needs_reassessment_count": needs_reassessment_count,
            "session_status": status,
            "resolution_reason": None,
            "assigned_trainer_id": (daily_assignment_by_booking.get(b["id"]) or {}).get("assigned_trainer_id") or enr.get("assigned_trainer_id"),
            "assigned_trainer": trainer_by_id.get((daily_assignment_by_booking.get(b["id"]) or {}).get("assigned_trainer_id") or enr.get("assigned_trainer_id")),
            "assignment_source": "daily" if (daily_assignment_by_booking.get(b["id"]) or {}).get("assigned_trainer_id") else ("program" if enr.get("assigned_trainer_id") else "unassigned"),
            "last_trainer": last_trainer_by_enr.get(enr["id"]) or b.get("checked_in_by_name"),
            "viewer_is_admin": user.get("role") == "admin",
            "enrollment_id": enr["id"],
            "draft_id": (draft or {}).get("id"),
            "reopen_count": (draft or {}).get("reopen_count") or 0,
            "draft_created_at": (draft or {}).get("created_at"),
        })
        rows.append(row)
    return await training_services.enrich_training_today_rows(db=db, rows=rows, business_day=today)
