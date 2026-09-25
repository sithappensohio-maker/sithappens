"""A daycare dog checked out on a later day: ask, never assume.

A daycare visit that is still checked in after its day can mean two very
different things — staff forgot to press Check Out, or the dog really stayed
the night. The app must never decide which on its own. Checkout of such a
visit is refused until someone answers:

  forgotten         it stays a daycare visit, charged as the normal day; the
                    per-15-minute late-pickup clock does not run overnight
                    (see pricing.money_modifier_breakdown).
  stayed_overnight  the visit becomes a boarding stay from its day to the day
                    the dog actually leaves, priced exactly like any boarding
                    stay (nights at the client's boarding rate, pickup-day rule
                    at the real pickup time) and drawing boarding credits.

The answer is saved on the booking with a record of what it replaced
(`late_day_checkout.original`), so it can be undone until the dog is checked
out. A stay answered early is RE-PRICED to the real pickup — when the
checkout screen opens and again inside checkout itself — so answering at
9 AM for a 6 PM pickup, or a dog staying one more night, is still charged
correctly.

When it applies: a DAYCARE booking, checked in, not checked out, whose day
is before today AND that was checked in before today (a back-dated walk-in
that arrived today is not an overnight).

Writes made from the screen are compare-and-set: they only land if the
booking is still in the state that was read and no checkout holds its lock,
so two people answering at once, or "Change answer" during a checkout, can
never leave a half-converted record.

server.py is near its line ceiling, so this module reads the server helpers
it needs live (same pattern as domains.shop.checkout).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel

from domains.bookings.blocks import BookingBlocked, pretty_date

RESOLUTIONS = ("forgotten", "stayed_overnight")
QUESTION_CODE = "late_day_checkout_resolution_required"
CHANGED = "Someone else just changed or checked out this visit — close the checkout, reopen it and try again."

# Every field a stayed-overnight conversion overwrites — restored by undo.
CONVERTED_KEYS = (
    "service_type", "end_date", "pickup_time", "service_id", "service_name",
    "grooming_type", "cost", "credit_units_required", "estimated_price",
    "unit_price", "list_unit_price", "preferred_rate_applied", "price_override_id",
    "price_source", "price_label", "pricing_snapshot", "multi_dog_discount",
)

_server_globals: Optional[dict] = None


def configure(*, server_globals: dict) -> None:
    global _server_globals
    _server_globals = server_globals


def _g(name: str):
    return _server_globals[name]


def _today() -> str:
    return _g("business_today")().isoformat()


def _now_clock() -> str:
    return datetime.now(_g("BUSINESS_TZ")).strftime("%H:%M")


def applies(booking: Optional[dict], today: Optional[str] = None) -> bool:
    """True when this visit is a daycare dog still checked in from an earlier day."""
    if not booking or booking.get("service_type") != "daycare":
        return False
    if not booking.get("checked_in_at") or booking.get("checked_out_at"):
        return False
    if booking.get("status") in ("completed", "cancelled", "rejected"):
        return False
    # A reopened checkout was really checked out once — its day is known.
    if booking.get("financial_reopened_at"):
        return False
    today = today or _today()
    visit_day = str(booking.get("end_date") or booking.get("date") or "")[:10]
    if not visit_day or visit_day >= today:
        return False
    checked_in_day = _g("_business_date_from_timestamp")(booking.get("checked_in_at"), visit_day)
    return checked_in_day < today


def needs_answer(booking: Optional[dict], today: Optional[str] = None) -> bool:
    return applies(booking, today) and not booking.get("late_day_resolution")


def _open_stay(booking: Optional[dict]) -> bool:
    """A stayed-overnight answer on a dog that hasn't been checked out yet."""
    return (bool(booking) and booking.get("late_day_resolution") == "stayed_overnight"
            and not booking.get("checked_out_at") and not booking.get("financial_reopened_at"))


def daycare_credits_per_night(booking: Optional[dict]) -> Optional[float]:
    """For a converted stay: how many DAYCARE credits pay for one boarding
    night — the client's boarding rate over this visit's daycare rate (2.0
    when boarding is priced at double daycare). None if either is unknown."""
    if not booking or booking.get("late_day_resolution") != "stayed_overnight" or booking.get("service_type") != "boarding":
        return None
    original = (booking.get("late_day_checkout") or {}).get("original") or {}
    daycare_rate = float((original.get("pricing_snapshot") or {}).get("unit_price") or original.get("unit_price") or 0)
    boarding_rate = float((booking.get("pricing_snapshot") or {}).get("unit_price") or booking.get("unit_price") or 0)
    if daycare_rate <= 0 or boarding_rate <= 0:
        return None
    return round(boarding_rate / daycare_rate, 2)


def credit_plan(booking: dict, pool: Optional[str], boarding_units: float):
    """Checkout Case C: (credit pool, credits needed, credits per boarding
    unit). A daycare visit that stayed the night can be paid from the DAYCARE
    pool — the dog was already here on daycare — at daycare_credits_per_night."""
    if pool == "daycare":
        per_night = daycare_credits_per_night(booking)
        if per_night:
            return "daycare", round(float(boarding_units or 0) * per_night, 2), per_night
    return booking.get("service_type") or "daycare", boarding_units, 1.0


def _nights(visit_day: str, today: str) -> int:
    return max(1, (date.fromisoformat(today) - date.fromisoformat(visit_day[:10])).days)


def question_detail(bookings: List[dict], today: str) -> Dict[str, Any]:
    """The 409 body that asks the question (same shape idea as the Board & Train gate)."""
    first = bookings[0]
    names = [b.get("dog_name") or "This dog" for b in bookings]
    who = names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]
    visit_day = str(first.get("date") or "")[:10]
    message = (
        f"{who} {'was' if len(names) == 1 else 'were'} checked in for daycare on {pretty_date(visit_day)} "
        f"and never checked out. Was this a forgotten checkout, or did {'they' if len(names) > 1 else 'the dog'} stay the night?"
    )
    return {
        "code": QUESTION_CODE,
        "message": message,
        "msg": message,
        "booking_ids": [b.get("id") for b in bookings],
        "dog_names": names,
        "booking_date": visit_day,
        "business_day": today,
        "nights": _nights(visit_day, today),
        "resolutions": [
            {"value": "forgotten", "label": "Forgotten checkout — charge the normal daycare day"},
            {"value": "stayed_overnight", "label": "Stayed the night — charge it as boarding"},
        ],
    }


async def _boarding_service() -> dict:
    """The one boarding service a converted night is priced with."""
    rows = await _g("db").services.find(
        {"service_type": "boarding", "active": {"$ne": False},
         "$or": [{"is_addon": {"$ne": True}}, {"is_addon": {"$exists": False}}]},
        {"_id": 0},
    ).to_list(50)
    defaults = [s for s in rows if s.get("is_default")]
    chosen = defaults[0] if len(defaults) == 1 else (rows[0] if len(rows) == 1 else None)
    if not chosen:
        raise BookingBlocked(
            409,
            "There's no single Boarding service to price the night with. Mark one Boarding service as the default "
            "in Settings → Services, or choose Forgotten checkout.",
            code="late_day_no_boarding_service", action="contact_us",
        )
    return chosen


async def _conflicts(booking: dict, today: str) -> None:
    """Refuse a conversion that would charge any part of the stay twice."""
    db = _g("db")
    visit_day = str(booking.get("date"))[:10]
    name = booking.get("dog_name") or "This dog"
    other = await db.bookings.find_one({
        "dog_id": booking.get("dog_id"), "id": {"$ne": booking.get("id")},
        "service_type": "boarding", "status": {"$nin": ["cancelled", "rejected"]},
        "date": {"$lt": today}, "end_date": {"$gt": visit_day},
    }, {"_id": 0, "date": 1, "end_date": 1})
    if other:
        raise BookingBlocked(
            409,
            f"{name} already has a boarding stay covering those nights ({pretty_date(other.get('date'))} to "
            f"{pretty_date(other.get('end_date'))}). Check that stay out instead, or choose Forgotten checkout.",
            code="late_day_boarding_overlap", action="contact_us",
        )
    # A later daycare visit that actually happened means the stay ended when
    # it began — converting would charge those days twice.
    visit = await db.bookings.find_one({
        "dog_id": booking.get("dog_id"), "id": {"$ne": booking.get("id")},
        "service_type": "daycare", "status": {"$nin": ["cancelled", "rejected"]},
        "date": {"$gt": visit_day, "$lte": today},
        "$or": [{"checked_in_at": {"$nin": [None, ""]}}, {"status": "completed"}],
    }, {"_id": 0, "date": 1})
    if visit:
        raise BookingBlocked(
            409,
            f"{name} also has a daycare visit on {pretty_date(visit.get('date'))}, so charging this as a boarding "
            "stay would bill those days twice. Choose Forgotten checkout, or sort out that visit first.",
            code="late_day_daycare_overlap", action="contact_us",
        )


async def boarding_fields(booking: dict, *, today: str, ts: str, original: Optional[dict] = None) -> Dict[str, Any]:
    """The field set that turns this daycare visit into a boarding stay from
    its day to today, picked up now — priced by the same quote every boarding
    stay uses. `original` is the daycare visit when re-pricing a stay that was
    already converted (its group/discount facts are what matter)."""
    base = {**booking, **(original or {})}
    if _g("_booking_is_financially_locked")(booking):
        raise BookingBlocked(
            409,
            f"{booking.get('dog_name') or 'This visit'} already has a payment or a daycare credit on it, so it can't be "
            "switched to boarding here. Choose Forgotten checkout, or undo that payment first.",
            code="late_day_convert_locked", action="contact_us",
        )
    await _conflicts(booking, today)
    svc = await _boarding_service()
    settings = await _g("get_settings")()
    cutoff = _g("_boarding_full_day_cutoff_from_rules")(settings.get("booking_rules") or {})
    now_clock = _now_clock()
    visit_day = str(booking.get("date"))[:10]
    q = await _g("_quote_base_service_price")(
        client_id=booking.get("client_id"), service_type="boarding",
        start_date=visit_day, end_date=today, pickup_time=now_clock,
        pickup_cutoff_time=cutoff, service_id=svc.get("id"), legacy_boarding_minimum=1,
    )
    if float(q.get("unit_price") or 0) <= 0:
        raise BookingBlocked(
            409,
            f"{svc.get('name') or 'Boarding'} has no price set, so the night can't be charged. Set its price in "
            "Settings → Services, or choose Forgotten checkout.",
            code="late_day_no_boarding_price", action="contact_us",
        )
    old_ps = base.get("pricing_snapshot") or {}
    old_md = base.get("multi_dog_discount") or {}
    is_extra = old_ps.get("group_dog_index") not in (None, 0) or bool(old_md.get("pre_applied"))
    full_base = round(float(q.get("estimated_price") or 0), 2)
    units = float(q.get("units") or 0)
    credit_units = round(units * (0.5 if is_extra else 1.0), 2)
    price_keys = ("service_id", "service_name", "unit_price", "list_unit_price", "preferred_rate_applied",
                  "price_override_id", "price_source", "price_label")
    snapshot = {k: q.get(k) for k in price_keys}
    snapshot.update({
        "billable_units": units, "unit_label": "nights", "pickup_cutoff_time": cutoff,
        "credit_units_required": credit_units, "converted_from_service_type": "daycare", "created_at": ts,
    })
    for k in ("group_dog_index", "group_dog_count"):
        if k in old_ps:
            snapshot[k] = old_ps[k]
    fields: Dict[str, Any] = {k: q.get(k) for k in price_keys}
    fields.update({
        "service_type": "boarding", "end_date": today, "pickup_time": now_clock,
        "grooming_type": None, "cost": 0, "credit_units_required": credit_units,
        "pricing_snapshot": snapshot,
    })
    if old_md.get("pre_applied"):
        # Re-base the sibling discount on the boarding price, or the invoice
        # would show the old daycare discount line.
        cfg = _g("_multi_dog_discount_config_for")(settings, "boarding") or {}
        fields["multi_dog_discount"] = {
            **old_md, "pre_applied": True,
            "amount": round(_g("_discount_amount_for_extra_dogs")(full_base, cfg or None, 1), 2),
            "mode": cfg.get("mode") or old_md.get("mode") or "percent",
            "value": cfg.get("value") if cfg.get("value") is not None else old_md.get("value"),
            "label": cfg.get("label") or old_md.get("label"),
            "service_type": "boarding", "based_on_price": full_base, "applied_at": ts,
        }
    # Same factor checkout's boarding auto-price applies, so the stored
    # estimate and the charged amount agree.
    factor = _g("_group_row_price_factor")({**booking, **fields})
    fields["estimated_price"] = round(full_base * factor + _g("_booking_addon_total_from")(booking), 2)
    fields["_quote"] = {
        "service_name": q.get("service_name"), "nights": units, "unit_price": q.get("unit_price"),
        "late_pickup_daycare_fee": q.get("late_pickup_daycare_fee"),
        # The pickup-day daycare fee is always cash (checkout Case C), so the
        # screen needs it to show what is due even when credits cover the nights.
        "late_pickup_cash": round(float(q.get("late_pickup_daycare_fee") or 0) * factor, 2),
        "pickup_time_used": now_clock, "base_price": round(full_base * factor, 2),
    }
    return fields


def _write_filter(booking: dict, *, standalone: bool, **expect: Any) -> Dict[str, Any]:
    """Compare-and-set filter: still not checked out, still in the state
    read, and (from the screen) no checkout holding the row's lock."""
    clauses: List[Dict[str, Any]] = [
        {"id": booking["id"]},
        {"$or": [{"checked_out_at": {"$exists": False}}, {"checked_out_at": None}]},
        {"status": {"$nin": ["completed", "cancelled", "rejected"]}},
    ]
    for key, value in expect.items():
        clauses.append({key: {"$exists": False}} if value is None else {key: value})
    if standalone:
        stale = (datetime.now(timezone.utc) - timedelta(minutes=15)).isoformat()
        clauses.append({"$or": [{"checkout_in_progress": {"$exists": False}}, {"checkout_in_progress": False},
                                {"checkout_started_at": {"$lt": stale}}]})
    return {"$and": clauses}


async def _cas(booking: dict, ops: Dict[str, Any], *, standalone: bool, **expect: Any) -> None:
    res = await _g("db").bookings.update_one(_write_filter(booking, standalone=standalone, **expect), ops)
    if res.matched_count == 0:
        raise HTTPException(status_code=409, detail=CHANGED)


async def resolve(booking: dict, resolution: str, user: dict, *, standalone: bool) -> dict:
    """Save the answer on one booking; returns the updated booking."""
    today = _today()
    ts = _g("now_iso")()
    visit_day = str(booking.get("end_date") or booking.get("date"))[:10]
    record = {
        "resolution": resolution, "booking_date": visit_day, "business_day": today,
        "days_late": _nights(visit_day, today), "checked_in_at": booking.get("checked_in_at"),
        "by": user.get("id"), "by_name": user.get("display_name") or user.get("name"), "at": ts,
    }
    if resolution == "forgotten":
        update = {"late_day_resolution": "forgotten", "late_day_checkout": record}
    elif resolution == "stayed_overnight":
        fields = await boarding_fields(booking, today=today, ts=ts)
        quote = fields.pop("_quote")
        record.update({"nights": quote["nights"], "converted": quote,
                       "original": {k: booking.get(k) for k in CONVERTED_KEYS}})
        update = {**fields, "late_day_resolution": "stayed_overnight", "late_day_checkout": record}
    else:
        raise HTTPException(status_code=400, detail="Choose Forgotten checkout or Stayed the night.")
    await _cas(booking, {"$set": update}, standalone=standalone, service_type="daycare", late_day_resolution=None)
    return {**booking, **update}


async def refresh_stay(booking: dict, *, standalone: bool) -> dict:
    """Re-price an answered stay to the real pickup: today, and now. The
    record of the original daycare visit is kept for undo."""
    if not _open_stay(booking):
        return booking
    record = dict(booking.get("late_day_checkout") or {})
    today = _today()
    ts = _g("now_iso")()
    fields = await boarding_fields(booking, today=today, ts=ts, original=record.get("original"))
    quote = fields.pop("_quote")
    record.update({"business_day": today, "nights": quote["nights"], "converted": quote, "repriced_at": ts})
    update = {**fields, "late_day_checkout": record}
    await _cas(booking, {"$set": update}, standalone=standalone, late_day_resolution="stayed_overnight",
               **{"late_day_checkout.at": record.get("at")})
    return {**booking, **update}


async def undo(booking: dict) -> dict:
    """Take the answer back while the dog is still checked in (screen only)."""
    if booking.get("checked_out_at") or not booking.get("late_day_resolution"):
        return booking
    record = booking.get("late_day_checkout") or {}
    restore = dict(record.get("original") or {}) if booking.get("late_day_resolution") == "stayed_overnight" else {}
    ops: Dict[str, Any] = {"$unset": {"late_day_resolution": "", "late_day_checkout": ""}}
    if restore:
        ops["$set"] = restore
    await _cas(booking, ops, standalone=True, late_day_resolution=booking.get("late_day_resolution"),
               **{"late_day_checkout.at": record.get("at")})
    out = {**booking, **restore}
    out.pop("late_day_resolution", None)
    out.pop("late_day_checkout", None)
    return out


async def ensure_checkout_answer(booking: dict, resolution: Optional[str], user: dict) -> dict:
    """Checkout gate, inside the checkout's lock and rollback: refuse a late
    daycare checkout until it's answered, apply an answer sent with the
    checkout, and re-price an answered stay to the real pickup time."""
    today = _today()
    if _open_stay(booking):
        return await refresh_stay(booking, standalone=False)
    if not needs_answer(booking, today):
        return booking
    if resolution in RESOLUTIONS:
        return await resolve(booking, resolution, user, standalone=False)
    raise HTTPException(status_code=409, detail=question_detail([booking], today))


# ── HTTP: ask before the checkout screen prices anything ──────────────────

class LateDayAnswerIn(BaseModel):
    resolution: str  # forgotten | stayed_overnight | undo


async def _household(anchor: dict) -> List[dict]:
    """The dogs on this checkout ticket — always including the one opened, so
    the question, the answer and the checkout gate cover the same bookings."""
    rows = await _g("_active_household_checkout_rows")(anchor) or []
    if anchor.get("id") not in {r.get("id") for r in rows}:
        rows = [anchor, *rows]
    return rows


def register_late_day_routes(*, api, server_globals: dict) -> None:
    require_employee_or_admin = server_globals["require_employee_or_admin"]

    async def get_late_day_checkout(booking_id: str, _: dict = Depends(require_employee_or_admin)):
        """Does this checkout need the question, and what would each answer
        charge? Always returns the current booking so the screen never prices
        a stale copy; an answered stay is re-priced to now first."""
        db = _g("db")
        anchor = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
        if not anchor:
            raise HTTPException(status_code=404, detail="Booking not found")
        today = _today()
        household = await _household(anchor)
        pending = [r for r in household if needs_answer(r, today)]
        if pending:
            out = question_detail(pending, today)
            out.update({"applies": True, "booking": anchor})
            try:
                quotes = []
                for r in pending:
                    f = await boarding_fields(r, today=today, ts=_g("now_iso")())
                    quotes.append({"booking_id": r["id"], "dog_name": r.get("dog_name"), **f["_quote"]})
                out["stayed_overnight"] = {"available": True, "rows": quotes,
                                           "total": round(sum(float(x["base_price"] or 0) for x in quotes), 2)}
            except HTTPException as exc:
                # The night can't be charged as boarding (no price, already paid,
                # overlapping visit). Say why; Forgotten checkout still works.
                out["stayed_overnight"] = {"available": False, "reason": exc.detail}
            return out
        answered = [r for r in household if r.get("late_day_resolution") and not r.get("checked_out_at")]
        if not answered or not anchor.get("late_day_resolution"):
            return {"applies": False, "booking": anchor}
        cash = 0.0
        for r in answered:
            if _open_stay(r):
                try:
                    r = await refresh_stay(r, standalone=True)
                except HTTPException:
                    pass  # checkout re-prices (or refuses with the reason) anyway
            cash += float(((r.get("late_day_checkout") or {}).get("converted") or {}).get("late_pickup_cash") or 0)
        fresh = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
        per_night = daycare_credits_per_night(fresh)
        return {"applies": False, "resolved": fresh.get("late_day_resolution"), "can_undo": True,
                "record": fresh.get("late_day_checkout"), "booking": fresh,
                "dog_names": [r.get("dog_name") for r in answered], "late_pickup_cash": round(cash, 2),
                "daycare_credit_option": {"available": bool(per_night), "credits_per_night": per_night}}

    async def post_late_day_checkout(booking_id: str, body: LateDayAnswerIn,
                                     user: dict = Depends(require_employee_or_admin)):
        """Save the answer for every late dog on this household ticket (or undo it)."""
        if not _g("_perms_for")(user).get("take_payments"):
            raise HTTPException(status_code=403, detail="Missing permission: take_payments")
        db = _g("db")
        anchor = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
        if not anchor:
            raise HTTPException(status_code=404, detail="Booking not found")
        today = _today()
        household = await _household(anchor)
        if body.resolution == "undo":
            targets = [r for r in household if r.get("late_day_resolution") and not r.get("checked_out_at")]
            updated = [await undo(r) for r in targets]
        elif body.resolution in RESOLUTIONS:
            targets = [r for r in household if needs_answer(r, today)]
            if not targets:
                raise HTTPException(status_code=409, detail=CHANGED)
            if body.resolution == "stayed_overnight":
                # Price every dog first so one refusal changes nothing.
                for r in targets:
                    await boarding_fields(r, today=today, ts=_g("now_iso")())
            updated = [await resolve(r, body.resolution, user, standalone=True) for r in targets]
        else:
            raise HTTPException(status_code=400, detail="Choose Forgotten checkout or Stayed the night.")
        fresh = await db.bookings.find_one({"id": booking_id}, {"_id": 0})
        return {"booking": fresh, "bookings": updated}

    api.add_api_route("/bookings/{booking_id}/late-day-checkout", get_late_day_checkout, methods=["GET"])
    api.add_api_route("/bookings/{booking_id}/late-day-checkout", post_late_day_checkout, methods=["POST"])
