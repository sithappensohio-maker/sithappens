"""Client-facing Board & Train daily updates.

A trainer writes the day once in Trainer Delivery.  This extension takes the
completed daily closeout and makes it durable in two places automatically:

* a permanent Client Hub update for that client/dog/day; and
* one branded Resend email using Sit Happens' existing template/outbox system.

The update is keyed by enrollment + business date, so retries, refreshes, and
replayed PM completions cannot create duplicate hub cards or duplicate email
jobs.  This module does not own training progress; it only publishes the
already-completed Trainer Delivery closeout.
"""
from __future__ import annotations

import html
import logging
import re
from datetime import date, datetime, timezone
from typing import Optional

from fastapi import Depends, HTTPException, Query, Request

import email_service
from email_templates_registry import EMAIL_TEMPLATES

logger = logging.getLogger("sithappens")

_COMPLETE_RE = re.compile(r"^/api/training-session-drafts/([^/]+)/complete$")
_MANUAL_CLOSEOUT_RE = re.compile(
    r"^/api/admin/trainer-delivery/board-train/([^/]+)/days/(\d{4}-\d{2}-\d{2})/closeout$"
)
_BT_LABEL_RE = re.compile(r"^bt:(\d{4}-\d{2}-\d{2}):(am|pm|outing)$")
_TEMPLATE_SLUG = "client_board_train_daily_update"

_TEMPLATE = {
    "slug": _TEMPLATE_SLUG,
    "name": "Board & Train Daily Update",
    "description": "Sent when the trainer closes a Board & Train training day.",
    "category": "client",
    "audience": "client",
    "default_subject": "{{dog_name}} · Board & Train Day {{day_number}} update",
    "default_title": "🐾 {{dog_name}} · Day {{day_number}}",
    "default_intro_html": "Hi {{first_name}}, here's today's Board & Train update for <strong>{{dog_name}}</strong>.",
    "default_cta_text": "Open Client Hub",
    "variables": [
        "first_name", "client_name", "dog_name", "program_name", "day_number",
        "total_days", "session_date", "trainer_name", "client_update",
        "biggest_win", "biggest_challenge", "tomorrow_focus",
    ],
}


def _register_template() -> None:
    if not any(t.get("slug") == _TEMPLATE_SLUG for t in EMAIL_TEMPLATES):
        # Mutate the registry object imported by email_service. Settings reads
        # the same list at request time, so this email is editable like the
        # other transactional emails without modifying the core registry file.
        EMAIL_TEMPLATES.insert(0, dict(_TEMPLATE))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean(value) -> str:
    return str(value or "").strip()


def _first_name(name: str) -> str:
    return (_clean(name).split() or ["there"])[0]


def _day_numbers(booking: Optional[dict], session_date: str) -> tuple[int, int]:
    if not booking:
        return 1, 1
    try:
        start = date.fromisoformat(_clean(booking.get("date"))[:10])
        end = date.fromisoformat(_clean(booking.get("end_date"))[:10])
        current = date.fromisoformat(session_date)
        total = max(1, (end - start).days)
        day_number = max(1, min(total, (current - start).days + 1))
        return day_number, total
    except Exception:
        return 1, 1


async def _client_id_for_user(db, user: dict) -> Optional[str]:
    if user.get("client_id"):
        return user.get("client_id")
    email = _clean(user.get("email")).lower()
    if not email:
        return None
    row = await db.clients.find_one({"email": {"$regex": f"^{re.escape(email)}$", "$options": "i"}}, {"_id": 0, "id": 1})
    return (row or {}).get("id")


async def _context_for_enrollment(db, enrollment: dict, session_date: str) -> dict:
    dog = await db.dogs.find_one(
        {"id": enrollment.get("dog_id")},
        {"_id": 0, "id": 1, "name": 1, "photo": 1, "owner_id": 1},
    ) or {}
    client = await db.clients.find_one(
        {"id": dog.get("owner_id")},
        {"_id": 0, "id": 1, "name": 1, "email": 1},
    ) or {}
    snap = enrollment.get("program_snapshot") or {}
    program_name = snap.get("name") or "Board & Train"

    # Find the real residential booking only to derive Day X of Y. Training
    # itself still lives entirely in the canonical session-draft spine.
    services = await db.services.find(
        {"package_program_id": enrollment.get("program_id")},
        {"_id": 0, "id": 1},
    ).to_list(100)
    service_ids = [s.get("id") for s in services if s.get("id")]
    booking = None
    if service_ids:
        booking = await db.bookings.find_one(
            {
                "dog_id": enrollment.get("dog_id"),
                "service_id": {"$in": service_ids},
                "date": {"$lte": session_date},
                "end_date": {"$gt": session_date},
                "status": {"$nin": ["cancelled", "rejected"]},
            },
            {"_id": 0},
            sort=[("date", -1)],
        )
    day_number, total_days = _day_numbers(booking, session_date)
    return {
        "dog": dog,
        "client": client,
        "booking": booking,
        "program_name": program_name,
        "day_number": day_number,
        "total_days": total_days,
    }


def _body_html(closeout: dict) -> str:
    def block(label: str, value: str, accent: str) -> str:
        value = html.escape(_clean(value)).replace("\n", "<br/>")
        if not value:
            return ""
        return (
            f'<div style="margin:0 0 14px 0;padding:14px 16px;border-left:4px solid {accent};'
            'background:#f8fafc;border-radius:8px;">'
            f'<div style="font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.12em;color:#64748b;margin-bottom:5px;">{html.escape(label)}</div>'
            f'<div style="font-size:15px;line-height:1.55;color:#0f172a;">{value}</div></div>'
        )
    return "".join([
        block("Today's update", closeout.get("client_update"), "#00a9e0"),
        block("Biggest win", closeout.get("biggest_win"), "#8cc63f"),
        block("Biggest challenge", closeout.get("biggest_challenge"), "#f26522"),
        block("Tomorrow's focus", closeout.get("tomorrow_focus"), "#00a9e0"),
    ])


async def _publish_closeout(db, enrollment: dict, closeout: dict) -> dict:
    session_date = _clean(closeout.get("session_date"))
    if not session_date:
        return {}
    ctx = await _context_for_enrollment(db, enrollment, session_date)
    dog, client = ctx["dog"], ctx["client"]
    if not client.get("id"):
        return {}

    update_id = f"bt-daily:{enrollment.get('id')}:{session_date}"
    document = {
        "id": update_id,
        "client_id": client.get("id"),
        "dog_id": dog.get("id"),
        "dog_name": dog.get("name") or "Dog",
        "dog_photo": dog.get("photo"),
        "enrollment_id": enrollment.get("id"),
        "program_id": enrollment.get("program_id"),
        "program_name": ctx["program_name"],
        "session_date": session_date,
        "day_number": ctx["day_number"],
        "total_days": ctx["total_days"],
        "biggest_win": _clean(closeout.get("biggest_win")),
        "biggest_challenge": _clean(closeout.get("biggest_challenge")),
        "tomorrow_focus": _clean(closeout.get("tomorrow_focus")),
        "client_update": _clean(closeout.get("client_update")),
        "trainer_name": _clean(closeout.get("closed_by_name")) or "Sit Happens Trainer",
        "closeout_id": closeout.get("id"),
        "closed_at": closeout.get("closed_at"),
        "updated_at": _now(),
    }
    await db.trainer_delivery_client_updates.update_one(
        {"enrollment_id": enrollment.get("id"), "session_date": session_date},
        {"$set": document, "$setOnInsert": {"created_at": _now()}},
        upsert=True,
    )

    email = _clean(client.get("email"))
    outbox_key = f"board-train-daily:{enrollment.get('id')}:{session_date}"
    if not email:
        await db.trainer_delivery_client_updates.update_one(
            {"id": update_id}, {"$set": {"email_status": "no_email"}}
        )
        return document

    already_sent = await db.notification_log.find_one({"key": outbox_key}, {"_id": 0, "key": 1})
    already_queued = await db.email_outbox.find_one({"key": outbox_key}, {"_id": 0, "key": 1, "status": 1})
    if already_sent:
        await db.trainer_delivery_client_updates.update_one(
            {"id": update_id}, {"$set": {"email_status": "sent"}}
        )
        return document
    if already_queued:
        await db.trainer_delivery_client_updates.update_one(
            {"id": update_id}, {"$set": {"email_status": "queued"}}
        )
        return document

    render_ctx = {
        "first_name": _first_name(client.get("name")),
        "client_name": client.get("name") or "",
        "dog_name": dog.get("name") or "Dog",
        "program_name": ctx["program_name"],
        "day_number": ctx["day_number"],
        "total_days": ctx["total_days"],
        "session_date": session_date,
        "trainer_name": document["trainer_name"],
        "client_update": document["client_update"],
        "biggest_win": document["biggest_win"],
        "biggest_challenge": document["biggest_challenge"],
        "tomorrow_focus": document["tomorrow_focus"],
    }
    rows = [
        ("Dog", html.escape(render_ctx["dog_name"])),
        ("Program", html.escape(render_ctx["program_name"])),
        ("Training day", f"Day {ctx['day_number']} of {ctx['total_days']}"),
        ("Trainer", html.escape(document["trainer_name"])),
    ]
    cta_url = f"{email_service.APP_PUBLIC_URL}/" if email_service.APP_PUBLIC_URL else None
    sent_now = await email_service._dispatch(
        slug=_TEMPLATE_SLUG,
        to_email=email,
        ctx=render_ctx,
        rows=rows,
        cta_url=cta_url,
        body_html=_body_html(closeout),
        fallback_subject=f"{render_ctx['dog_name']} · Board & Train Day {ctx['day_number']} update",
        fallback_title=f"🐾 {render_ctx['dog_name']} · Day {ctx['day_number']}",
        fallback_intro=f"Hi {render_ctx['first_name']}, here's today's Board & Train update for {render_ctx['dog_name']}.",
        fallback_cta_text="Open Client Hub",
        outbox_key=outbox_key,
        on_success={
            "type": "notification_log",
            "key": outbox_key,
            "meta": {
                "kind": "client_board_train_daily_update",
                "client_id": client.get("id"),
                "dog_id": dog.get("id"),
                "enrollment_id": enrollment.get("id"),
                "session_date": session_date,
            },
        },
        queue_on_failure=True,
    )
    await db.trainer_delivery_client_updates.update_one(
        {"id": update_id},
        {"$set": {"email_status": "sent" if sent_now else "queued", "email_last_attempt_at": _now()}},
    )
    return document


def install_board_train_client_updates(*, server_module, db) -> None:
    if getattr(server_module, "_board_train_client_updates_installed", False):
        return
    _register_template()
    app = server_module.app

    async def _ensure_indexes() -> None:
        try:
            await db.trainer_delivery_client_updates.create_index(
                [("enrollment_id", 1), ("session_date", 1)],
                unique=True,
                name="uniq_board_train_client_update",
            )
            await db.trainer_delivery_client_updates.create_index(
                [("client_id", 1), ("session_date", -1)],
                name="board_train_updates_by_client",
            )
        except Exception as exc:
            logger.warning("Board & Train client-update index setup skipped (non-fatal): %s", exc)

    app.add_event_handler("startup", _ensure_indexes)

    @app.middleware("http")
    async def board_train_client_update_middleware(request: Request, call_next):
        path = request.url.path
        completion = _COMPLETE_RE.match(path) if request.method == "POST" else None
        manual = _MANUAL_CLOSEOUT_RE.match(path) if request.method == "POST" else None
        response = await call_next(request)
        if not (200 <= response.status_code < 300):
            return response
        try:
            if completion:
                draft = await db.training_session_drafts.find_one({"id": completion.group(1)}, {"_id": 0})
                bt = _BT_LABEL_RE.match(_clean((draft or {}).get("session_label")))
                if draft and bt:
                    session_date = bt.group(1)
                    closeout = await db.trainer_delivery_day_closeouts.find_one(
                        {"enrollment_id": draft.get("enrollment_id"), "session_date": session_date}, {"_id": 0}
                    )
                    enrollment = await db.dog_programs.find_one({"id": draft.get("enrollment_id")}, {"_id": 0})
                    if closeout and enrollment:
                        await _publish_closeout(db, enrollment, closeout)
            elif manual:
                school_id, session_date = manual.group(1), manual.group(2)
                school = await db.school_enrollments.find_one({"id": school_id}, {"_id": 0})
                enrollment = await db.dog_programs.find_one({"id": (school or {}).get("enrollment_id")}, {"_id": 0}) if school else None
                closeout = await db.trainer_delivery_day_closeouts.find_one(
                    {"enrollment_id": (enrollment or {}).get("id"), "session_date": session_date}, {"_id": 0}
                ) if enrollment else None
                if enrollment and closeout:
                    await _publish_closeout(db, enrollment, closeout)
        except Exception as exc:
            # Training completion must remain committed if a downstream client
            # notification has a transient issue. The hub update/email path is
            # durable and can be safely retried by reopening/saving closeout.
            logger.exception("Board & Train daily client update publish failed: %s", exc)
        return response

    def client_dep(user: dict = Depends(server_module.get_current_user)):
        if user.get("role") != "client":
            raise HTTPException(status_code=403, detail="Client access required")
        return user

    @app.get("/api/portal/board-train/updates")
    async def portal_board_train_updates(
        limit: int = Query(30, ge=1, le=100),
        user: dict = Depends(client_dep),
    ):
        client_id = await _client_id_for_user(db, user)
        if not client_id:
            return []
        return await db.trainer_delivery_client_updates.find(
            {"client_id": client_id}, {"_id": 0}
        ).sort([("session_date", -1), ("closed_at", -1)]).to_list(limit)

    server_module._board_train_client_updates_installed = True
    server_module._publish_board_train_closeout = _publish_closeout
