"""Performance-oriented query services used by legacy-compatible routes."""
from __future__ import annotations

from typing import Any, Dict, Optional


_CONFIG: Dict[str, Any] = {}


def configure(*, db, compute_daily_progress, streak_count, client_safe_homework, is_school_homework) -> None:
    _CONFIG.update({
        "db": db,
        "compute_daily_progress": compute_daily_progress,
        "streak_count": streak_count,
        "client_safe_homework": client_safe_homework,
        "is_school_homework": is_school_homework,
    })


async def list_homework(
    *, user: dict, dog_id: Optional[str] = None, status: Optional[str] = None,
    active_first: bool = False, limit: int = 2000, offset: int = 0,
) -> list[dict]:
    db = _CONFIG["db"]
    q: Dict[str, Any] = {}
    if user.get("role") != "admin":
        q["client_id"] = user.get("client_id")
    if dog_id:
        q["dog_id"] = dog_id
    if status:
        q["status"] = status
    lim = max(1, min(int(limit or 2000), 2000))
    skip = max(0, int(offset or 0))

    if active_first and not status:
        active_q = dict(q)
        active_q["status"] = {"$ne": "completed"}
        active_total = await db.homework.count_documents(active_q)
        items = []
        if skip < active_total:
            active_take = min(lim, active_total - skip)
            items = await db.homework.find(active_q, {"_id": 0}).sort("created_at", -1).skip(skip).limit(active_take).to_list(active_take)
            remaining = lim - len(items)
            if remaining:
                completed_q = dict(q)
                completed_q["status"] = "completed"
                items += await db.homework.find(completed_q, {"_id": 0}).sort("created_at", -1).limit(remaining).to_list(remaining)
        else:
            completed_q = dict(q)
            completed_q["status"] = "completed"
            completed_skip = skip - active_total
            items = await db.homework.find(completed_q, {"_id": 0}).sort("created_at", -1).skip(completed_skip).limit(lim).to_list(lim)
    else:
        items = await db.homework.find(q, {"_id": 0}).sort("created_at", -1).skip(skip).limit(lim).to_list(lim)

    compute_daily_progress = _CONFIG["compute_daily_progress"]
    streak_count = _CONFIG["streak_count"]
    for item in items:
        if item.get("daily_tracker"):
            try:
                progress = compute_daily_progress(item)
                item["total_days"] = len(progress)
                item["streak"] = streak_count(progress)
                item["daily_progress"] = progress
            except Exception:
                pass
    if user.get("role") != "admin":
        safe = _CONFIG["client_safe_homework"]
        is_school = _CONFIG["is_school_homework"]
        items = [safe(item) for item in items if not is_school(item)]
    return items
