"""In-process job scheduler with a Mongo lease.

Why this exists: every automated job (birthday / vaccine / practice emails,
weekly digests, the monthly P&L, booking archival, trophy re-checks, the
nightly backup) used to fire only from `GET /dashboard/stats` — i.e. only
when an ADMIN happened to open the dashboard that day, and day-gated jobs
were skipped outright when nobody did. This module runs a tick every
`TICK_SECONDS` inside the FastAPI process and calls each registered job.

Multi-worker safety: the backend runs `uvicorn --workers 2`, so every worker
starts this loop. A single lease document in `system_runs` (`_id` =
`scheduler_lease`) is claimed with an atomic find_one_and_update; only the
holder runs the jobs, the other worker(s) idle and take over if the holder
stops renewing (crash, restart, redeploy) within `LEASE_SECONDS`.

Jobs are plain zero-arg coroutines. Each job owns its own idempotency (a
`system_runs` marker or `notification_log` key), so a tick is always safe to
repeat and a manual "run now" is the same call as a scheduled one.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import socket
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

logger = logging.getLogger("sithappens.scheduler")

LEASE_ID = "scheduler_lease"
TICK_ID = "scheduler_tick"
LEASE_SECONDS = int(os.environ.get("SCHEDULER_LEASE_SECONDS", "180"))
TICK_SECONDS = int(os.environ.get("SCHEDULER_TICK_SECONDS", "60"))

Job = Tuple[str, Callable[[], Awaitable[Any]]]


def _utc() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def jsonable(value: Any) -> Any:
    """Coerce a job result into something Mongo + JSON can store."""
    try:
        return json.loads(json.dumps(value, default=str))
    except Exception:
        return str(value)[:800]


def default_holder() -> str:
    return f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:6]}"


async def acquire_lease(db, holder: str, *, lease_seconds: int = LEASE_SECONDS, now: Optional[datetime] = None) -> bool:
    """Claim (or renew) the scheduler lease for `holder`. Returns True when
    this holder may run jobs. Atomic: a live lease held by someone else is
    never overwritten; an expired one is taken over."""
    now = now or _utc()
    expires = _iso(now + timedelta(seconds=lease_seconds))
    doc = await db.system_runs.find_one_and_update(
        {"_id": LEASE_ID, "$or": [{"holder": holder}, {"expires_at": {"$lt": _iso(now)}}]},
        {"$set": {"holder": holder, "expires_at": expires, "renewed_at": _iso(now)}},
        return_document=ReturnDocument.AFTER,
    )
    if doc:
        return True
    try:
        await db.system_runs.insert_one({"_id": LEASE_ID, "holder": holder, "expires_at": expires, "renewed_at": _iso(now)})
        return True
    except DuplicateKeyError:
        return False


async def release_lease(db, holder: str) -> None:
    """Let another worker take over immediately (used on shutdown)."""
    # Backdated by a second: acquire_lease takes over on a strict `<` compare,
    # and a same-instant stamp would leave the next worker idle for a tick.
    await db.system_runs.update_one(
        {"_id": LEASE_ID, "holder": holder}, {"$set": {"expires_at": _iso(_utc() - timedelta(seconds=1))}},
    )


async def run_jobs_once(db, jobs: List[Job], *, holder: str = "manual") -> Dict[str, Any]:
    """Run every job in order. One failing job never stops the others; each
    outcome is recorded on the `scheduler_tick` document for the status page."""
    results: Dict[str, Any] = {}
    for name, fn in jobs:
        started = _utc()
        try:
            out = await fn()
            results[name] = {"ok": True, "result": jsonable(out), "ms": int((_utc() - started).total_seconds() * 1000)}
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("scheduler job %s failed", name)
            results[name] = {"ok": False, "error": str(exc)[:500], "ms": int((_utc() - started).total_seconds() * 1000)}
    await db.system_runs.update_one(
        {"_id": TICK_ID},
        {"$set": {"holder": holder, "ran_at": _iso(_utc()), "results": results}, "$inc": {"ticks": 1}},
        upsert=True,
    )
    return results


async def tick(db, jobs: List[Job], holder: str) -> Optional[Dict[str, Any]]:
    """One scheduler beat: claim/renew the lease, and run the jobs if held."""
    if not await acquire_lease(db, holder):
        return None
    return await run_jobs_once(db, jobs, holder=holder)


async def run_forever(db, jobs: List[Job], *, holder: Optional[str] = None,
                      tick_seconds: int = TICK_SECONDS, stop: Optional[asyncio.Event] = None) -> None:
    holder = holder or default_holder()
    logger.info("scheduler started (holder=%s, tick=%ss, jobs=%s)", holder, tick_seconds, [n for n, _ in jobs])
    try:
        while not (stop and stop.is_set()):
            try:
                await tick(db, jobs, holder)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("scheduler tick failed — retrying next tick")
            try:
                if stop:
                    await asyncio.wait_for(stop.wait(), timeout=tick_seconds)
                else:
                    await asyncio.sleep(tick_seconds)
            except asyncio.TimeoutError:
                pass
    finally:
        try:
            await release_lease(db, holder)
        except Exception:
            pass
        logger.info("scheduler stopped (holder=%s)", holder)


async def status(db, marker_ids: List[str]) -> Dict[str, Any]:
    """Lease + last tick + the per-job daily markers, for the admin status page."""
    lease = await db.system_runs.find_one({"_id": LEASE_ID}) or {}
    last = await db.system_runs.find_one({"_id": TICK_ID}) or {}
    markers = {}
    for mid in marker_ids:
        markers[mid] = await db.system_runs.find_one({"_id": mid}) or await db.system_runs.find_one({"id": mid}) or {}
    now = _utc()
    lease_live = bool(lease.get("expires_at")) and str(lease.get("expires_at")) > _iso(now)
    return {
        "now": _iso(now),
        "lease": {"holder": lease.get("holder"), "expires_at": lease.get("expires_at"), "renewed_at": lease.get("renewed_at"), "live": lease_live},
        "last_tick": {"holder": last.get("holder"), "ran_at": last.get("ran_at"), "ticks": last.get("ticks"), "results": last.get("results") or {}},
        "markers": markers,
        "tick_seconds": TICK_SECONDS,
        "lease_seconds": LEASE_SECONDS,
    }
