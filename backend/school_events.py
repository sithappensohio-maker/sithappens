"""Sit Happens — Online School Event & Notification spine (Phase 1).

ONE canonical place where a meaningful student/trainer/system action in the
Online School turns into:

    business action  →  ONE School Event  →  notification policy  →
                        in-app notification(s)  →  (optional) email

An **event** records *what happened* (durable, append-only, feeds the activity
feed + future analytics).  A **notification** records *who needs to know* and
carries the read/resolved lifecycle.  They are intentionally separate concepts
living in two collections: ``school_events`` and ``school_notifications``.

Design constraints honored here:
  * A student's successful action must NEVER be rolled back because an event,
    notification, or email failed — every side effect in this module is
    best-effort and swallows/logs its own errors (`emit_event` never raises).
  * Retried HTTP requests must not double-alert — every event and notification
    carries a deterministic ``dedupe_key`` protected by a unique partial index
    (see server.startup's perf_indexes). A duplicate insert is caught and the
    idempotent delivery fan-out is reconciled so a partial notification/email
    failure can be repaired without creating duplicates.
  * Email is a delivery channel, not the notification store. Email is queued
    through the existing durable email outbox (email_service). If email fails,
    the in-app notification still exists.
  * No new infrastructure — same Mongo/Motor stack, same polling refresh, same
    email outbox as the rest of the app.

The module is deliberately free of FastAPI/route concerns. server.py wires
`set_db` at startup and calls `emit_event` from the relevant endpoints; the
School HQ endpoints call the query/lifecycle helpers at the bottom.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from pymongo import DESCENDING, ReturnDocument
from pymongo.errors import DuplicateKeyError

logger = logging.getLogger("school_events")

# ── DB handle (wired once at startup, mirrors email_service.set_db) ──────────
_db = None


def set_db(db_handle) -> None:
    global _db
    _db = db_handle


# ── Collections + index names ───────────────────────────────────────────────
EVENTS_COLLECTION = "school_events"
NOTIFICATIONS_COLLECTION = "school_notifications"
EVENT_DEDUPE_INDEX = "school_events_dedupe_key_unique"
NOTIF_DEDUPE_INDEX = "school_notifications_dedupe_key_unique"


# ── Priorities ──────────────────────────────────────────────────────────────
class Priority:
    INFO = "info"        # routine activity — feed only, never an alert
    NORMAL = "normal"    # notable but not blocking
    HIGH = "high"        # a human should look soon
    URGENT = "urgent"    # a human is blocked / student is stuck

    ORDER = {INFO: 0, NORMAL: 1, HIGH: 2, URGENT: 3}


# ── Event types (centralized constants — never scatter raw strings) ─────────
class EventType:
    # Enrollment / progress
    SCHOOL_ENROLLED = "school_enrolled"
    SCHOOL_STARTED = "school_started"
    LESSON_STARTED = "lesson_started"
    LESSON_LEARN_COMPLETED = "lesson_learn_completed"
    LESSON_COMPLETED = "lesson_completed"
    MODULE_COMPLETED = "module_completed"
    COURSE_COMPLETED = "course_completed"
    ACHIEVEMENT_EARNED = "achievement_earned"
    BASELINE_SUBMITTED = "baseline_submitted"
    TRAINING_PLAN_TASK_COMPLETED = "training_plan_task_completed"
    TRAINER_REQUEST_COMPLETED = "trainer_request_completed"
    TRAINING_SESSION_COMPLETED = "training_session_completed"
    # Practice
    PRACTICE_STARTED = "practice_started"
    PRACTICE_COMPLETED = "practice_completed"
    PRACTICE_VIDEO_SUBMITTED = "practice_video_submitted"
    PRACTICE_DIFFICULTY_REPORTED = "practice_difficulty_reported"
    PRACTICE_COULD_NOT_COMPLETE = "practice_could_not_complete"
    PRACTICE_QUESTION_ASKED = "practice_question_asked"
    # Practice Reviews (trainer coaching on a practice log)
    PRACTICE_REVIEWED = "practice_reviewed"
    PRACTICE_REVIEW_ATTENTION = "practice_review_attention"
    # Module Quizzes (client learning behavior — activity-only, never an alert)
    MODULE_QUIZ_PASSED = "module_quiz_passed"
    MODULE_QUIZ_RETRY_NEEDED = "module_quiz_retry_needed"
    # Checkpoints
    CHECKPOINT_SUBMITTED = "checkpoint_submitted"
    CHECKPOINT_REVIEW_STARTED = "checkpoint_review_started"
    CHECKPOINT_PASSED = "checkpoint_passed"
    CHECKPOINT_REMEDIATION_REQUIRED = "checkpoint_remediation_required"
    CHECKPOINT_TRAINER_ASSIST_REQUIRED = "checkpoint_trainer_assist_required"
    # Communication
    STUDENT_QUESTION = "student_question"
    TRAINER_REPLY = "trainer_reply"
    # Trainer Assist
    TRAINER_ASSIST_RECOMMENDED = "trainer_assist_recommended"
    TRAINER_ASSIST_REQUESTED = "trainer_assist_requested"
    TRAINER_ASSIST_SCHEDULED = "trainer_assist_scheduled"
    TRAINER_ASSIST_COMPLETED = "trainer_assist_completed"


# ── Notification policy ─────────────────────────────────────────────────────
# The ONE place that decides "does this event alert a human, at what priority,
# and does it also email?" Everything else stays activity-feed only. Editing
# alert behavior = editing this table, nothing else.
#
# Shape per entry: {"attention": bool, "priority": str, "email": bool}
# Any event_type not listed defaults to activity-only (ACTIVITY_ONLY).
ACTIVITY_ONLY = {"attention": False, "priority": Priority.INFO, "email": False}

EVENT_POLICY: Dict[str, Dict[str, Any]] = {
    # ── Needs a human → in-app alert + email ────────────────────────────────
    EventType.STUDENT_QUESTION:            {"attention": True, "priority": Priority.HIGH, "email": True},
    EventType.PRACTICE_QUESTION_ASKED:     {"attention": True, "priority": Priority.HIGH, "email": True},
    EventType.CHECKPOINT_SUBMITTED:        {"attention": True, "priority": Priority.HIGH, "email": True},
    EventType.PRACTICE_VIDEO_SUBMITTED:    {"attention": True, "priority": Priority.HIGH, "email": True},
    EventType.PRACTICE_COULD_NOT_COMPLETE: {"attention": True, "priority": Priority.HIGH, "email": True},
    EventType.TRAINER_ASSIST_REQUESTED:    {"attention": True, "priority": Priority.HIGH, "email": True},
    EventType.CHECKPOINT_TRAINER_ASSIST_REQUIRED: {"attention": True, "priority": Priority.HIGH, "email": True},
    # A submitted trainer-request response is trainer work waiting on a human
    # (review the student's video/check-in), so it alerts + emails exactly
    # like the other attention-required School actions.
    EventType.TRAINER_REQUEST_COMPLETED:   {"attention": True, "priority": Priority.HIGH, "email": True},
    EventType.CHECKPOINT_REMEDIATION_REQUIRED:    {"attention": True, "priority": Priority.NORMAL, "email": False},
    # A trainer explicitly flagged a Practice Review "Needs Trainer Attention"
    # — staff follow-up work, in-app only (the flagging trainer IS staff, so
    # no email blast is warranted).
    EventType.PRACTICE_REVIEW_ATTENTION:          {"attention": True, "priority": Priority.HIGH, "email": False},
    # ── Notable but not a screaming alert (in-app, no email) ─────────────────
    EventType.ACHIEVEMENT_EARNED:          {"attention": False, "priority": Priority.NORMAL, "email": False},
    EventType.COURSE_COMPLETED:            {"attention": False, "priority": Priority.NORMAL, "email": False},
    # ── Everything else falls through to ACTIVITY_ONLY:
    #    lesson_started/completed, module_completed, practice_started/completed,
    #    practice_difficulty_reported, checkpoint_review_started/passed,
    #    trainer_reply, trainer_assist_recommended/scheduled/completed,
    #    school_enrolled/started.
}


def policy_for(event_type: str) -> Dict[str, Any]:
    return EVENT_POLICY.get(event_type, ACTIVITY_ONLY)


# ── Helpers ─────────────────────────────────────────────────────────────────
def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _gid() -> str:
    return str(uuid.uuid4())


# Fields copied verbatim from an event onto its notification so the Needs
# Attention queue and deep-links have full context without a second lookup.
_CONTEXT_FIELDS = (
    "client_id", "client_name", "dog_id", "dog_name",
    "enrollment_id", "school_enrollment_id", "program_id", "program_name",
    "module_id", "module_name", "lesson_id", "lesson_name",
    "homework_id", "checkpoint_id", "trainer_assist_id", "thread_id",
    "assigned_trainer_id", "deep_link", "metadata",
)


async def emit_event(
    event_type: str,
    *,
    actor_type: str,
    actor_id: Optional[str] = None,
    actor_name: Optional[str] = None,
    client_id: Optional[str] = None,
    client_name: Optional[str] = None,
    dog_id: Optional[str] = None,
    dog_name: Optional[str] = None,
    enrollment_id: Optional[str] = None,
    school_enrollment_id: Optional[str] = None,
    program_id: Optional[str] = None,
    program_name: Optional[str] = None,
    module_id: Optional[str] = None,
    module_name: Optional[str] = None,
    lesson_id: Optional[str] = None,
    lesson_name: Optional[str] = None,
    homework_id: Optional[str] = None,
    checkpoint_id: Optional[str] = None,
    trainer_assist_id: Optional[str] = None,
    thread_id: Optional[str] = None,
    title: str = "",
    summary: str = "",
    metadata: Optional[dict] = None,
    priority: Optional[str] = None,
    requires_attention: Optional[bool] = None,
    assigned_trainer_id: Optional[str] = None,
    deep_link: Optional[dict] = None,
    source: str = "online_school",
    dedupe_key: Optional[str] = None,
) -> Optional[dict]:
    """Record ONE canonical School Event and fan out notification(s) per the
    policy table. Best-effort and idempotent:

      * Never raises — any failure is logged and swallowed so the caller's
        business action (already committed) is never disturbed.
      * If ``dedupe_key`` is supplied and an event with that key already
        exists, the canonical event is reused and its idempotent staff-delivery
        fan-out is reconciled. This repairs partial delivery while still
        preventing duplicate notifications/emails.

    Returns the inserted/reconciled event dict, or None if delivery failed.
    """
    if _db is None:
        logger.warning("school_events.emit_event called before set_db; dropping %s", event_type)
        return None

    pol = policy_for(event_type)
    eff_priority = priority or pol["priority"]
    eff_attention = pol["attention"] if requires_attention is None else bool(requires_attention)

    event = {
        "id": _gid(),
        "event_type": event_type,
        "created_at": _now_iso(),
        "actor_type": actor_type,
        "actor_id": actor_id,
        "actor_name": actor_name,
        "client_id": client_id,
        "client_name": client_name,
        "dog_id": dog_id,
        "dog_name": dog_name,
        "enrollment_id": enrollment_id,
        "school_enrollment_id": school_enrollment_id,
        "program_id": program_id,
        "program_name": program_name,
        "module_id": module_id,
        "module_name": module_name,
        "lesson_id": lesson_id,
        "lesson_name": lesson_name,
        "homework_id": homework_id,
        "checkpoint_id": checkpoint_id,
        "trainer_assist_id": trainer_assist_id,
        "thread_id": thread_id,
        "title": title,
        "summary": summary,
        "metadata": metadata or {},
        "priority": eff_priority,
        "requires_attention": eff_attention,
        "assigned_trainer_id": assigned_trainer_id,
        "deep_link": deep_link or {},
        "source": source,
        "dedupe_key": dedupe_key,
    }

    try:
        await _db[EVENTS_COLLECTION].insert_one(dict(event))
    except DuplicateKeyError:
        # Retry/double-submit. The event itself is already durable, but a prior
        # attempt may have failed *after* the event insert while creating the
        # staff notification/email. Load the canonical event and re-run the
        # idempotent fan-out so retries repair partial delivery instead of
        # permanently losing the alert.
        if not dedupe_key:
            return None
        try:
            existing = await _db[EVENTS_COLLECTION].find_one({"dedupe_key": dedupe_key}, {"_id": 0})
            if existing and existing.get("requires_attention"):
                await _create_staff_notification(existing, policy_for(existing.get("event_type") or event_type))
            return existing
        except Exception as e:
            logger.warning("school_events: duplicate reconciliation failed for %s: %s", event_type, e)
            return None
    except Exception as e:
        logger.warning("school_events: failed to insert event %s: %s", event_type, e)
        return None
    event.pop("_id", None)

    # Fan out notification(s) — only when the policy (or explicit override)
    # says a human needs to act. Never let this disturb the event write.
    if eff_attention:
        try:
            await _create_staff_notification(event, pol)
        except Exception as e:  # pragma: no cover - defensive
            logger.warning("school_events: notification fan-out failed for %s: %s", event_type, e)

    return event


async def _create_staff_notification(event: dict, pol: dict) -> None:
    """Create ONE staff-audience notification for an attention-worthy event.

    Phase 1 uses a single shared *school_staff* audience (mirrors the existing
    shared checkpoint / trainer-assist queues — when one trainer handles it,
    it's handled for the team) rather than fanning a copy out to every trainer
    user. read/resolved state is therefore team-level. ``assigned_trainer_id``
    is carried through for future per-trainer routing but Phase 1 does not
    split the queue by it.

    Idempotent: the notification's dedupe_key is derived from the event's, so a
    duplicate event that somehow slipped past (or a manual re-emit) still can't
    create a second notification.
    """
    if _db is None:
        return
    notif_dedupe = (f"{event['dedupe_key']}:notif" if event.get("dedupe_key")
                    else f"evt:{event['id']}:notif")
    notif = {
        "id": _gid(),
        "event_id": event["id"],
        "event_type": event["event_type"],
        "notification_type": event["event_type"],
        "audience": "school_staff",
        "title": event.get("title") or _default_title(event),
        "body": event.get("summary") or "",
        "priority": event.get("priority") or pol["priority"],
        "created_at": _now_iso(),
        "read_at": None,
        "resolved_at": None,
        "resolved_by": None,
        "snoozed_until": None,
        "email_status": "queued" if pol.get("email") else "none",
        "email_queued_at": _now_iso() if pol.get("email") else None,
        "email_sent_at": None,
        "dedupe_key": notif_dedupe,
    }
    for f in _CONTEXT_FIELDS:
        notif[f] = event.get(f)

    try:
        await _db[NOTIFICATIONS_COLLECTION].insert_one(dict(notif))
    except DuplicateKeyError:
        # Notification already exists. Do NOT return before the email call:
        # the durable outbox is independently idempotent, so retrying it here
        # safely repairs the edge case where notification creation succeeded
        # but the email enqueue failed.
        pass
    except Exception as e:
        logger.warning("school_events: failed to insert notification for %s: %s", event["event_type"], e)
        return

    if pol.get("email"):
        # Route through the existing durable email outbox (idempotent on its
        # own key). Import locally to avoid any import-order coupling.
        try:
            import email_service
            await email_service.queue_school_attention_email(event, outbox_key=f"school_notif:{notif_dedupe}")
        except Exception as e:
            # Email failure must not undo the in-app notification.
            logger.warning("school_events: attention email queue failed for %s: %s", event["event_type"], e)


async def create_client_notification(
    *, client_id: str, notification_type: str, title: str, body: str = "",
    school_enrollment_id: Optional[str] = None, enrollment_id: Optional[str] = None,
    dog_id: Optional[str] = None, dog_name: Optional[str] = None,
    program_id: Optional[str] = None, program_name: Optional[str] = None,
    module_id: Optional[str] = None, module_name: Optional[str] = None,
    lesson_id: Optional[str] = None, lesson_name: Optional[str] = None,
    homework_id: Optional[str] = None, checkpoint_id: Optional[str] = None,
    thread_id: Optional[str] = None, deep_link: Optional[dict] = None,
    priority: str = Priority.NORMAL, dedupe_key: Optional[str] = None, metadata: Optional[dict] = None,
) -> Optional[dict]:
    """Create one durable client-facing School notification.

    This intentionally uses the SAME ``school_notifications`` collection as
    staff alerts, distinguished by an audience key. It is idempotent and does
    not send email by itself — trainer replies/checkpoint workflows retain
    their existing email behavior while the client gets a durable in-app
    school alert with a real deep-link.
    """
    if _db is None or not client_id:
        return None
    ndedupe = dedupe_key or f"client:{client_id}:{notification_type}:{_gid()}"
    doc = {
        "id": _gid(), "event_id": None, "event_type": notification_type,
        "notification_type": notification_type, "audience": f"school_client:{client_id}",
        "title": title, "body": body or "", "priority": priority, "created_at": _now_iso(),
        "read_at": None, "resolved_at": None, "resolved_by": None, "snoozed_until": None,
        "email_status": "none", "email_queued_at": None, "email_sent_at": None,
        "dedupe_key": ndedupe, "client_id": client_id, "school_enrollment_id": school_enrollment_id,
        "enrollment_id": enrollment_id, "dog_id": dog_id, "dog_name": dog_name,
        "program_id": program_id, "program_name": program_name, "module_id": module_id,
        "module_name": module_name, "lesson_id": lesson_id, "lesson_name": lesson_name,
        "homework_id": homework_id, "checkpoint_id": checkpoint_id, "thread_id": thread_id,
        "deep_link": deep_link or {}, "metadata": metadata or {},
    }
    try:
        await _db[NOTIFICATIONS_COLLECTION].insert_one(dict(doc))
    except DuplicateKeyError:
        existing = await _db[NOTIFICATIONS_COLLECTION].find_one({"dedupe_key": ndedupe}, {"_id": 0})
        return existing
    except Exception as e:
        logger.warning("school_events: client notification failed %s: %s", notification_type, e)
        return None
    doc.pop("_id", None)
    return doc


async def list_client_notifications(client_id: str, *, limit: int = 40, before: Optional[str] = None, unread_only: bool = False) -> List[dict]:
    if _db is None or not client_id:
        return []
    limit = max(1, min(int(limit or 40), 100))
    q: Dict[str, Any] = {"audience": f"school_client:{client_id}"}
    if unread_only:
        q["read_at"] = None
    if before:
        q["created_at"] = {"$lt": before}
    return await _db[NOTIFICATIONS_COLLECTION].find(q, {"_id": 0}).sort("created_at", DESCENDING).to_list(limit)


async def client_unread_count(client_id: str) -> int:
    if _db is None or not client_id:
        return 0
    return await _db[NOTIFICATIONS_COLLECTION].count_documents({"audience": f"school_client:{client_id}", "read_at": None})


def _default_title(event: dict) -> str:
    who = event.get("client_name") or "A student"
    dog = event.get("dog_name")
    subject = f"{who}" + (f" · {dog}" if dog else "")
    et = event["event_type"]
    labels = {
        EventType.STUDENT_QUESTION: "asked a question",
        EventType.PRACTICE_QUESTION_ASKED: "asked a practice question",
        EventType.CHECKPOINT_SUBMITTED: "submitted a checkpoint",
        EventType.PRACTICE_VIDEO_SUBMITTED: "submitted a practice video",
        EventType.PRACTICE_COULD_NOT_COMPLETE: "couldn't complete a practice",
        EventType.TRAINER_ASSIST_REQUESTED: "requested Trainer Assist",
        EventType.CHECKPOINT_TRAINER_ASSIST_REQUIRED: "needs Trainer Assist",
        EventType.CHECKPOINT_REMEDIATION_REQUIRED: "needs remediation",
        EventType.PRACTICE_REVIEW_ATTENTION: "practice flagged for follow-up",
    }
    return f"{subject} {labels.get(et, et.replace('_', ' '))}".strip()


# ── Query / lifecycle helpers (used by the School HQ endpoints) ─────────────
def _clean(doc: dict) -> dict:
    doc.pop("_id", None)
    return doc


async def recent_activity(
    *, limit: int = 40, before: Optional[str] = None,
    client_id: Optional[str] = None, event_type: Optional[str] = None,
    attention_only: bool = False,
    dog_id: Optional[str] = None, program_id: Optional[str] = None,
    event_types: Optional[List[str]] = None,
    q_text: Optional[str] = None,
    date_from: Optional[str] = None, date_to: Optional[str] = None,
) -> List[dict]:
    """Chronological activity feed (newest first), paginated by ``before``
    (an ISO created_at cursor). Bounded — never returns an unbounded set.

    Real-client-volume upgrade: every filter (search text, student, dog,
    course, type set, date range, attention-only) is applied HERE, against
    the full dataset — the frontend never filters merely the loaded rows."""
    if _db is None:
        return []
    limit = max(1, min(int(limit or 40), 200))
    q: Dict[str, Any] = {}
    created: Dict[str, Any] = {}
    if before:
        created["$lt"] = before
    if date_to:
        # Inclusive end-date: '~' (0x7E) sorts after every character an ISO
        # timestamp can contain, so "<date>~" upper-bounds that whole day.
        upper = f"{date_to}~"
        created["$lt"] = min(created["$lt"], upper) if "$lt" in created else upper
    if date_from:
        created["$gte"] = date_from
    if created:
        q["created_at"] = created
    if client_id:
        q["client_id"] = client_id
    if dog_id:
        q["dog_id"] = dog_id
    if program_id:
        q["program_id"] = program_id
    if event_type:
        q["event_type"] = event_type
    elif event_types:
        q["event_type"] = {"$in": list(event_types)}
    if attention_only:
        q["requires_attention"] = True
    if q_text:
        import re as _re
        rx = {"$regex": _re.escape(q_text.strip()), "$options": "i"}
        q["$or"] = [{"client_name": rx}, {"dog_name": rx}, {"program_name": rx}]
    rows = await _db[EVENTS_COLLECTION].find(q, {"_id": 0}).sort("created_at", DESCENDING).to_list(limit)
    return rows


async def list_notifications(
    *, limit: int = 40, before: Optional[str] = None,
    status: str = "open", priority: Optional[str] = None,
    client_id: Optional[str] = None, notification_type: Optional[str] = None,
    sort: str = "newest",
) -> List[dict]:
    """List staff notifications. ``status`` ∈ {open, unread, resolved, all}.
    ``open`` = not resolved (the Needs Attention default)."""
    if _db is None:
        return []
    limit = max(1, min(int(limit or 40), 100))
    q: Dict[str, Any] = {"audience": "school_staff"}
    if status == "open":
        q["resolved_at"] = None
    elif status == "unread":
        q["read_at"] = None
        q["resolved_at"] = None
    elif status == "resolved":
        q["resolved_at"] = {"$ne": None}
    # status == "all" → no state filter
    if priority:
        q["priority"] = priority
    if client_id:
        q["client_id"] = client_id
    if notification_type:
        q["notification_type"] = notification_type
    if before:
        q["created_at"] = {"$lt": before}
    direction = 1 if sort == "oldest" else DESCENDING
    rows = await _db[NOTIFICATIONS_COLLECTION].find(q, {"_id": 0}).sort("created_at", direction).to_list(limit)
    return rows


async def attention_count() -> int:
    """Unresolved attention notifications — the number behind the badge."""
    if _db is None:
        return 0
    return await _db[NOTIFICATIONS_COLLECTION].count_documents(
        {"audience": "school_staff", "resolved_at": None}
    )


async def unread_count() -> int:
    if _db is None:
        return 0
    return await _db[NOTIFICATIONS_COLLECTION].count_documents(
        {"audience": "school_staff", "read_at": None, "resolved_at": None}
    )


async def mark_notification_read(notification_id: str) -> Optional[dict]:
    if _db is None:
        return None
    doc = await _db[NOTIFICATIONS_COLLECTION].find_one_and_update(
        {"id": notification_id, "read_at": None},
        {"$set": {"read_at": _now_iso()}},
        return_document=ReturnDocument.AFTER,
    )
    if doc is None:  # already read, or unknown id
        doc = await _db[NOTIFICATIONS_COLLECTION].find_one({"id": notification_id})
    return _clean(doc) if doc else None


async def resolve_notification(notification_id: str, *, by: Optional[str] = None) -> Optional[dict]:
    if _db is None:
        return None
    now = _now_iso()
    doc = await _db[NOTIFICATIONS_COLLECTION].find_one_and_update(
        {"id": notification_id, "resolved_at": None},
        {"$set": {"resolved_at": now, "resolved_by": by}},
    )
    if doc is None:
        return _clean(await _db[NOTIFICATIONS_COLLECTION].find_one({"id": notification_id}) or {}) or None
    # Ensure a resolved notification also counts as read.
    await _db[NOTIFICATIONS_COLLECTION].update_one(
        {"id": notification_id, "read_at": None}, {"$set": {"read_at": now}}
    )
    doc = await _db[NOTIFICATIONS_COLLECTION].find_one({"id": notification_id})
    return _clean(doc) if doc else None
