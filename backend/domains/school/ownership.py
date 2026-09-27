"""An online course, once bought, is the dog's for life (owner, 2026-09-26).

A dog OWNS a course while it has an Online School enrollment for it that is
in progress, finished or withdrawn — and whose access wasn't revoked. Owning
it, the dog is never sold it again: nothing to buy (a fresh run-through is
the free Retake on the dog's School page).

A dog whose course was REFUNDED, or whose access staff removed, doesn't own
it any more. Buying it again gives access back as a new lifetime purchase:
access is restored on an attempt that is still in progress, otherwise a fresh
attempt starts and the old one stays as history. Before, the desk sale took
the money and left the dog on the old closed course, and the Shop refused.

Used by the desk sale (sell_training_program), the Shop's purchase gate and
fulfillment, and the Shop's "for your dog" suggestions.

server.py is at its line ceiling, so this module reads the server helpers it
needs live (same pattern as domains.bookings.late_day).
"""
from __future__ import annotations

from typing import Any, Dict, Optional

OWNED_STATUSES = ("active", "completed", "withdrawn")

_server_globals: Optional[dict] = None


def configure(*, server_globals: dict) -> None:
    global _server_globals
    _server_globals = server_globals


def _g(name: str):
    return _server_globals[name]


def owned_query(dog_id: str, program_id: str) -> Dict[str, Any]:
    return {"dog_id": dog_id, "program_id": program_id, "delivery_channel": "online_school",
            "status": {"$in": list(OWNED_STATUSES)}, "access_state": {"$ne": "revoked"}}


async def owned(db, dog_id: str, program_id: str) -> Optional[Dict[str, Any]]:
    """The enrollment through which the dog owns this course, if any."""
    return await db.dog_programs.find_one(owned_query(dog_id, program_id), {"_id": 0}, sort=[("created_at", -1)])


def owned_message(dog: Dict[str, Any], program: Dict[str, Any], row: Dict[str, Any]) -> str:
    dog_name = dog.get("name") or "This dog"
    name = program.get("name") or "this course"
    if row.get("status") == "completed":
        return (f"{dog_name} already owns {name} (lifetime access) and has finished it. Nothing was charged. "
                "To go through it again, use Retake on the dog's School page — it's free.")
    return f"{dog_name} already owns {name} (lifetime access). Nothing was charged."


async def grant_purchase(dog: Dict[str, Any], program: Dict[str, Any], *, enrolled_by: Optional[str],
                         enrollment_source: str, source_ref: Optional[str]) -> Dict[str, Any]:
    """Give a buyer access. Same result shape as _grant_online_school_enrollment
    ({"school_enrollment", "enrollment"}); raises the same
    OnlineSchoolAlreadyEnrolledError when the dog already owns it."""
    db = _g("db")
    lapsed = await db.dog_programs.find_one(
        {"dog_id": dog["id"], "program_id": program["id"], "delivery_channel": "online_school",
         "access_state": "revoked"},
        {"_id": 0}, sort=[("created_at", -1)],
    )
    if lapsed and not await owned(db, dog["id"], program["id"]):
        se = await db.school_enrollments.find_one({"enrollment_id": lapsed["id"]}, {"_id": 0})
        if lapsed.get("status") == "active":
            # Still in progress — hand the access back on the same attempt.
            ts = _g("now_iso")()
            fresh = await db.dog_programs.find_one_and_update(
                {"id": lapsed["id"], "access_state": "revoked"},
                {"$set": {"access_state": "active", "access_changed_at": ts, "access_changed_by": enrolled_by,
                          "access_change_reason": "repurchased", "access_restored_by_ref": source_ref}},
                projection={"_id": 0}, return_document=True,
            ) or await db.dog_programs.find_one({"id": lapsed["id"]}, {"_id": 0})
            if se:
                await _g("_reconcile_school_enrollment_mirror")(fresh, se)
                se = await db.school_enrollments.find_one({"id": se["id"]}, {"_id": 0})
            return {"school_enrollment": se, "enrollment": _g("_enrollment_summary")(fresh)}
        return await _g("_grant_online_school_enrollment")(
            dog, program, enrolled_by=enrolled_by, enrollment_source=enrollment_source, source_ref=source_ref,
            allow_retake=True, retake_of_enrollment_id=lapsed["id"],
            retake_of_school_enrollment_id=(se or {}).get("id"),
        )
    return await _g("_grant_online_school_enrollment")(
        dog, program, enrolled_by=enrolled_by, enrollment_source=enrollment_source, source_ref=source_ref,
    )
