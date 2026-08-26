"""Sit Happens School suite extension wrapper.

The full verified School implementation is preserved in school_suite_base.py.
This wrapper adds trainer-controlled manual progression for pure In-Person
School enrollments only, then delegates every existing School route to the
unchanged base suite.
"""
from typing import List

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field

from school_suite_base import *  # noqa: F401,F403
from school_suite_base import register_school_suite as _register_school_suite_base


class ManualInPersonProgressIn(BaseModel):
    target_lesson_id: str = Field(min_length=1, max_length=200)
    reason: str = Field(min_length=2, max_length=1000)
    mastered_lesson_ids: List[str] = Field(default_factory=list)


def register_school_suite(*, api, db, get_current_user, manage_school_dep, perms_for, school_events,
                          persist_school_media=None, school_media_data_url=None, school_media_file_path=None,
                          require_school_access=None, checkpoint_overall_scores=None):
    _register_school_suite_base(
        api=api,
        db=db,
        get_current_user=get_current_user,
        manage_school_dep=manage_school_dep,
        perms_for=perms_for,
        school_events=school_events,
        persist_school_media=persist_school_media,
        school_media_data_url=school_media_data_url,
        school_media_file_path=school_media_file_path,
        require_school_access=require_school_access,
        checkpoint_overall_scores=checkpoint_overall_scores,
    )

    def _require_manual_progress_permission(user: dict) -> None:
        if user.get("role") == "admin":
            return
        try:
            if perms_for(user).get("manage_training_sessions"):
                return
        except Exception:
            pass
        raise HTTPException(status_code=403, detail="Training-session permission required")

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

    async def _progress_context(enrollment_id: str, user: dict):
        _require_manual_progress_permission(user)
        enrollment = await db.dog_programs.find_one(
            {"id": enrollment_id, "delivery_channel": "in_person_school"}, {"_id": 0}
        )
        if not enrollment:
            existing = await db.dog_programs.find_one(
                {"id": enrollment_id}, {"_id": 0, "delivery_channel": 1}
            )
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
        current_index = next(
            (i for i, row in enumerate(rows) if row["lesson"].get("id") == current_lesson_id), None
        )
        if current_index is None:
            raise HTTPException(
                status_code=409,
                detail="The dog's current In-Person lesson needs Admin resolution before it can be moved.",
            )
        return enrollment, rows, current_index

    @api.get("/training/enrollments/{enrollment_id}/manual-progress")
    async def manual_progress_options(enrollment_id: str, user: dict = Depends(get_current_user)):
        _, rows, current_index = await _progress_context(enrollment_id, user)
        current = rows[current_index]
        return {
            "allowed": True,
            "enrollment_id": enrollment_id,
            "current_lesson_id": current["lesson"].get("id"),
            "current_lesson_name": current["lesson"].get("name") or "Lesson",
            "current_module_id": current["module"].get("id"),
            "current_module_name": current["module"].get("name") or "Module",
            "future_lessons": [
                {
                    "id": row["lesson"].get("id"),
                    "name": row["lesson"].get("name") or "Lesson",
                    "module_id": row["module"].get("id"),
                    "module_name": row["module"].get("name") or "Module",
                }
                for row in rows[current_index + 1:]
            ],
        }

    @api.post("/training/enrollments/{enrollment_id}/manual-progress")
    async def manual_progress_move(
        enrollment_id: str,
        body: ManualInPersonProgressIn,
        user: dict = Depends(get_current_user),
    ):
        enrollment, rows, current_index = await _progress_context(enrollment_id, user)
        target_index = next(
            (i for i, row in enumerate(rows) if row["lesson"].get("id") == body.target_lesson_id), None
        )
        if target_index is None or target_index <= current_index:
            raise HTTPException(
                status_code=422,
                detail="Choose a lesson later than the dog's current In-Person lesson.",
            )

        passed_rows = rows[current_index:target_index]
        passed_ids = {row["lesson"].get("id") for row in passed_rows}
        mastered_ids = set(body.mastered_lesson_ids or [])
        if mastered_ids - passed_ids:
            raise HTTPException(
                status_code=422,
                detail="Only lessons being passed over can be marked mastered during this move.",
            )

        now = _now()
        actor_name = user.get("display_name") or user.get("name") or user.get("email") or user.get("id")
        overrides = dict(enrollment.get("lesson_progress_overrides") or {})
        goal_progress = {k: dict(v) for k, v in (enrollment.get("goal_progress") or {}).items()}
        dispositions = []

        for offset, row in enumerate(passed_rows):
            lesson = row["lesson"]
            lesson_id = lesson.get("id")
            status = "mastered" if lesson_id in mastered_ids else ("advanced" if offset == 0 else "skipped")
            record = {
                "lesson_id": lesson_id,
                "lesson_name": lesson.get("name") or "Lesson",
                "module_id": row["module"].get("id"),
                "module_name": row["module"].get("name") or "Module",
                "status": status,
                "reason": body.reason.strip(),
                "at": now,
                "by": user.get("id"),
                "by_name": actor_name,
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
            "id": _gid(),
            "at": now,
            "by": user.get("id"),
            "by_name": actor_name,
            "reason": body.reason.strip(),
            "from_module_id": rows[current_index]["module"].get("id"),
            "from_lesson_id": rows[current_index]["lesson"].get("id"),
            "to_module_id": target["module"].get("id"),
            "to_lesson_id": target["lesson"].get("id"),
            "lesson_dispositions": dispositions,
        }

        result = await db.dog_programs.update_one(
            {
                "id": enrollment_id,
                "delivery_channel": "in_person_school",
                "status": "active",
                "current_module_id": rows[current_index]["module"].get("id"),
                "current_lesson_id": rows[current_index]["lesson"].get("id"),
            },
            {
                "$set": {
                    "current_module_id": target["module"].get("id"),
                    "current_lesson_id": target["lesson"].get("id"),
                    "lesson_progress_overrides": overrides,
                    "goal_progress": goal_progress,
                    "school_updated_at": now,
                    "school_updated_by": user.get("id"),
                },
                "$push": {"manual_progress_history": history},
            },
        )
        if not result.modified_count:
            raise HTTPException(
                status_code=409,
                detail="The dog's current lesson changed while you were moving it. Refresh and try again.",
            )

        return {
            "ok": True,
            "enrollment_id": enrollment_id,
            "current_module_id": target["module"].get("id"),
            "current_module_name": target["module"].get("name") or "Module",
            "current_lesson_id": target["lesson"].get("id"),
            "current_lesson_name": target["lesson"].get("name") or "Lesson",
            "lesson_dispositions": dispositions,
        }
