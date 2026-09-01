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


class TestimonialFeatureIn(BaseModel):
    featured: bool


def _first_name(full_name: Optional[str]) -> str:
    return (_clean(full_name).split() or ["A Sit Happens client"])[0]


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


def register_school_experience_feedback(*, api, db, get_current_user, manage_feedback_dep) -> None:
    """Register School experience-feedback routes on the canonical API router."""

    @api.get("/portal/school/{sid}/experience-feedback")
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

    @api.put("/portal/school/{sid}/experience-feedback")
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

    @api.get("/admin/school/experience-feedback")
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

    @api.put("/admin/school/experience-feedback/{feedback_id}/feature")
    async def feature_testimonial(
        feedback_id: str, body: TestimonialFeatureIn, user: dict = Depends(manage_feedback_dep),
    ):
        """Online School storefront — hand-pick which permission-granted
        reviews appear publicly. Featuring is an explicit admin act; nothing
        publishes automatically, and only rows whose client ticked the
        testimonial-permission box can be featured at all."""
        row = await db.school_experience_feedback.find_one({"_id": feedback_id}, {"_id": 0})
        if not row:
            raise HTTPException(status_code=404, detail="Feedback not found")
        if body.featured and not row.get("testimonial_permission"):
            raise HTTPException(status_code=422, detail="This client has not given testimonial permission.")
        await db.school_experience_feedback.update_one(
            {"_id": feedback_id},
            {"$set": {
                "storefront_featured": bool(body.featured),
                "storefront_featured_at": _now() if body.featured else None,
                "storefront_featured_by": user.get("id") if body.featured else None,
            }},
        )
        return {"ok": True, "featured": bool(body.featured)}

    @api.get("/public/school/storefront")
    async def public_school_storefront():
        """Online School storefront aggregates — no auth, because the same
        payload feeds the guest storefront and the client Shop. Everything is
        either an aggregate (counts, average stars) or content an admin
        explicitly featured AND the client explicitly permitted; a client
        re-saving their review without the permission box unpublishes the
        quote immediately because BOTH flags are required here, whether or
        not the featured flag was ever cleared. Only first name + dog +
        program are exposed — never emails, ids, or free-text 'improve'
        feedback."""
        dogs_trained = len(await db.school_enrollments.distinct("dog_id"))

        rating_rows = await db.school_experience_feedback.find(
            {}, {"_id": 0, "overall_rating": 1, "program_id": 1},
        ).to_list(10000)
        rated = [r for r in rating_rows if r.get("overall_rating")]
        rating_count = len(rated)
        average_rating = round(sum(r["overall_rating"] for r in rated) / rating_count, 1) if rating_count else None
        program_ratings: dict = {}
        for r in rated:
            pid = r.get("program_id")
            if not pid:
                continue
            slot = program_ratings.setdefault(pid, {"count": 0, "total": 0})
            slot["count"] += 1
            slot["total"] += r["overall_rating"]
        program_ratings = {
            pid: {"count": s["count"], "average": round(s["total"] / s["count"], 1)}
            for pid, s in program_ratings.items()
        }

        featured = await db.school_experience_feedback.find(
            {"testimonial_permission": True, "storefront_featured": True},
            {"_id": 0, "id": 1, "liked_most": 1, "client_name": 1, "dog_name": 1,
             "program_name": 1, "overall_rating": 1, "storefront_featured_at": 1},
        ).sort("storefront_featured_at", DESCENDING).to_list(12)
        testimonials = [
            {
                "id": row.get("id"),
                "quote": _clean(row.get("liked_most")),
                "client_first_name": _first_name(row.get("client_name")),
                "dog_name": row.get("dog_name") or "",
                "program_name": row.get("program_name") or "",
                "rating": row.get("overall_rating"),
            }
            for row in featured if _clean(row.get("liked_most"))
        ]
        return {
            "stats": {
                "dogs_trained": dogs_trained,
                "average_rating": average_rating,
                "rating_count": rating_count,
            },
            "program_ratings": program_ratings,
            "testimonials": testimonials,
        }



def install_school_experience_feedback(*, server_module, db) -> None:
    """Legacy compatibility shim for older tests/extensions.

    Production no longer calls this post-import installer; Phase 4 registers
    the same routes explicitly through the School domain bootstrap.
    """
    if getattr(server_module, "_school_experience_feedback_installed", False):
        return
    register_school_experience_feedback(
        api=server_module.api,
        db=db,
        get_current_user=server_module.get_current_user,
        manage_feedback_dep=server_module.require_admin_and_permission("manage_training_content"),
    )
    server_module._school_experience_feedback_installed = True
