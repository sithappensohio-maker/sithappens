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
    De-duped by `notification_log` key `birthday:{dog_id}:{YYYY-MM-DD}`."""
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
        # Sunday-only: homework weekly digest (weekday() returns 6 for Sunday).
        if datetime.now(timezone.utc).date().weekday() == 6:
            results["hw_weekly_digest"] = await run_homework_weekly_digest_job(db)
        # Monthly P&L only fires on the 1st of the month
        if date.today().day == 1:
            results["pl_monthly"] = await run_pl_monthly_job(db)
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
