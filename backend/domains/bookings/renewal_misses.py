"""Days a weekly schedule's automatic renewal couldn't book (audit #35).

The scheduler renews each regular's weekly schedule ahead of time. A day it
couldn't book — full, closed, a vaccine lapse, any refusal — used to vanish:
only a count was kept, no screen read it, and the booked-through date moved
past the day so it was never tried again. Now each missed day is kept on the
schedule (one entry per date, however often the renewal runs) and shows in
Action Required — "Rosie's weekly schedule couldn't book Oct 12 (full),
Oct 14 (closed)" — until the dog gets booked that day some other way, the
day passes, the schedule is paused or deleted, or staff mark it followed up.
A schedule that couldn't renew at all (every day refused up front) shows
too, until its next successful renewal.

Renewals never book a closed day or holiday (guards.refuse_closed_dates in
create_recurring); the client-only rules stay as for a staff booking.
"""
from __future__ import annotations

import logging
from datetime import date
from typing import Any, Dict, List, Optional, Tuple

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field

from domains.bookings.blocks import block_of

_logger = logging.getLogger(__name__)
_server_globals: Dict[str, Any] = {}

TYPE = "recurring_renewal_missed"
NOT_MISSED = {"duplicate_booking"}          # the dog is already booked that day
LIVE = ("pending", "approved", "completed")
HIDE_FROM_CLIENTS = {"renewal_misses": 0, "renewal_block": 0, "renewal_misses_handled_at": 0, "last_auto_extend_result": 0}

_LABELS = {
    "capacity_busy": "busy",
    "closed_date": "closed", "closed_day": "closed",
    "same_day_not_allowed": "too little notice", "notice_too_short": "too little notice",
    "outside_hours": "outside hours", "time_required": "outside hours", "invalid_time": "outside hours",
    "hours_misconfigured": "outside hours", "runs_past_closing": "outside hours",
    "service_unavailable": "service not offered", "addon_as_service": "service not offered",
    "photo_special_only": "service not offered", "service_mismatch": "service not offered",
    "client_not_found": "no family account", "dog_not_found": "dog removed",
    "dog_removed": "dog removed", "family_archived": "family archived",   # audit #36
    "daily_limit_reached": "daily limit",
}


def configure(*, server_globals: dict) -> None:
    global _server_globals
    _server_globals = server_globals


def _g(name: str):
    return _server_globals[name]


def _refusal(reason: Any, block: Optional[dict]) -> Tuple[str, str, Optional[str]]:
    """(code, plain text, resource) of one refusal, whatever shape it came in:
    a fix-it block, a capacity dict, or plain text."""
    if isinstance(reason, dict):
        code = (block or {}).get("code") or reason.get("code") or ""
        return code, str(reason.get("message") or reason.get("display_message") or ""), reason.get("resource")
    return (block or {}).get("code") or "", str(reason or ""), (block or {}).get("resource")


def label(code: str, text: str, resource: Optional[str] = None) -> str:
    if code == "capacity_full":
        return "time taken" if resource in ("time_slot", "class_or_slot") else "full"
    if code.startswith("vaccine_"):
        return "vaccines"
    if code in _LABELS:
        return _LABELS[code]
    first = (text or "").split(". ")[0].strip().rstrip(".")
    return (first[:60] + "…") if len(first) > 60 else (first or "not booked")


async def record_misses(template_id: str, dog_id: Optional[str], skipped: List[dict]) -> None:
    """Every day a renewal — automatic, staff's Extend or a client's — couldn't
    book, kept on the schedule: one entry per date however often it runs,
    past days dropped. Read fresh, so two renewals never overwrite each other."""
    db = _g("db")
    t = await db.recurring_templates.find_one({"id": template_id}, {"_id": 0, "renewal_misses": 1}) or {}
    today = _g("business_today")().isoformat()
    now = _g("now_iso")()
    kept = [m for m in (t.get("renewal_misses") or []) if (m.get("date") or "") >= today]
    have = {m["date"] for m in kept}
    for s in skipped or []:
        code, text, resource = _refusal(s.get("reason"), s.get("block"))
        if code in NOT_MISSED or not s.get("date") or s["date"] in have:
            continue
        kept.append({"date": s["date"], "code": code, "reason": text[:300], "label": label(code, text, resource),
                     "dog_id": dog_id, "recorded_at": now})
        have.add(s["date"])
    await db.recurring_templates.update_one({"id": template_id}, {"$set": {"renewal_misses": sorted(kept, key=lambda m: m["date"])}})


async def record_renewal(t: dict, res: dict) -> None:
    """After an automatic renewal: its result, as before (the missed days
    themselves were kept by the renewal)."""
    await _g("db").recurring_templates.update_one({"id": t["id"]}, {"$set": {
        "last_auto_extended_at": _g("now_iso")(),
        "last_auto_extend_result": {"window": res.get("window"), "created": res.get("created"),
                                    "skipped": len(res.get("skipped") or [])},
    }})


def client_safe(t: dict) -> dict:
    """A schedule as a client may see it: none of the staff notes."""
    return {k: v for k, v in t.items() if k not in HIDE_FROM_CLIENTS}


async def record_block(t: dict, exc: BaseException) -> None:
    """A schedule that couldn't renew at all (e.g. the dog's vaccines lapsed).
    Kept until its next successful renewal; `since` holds while the reason
    stays the same, so a daily retry doesn't look new."""
    try:
        if isinstance(exc, HTTPException):
            code, text, resource = _refusal(exc.detail, block_of(exc))
        else:
            code, text, resource = "error", str(exc), None
        now = _g("now_iso")()
        old = t.get("renewal_block") or {}
        since = old.get("since") if old.get("code") == code and old.get("since") else now
        await _g("db").recurring_templates.update_one({"id": t["id"]}, {"$set": {"renewal_block": {
            "code": code, "reason": text[:300], "label": label(code, text, resource), "since": since, "last_seen_at": now}}})
    except Exception as err:   # never stop the sweep over the note about it
        _logger.warning("renewal block note failed for template %s: %s", t.get("id"), err)


def _short(iso: str) -> str:
    try:
        d = date.fromisoformat(iso)
        return f"{d.strftime('%b')} {d.day}"
    except ValueError:
        return iso


async def _open() -> List[Tuple[dict, List[dict], Optional[dict]]]:
    """Each active schedule with missed days still worth following up — future,
    still on its weekdays, for its current dog, not since booked, recorded
    after it was last marked followed up — or a renewal block not yet
    followed up."""
    db = _g("db")
    today = _g("business_today")().isoformat()
    rows = [t async for t in db.recurring_templates.find(
        {"active": {"$ne": False}, "$or": [{"renewal_misses.date": {"$gte": today}}, {"renewal_block": {"$exists": True}}]},
        {"_id": 0})]
    if not rows:
        return []
    dog_ids = list({t.get("dog_id") for t in rows})
    dates = list({m.get("date") for t in rows for m in t.get("renewal_misses") or [] if (m.get("date") or "") >= today})
    booked = set()
    if dates:
        async for b in db.bookings.find({"dog_id": {"$in": dog_ids}, "date": {"$in": dates}, "status": {"$in": list(LIVE)}},
                                        {"_id": 0, "dog_id": 1, "date": 1, "service_type": 1}):
            booked.add((b.get("dog_id"), b.get("date"), b.get("service_type")))
    out = []
    for t in rows:
        handled = t.get("renewal_misses_handled_at") or ""
        weekdays = {int(w) for w in t.get("weekdays") or []}
        misses = []
        for m in t.get("renewal_misses") or []:
            try:
                on_weekday = date.fromisoformat(m["date"]).weekday() in weekdays
            except (KeyError, ValueError):
                continue
            if (m["date"] >= today and on_weekday and (m.get("recorded_at") or "") > handled
                    and m.get("dog_id", t.get("dog_id")) == t.get("dog_id")
                    and (t.get("dog_id"), m["date"], t.get("service_type")) not in booked):
                misses.append(m)
        block = t.get("renewal_block") if ((t.get("renewal_block") or {}).get("since") or "") > handled else None
        if misses or block:
            out.append((t, misses, block))
    return out


def _summary(dog: str, misses: List[dict], block: Optional[dict]) -> str:
    parts = []
    if misses:
        shown = ", ".join(f"{_short(m['date'])} ({m.get('label') or 'not booked'})" for m in misses[:6])
        more = f", +{len(misses) - 6} more" if len(misses) > 6 else ""
        parts.append(f"{dog}'s weekly schedule couldn't book {shown}{more}")
    if block:
        parts.append(f"{dog}'s weekly schedule stopped renewing: {block.get('label') or 'refused'}")
    return ". ".join(parts)


async def pending_action_items() -> List[dict]:
    """One Action Required item per schedule. A failure here never takes the
    rest of Action Required down with it."""
    try:
        found = await _open()
    except Exception as exc:
        _logger.warning("Action Required renewal misses failed: %s", exc)
        return []
    if not found:
        return []
    db = _g("db")
    dogs = {d["id"]: d async for d in db.dogs.find({"id": {"$in": list({t.get("dog_id") for t, _, _ in found})}},
                                                   {"_id": 0, "id": 1, "name": 1, "owner_id": 1})}
    clients = {c["id"]: c async for c in db.clients.find({"id": {"$in": list({d.get("owner_id") for d in dogs.values()})}},
                                                         {"_id": 0, "id": 1, "name": 1})}
    labels = _g("_PENDING_ACTION_TYPE_LABELS")
    urgency_of = _g("_pending_action_urgency")
    items = []
    for t, misses, block in found:
        dog = dogs.get(t.get("dog_id")) or {}
        client = clients.get(dog.get("owner_id")) or {}
        stamps = [m.get("recorded_at") or "" for m in misses] + ([block.get("since") or ""] if block else [])
        first = misses[0]["date"] if misses else None
        urgency = urgency_of(min(s for s in stamps if s) if any(stamps) else None, first, None)
        urgency["waiting_label"] = (f"{len(misses)} day{'s' if len(misses) != 1 else ''} not booked" if misses
                                    else "Not renewing")
        items.append({
            "id": f"{TYPE}:{t['id']}", "type": TYPE, "type_label": labels[TYPE], "priority": "action_required",
            "status": "missed", "created_at": min(s for s in stamps if s) if any(stamps) else None,
            "client_id": client.get("id"), "client_name": client.get("name"),
            "dog_id": t.get("dog_id"), "dog_name": dog.get("name"),
            "service_name": t.get("service_name") or (t.get("service_type") or "").title(),
            "requested_start": first, "requested_date": first, "requested_end_date": None, "requested_time": None,
            "notes": "",
            "deep_link": {"screen": "recurring", "recurring_template_id": t["id"]},
            "required_permission": "booking_edit",
            "template_id": t["id"],
            "missed_days": [{"date": m["date"], "label": m.get("label") or "not booked"} for m in misses],
            "renewal_block": {"label": block.get("label"), "reason": block.get("reason")} if block else None,
            "recorded_through": max(s for s in stamps if s) if any(stamps) else None,
            "summary": _summary(dog.get("name") or "A dog", misses, block),
            **urgency,
        })
    return items


async def today_brain_items(user: dict) -> List[dict]:
    """The Today screen's one-line nudge, for staff who can act on it."""
    if not _g("_perms_for")(user).get("booking_edit"):
        return []
    items = await pending_action_items()
    if not items:
        return []
    days = sum(len(i["missed_days"]) for i in items)
    missing = sum(1 for i in items if i["missed_days"])
    stopped = sum(1 for i in items if i.get("renewal_block"))
    parts = []
    if missing:
        parts.append(f"{missing} weekly schedule{'s' if missing != 1 else ''} couldn't book {days} day{'s' if days != 1 else ''}")
    if stopped:
        parts.append(f"{stopped} stopped renewing")
    who = [i.get("dog_name") or "A dog" for i in items[:3]]
    n = len(items)
    return [{
        "id": f"renewal-misses:{missing}:{days}:{stopped}", "kind": TYPE, "priority": "warn",
        "title": " · ".join(parts),
        "subtitle": ", ".join(who) + (f" · +{n - len(who)} more" if n > len(who) else "") + " · Tap to open Recurring",
        "ts": _g("now_iso")(), "cta": {"type": "open_screen", "screen": "recurring"}, "icon": "fa-rotate",
    }]


class FollowedUpIn(BaseModel):
    through: str = Field(min_length=10, max_length=40)   # the item's recorded_through


def register_routes(*, api, server_globals: dict) -> None:
    perm = server_globals["require_admin_and_permission"]

    async def post_followed_up(template_id: str, body: FollowedUpIn, _: dict = Depends(perm("booking_edit"))):
        """Staff followed up the missed days shown to them. Only what was shown
        is marked: a day missed after that shows again."""
        db = _g("db")
        if not await db.recurring_templates.find_one({"id": template_id}, {"_id": 1}):
            raise HTTPException(status_code=404, detail="Schedule not found")
        stamp = min(body.through, _g("now_iso")())
        await db.recurring_templates.update_one({"id": template_id}, {"$max": {"renewal_misses_handled_at": stamp}})
        return {"ok": True}

    api.add_api_route("/recurring-templates/{template_id}/followed-up", post_followed_up, methods=["POST"])
