"""Client experience feedback for Sit Happens School.

Trainer/checkpoint feedback is coaching TO the client. This module records the
client's feedback ABOUT the Online School/course experience.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal, Optional
import uuid

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel, Field
from pymongo import DESCENDING, ReturnDocument


SCHOOL_CHANNELS = ("online_school", "in_person_school", "hybrid_school")
ONLINE_EXPERIENCE_MODES = ("self_guided", "hybrid")
ONLINE_EXPERIENCE_CHANNELS = ("online_school", "hybrid_school")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean(value: Optional[str]) -> str:
    return (value or "").strip()


class SchoolExperienceFeedbackIn(BaseModel):
    overall_rating: int = Field(ge=1, le=5)
    lesson_ease: Literal["very_easy", "easy", "okay", "difficult", "very_difficult"]
    making_progress: Literal["yes", "somewhat", "not_yet"]
    liked_most: str = Field(default="", max_length=5000)
    improve: str = Field(default="", max_length=5000)
    recommend: Literal["yes", "maybe", "no"]
    testimonial_permission: bool = False
    source: Literal["feedback_screen", "course_completion"] = "feedback_screen"


def _feedback_id(client_id: str, dog_id: str, program_id: str) -> str:
    return f"school-experience:{client_id}:{dog_id}:{program_id}"


def _experience_eligible(se: dict, dp: dict) -> bool:
    return (
        se.get("delivery_mode") in ONLINE_EXPERIENCE_MODES
        or dp.get("delivery_channel") in ONLINE_EXPERIENCE_CHANNELS
    )


async def _client_context(db, sid: str, user: dict):
    if user.get("role") != "client" or not user.get("client_id"):
        raise HTTPException(status_code=403, detail="Client account required")
    se = await db.school_enrollments.find_one(
        {"id": sid, "client_id": user.get("client_id")}, {"_id": 0}
    )
    if not se:
        raise HTTPException(status_code=404, detail="School enrollment not found")
    dp = await db.dog_programs.find_one(
        {"id": se.get("enrollment_id"), "delivery_channel": {"$in": list(SCHOOL_CHANNELS)}},
        {"_id": 0},
    )
    if not dp:
        raise HTTPException(status_code=404, detail="School enrollment not found")
    return se, dp


async def _identity_snapshot(db, se: dict, dp: dict) -> dict:
    client = await db.clients.find_one(
        {"id": se.get("client_id")}, {"_id": 0, "id": 1, "name": 1, "email": 1}
    ) or {}
    dog = await db.dogs.find_one(
        {"id": se.get("dog_id")}, {"_id": 0, "id": 1, "name": 1}
    ) or {}
    snap = dp.get("program_snapshot") or {}
    return {
        "client_id": se.get("client_id"),
        "client_name": client.get("name") or "Client",
        "client_email": client.get("email"),
        "dog_id": se.get("dog_id"),
        "dog_name": dog.get("name") or "Dog",
        "program_id": se.get("program_id") or dp.get("program_id"),
        "program_name": snap.get("name") or se.get("program_name") or "School program",
    }


def install_school_experience_feedback(*, server_module, db) -> None:
    """Install the School experience-feedback API exactly once per worker."""
    if getattr(server_module, "_school_experience_feedback_installed", False):
        return

    app = server_module.app
    get_current_user = server_module.get_current_user

    permission_factory = getattr(server_module, "require_admin_and_permission", None)
    manage_feedback_dep = (
        permission_factory("manage_training_content")
        if callable(permission_factory)
        else server_module.require_admin
    )

    @app.get("/api/portal/school/{sid}/experience-feedback")
    async def get_experience_feedback(sid: str, user: dict = Depends(get_current_user)):
        se, dp = await _client_context(db, sid, user)
        ident = await _identity_snapshot(db, se, dp)
        if not ident.get("program_id"):
            raise HTTPException(status_code=422, detail="This School enrollment has no program identity")
        eligible = _experience_eligible(se, dp)
        rid = _feedback_id(ident["client_id"], ident["dog_id"], ident["program_id"])
        row = await db.school_experience_feedback.find_one({"_id": rid}, {"_id": 0}) if eligible else None
        return {
            "feedback": row,
            "course": {
                "school_enrollment_id": sid,
                "program_id": ident["program_id"],
                "program_name": ident["program_name"],
                "dog_id": ident["dog_id"],
                "dog_name": ident["dog_name"],
                "delivery_mode": se.get("delivery_mode"),
                "status": dp.get("status") or se.get("status") or "active",
                "completed": (dp.get("status") or se.get("status")) == "completed",
                "experience_feedback_eligible": eligible,
            },
        }

    @app.put("/api/portal/school/{sid}/experience-feedback")
    async def save_experience_feedback(
        sid: str, body: SchoolExperienceFeedbackIn, user: dict = Depends(get_current_user)
    ):
        se, dp = await _client_context(db, sid, user)
        if not _experience_eligible(se, dp):
            raise HTTPException(status_code=422, detail="Experience feedback is available for Online School and hybrid courses")
        ident = await _identity_snapshot(db, se, dp)
        if not ident.get("program_id"):
            raise HTTPException(status_code=422, detail="This School enrollment has no program identity")

        now = _now()
        rid = _feedback_id(ident["client_id"], ident["dog_id"], ident["program_id"])
        status = dp.get("status") or se.get("status") or "active"
        payload = {
            "id": rid,
            **ident,
            "school_enrollment_id": sid,
            "enrollment_id": dp.get("id"),
            "delivery_mode": se.get("delivery_mode"),
            "course_status_at_submission": status,
            "course_completed_at_submission": status == "completed",
            "overall_rating": body.overall_rating,
            "lesson_ease": body.lesson_ease,
            "making_progress": body.making_progress,
            "liked_most": _clean(body.liked_most),
            "improve": _clean(body.improve),
            "recommend": body.recommend,
            "testimonial_permission": bool(body.testimonial_permission),
            "source": body.source,
            "updated_at": now,
            "updated_by": user.get("id"),
        }

        # The deterministic key is Mongo's real unique _id, not merely a
        # regular field. Combined with an atomic $inc this guarantees one
        # current review and monotonically increasing revisions even if a
        # client double-clicks or two saves arrive at nearly the same time.
        row = await db.school_experience_feedback.find_one_and_update(
            {"_id": rid},
            {
                "$set": payload,
                "$setOnInsert": {"created_at": now, "created_by": user.get("id")},
                "$inc": {"revision": 1},
            },
            upsert=True,
            projection={"_id": 0},
            return_document=ReturnDocument.AFTER,
        )
        revision = int((row or {}).get("revision") or 1)
        await db.school_experience_feedback_history.insert_one({
            **(row or payload),
            "id": str(uuid.uuid4()),
            "feedback_id": rid,
            "revision": revision,
            "snapshotted_at": now,
        })
        return {"feedback": row, "saved": True, "updated": revision > 1}

    @app.get("/api/admin/school/experience-feedback")
    async def admin_experience_feedback(
        program_id: Optional[str] = None,
        recommend: Optional[Literal["yes", "maybe", "no"]] = None,
        min_rating: Optional[int] = Query(default=None, ge=1, le=5),
        limit: int = Query(default=250, ge=1, le=1000),
        _: dict = Depends(manage_feedback_dep),
    ):
        q = {}
        if program_id:
            q["program_id"] = program_id
        if recommend:
            q["recommend"] = recommend
        if min_rating is not None:
            q["overall_rating"] = {"$gte": min_rating}
        rows = await db.school_experience_feedback.find(q, {"_id": 0}).sort(
            "updated_at", DESCENDING
        ).to_list(limit)

        count = len(rows)
        avg = round(sum(float(r.get("overall_rating") or 0) for r in rows) / count, 1) if count else None
        recommend_yes = sum(1 for r in rows if r.get("recommend") == "yes")
        easy = sum(1 for r in rows if r.get("lesson_ease") in ("very_easy", "easy"))
        progress = sum(1 for r in rows if r.get("making_progress") in ("yes", "somewhat"))
        testimonials = sum(1 for r in rows if r.get("testimonial_permission"))
        return {
            "summary": {
                "responses": count,
                "average_rating": avg,
                "recommend_yes_pct": round(recommend_yes * 100 / count) if count else None,
                "easy_to_follow_pct": round(easy * 100 / count) if count else None,
                "making_progress_pct": round(progress * 100 / count) if count else None,
                "testimonial_permissions": testimonials,
            },
            "items": rows,
        }

    server_module._school_experience_feedback_installed = True
