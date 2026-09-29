"""Waitlisted clients whose spot has opened (audit #33).

A client who tries to book a full day can join the waitlist, and the portal
tells them they'll hear when a spot opens. Nothing ever looked at the
waitlist again: a cancel, a decline, a checkout or a capacity raise freed the
spot and nobody — client or staff — was told.

This works out, whenever Action Required (or the Today screen) is read,
which waitlist entries could be booked right now. Worked out from the real
bookings every time rather than stored, like the rest of Action Required, so
it catches every way a spot opens (there are about ten) without a hook in
any of them, and an item goes away by itself when the day fills again, the
entry is converted, declined or removed, or its date passes.

Owner's choice A: staff contact the client and use the waitlist's existing
Offer / Convert buttons. Nothing is emailed automatically.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException

from domains.bookings import guards as booking_guards

_logger = logging.getLogger(__name__)
_server_globals: Dict[str, Any] = {}

TYPE = "waitlist_spot_open"
ACTIVE = ("waiting", "offered")          # "converting" is a Convert in progress
TIMED = ("training", "grooming", "photography")
COUNTED = ("approved", "pending", "completed")


def configure(*, server_globals: dict) -> None:
    global _server_globals
    _server_globals = server_globals


def _g(name: str):
    return _server_globals[name]


def _is_closed(settings: dict, service_type: str, days: List[str]) -> bool:
    """Convert (as staff) books a closed day without asking, so an entry on
    a holiday or a closed weekday must never be offered."""
    closed = set(settings.get("closed_dates") or [])
    if any(d in closed for d in days):
        return True
    if service_type == "boarding":
        return False
    try:
        return bool(_g("_service_hours_for_date")(settings, service_type, date.fromisoformat(days[0])).get("closed"))
    except Exception:
        return False


async def _picked_up_today(today: str) -> int:
    """Daycare dogs already collected today. The count that decides room
    frees their spot, but a spot a dog used this morning is not one to offer
    a waitlisted family for today."""
    q = {"status": {"$in": list(COUNTED)}, "service_type": "daycare", "checked_out_at": {"$nin": [None, ""]},
         **_g("_overlapping_stay_query")(today, today)}
    return await _g("db").bookings.count_documents(q)


def _booking_for(entry: dict):
    """The booking Convert would try to make from this entry."""
    return _g("BookingIn")(
        dog_id=entry["dog_id"], date=entry["requested_date"],
        end_date=entry.get("requested_end_date") or entry["requested_date"],
        service_type=entry["service_type"], service_id=entry.get("service_id"),
        time=entry.get("time") or "", dropoff_time=entry.get("dropoff_time") or "",
        pickup_time=entry.get("pickup_time") or "", addon_service_ids=list(entry.get("addon_service_ids") or []),
        override_capacity=False, override_vaccines=False)


async def _timed_has_room(entry: dict, settings: dict, service: Optional[dict]) -> bool:
    """A training/grooming/photography slot: the same check a booking of it
    would get."""
    try:
        body = _booking_for(entry)
    except Exception:
        return False
    try:
        await _g("_assert_capacity_available")(body, settings, service)
    except HTTPException:
        return False
    return True


_STAFF = {"id": "waitlist-spots", "role": "admin"}   # Convert is a staff booking
NEW_CLIENT_GATE = ("prospect", "evaluation_scheduled", "rejected")


async def _convert_would_book(entry: dict, settings: dict, dog: dict, client: dict) -> Tuple[bool, Optional[dict]]:
    """Every refusal Convert would meet besides room, in create_booking's
    own words — (bookable, the service it would book). The service must
    still be offered; the family must be past its Meet & Greet and not
    marked rejected; the dog's vaccines must pass; the dog must not already
    have this service those days; the Day-to-Day guardrails (same-day,
    notice, weekend lead time, per-client-per-day, longest stay) must allow
    it."""
    body = _booking_for(entry)
    try:
        service = await _g("_resolve_base_service_for_booking")(body, _STAFF)
    except HTTPException:
        return False, None                      # retired, or no longer this kind of service
    status = client.get("client_status") or "active"
    if status in NEW_CLIENT_GATE:
        return False, service
    if _g("_booking_vaccine_block")(settings, dog, body.service_type):
        return False, service
    if await _g("_dog_conflicting_booking")(body.dog_id, body.date, body.end_date, body.service_type):
        return False, service
    svc_rules = _g("_booking_flow_rules_for")(settings, body.service_type, body.service_id)
    try:
        await booking_guards.enforce_day_to_day(
            _g("db"), settings, svc_rules, body, client_id=entry.get("client_id"), is_admin=True,
            start_local=_g("_booking_start_local")(body, settings), now_business=datetime.now(_g("BUSINESS_TZ")))
    except HTTPException:
        return False, service
    return True, service


async def _slot(entry: dict, service: Optional[dict]) -> Optional[Tuple[int, int]]:
    """A timed entry's [start, end) in minutes, for who competes with whom."""
    if entry["service_type"] not in TIMED:
        return None
    start = _g("_hhmm_to_min")(entry.get("time") or "")
    if start is None:
        return None
    dur = int((service or {}).get("duration_minutes") or 0) or await _g("_get_default_duration")(entry["service_type"])
    return start, start + max(1, dur)


def _over_for_today(settings: dict, entry: dict, now_local: datetime) -> bool:
    """A time already gone today, or a daycare day already closed."""
    now_hhmm = now_local.strftime("%H:%M")
    if entry["service_type"] in TIMED:
        return (entry.get("time") or "").strip() <= now_hhmm
    if entry["service_type"] == "daycare":
        try:
            close = _g("_service_hours_for_date")(settings, "daycare", now_local.date()).get("close") or ""
        except Exception:
            close = ""
        return bool(close) and close <= now_hhmm
    return False


def _competes(a: dict, a_days: List[str], a_slot, b: dict, b_days: List[str], b_slot) -> bool:
    """Whether two entries want the same spot: boarding stays sharing a
    night, the same daycare day, appointment times that overlap (any timed
    booking blocks another, as the capacity check does)."""
    if a_slot and b_slot:
        return a_days[0] == b_days[0] and a_slot[0] < b_slot[1] and b_slot[0] < a_slot[1]
    if a["service_type"] != b["service_type"]:
        return False
    if a["service_type"] == "boarding":
        return bool(set(a_days) & set(b_days))
    return a_days[0] == b_days[0]


async def _live(coll, ids: set) -> Dict[str, dict]:
    return {d["id"]: d async for d in coll.find({"id": {"$in": list(ids)}, "deleted_at": {"$in": [None, ""]}}, {"_id": 0})}


async def open_entries() -> List[dict]:
    """Every active waitlist entry that Convert could book right now, in the
    order people joined, each with `open_spots`, `waitlist_position` and
    `waitlist_line` — its place among the dogs shown for the same spot."""
    db = _g("db")
    today = _g("business_today")().isoformat()
    rows = [r async for r in db.waitlist.find(   # every one — never a capped read
        {"status": {"$in": list(ACTIVE)}, "requested_date": {"$gte": today}}, {"_id": 0}).sort("created_at", 1)]
    if not rows:
        return []
    settings = await _g("get_settings")()
    if ((settings.get("feature_visibility") or {}).get("waitlist")) is False:
        return []
    dogs = await _live(db.dogs, {r.get("dog_id") for r in rows})
    clients = await _live(db.clients, {r.get("client_id") for r in rows})
    now_local = datetime.now(_g("BUSINESS_TZ"))

    wanted: Dict[Tuple[str, str], None] = {}
    candidates: List[Tuple[dict, List[str]]] = []
    for r in rows:
        if r.get("dog_id") not in dogs or r.get("client_id") not in clients:
            continue              # the dog or family was removed
        try:                      # one odd entry is skipped, never the whole list
            st, start = r.get("service_type"), r.get("requested_date")
            end = r.get("requested_end_date") or start
            if st == "boarding":
                if end <= start:
                    continue      # a stay needs a pickup day after drop-off
                days = _g("_presence_dates")(start, end)
            elif st == "daycare" or (st in TIMED and (r.get("time") or "").strip()):
                if end != start:
                    continue      # Convert refuses a day-visit range
                days = [start]
            else:
                continue          # "other" / untimed: never had a limit to wait on
            if not days or _is_closed(settings, st, days):
                continue
            if start == today and _over_for_today(settings, r, now_local):
                continue
        except Exception as exc:
            _logger.warning("Waitlist spots: entry %s skipped: %s", r.get("id"), exc)
            continue
        candidates.append((r, days))
        if st in ("daycare", "boarding"):
            for d in days:
                wanted[(st, d)] = None
    keys = list(wanted)
    counts = dict(zip(keys, await asyncio.gather(*(_g("_booking_days_count_filtered")(d, st) for st, d in keys))))
    if ("daycare", today) in counts:
        counts[("daycare", today)] += await _picked_up_today(today)

    caps = {"daycare": max(0, int(settings.get("daycare_capacity", _g("DAYCARE_CAPACITY")) or 0)),
            "boarding": max(0, int(settings.get("boarding_capacity", 10) or 0))}
    shown: List[Tuple[dict, List[str], int, Any]] = []
    for r, days in candidates:
        st = r["service_type"]
        try:   # one odd entry is skipped, never the whole list
            if st in caps:
                room = min(caps[st] - counts[(st, d)] for d in days)
                if room < 1:
                    continue
            ok, service = await _convert_would_book(r, settings, dogs[r["dog_id"]], clients[r["client_id"]])
            if not ok:
                continue
            if st not in caps:
                room = 1 if await _timed_has_room(r, settings, service) else 0
                if room < 1:
                    continue
            shown.append((r, days, room, await _slot(r, service)))
        except Exception as exc:
            _logger.warning("Waitlist spots: entry %s skipped: %s", r.get("id"), exc)
    out = []
    for r, days, room, slot in shown:   # already in join order
        line = [x["id"] for x, x_days, _, x_slot in shown if _competes(r, days, slot, x, x_days, x_slot)]
        out.append({**r, "open_spots": room, "waitlist_position": line.index(r["id"]) + 1, "waitlist_line": len(line)})
    return out


def _service_name(e: dict) -> str:
    return {"daycare": "Daycare", "boarding": "Boarding", "training": "Training", "grooming": "Grooming",
            "photography": "Photography"}.get(e.get("service_type") or "", (e.get("service_type") or "Booking").title())


async def pending_action_items() -> List[dict]:
    """The Action Required items: one per entry, joined-first within a day.
    A failure here never takes the rest of Action Required down with it."""
    labels = _g("_PENDING_ACTION_TYPE_LABELS")
    urgency_of = _g("_pending_action_urgency")
    try:
        entries = await open_entries()
    except Exception as exc:
        _logger.warning("Action Required waitlist spots failed: %s", exc)
        return []
    items = []
    for e in entries:
        urgency = urgency_of(None, e.get("requested_date"), None)   # times already gone are never listed
        if e.get("status") == "offered":
            urgency["waiting_label"] = "Offered — waiting on their answer"
        else:
            spots = e["open_spots"]
            urgency["waiting_label"] = (f"#{e['waitlist_position']} of {e['waitlist_line']} in line · "
                                        f"{spots} spot{'s' if spots != 1 else ''} open")
        end = e.get("requested_end_date")
        items.append({
            "id": f"{TYPE}:{e['id']}", "type": TYPE, "type_label": labels[TYPE], "priority": "action_required",
            "status": e.get("status"), "created_at": e.get("created_at"),
            "client_id": e.get("client_id"), "client_name": e.get("client_name"),
            "dog_id": e.get("dog_id"), "dog_name": e.get("dog_name"),
            "service_name": _service_name(e),
            "requested_start": f"{e['requested_date']}T{e['time']}" if e.get("time") else e.get("requested_date"),
            "requested_date": e.get("requested_date"),
            "requested_end_date": end if end and end != e.get("requested_date") else None,
            "requested_time": e.get("time") or None,
            "notes": (e.get("notes") or "")[:300],
            "deep_link": {"screen": "waitlist", "waitlist_entry_id": e["id"]},
            "required_permission": "booking_edit",
            "waitlist_position": e["waitlist_position"], "waitlist_line": e["waitlist_line"], "open_spots": e["open_spots"],
            **urgency,
        })
    return items


async def today_brain_items(user: dict) -> List[dict]:
    """The Today screen's one-line nudge (its badge counts Action Required),
    for staff who can book it."""
    if not _g("_perms_for")(user).get("booking_edit"):
        return []
    try:
        entries = await open_entries()
    except Exception as exc:
        _logger.warning("today-brain waitlist spots failed: %s", exc)
        return []
    if not entries:
        return []
    n = len(entries)
    who = [f"{e.get('dog_name') or 'A dog'} ({e.get('client_name') or 'client'}) · {e.get('requested_date')}" for e in entries[:3]]
    return [{
        "id": f"waitlist-spots:{n}", "kind": TYPE, "priority": "warn",
        "title": f"{n} waitlisted dog{'s' if n != 1 else ''} can have a spot now",
        "subtitle": ", ".join(who) + (f" · +{n - len(who)} more" if n > len(who) else "") + " · Tap to open Waitlist",
        "ts": _g("now_iso")(), "cta": {"type": "open_screen", "screen": "waitlist"}, "icon": "fa-hourglass-half",
    }]
