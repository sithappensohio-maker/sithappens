"""Feeding and medication care, one day at a time.

A booking's `care_items` is the schedule for the whole visit: one item per
feeding and one per medication dose time. What happened to an item is
recorded PER BUSINESS DAY, under `care_items[].days["YYYY-MM-DD"]`, so a
Friday-to-Monday stay has four separate 8:00 Apoquel doses:

  * ticking Friday's dose no longer shows Saturday, Sunday and Monday as
    done;
  * each day's dose is due, then missed, by the clock on THAT day (it used to
    be "missed" from midnight on every day after the first);
  * the staff roster and the Care Board write the same record, so a dose
    given from either screen shows as given on both, clears the Overdue
    Medication alert, and cannot be recorded twice for the same day;
  * a dose nobody recorded yesterday stays on the Care Board, in Action
    Required and on the Kennel Board until someone says what happened, so a
    late-evening miss is not wiped out at midnight.

The schedule FOLLOWS THE DOG'S PROFILE (`_reconcile`): a medication added
to the dog mid-stay (or at drop-off) appears from the next read on every
screen, a dose change updates the amount, and a medication taken off the
profile stops being due from that day (`retired_on`) while its history
stays. The only exception is a schedule an admin set for this one visit
(PUT /bookings/{id}/care → `care_schedule_custom`).

A day record is {status: "completed"|"skipped", completed_at (UTC),
completed_by_id, completed_by_name, completed_initials, completion_note?,
skip_reason?, skip_note?, source: "care_board"|"roster"}. Reads project the
viewed day's record onto the item's familiar top-level fields (`status`,
`completed_at`, `derived_status`, ...), so every consumer keeps reading the
same shape.

Older data:
  * an item's old whole-stay record (top-level `status`, `completed_at`)
    counts only for the business day it was made on (`_legacy_day`);
  * old roster ticks (`medication_log` / `feeding_log` entries that name a
    position in the dog's list, not a care item) made TODAY are carried onto
    today's records the first time a booking is read (`_carry_over_ticks`),
    and a tap from a roster screen still running the old app is matched to
    its dose the same way (`_match_old_tap`);
  * "yesterday" is only checked from the day a booking was first tracked
    per day (`care_per_day_since`), so the day this ships does not raise a
    wall of "not recorded" for doses the old screens never recorded per day.

Times: an item's `time` is the business-local wall clock ("08:00"); stored
timestamps are UTC (`now_iso`). Days are business days (America/New_York),
never the server's or the browser's date.

server.py is at its line ceiling, so this module reads the server helpers it
needs live (same pattern as domains.bookings.late_day). The route handlers
keep their frozen names in server.py and delegate here.
"""
from __future__ import annotations

import copy
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException

# What one day's record holds, and what reads add on top. `status` and the
# completion fields also exist at the top level of OLD items (the whole-stay
# record); they never leak onto another day.
RECORD_KEYS = (
    "status", "completed_at", "completed_by_id", "completed_by_name", "completed_initials",
    "completion_note", "skip_reason", "skip_note", "source",
)
READ_KEYS = ("derived_status", "due_minutes_delta", "day")
# Fields the dog's profile keeps current on an item it still lists.
PROFILE_FIELDS = ("amount", "food_type", "food_from_home", "instructions")
FINAL = ("completed", "skipped")
_DAY_RX = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_DOG_FIELDS = {"_id": 0, "id": 1, "feeding_schedule": 1, "medications": 1}

_server_globals: Optional[dict] = None


def configure(*, server_globals: dict) -> None:
    global _server_globals
    _server_globals = server_globals


def _g(name: str):
    return _server_globals[name]


def _today() -> str:
    return _g("business_today")().isoformat()


def _yesterday(today: str) -> str:
    return (date.fromisoformat(today) - timedelta(days=1)).isoformat()


def _minutes(hhmm: Any) -> Optional[int]:
    return _g("_hhmm_to_minutes")(str(hhmm or ""))


def _sort_key(it: Dict[str, Any]) -> int:
    # 00:00 is a real time (the old `or 9999` sorted midnight doses last).
    m = _minutes(it.get("time"))
    return 9999 if m is None else m


def _local(iso: Any) -> Optional[datetime]:
    try:
        dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(_g("BUSINESS_TZ"))
    except Exception:
        return None


def _clock(iso: Any) -> str:
    dt = _local(iso)
    if not dt:
        return ""
    return f"{dt.hour % 12 or 12}:{dt.minute:02d} {'AM' if dt.hour < 12 else 'PM'}"


def _initials(name: Any, email: Any = "") -> str:
    name = str(name or "").strip()
    if name and "@" not in name:
        letters = "".join(p[0] for p in name.split()[:3] if p)
    else:
        letters = str(email or name or "").split("@")[0][:2]
    return (letters or "?").upper()[:8]


# ─────────────────────────────────────────────────────────────── reading

def _active_on(item: Dict[str, Any], day: str) -> bool:
    """False from the day the dog's profile stopped listing this item."""
    retired = item.get("retired_on")
    return not retired or day < retired


def _legacy_day(item: Dict[str, Any], booking_date: str) -> Optional[str]:
    """The one business day an old whole-stay record belongs to."""
    if item.get("status") not in FINAL:
        return None
    return _g("_business_date_from_timestamp")(item.get("completed_at"), booking_date or None)


def day_record(item: Dict[str, Any], day: str, booking_date: str = "") -> Optional[Dict[str, Any]]:
    """What was recorded for this item on `day`, if anything."""
    days = item.get("days")
    if isinstance(days, dict) and isinstance(days.get(day), dict):
        return days[day]
    if _legacy_day(item, booking_date) == day:
        return {k: item[k] for k in RECORD_KEYS if k in item}
    return None


def derive(item: Dict[str, Any], day: str, *, today: str, booking_date: str = "") -> Dict[str, Any]:
    """One care item as it stands on `day`: the schedule fields, that day's
    record (if any) and a derived status.

      recorded completed / skipped  → "completed" / "skipped"
      today, timed:  more than 30 min before → "not_due"; within 30 min →
                     "due_now"; more than 30 min after → "missed"
      an earlier day, timed, not recorded → "missed"
      untimed, or a later day            → "not_due"
    `due_minutes_delta` is minutes past the dose time (negative = to come).
    """
    out = {k: v for k, v in item.items()
           if k not in RECORD_KEYS and k not in READ_KEYS and k not in ("days", "retired_on")}
    rec = day_record(item, day, booking_date) or {}
    out.update({k: rec[k] for k in RECORD_KEYS if k in rec})
    out["day"] = day
    out["due_minutes_delta"] = None
    if rec.get("status") in FINAL:
        out["derived_status"] = rec["status"]
        return out
    out["status"] = "pending"
    due = _minutes(item.get("time"))
    if due is None or day > today:
        out["derived_status"] = "not_due"
        return out
    days_back = (date.fromisoformat(today) - date.fromisoformat(day)).days
    delta = days_back * 1440 + _g("_now_business_minutes")() - due
    out["due_minutes_delta"] = delta
    if days_back > 0:
        out["derived_status"] = "missed"
    else:
        grace = _g("CARE_GRACE_MINUTES")
        out["derived_status"] = "not_due" if delta < -grace else "due_now" if delta <= grace else "missed"
    return out


def _view(b: Dict[str, Any], items: List[Dict[str, Any]], day: str, today: str) -> List[Dict[str, Any]]:
    return [derive(it, day, today=today, booking_date=b.get("date") or "") for it in items if _active_on(it, day)]


def items_for_day(b: Dict[str, Any], day: str, today: Optional[str] = None) -> List[Dict[str, Any]]:
    """The booking's STORED schedule as it stands on `day` (never seeds)."""
    return _view(b, b.get("care_items") or [], day, today or _today())


def _unrecorded_yesterday(b: Dict[str, Any], items: List[Dict[str, Any]], today: str) -> List[Dict[str, Any]]:
    """Yesterday's timed meals and doses nobody recorded, for a dog that was
    actually here then. Doses before the dog arrived (check-in time on the
    arrival day) are not counted — those were the owner's."""
    start = (b.get("date") or "")[:10]
    since = b.get("care_per_day_since") or ""
    yesterday = _yesterday(today)
    if not start or yesterday < start or not since or yesterday < since or not b.get("checked_in_at"):
        return []
    arrived_day = _g("_business_date_from_timestamp")(b["checked_in_at"], start)
    if arrived_day > yesterday:
        return []
    arrived = _local(b["checked_in_at"]) if arrived_day == yesterday else None
    arrived_min = arrived.hour * 60 + arrived.minute if arrived else None
    out = []
    for it in items:
        due = _minutes(it.get("time"))
        if due is None or not _active_on(it, yesterday) or (arrived_min is not None and due < arrived_min):
            continue
        if day_record(it, yesterday, start):
            continue
        out.append(derive(it, yesterday, today=today, booking_date=start))
    return out


# ───────────────────────────────────── keeping the schedule on the profile

def _base_key(kind: Any, label: Any, time: Any) -> str:
    if kind == "medication":
        return f"med|{str(label or '').strip().lower() or 'medication'}|{str(time or '').strip()}"
    return f"feed|{str(time or '').strip()}"


def _keys(items: List[Dict[str, Any]]) -> List[str]:
    """One stable key per item: medication name + dose time, or feeding time
    (a repeat of the same key gets '#2', '#3', …)."""
    seen: Dict[str, int] = {}
    out = []
    for it in items:
        base = _base_key(it.get("kind"), it.get("label"), it.get("time"))
        seen[base] = seen.get(base, 0) + 1
        out.append(base if seen[base] == 1 else f"{base}#{seen[base]}")
    return out


def _reconcile(items: List[Dict[str, Any]], dog: Dict[str, Any], today: str) -> Tuple[List[Dict[str, Any]], bool]:
    """Bring a visit's schedule in line with the dog's profile: add what the
    profile lists and the visit lacks, refresh amounts and instructions, and
    retire (from today) what the profile no longer lists. Recorded days are
    never touched."""
    fresh = _g("_seed_care_items_from_dog")(dog or {})
    fresh_by_key = dict(zip(_keys(fresh), fresh))
    current_keys = _keys(items)
    out: List[Dict[str, Any]] = []
    changed = False
    for key, item in zip(current_keys, items):
        item = copy.deepcopy(item)
        source = fresh_by_key.get(key)
        if source is None:
            if not item.get("retired_on"):
                item["retired_on"] = today
                changed = True
        else:
            if item.pop("retired_on", None):
                changed = True
            for f in PROFILE_FIELDS:
                if item.get(f, "") != source.get(f, ""):
                    item[f] = source.get(f, "")
                    changed = True
        out.append(item)
    have = set(current_keys)
    for key, source in fresh_by_key.items():
        if key not in have:
            out.append(source)
            changed = True
    if changed:
        out.sort(key=_sort_key)
    return out, changed


def _match_old_tap(items: List[Dict[str, Any]], dog: Dict[str, Any], kind: str, index: Any,
                   day: str, at_minutes: int, booking_date: str) -> Optional[Dict[str, Any]]:
    """An old-style roster tap names a position in the dog's list, not a
    dose. Match it to that medication's (or feeding's) not-yet-given dose
    closest in time to the tap; None when nothing matches."""
    src = (dog.get("medications") if kind == "medication" else dog.get("feeding_schedule")) or []
    if not isinstance(index, int) or not 0 <= index < len(src):
        return None
    s = src[index] or {}
    if kind == "medication":
        name = str(s.get("name") or "").strip().lower() or "medication"
        times = {str(t or "").strip() for t in (s.get("times") or [""])}
        cands = [it for it in items if it.get("kind") == "medication"
                 and str(it.get("label") or "").strip().lower() == name and (it.get("time") or "") in times]
    else:
        t = str(s.get("time") or "").strip()
        cands = [it for it in items if it.get("kind") == "feeding" and (it.get("time") or "") == t]
    cands = [it for it in cands if _active_on(it, day)
             and (day_record(it, day, booking_date) or {}).get("status") != "completed"]
    if not cands:
        return None
    return min(cands, key=lambda it: abs((_minutes(it.get("time")) if _minutes(it.get("time")) is not None else at_minutes) - at_minutes))


async def _carry_over_ticks(b: Dict[str, Any], items: List[Dict[str, Any]], dog: Dict[str, Any], today: str) -> bool:
    """First read of a booking under per-day tracking: today's old-style
    roster ticks become today's records, so a dose given this morning on the
    old screen doesn't show as missed after the update."""
    fields = {"_id": 0}
    for log in ("feeding_log", "medication_log"):
        for f in ("index", "at", "care_item_id", "by_id", "by_name", "note"):
            fields[f"{log}.{f}"] = 1
    doc = await _g("db").bookings.find_one({"id": b.get("id")}, fields) or {}
    changed = False
    for log, kind in (("feeding_log", "feeding"), ("medication_log", "medication")):
        for e in doc.get(log) or []:
            if e.get("care_item_id") or not e.get("at"):
                continue
            if _g("_business_date_from_timestamp")(e["at"], None) != today:
                continue
            local = _local(e["at"])
            item = _match_old_tap(items, dog, kind, e.get("index"), today,
                                  local.hour * 60 + local.minute if local else 0, b.get("date") or "")
            if item is None:
                continue
            item.setdefault("days", {})[today] = {
                "status": "completed", "completed_at": e["at"], "completed_by_id": e.get("by_id"),
                "completed_by_name": e.get("by_name"), "completed_initials": _initials(e.get("by_name")),
                "source": "roster", **({"completion_note": e["note"]} if e.get("note") else {}),
            }
            changed = True
    return changed


async def ensure_schedule(b: Dict[str, Any], dog: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """The booking's care schedule — seeded from the dog's profile and saved
    on first use, then kept in line with the profile — so every screen and
    every tick targets the same item ids. Returns ALL items (retired ones
    included); views filter with `_active_on`."""
    db = _g("db")
    today = _today()
    items = b.get("care_items")
    if items is not None and b.get("care_schedule_custom"):
        return items
    if dog is None:
        dog = await db.dogs.find_one({"id": b.get("dog_id")}, _DOG_FIELDS)
    if items is None:
        items = _g("_seed_care_items_from_dog")(dog or {})
        if items and b.get("id"):
            res = await db.bookings.update_one(
                {"id": b["id"], "$or": [{"care_items": {"$exists": False}}, {"care_items": None}]},
                {"$set": {"care_items": items}, "$min": {"care_per_day_since": today}},
            )
            if res.matched_count:
                b["care_items"] = items
                b["care_per_day_since"] = min(b.get("care_per_day_since") or today, today)
            else:  # another screen seeded it a moment ago — use those ids, not ours
                b.update(await db.bookings.find_one({"id": b["id"]}, {"_id": 0, "care_items": 1, "care_per_day_since": 1}) or {})
                items = b.get("care_items") or items
        return items
    if dog is None or not b.get("id"):
        return items  # dog record missing — never guess
    new, changed = _reconcile(items, dog, today)
    first_read = not b.get("care_per_day_since")
    if first_read and await _carry_over_ticks(b, new, dog, today):
        changed = True
    if not changed and not first_read:
        return items
    update: Dict[str, Any] = {"$set": {}}
    if changed:
        update["$set"]["care_items"] = new
    if first_read:
        update["$set"]["care_per_day_since"] = today
    # Compare-and-set: only if nobody ticked anything since we read it.
    res = await db.bookings.update_one({"id": b["id"], "care_items": items}, update)
    if res.matched_count:
        b.update(update["$set"])
        return b["care_items"]
    b.update(await db.bookings.find_one({"id": b["id"]}, {"_id": 0, "care_items": 1, "care_per_day_since": 1}) or {})
    return b.get("care_items") or items


async def day_items(b: Dict[str, Any], today: Optional[str] = None) -> List[Dict[str, Any]]:
    """Today's view of every current item (seeded and synced first)."""
    today = today or _today()
    return _view(b, await ensure_schedule(b), today, today)


async def overdue_items(b: Dict[str, Any], today: str) -> List[Dict[str, Any]]:
    """Doses for Action Required: today's past their window, plus yesterday's
    nobody recorded (each carries its own `day`)."""
    items = await ensure_schedule(b)
    todays = [it for it in _view(b, items, today, today)
              if it.get("kind") == "medication" and it.get("derived_status") == "missed"]
    return todays + [it for it in _unrecorded_yesterday(b, items, today) if it.get("kind") == "medication"]


def med_overdue(b: Dict[str, Any], today: str) -> bool:
    """Kennel Board flag: a dose past its window today, or one nobody
    recorded yesterday."""
    items = b.get("care_items") or []
    return any(it.get("kind") == "medication" and it.get("derived_status") == "missed"
               for it in _view(b, items, today, today)) or \
        any(it.get("kind") == "medication" for it in _unrecorded_yesterday(b, items, today))


# ──────────────────────────────────────────────────────────── the boards

async def care_board_today() -> Dict[str, Any]:
    """Every feeding and medication due today across every on-site booking,
    plus yesterday's unrecorded ones so a late-evening miss is not lost at
    midnight."""
    db = _g("db")
    today = _today()
    # On-site = approved or completed bookings spanning today, or still
    # checked in after their end date (missed checkout — Sprint 110di-85/86).
    candidates = await db.bookings.find(
        {"status": {"$in": ["approved", "completed"]}, "date": {"$lte": today}},
        {"_id": 0, "id": 1, "dog_id": 1, "dog_name": 1, "client_id": 1, "client_name": 1,
         "service_type": 1, "date": 1, "end_date": 1, "kennel": 1, "care_items": 1,
         "care_schedule_custom": 1, "care_per_day_since": 1,
         "checked_in_at": 1, "checked_out_at": 1, "dropoff_time": 1, "pickup_time": 1},
    ).to_list(2000)
    on_site = []
    for b in candidates:
        if b.get("checked_out_at"):
            continue
        d = b.get("date") or ""
        e = b.get("end_date") or d
        if (d <= today <= e) or (bool(b.get("checked_in_at")) and e < today):
            on_site.append(b)
    dog_ids = list({b["dog_id"] for b in on_site if b.get("dog_id")})
    dogs = {d["id"]: d for d in await db.dogs.find({"id": {"$in": dog_ids}}, _DOG_FIELDS).to_list(len(dog_ids) or 1)} if dog_ids else {}
    feedings: List[Dict[str, Any]] = []
    meds: List[Dict[str, Any]] = []
    earlier: List[Dict[str, Any]] = []
    summary = {"not_due": 0, "due_now": 0, "completed": 0, "missed": 0, "skipped": 0}
    for b in on_site:
        items = await ensure_schedule(b, dogs.get(b.get("dog_id") or ""))
        booking = {
            "booking_id": b.get("id"), "dog_id": b.get("dog_id"), "dog_name": b.get("dog_name"),
            "client_id": b.get("client_id"), "client_name": b.get("client_name"),
            "service_type": b.get("service_type"), "kennel": b.get("kennel"),
        }
        for it in _view(b, items, today, today):
            row = {**it, **booking}
            summary[row["derived_status"]] = summary.get(row["derived_status"], 0) + 1
            (feedings if row.get("kind") == "feeding" else meds).append(row)
        earlier.extend({**it, **booking} for it in _unrecorded_yesterday(b, items, today))
    for rows in (feedings, meds, earlier):
        rows.sort(key=_sort_key)
    return {
        "date": today,
        "summary": summary,
        "feedings": feedings,
        "medications": meds,
        "on_site_count": len(on_site),
        "earlier_date": _yesterday(today),
        "earlier": earlier,
    }


async def attach_roster_care(rows: List[Dict[str, Any]], bookings: List[Dict[str, Any]],
                             dog_map: Dict[str, Dict[str, Any]], today: str) -> None:
    """Give each staff-roster row today's care list — the SAME items and the
    same per-day records as the Care Board, one entry per meal and dose time,
    kept in line with the dog's profile. Photo proofs are left out of the
    roster's copies of the care logs (the roster doesn't show them, and the
    front desk polls this every 45 seconds)."""
    by_id = {b.get("id"): b for b in bookings}
    for row in rows:
        b = by_id.get(row.get("booking_id")) or {}
        items = await ensure_schedule(b, dog_map.get(b.get("dog_id") or ""))
        row["care_today"] = sorted(_view(b, items, today, today), key=_sort_key)
        for log in ("feeding_log", "medication_log"):
            row[log] = [{**{k: v for k, v in e.items() if k != "photo"}, "has_photo": bool(e.get("photo"))}
                        for e in row.get(log) or []]


# ────────────────────────────────────────────────────────────── writing

async def _booking(booking_id: str) -> Dict[str, Any]:
    b = await _g("db").bookings.find_one({"id": booking_id}, {"_id": 0})
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    return b


def _item(b: Dict[str, Any], item_id: str, kind: Optional[str] = None) -> Dict[str, Any]:
    for it in b.get("care_items") or []:
        if it.get("id") == item_id and (kind is None or it.get("kind") == kind):
            return it
    raise HTTPException(status_code=404, detail="Care item not found")


def _valid_day(b: Dict[str, Any], day: Optional[str], today: str) -> str:
    if not day:
        return today
    day = str(day).strip()
    if not _DAY_RX.match(day):
        raise HTTPException(status_code=422, detail="Use a date like 2026-09-25.")
    if day > today:
        raise HTTPException(status_code=400, detail="That day hasn't happened yet.")
    if day < (b.get("date") or "")[:10]:
        raise HTTPException(status_code=400, detail="That day is before this visit started.")
    return day


def _check_active(item: Dict[str, Any], day: str) -> None:
    if not _active_on(item, day):
        raise HTTPException(status_code=404, detail="That's no longer on this dog's care plan — refresh the screen.")


def _already_given(rec: Dict[str, Any], day: str, today: str) -> HTTPException:
    who = rec.get("completed_initials") or rec.get("completed_by_name") or "someone"
    when = _clock(rec.get("completed_at"))
    where = " from the staff roster" if rec.get("source") == "roster" else ""
    return HTTPException(
        status_code=409,
        detail=f"Already given {'today' if day == today else 'that day'}{(' at ' + when) if when else ''} by {who}{where}. Nothing was changed.",
    )


def _not_given(item_id: str, day: str) -> Dict[str, Any]:
    """Match the item only while that day's dose is NOT already recorded as
    given — the database refuses the second of two simultaneous ticks."""
    return {"$elemMatch": {"id": item_id, f"days.{day}.status": {"$ne": "completed"}}}


async def _items_response(booking_id: str) -> Dict[str, Any]:
    b = await _booking(booking_id)
    return {"booking_id": booking_id, "items": items_for_day(b, _today())}


async def record(booking_id: str, item_id: str, user: Dict[str, Any], *, status: str,
                 initials: str, note: str = "", reason: str = "", day: Optional[str] = None) -> Dict[str, Any]:
    """Care Board Complete / Skip for one item on one day (today unless the
    staff member is catching up on yesterday). A skipped dose can still be
    completed later; a completed one cannot be recorded again."""
    db = _g("db")
    today = _today()
    b = await _booking(booking_id)
    item = _item(b, item_id)
    day = _valid_day(b, day, today)
    _check_active(item, day)
    prev = day_record(item, day, b.get("date") or "") or {}
    if prev.get("status") == "completed":
        raise _already_given(prev, day, today)
    rec: Dict[str, Any] = {
        "status": status,
        "completed_at": _g("now_iso")(),
        "completed_by_id": user.get("id"),
        "completed_by_name": user.get("name") or user.get("email"),
        "completed_initials": (initials or "").strip().upper()[:8],
        "source": "care_board",
    }
    if status == "skipped":
        rec["skip_reason"] = (reason or "").strip()
    if (note or "").strip():
        rec["skip_note" if status == "skipped" else "completion_note"] = note.strip()
    res = await db.bookings.update_one(
        {"id": booking_id, "care_items": _not_given(item_id, day)},
        {"$set": {f"care_items.$.days.{day}": rec}},
    )
    if not res.matched_count:
        fresh = await _booking(booking_id)
        raise _already_given(day_record(_item(fresh, item_id), day, fresh.get("date") or "") or {}, day, today)
    return await _items_response(booking_id)


async def reset(booking_id: str, item_id: str, day: Optional[str] = None) -> Dict[str, Any]:
    """Admin undo for one item on one day (today by default)."""
    today = _today()
    b = await _booking(booking_id)
    item = _item(b, item_id)
    day = _valid_day(b, day, today)
    update: Dict[str, Any] = {"$unset": {f"care_items.$.days.{day}": ""}}
    if _legacy_day(item, b.get("date") or "") == day:
        update["$set"] = {"care_items.$.status": "pending"}
        for k in RECORD_KEYS[1:]:
            update["$unset"][f"care_items.$.{k}"] = ""
    await _g("db").bookings.update_one({"id": booking_id, "care_items.id": item_id}, update)
    return await _items_response(booking_id)


async def get_care(booking_id: str) -> Dict[str, Any]:
    b = await _booking(booking_id)
    items = await ensure_schedule(b)
    today = _today()
    return {
        "booking_id": booking_id,
        "dog_id": b.get("dog_id"),
        "dog_name": b.get("dog_name"),
        "date": b.get("date"),
        "items": _view(b, items, today, today),
    }


async def set_schedule(booking_id: str, body: Any) -> Dict[str, Any]:
    """Set this visit's schedule by hand. From then on it no longer follows
    the dog's profile. Every recorded day (and any old whole-stay record) is
    kept on the items that were kept by id."""
    db = _g("db")
    b = await db.bookings.find_one({"id": booking_id}, {"_id": 0, "id": 1, "date": 1, "care_items": 1})
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    incoming = _g("_normalize_care_items")(body.items)
    existing = {it["id"]: it for it in (b.get("care_items") or []) if it.get("id")}
    for it in incoming:
        prev = existing.get(it["id"]) or {}
        if prev.get("status") in FINAL:
            for k in RECORD_KEYS:
                if k in prev:
                    it[k] = prev[k]
        if isinstance(prev.get("days"), dict):
            it["days"] = prev["days"]
    today = _today()
    await db.bookings.update_one(
        {"id": booking_id},
        {"$set": {"care_items": incoming, "care_schedule_custom": True}, "$min": {"care_per_day_since": today}},
    )
    return {"booking_id": booking_id, "items": _view(b, incoming, today, today)}


async def roster_log(kind: str, booking_id: str, body: Any, user: Dict[str, Any]) -> Dict[str, Any]:
    """The staff roster's tap. Always appends the familiar feeding_log /
    medication_log entry (the client's care log and report card read those)
    and, atomically with it, records that meal or dose on the Care Board —
    for the day the roster was showing — refusing a second tick for the same
    dose that day. A tap from an old roster screen (a list position, no care
    item) is matched to its dose (`_match_old_tap`); if nothing matches it is
    only logged, as before."""
    db = _g("db")
    field = "feeding_log" if kind == "feeding" else "medication_log"
    b = await db.bookings.find_one(
        {"id": booking_id},
        {"_id": 0, "id": 1, "date": 1, "dog_id": 1, "care_items": 1, "care_schedule_custom": 1, "care_per_day_since": 1},
    )
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found")
    today = _today()
    at = _g("now_iso")()
    entry: Dict[str, Any] = {
        "index": body.index,
        "note": (body.note or "").strip(),
        "photo": body.photo or "",
        "at": at,
        "by_id": user.get("id"),
        "by_name": user.get("name") or user.get("email"),
    }
    item_id = (getattr(body, "care_item_id", None) or "").strip()
    if item_id:
        day = _valid_day(b, getattr(body, "day", None), today)
        try:
            item = _item(b, item_id, kind)
        except HTTPException:
            raise HTTPException(status_code=404, detail="That isn't on this visit's care schedule any more — refresh the roster.")
        _check_active(item, day)
        same_kind = [it.get("id") for it in b.get("care_items") or [] if it.get("kind") == kind]
        entry["index"] = min(same_kind.index(item_id), 49)
    else:
        # A roster screen still running the old app: match the list position.
        day = today
        dog = await db.dogs.find_one({"id": b.get("dog_id")}, _DOG_FIELDS)
        items = await ensure_schedule(b, dog)
        now = _g("_now_business_minutes")()
        item = _match_old_tap(items, dog or {}, kind, body.index, today, now, b.get("date") or "")
        if item is None:
            await db.bookings.update_one({"id": booking_id}, {"$push": {field: entry}})
            return {"ok": True, "entry": entry}
        item_id = item["id"]

    prev = day_record(item, day, b.get("date") or "") or {}
    if prev.get("status") == "completed":
        raise _already_given(prev, day, today)
    entry.update({"care_item_id": item_id, "day": day,
                  "label": item.get("label") or "", "time": item.get("time") or ""})
    rec: Dict[str, Any] = {
        "status": "completed", "completed_at": at,
        "completed_by_id": user.get("id"), "completed_by_name": user.get("name") or user.get("email"),
        "completed_initials": _initials(user.get("name"), user.get("email")), "source": "roster",
    }
    if entry["note"]:
        rec["completion_note"] = entry["note"]
    res = await db.bookings.update_one(
        {"id": booking_id, "care_items": _not_given(item_id, day)},
        {"$set": {f"care_items.$.days.{day}": rec}, "$push": {field: entry}},
    )
    if not res.matched_count:
        fresh = await db.bookings.find_one({"id": booking_id}, {"_id": 0, "date": 1, "care_items": 1}) or {}
        raise _already_given(day_record(_item(fresh, item_id), day, fresh.get("date") or "") or {}, day, today)
    return {"ok": True, "entry": entry, "record": rec}
