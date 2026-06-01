"""Daily background tasks for Sit Happens.

We avoid an in-process scheduler (one less moving part for a solo-operator
deploy) by lazily triggering this runner whenever the admin dashboard loads.
The `system_runs` collection tracks the last successful run-date for each
job_id so each job fires at most once per day, no matter how many times the
admin opens the dashboard.

Each job is fully idempotent on its own (de-duped by `notification_log`
entries) — the system_runs gate is just a perf shortcut to avoid re-iterating
all dogs on every dashboard hit.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict

import email_service

logger = logging.getLogger(__name__)

VACCINE_NUDGE_DAYS = 30
VACCINE_FIELDS = (("rabies", "Rabies"), ("bordetella", "Bordetella"), ("dhpp", "DHPP"))


def _today_iso() -> str:
    return datetime.now(timezone.utc).date().isoformat()


async def _already_notified(db, key: str) -> bool:
    return bool(await db.notification_log.find_one({"key": key}, {"_id": 0, "key": 1}))


async def _mark_notified(db, key: str, meta: Dict[str, Any]) -> None:
    await db.notification_log.insert_one({
        "key": key,
        "sent_at": datetime.now(timezone.utc).isoformat(),
        **meta,
    })


async def _client_for_dog(db, dog: dict) -> dict | None:
    owner_id = dog.get("owner_id")
    if not owner_id:
        return None
    return await db.clients.find_one({"id": owner_id}, {"_id": 0})


async def run_birthday_job(db) -> dict:
    """Email every owner whose dog's birthday matches today (MM-DD).
    De-duped by `notification_log` key `birthday:{dog_id}:{YYYY-MM-DD}`.
    Skipped entirely when Settings → Email Automation → Birthday is OFF."""
    # Sprint 110aw — honour the per-install enable toggle. Default = ON
    # (preserves the behavior since Sprint 38).
    settings = await db.settings.find_one({"id": "global"}, {"_id": 0}) or {}
    if not (settings.get("birthday_email") or {"enabled": True}).get("enabled", True):
        return {"sent": 0, "skipped": 0, "disabled": True}
    today = datetime.now(timezone.utc).date()
    mm_dd = today.strftime("%m-%d")
    sent = 0
    skipped = 0
    async for dog in db.dogs.find({}, {"_id": 0}):
        bd = (dog.get("birthday") or "").strip()
        if len(bd) < 10:
            continue
        # birthday stored as YYYY-MM-DD
        if bd[5:10] != mm_dd:
            continue
        key = f"birthday:{dog.get('id')}:{today.isoformat()}"
        if await _already_notified(db, key):
            skipped += 1
            continue
        client = await _client_for_dog(db, dog)
        if not client or not client.get("email"):
            skipped += 1
            continue
        try:
            await email_service.notify_client_dog_birthday(client, dog)
            await _mark_notified(db, key, {"job": "birthday", "dog_id": dog.get("id"), "client_id": client.get("id")})
            sent += 1
        except Exception as e:
            logger.warning("birthday email failed for dog=%s: %s", dog.get("id"), e)
    return {"sent": sent, "skipped": skipped}


async def run_vaccine_expiry_job(db) -> dict:
    """Email owners whose dog has any vaccine expiring exactly `VACCINE_NUDGE_DAYS`
    days from today. One email per dog, listing all expiring vaccines.
    De-duped per (dog, target-date)."""
    target = datetime.now(timezone.utc).date() + timedelta(days=VACCINE_NUDGE_DAYS)
    target_iso = target.isoformat()
    sent = 0
    skipped = 0
    async for dog in db.dogs.find({}, {"_id": 0}):
        vaccines = dog.get("vaccines") or {}
        expiring = []
        for field, label in VACCINE_FIELDS:
            v = (vaccines.get(field) or "").strip()
            if len(v) < 10:
                continue
            if v[:10] == target_iso:
                expiring.append({"name": label, "expires_on": v[:10]})
        if not expiring:
            continue
        key = f"vax30:{dog.get('id')}:{target_iso}"
        if await _already_notified(db, key):
            skipped += 1
            continue
        client = await _client_for_dog(db, dog)
        if not client or not client.get("email"):
            skipped += 1
            continue
        try:
            await email_service.notify_client_vaccine_expiring(client, dog, expiring)
            await _mark_notified(db, key, {
                "job": "vaccine_expiry_30d",
                "dog_id": dog.get("id"),
                "client_id": client.get("id"),
                "vaccines": [v["name"] for v in expiring],
            })
            sent += 1
        except Exception as e:
            logger.warning("vaccine nudge failed for dog=%s: %s", dog.get("id"), e)
    return {"sent": sent, "skipped": skipped}


async def run_pl_monthly_job(db) -> Dict[str, Any]:
    """Generate the previous month's P&L PDF and email it to the admin.
    Idempotent — keyed by `pl:YYYY-MM` in `notification_log` so re-runs are no-ops."""
    import pl_report
    today = date.today()
    # Last full month: if today is Jan 1, the previous month is December of last year.
    if today.month == 1:
        year, month = today.year - 1, 12
    else:
        year, month = today.year, today.month - 1
    start = date(year, month, 1)
    if month == 12:
        end = date(year + 1, 1, 1) - timedelta(days=1)
    else:
        end = date(year, month + 1, 1) - timedelta(days=1)
    start_iso, end_iso = start.isoformat(), end.isoformat()
    key = f"pl:{year}-{month:02d}"
    if await _already_notified(db, key):
        return {"skipped": True, "key": key}
    try:
        # Fetch brand name (avoid circular import — read directly from db)
        settings = await db.settings.find_one({"id": "site"}, {"_id": 0}) or {}
        brand_name = settings.get("brand_name") or "Sit Happens"
        data = await pl_report.build_pl_data(db, start_iso, end_iso)
        pdf_bytes = await asyncio.to_thread(pl_report.render_pl_pdf, data, brand_name)
        await email_service.notify_admin_pl_report(pdf_bytes, start_iso, end_iso, data)
        await _mark_notified(db, key, {
            "job": "pl_monthly",
            "start_date": start_iso,
            "end_date": end_iso,
            "net": data["net"],
        })
        return {"sent": True, "key": key, "start_date": start_iso, "end_date": end_iso, "net": data["net"]}
    except Exception as e:
        logger.warning("pl_monthly failed for %s: %s", key, e)
        return {"error": str(e), "key": key}





async def run_homework_weekly_digest_job(db) -> dict:
    """Sunday-night digest: for every client with at least one active daily-tracker
    homework, send a recap of streaks, photos, and your review notes.

    De-duped per (client, week_start_iso) so it can't double-send if the dashboard
    is hit twice on a Sunday.
    """
    today = datetime.now(timezone.utc).date()
    # week_start = the Monday on or before today (always returns a Mon→Sun window)
    monday = today - timedelta(days=today.weekday())
    sunday = monday + timedelta(days=6)
    week_start = monday.isoformat()
    week_end = sunday.isoformat()

    # Group active daily-tracker homework by client_id.
    # Include any daily-tracker that's not yet completed OR was completed in the
    # past 14 days (so a fresh "you finished!" recap goes out at week-end).
    fortnight_ago = (today - timedelta(days=14)).isoformat()
    by_client: Dict[str, list] = {}
    async for hw in db.homework.find(
        {
            "daily_tracker": True,
            "$or": [
                {"status": {"$ne": "completed"}},
                {"completed_at": {"$gte": fortnight_ago}},
            ],
        },
        {"_id": 0},
    ):
        cid = hw.get("client_id")
        if not cid:
            continue
        by_client.setdefault(cid, []).append(hw)

    sent = 0
    skipped = 0
    attempted = 0
    errors: list = []
    for cid, hws in by_client.items():
        key = f"hw_digest:{cid}:{week_start}"
        if await _already_notified(db, key):
            skipped += 1
            continue
        client = await db.clients.find_one({"id": cid}, {"_id": 0}) or {}
        if not client.get("email"):
            continue

        items = []
        for hw in hws:
            sections = sorted(
                [s for s in (hw.get("template_snapshot") or {}).get("sections", []) if s.get("day_number")],
                key=lambda s: int(s.get("day_number") or 0),
            )
            if not sections:
                continue
            logs = hw.get("section_logs") or []
            log_by_day = {int(lo.get("day_number") or 0): lo for lo in logs}
            approved_days = [s for s in sections if (log_by_day.get(int(s["day_number"])) or {}).get("submission_status") == "approved"]
            this_week_approved = [
                lo for lo in logs
                if lo.get("submission_status") == "approved"
                and week_start <= (lo.get("date") or "") <= week_end
            ]
            # Streak = consecutive approved days from Day 1
            streak = 0
            for s in sections:
                if (log_by_day.get(int(s["day_number"])) or {}).get("submission_status") == "approved":
                    streak += 1
                else:
                    break
            # Photos from this week's approved days
            photos: list = []
            for lo in this_week_approved:
                p = (lo.get("field_values") or {}).get("__photo")
                if p:
                    photos.append(p)
            # Trainer notes from this week
            notes_collected = []
            for lo in this_week_approved:
                if lo.get("review_note"):
                    sec = next((s for s in sections if int(s.get("day_number") or 0) == int(lo.get("day_number") or 0)), {})
                    notes_collected.append({
                        "day": int(lo.get("day_number") or 0),
                        "focus": sec.get("day_focus", ""),
                        "note": lo["review_note"],
                    })
            # Next focus = first available/locked day
            next_focus = ""
            for s in sections:
                lo = log_by_day.get(int(s["day_number"]))
                if not lo or lo.get("submission_status") in ("needs_redo",):
                    next_focus = s.get("day_focus", "")
                    break
            items.append({
                "hw_title": hw.get("title", ""),
                "dog_name": hw.get("dog_name", ""),
                "total_days": len(sections),
                "approved_total": len(approved_days),
                "approved_this_week": len(this_week_approved),
                "streak": streak,
                "photos": photos,
                "notes": notes_collected,
                "next_focus": next_focus,
                "_activity_this_week": len(this_week_approved) + len([
                    lo for lo in logs
                    if week_start <= (lo.get("date") or "") <= week_end
                ]),
            })

        # Keep only items that had actual activity this week so we don't spam.
        items = [it for it in items if it.pop("_activity_this_week", 0) > 0]

        if not items:
            continue

        try:
            attempted += 1
            ok = await email_service.notify_client_weekly_homework_digest(
                client, items, week_start, week_end,
            )
            if ok:
                await _mark_notified(db, key, {
                    "job": "hw_weekly_digest",
                    "client_id": cid,
                    "week_start": week_start,
                    "items": len(items),
                })
                sent += 1
            else:
                errors.append({"client_id": cid, "reason": "email_send_failed"})
        except Exception as exc:
            logger.warning("hw_weekly_digest failed for client=%s: %s", cid, exc)
            errors.append({"client_id": cid, "reason": str(exc)[:200]})

    return {
        "sent": sent,
        "attempted": attempted,
        "skipped": skipped,
        "errors": errors,
        "week_start": week_start,
        "week_end": week_end,
    }


async def run_homework_practice_reminder_job(db) -> dict:
    """Daily 'time to practice' nudge for clients who opted in and whose
    reminder window includes today. Skips clients whose only open day was
    already submitted/approved today (no point pinging if they already did it)."""
    now = datetime.now(timezone.utc)
    today_iso = now.date().isoformat()
    weekday_keys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
    today_dow = weekday_keys[now.date().weekday()]

    # Find opt-in clients whose day-of-week matches today
    cursor = db.clients.find({
        "homework_reminder_enabled": True,
        "homework_reminder_days": today_dow,
        "email": {"$exists": True, "$ne": ""},
    }, {"_id": 0})

    sent = 0
    attempted = 0
    errors: list = []
    async for client in cursor:
        # De-dup: one reminder per client per day
        key = f"hw_reminder:{client['id']}:{today_iso}"
        if await _already_notified(db, key):
            continue
        # Find their active daily-trackers with a day that needs the client's action
        hws = await db.homework.find(
            {"client_id": client["id"], "daily_tracker": True, "status": {"$ne": "completed"}},
            {"_id": 0},
        ).to_list(50)
        plans = []
        for hw in hws:
            sections = sorted(
                [s for s in (hw.get("template_snapshot") or {}).get("sections", []) if s.get("day_number")],
                key=lambda s: int(s.get("day_number") or 0),
            )
            logs_by_day = {int(lo.get("day_number") or 0): lo for lo in (hw.get("section_logs") or [])}
            # find first day that's available/needs_redo
            prev_passed = True
            for s in sections:
                dn = int(s["day_number"])
                lo = logs_by_day.get(dn)
                status = (lo or {}).get("submission_status") or ("available" if prev_passed else "locked")
                if status in ("available", "needs_redo"):
                    # If they ALREADY logged today, don't ping
                    if lo and (lo.get("logged_at") or "")[:10] == today_iso:
                        prev_passed = status in ("approved", "rest")
                        continue
                    plans.append({
                        "hw_title": hw.get("title", ""),
                        "dog_name": hw.get("dog_name", ""),
                        "today_focus": s.get("day_focus", ""),
                        "day_number": dn,
                        "total_days": len(sections),
                    })
                    break  # only the next-up day per plan
                prev_passed = status in ("approved", "rest")
        if not plans:
            continue
        attempted += 1
        try:
            ok = await email_service.notify_client_homework_reminder(client, plans)
            if ok:
                await _mark_notified(db, key, {"job": "hw_reminder", "client_id": client["id"], "plans": len(plans)})
                sent += 1
            else:
                errors.append({"client_id": client["id"], "reason": "email_send_failed"})
        except Exception as exc:
            logger.warning("hw_reminder failed for client=%s: %s", client["id"], exc)
            errors.append({"client_id": client["id"], "reason": str(exc)[:200]})

    return {"sent": sent, "attempted": attempted, "errors": errors, "weekday": today_dow}


async def run_homework_step_rollup_job(db) -> dict:
    """Sprint 105 — daily roll-up email of every homework step completed
    today across all clients. Dedups once per day. Skips entirely if no
    steps were completed."""
    from email_service import _send, ADMIN_NOTIFICATION_EMAIL  # type: ignore
    if not ADMIN_NOTIFICATION_EMAIL:
        return {"sent": 0, "reason": "no admin email"}

    today = datetime.now(timezone.utc).date()
    today_iso = today.isoformat()
    dedup_key = f"hw_step_rollup:{today_iso}"
    existing = await db.system_runs.find_one({"id": dedup_key}, {"_id": 0})
    if existing:
        return {"sent": 0, "skipped_already_sent": True}

    cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
    grouped: Dict[str, dict] = {}
    async for ev in db.step_events.find({"ts": {"$gte": cutoff}, "done": True}, {"_id": 0}):
        key = f"{ev.get('client_id')}|{ev.get('homework_id')}|{ev.get('day_number')}"
        g = grouped.setdefault(key, {
            "client_name": ev.get("client_name", "—"),
            "dog_name": ev.get("dog_name", "—"),
            "title": ev.get("homework_title", "—"),
            "day_number": ev.get("day_number"),
            "steps": [],
        })
        g["steps"].append(ev.get("step_label") or ev.get("step_id"))

    if not grouped:
        await db.system_runs.update_one(
            {"id": dedup_key},
            {"$set": {"id": dedup_key, "ran_at": datetime.now(timezone.utc).isoformat(), "sent": 0}},
            upsert=True,
        )
        return {"sent": 0, "reason": "no step events today"}

    rows_html = ""
    for g in grouped.values():
        steps_list = "".join(f"<li>{s}</li>" for s in g["steps"])
        rows_html += (
            f"<div style='margin:0 0 16px 0;padding:12px 16px;background:#f8fafc;border-left:3px solid #8cc63f;border-radius:4px;'>"
            f"<p style='margin:0 0 4px 0;font-weight:700;color:#0f172a;'>{g['dog_name']} · {g['title']}</p>"
            f"<p style='margin:0 0 8px 0;color:#475569;font-size:13px;'>Day {g['day_number']} · {g['client_name']}</p>"
            f"<ul style='margin:0;padding-left:18px;color:#1e293b;font-size:14px;'>{steps_list}</ul></div>"
        )

    total = sum(len(g["steps"]) for g in grouped.values())
    subj = f"Today's training progress · {total} step{'s' if total != 1 else ''} done"
    body_html = (
        '<html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f1f5f9;margin:0;padding:24px;">'
        '<table style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;">'
        f'<tr><td style="padding:20px 32px;background:#0f172a;color:#fff;"><h1 style="margin:0;font-size:20px;">{subj}</h1>'
        f'<p style="margin:4px 0 0 0;color:#94a3b8;font-size:13px;">Date: {today_iso}</p></td></tr>'
        f'<tr><td style="padding:24px 32px;">{rows_html}'
        '<p style="color:#64748b;font-size:12px;margin-top:16px;">Per-step emails are off. To get an email on every step instead of this nightly roll-up, go to Settings → Notifications.</p>'
        '</td></tr></table></body></html>'
    )
    sent = await _send(ADMIN_NOTIFICATION_EMAIL, subj, body_html)
    await db.system_runs.update_one(
        {"id": dedup_key},
        {"$set": {"id": dedup_key, "ran_at": datetime.now(timezone.utc).isoformat(), "sent": int(bool(sent)), "total_steps": total}},
        upsert=True,
    )
    return {"sent": int(bool(sent)), "total_steps": total, "grouped_keys": len(grouped)}



async def run_trainer_monday_digest_job(db) -> dict:
    """Monday-morning digest to the admin/operator.
    Wraps the week ahead: streak leaders, stale review queue, unanswered
    questions, lost-the-streak nudge list, just-completed plans, vaccines
    expiring this week, this-week booking forecast.

    Sent to ADMIN_NOTIFICATION_EMAIL (a single recipient — the operator).
    """
    today = datetime.now(timezone.utc).date()
    week_start = today.isoformat()
    week_end = (today + timedelta(days=6)).isoformat()
    key = f"trainer_monday_digest:{week_start}"
    if await _already_notified(db, key):
        return {"skipped_already_sent": True, "key": key}

    streak_leaders: list = []
    lost_streak: list = []
    just_completed: list = []
    pending_reviews: list = []
    unanswered_qs: list = []
    expiring_vax: list = []
    week_bookings = 0
    week_revenue_forecast = 0.0

    # ── Walk all daily-tracker homework
    async for hw in db.homework.find({"daily_tracker": True}, {"_id": 0}):
        sections = sorted(
            [s for s in (hw.get("template_snapshot") or {}).get("sections", []) if s.get("day_number")],
            key=lambda s: int(s.get("day_number") or 0),
        )
        logs_by_day = {int(lo.get("day_number") or 0): lo for lo in (hw.get("section_logs") or [])}
        streak = 0
        for s in sections:
            st = (logs_by_day.get(int(s["day_number"])) or {}).get("submission_status")
            if st in ("approved", "rest"):
                streak += 1
            else:
                break
        if streak >= 3 and hw.get("status") != "completed":
            streak_leaders.append({"dog": hw.get("dog_name", ""), "client": hw.get("client_name", ""), "title": hw.get("title", ""), "streak": streak})
        # Lost-the-streak: had >= 3 approved days, but last 2 days idle
        last_two_idle = True
        last_two = sections[max(0, len(sections) - 2):]
        for s in last_two:
            lo = logs_by_day.get(int(s["day_number"]))
            if lo and lo.get("submission_status") in ("approved", "submitted", "rest"):
                last_two_idle = False
                break
        if streak >= 3 and last_two_idle and hw.get("status") != "completed":
            lost_streak.append({"dog": hw.get("dog_name", ""), "client": hw.get("client_name", ""), "title": hw.get("title", ""), "streak_was": streak})
        # Pending reviews
        for lo in hw.get("section_logs") or []:
            if lo.get("submission_status") == "submitted":
                pending_reviews.append({
                    "dog": hw.get("dog_name", ""),
                    "client": hw.get("client_name", ""),
                    "title": hw.get("title", ""),
                    "day": int(lo.get("day_number") or 0),
                    "submitted_at": lo.get("logged_at"),
                })
            for q in (lo.get("questions") or []):
                if not q.get("answer"):
                    unanswered_qs.append({
                        "dog": hw.get("dog_name", ""),
                        "client": hw.get("client_name", ""),
                        "day": int(lo.get("day_number") or 0),
                        "text": q.get("text", ""),
                        "asked_at": q.get("asked_at"),
                    })
        # Just-completed (in past 7 days, no cert yet uploaded)
        if hw.get("status") == "completed" and not hw.get("certificate"):
            ca = hw.get("completed_at") or ""
            if ca and ca[:10] >= (today - timedelta(days=7)).isoformat():
                just_completed.append({"dog": hw.get("dog_name", ""), "client": hw.get("client_name", ""), "title": hw.get("title", ""), "completed_at": ca[:10], "homework_id": hw["id"]})

    streak_leaders.sort(key=lambda x: -x["streak"])
    pending_reviews.sort(key=lambda x: x.get("submitted_at") or "")
    unanswered_qs.sort(key=lambda x: x.get("asked_at") or "")

    # ── Vaccines expiring this week
    in_week = (today + timedelta(days=7)).isoformat()
    today_iso = today.isoformat()
    dismissals = await db.vaccine_dismissals.find({}, {"_id": 0}).to_list(2000)
    dismissed = {d["dog_id"] for d in dismissals if d.get("until", "") > datetime.now(timezone.utc).isoformat()}
    async for dog in db.dogs.find({}, {"_id": 0, "id": 1, "name": 1, "owner_id": 1, "vaccines": 1}):
        if dog["id"] in dismissed:
            continue
        vac = dog.get("vaccines") or {}
        for v in ["rabies", "dhpp", "bordetella"]:
            r = vac.get(v, "")
            if r and today_iso <= r <= in_week:
                owner = await db.clients.find_one({"id": dog.get("owner_id")}, {"_id": 0, "name": 1}) or {}
                expiring_vax.append({"dog": dog["name"], "client": owner.get("name", ""), "vaccine": v, "expires": r})
                break

    # ── This week's bookings + revenue forecast
    async for b in db.bookings.find({"date": {"$gte": week_start, "$lte": week_end}, "status": {"$ne": "cancelled"}}, {"_id": 0, "actual_price": 1, "base_price": 1}):
        week_bookings += 1
        week_revenue_forecast += float(b.get("actual_price") or b.get("base_price") or 0)
    week_revenue_forecast = round(week_revenue_forecast, 2)

    if not (streak_leaders or lost_streak or just_completed or pending_reviews or unanswered_qs or expiring_vax or week_bookings):
        return {"sent": 0, "reason": "nothing_to_report", "week_start": week_start}

    try:
        ok = await email_service.notify_trainer_monday_digest({
            "week_start": week_start,
            "week_end": week_end,
            "streak_leaders": streak_leaders[:8],
            "lost_streak": lost_streak[:8],
            "just_completed": just_completed[:8],
            "pending_reviews": pending_reviews[:10],
            "unanswered_qs": unanswered_qs[:10],
            "expiring_vax": expiring_vax[:8],
            "week_bookings": week_bookings,
            "week_revenue_forecast": week_revenue_forecast,
        })
        if ok:
            await _mark_notified(db, key, {"job": "trainer_monday_digest", "week_start": week_start})
            return {"sent": 1, "week_start": week_start, "week_end": week_end}
        return {"sent": 0, "reason": "email_send_failed", "week_start": week_start}
    except Exception as exc:
        logger.warning("trainer_monday_digest failed: %s", exc)
        return {"sent": 0, "reason": str(exc)[:200], "week_start": week_start}


async def maybe_run_daily(db) -> dict | None:
    """Run every daily job at most once per UTC day. Returns a summary dict
    on the first call of the day, or None if already ran today.
    Lazy-triggered from the admin dashboard endpoint."""
    today = _today_iso()
    existing = await db.system_runs.find_one({"id": "daily"}, {"_id": 0})
    if existing and existing.get("last_run") == today:
        return None
    # Reserve the slot first so concurrent dashboard loads don't double-run.
    await db.system_runs.update_one(
        {"id": "daily"},
        {"$set": {"id": "daily", "last_run": today, "started_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    try:
        results = {}
        results["birthdays"] = await run_birthday_job(db)
        results["vaccine_expiry"] = await run_vaccine_expiry_job(db)
        results["hw_reminder"] = await run_homework_practice_reminder_job(db)
        results["hw_step_rollup"] = await run_homework_step_rollup_job(db)
        # Monday-only: trainer's weekly digest (weekday() returns 0 for Monday).
        if datetime.now(timezone.utc).date().weekday() == 0:
            results["trainer_monday_digest"] = await run_trainer_monday_digest_job(db)
        # Sunday-only: homework weekly digest (weekday() returns 6 for Sunday).
        if datetime.now(timezone.utc).date().weekday() == 6:
            results["hw_weekly_digest"] = await run_homework_weekly_digest_job(db)
        # Monthly P&L only fires on the 1st of the month
        if date.today().day == 1:
            results["pl_monthly"] = await run_pl_monthly_job(db)
        # Sprint 110o — auto-backup removed (was unreliable in unprivileged
        # Docker containers; admin uses manual backup + host-side rclone timer).
        await db.system_runs.update_one(
            {"id": "daily"},
            {"$set": {"finished_at": datetime.now(timezone.utc).isoformat(), "last_result": results}},
        )
        logger.info("daily jobs complete: %s", results)
        return results
    except Exception as e:
        logger.error("daily jobs failed: %s", e)
        # Reset so the next dashboard hit retries.
        await db.system_runs.update_one({"id": "daily"}, {"$set": {"last_run": None, "error": str(e)}})
        raise


