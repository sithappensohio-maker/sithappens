"""Archiving a family, removing a dog, and bringing a family back (audit #36).

"Archive client" used to hide the family and turn off its login and nothing
else: its weekly schedules kept booking, its visits stayed on the calendar,
its waitlist requests stayed open, and an archive could never be undone.

Now:
  * Archiving (or removing one dog) is refused while a dog is on site or the
    family still has visits coming — each is listed so staff check the dog
    out or cancel the visit with the normal Cancel, which already gives
    credits back and handles money. Nothing is cancelled for them.
  * An archive pauses the weekly schedules, closes open waitlist requests
    and pending reschedule requests, and throws away unused claim links.
  * Nothing books, enrolls, checks in or moves a visit for an archived
    family or a removed dog afterwards (guards.refuse_archived).
  * Restore brings back the family, the dogs archived WITH it (never a dog
    removed before, never a merged-away duplicate) and the logins the
    archive turned off. Schedules stay paused until staff press Resume.

`deleted_at` stays the one archive signal every screen already reads; a
restore $unsets it (most readers use {"$exists": False}, so a null would
keep the family hidden). Stamps are conditional, so a double click never
re-stamps and a second restore is refused.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, NamedTuple, Optional

from fastapi import Depends, HTTPException

from domains.bookings.blocks import BookingBlocked
from domains.bookings.guards import LIVE, refuse_archived

_logger = logging.getLogger(__name__)
_server_globals: Dict[str, Any] = {}

SYNC_JOB = "archive_sync"   # scheduler job + its once-a-day marker; a restore clears it
ROW_CAP = 200               # rows listed in a refusal (the true total is always sent)
_OPEN_WAITLIST = ["waiting", "offered"]
_STUCK_CONVERT = timedelta(minutes=5)   # a waitlist "converting" older than this was cut off mid-way (a restart)
_BUSY_FIELDS = {
    "_id": 0, "id": 1, "dog_id": 1, "dog_name": 1, "client_id": 1, "client_name": 1, "bill_to_client_id": 1,
    "service_type": 1, "service_name": 1, "date": 1, "end_date": 1, "time": 1, "status": 1,
    "checked_in_at": 1, "checked_out_at": 1, "financial_reopened_at": 1, "is_prepaid_program_session": 1,
    "is_meet_greet": 1,
    # what _booking_is_financially_locked reads
    "financial_locked": 1, "payment_status": 1, "amount_paid": 1, "cash_revenue": 1, "credits_deducted": 1,
    "credit_value": 1, "cancellation_charged": 1, "cancellation_fee": 1, "actual_price": 1,
}


def configure(*, server_globals: dict) -> None:
    global _server_globals
    _server_globals = server_globals


def _g(name: str):
    return _server_globals[name]


def refuse_if_archived(client: Optional[dict]) -> None:
    """For staff actions on the family itself (a login, a claim email, a new
    dog, a program sale): restore it first."""
    if client and client.get("deleted_at"):
        raise HTTPException(status_code=409, detail=f"{client.get('name') or 'This family'} is archived. "
                                                    "Restore the family first (Clients → Show archived).")


def _g_now() -> str:
    return _server_globals["now_iso"]() if "now_iso" in _server_globals else datetime.now(timezone.utc).isoformat()


def _who(user: dict) -> Dict[str, Any]:
    return {"id": (user or {}).get("id"), "name": (user or {}).get("name") or (user or {}).get("email") or ""}


# ─────────────────────────────── what keeps a family from being archived

def _busy_query(dog_ids: List[str], client_id: Optional[str], today: str) -> Optional[dict]:
    scope: List[dict] = [{"dog_id": {"$in": dog_ids}}] if dog_ids else []
    if client_id:   # a Meet & Greet has no dog; a friend's dog this family pays for is billed to it
        scope += [{"client_id": client_id}, {"bill_to_client_id": client_id}]
    if not scope:
        return None
    return {"$and": [{"$or": scope}, {"$or": [
        {"status": "approved", "checked_in_at": {"$nin": [None, ""]}, "checked_out_at": {"$in": [None, ""]}},   # on site, any date
        {"status": "pending"},                                                                                   # a request, any date
        {"status": "approved", "checked_out_at": {"$in": [None, ""]},
         "$or": [{"date": {"$gte": today}}, {"end_date": {"$gte": today}}]},                                     # still to come
    ]}]}


async def busy(dog_ids: List[str], client_id: Optional[str] = None) -> Dict[str, Any]:
    """Every visit that keeps these dogs / this family from being archived:
    a dog on site (checked in, not out — any date, reopened checkouts too), a
    request still pending (any date: Action Required keeps showing it), and a
    visit still to come (a stay counts until its last day)."""
    db = _g("db")
    q = _busy_query(dog_ids, client_id, _g("business_today")().isoformat())
    if not q:
        return {"on_site": [], "upcoming": [], "total": 0}
    rows = await db.bookings.find(q, _BUSY_FIELDS).to_list(None)
    locked = _g("_booking_is_financially_locked")
    on_site, upcoming = [], []
    for b in rows:
        here = bool(b.get("checked_in_at")) and not b.get("checked_out_at") and b.get("status") == "approved"
        row = {k: b.get(k) for k in ("id", "dog_id", "dog_name", "client_name", "service_type", "service_name",
                                     "date", "end_date", "time", "status", "is_meet_greet")}
        row["paid_for_by_this_family"] = bool(client_id) and b.get("bill_to_client_id") == client_id and b.get("client_id") != client_id
        row["reopened"] = bool(b.get("financial_reopened_at"))
        row["prepaid"] = bool(b.get("is_prepaid_program_session"))
        row["can_cancel"] = not here and not locked(b)
        (on_site if here else upcoming).append(row)
    order = lambda r: (r.get("date") or "", r.get("time") or "")   # noqa: E731
    on_site.sort(key=order)
    upcoming.sort(key=order)
    return {"on_site": on_site, "upcoming": upcoming, "total": len(rows)}


def _refusal(what: str, found: Dict[str, Any]) -> BookingBlocked:
    """`what`: "The Smith family" / "Rex"."""
    on_site, upcoming = found["on_site"], found["upcoming"]
    parts = []
    if on_site:
        names = sorted({r.get("dog_name") or "a dog" for r in on_site})
        parts.append(f"{', '.join(names)} {'is' if len(names) == 1 else 'are'} checked in right now")
    if upcoming:
        parts.append(f"{len(upcoming)} visit{'' if len(upcoming) == 1 else 's'} still booked")
    fix = "Check the dog out" if on_site and not upcoming else ("Cancel those visits" if not on_site else "Check out and cancel those visits")
    stuck = [r for r in upcoming if not r.get("can_cancel")]
    note = ""
    if stuck:   # already paid for (a prepaid program session, a paid visit): Cancel refuses them
        n = len(stuck)
        note = (f" {n} of them {'is' if n == 1 else 'are'} already paid for and can't be cancelled here yet, "
                f"so {what[0].lower() + what[1:] if what.startswith('The ') else what} can be archived once "
                f"{'it has' if n == 1 else 'they have'} taken place.")
    return BookingBlocked(
        409, f"{what} can't be archived yet: {' and '.join(parts)}. {fix}, then archive.{note}",
        code="archive_blocked", action="check_out" if on_site else "cancel_bookings",
        on_site=on_site[:ROW_CAP], upcoming=upcoming[:ROW_CAP - min(len(on_site), ROW_CAP)], total=found["total"],
    )


async def _converting(dog_ids: List[str], client_id: Optional[str]) -> bool:
    scope: List[dict] = [{"dog_id": {"$in": dog_ids}}]
    if client_id:
        scope.append({"client_id": client_id})
    return bool(await _g("db").waitlist.find_one(
        {"$or": scope, "status": "converting", "converting_at": {"$gte": _stuck_before()}}, {"_id": 1}))


def _stuck_before() -> str:
    return (datetime.now(timezone.utc) - _STUCK_CONVERT).isoformat()


async def _close_the_rest(*, dog_ids: List[str], client_id: Optional[str], stamp: str, reason: str, user: dict) -> Dict[str, Any]:
    """Pause the weekly schedules, close open waitlist and reschedule requests.
    Returns the ids touched, kept on the archive record."""
    db = _g("db")
    templates = [t["id"] for t in await db.recurring_templates.find(
        {"dog_id": {"$in": dog_ids}, "active": {"$ne": False}}, {"_id": 0, "id": 1}).to_list(None)]
    if templates:
        await db.recurring_templates.update_many(
            {"id": {"$in": templates}},
            {"$set": {"active": False, "paused_at": stamp, "paused_by": user.get("id"), "paused_reason": reason},
             "$unset": {"renewal_block": ""}},
        )
    scope: List[dict] = [{"dog_id": {"$in": dog_ids}}]
    if client_id:
        scope.append({"client_id": client_id})
    await db.waitlist.update_many(
        {"$and": [{"$or": scope}, {"$or": [{"status": {"$in": _OPEN_WAITLIST}},
                                           {"status": "converting", "converting_at": {"$lt": _stuck_before()}}]}]},
        {"$set": {"status": "removed", "removed_reason": reason, "updated_at": stamp},
         "$unset": {"converting_at": "", "converting_by": ""}},
    )
    # Declined quietly: no email to a family being archived; staff see why.
    await db.reschedule_requests.update_many(
        {"$or": scope, "status": "pending"},
        {"$set": {"status": "declined", "decline_reason": reason.replace("_", " "), "declined_at": stamp}},
    )
    return {"template_ids": templates}


# ─────────────────────────────────────────────── archive / remove / restore

async def archive_client(client_id: str, user: dict) -> Dict[str, Any]:
    db = _g("db")
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "id": 1, "name": 1, "deleted_at": 1})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    if client.get("deleted_at"):
        return {"ok": True, "soft_deleted": True, "already_archived": True}   # never re-stamp
    dogs = await db.dogs.find({"owner_id": client_id}, {"_id": 0, "id": 1, "deleted_at": 1}).to_list(None)
    every_dog = [d["id"] for d in dogs]
    what = f"The {client.get('name') or 'client'} family"
    found = await busy(every_dog, client_id)
    if found["total"]:
        raise _refusal(what, found)
    if await _converting(every_dog, client_id):
        raise HTTPException(status_code=409, detail="A waitlist spot is being booked for this family right now. Try again in a moment.")

    stamp = _g("now_iso")()
    res = await db.clients.update_one({"id": client_id, "deleted_at": LIVE},
                                      {"$set": {"deleted_at": stamp, "deleted_by": user.get("id"), "active": False}})
    if not res.modified_count:
        return {"ok": True, "soft_deleted": True, "already_archived": True}
    live_dogs = [d["id"] for d in dogs if not d.get("deleted_at")]   # a dog removed earlier keeps its own stamp
    await db.dogs.update_many({"id": {"$in": live_dogs}, "deleted_at": LIVE},
                              {"$set": {"deleted_at": stamp, "deleted_by": user.get("id"), "active": False}})
    # A visit booked in the moment between the check and the stamp: undo, refuse.
    late = await busy(every_dog, client_id)
    if late["total"]:
        await db.dogs.update_many({"id": {"$in": live_dogs}, "deleted_at": stamp}, {"$unset": {"deleted_at": "", "deleted_by": "", "active": ""}})
        await db.clients.update_one({"id": client_id, "deleted_at": stamp}, {"$unset": {"deleted_at": "", "deleted_by": "", "active": ""}})
        raise _refusal(what, late)

    logins = [u["id"] for u in await db.users.find({"client_id": client_id, "active": {"$ne": False}}, {"_id": 0, "id": 1}).to_list(None)]
    if logins:
        await db.users.update_many(
            {"id": {"$in": logins}},
            {"$set": {"active": False, "deactivated_at": stamp, "deactivated_by": user.get("id")}, "$inc": {"token_version": 1}},
        )
    _g("_invalidate_auth_user_cache")()
    closed = await _close_the_rest(dog_ids=every_dog, client_id=client_id, stamp=stamp, reason="family_archived", user=user)
    await db.claim_tokens.delete_many({"client_id": client_id, "used": False})
    await db.school_notifications.update_many(   # the School HQ "needs attention" queue (a stored list)
        {"client_id": client_id, "audience": "school_staff", "resolved_at": None},
        {"$set": {"resolved_at": stamp, "resolved_by": "family_archived"}})
    record = {"at": stamp, "by": _who(user), "dog_ids": live_dogs, "user_ids": logins, **closed}
    await db.clients.update_one({"id": client_id, "deleted_at": stamp},
                                {"$set": {"archive_record": record}, "$push": {"archive_history": {"archived": record}}})
    return {"ok": True, "soft_deleted": True, "dogs": len(live_dogs), "paused_schedules": len(closed["template_ids"])}


async def remove_dog(dog_id: str, user: dict) -> Dict[str, Any]:
    db = _g("db")
    dog = await db.dogs.find_one({"id": dog_id}, {"_id": 0, "id": 1, "name": 1, "deleted_at": 1})
    if not dog:
        raise HTTPException(status_code=404, detail="Dog not found")
    if dog.get("deleted_at"):
        return {"ok": True, "soft_deleted": True, "already_removed": True}   # keeps its family's archive stamp
    what = dog.get("name") or "This dog"
    found = await busy([dog_id])
    if found["total"]:
        raise _refusal(what, found)
    if await _converting([dog_id], None):
        raise HTTPException(status_code=409, detail=f"A waitlist spot is being booked for {what} right now. Try again in a moment.")
    stamp = _g("now_iso")()
    res = await db.dogs.update_one({"id": dog_id, "deleted_at": LIVE},
                                   {"$set": {"deleted_at": stamp, "deleted_by": user.get("id"), "active": False}})
    if not res.modified_count:
        return {"ok": True, "soft_deleted": True, "already_removed": True}
    late = await busy([dog_id])
    if late["total"]:
        await db.dogs.update_one({"id": dog_id, "deleted_at": stamp}, {"$unset": {"deleted_at": "", "deleted_by": "", "active": ""}})
        raise _refusal(what, late)
    closed = await _close_the_rest(dog_ids=[dog_id], client_id=None, stamp=stamp, reason="dog_removed", user=user)
    await db.school_notifications.update_many(
        {"dog_id": dog_id, "audience": "school_staff", "resolved_at": None},
        {"$set": {"resolved_at": stamp, "resolved_by": "dog_removed"}})
    return {"ok": True, "soft_deleted": True, "paused_schedules": len(closed["template_ids"])}


async def restore_client(client_id: str, user: dict) -> Dict[str, Any]:
    db = _g("db")
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    stamp = client.get("deleted_at")
    if not stamp:
        raise HTTPException(status_code=409, detail="This family isn't archived.")
    dogs, logins = await _archived_with(client)
    now = _g("now_iso")()
    # Dogs and logins first, the family last: while the family still carries its
    # stamp nothing can book or sign in, and a restore cut off half-way simply
    # runs again (each step only matches what is still archived).
    back = [d["id"] for d in dogs]
    if back:
        await db.dogs.update_many({"id": {"$in": back}, "owner_id": client_id, "deleted_at": stamp},
                                  {"$unset": {"deleted_at": "", "deleted_by": "", "active": ""}})
    if logins:
        # Old sessions stay dead (token_version is never lowered): they sign in fresh.
        await db.users.update_many(
            {"id": {"$in": logins}, "active": False},
            {"$set": {"active": True, "reactivated_at": now, "reactivated_by": user.get("id")},
             "$unset": {"deactivated_at": "", "deactivated_by": ""}},
        )
    res = await db.clients.update_one(
        {"id": client_id, "deleted_at": stamp},
        {"$unset": {"deleted_at": "", "deleted_by": "", "active": "", "archive_record": ""},
         "$set": {"restored_at": now, "restored_by": user.get("id")},
         "$push": {"archive_history": {"restored": {"at": now, "by": _who(user), "archived_at": stamp}}}},
    )
    if not res.modified_count:
        raise HTTPException(status_code=409, detail="This family was just restored. Refresh the page.")
    _g("_invalidate_auth_user_cache")()
    paused = await db.recurring_templates.count_documents(
        {"dog_id": {"$in": back}, "active": False, "paused_reason": "family_archived"}) if back else 0
    still_removed = await db.dogs.find(
        {"owner_id": client_id, "deleted_at": {"$nin": [None, ""]}, "archived": {"$ne": True}}, {"_id": 0, "name": 1}).to_list(None)
    return {"ok": True, "restored_dogs": [d.get("name") or "" for d in dogs], "logins_restored": len(logins),
            "paused_schedules": paused, "still_removed": [d.get("name") or "" for d in still_removed]}


async def _archived_with(client: dict):
    """The dogs and logins this family's archive turned off. The archive record
    says exactly; a family archived before it existed falls back to the stamp
    (never a merged-away duplicate, which carries archived / duplicate_of)."""
    db = _g("db")
    stamp = client.get("deleted_at")
    rec = client.get("archive_record") or {}
    if rec.get("at") == stamp:
        dogs = await db.dogs.find({"id": {"$in": rec.get("dog_ids") or []}, "owner_id": client["id"], "deleted_at": stamp},
                                  {"_id": 0, "id": 1, "name": 1}).to_list(None)
        logins = list(rec.get("user_ids") or [])
    else:
        dogs = await db.dogs.find({"owner_id": client["id"], "deleted_at": stamp, "archived": {"$ne": True},
                                   "duplicate_of_dog_id": {"$exists": False}}, {"_id": 0, "id": 1, "name": 1}).to_list(None)
        # The old archive re-stamped dogs already removed one by one; the Audit
        # Log still shows each of those removals, made before the archive.
        earlier = set(await db.audit_log.distinct("record_id", {
            "action": "dog_deleted", "record_id": {"$in": [d["id"] for d in dogs]}, "status": {"$lt": 400}, "ts": {"$lt": stamp}}))
        dogs = [d for d in dogs if d["id"] not in earlier]
        logins = []
    # A login switched off by this archive (or by the nightly sync, which uses the same stamp).
    logins += [u["id"] for u in await db.users.find(
        {"client_id": client["id"], "active": False, "deactivated_at": stamp}, {"_id": 0, "id": 1}).to_list(None)
        if u["id"] not in logins]
    return dogs, logins


async def archived_view(rows: List[dict]) -> None:
    """The Clients screen's "Show archived" rows: when, by whom, and the dogs
    Restore would bring back."""
    for c in rows:
        dogs, _ = await _archived_with(c)
        rec = c.get("archive_record") or {}
        by = (rec.get("by") or {}).get("name") if rec.get("at") == c.get("deleted_at") else ""
        c["archived_by_name"] = by or ""
        c["dogs"] = [{"id": d["id"], "name": d.get("name") or ""} for d in dogs]   # what Restore brings back


# ─────────────────────────────────────────────── a paused weekly schedule

async def resume_template(template_id: str, user: dict) -> Dict[str, Any]:
    """Turn a paused schedule back on. It books again from today (the visits
    cancelled before an archive left a gap its booked-through date would skip),
    and misses recorded before the pause never come back as new."""
    db = _g("db")
    t = await db.recurring_templates.find_one({"id": template_id}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    if t.get("active") is not False:
        return {"ok": True, "already_active": True}
    dog = await db.dogs.find_one({"id": t.get("dog_id")}, {"_id": 0, "id": 1, "name": 1, "owner_id": 1, "deleted_at": 1})
    if not dog:
        raise HTTPException(status_code=404, detail="Dog not found")
    client = await db.clients.find_one({"id": dog.get("owner_id")}, {"_id": 0, "name": 1, "deleted_at": 1})
    refuse_archived(dog=dog, client=client)
    now = _g("now_iso")()
    yesterday = (_g("business_today")() - timedelta(days=1)).isoformat()
    upd: Dict[str, Any] = {"active": True, "resumed_at": now, "resumed_by": user.get("id")}
    if t.get("last_booked_through") and t["last_booked_through"] > yesterday:
        upd["last_booked_through"] = yesterday
    await db.recurring_templates.update_one(
        {"id": template_id, "active": False},
        {"$set": upd, "$max": {"renewal_misses_handled_at": now},
         "$unset": {"paused_at": "", "paused_by": "", "paused_reason": "", "renewal_block": ""}},
    )
    return {"ok": True}


# ──────────────────────── who no automatic email or staff to-do is about

class Gone(NamedTuple):
    families: set   # archived family ids
    dogs: set       # every dog record that is gone: removed, merged away, or of an archived family
    merged: set     # merged-away duplicates of a LIVE family — rows still keyed to one belong to the live dog


async def gone(db) -> Gone:
    """Who no automatic email reaches and no staff to-do list is about. Money
    views never use this (an archived family can still owe or hold credit).
    Read fresh each time, so a Restore brings everything back."""
    families = set(await db.clients.distinct("id", {"deleted_at": {"$nin": [None, ""]}}))
    dogs = set(await db.dogs.distinct("id", {"$or": [{"deleted_at": {"$nin": [None, ""]}}, {"owner_id": {"$in": list(families)}}]}))
    merged = set(await db.dogs.distinct("id", {"duplicate_of_dog_id": {"$exists": True}, "owner_id": {"$nin": list(families)}}))
    return Gone(families, dogs, merged)


def not_gone(scope) -> Dict[str, Any]:
    """A Mongo filter leaving out rows of archived families / removed dogs."""
    return {"client_id": {"$nin": list(scope[0])}, "dog_id": {"$nin": list(scope[1] - (scope[2] if len(scope) > 2 else set()))}}


# ─────────────────────────────────────── logins, and the nightly tidy-up

async def login_refused(user: dict) -> bool:
    """A client login whose family is archived. Archiving turns the login off,
    but a backup restore (logins aren't in backups) or a login import can turn
    it back on — the family's own record is the one that decides."""
    if (user or {}).get("role") != "client" or not user.get("client_id"):
        return False
    c = await _g("db").clients.find_one({"id": user["client_id"]}, {"_id": 0, "deleted_at": 1})
    return bool(c and c.get("deleted_at"))


async def sync(db) -> Dict[str, int]:
    """Daily (and after a backup restore): families archived before this
    existed — or brought back archived by a restore — still had schedules
    renewing, open waitlist requests and working logins. Same effect as the
    archive, stamped with the family's own archive time."""
    out = {"schedules": 0, "waitlist": 0, "logins": 0, "moved_to_main_dog": 0, "notifications": 0}
    families = {c["id"]: c["deleted_at"] for c in await db.clients.find(
        {"deleted_at": {"$nin": [None, ""]}}, {"_id": 0, "id": 1, "deleted_at": 1}).to_list(None)}
    # A merged-away duplicate's schedule and waitlist requests belong to the dog
    # it was merged into (older merges never moved them): moved, never paused.
    for d in await db.dogs.find({"duplicate_of_dog_id": {"$exists": True}, "owner_id": {"$nin": list(families)}},
                                {"_id": 0, "id": 1, "duplicate_of_dog_id": 1}).to_list(None):
        main = await db.dogs.find_one({"id": d["duplicate_of_dog_id"], "deleted_at": LIVE}, {"_id": 1})
        if not main:
            continue
        for coll in (db.recurring_templates, db.waitlist):
            r = await coll.update_many({"dog_id": d["id"]}, {"$set": {"dog_id": d["duplicate_of_dog_id"], "merged_from_dog_id": d["id"]}})
            out["moved_to_main_dog"] += r.modified_count
    removed = await db.dogs.find({"$or": [{"deleted_at": {"$nin": [None, ""]}, "duplicate_of_dog_id": {"$exists": False}},
                                          {"owner_id": {"$in": list(families)}}]},
                                 {"_id": 0, "id": 1, "owner_id": 1, "deleted_at": 1}).to_list(None)
    ids = [d["id"] for d in removed]
    renewing = set(await db.recurring_templates.distinct("dog_id", {"dog_id": {"$in": ids}, "active": {"$ne": False}})) if ids else set()
    waiting = set(await db.waitlist.distinct("dog_id", {"dog_id": {"$in": ids}, "status": {"$in": _OPEN_WAITLIST}})) if ids else set()
    for d in removed:
        if d["id"] not in renewing and d["id"] not in waiting:
            continue
        stamp = families.get(d.get("owner_id")) or d.get("deleted_at")
        reason = "family_archived" if d.get("owner_id") in families else "dog_removed"
        r = await db.recurring_templates.update_many(
            {"dog_id": d["id"], "active": {"$ne": False}},
            {"$set": {"active": False, "paused_at": stamp, "paused_by": "archive_sync", "paused_reason": reason},
             "$unset": {"renewal_block": ""}})
        out["schedules"] += r.modified_count
        r = await db.waitlist.update_many({"dog_id": d["id"], "status": {"$in": _OPEN_WAITLIST}},
                                          {"$set": {"status": "removed", "removed_reason": reason, "updated_at": stamp}})
        out["waitlist"] += r.modified_count
    for field, keys, why in (("client_id", list(families), "family_archived"), ("dog_id", ids, "dog_removed")):
        if keys:
            r = await db.school_notifications.update_many(
                {field: {"$in": keys}, "audience": "school_staff", "resolved_at": None},
                {"$set": {"resolved_at": _g_now(), "resolved_by": why}})
            out["notifications"] += r.modified_count
    for cid, stamp in families.items():
        r = await db.users.update_many({"client_id": cid, "role": "client", "active": {"$ne": False}},
                                       {"$set": {"active": False, "deactivated_at": stamp, "deactivated_by": "archive_sync"},
                                        "$inc": {"token_version": 1}})
        out["logins"] += r.modified_count
    if out["logins"]:
        try:
            _g("_invalidate_auth_user_cache")()
        except KeyError:
            pass
    return out


# ─────────────────────────────────────────────────────────────── routes

def register_routes(*, api, server_globals: dict) -> None:
    need = server_globals["require_admin_and_permission"]

    async def restore_client_route(client_id: str, user: dict = Depends(need("delete_records"))):
        return await restore_client(client_id, user)

    async def resume_template_route(template_id: str, user: dict = Depends(need("booking_edit"))):
        return await resume_template(template_id, user)

    api.add_api_route("/clients/{client_id}/restore", restore_client_route, methods=["POST"])
    api.add_api_route("/recurring-templates/{template_id}/resume", resume_template_route, methods=["POST"])
