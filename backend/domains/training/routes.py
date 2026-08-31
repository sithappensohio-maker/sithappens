"""Training-domain route registration.

URLs intentionally stay identical to the pre-modernization API.  Only route
ownership moves out of server.py/School wrapper code.
"""
from __future__ import annotations

from typing import List

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field

from .services import board_train_daily_status_payload, require_program_graduation_authority
from .today import build_training_today
from trainer_delivery_enforcement import is_board_train_booking


class ManualInPersonProgressIn(BaseModel):
    target_lesson_id: str = Field(min_length=1, max_length=200)
    reason: str = Field(min_length=2, max_length=1000)
    mastered_lesson_ids: List[str] = Field(default_factory=list)


class EnrollmentReopenIn(BaseModel):
    reason: str = Field(min_length=3, max_length=300)


def _ordered_lessons(enrollment: dict) -> list[dict]:
    rows = []
    snapshot = enrollment.get("program_snapshot") or {}
    modules = sorted(snapshot.get("modules") or [], key=lambda m: (m.get("order", 0), m.get("name") or ""))
    for module in modules:
        lessons = sorted(
            [lesson for lesson in (module.get("lessons") or []) if lesson.get("active", True)],
            key=lambda lesson: (lesson.get("order", 0), lesson.get("name") or ""),
        )
        for lesson in lessons:
            rows.append({"module": module, "lesson": lesson})
    return rows


def register_training_routes(
    *, api, db, get_current_user, perms_for, manage_sessions_dep, business_today, gid, now_iso,
    staff_school_delivery_channels, school_delivery_channels,
    check_enrollment_module_readiness, enrollment_summary, effective_lessons,
    recommended_focus, booking_training_assignment_for_day,
):
    @api.post("/training/enrollments/{enrollment_id}/reopen-program")
    async def reopen_training_program(
        enrollment_id: str, body: EnrollmentReopenIn, user: dict = Depends(manage_sessions_dep)
    ):
        """Un-graduate a completed enrollment — explicit and audited.

        Exists because graduation used to happen as a silent side effect of
        "advance_next" on the final lesson (fixed 2026-08-30), which
        unenrolled dogs mid-Board&Train. Reopening restores status=active and
        puts the pointer back on the final lesson of the current (or last)
        module so the trainer can keep logging sessions until an explicit
        graduation. Every reopen is appended to program_reopen_history —
        who, when, why.
        """
        enrollment = await db.dog_programs.find_one({"id": enrollment_id}, {"_id": 0})
        if not enrollment:
            raise HTTPException(status_code=404, detail="Enrollment not found")
        if enrollment.get("status") != "completed":
            raise HTTPException(status_code=409, detail="Only a completed program can be reopened.")
        require_program_graduation_authority(user, enrollment, perms_for)
        modules_sorted = sorted(
            (enrollment.get("program_snapshot", {}).get("modules") or []),
            key=lambda m: (m.get("order", 0), m.get("name") or ""),
        )
        target_module = next(
            (m for m in modules_sorted if m.get("id") == enrollment.get("current_module_id")),
            modules_sorted[-1] if modules_sorted else None,
        )
        lessons = sorted(effective_lessons(target_module or {}), key=lambda l: l.get("order", 0))
        restored_lesson_id = enrollment.get("current_lesson_id") or (lessons[-1].get("id") if lessons else None)
        reopen_event = {
            "id": gid(), "at": now_iso(),
            "by": user.get("id"), "by_name": user.get("name") or user.get("email") or "",
            "reason": body.reason.strip(),
            "prior_completed_at": enrollment.get("completed_at"),
        }
        await db.dog_programs.update_one(
            {"id": enrollment_id, "status": "completed"},
            {"$set": {
                "status": "active", "completed_at": None,
                "current_module_id": (target_module or {}).get("id"),
                "current_lesson_id": restored_lesson_id,
            },
             "$push": {"program_reopen_history": reopen_event}},
        )
        # Best-effort: an Online School companion row that completed alongside
        # the enrollment reopens with it so School surfaces agree.
        try:
            await db.school_enrollments.update_one(
                {"enrollment_id": enrollment_id, "status": "completed"},
                {"$set": {"status": "active", "completed_at": None}},
            )
        except Exception:
            pass
        # Restore the run-sheet/front-desk "active program" pointer if the dog
        # lost it when this enrollment was (wrongly) completed.
        try:
            dog = await db.dogs.find_one({"id": enrollment.get("dog_id")}, {"_id": 0, "active_program_id": 1})
            if dog is not None and not dog.get("active_program_id"):
                await db.dogs.update_one({"id": enrollment["dog_id"]}, {"$set": {"active_program_id": enrollment_id}})
        except Exception:
            pass
        fresh = await db.dog_programs.find_one({"id": enrollment_id}, {"_id": 0})
        return {"ok": True, "enrollment": fresh, "reopen_event": reopen_event}
    def _require_manual_progress_permission(user: dict) -> None:
        if user.get("role") == "admin":
            return
        try:
            if perms_for(user).get("manage_training_sessions"):
                return
        except Exception:
            pass
        raise HTTPException(status_code=403, detail="Training-session permission required")

    async def _progress_context(enrollment_id: str, user: dict):
        _require_manual_progress_permission(user)
        enrollment = await db.dog_programs.find_one(
            {"id": enrollment_id, "delivery_channel": "in_person_school"}, {"_id": 0}
        )
        if not enrollment:
            existing = await db.dog_programs.find_one({"id": enrollment_id}, {"_id": 0, "delivery_channel": 1})
            if existing:
                raise HTTPException(
                    status_code=409,
                    detail="Manual trainer progression is available only for In-Person School. Online and Hybrid progression stay gated.",
                )
            raise HTTPException(status_code=404, detail="In-Person School enrollment not found")
        if (enrollment.get("status") or "active") != "active":
            raise HTTPException(status_code=409, detail="Only an active In-Person School enrollment can be moved ahead.")
        rows = _ordered_lessons(enrollment)
        if not rows:
            raise HTTPException(status_code=422, detail="This School program has no explicit lessons to move through.")
        current_lesson_id = enrollment.get("current_lesson_id")
        current_index = next((i for i, row in enumerate(rows) if row["lesson"].get("id") == current_lesson_id), None)
        if current_index is None:
            raise HTTPException(
                status_code=409,
                detail="The dog's current In-Person lesson needs Admin resolution before it can be moved.",
            )
        return enrollment, rows, current_index

    @api.get("/admin/training/today")
    async def admin_training_today(user: dict = Depends(manage_sessions_dep)):
        return await build_training_today(
            db=db, user=user, business_today=business_today,
            staff_school_delivery_channels=staff_school_delivery_channels,
            school_delivery_channels=school_delivery_channels,
            check_enrollment_module_readiness=check_enrollment_module_readiness,
            enrollment_summary=enrollment_summary, effective_lessons=effective_lessons,
            recommended_focus=recommended_focus,
            booking_training_assignment_for_day=booking_training_assignment_for_day,
        )

    @api.get("/training/enrollments/{enrollment_id}/manual-progress")
    async def manual_progress_options(enrollment_id: str, user: dict = Depends(get_current_user)):
        _, rows, current_index = await _progress_context(enrollment_id, user)
        current = rows[current_index]
        return {
            "allowed": True, "enrollment_id": enrollment_id,
            "current_lesson_id": current["lesson"].get("id"),
            "current_lesson_name": current["lesson"].get("name") or "Lesson",
            "current_module_id": current["module"].get("id"),
            "current_module_name": current["module"].get("name") or "Module",
            "future_lessons": [
                {"id": row["lesson"].get("id"), "name": row["lesson"].get("name") or "Lesson",
                 "module_id": row["module"].get("id"), "module_name": row["module"].get("name") or "Module"}
                for row in rows[current_index + 1:]
            ],
        }

    @api.post("/training/enrollments/{enrollment_id}/manual-progress")
    async def manual_progress_move(
        enrollment_id: str, body: ManualInPersonProgressIn, user: dict = Depends(get_current_user)
    ):
        enrollment, rows, current_index = await _progress_context(enrollment_id, user)
        target_index = next((i for i, row in enumerate(rows) if row["lesson"].get("id") == body.target_lesson_id), None)
        if target_index is None or target_index <= current_index:
            raise HTTPException(status_code=422, detail="Choose a lesson later than the dog's current In-Person lesson.")
        passed_rows = rows[current_index:target_index]
        passed_ids = {row["lesson"].get("id") for row in passed_rows}
        mastered_ids = set(body.mastered_lesson_ids or [])
        if mastered_ids - passed_ids:
            raise HTTPException(status_code=422, detail="Only lessons being passed over can be marked mastered during this move.")

        now = now_iso()
        actor_name = user.get("display_name") or user.get("name") or user.get("email") or user.get("id")
        overrides = dict(enrollment.get("lesson_progress_overrides") or {})
        goal_progress = {k: dict(v) for k, v in (enrollment.get("goal_progress") or {}).items()}
        dispositions = []
        for offset, row in enumerate(passed_rows):
            lesson = row["lesson"]
            lesson_id = lesson.get("id")
            status = "mastered" if lesson_id in mastered_ids else ("advanced" if offset == 0 else "skipped")
            record = {
                "lesson_id": lesson_id, "lesson_name": lesson.get("name") or "Lesson",
                "module_id": row["module"].get("id"), "module_name": row["module"].get("name") or "Module",
                "status": status, "reason": body.reason.strip(), "at": now,
                "by": user.get("id"), "by_name": actor_name,
            }
            overrides[lesson_id] = record
            dispositions.append(record)
            if status == "mastered":
                for skill_id in lesson.get("skill_ids") or []:
                    if skill_id not in goal_progress:
                        continue
                    progress = dict(goal_progress.get(skill_id) or {})
                    progress["status"] = "mastered"
                    progress["score"] = max(int(progress.get("score") or 0), 4)
                    progress["last_session_at"] = now
                    goal_progress[skill_id] = progress

        target = rows[target_index]
        history = {
            "id": gid(), "at": now, "by": user.get("id"), "by_name": actor_name, "reason": body.reason.strip(),
            "from_module_id": rows[current_index]["module"].get("id"),
            "from_lesson_id": rows[current_index]["lesson"].get("id"),
            "to_module_id": target["module"].get("id"), "to_lesson_id": target["lesson"].get("id"),
            "lesson_dispositions": dispositions,
        }
        result = await db.dog_programs.update_one(
            {"id": enrollment_id, "delivery_channel": "in_person_school", "status": "active",
             "current_module_id": rows[current_index]["module"].get("id"),
             "current_lesson_id": rows[current_index]["lesson"].get("id")},
            {"$set": {"current_module_id": target["module"].get("id"),
                      "current_lesson_id": target["lesson"].get("id"),
                      "lesson_progress_overrides": overrides, "goal_progress": goal_progress,
                      "school_updated_at": now, "school_updated_by": user.get("id")},
             "$push": {"manual_progress_history": history}},
        )
        if not result.modified_count:
            raise HTTPException(status_code=409, detail="The dog's current lesson changed while you were moving it. Refresh and try again.")
        return {
            "ok": True, "enrollment_id": enrollment_id,
            "current_module_id": target["module"].get("id"), "current_module_name": target["module"].get("name") or "Module",
            "current_lesson_id": target["lesson"].get("id"), "current_lesson_name": target["lesson"].get("name") or "Lesson",
            "lesson_dispositions": dispositions,
        }

    @api.get("/admin/training/board-and-train/{booking_id}/daily-status")
    async def board_train_daily_status(booking_id: str, _: dict = Depends(manage_sessions_dep)):
        booking = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
        if not booking:
            raise HTTPException(status_code=404, detail="Booking not found")
        if not await is_board_train_booking(db, booking):
            raise HTTPException(status_code=422, detail="Booking is not a Board & Train residential program")
        return await board_train_daily_status_payload(db=db, booking=booking, business_day=business_today().isoformat())
