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
