"""School HQ's copy of a student's status follows the real one (audit #54).

The real enrollment is the dog_programs row. School keeps a copy of each
student's status in school_enrollments, and School HQ counts from that copy
(Active students, the "inactive — needs a nudge" list, the Students filter,
analytics). The copy was only brought up to date when the client opened
their School page, so after the owner or a trainer graduated, paused,
withdrew or reopened an in-person dog, HQ kept showing the old status —
often for good, because many in-person clients never open School.

Now:
  * `sync_one` copies status, access and the completion date from the real
    row onto the copy, then re-reads both and goes again if the real row
    changed meanwhile, so it never leaves an older value behind. Every
    staff action that changes a program's status calls it right after its
    own write; it never raises (a failed copy is put right by the daily
    pass) and never creates or deletes a row.
  * `sync` is the daily pass (and the one-time repair for every dog already
    out of step): every copy checked, out-of-step ones put right, orphans
    (no real row) counted and left alone. A backup restore that brings back
    either collection re-arms it. It never writes dog_programs.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

SYNC_JOB = "school_enrollment_mirror_sync"
_FIELDS = {"_id": 0, "id": 1, "enrollment_id": 1, "status": 1, "access_state": 1, "completed_at": 1}


def _status(row: Optional[dict]) -> str:
    return (row or {}).get("status") or "active"


def _access(row: Optional[dict]) -> str:
    return (row or {}).get("access_state") or "active"


def diff(enrollment: dict, se: dict) -> Dict[str, Any]:
    """The $set that makes the copy `se` say what the real row says."""
    out: Dict[str, Any] = {}
    status = _status(enrollment)
    if se.get("status") != status:
        out["status"] = status
    if _access(se) != _access(enrollment):
        out["access_state"] = _access(enrollment)
    # A finished program carries its date (the copy keeps its own if the real
    # row never had one); any other status has none — a reopen clears it.
    completed_at = (enrollment.get("completed_at") or se.get("completed_at")) if status == "completed" else None
    if (se.get("completed_at") or None) != completed_at:
        out["completed_at"] = completed_at
    return out


async def sync_one(db, enrollment_id: Optional[str], attempts: int = 3) -> str:
    """Make one enrollment's School HQ copy match it. Returns
    "already_right" | "fixed" | "no_mirror" | "no_enrollment" | "error"."""
    if not enrollment_id:
        return "no_enrollment"
    try:
        wrote = False
        for _ in range(attempts + 1):
            se = await db.school_enrollments.find_one({"enrollment_id": enrollment_id}, _FIELDS)
            if not se:
                return "no_mirror"
            enrollment = await db.dog_programs.find_one(
                {"id": enrollment_id}, {"_id": 0, "id": 1, "status": 1, "access_state": 1, "completed_at": 1})
            if not enrollment:
                return "no_enrollment"
            update = diff(enrollment, se)
            if not update:
                return "fixed" if wrote else "already_right"
            await db.school_enrollments.update_one({"id": se["id"]}, {"$set": update})
            wrote = True
        logger.warning("School HQ copy of %s kept changing; the daily pass will finish it", enrollment_id)
        return "fixed"
    except Exception as exc:   # the staff action itself already succeeded
        logger.warning("School HQ copy of %s not updated: %s", enrollment_id, exc)
        return "error"


async def sync(db) -> Dict[str, Any]:
    """The daily pass: every School HQ copy checked against its real row."""
    counts: Dict[str, Any] = {"checked": 0, "fixed": 0, "already_right": 0, "reverted_to_active": 0, "errors": 0,
                              "skipped": {"no_enrollment_id": 0, "no_enrollment": 0}}
    async for se in db.school_enrollments.find({}, _FIELDS):   # every row — never a capped read
        counts["checked"] += 1
        if not se.get("id") or not se.get("enrollment_id"):
            counts["skipped"]["no_enrollment_id"] += 1
            continue
        result = await sync_one(db, se["enrollment_id"])
        if result == "fixed":
            counts["fixed"] += 1
            if se.get("status") == "completed":
                # The copy said finished but the real program is open (an old
                # crash window); the real row wins, as a client read does.
                fresh = await db.school_enrollments.find_one({"id": se["id"]}, {"_id": 0, "status": 1})
                if (fresh or {}).get("status") != "completed":
                    counts["reverted_to_active"] += 1
        elif result == "already_right":
            counts["already_right"] += 1
        elif result in ("no_enrollment", "no_mirror"):
            counts["skipped"]["no_enrollment"] += 1
        else:
            counts["errors"] += 1
    return counts
