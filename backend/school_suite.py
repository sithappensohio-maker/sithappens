"""Sit Happens Online School — full operations/student suite.

This module is intentionally additive.  It registers the higher-level School
features that sit on top of the canonical enrollment/progression/checkpoint
systems in server.py: Student Workspace, trainer ownership, prescribed plans,
client School notifications, resources, intervention rules, onboarding/baseline,
analytics, and the permanent dog training record.

It does NOT own progression or checkpoint grading.  Those remain in server.py.
"""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Literal, Optional
from zoneinfo import ZoneInfo
import uuid

from fastapi import Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from pymongo import DESCENDING, ReturnDocument


# School is now the shared training surface for online, in-person and hybrid
# programs. Legacy Online School keeps its original channel; new staff-led
# School assignments use the two additive channels below.
SCHOOL_DELIVERY_CHANNELS = ("online_school", "in_person_school", "hybrid_school")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_iso(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except Exception:
        return None
    # Legacy rows store naive timestamps; treat them as UTC so date math
    # never mixes naive and aware datetimes (analytics 500'd on real data).
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _gid() -> str:
    return str(uuid.uuid4())


def _validate_data_upload(raw: str, *, video_only: bool = False, max_bytes: int = 100 * 1024 * 1024) -> tuple[str, int]:
    if not raw.startswith("data:") or "," not in raw:
        raise HTTPException(status_code=400, detail="Expected a file upload")
    try:
        header, b64 = raw.split(",", 1); mime = header.split(";")[0].replace("data:", "").lower().strip()
    except Exception:
        raise HTTPException(status_code=400, detail="Malformed file upload")
    allowed_video = {"video/mp4", "video/quicktime", "video/webm", "video/x-m4v", "video/3gpp"}
    allowed_resource = allowed_video | {"application/pdf", "image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic"}
    if mime not in (allowed_video if video_only else allowed_resource):
        raise HTTPException(status_code=400, detail="Unsupported file type")
    approx = (len(b64) * 3) // 4
    if approx > max_bytes:
        raise HTTPException(status_code=400, detail=f"File too large. Max is {max_bytes // (1024 * 1024)} MB.")
    return mime, approx


def _snapshot_position(enrollment: dict) -> dict:
    snap = enrollment.get("program_snapshot") or {}
    modules = sorted(snap.get("modules") or [], key=lambda m: (m.get("order", 0), m.get("name") or ""))
    lessons = []
    for m in modules:
        effective = sorted([x for x in (m.get("lessons") or []) if x.get("active", True)], key=lambda x: (x.get("order", 0), x.get("name") or ""))
        if not effective and (m.get("goals") or []):
            effective = [{"id": f"module-default:{m.get('id')}", "name": m.get("name") or "Lesson", "active": True, "order": 0}]
        for l in effective:
            lessons.append((m, l))
    cur_mid = enrollment.get("current_module_id")
    cur_lid = enrollment.get("current_lesson_id")
    status = enrollment.get("status") or "active"
    if status == "completed":
        completed = len(lessons)
    else:
        idx = next((i for i, (m, l) in enumerate(lessons) if m.get("id") == cur_mid and l.get("id") == cur_lid), 0)
        completed = idx if lessons else 0
    total = len(lessons)
    pct = 100 if status == "completed" else (round(completed * 100 / total) if total else 0)
    current_module = next((m for m in modules if m.get("id") == cur_mid), None)
    current_lesson = next((l for m, l in lessons if m.get("id") == cur_mid and l.get("id") == cur_lid), None)
    return {
        "course_pct": max(0, min(100, pct)), "lessons_completed": completed, "lessons_total": total,
        "current_module_id": cur_mid, "current_module_name": (current_module or {}).get("name"),
        "current_lesson_id": cur_lid, "current_lesson_name": (current_lesson or {}).get("name"),
    }


def _reached_school_material(enrollment: dict) -> tuple[list[str], list[str]]:
    """Return lesson/resource ids the student has actually reached.

    Program/global resources are handled separately by the caller.  This
    helper exists so a resource tied only to a locked future lesson (or a
    lesson content block) cannot leak through Library/Search/media URLs before
    progression reaches that lesson.  Completed enrollments may review all of
    their frozen curriculum.
    """
    snap = enrollment.get("program_snapshot") or {}
    flat: list[dict] = []
    for module in sorted(snap.get("modules") or [], key=lambda m: (m.get("order", 0), m.get("name") or "")):
        lessons = sorted(
            [x for x in (module.get("lessons") or []) if x.get("active", True)],
            key=lambda x: (x.get("order", 0), x.get("name") or ""),
        )
        for lesson in lessons:
            flat.append({"module_id": module.get("id"), "lesson": lesson})

    if not flat:
        return [], []
    if (enrollment.get("status") or "active") == "completed":
        reached = flat
    else:
        current_index = next(
            (
                i
                for i, row in enumerate(flat)
                if row.get("module_id") == enrollment.get("current_module_id")
                and (row.get("lesson") or {}).get("id") == enrollment.get("current_lesson_id")
            ),
            0,
        )
        reached = flat[: current_index + 1]

    lesson_ids = [
        row["lesson"].get("id")
        for row in reached
        if (row.get("lesson") or {}).get("id")
    ]
    resource_ids = [
        block.get("resource_id")
        for row in reached
        for block in ((row.get("lesson") or {}).get("content_blocks") or [])
        if block.get("resource_id")
    ]
    return lesson_ids, resource_ids


class SchoolStudentPatch(BaseModel):
    assigned_trainer_id: Optional[str] = None
    access_expires_at: Optional[str] = None
    pause_until: Optional[str] = None
    support_checkpoint_allowance: Optional[int] = Field(default=None, ge=0, le=100)
    support_assist_allowance: Optional[int] = Field(default=None, ge=0, le=100)


class SchoolNoteIn(BaseModel):
    body: str = Field(min_length=1, max_length=5000)


class PlanTaskIn(BaseModel):
    id: Optional[str] = None
    day_offset: int = Field(default=0, ge=0, le=365)
    title: str = Field(min_length=1, max_length=200)
    instructions: Optional[str] = Field(default="", max_length=5000)
    lesson_id: Optional[str] = None
    homework_id: Optional[str] = None
    estimated_minutes: Optional[int] = Field(default=None, ge=0, le=480)
    required: bool = True


class TrainingPlanIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    summary: Optional[str] = Field(default="", max_length=5000)
    starts_on: Optional[str] = None
    status: Literal["draft", "active", "completed", "cancelled"] = "active"
    tasks: List[PlanTaskIn] = Field(default_factory=list)


class RequestIn(BaseModel):
    type: Literal["video", "check_in", "questionnaire"] = "video"
    title: str = Field(min_length=1, max_length=200)
    instructions: Optional[str] = Field(default="", max_length=5000)
    lesson_id: Optional[str] = None
    due_at: Optional[str] = None


class RequestResponseIn(BaseModel):
    note: Optional[str] = Field(default="", max_length=5000)
    media_id: Optional[str] = None


class BaselineIn(BaseModel):
    goals: Optional[str] = Field(default="", max_length=5000)
    current_challenges: Optional[str] = Field(default="", max_length=5000)
    training_experience: Optional[str] = Field(default="", max_length=5000)
    equipment: Optional[str] = Field(default="", max_length=3000)
    preferred_schedule: Optional[str] = Field(default="", max_length=2000)
    baseline_note: Optional[str] = Field(default="", max_length=5000)
    baseline_media_id: Optional[str] = None


class SchoolMediaUploadIn(BaseModel):
    data: str = Field(min_length=10)
    filename: str = Field(min_length=1, max_length=180)


class SchoolSettingsIn(BaseModel):
    inactivity_days: int = Field(default=5, ge=1, le=90)
    repeated_struggle_count: int = Field(default=3, ge=1, le=20)
    repeated_difficulty_count: int = Field(default=3, ge=1, le=20)
    checkpoint_review_hours: int = Field(default=24, ge=1, le=168)
    question_response_hours: int = Field(default=24, ge=1, le=168)


class ResourceIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: Optional[str] = Field(default="", max_length=5000)
    kind: Literal["link", "file", "image", "video", "guide"] = "link"
    url: Optional[str] = None
    media_id: Optional[str] = None
    program_ids: List[str] = Field(default_factory=list)
    lesson_ids: List[str] = Field(default_factory=list)
    tags: List[str] = Field(default_factory=list)
    active: bool = True


def register_school_suite(*, api, db, get_current_user, manage_school_dep, perms_for, school_events, persist_school_media=None, school_media_data_url=None, school_media_file_path=None, require_school_access=None, checkpoint_overall_scores=None):
    def _with_overall_scores(rows: List[dict]) -> List[dict]:
        """Shape the canonical Handler/Dog overall scores onto checkpoint
        history rows. New grades carry them persisted on the submission;
        older rows resolve read-time from their own per-criterion scores via
        server.py's single resolver. Read-only — never writes, never invents
        a score where the rubric data cannot support one."""
        if not callable(checkpoint_overall_scores):
            return rows
        out = []
        for r in rows:
            overall = checkpoint_overall_scores(r)
            out.append({**r, "handler_overall": overall.get("handler"), "dog_overall": overall.get("dog")})
        return out

    async def _school_settings():
        defaults = SchoolSettingsIn().model_dump()
        row = await db.school_settings.find_one({"id": "online_school"}, {"_id": 0}) or {}
        return {**defaults, **{k: row.get(k) for k in defaults if row.get(k) is not None}}

    async def _client_context(sid: str, user: dict):
        if user.get("role") != "client" or not user.get("client_id"):
            raise HTTPException(status_code=403, detail="Client account required")
        se = await db.school_enrollments.find_one({"id": sid, "client_id": user.get("client_id")}, {"_id": 0})
        if not se:
            raise HTTPException(status_code=404, detail="Enrollment not found")
        dp = await db.dog_programs.find_one({"id": se.get("enrollment_id"), "delivery_channel": {"$in": list(SCHOOL_DELIVERY_CHANNELS)}}, {"_id": 0})
        if not dp:
            raise HTTPException(status_code=404, detail="Enrollment not found")
        return se, dp

    def _require_readable_school_content(dp: dict) -> None:
        # Reuse the canonical School lifecycle gate from server.py when it is
        # available. Withdrawn/paused students may review historical content;
        # revoked/expired access remains blocked.
        if callable(require_school_access):
            require_school_access(dp, allow_withdrawn_read=True)

    async def _client_school_material_scope(client_id: str) -> dict:
        """Build the union of School material this client may currently read.

        This is used by the media endpoint, whose URL contains only a media id
        rather than a School enrollment id. It deliberately excludes revoked
        or expired enrollments and only includes lesson-linked resources from
        curriculum the student has actually reached.
        """
        ses = await db.school_enrollments.find(
            {"client_id": client_id}, {"_id": 0, "id": 1, "program_id": 1, "enrollment_id": 1}
        ).to_list(200)
        if not ses:
            return {"school_enrollment_ids": set(), "program_ids": set(), "lesson_ids": set(), "resource_ids": set()}
        dpids = [x.get("enrollment_id") for x in ses if x.get("enrollment_id")]
        dps = await db.dog_programs.find(
            {"id": {"$in": dpids}, "delivery_channel": {"$in": list(SCHOOL_DELIVERY_CHANNELS)}},
            {"_id": 0, "id": 1, "program_snapshot": 1, "current_module_id": 1, "current_lesson_id": 1,
             "status": 1, "access_state": 1, "school_access_expires_at": 1, "school_pause_until": 1},
        ).to_list(len(dpids) or 1)
        dp_by_id = {x.get("id"): x for x in dps if x.get("id")}
        school_ids, program_ids, lesson_ids, resource_ids = set(), set(), set(), set()
        for se in ses:
            dp = dp_by_id.get(se.get("enrollment_id"))
            if not dp:
                continue
            try:
                _require_readable_school_content(dp)
            except HTTPException:
                continue
            school_ids.add(se.get("id"))
            if se.get("program_id"):
                program_ids.add(se.get("program_id"))
            lids, rids = _reached_school_material(dp)
            lesson_ids.update(lids)
            resource_ids.update(rids)
        return {
            "school_enrollment_ids": school_ids,
            "program_ids": program_ids,
            "lesson_ids": lesson_ids,
            "resource_ids": resource_ids,
        }

    async def _authorized_school_media_row(media_id: str, user: dict) -> dict:
        row = await db.homework_media.find_one({"id": media_id}, {"_id": 0})
        if not row:
            raise HTTPException(status_code=404, detail="Media not found")
        role = user.get("role")
        checkpoint = None
        if row.get("kind") == "checkpoint_video" or not row.get("school_enrollment_id"):
            checkpoint = await db.checkpoint_submissions.find_one(
                {"video_media_id": media_id}, {"_id": 0, "school_enrollment_id": 1}
            )
        is_school_media = bool(
            row.get("kind") == "school_resource"
            or row.get("school_enrollment_id")
            or checkpoint
        )
        if not is_school_media:
            # Do not let the School media endpoint become a back door into
            # unrelated generic Homework media just because a UUID is known.
            raise HTTPException(status_code=404, detail="Media not found")

        if role == "client":
            cid = user.get("client_id")
            if not cid:
                raise HTTPException(status_code=403, detail="Not allowed")
            scope = await _client_school_material_scope(cid)
            allowed = False
            if row.get("kind") == "school_resource":
                resource = await db.school_resources.find_one(
                    {"media_id": media_id, "active": {"$ne": False}},
                    {"_id": 0, "id": 1, "program_ids": 1, "lesson_ids": 1},
                )
                if resource:
                    pids = set(resource.get("program_ids") or [])
                    lids = set(resource.get("lesson_ids") or [])
                    if not pids and not lids:
                        # Global School resources still require at least one
                        # readable School enrollment — they are not public files.
                        allowed = bool(scope["school_enrollment_ids"])
                    else:
                        allowed = bool(
                            pids & scope["program_ids"]
                            or lids & scope["lesson_ids"]
                            or resource.get("id") in scope["resource_ids"]
                        )
            else:
                sid = row.get("school_enrollment_id") or (checkpoint or {}).get("school_enrollment_id")
                allowed = bool(sid and sid in scope["school_enrollment_ids"])
            if not allowed:
                raise HTTPException(status_code=403, detail="Not allowed")
        elif role in ("admin", "employee"):
            try:
                if not perms_for(user).get("manage_school"):
                    raise HTTPException(status_code=403, detail="Not allowed")
            except HTTPException:
                raise
            except Exception:
                raise HTTPException(status_code=403, detail="Not allowed")
        else:
            raise HTTPException(status_code=403, detail="Not allowed")
        return row

    async def _student_context(sid: str):
        se = await db.school_enrollments.find_one({"id": sid}, {"_id": 0})
        if not se:
            raise HTTPException(status_code=404, detail="Student not found")
        dp = await db.dog_programs.find_one({"id": se.get("enrollment_id"), "delivery_channel": {"$in": list(SCHOOL_DELIVERY_CHANNELS)}}, {"_id": 0})
        if not dp:
            raise HTTPException(status_code=404, detail="Student enrollment not found")
        return se, dp

    async def _trainer_public(trainer_id: Optional[str]):
        if not trainer_id:
            return None
        u = await db.users.find_one({"id": trainer_id, "active": {"$ne": False}}, {"_id": 0, "id": 1, "name": 1, "display_name": 1, "staff_role": 1})
        if not u:
            return None
        return {"id": u.get("id"), "name": u.get("display_name") or u.get("name"), "role": (u.get("staff_role") or "Trainer").replace("_", " ").title()}

    @api.get("/admin/school/settings")
    async def school_settings_get(_: dict = Depends(manage_school_dep)):
        return await _school_settings()

    @api.patch("/admin/school/settings")
    async def school_settings_patch(body: SchoolSettingsIn, user: dict = Depends(manage_school_dep)):
        payload = {**body.model_dump(), "updated_at": _now(), "updated_by": user.get("id")}
        await db.school_settings.update_one({"id": "online_school"}, {"$set": payload, "$setOnInsert": {"id": "online_school", "created_at": _now()}}, upsert=True)
        return await _school_settings()

    @api.get("/admin/school/trainers")
    async def school_trainers(user: dict = Depends(get_current_user)):
        caller_perms = perms_for(user)
        if not (caller_perms.get("manage_school") or caller_perms.get("manage_training_sessions")):
            raise HTTPException(status_code=403, detail="Training-session or School permission required")
        rows = await db.users.find({"role": {"$in": ["employee", "admin"]}, "active": {"$ne": False}}, {"_id": 0, "password_hash": 0}).sort("name", 1).to_list(500)
        out = []
        for u in rows:
            try:
                p = perms_for(u)
                if not (p.get("manage_school") or p.get("manage_training_sessions")):
                    continue
            except Exception:
                continue
            out.append({"id": u.get("id"), "name": u.get("display_name") or u.get("name") or u.get("email"), "staff_role": u.get("staff_role") or ("owner" if u.get("role") == "admin" else "staff")})
        return out

    @api.get("/admin/school/students")
    async def school_students(
        status: str = "all", trainer_id: Optional[str] = None, q: Optional[str] = None,
        limit: int = Query(100, ge=1, le=300), _: dict = Depends(manage_school_dep),
    ):
        sq: Dict[str, Any] = {}
        if status != "all":
            sq["status"] = status
        if trainer_id:
            sq["assigned_trainer_id"] = trainer_id
        ses = await db.school_enrollments.find(sq, {"_id": 0}).sort("enrolled_at", DESCENDING).to_list(limit)
        if not ses:
            return []
        dpids = [s.get("enrollment_id") for s in ses if s.get("enrollment_id")]
        dogids = list({s.get("dog_id") for s in ses if s.get("dog_id")})
        cids = list({s.get("client_id") for s in ses if s.get("client_id")})
        dps = {x["id"]: x for x in await db.dog_programs.find({"id": {"$in": dpids}}, {"_id": 0}).to_list(len(dpids) or 1)}
        dogs = {x["id"]: x for x in await db.dogs.find({"id": {"$in": dogids}}, {"_id": 0, "id": 1, "name": 1, "photo": 1}).to_list(1000)}
        clients = {x["id"]: x for x in await db.clients.find({"id": {"$in": cids}}, {"_id": 0, "id": 1, "name": 1, "email": 1, "phone": 1}).to_list(1000)}
        latest_events = {}
        async for row in db.school_events.aggregate([
            {"$match": {"school_enrollment_id": {"$in": [s["id"] for s in ses]}}},
            {"$sort": {"created_at": -1}}, {"$group": {"_id": "$school_enrollment_id", "created_at": {"$first": "$created_at"}}},
        ]): latest_events[row["_id"]] = row.get("created_at")
        attn = {}
        async for row in db.school_notifications.aggregate([
            {"$match": {"audience": "school_staff", "resolved_at": None, "school_enrollment_id": {"$in": [s["id"] for s in ses]}}},
            {"$group": {"_id": "$school_enrollment_id", "count": {"$sum": 1}}},
        ]): attn[row["_id"]] = row.get("count", 0)
        out = []
        needle = (q or "").strip().lower()
        for se in ses:
            dp = dps.get(se.get("enrollment_id")) or {}
            dog = dogs.get(se.get("dog_id")) or {}
            client = clients.get(se.get("client_id")) or {}
            pos = _snapshot_position(dp)
            trainer = await _trainer_public(se.get("assigned_trainer_id"))
            row = {
                "school_enrollment_id": se.get("id"), "enrollment_id": se.get("enrollment_id"), "status": dp.get("status") or se.get("status"),
                "access_state": dp.get("access_state") or se.get("access_state") or "active", "enrolled_at": se.get("enrolled_at"),
                "client": client, "dog": dog, "program_id": se.get("program_id"), "program_name": (dp.get("program_snapshot") or {}).get("name"),
                "delivery_mode": ({"self_guided": "online", "trainer_led": "in_person", "hybrid": "hybrid"}.get(se.get("delivery_mode"))
                                  or {"online_school": "online", "in_person_school": "in_person", "hybrid_school": "hybrid"}.get(dp.get("delivery_channel"))
                                  or "online"),
                "trainer": trainer, "last_activity_at": latest_events.get(se.get("id")), "attention_count": attn.get(se.get("id"), 0), **pos,
                "access_expires_at": dp.get("school_access_expires_at"), "pause_until": dp.get("school_pause_until"),
            }
            if needle and needle not in " ".join(str(x or "").lower() for x in [client.get("name"), client.get("email"), dog.get("name"), row.get("program_name")]):
                continue
            out.append(row)
        return out

    @api.get("/admin/school/students/{sid}")
    async def school_student_detail(sid: str, _: dict = Depends(manage_school_dep)):
        se, dp = await _student_context(sid)
        dog = await db.dogs.find_one({"id": se.get("dog_id")}, {"_id": 0})
        client = await db.clients.find_one({"id": se.get("client_id")}, {"_id": 0})
        events = await db.school_events.find({"school_enrollment_id": sid}, {"_id": 0}).sort("created_at", DESCENDING).limit(100).to_list(100)
        checkpoints = _with_overall_scores(await db.checkpoint_submissions.find({"school_enrollment_id": sid}, {"_id": 0, "video": 0}).sort("submitted_at", DESCENDING).to_list(100))
        plans = await db.school_training_plans.find({"school_enrollment_id": sid}, {"_id": 0}).sort("created_at", DESCENDING).to_list(100)
        notes = await db.school_student_notes.find({"school_enrollment_id": sid}, {"_id": 0}).sort("created_at", DESCENDING).to_list(100)
        requests = await db.school_requests.find({"school_enrollment_id": sid}, {"_id": 0}).sort("created_at", DESCENDING).to_list(100)
        threads = await db.client_message_threads.find({"school_enrollment_id": sid}, {"_id": 0, "messages": {"$slice": -5}}).sort("updated_at", DESCENDING).to_list(50)
        # Practice is an internal School engine now, not a parallel product.
        # Explicit ownership markers make this list safe for programs where the
        # same dog has legacy/general homework outside the current enrollment.
        practice = await db.homework.find(
            {"$or": [
                {"school_enrollment_id": sid},
                {"school_enrollment_record_id": dp.get("id")},
            ]},
            {
                "_id": 0, "id": 1, "title": 1, "status": 1, "created_at": 1,
                "completed_at": 1, "due_date": 1, "assigned_by": 1,
                "trainer_personalized_note": 1, "source_lesson_id": 1,
                "template_snapshot.template_id": 1, "template_snapshot.name": 1,
                "section_logs.id": 1,
            },
        ).sort("created_at", DESCENDING).to_list(200)
        cp_allowance = se.get("support_checkpoint_allowance") if se.get("support_checkpoint_allowance") is not None else dp.get("support_checkpoint_allowance")
        assist_allowance = se.get("support_assist_allowance") if se.get("support_assist_allowance") is not None else dp.get("support_assist_allowance")
        cp_used = sum(1 for x in checkpoints if x.get("status") == "graded")
        assist_used = sum(1 for x in checkpoints if x.get("outcome") == "trainer_assist_recommended" and x.get("trainer_assist_status") == "completed")
        # Operational context belongs in the School workspace for trainer-led
        # students too.  Session logs are scoped to this exact enrollment;
        # upcoming training bookings are dog-scoped because legacy bookings did
        # not consistently carry an enrollment id.  No booking/credit mutation
        # happens here — this is read-only context.
        session_count = await db.training_session_log.count_documents({"enrollment_id": dp.get("id")})
        session_history = await db.training_session_log.find(
            {"enrollment_id": dp.get("id")},
            {"_id": 0, "id": 1, "booking_id": 1, "at": 1, "by_user": 1,
             "session_label": 1, "session_note": 1, "client_recap_note": 1,
             "advancement_action": 1, "current_module_id_after": 1, "current_lesson_id_after": 1},
        ).sort("at", DESCENDING).limit(25).to_list(25)
        today = datetime.now(ZoneInfo("America/New_York")).date().isoformat()
        upcoming_training = await db.bookings.find(
            {"dog_id": se.get("dog_id"), "service_type": "training",
             "status": {"$in": ["pending", "approved"]}, "date": {"$gte": today}},
            {"_id": 0, "id": 1, "date": 1, "time": 1, "status": 1, "service_type": 1,
             "assigned_to": 1, "training_group": 1, "notes": 1},
        ).sort([("date", 1), ("time", 1)]).limit(10).to_list(10)
        # Permanent dog-level School record: trainers should see prior School
        # programs without opening each old enrollment one by one. Keep this
        # compact; detailed events/checkpoints above remain scoped to this
        # enrollment so operational actions never cross course boundaries.
        dog_ses = await db.school_enrollments.find(
            {"dog_id": se.get("dog_id"), "client_id": se.get("client_id")},
            {"_id": 0, "id": 1, "enrollment_id": 1, "enrolled_at": 1, "delivery_mode": 1},
        ).sort("enrolled_at", 1).to_list(100)
        dog_dpids = [x.get("enrollment_id") for x in dog_ses if x.get("enrollment_id")]
        dog_dps = {x.get("id"): x for x in await db.dog_programs.find(
            {"id": {"$in": dog_dpids}},
            {"_id": 0, "id": 1, "status": 1, "started_at": 1, "completed_at": 1, "program_snapshot.name": 1, "current_module_id": 1, "current_lesson_id": 1, "program_snapshot.modules": 1},
        ).to_list(100)}
        dog_history = []
        for old_se in dog_ses:
            old_dp = dog_dps.get(old_se.get("enrollment_id")) or {}
            dog_history.append({
                "school_enrollment_id": old_se.get("id"),
                "name": (old_dp.get("program_snapshot") or {}).get("name") or "School program",
                "delivery_mode": ({"self_guided": "online", "trainer_led": "in_person", "hybrid": "hybrid"}.get(old_se.get("delivery_mode"))
                                  or {"online_school": "online", "in_person_school": "in_person", "hybrid_school": "hybrid"}.get(old_dp.get("delivery_channel"))
                                  or "online"),
                "status": old_dp.get("status") or "active",
                "started_at": old_dp.get("started_at") or old_se.get("enrolled_at"),
                "completed_at": old_dp.get("completed_at"),
                "course_pct": _snapshot_position(old_dp).get("course_pct", 0) if old_dp else 0,
            })
        # Module Quiz summary — informational for the trainer (quizzes are
        # auto-graded; nothing here is an action queue). Grouped per module:
        # attempts, latest/best score, pass state.
        quiz_rows = await db.school_quiz_attempts.find(
            {"school_enrollment_id": sid},
            {"_id": 0, "module_id": 1, "module_name": 1, "score_percent": 1, "passed": 1,
             "submitted_at": 1, "attempt_number": 1},
        ).sort("submitted_at", 1).to_list(500)
        quiz_by_module: Dict[str, Dict[str, Any]] = {}
        for qa in quiz_rows:
            entry = quiz_by_module.setdefault(qa.get("module_id"), {
                "module_id": qa.get("module_id"), "module_name": qa.get("module_name"),
                "attempt_count": 0, "latest_score": None, "best_score": None,
                "passed": False, "passed_at": None,
            })
            entry["attempt_count"] += 1
            entry["latest_score"] = qa.get("score_percent")
            if qa.get("score_percent") is not None:
                entry["best_score"] = max(entry["best_score"] or 0, qa.get("score_percent"))
            if qa.get("passed") and not entry["passed"]:
                entry["passed"] = True
                entry["passed_at"] = qa.get("submitted_at")
        return {
            "school_enrollment": se, "enrollment": {**dp, "program_snapshot": dp.get("program_snapshot") or {}}, "client": client, "dog": dog,
            "trainer": await _trainer_public(se.get("assigned_trainer_id")), "progress": _snapshot_position(dp),
            "baseline": se.get("baseline") or dp.get("school_baseline"), "events": events, "checkpoints": checkpoints,
            "training_plans": plans, "practice": practice, "notes": notes, "requests": requests, "threads": threads,
            "module_quizzes": list(quiz_by_module.values()),
            "dog_school_history": dog_history,
            "operations": {
                "session_count": session_count,
                "recent_sessions": session_history,
                "upcoming_training": upcoming_training,
                "training_credits": (client or {}).get("training_credits", 0),
            },
            "support": {
                "checkpoint_allowance": cp_allowance, "checkpoint_used": cp_used,
                "checkpoint_remaining": max(0, cp_allowance - cp_used) if cp_allowance is not None else None,
                "assist_allowance": assist_allowance, "assist_used": assist_used,
                "assist_remaining": max(0, assist_allowance - assist_used) if assist_allowance is not None else None,
            },
        }

    @api.patch("/admin/school/students/{sid}")
    async def school_student_patch(sid: str, body: SchoolStudentPatch, user: dict = Depends(manage_school_dep)):
        se, dp = await _student_context(sid)
        changes: Dict[str, Any] = {}
        if "assigned_trainer_id" in body.model_fields_set:
            if body.assigned_trainer_id:
                trainer = await db.users.find_one({"id": body.assigned_trainer_id, "active": {"$ne": False}}, {"_id": 0})
                tp = perms_for(trainer) if trainer else {}
                if not trainer or not (tp.get("manage_school") or tp.get("manage_training_sessions")):
                    raise HTTPException(status_code=422, detail="Selected trainer is not an active training staff member")
            changes["assigned_trainer_id"] = body.assigned_trainer_id
        if "access_expires_at" in body.model_fields_set: changes["school_access_expires_at"] = body.access_expires_at
        if "pause_until" in body.model_fields_set: changes["school_pause_until"] = body.pause_until
        if "support_checkpoint_allowance" in body.model_fields_set: changes["support_checkpoint_allowance"] = body.support_checkpoint_allowance
        if "support_assist_allowance" in body.model_fields_set: changes["support_assist_allowance"] = body.support_assist_allowance
        changes.update({"school_updated_at": _now(), "school_updated_by": user.get("id")})
        mirror = {k: v for k, v in changes.items() if k in {"assigned_trainer_id", "support_checkpoint_allowance", "support_assist_allowance"}}
        await db.dog_programs.update_one({"id": dp["id"]}, {"$set": changes})
        if mirror: await db.school_enrollments.update_one({"id": sid}, {"$set": mirror})
        return {"ok": True}

    @api.post("/admin/school/students/{sid}/notes")
    async def school_student_note(sid: str, body: SchoolNoteIn, user: dict = Depends(manage_school_dep)):
        await _student_context(sid)
        doc = {"id": _gid(), "school_enrollment_id": sid, "body": body.body.strip(), "created_at": _now(), "created_by": user.get("id"), "created_by_name": user.get("name")}
        await db.school_student_notes.insert_one(dict(doc)); return doc

    @api.get("/admin/school/students/{sid}/plans")
    async def school_student_plans(sid: str, _: dict = Depends(manage_school_dep)):
        await _student_context(sid)
        return await db.school_training_plans.find({"school_enrollment_id": sid}, {"_id": 0}).sort("created_at", DESCENDING).to_list(100)

    @api.post("/admin/school/students/{sid}/plans")
    async def school_student_plan_create(sid: str, body: TrainingPlanIn, user: dict = Depends(manage_school_dep)):
        se, dp = await _student_context(sid)
        tasks = []
        for i, t in enumerate(body.tasks):
            td = t.model_dump(); td["id"] = td.get("id") or _gid(); td["order"] = i; td["completed_at"] = None; tasks.append(td)
        doc = {"id": _gid(), "school_enrollment_id": sid, "enrollment_id": dp.get("id"), "client_id": se.get("client_id"), "dog_id": se.get("dog_id"),
               "title": body.title, "summary": body.summary or "", "starts_on": body.starts_on, "status": body.status, "tasks": tasks,
               "created_at": _now(), "created_by": user.get("id"), "created_by_name": user.get("name"), "updated_at": _now()}
        await db.school_training_plans.insert_one(dict(doc))
        if body.status == "active":
            await school_events.create_client_notification(client_id=se.get("client_id"), notification_type="training_plan_assigned", title="Your trainer assigned a training plan", body=body.title, school_enrollment_id=sid, enrollment_id=dp.get("id"), dog_id=se.get("dog_id"), program_id=se.get("program_id"), deep_link={"screen":"school","view":"today"}, dedupe_key=f"training_plan:{doc['id']}")
        return doc

    @api.patch("/admin/school/students/{sid}/plans/{plan_id}")
    async def school_student_plan_update(sid: str, plan_id: str, body: TrainingPlanIn, user: dict = Depends(manage_school_dep)):
        await _student_context(sid)
        existing = await db.school_training_plans.find_one({"id": plan_id, "school_enrollment_id": sid}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="Training plan not found")
        previous = {t.get("id"): t for t in (existing.get("tasks") or []) if t.get("id")}
        submitted_ids = {t.id for t in body.tasks if t.id}
        missing_completed = [
            t.get("id") for t in (existing.get("tasks") or [])
            if t.get("id") and t.get("completed_at") and t.get("id") not in submitted_ids
        ]
        if missing_completed:
            raise HTTPException(status_code=422, detail="Completed training-plan tasks cannot be removed. Keep them in the plan so the student's completion history is preserved.")
        tasks=[]
        for i,t in enumerate(body.tasks):
            td=t.model_dump(); td["id"]=td.get("id") or _gid(); td["order"]=i
            # Editing a plan must not erase work the student already completed.
            prior = previous.get(td["id"]) or {}
            td["completed_at"] = prior.get("completed_at")
            tasks.append(td)
        update={"title":body.title,"summary":body.summary or "","starts_on":body.starts_on,"status":body.status,"tasks":tasks,"updated_at":_now(),"updated_by":user.get("id")}
        row=await db.school_training_plans.find_one_and_update({"id":plan_id,"school_enrollment_id":sid},{"$set":update},projection={"_id":0},return_document=ReturnDocument.AFTER)
        if not row: raise HTTPException(status_code=404,detail="Training plan not found")
        return row

    @api.post("/admin/school/students/{sid}/plans/{plan_id}/cancel")
    async def school_student_plan_cancel(sid: str, plan_id: str, user: dict = Depends(manage_school_dep)):
        await _student_context(sid)
        row = await db.school_training_plans.find_one_and_update(
            {"id": plan_id, "school_enrollment_id": sid, "status": {"$ne": "cancelled"}},
            {"$set": {"status": "cancelled", "cancelled_at": _now(), "cancelled_by": user.get("id"), "updated_at": _now()}},
            projection={"_id": 0}, return_document=ReturnDocument.AFTER,
        )
        if not row:
            existing = await db.school_training_plans.find_one({"id": plan_id, "school_enrollment_id": sid}, {"_id": 0})
            if not existing:
                raise HTTPException(status_code=404, detail="Training plan not found")
            return existing
        return row

    @api.post("/admin/school/students/{sid}/requests")
    async def school_request_create(sid: str, body: RequestIn, user: dict = Depends(manage_school_dep)):
        se, dp = await _student_context(sid)
        doc={"id":_gid(),"school_enrollment_id":sid,"enrollment_id":dp.get("id"),"client_id":se.get("client_id"),"dog_id":se.get("dog_id"),"type":body.type,"title":body.title,"instructions":body.instructions or "","lesson_id":body.lesson_id,"due_at":body.due_at,"status":"open","created_at":_now(),"created_by":user.get("id"),"created_by_name":user.get("name")}
        await db.school_requests.insert_one(dict(doc))
        await school_events.create_client_notification(client_id=se.get("client_id"),notification_type=f"trainer_request_{body.type}",title=body.title,body=body.instructions or "Your trainer requested an update.",school_enrollment_id=sid,enrollment_id=dp.get("id"),dog_id=se.get("dog_id"),lesson_id=body.lesson_id,deep_link={"screen":"school","view":"today","request_id":doc["id"]},dedupe_key=f"school_request:{doc['id']}")
        return doc

    @api.post("/admin/school/students/{sid}/requests/{request_id}/resolve")
    async def school_request_resolve(sid: str, request_id: str, user: dict = Depends(manage_school_dep)):
        se, dp = await _student_context(sid)
        row = await db.school_requests.find_one_and_update(
            {"id": request_id, "school_enrollment_id": sid},
            {"$set": {"status": "resolved", "resolved_at": _now(), "resolved_by": user.get("id"), "resolved_by_name": user.get("name")}},
            projection={"_id": 0}, return_document=ReturnDocument.AFTER,
        )
        if not row:
            raise HTTPException(status_code=404, detail="Trainer request not found")
        await school_events.create_client_notification(
            client_id=se.get("client_id"), notification_type="trainer_request_reviewed",
            title="Your trainer reviewed your update", body=row.get("title") or "Trainer request",
            school_enrollment_id=sid, enrollment_id=dp.get("id"), dog_id=se.get("dog_id"),
            lesson_id=row.get("lesson_id"), deep_link={"screen": "school", "view": "feedback"},
            dedupe_key=f"school_request_resolved:{request_id}",
        )
        return row

    @api.get("/portal/school/{sid}/plan")
    async def portal_school_plan(sid: str, user: dict = Depends(get_current_user)):
        await _client_context(sid,user)
        return await db.school_training_plans.find({"school_enrollment_id":sid,"status":"active"},{"_id":0}).sort("created_at",DESCENDING).to_list(20)

    @api.post("/portal/school/{sid}/plans/{plan_id}/tasks/{task_id}/complete")
    async def portal_school_plan_task_complete(sid:str,plan_id:str,task_id:str,user:dict=Depends(get_current_user)):
        se,dp=await _client_context(sid,user)
        now=_now()
        row=await db.school_training_plans.find_one_and_update({"id":plan_id,"school_enrollment_id":sid,"tasks":{"$elemMatch":{"id":task_id,"completed_at":None}}},{"$set":{"tasks.$.completed_at":now,"updated_at":now}},projection={"_id":0},return_document=ReturnDocument.AFTER)
        if not row:
            existing=await db.school_training_plans.find_one({"id":plan_id,"school_enrollment_id":sid,"tasks.id":task_id},{"_id":0})
            if not existing: raise HTTPException(status_code=404,detail="Training plan task not found")
            row=existing
        if row.get("tasks") and all((not t.get("required")) or t.get("completed_at") for t in row["tasks"]):
            await db.school_training_plans.update_one({"id":plan_id},{"$set":{"status":"completed","completed_at":now}})
        await school_events.emit_event(school_events.EventType.TRAINING_PLAN_TASK_COMPLETED,actor_type="client",actor_id=user.get("id"),client_id=se.get("client_id"),dog_id=se.get("dog_id"),enrollment_id=dp.get("id"),school_enrollment_id=sid,title="Training plan task completed",summary=next((t.get("title") for t in row.get("tasks",[]) if t.get("id")==task_id),"Training task"),dedupe_key=f"plan_task:{plan_id}:{task_id}")
        return {"ok":True}

    @api.get("/portal/school/{sid}/requests")
    async def portal_school_requests(sid:str,user:dict=Depends(get_current_user)):
        await _client_context(sid,user)
        return await db.school_requests.find({"school_enrollment_id":sid},{"_id":0}).sort("created_at",DESCENDING).to_list(100)

    @api.post("/portal/school/{sid}/requests/{request_id}/media")
    async def portal_school_request_media(sid:str,request_id:str,body:SchoolMediaUploadIn,user:dict=Depends(get_current_user)):
        se,dp=await _client_context(sid,user)
        req=await db.school_requests.find_one({"id":request_id,"school_enrollment_id":sid,"status":"open"},{"_id":0})
        if not req: raise HTTPException(status_code=404,detail="Trainer request not found")
        if not callable(persist_school_media): raise HTTPException(status_code=503,detail="School media storage is unavailable")
        _validate_data_upload(body.data, video_only=True, max_bytes=100 * 1024 * 1024)
        media_id=_gid()
        try:
            stored=persist_school_media(body.data,media_id,body.filename)
        except Exception:
            raise HTTPException(status_code=400,detail="Could not store this media file")
        doc={"id":media_id,"homework_id":None,"school_enrollment_id":sid,"request_id":request_id,"client_id":se.get("client_id"),"dog_id":se.get("dog_id"),"kind":"school_request_media","filename":body.filename,"uploaded_at":_now(),"uploaded_by":user.get("id"),"storage_backend":"filesystem",**stored}
        await db.homework_media.insert_one(dict(doc))
        return {"media_id":media_id,"filename":body.filename,"size_bytes":stored.get("size_bytes"),"mime":stored.get("mime")}

    @api.post("/portal/school/{sid}/requests/{request_id}/respond")
    async def portal_school_request_respond(sid:str,request_id:str,body:RequestResponseIn,user:dict=Depends(get_current_user)):
        se,dp=await _client_context(sid,user)
        now=_now(); row=await db.school_requests.find_one_and_update({"id":request_id,"school_enrollment_id":sid,"status":"open"},{"$set":{"status":"submitted","response_note":body.note or "","response_media_id":body.media_id,"submitted_at":now}},projection={"_id":0},return_document=ReturnDocument.AFTER)
        if not row: raise HTTPException(status_code=404,detail="Trainer request not found")
        # Same identifying context the other attention events carry — the
        # staff email/notification must name the client, dog, and course, not
        # just say "a student".
        client=await db.clients.find_one({"id":se.get("client_id")},{"_id":0,"name":1}) or {}
        dog=await db.dogs.find_one({"id":se.get("dog_id")},{"_id":0,"name":1}) or {}
        who=" · ".join(x for x in [client.get("name"),dog.get("name")] if x) or "A student"
        await school_events.emit_event(school_events.EventType.TRAINER_REQUEST_COMPLETED,actor_type="client",actor_id=user.get("id"),client_id=se.get("client_id"),client_name=client.get("name"),dog_id=se.get("dog_id"),dog_name=dog.get("name"),enrollment_id=dp.get("id"),school_enrollment_id=sid,program_id=se.get("program_id"),program_name=(dp.get("program_snapshot") or {}).get("name"),title=f"{who} completed a trainer request",summary=row.get("title") or "Trainer request",requires_attention=True,priority="high",deep_link={"screen":"school_hq","student_id":sid,"request_id":request_id},dedupe_key=f"request_response:{request_id}")
        return row

    @api.get("/portal/school/{sid}/workspace")
    async def portal_school_workspace(sid:str,user:dict=Depends(get_current_user)):
        se,dp=await _client_context(sid,user)
        plans=await db.school_training_plans.find({"school_enrollment_id":sid,"status":"active"},{"_id":0}).sort("created_at",DESCENDING).to_list(10)
        requests=await db.school_requests.find({"school_enrollment_id":sid,"status":{"$in":["open","submitted"]}},{"_id":0}).sort("created_at",DESCENDING).to_list(50)
        cp_allowance = se.get("support_checkpoint_allowance") if se.get("support_checkpoint_allowance") is not None else dp.get("support_checkpoint_allowance")
        assist_allowance = se.get("support_assist_allowance") if se.get("support_assist_allowance") is not None else dp.get("support_assist_allowance")
        cps = await db.checkpoint_submissions.find({"school_enrollment_id": sid, "status": "graded"}, {"_id": 0, "outcome": 1, "trainer_assist_status": 1}).to_list(500)
        cp_used = len(cps)
        assist_used = sum(1 for x in cps if x.get("outcome") == "trainer_assist_recommended" and x.get("trainer_assist_status") == "completed")
        return {"trainer":await _trainer_public(se.get("assigned_trainer_id")),"baseline":se.get("baseline") or dp.get("school_baseline"),"training_plans":plans,"requests":requests,"access_expires_at":dp.get("school_access_expires_at"),"pause_until":dp.get("school_pause_until"),"support":{"checkpoint_allowance":cp_allowance,"checkpoint_used":cp_used,"checkpoint_remaining":max(0,cp_allowance-cp_used) if cp_allowance is not None else None,"assist_allowance":assist_allowance,"assist_used":assist_used,"assist_remaining":max(0,assist_allowance-assist_used) if assist_allowance is not None else None}}

    @api.post("/portal/school/{sid}/baseline")
    async def portal_school_baseline(sid:str,body:BaselineIn,user:dict=Depends(get_current_user)):
        se,dp=await _client_context(sid,user)
        onboarding = (dp.get("program_snapshot") or {}).get("school_onboarding") or {}
        if onboarding.get("enabled", True) and onboarding.get("require_equipment_check") and not (body.equipment or "").strip():
            raise HTTPException(status_code=422, detail="Tell your trainer what training equipment you currently use before continuing.")
        payload={**body.model_dump(),"submitted_at":_now(),"submitted_by":user.get("id")}
        await db.school_enrollments.update_one({"id":sid},{"$set":{"baseline":payload,"onboarding_status":"completed","onboarding_completed_at":payload["submitted_at"]}})
        await db.dog_programs.update_one({"id":dp.get("id")},{"$set":{"school_baseline":payload,"school_onboarding_completed_at":payload["submitted_at"]}})
        await school_events.emit_event(school_events.EventType.BASELINE_SUBMITTED,actor_type="client",actor_id=user.get("id"),client_id=se.get("client_id"),dog_id=se.get("dog_id"),enrollment_id=dp.get("id"),school_enrollment_id=sid,title="Student completed School onboarding",summary="Goals, challenges, equipment, and baseline details were submitted.",dedupe_key=f"baseline:{sid}:{payload['submitted_at']}")
        return payload

    @api.get("/portal/school-notifications")
    async def portal_school_notifications(limit:int=Query(40,ge=1,le=100),user:dict=Depends(get_current_user)):
        if user.get("role")!="client" or not user.get("client_id"): raise HTTPException(status_code=403,detail="Client account required")
        rows=await school_events.list_client_notifications(user.get("client_id"),limit=limit)
        return {"items":rows,"unread":await school_events.client_unread_count(user.get("client_id"))}

    @api.post("/portal/school-notifications/{nid}/read")
    async def portal_school_notification_read(nid:str,user:dict=Depends(get_current_user)):
        cid=user.get("client_id")
        if not cid: raise HTTPException(status_code=403,detail="Client account required")
        row=await db.school_notifications.find_one({"id":nid,"audience":f"school_client:{cid}"},{"_id":0})
        if not row: raise HTTPException(status_code=404,detail="Notification not found")
        await db.school_notifications.update_one({"id":nid},{"$set":{"read_at":row.get("read_at") or _now()}}); return {"ok":True}

    @api.get("/admin/school/interventions")
    async def school_interventions(_:dict=Depends(manage_school_dep)):
        now=datetime.now(timezone.utc); since7=(now-timedelta(days=7)).isoformat(); out=[]
        settings=await _school_settings()
        students=await db.school_enrollments.find({"status":"active"},{"_id":0}).to_list(1000)
        for se in students:
            sid=se.get("id"); flags=[]
            last=await db.school_events.find_one({"school_enrollment_id":sid},{"_id":0,"created_at":1},sort=[("created_at",-1)])
            last_dt=_parse_iso((last or {}).get("created_at") or se.get("enrolled_at"))
            if last_dt and (now-last_dt).days>=settings["inactivity_days"]: flags.append({"type":"inactive","severity":"normal","title":f"No School activity for {(now-last_dt).days} days"})
            stuck=await db.school_events.count_documents({"school_enrollment_id":sid,"event_type":"practice_could_not_complete","created_at":{"$gte":since7}})
            if stuck>=settings["repeated_struggle_count"]: flags.append({"type":"repeated_struggle","severity":"high","title":f"Reported being stuck {stuck} times this week"})
            hard=await db.school_events.count_documents({"school_enrollment_id":sid,"event_type":"practice_difficulty_reported","created_at":{"$gte":since7}})
            if hard>=settings["repeated_difficulty_count"]: flags.append({"type":"difficulty","severity":"normal","title":f"Logged high difficulty {hard} times this week"})
            pending=await db.checkpoint_submissions.find_one({"school_enrollment_id":sid,"status":"pending"},{"_id":0,"submitted_at":1},sort=[("submitted_at",1)])
            pd=_parse_iso((pending or {}).get("submitted_at"))
            if pd and (now-pd)>timedelta(hours=settings["checkpoint_review_hours"]): flags.append({"type":"checkpoint_wait","severity":"high","title":f"Checkpoint waiting over {settings['checkpoint_review_hours']} hours"})
            thread=await db.client_message_threads.find_one({"school_enrollment_id":sid,"unread_admin":True},{"_id":0,"last_message_at":1},sort=[("last_message_at",1)])
            td=_parse_iso((thread or {}).get("last_message_at"))
            if td and (now-td)>timedelta(hours=settings["question_response_hours"]): flags.append({"type":"question_wait","severity":"high","title":f"Student question waiting over {settings['question_response_hours']} hours"})
            if flags:
                dog=await db.dogs.find_one({"id":se.get("dog_id")},{"_id":0,"id":1,"name":1,"photo":1}) or {}
                client=await db.clients.find_one({"id":se.get("client_id")},{"_id":0,"id":1,"name":1,"email":1}) or {}
                dp=await db.dog_programs.find_one({"id":se.get("enrollment_id")},{"_id":0,"program_snapshot":1}) or {}
                out.append({"school_enrollment_id":sid,"client_id":se.get("client_id"),"dog_id":se.get("dog_id"),"client":client,"dog":dog,"program_name":(dp.get("program_snapshot") or {}).get("name"),"trainer":await _trainer_public(se.get("assigned_trainer_id")),"flags":flags,"highest": "high" if any(f["severity"]=="high" for f in flags) else "normal"})
        out.sort(key=lambda r:(0 if r.get("highest")=="high" else 1,-len(r.get("flags") or [])))
        return out

    @api.get("/admin/school/analytics")
    async def school_analytics(_:dict=Depends(manage_school_dep)):
        students=await db.school_enrollments.find({}, {"_id":0}).to_list(5000)
        active=sum(1 for s in students if s.get("status")=="active"); completed=sum(1 for s in students if s.get("status")=="completed"); withdrawn=sum(1 for s in students if s.get("status")=="withdrawn")
        cps=await db.checkpoint_submissions.find({"status":"graded"},{"_id":0,"outcome":1,"submitted_at":1,"graded_at":1,"handler_overall":1,"dog_overall":1,"lesson_name":1,"school_enrollment_id":1}).to_list(5000)
        first_pass=sum(1 for x in cps if x.get("outcome")=="advance"); remediation=sum(1 for x in cps if x.get("outcome")=="prescribe_practice"); assist=sum(1 for x in cps if x.get("outcome")=="trainer_assist_recommended")
        review_hours=[]
        for x in cps:
            a=_parse_iso(x.get("submitted_at")); b=_parse_iso(x.get("graded_at"));
            if a and b: review_hours.append(max(0,(b-a).total_seconds()/3600))
        questions=await db.client_message_threads.find({"school_enrollment_id":{"$ne":None}},{"_id":0,"created_at":1,"messages":1}).to_list(5000)
        response_hours=[]
        for t in questions:
            msgs=t.get("messages") or []; first=next((m for m in msgs if m.get("sender_role")=="client"),None); reply=next((m for m in msgs if m.get("sender_role") in ("admin","staff") and _parse_iso(m.get("created_at")) and first and _parse_iso(first.get("created_at")) and _parse_iso(m.get("created_at"))>=_parse_iso(first.get("created_at"))),None)
            if first and reply:
                response_hours.append((_parse_iso(reply.get("created_at"))-_parse_iso(first.get("created_at"))).total_seconds()/3600)
        # Course-level completion and trainer workload use each enrollment's
        # frozen School record so analytics cannot change when a live program is edited.
        dpids=[s.get("enrollment_id") for s in students if s.get("enrollment_id")]
        dps={x.get("id"):x for x in await db.dog_programs.find({"id":{"$in":dpids}},{"_id":0,"id":1,"status":1,"started_at":1,"completed_at":1,"current_module_id":1,"current_lesson_id":1,"program_snapshot":1}).to_list(len(dpids) or 1)}
        course_map={}
        trainer_counts={}
        completion_days=[]
        dropoff_map={}
        for st in students:
            dp=dps.get(st.get("enrollment_id")) or {}; snap=dp.get("program_snapshot") or {}; name=snap.get("name") or "Unknown program"
            c=course_map.setdefault(name,{"program_name":name,"students":0,"active":0,"completed":0,"withdrawn":0,"_completion_days":[]})
            c["students"]+=1; st_status=dp.get("status") or st.get("status") or "active"
            if st_status in c: c[st_status]+=1
            tid=st.get("assigned_trainer_id") or "unassigned"; trainer_counts[tid]=trainer_counts.get(tid,0)+(1 if st_status=="active" else 0)
            if st_status == "completed":
                a=_parse_iso(dp.get("started_at") or st.get("enrolled_at")); b=_parse_iso(dp.get("completed_at") or st.get("completed_at"))
                if a and b and b>=a:
                    days=(b-a).total_seconds()/86400; completion_days.append(days); c["_completion_days"].append(days)
            if st_status == "active":
                pos=_snapshot_position(dp); key=(name,pos.get("current_module_name") or "",pos.get("current_lesson_name") or "")
                dropoff_map[key]=dropoff_map.get(key,0)+1
        courses=[]
        for c in course_map.values():
            c["completion_rate"]=round(c["completed"]*100/max(1,c["students"]),1)
            vals=c.pop("_completion_days",[])
            c["avg_completion_days"]=round(sum(vals)/len(vals),1) if vals else None
            courses.append(c)
        courses.sort(key=lambda x:(-x["students"],x["program_name"]))
        friction=[]
        pipeline=[{"$match":{"event_type":{"$in":["practice_question_asked","student_question","practice_could_not_complete","practice_difficulty_reported"]},"lesson_name":{"$ne":None}}},{"$group":{"_id":{"program":"$program_name","lesson":"$lesson_name"},"questions":{"$sum":{"$cond":[{"$in":["$event_type",["practice_question_asked","student_question"]]},1,0]}},"stuck":{"$sum":{"$cond":[{"$eq":["$event_type","practice_could_not_complete"]},1,0]}},"difficulty":{"$sum":{"$cond":[{"$eq":["$event_type","practice_difficulty_reported"]},1,0]}},"total":{"$sum":1}}},{"$sort":{"total":-1}},{"$limit":20}]
        async for row in db.school_events.aggregate(pipeline): friction.append({"program_name":(row.get("_id") or {}).get("program"),"lesson_name":(row.get("_id") or {}).get("lesson"),"questions":row.get("questions",0),"stuck":row.get("stuck",0),"difficulty":row.get("difficulty",0),"total":row.get("total",0)})
        trainer_workload=[]
        for tid,count in trainer_counts.items():
            if tid=="unassigned": trainer_workload.append({"trainer_id":None,"name":"Unassigned","active_students":count}); continue
            tr=await _trainer_public(tid); trainer_workload.append({"trainer_id":tid,"name":(tr or {}).get("name") or "Trainer","active_students":count})
        trainer_workload.sort(key=lambda x:-x["active_students"])
        settings=await _school_settings(); now_dt=datetime.now(timezone.utc); active_ids=[s.get("id") for s in students if (dps.get(s.get("enrollment_id")) or {}).get("status",s.get("status"))=="active"]
        latest={}
        if active_ids:
            async for row in db.school_events.aggregate([{"$match":{"school_enrollment_id":{"$in":active_ids}}},{"$sort":{"created_at":-1}},{"$group":{"_id":"$school_enrollment_id","at":{"$first":"$created_at"}}}]): latest[row.get("_id")]=row.get("at")
        inactive=0
        for st in students:
            if st.get("id") not in active_ids: continue
            base=_parse_iso(latest.get(st.get("id")) or st.get("enrolled_at"))
            if base and now_dt-base>timedelta(days=settings["inactivity_days"]): inactive+=1
        since30=(now_dt-timedelta(days=30)).isoformat()
        practice30=await db.school_events.count_documents({"school_enrollment_id":{"$in":active_ids},"event_type":"practice_completed","created_at":{"$gte":since30}}) if active_ids else 0
        open_attention=await db.school_notifications.count_documents({"audience":"school_staff","resolved_at":None})
        dropoff=[{"program_name":k[0],"module_name":k[1],"lesson_name":k[2],"active_students":v} for k,v in dropoff_map.items()]
        dropoff.sort(key=lambda x:-x["active_students"]); dropoff=dropoff[:20]
        return {"students":{"total":len(students),"active":active,"completed":completed,"withdrawn":withdrawn,"completion_rate":round(completed*100/max(1,completed+active+withdrawn),1),"inactive":inactive,"avg_completion_days":round(sum(completion_days)/len(completion_days),1) if completion_days else None},"engagement":{"practice_sessions_30d":practice30,"practice_per_active_student_30d":round(practice30/max(1,active),1),"open_attention":open_attention},"checkpoints":{"graded":len(cps),"first_pass":first_pass,"remediation":remediation,"trainer_assist":assist,"first_pass_rate":round(first_pass*100/max(1,len(cps)),1),"avg_review_hours":round(sum(review_hours)/len(review_hours),1) if review_hours else None},"communication":{"threads":len(questions),"avg_first_response_hours":round(sum(response_hours)/len(response_hours),1) if response_hours else None},"courses":courses,"dropoff_lessons":dropoff,"friction_lessons":friction,"trainer_workload":trainer_workload}

    @api.get("/admin/school/resources")
    async def school_resources_admin(_:dict=Depends(manage_school_dep)):
        return await db.school_resources.find({}, {"_id":0}).sort("title",1).to_list(1000)

    @api.post("/admin/school/resources/upload")
    async def school_resource_upload(body:SchoolMediaUploadIn,user:dict=Depends(manage_school_dep)):
        if not callable(persist_school_media): raise HTTPException(status_code=503,detail="School media storage is unavailable")
        _validate_data_upload(body.data, video_only=False, max_bytes=50 * 1024 * 1024)
        media_id=_gid()
        try:
            stored=persist_school_media(body.data,media_id,body.filename)
        except Exception:
            raise HTTPException(status_code=400,detail="Could not store this resource")
        doc={"id":media_id,"homework_id":None,"kind":"school_resource","filename":body.filename,"uploaded_at":_now(),"uploaded_by":user.get("id"),"storage_backend":"filesystem",**stored}
        await db.homework_media.insert_one(dict(doc))
        return {"media_id":media_id,"filename":body.filename,"size_bytes":stored.get("size_bytes"),"mime":stored.get("mime")}

    @api.post("/admin/school/resources")
    async def school_resource_create(body:ResourceIn,user:dict=Depends(manage_school_dep)):
        doc={"id":_gid(),**body.model_dump(),"created_at":_now(),"created_by":user.get("id"),"created_by_name":user.get("name")}; await db.school_resources.insert_one(dict(doc)); return doc

    @api.patch("/admin/school/resources/{rid}")
    async def school_resource_update(rid:str,body:ResourceIn,user:dict=Depends(manage_school_dep)):
        row=await db.school_resources.find_one_and_update({"id":rid},{"$set":{**body.model_dump(),"updated_at":_now(),"updated_by":user.get("id")}},projection={"_id":0},return_document=ReturnDocument.AFTER)
        if not row: raise HTTPException(status_code=404,detail="Resource not found")
        return row

    @api.delete("/admin/school/resources/{rid}")
    async def school_resource_delete(rid:str,user:dict=Depends(manage_school_dep)):
        res=await db.school_resources.update_one({"id":rid},{"$set":{"active":False,"archived_at":_now(),"archived_by":user.get("id")}})
        if not res.matched_count: raise HTTPException(status_code=404,detail="Resource not found")
        return {"ok":True}

    @api.get("/portal/school/media/{media_id}")
    async def portal_school_media(media_id:str,user:dict=Depends(get_current_user)):
        """Return client-safe School media metadata.

        Filesystem-backed media is intentionally NOT re-expanded into base64
        here; callers use the authenticated /file endpoint below. Legacy rows
        that still live in Mongo retain the old data-url fallback.
        """
        row = await _authorized_school_media_row(media_id, user)
        file_path = school_media_file_path(row) if callable(school_media_file_path) else None
        data = None if file_path else (school_media_data_url(row) if callable(school_media_data_url) else row.get("data"))
        return {
            "id": row.get("id"), "filename": row.get("filename"), "mime": row.get("mime"),
            "kind": row.get("kind"), "size_bytes": row.get("size_bytes"),
            "file_url": f"/portal/school/media/{media_id}/file" if file_path else None,
            "data": data,
        }

    @api.get("/portal/school/media/{media_id}/file")
    async def portal_school_media_file(media_id:str,user:dict=Depends(get_current_user)):
        """Serve filesystem-backed School media without base64 inflation.

        Authorization is identical to the metadata endpoint. The frontend
        fetches this with its normal bearer-authenticated API client and uses a
        short-lived blob URL for video/image/PDF display.
        """
        row = await _authorized_school_media_row(media_id, user)
        path = school_media_file_path(row) if callable(school_media_file_path) else None
        if not path:
            # Legacy Mongo-only media has no raw file to stream. Keep a clear
            # status instead of silently reading an arbitrary storage_path.
            raise HTTPException(status_code=404, detail="Stored media file is unavailable")
        return FileResponse(path, media_type=row.get("mime") or "application/octet-stream")

    @api.get("/portal/school/{sid}/resources")
    async def portal_school_resources(sid:str,user:dict=Depends(get_current_user)):
        se,dp=await _client_context(sid,user)
        _require_readable_school_content(dp)
        program_id=se.get("program_id")
        lesson_ids, linked_resource_ids = _reached_school_material(dp)
        q={"active":{"$ne":False},"$or":[{"program_ids":program_id},{"lesson_ids":{"$in":lesson_ids}},{"id":{"$in":linked_resource_ids}},{"$and":[{"program_ids":[]},{"lesson_ids":[]}]}]}
        return await db.school_resources.find(q,{"_id":0}).sort("title",1).to_list(1000)

    @api.get("/portal/school/{sid}/search")
    async def portal_school_search(sid:str,q:str=Query(...,min_length=2,max_length=120),user:dict=Depends(get_current_user)):
        """Search the student's accessible School material without exposing
        locked future curriculum or trainer-only grading guidance. Results are
        scoped to one dog/enrollment so multi-dog accounts never cross streams.
        """
        se,dp=await _client_context(sid,user)
        _require_readable_school_content(dp)
        needle=q.strip().lower()
        snap=dp.get("program_snapshot") or {}
        modules=sorted(snap.get("modules") or [],key=lambda m:(m.get("order",0),m.get("name") or ""))
        flat=[]
        for m in modules:
            for l in sorted([x for x in (m.get("lessons") or []) if x.get("active",True)],key=lambda x:(x.get("order",0),x.get("name") or "")):
                flat.append((m,l))
        current_idx=next((i for i,(m,l) in enumerate(flat) if m.get("id")==dp.get("current_module_id") and l.get("id")==dp.get("current_lesson_id")),len(flat)-1 if dp.get("status")=="completed" else 0)
        allowed_count=len(flat) if dp.get("status")=="completed" else max(0,current_idx+1)
        lesson_results=[]
        for i,(m,l) in enumerate(flat[:allowed_count]):
            safe_text=" ".join(str(x or "") for x in [l.get("name"),l.get("overview"),l.get("why_it_matters"),l.get("instructions"),l.get("troubleshooting"),l.get("success_criteria"),m.get("name")]).lower()
            if needle in safe_text:
                lesson_results.append({"type":"lesson","lesson_id":l.get("id"),"module_id":m.get("id"),"module_name":m.get("name"),"title":l.get("name") or "Lesson","summary":l.get("overview") or l.get("why_it_matters") or "Review this lesson","state":"completed" if i<current_idx or dp.get("status")=="completed" else "current"})
            if len(lesson_results)>=20: break

        reached_flat = flat[:allowed_count]
        lesson_ids=[l.get("id") for _,l in reached_flat if l.get("id")]
        linked_resource_ids=[b.get("resource_id") for _,l in reached_flat for b in (l.get("content_blocks") or []) if b.get("resource_id")]
        rq={"active":{"$ne":False},"$or":[{"program_ids":se.get("program_id")},{"lesson_ids":{"$in":lesson_ids}},{"id":{"$in":linked_resource_ids}},{"$and":[{"program_ids":[]},{"lesson_ids":[]}]}]}
        resources=await db.school_resources.find(rq,{"_id":0}).sort("title",1).to_list(1000)
        resource_results=[]
        for r in resources:
            hay=" ".join([str(r.get("title") or ""),str(r.get("description") or "")," ".join(r.get("tags") or [])]).lower()
            if needle in hay:
                resource_results.append({"type":"resource","id":r.get("id"),"title":r.get("title"),"summary":r.get("description"),"kind":r.get("kind"),"url":r.get("url"),"media_id":r.get("media_id")})
            if len(resource_results)>=20: break

        cps=await db.checkpoint_submissions.find({"school_enrollment_id":sid,"status":"graded"},{"_id":0,"id":1,"lesson_name":1,"module_name":1,"trainer_feedback":1,"graded_at":1,"outcome":1}).sort("graded_at",DESCENDING).to_list(200)
        feedback_results=[]
        for c in cps:
            hay=" ".join(str(x or "") for x in [c.get("lesson_name"),c.get("module_name"),c.get("trainer_feedback"),c.get("outcome")]).lower()
            if needle in hay:
                feedback_results.append({"type":"feedback","checkpoint_id":c.get("id"),"title":c.get("lesson_name") or "Trainer feedback","summary":c.get("trainer_feedback") or (c.get("outcome") or "reviewed").replace("_"," "),"module_name":c.get("module_name"),"graded_at":c.get("graded_at")})
            if len(feedback_results)>=20: break
        return {"query":q,"lessons":lesson_results,"resources":resource_results,"feedback":feedback_results,"total":len(lesson_results)+len(resource_results)+len(feedback_results)}

    @api.get("/portal/school/{sid}/lesson-history")
    async def portal_school_lesson_history(sid: str, limit: int = 50, user: dict = Depends(get_current_user)):
        """Client-facing lesson history for ONE School attempt.

        Scoped two ways at once: _client_context proves this enrollment
        belongs to the caller (another client's session is a 404, not a
        filtered-empty list), and the log query is keyed on that attempt's
        own dog_programs id — never dog+program — so Repeat Program attempt 1
        and attempt 2 can never bleed into each other.

        Every field below is written out explicitly. The raw session log is
        NEVER spread into the response: it carries session_note and other
        staff-only content, and an allowlist is the only construction that
        stays safe when new internal fields are added to the log later.
        """
        se, dp = await _client_context(sid, user)
        _require_readable_school_content(dp)

        snapshot = dp.get("program_snapshot") or {}
        modules = sorted(snapshot.get("modules") or [], key=lambda m: m.get("order", 0))
        module_names = {m.get("id"): m.get("name") for m in modules}
        goal_names = {g["id"]: g.get("name") for m in modules for g in (m.get("goals") or [])}
        lesson_names = {}
        for m in modules:
            for l in (m.get("lessons") or []):
                lesson_names[l.get("id")] = l.get("name")

        logs = await db.training_session_log.find(
            {"enrollment_id": dp["id"]}, {"_id": 0},
        ).sort("at", DESCENDING).to_list(max(1, min(limit, 100)))

        lessons_out = []
        for log in logs:
            skills = []
            for d in (log.get("goal_updates") or []):
                skills.append({
                    "skill_id": d.get("goal_id"),
                    # Prefer the name snapshotted at session time — a later
                    # curriculum edit must not rewrite what history says.
                    "name": d.get("skill_name") or goal_names.get(d.get("goal_id")) or "Skill",
                    "status": d.get("new_status"),
                    "score": d.get("session_score") if d.get("session_score") is not None else d.get("new_score"),
                    "assessment": d.get("session_outcome"),
                    "observation": d.get("client_observation") or "",
                })
            practice = []
            for hid in (log.get("homework_created") or []):
                hw = await db.homework.find_one({"id": hid}, {"_id": 0, "title": 1})
                if hw:
                    practice.append(hw.get("title"))
            lessons_out.append({
                "session_id": log.get("id"),
                "date": log.get("at"),
                "trainer_name": log.get("by_user"),
                "program_name": log.get("program_name") or snapshot.get("name"),
                "module_name": module_names.get(log.get("module_id_at_session")),
                "lesson_name": log.get("lesson_name_at_session") or lesson_names.get(log.get("lesson_id_at_session")),
                "skills": skills,
                "what_went_well": log.get("what_went_well") or "",
                "needs_work": log.get("needs_work") or "",
                "trainer_feedback": log.get("client_recap_note") or "",
                "next_lesson_focus": log.get("next_lesson_focus") or "",
                "practice_assigned": practice,
            })

        progress = dp.get("goal_progress") or {}
        total_goals = len(goal_names)
        mastered = sum(1 for gid in goal_names if (progress.get(gid) or {}).get("status") == "mastered")
        return {
            "school_enrollment_id": se.get("id"),
            "enrollment_id": dp["id"],
            "program_name": snapshot.get("name"),
            "delivery_mode": se.get("delivery_mode"),
            "status": dp.get("status"),
            "progress": {
                "mastered_goals": mastered, "total_goals": total_goals,
                "mastered_pct": round(mastered * 100 / total_goals) if total_goals else 0,
            },
            "lessons": lessons_out,
        }

    @api.get("/portal/school/{sid}/record")
    async def portal_school_record(sid:str,user:dict=Depends(get_current_user)):
        se,dp=await _client_context(sid,user)
        all_ses=await db.school_enrollments.find({"dog_id":se.get("dog_id"),"client_id":se.get("client_id")},{"_id":0}).sort("enrolled_at",1).to_list(100)
        ids=[s.get("id") for s in all_ses]
        cps=_with_overall_scores(await db.checkpoint_submissions.find({"school_enrollment_id":{"$in":ids},"status":"graded"},{"_id":0}).sort("graded_at",1).to_list(1000))
        programs=[]
        for s in all_ses:
            row=await db.dog_programs.find_one({"id":s.get("enrollment_id")},{"_id":0,"program_snapshot":1,"status":1,"completed_at":1,"started_at":1}) or {}
            programs.append({"school_enrollment_id":s.get("id"),"name":(row.get("program_snapshot") or {}).get("name"),"status":row.get("status"),"started_at":row.get("started_at"),"completed_at":row.get("completed_at")})
        return {"dog_id":se.get("dog_id"),"programs":programs,"checkpoints":cps}

