"""Stage 11-13 Trainer Daily Queue — moved out of server.py unchanged.

One aggregate over canonical sources; every item is derived, deduped by the record
it points at, carries ONE primary action, and changes section as canonical state
changes. No stored queue status exists. The bodies below are the same code that
lived in server.py; only their module changed, with the server helpers they used
bound to injected dependencies.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import Depends
from typing import Dict, List, Optional


def make_trainer_day(*, api_dep, db, perms_for, business_today, business_date_from_timestamp, business_tz, staff_school_delivery_channels, booking_training_assignment_for_day, find_lesson_in_snapshot, module_name_in_snapshot, practice_review_rows, admin_school_checkpoints_pending, admin_school_trainer_assist_queue, admin_training_today, list_pending_reviews):
    """Build the Trainer Day aggregate bound to the host application's helpers."""
    _perms_for = perms_for
    _business_date_from_timestamp = business_date_from_timestamp
    BUSINESS_TZ = business_tz
    STAFF_SCHOOL_DELIVERY_CHANNELS = staff_school_delivery_channels
    _booking_training_assignment_for_day = booking_training_assignment_for_day
    _find_lesson_in_snapshot = find_lesson_in_snapshot
    _module_name_in_snapshot = module_name_in_snapshot
    _practice_review_rows = practice_review_rows

    # ─── Stage 11 — Trainer Daily Queue ────────────────────────────────────────
    #
    # ONE aggregate for "what does my training day need": today's training roster
    # (bookings + drafts), checkpoint / Practice / daily-tracker reviews, Trainer
    # Assist cases and the next few scheduled lessons — every item derived from the
    # canonical record it points at, deduped by that record, with ONE primary
    # action. No stored queue status, no second progression/scheduling engine.

    _TRAINER_DAY_SECTION_ORDER = ("needs_attention", "today", "continue", "upcoming", "done")
    _TRAINER_DAY_MODE_BY_CHANNEL = {"in_person_school": "in_person", "hybrid_school": "hybrid", "online_school": "online"}
    _TRAINER_DAY_RESOLUTION_LABELS = {
        "no_active_enrollment": "No active training program",
        "multiple_active_enrollments": "Two active programs — choose which one to train",
        "no_current_module": "No current module set",
        "no_lessons_in_module": "The current module has no lessons",
        "current_lesson_requires_resolution": "The current lesson needs an Admin decision",
        "legacy_curriculum_requires_migration": "Retired legacy program — move it into School first",
    }


    def _trainer_day_item(**kw) -> dict:
        """Normalised queue item. `action` is only present when there is a real
        thing to do; otherwise `no_action_reason` says why the row is here."""
        item = {
            "key": kw["key"], "kind": kw["kind"], "section": kw["section"], "priority": int(kw.get("priority", 50)),
            "since": kw.get("since"), "time": kw.get("time"), "mine": bool(kw.get("mine", True)),
            "dog": kw.get("dog") or {}, "client": kw.get("client") or {}, "program": kw.get("program") or {},
            "lesson": kw.get("lesson") or {}, "delivery_mode": kw.get("delivery_mode"),
            "state": kw.get("state") or "", "today_line": kw.get("today_line") or "", "next_line": kw.get("next_line") or "",
            "last_activity": kw.get("last_activity"),
            "action": kw.get("action"), "no_action_reason": kw.get("no_action_reason"),
            "secondary": kw.get("secondary") or [],
            "flags": kw.get("flags") or [],
            "assigned_trainer_id": kw.get("assigned_trainer_id"),
        }
        return item


    def _trainer_day_session_item(r: dict, mode: Optional[str], viewer_id: Optional[str], is_owner: bool) -> Optional[dict]:
        """A today-roster row → one queue item (TODAY / CONTINUE / NEEDS ATTENTION / DONE).
        `is_owner` = a staff account with no staff_role (the business owner / full-permission
        admin): everything is theirs. A trainer-tier account (any role, staff_role set) owns
        only the dogs assigned to them."""
        dog = {"id": r.get("dog_id"), "name": r.get("dog_name"), "photo": r.get("dog_photo") or ""}
        client = {"name": r.get("client_name")}
        program = {"name": r.get("program_name") or r.get("legacy_program_name"), "enrollment_id": r.get("enrollment_id")}
        lesson = {"module_name": r.get("current_module_name"), "lesson_name": r.get("current_lesson_name")}
        assigned = r.get("assigned_trainer_id")
        mine = is_owner or (bool(assigned) and assigned == viewer_id)
        booking_target = {"booking_id": r.get("booking_id"), "dog_id": r.get("dog_id"), "enrollment_id": r.get("enrollment_id")}
        status = r.get("session_status")
        when = r.get("time") or ""
        residential = bool(r.get("residential_training"))
        where = "Residential training" if residential else (f"In-person lesson at {when}" if when else "In-person lesson today")
        lesson_name = r.get("current_lesson_name") or "the current lesson"
        flags = []
        if not assigned:
            flags.append("unassigned")
        if r.get("client_question"):
            flags.append("client_question")
        if (r.get("media_awaiting_review") or 0) > 0:
            flags.append("media_awaiting_review")
        if (r.get("needs_reassessment_count") or 0) > 0:
            flags.append("needs_reassessment")
        base = dict(key=f"session:{r.get('booking_id')}", dog=dog, client=client, program=program, lesson=lesson,
                    delivery_mode=mode, time=when, mine=mine, flags=flags, assigned_trainer_id=assigned,
                    last_activity={"label": f"Last session with {r['last_trainer']}", "at": None} if r.get("last_trainer") else None)
        secondary = []
        if not r.get("checked_in") and status not in ("completed",):
            secondary.append({"kind": "check_in", "label": "Check in", "target": booking_target})
        secondary.append({"kind": "open_dog", "label": "View dog", "target": {"dog_id": r.get("dog_id")}})

        if status == "resolution_needed":
            reason = r.get("resolution_reason")
            legacy = reason == "legacy_curriculum_requires_migration"
            return _trainer_day_item(**base, kind="resolution_needed", section="needs_attention", priority=10,
                state="Cannot start yet", today_line=where,
                next_line=_TRAINER_DAY_RESOLUTION_LABELS.get(reason, "Needs attention before the session can start"),
                action=({"kind": "open_dog", "label": "Open dog", "target": {"dog_id": r.get("dog_id")}} if legacy
                        else {"kind": "resolve_session", "label": "Resolve", "target": booking_target}),
                secondary=secondary[1:] if legacy else secondary)
        # Board & Train daily statuses (trainer_delivery_enforcement) — same booking, AM/PM slots
        bt = r.get("board_train_daily") or {}
        if status in ("am_due", "pm_due", "am_in_progress", "closeout_pending", "needs_attention", "day_complete", "pickup_ready"):
            slot = "AM" if status.startswith("am") else "PM"
            if status == "day_complete":
                return _trainer_day_item(**base, kind="board_train", section="done", priority=90, state="Both sessions done",
                    today_line=f"Residential day {bt.get('day_number') or ''} of {bt.get('total_training_days') or ''}".strip(),
                    next_line="Nothing more today.", action={"kind": "view_session", "label": "View sessions", "target": booking_target}, secondary=secondary)
            if status == "pickup_ready":
                return _trainer_day_item(**base, kind="board_train", section="today", priority=45, state="Pickup today",
                    today_line="Residential stay ends today", next_line="Hand the dog back with the recap.",
                    action=None, no_action_reason="Nothing to train today — the stay ends at pickup.", secondary=secondary)
            if status == "needs_attention":
                return _trainer_day_item(**base, kind="board_train", section="needs_attention", priority=15, state="Residential day overdue",
                    today_line="Residential training", next_line="A required AM/PM session was missed — record or close it out.",
                    action={"kind": "resume_session", "label": "Open session", "target": booking_target}, secondary=secondary)
            in_progress = status in ("am_in_progress", "closeout_pending")
            return _trainer_day_item(**base, kind="board_train", section="continue" if in_progress else "today", priority=30 if in_progress else 40,
                state=f"{slot} session in progress" if in_progress else f"{slot} session due",
                today_line=f"Residential day {bt.get('day_number') or ''} of {bt.get('total_training_days') or ''}".strip(),
                next_line=f"Run {lesson_name} ({slot})",
                action={"kind": "resume_session" if in_progress else "start_session", "label": "Resume session" if in_progress else "Start session", "target": booking_target},
                secondary=secondary)
        if status == "completed":
            return _trainer_day_item(**base, kind="session", section="done", priority=90, state="Session finished",
                today_line=where, next_line="Recap and Practice are with the client.",
                action={"kind": "view_session", "label": "View session", "target": booking_target}, secondary=secondary[1:])
        if status in ("in_progress", "plan_ready"):
            started = "Session in progress" if status == "in_progress" else "Plan ready, not started"
            return _trainer_day_item(**base, kind="session", section="continue", priority=30, state=started,
                today_line=where, next_line=f"Resume {lesson_name} where you left off." if status == "in_progress" else f"Start {lesson_name} from the prepared plan.",
                action={"kind": "resume_session", "label": "Resume session", "target": booking_target}, secondary=secondary)
        # not_checked_in (scheduled, nothing started)
        return _trainer_day_item(**base, kind="session", section="today", priority=40, state="Scheduled",
            today_line=where, next_line=f"Run {lesson_name}.",
            action={"kind": "start_session", "label": "Start session", "target": booking_target}, secondary=secondary)


    def _business_clock(iso: Optional[str]) -> str:
        """'10:12 am' in the business timezone for a stored ISO timestamp ('' when unknown)."""
        if not iso:
            return ""
        try:
            dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            dt = dt.astimezone(BUSINESS_TZ)
            return f"{dt.hour % 12 or 12}:{dt.minute:02d} {'am' if dt.hour < 12 else 'pm'}"
        except Exception:
            return ""


    async def _trainer_day_done_today(today: str, viewer_id: Optional[str], is_owner: bool) -> List[dict]:
        """Stage 12 — what got finished today, read back from the records themselves.

        Practice reviews and daily-tracker reviews live on homework.section_logs
        (reviewed_at / reviewed_by_id), checkpoint grades on checkpoint_submissions
        (graded_at / graded_by), unbooked sessions on training_session_drafts
        (status completed, occurrence_date today; booked ones already come from the
        roster). `mine` = the viewer did it; the owner owns all of it."""
        out: List[dict] = []
        since = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()

        def done_item(key, kind, dog, client, program, state, when_iso, by_id, by_name, detail):
            clock = _business_clock(when_iso)
            who = "you" if by_id == viewer_id else (by_name or "a trainer")
            return _trainer_day_item(key=key, kind=kind, section="done", priority=92, since=when_iso, time=None,
                mine=is_owner or (bool(by_id) and by_id == viewer_id), assigned_trainer_id=by_id,
                dog=dog, client=client, program=program, lesson={}, delivery_mode=None, state=state,
                today_line=f"{detail} · {clock} by {who}" if clock else f"{detail} · by {who}",
                next_line="Nothing more to do on this one.", action=None, no_action_reason="Done.", secondary=[])

        hw_rows = await db.homework.find(
            {"section_logs": {"$elemMatch": {"reviewed_at": {"$gte": since}}}},
            {"_id": 0, "id": 1, "dog_id": 1, "dog_name": 1, "client_name": 1, "title": 1, "daily_tracker": 1, "section_logs": 1},
        ).to_list(300)
        for hw in hw_rows:
            for lo in hw.get("section_logs") or []:
                if not isinstance(lo, dict) or not lo.get("reviewed_at"):
                    continue
                if _business_date_from_timestamp(lo.get("reviewed_at")) != today:
                    continue
                dog = {"id": hw.get("dog_id"), "name": hw.get("dog_name"), "photo": ""}
                client = {"name": hw.get("client_name")}
                program = {"name": hw.get("title")}
                if hw.get("daily_tracker") and lo.get("submission_status") in ("approved", "needs_redo"):
                    verdict = "approved" if lo.get("submission_status") == "approved" else "sent back for another go"
                    out.append(done_item(f"done:daily:{hw['id']}:{lo.get('day_number')}", "done_daily_review", dog, client, program,
                                         "Daily work reviewed", lo.get("reviewed_at"), lo.get("reviewed_by_id"), lo.get("reviewed_by"),
                                         f"Day {lo.get('day_number')} {verdict}"))
                elif lo.get("review_status"):
                    verdict = {"looks_good": "Looks good", "keep_practicing": "Keep practicing"}.get(lo.get("review_status"), str(lo.get("review_status")).replace("_", " "))
                    out.append(done_item(f"done:practice:{hw['id']}:{lo.get('id')}", "done_practice_review", dog, client, program,
                                         "Practice reviewed", lo.get("reviewed_at"), lo.get("reviewed_by_id"), lo.get("reviewed_by"), verdict))

        for sub in await db.checkpoint_submissions.find(
            {"graded_at": {"$gte": since}},
            {"_id": 0, "id": 1, "dog_id": 1, "client_id": 1, "lesson_name": 1, "outcome": 1, "graded_at": 1, "graded_by": 1, "graded_by_name": 1},
        ).to_list(300):
            if _business_date_from_timestamp(sub.get("graded_at")) != today:
                continue
            verdict = {"advance": "Passed", "prescribe_practice": "Practice & resubmit", "hold": "Held"}.get(sub.get("outcome"), str(sub.get("outcome") or "graded").replace("_", " "))
            out.append(done_item(f"done:checkpoint:{sub['id']}", "done_checkpoint_review", {"id": sub.get("dog_id"), "name": None, "photo": ""}, {},
                                 {"name": None}, "Checkpoint graded", sub.get("graded_at"), sub.get("graded_by"), sub.get("graded_by_name"),
                                 f"{sub.get('lesson_name') or 'Checkpoint'} · {verdict}"))

        for d in await db.training_session_drafts.find(
            {"status": "completed", "occurrence_date": today, "booking_id": {"$in": [None, ""]}},
            {"_id": 0, "id": 1, "dog_id": 1, "enrollment_id": 1, "created_by": 1, "created_by_name": 1, "completed_at": 1, "updated_at": 1},
        ).to_list(200):
            out.append(done_item(f"done:draft:{d['id']}", "done_session", {"id": d.get("dog_id"), "name": None, "photo": ""}, {},
                                 {"enrollment_id": d.get("enrollment_id")}, "Session finished", d.get("completed_at") or d.get("updated_at"),
                                 d.get("created_by"), d.get("created_by_name"), "Lesson recorded"))
        return out


    async def build_trainer_day(user: dict) -> dict:
        perms = _perms_for(user)
        is_admin = user.get("role") == "admin"          # what the endpoints this queue links to gate on
        is_owner = is_admin and not user.get("staff_role")  # full-permission owner: every dog is "mine"
        viewer_id = user.get("id")
        # Stage 12 — the operations view (Everyone, Needs assignment, trainer chips) belongs to
        # whoever may assign staff; anyone else is a trainer and gets ONLY their own work.
        can_assign = is_owner or bool(perms.get("assign_training_staff"))
        today = business_today().isoformat()
        items: List[dict] = []
        omitted: List[str] = []

        # 1. Today's roster — the one per-day session source (bookings + drafts + practice flags).
        rows = await admin_training_today(user)
        enr_ids = [r.get("enrollment_id") for r in rows if r.get("enrollment_id")]
        enrs = {e["id"]: e for e in await db.dog_programs.find({"id": {"$in": enr_ids}}, {"_id": 0, "id": 1, "delivery_channel": 1}).to_list(500)} if enr_ids else {}
        for r in rows:
            mode = _TRAINER_DAY_MODE_BY_CHANNEL.get((enrs.get(r.get("enrollment_id")) or {}).get("delivery_channel"))
            it = _trainer_day_session_item(r, mode, viewer_id, is_owner)
            if it:
                items.append(it)

        # 1b. Sessions started today WITHOUT a booking (Log Session from the pipeline
        #     or the dog's Training tab): the draft is the canonical record, resumed
        #     through the same dog+enrollment bootstrap — never a second session.
        booked_enrollments = {r.get("enrollment_id") for r in rows if r.get("enrollment_id")}
        #     Stage 11.5 — an unfinished draft from an EARLIER day is still the trainer's
        #     work: it stays in CONTINUE ("Started yesterday") and resumes THAT draft
        #     (bootstrap ?draft_id=), never a duplicate. Finalized drafts never appear.
        loose_drafts = await db.training_session_drafts.find(
            {"status": {"$in": ["draft", "completing"]},
             "$or": [{"occurrence_date": {"$lt": today}}, {"booking_id": {"$in": [None, ""]}, "occurrence_date": today}]},
            {"_id": 0, "id": 1, "enrollment_id": 1, "dog_id": 1, "actuals": 1, "session_label": 1, "created_by_name": 1, "created_by": 1,
             "updated_at": 1, "created_at": 1, "occurrence_date": 1, "booking_id": 1},
        ).sort("occurrence_date", -1).to_list(200)
        loose_drafts = [d for d in loose_drafts if d.get("enrollment_id") and not (d.get("occurrence_date") == today and d["enrollment_id"] in booked_enrollments)]
        if loose_drafts:
            ld_enrs = {e["id"]: e for e in await db.dog_programs.find(
                {"id": {"$in": [d["enrollment_id"] for d in loose_drafts]}},
                {"_id": 0, "id": 1, "dog_id": 1, "status": 1, "delivery_channel": 1, "assigned_trainer_id": 1, "current_module_id": 1, "current_lesson_id": 1, "program_snapshot": 1},
            ).to_list(200)}
            ld_dogs = {d["id"]: d for d in await db.dogs.find({"id": {"$in": [e["dog_id"] for e in ld_enrs.values() if e.get("dog_id")]}}, {"_id": 0, "id": 1, "name": 1, "photo": 1, "owner_id": 1}).to_list(200)} if ld_enrs else {}
            ld_clients = {c["id"]: c.get("name") for c in await db.clients.find({"id": {"$in": [d.get("owner_id") for d in ld_dogs.values() if d.get("owner_id")]}}, {"_id": 0, "id": 1, "name": 1}).to_list(200)} if ld_dogs else {}
            for d in loose_drafts:
                enr = ld_enrs.get(d["enrollment_id"])
                dog = ld_dogs.get((enr or {}).get("dog_id") or d.get("dog_id")) or {}
                when = d.get("occurrence_date") or today
                started = "Started today" if when == today else ("Started yesterday" if when == (business_today() - timedelta(days=1)).isoformat() else f"Started {when}")
                by = f" by {d.get('created_by_name')}" if d.get("created_by_name") else ""
                resumable = bool(enr and enr.get("status") == "active" and enr.get("delivery_channel") in STAFF_SCHOOL_DELIVERY_CHANNELS)
                if not resumable:
                    # Named, never hidden: the draft exists but its program can no longer take a session.
                    why = ("its training program has been removed" if not enr else
                           "its training program is no longer active" if enr.get("status") != "active" else
                           "its program is not a trainer-led School program")
                    items.append(_trainer_day_item(key=f"draft:{d['id']}", kind="stale_draft", section="needs_attention", priority=70,
                        since=d.get("created_at"), mine=is_owner or d.get("created_by") == viewer_id,
                        dog={"id": (enr or {}).get("dog_id") or d.get("dog_id"), "name": dog.get("name"), "photo": dog.get("photo") or ""},
                        client={"name": ld_clients.get(dog.get("owner_id"))},
                        program={"name": ((enr or {}).get("program_snapshot") or {}).get("name"), "enrollment_id": d.get("enrollment_id")}, lesson={},
                        delivery_mode=_TRAINER_DAY_MODE_BY_CHANNEL.get((enr or {}).get("delivery_channel")),
                        state="Unfinished session can't be resumed", today_line=f"{started}{by}, never finished",
                        next_line=f"This session can't be resumed because {why}. Nothing from it was sent to the client.",
                        action=None, no_action_reason="Nothing to record here any more.",
                        secondary=([{"kind": "open_dog", "label": "View dog", "target": {"dog_id": dog.get("id")}}] if dog.get("id") else [])))
                    continue
                lesson = _find_lesson_in_snapshot(enr, enr.get("current_lesson_id")) or {}
                module_name = _module_name_in_snapshot(enr, enr.get("current_module_id"))
                recorded = any(v for v in (d.get("actuals") or {}).values())
                assigned = enr.get("assigned_trainer_id") or d.get("created_by")
                label = f" · {d.get('session_label')}" if d.get("session_label") and not str(d.get("session_label")).startswith("visit") else ""
                items.append(_trainer_day_item(key=f"draft:{d['id']}", kind="session", section="continue", priority=(30 if recorded else 35) + (0 if when == today else 2),
                    since=d.get("created_at"), time=None, mine=is_owner or (bool(assigned) and assigned == viewer_id), assigned_trainer_id=enr.get("assigned_trainer_id"),
                    dog={"id": enr.get("dog_id"), "name": dog.get("name"), "photo": dog.get("photo") or ""}, client={"name": ld_clients.get(dog.get("owner_id"))},
                    program={"name": (enr.get("program_snapshot") or {}).get("name"), "enrollment_id": enr["id"]},
                    lesson={"module_name": module_name, "lesson_name": lesson.get("name")},
                    delivery_mode=_TRAINER_DAY_MODE_BY_CHANNEL.get(enr.get("delivery_channel")),
                    state=("Session in progress" if recorded else "Session opened, nothing recorded yet") + ("" if when == today else " · unfinished"),
                    today_line=f"{started}{by}{label}",
                    next_line=f"Resume {lesson.get('name') or 'the current lesson'} where you left off." if recorded else f"Start recording {lesson.get('name') or 'the current lesson'}, or close it out.",
                    action={"kind": "resume_session", "label": "Resume session", "target": {"dog_id": enr.get("dog_id"), "enrollment_id": enr["id"], "draft_id": d["id"], "booking_id": d.get("booking_id") or None}},
                    secondary=[{"kind": "open_dog", "label": "View dog", "target": {"dog_id": enr.get("dog_id")}}]))

        # 2. School review work — the same canonical queues the specialised tools read.
        if perms.get("manage_school"):
            for c in await admin_school_checkpoints_pending(user):
                problem = c.get("context_problem")
                state = c.get("queue_state")
                if state == "trainer_assist_hold":
                    continue  # surfaced through the Trainer Assist case below
                dog = {"id": c.get("dog_id"), "name": c.get("dog_name"), "photo": c.get("dog_photo") or ""}
                target = {"submission_id": c.get("id")}
                if problem:
                    items.append(_trainer_day_item(key=f"checkpoint:{c['id']}", kind="checkpoint_context_problem", section="needs_attention", priority=60,
                        since=c.get("submitted_at"), dog=dog, client={"name": c.get("client_name")}, program={"school_enrollment_id": c.get("school_enrollment_id")},
                        lesson={"lesson_name": c.get("lesson_name")}, delivery_mode=None, state="Checkpoint cannot be graded",
                        today_line="Client submitted a checkpoint", next_line=problem, action=None,
                        no_action_reason="Nothing to grade until the client submits again.",
                        secondary=[{"kind": "review_checkpoint", "label": "Open in checkpoint queue", "target": target}]))
                    continue
                conflict = state == "state_conflict"
                items.append(_trainer_day_item(key=f"checkpoint:{c['id']}", kind="checkpoint_review", section="needs_attention", priority=25 if conflict else 20,
                    since=c.get("submitted_at"), dog=dog, client={"name": c.get("client_name")}, program={"school_enrollment_id": c.get("school_enrollment_id")},
                    lesson={"lesson_name": c.get("lesson_name")}, delivery_mode=None,
                    state="Needs reconciliation" if conflict else "Checkpoint to review",
                    today_line="Client submitted checkpoint work" + (" — the program moved since" if conflict else ""),
                    next_line="Reconcile the checkpoint" if conflict else "Review the checkpoint",
                    action={"kind": "review_checkpoint", "label": "Review checkpoint", "target": target}))
            for p in await _practice_review_rows(pending_only=True, limit=100):
                reasons = p.get("reasons") or []
                why = ", ".join(reasons) if reasons else "Practice submitted"
                items.append(_trainer_day_item(key=f"practice:{p.get('homework_id')}:{p.get('log_id')}", kind="practice_review", section="needs_attention", priority=40,
                    since=p.get("logged_at"), dog={"id": p.get("dog_id"), "name": p.get("dog_name"), "photo": p.get("dog_photo") or ""},
                    client={"name": p.get("client_name")}, program={"name": p.get("program_name"), "school_enrollment_id": p.get("school_enrollment_id"), "enrollment_id": p.get("enrollment_id")},
                    lesson={"module_name": p.get("module_name"), "lesson_name": p.get("lesson_name")}, delivery_mode=None,
                    state="Practice to review", today_line=f"Client logged Practice — {why}", next_line="Review the client's Practice",
                    action={"kind": "review_practice", "label": "Review practice", "target": {"homework_id": p.get("homework_id"), "section_log_id": p.get("log_id")}},
                    flags=(["client_question"] if (p.get("unanswered_questions") or 0) > 0 else [])))
            for a in await admin_school_trainer_assist_queue(user):
                items.append(_trainer_day_item(key=f"assist:{a.get('id')}", kind="trainer_assist", section="needs_attention", priority=50,
                    since=a.get("graded_at") or a.get("submitted_at"), dog={"id": a.get("dog_id"), "name": a.get("dog_name"), "photo": a.get("dog_photo") or ""},
                    client={"name": a.get("client_name")}, program={"name": a.get("program_name"), "school_enrollment_id": a.get("school_enrollment_id")},
                    lesson={"module_name": a.get("module_name"), "lesson_name": a.get("lesson_name")}, delivery_mode=None,
                    state="Trainer Assist open", today_line="You recommended Trainer Assist on the checkpoint", next_line="Contact the client, schedule the assist, then mark it complete",
                    action={"kind": "open_trainer_assist", "label": "Open Trainer Assist", "target": {"submission_id": a.get("id")}}))
        else:
            omitted.append("school_reviews")

        # 3. Daily-tracker day reviews — trainer work (manage_training_sessions), same gate as this queue.
        if perms.get("manage_training_sessions"):
            for d in await list_pending_reviews(user):
                items.append(_trainer_day_item(key=f"daily:{d.get('homework_id')}:{d.get('day_number')}", kind="daily_review", section="needs_attention", priority=30,
                    since=d.get("submitted_at"), dog={"id": d.get("dog_id"), "name": d.get("dog_name"), "photo": ""},
                    client={"name": d.get("client_name")}, program={"name": d.get("title")}, lesson={},
                    delivery_mode=None, state="Daily work to approve",
                    today_line=f"Day {d.get('day_number')} of {d.get('total_days')} submitted" + (" — could not complete" if d.get("could_not_complete") else ""),
                    next_line="Approve the day or send it back",
                    action={"kind": "review_daily", "label": "Review daily work", "target": {"homework_id": d.get("homework_id"), "day_number": d.get("day_number")}}))
        else:
            omitted.append("daily_reviews")

        # 4. Upcoming — the next scheduled training lessons (real bookings only), never manufactured.
        upcoming_cursor = db.bookings.find(
            {"service_type": "training", "status": {"$in": ["approved", "pending"]}, "date": {"$gt": today}},
            {"_id": 0, "id": 1, "date": 1, "time": 1, "dog_id": 1, "dog_name": 1, "training_daily_assignments": 1, "training_assigned_trainer_id": 1},
        ).sort([("date", 1), ("time", 1)]).limit(10)
        upcoming = await upcoming_cursor.to_list(10)
        up_dog_ids = [b.get("dog_id") for b in upcoming if b.get("dog_id")]
        up_dogs = {d["id"]: d for d in await db.dogs.find({"id": {"$in": up_dog_ids}}, {"_id": 0, "id": 1, "name": 1, "photo": 1, "owner_id": 1}).to_list(50)} if up_dog_ids else {}
        up_clients = {c["id"]: c.get("name") for c in await db.clients.find({"id": {"$in": [d.get("owner_id") for d in up_dogs.values() if d.get("owner_id")]}}, {"_id": 0, "id": 1, "name": 1}).to_list(50)} if up_dogs else {}
        for b in upcoming:
            dog = up_dogs.get(b.get("dog_id")) or {}
            assignment = _booking_training_assignment_for_day(b, str(b.get("date") or "")[:10])
            assigned = assignment.get("assigned_trainer_id")
            items.append(_trainer_day_item(key=f"upcoming:{b['id']}", kind="upcoming_booking", section="upcoming", priority=80,
                since=None, time=f"{b.get('date')} {b.get('time') or ''}".strip(), mine=is_owner or (bool(assigned) and assigned == viewer_id),
                dog={"id": b.get("dog_id"), "name": dog.get("name") or b.get("dog_name"), "photo": dog.get("photo") or ""},
                client={"name": up_clients.get(dog.get("owner_id"))}, program={}, lesson={}, delivery_mode="in_person",
                state="Scheduled", today_line=f"Lesson on {b.get('date')}" + (f" at {b.get('time')}" if b.get("time") else ""),
                next_line="Nothing to do until then.", action=None, no_action_reason="Starts on its scheduled day.",
                secondary=[{"kind": "open_dog", "label": "View dog", "target": {"dog_id": b.get("dog_id")}}]))

        # 3b. Stage 12 — DONE TODAY is derived from the canonical records the work left behind
        #     (no stored completion log): practice / daily-tracker logs reviewed today,
        #     checkpoints graded today, unbooked sessions finished today.
        items.extend(await _trainer_day_done_today(today, viewer_id, is_owner))

        # 4a. Stage 11.5 — review work is "mine" for the trainer the dog's program is assigned
        #     to (the same assignment sessions use); the owner owns everything.
        #     Stage 12 — work that needs a trainer and has none is flagged `needs_assignment`
        #     (sessions/bookings without a trainer; review work whose dog's active trainer-led
        #     or hybrid program has no trainer — online-only programs are reviewed by the
        #     owner by default and are not flagged).
        review_kinds = {"checkpoint_review", "checkpoint_context_problem", "practice_review", "trainer_assist", "daily_review"}
        rv_dogs = {it["dog"].get("id") for it in items if it["kind"] in review_kinds and it["dog"].get("id")}
        assigned_by_dog: Dict[str, set] = {}
        staff_led_dogs: set = set()
        if rv_dogs:
            for e in await db.dog_programs.find({"dog_id": {"$in": list(rv_dogs)}, "status": "active"},
                                                {"_id": 0, "dog_id": 1, "assigned_trainer_id": 1, "delivery_channel": 1}).to_list(500):
                if e.get("assigned_trainer_id"):
                    assigned_by_dog.setdefault(e["dog_id"], set()).add(e["assigned_trainer_id"])
                if e.get("delivery_channel") in STAFF_SCHOOL_DELIVERY_CHANNELS:
                    staff_led_dogs.add(e["dog_id"])
        for it in items:
            it["needs_assignment"] = False
            if it["kind"] in review_kinds:
                owners = assigned_by_dog.get(it["dog"].get("id"), set())
                if not is_owner:
                    it["mine"] = viewer_id in owners
                it["assigned_trainer_id"] = next(iter(owners), None)
                if not owners and it["dog"].get("id") in staff_led_dogs:
                    it["needs_assignment"] = True
                    if "unassigned" not in it["flags"]:
                        it["flags"].append("unassigned")
            elif it["kind"] in ("session", "board_train", "upcoming_booking") and "unassigned" in it["flags"] and it["section"] != "done":
                it["needs_assignment"] = True
        if not can_assign:
            # A trainer is never handed work nobody assigned to them — the owner assigns it.
            items = [it for it in items if it["mine"]]

        # 4b. Rows from queues that only carry ids (daily-tracker homework) get the dog's real name.
        missing = {it["dog"].get("id") for it in items if it["dog"].get("id") and not it["dog"].get("name")}
        if missing:
            fill = {d["id"]: d for d in await db.dogs.find({"id": {"$in": list(missing)}}, {"_id": 0, "id": 1, "name": 1, "photo": 1, "owner_id": 1}).to_list(200)}
            owners = {c["id"]: c.get("name") for c in await db.clients.find({"id": {"$in": [d.get("owner_id") for d in fill.values() if d.get("owner_id")]}}, {"_id": 0, "id": 1, "name": 1}).to_list(200)} if fill else {}
            for it in items:
                d = fill.get(it["dog"].get("id"))
                if d and not it["dog"].get("name"):
                    it["dog"]["name"] = d.get("name")
                    it["dog"]["photo"] = it["dog"].get("photo") or d.get("photo") or ""
                    if not it["client"].get("name"):
                        it["client"]["name"] = owners.get(d.get("owner_id"))

        # 5. Dedupe by record key, then order: section → priority → oldest first (reviews) / time (sessions).
        seen = set()
        unique = []
        for it in items:
            if it["key"] in seen:
                continue
            seen.add(it["key"])
            unique.append(it)
        order = {k: i for i, k in enumerate(_TRAINER_DAY_SECTION_ORDER)}
        unique.sort(key=lambda it: (order.get(it["section"], 99), it["priority"], it.get("since") or "", it.get("time") or "", it["dog"].get("name") or ""))
        counts = {k: 0 for k in _TRAINER_DAY_SECTION_ORDER}
        for it in unique:
            counts[it["section"]] = counts.get(it["section"], 0) + 1
        counts["needs_assignment"] = sum(1 for it in unique if it.get("needs_assignment"))
        return {
            "date": today,
            "viewer": {"id": viewer_id, "is_admin": is_admin, "is_owner": is_owner, "can_manage_school": bool(perms.get("manage_school")),
                       "can_assign": can_assign},
            "counts": counts, "omitted": omitted, "items": unique,
        }


    async def admin_training_day(user: dict = Depends(api_dep)):
        """Stage 11 — the trainer's day in one ordered queue (see _build_trainer_day)."""
        return await build_trainer_day(user)

    return build_trainer_day, admin_training_day
