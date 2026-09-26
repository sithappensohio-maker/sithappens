"""End of Day: who is still here and what is still owed, for the whole day
(audit #9).

The wrap-up used to load only the visits that STARTED on the day. A boarding
or Board & Train dog on its last day started days earlier, so it was never
looked at: End of Day could say "All clear" with that dog still checked in,
or with its pickup left unpaid, and the pickup's money never showed.

Rules:
  * On premises — every visit still checked in that had arrived by the day
    (by the business day of `checked_in_at`; no date window and no cap, so an
    overdue stay can't slip out). A boarding or Board & Train stay whose
    pickup is after the day is a stayover: expected, not a blocker. Everything
    else blocks, with a note saying why: a stay due out that day, a visit
    whose day has passed (counted from the later of its scheduled end and the
    day it actually arrived), a checkout that was reopened, a stay with no
    pickup date, and any day visit still checked in. Board & Train is known
    by its service (the same test its checkout uses), not guessed from dates.
    A "completed" visit with no checkout time (a money edit, not a pickup) is
    closed, not on premises.
  * Checkouts — unpaid visits, the visit count and optional report cards
    follow the day the dog was CHECKED OUT (business day of
    `checked_out_at`), not the day the visit started. Rows nobody checked out
    (no `checked_out_by`: an income record entered later, or an old row) keep
    their visit date, as before. Rows closed by the stuck-checkout tool aren't
    pickups: they aren't counted and need no report card.
  * Owed — the visit's own due, capped by what its bill still says (the
    visit's fields go stale once the bill is paid) plus any charge added
    after checkout that went on the tab instead of the bill. A bill that
    predates the visit's latest checkout (a reopened visit) doesn't describe
    it and is ignored; a bill covering several dogs is shared out among them.
  * Money — "revenue_cash" is the register's booking payments for the day:
    visit money taken at checkout on the day it was collected, the same
    number the Register and Today's P&L show.
  * Care — meals, meds and bathroom trips are counted for the day itself,
    across every visit on site, never a stay's running total.

For a past day (the Register screen can close one late) the same rules run
against that day; "still checked in" is always the state now. One bad row
never breaks the snapshot: the register closeout is built on it.

server.py is at its line ceiling, so this module reads the server helpers it
needs live (same pattern as domains.bookings.late_day).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Set, Tuple

from board_train_scheduling import board_train_stay_info
from domains.bookings import care as care_domain
from domains.bookings.blocks import pretty_date

REPORT_CARD_SERVICES = ("daycare", "boarding", "training")
CARE_LOGS = (("feeding_log", "feeding"), ("medication_log", "medication"))
CORRECTION_SOURCE = "correction"
CORRECTION_NOTE_PREFIX = "Post-checkout"
BIG = 100000

_ON_SITE_FIELDS = {
    "_id": 0, "id": 1, "dog_name": 1, "client_name": 1, "service_type": 1, "service_id": 1, "kennel": 1,
    "date": 1, "end_date": 1, "checked_in_at": 1, "financial_reopened_at": 1,
}
_CHECKOUT_FIELDS = {
    "_id": 0, "id": 1, "dog_name": 1, "client_name": 1, "service_type": 1, "date": 1, "status": 1,
    "client_id": 1, "checked_out_at": 1, "checked_out_by": 1, "actual_price": 1, "amount_paid": 1, "balance_due": 1,
    "payment_status": 1, "is_prepaid_program_session": 1, "report_card": 1, "admin_checkout_resolution": 1,
}
_CARE_FIELDS = {
    "_id": 0, "id": 1, "date": 1, "end_date": 1, "checked_in_at": 1, "care_items": 1, "care_per_day_since": 1,
    "bathroom_log": 1, "bathroom_days": 1,
    **{f"{log}.{f}": 1 for log, _k in CARE_LOGS for f in ("at", "care_item_id", "day")},
}

_server_globals: Optional[dict] = None


def configure(*, server_globals: dict) -> None:
    global _server_globals
    _server_globals = server_globals


def _g(name: str):
    return _server_globals[name]


def _day(value: Any) -> str:
    """A YYYY-MM-DD date, or "" when the stored value isn't one."""
    raw = str(value or "")[:10]
    try:
        return date.fromisoformat(raw).isoformat()
    except ValueError:
        return ""


def _local_day(stamp: Any, fallback: str) -> str:
    return _g("_business_date_from_timestamp")(stamp, fallback or None)


def _days_between(a: str, b: str) -> int:
    return (date.fromisoformat(b) - date.fromisoformat(a)).days


def _plural(n: int, word: str) -> str:
    return f"{n} {word}{'' if n == 1 else 's'}"


def _svc(b: Dict[str, Any]) -> str:
    return str(b.get("service_type") or "").lower()


def _money(value: Any) -> float:
    try:
        return round(float(value or 0), 2)
    except (TypeError, ValueError):
        return 0.0


# ─────────────────────────────────────────────── who is still here

async def board_train_ids(rows: List[Dict[str, Any]]) -> Set[str]:
    """Training visits that are Board & Train stays. Known by the service
    (as its checkout knows it); a visit with no service on file falls back to
    spanning more than one day."""
    training = [b for b in rows if _svc(b) == "training"]
    service_ids = list({b["service_id"] for b in training if isinstance(b.get("service_id"), str) and b["service_id"]})
    resolved: Dict[str, bool] = {}
    if service_ids:
        db = _g("db")
        for svc in await db.services.find({"id": {"$in": service_ids}}, {"_id": 0}).to_list(None):
            try:
                resolved[svc["id"]] = bool(await board_train_stay_info(db, svc))
            except Exception:
                resolved[svc["id"]] = False
    out: Set[str] = set()
    for b in training:
        sid = b.get("service_id")
        if isinstance(sid, str) and sid in resolved:
            is_bt = resolved[sid]
        else:
            end, start = _day(b.get("end_date")), _day(b.get("date"))
            is_bt = bool(end and start and end > start)
        if is_bt:
            out.add(b.get("id"))
    return out


def classify(b: Dict[str, Any], day: str, residential: bool, today: Optional[str] = None) -> Tuple[str, str, Optional[int]]:
    """(reason, note, days_late) for a visit still checked in on `day`.
    reason "stayover" is the only one that doesn't block the day."""
    today = today or _g("business_today")().isoformat()
    on_day = "today" if day == today else pretty_date(day)
    start = _day(b.get("date"))
    end = _day(b.get("end_date"))
    arrived = _local_day(b.get("checked_in_at"), start or day) if b.get("checked_in_at") else ""
    arrived = _day(arrived)
    start = start or arrived or day
    sched_end = max(start, end) if end else start
    if b.get("financial_reopened_at"):
        when = _day(_local_day(b.get("financial_reopened_at"), ""))
        return "reopened", f"Checkout was reopened{' ' + pretty_date(when) if when else ''} — check the dog out again", None
    no_pickup = residential and not end
    if residential and not no_pickup and sched_end > day:
        if start > day:
            return "stayover", f"Arrived early (booked from {pretty_date(start)}) · checks out {pretty_date(sched_end)}", None
        return "stayover", f"Checks out {pretty_date(sched_end)}", None
    # A visit is late only after BOTH its scheduled end and the day it
    # arrived (a back-dated walk-in checked in today isn't a day late).
    effective_end = max(sched_end, arrived) if arrived else sched_end
    if effective_end < day:
        late = _days_between(effective_end, day)
        if no_pickup:
            return "overdue", f"No pickup date on file — here since {pretty_date(arrived or start)}", late
        if residential and arrived > sched_end:
            return "overdue", (f"Still checked in since {pretty_date(arrived)} ({_plural(late, 'day')} ago)"
                               f" — the stay was due out {pretty_date(sched_end)}"), late
        if residential:
            return "overdue", f"Still checked in — was due out {pretty_date(sched_end)} ({_plural(late, 'day')} ago)", late
        return "overdue", f"Still checked in from {pretty_date(effective_end)} ({_plural(late, 'day')} ago)", late
    if no_pickup:
        return "due_out", "No pickup date on file — set one or check the dog out", None
    if residential and arrived > sched_end:
        return "due_out", f"Checked in {on_day} for a stay due out {pretty_date(sched_end)}", None
    if residential:
        return "due_out", f"Due out {on_day}", None
    if start > day:
        return "on_site", f"Checked in early for {pretty_date(start)}", None
    return "on_site", "Still checked in", None


async def on_premises(day: str) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """(blockers, stayovers) — every open check-in that had arrived by `day`."""
    rows = await _g("db").bookings.find(
        {"status": "approved", "checked_in_at": {"$nin": [None, ""]}, "checked_out_at": {"$in": [None, ""]}},
        _ON_SITE_FIELDS,
    ).sort("checked_in_at", 1).to_list(None)
    arrived = [b for b in rows if isinstance(b.get("id"), str) and b["id"]
               and _local_day(b.get("checked_in_at"), _day(b.get("date"))) <= day]
    bt = await board_train_ids(arrived)
    today = _g("business_today")().isoformat()
    blockers: List[Dict[str, Any]] = []
    stayovers: List[Dict[str, Any]] = []
    seen: Set[str] = set()
    for b in arrived:
        if b["id"] in seen:
            continue
        seen.add(b["id"])
        svc = _svc(b)
        residential = svc == "boarding" or b["id"] in bt
        try:
            reason, note, late = classify(b, day, residential, today)
        except Exception:  # one odd row must never break the closeout
            reason, note, late = "on_site", "Still checked in", None
        row = {
            "booking_id": b["id"],
            "dog_name": b.get("dog_name", ""),
            "client_name": b.get("client_name", ""),
            "service_type": b.get("service_type", ""),
            "kennel": b.get("kennel", ""),
            "checked_in_at": b.get("checked_in_at", ""),
            "date": _day(b.get("date")),
            "end_date": _day(b.get("end_date")) or _day(b.get("date")) or day,
            "reason": reason,
            "note": note,
        }
        if reason == "stayover":
            row["stay_kind"] = "boarding" if svc == "boarding" else "board_train"
            stayovers.append(row)
        else:
            if late is not None:
                row["days_late"] = late
            blockers.append(row)
    return blockers, stayovers


# ─────────────────────────────────────────────── the day's checkouts

async def checked_out_on(day: str) -> List[Dict[str, Any]]:
    """Completed visits checked out on `day`, hot and archived, once each.
    Rows nobody checked out (no checked_out_by) and old rows with no checkout
    time belong to their visit date."""
    anywhere = _g("_booking_rows_anywhere")
    bounds = _g("_business_day_utc_bounds")
    d = date.fromisoformat(day)
    # A day wider on each side, then the exact business-day test: robust to
    # "Z" or offset-less stamps that don't compare as strings.
    lo = bounds((d - timedelta(days=1)).isoformat())[0]
    hi = bounds((d + timedelta(days=1)).isoformat())[1]
    stamped = await anywhere(
        {"status": "completed", "checked_out_at": {"$gte": lo, "$lt": hi}, "checked_out_by": {"$nin": [None, ""]}},
        _CHECKOUT_FIELDS, limit=BIG, sort_field="checked_out_at",
    )
    by_date = await anywhere(
        {"status": "completed", "date": day,
         "$or": [{"checked_out_at": {"$in": [None, ""]}}, {"checked_out_by": {"$in": [None, ""]}}]},
        _CHECKOUT_FIELDS, limit=BIG, sort_field="date",
    )
    out: List[Dict[str, Any]] = []
    seen: Set[str] = set()
    for b in stamped:
        if not b.get("id") or b["id"] in seen or _local_day(b.get("checked_out_at"), _day(b.get("date"))) != day:
            continue
        seen.add(b["id"])
        out.append(b)
    for b in by_date:
        if b.get("id") and b["id"] not in seen:
            seen.add(b["id"])
            out.append(b)
    return out


def _computed_due(b: Dict[str, Any]) -> float:
    return max(0.0, _money(_g("_booking_balance_due")(b)))


def _visit_due(b: Dict[str, Any]) -> float:
    """What the visit itself says is owed, with no bill to go by. A
    post-checkout correction keeps the stored balance_due current (e.g. a
    credits visit's added charge) where the price arithmetic can't; a
    settled visit is never owed."""
    due = _computed_due(b)
    if due > 0 and b.get("balance_due") is not None:
        due = max(0.0, _money(b.get("balance_due")))
    return due


def _parse(stamp: Any) -> Optional[datetime]:
    try:
        dt = datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


async def _bills_and_tab_charges(visits: List[Dict[str, Any]]) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, float]]:
    """Each visit's bill, and what each visit's post-checkout corrections put
    on the tab rather than onto its bill — only corrections to its current
    checkout (a reopened visit's earlier ones were undone by the reopen) and
    never more than the client's tab still holds (a tab payment clears them
    without touching the visit)."""
    db = _g("db")
    ids = [b["id"] for b in visits]
    checked_out = {b["id"]: _parse(b.get("checked_out_at")) for b in visits}
    bills: Dict[str, Dict[str, Any]] = {}
    for inv in await db.invoices.find(
        {"booking_ids": {"$in": ids}, "status": {"$ne": "VOID"}},
        {"_id": 0, "id": 1, "booking_ids": 1, "balance": 1, "created_at": 1, "correction_ops": 1},
    ).sort("created_at", 1).to_list(None):
        for bid in inv.get("booking_ids") or []:
            bills[bid] = inv
    tab: Dict[str, float] = {}
    rows = await db.payment_ledger.find(
        {"booking_id": {"$in": ids},
         "$or": [{"source": CORRECTION_SOURCE}, {"notes": {"$regex": f"^{CORRECTION_NOTE_PREFIX}"}}]},
        {"_id": 0, "booking_id": 1, "amount": 1, "correction_op_id": 1, "created_at": 1},
    ).to_list(None)
    for r in rows:
        bid = r.get("booking_id")
        on_bill = (bills.get(bid) or {}).get("correction_ops") or []
        if r.get("correction_op_id") and r["correction_op_id"] in on_bill:
            continue  # moved the bill too — already in its balance
        made, out = _parse(r.get("created_at")), checked_out.get(bid)
        if made and out and made < out:
            continue  # belongs to an earlier checkout, before a reopen
        tab[bid] = _money(tab.get(bid, 0) + _money(r.get("amount")))
    owing_tab = {bid for bid, amt in tab.items() if amt > 0.005}
    if owing_tab:
        client_of = {b["id"]: b.get("client_id") for b in visits}
        cids = sorted({client_of[bid] for bid in owing_tab if isinstance(client_of.get(bid), str)})
        held = {c["id"]: max(0.0, _money(c.get("account_balance")))
                for c in await db.clients.find({"id": {"$in": cids}}, {"_id": 0, "id": 1, "account_balance": 1}).to_list(None)}
        for bid in owing_tab:
            tab[bid] = min(tab[bid], held.get(client_of.get(bid), 0.0))
    return bills, tab


async def unpaid(checkouts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    cands = [b for b in checkouts if not b.get("is_prepaid_program_session")
             and max(_visit_due(b), _computed_due(b)) > 0.005]
    if not cands:
        return []
    bills, tab = await _bills_and_tab_charges(cands)
    # A bill describes the visit unless it predates the visit's latest
    # checkout (billed at an earlier checkout, then reopened).
    usable: Dict[str, bool] = {}
    for b in cands:
        bill = bills.get(b["id"])
        made, out = _parse((bill or {}).get("created_at")), _parse(b.get("checked_out_at"))
        usable[b["id"]] = bool(bill is not None and bill.get("balance") is not None and not (made and out and made < out))
    # Against a live bill the visit's due is its full price arithmetic (a
    # due stored at a correction goes stale when a bill payment is voided);
    # the bill caps it. Without one, the stored due is the best we have.
    due_of = {b["id"]: (max(_visit_due(b), _computed_due(b)) if usable[b["id"]] else _visit_due(b)) for b in cands}
    # A bill covering several dogs is shared out, in its own order, so the
    # same balance isn't listed once per dog.
    share: Dict[str, float] = {}
    for inv in {id(v): v for v in bills.values()}.values():
        if inv.get("balance") is None:
            continue
        left = max(0.0, _money(inv.get("balance")))
        for bid in inv.get("booking_ids") or []:
            if usable.get(bid):
                share[bid] = min(due_of[bid], left)
                left = _money(left - share[bid])
    rows = []
    for b in cands:
        due = due_of[b["id"]]
        amount = min(due, share.get(b["id"], 0.0) + max(0.0, tab.get(b["id"], 0.0))) if usable[b["id"]] else due
        amount = _money(amount)
        if amount <= 0.005:
            continue  # paid on the bill after checkout
        rows.append({
            "booking_id": b["id"],
            "dog_name": b.get("dog_name", ""),
            "client_name": b.get("client_name", ""),
            "amount": amount,
            "service_type": b.get("service_type", ""),
            "checked_out_at": b.get("checked_out_at") or "",
        })
    return rows


def pickups(checkouts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Real pickups: not rows the stuck-checkout tool closed."""
    return [b for b in checkouts if not b.get("admin_checkout_resolution")]


def optional_report_cards(checkouts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    has_card = _g("_booking_has_report_card")
    return [
        {
            "booking_id": b["id"],
            "dog_name": b.get("dog_name", ""),
            "client_name": b.get("client_name", ""),
            "service_type": b.get("service_type", ""),
        }
        for b in pickups(checkouts)
        if (b.get("service_type") or "") in REPORT_CARD_SERVICES and not has_card(b)
    ]


# ─────────────────────────────────────────────── care for the day itself

def care_counts(b: Dict[str, Any], day: str) -> Dict[str, int]:
    """Meals, meds and bathroom trips recorded for `day` on one visit."""
    booking_date = _day(b.get("date"))
    out = {"feedings": 0, "medications": 0, "pee": 0, "poop": 0}
    counted = set()
    for it in b.get("care_items") or []:
        if not isinstance(it, dict):
            continue
        rec = care_domain.day_record(it, day, booking_date)
        kind = it.get("kind")
        if not isinstance(rec, dict) or rec.get("status") != "completed" or kind not in ("feeding", "medication"):
            continue
        out["feedings" if kind == "feeding" else "medications"] += 1
        if rec.get("completed_at"):
            counted.add((kind, rec["completed_at"]))
    # Log entries tied to a care item are that item's day record, counted
    # above. Untied ones (an old roster screen's tap) count only for days
    # before this visit was tracked per day, and not when carried onto the
    # Care Board already; from then on the day records are the whole truth.
    since = _day(b.get("care_per_day_since"))
    if not since or day < since:
        for log, kind in CARE_LOGS:
            for e in b.get(log) or []:
                if not isinstance(e, dict):
                    continue
                at = e.get("at")
                if e.get("care_item_id") or not at or (kind, at) in counted:
                    continue
                if (_day(e.get("day")) or _local_day(at, booking_date)) == day:
                    out["feedings" if kind == "feeding" else "medications"] += 1
    days = b.get("bathroom_days") if isinstance(b.get("bathroom_days"), dict) else {}
    log = b.get("bathroom_log") if isinstance(b.get("bathroom_log"), dict) else {}
    one_day = booking_date == day and (_day(b.get("end_date")) or booking_date) == booking_date
    for k in ("pee", "poop"):
        bucket = days.get(day)
        n = (care_domain._count(bucket.get(k)) or 0) if isinstance(bucket, dict) else 0
        if one_day:
            # A one-day visit's taps from before per-day counting can only
            # be from that day.
            tracked = sum((care_domain._count(v.get(k)) or 0) for v in days.values() if isinstance(v, dict))
            n += max(0, (care_domain._count(log.get(k)) or 0) - tracked)
        out[k] += n
    return out


async def care_totals(day: str) -> Dict[str, int]:
    """Every visit that could have been on site on `day`: it started that
    day, its stay covers the day, the dog is still here (including one
    checked in before its booking date), or it left on or after the day.
    Each branch is served by an index (ensure_indexes)."""
    db = _g("db")
    start, _end = _g("_business_day_utc_bounds")(day)
    statuses = {"$in": ["approved", "completed"]}
    rows = await db.bookings.find(
        {"status": statuses, "$or": [
            {"date": day},
            {"end_date": {"$gte": day}, "date": {"$lte": day}},
            {"checked_out_at": {"$in": [None, ""]}, "checked_in_at": {"$nin": [None, ""]}},
            {"checked_out_at": {"$gte": start}},
        ]},
        _CARE_FIELDS,
    ).to_list(None)
    seen = {b.get("id") for b in rows}
    # Archived visits are closed, so only one that started or left on/after the day.
    try:
        archived = await db.bookings_archive.find(
            {"status": statuses, "$or": [{"date": day}, {"checked_out_at": {"$gte": start}}]}, _CARE_FIELDS,
        ).to_list(None)
    except Exception:
        archived = []
    rows += [b for b in archived if b.get("id") not in seen]
    totals = {"feedings": 0, "medications": 0, "pee": 0, "poop": 0}
    for b in rows:
        if _day(b.get("date")) > day and not b.get("checked_in_at"):
            continue
        try:
            counts = care_counts(b, day)
        except Exception:  # one odd row must never break the closeout
            continue
        for k, v in counts.items():
            totals[k] += v
    return totals


INDEXES = (
    ("bookings", [("checked_out_at", 1), ("checked_in_at", 1)], "bookings_checkout_checkin"),
    ("bookings", [("end_date", 1)], "bookings_end_date"),
    ("bookings_archive", [("checked_out_at", 1)], "bookings_archive_checked_out_at"),
)


async def ensure_indexes() -> None:
    """End of Day's lookups by checkout time and stay end, on the live and
    archived bookings — so it never reads the whole booking history."""
    db = _g("db")
    for coll, keys, name in INDEXES:
        try:
            await db[coll].create_index(keys, name=name)
        except Exception as exc:  # an existing equivalent index is fine
            _g("logger").warning("End of Day index %s: %s", name, exc)


async def snapshot(day: Optional[str] = None) -> Dict[str, Any]:
    today = _g("_validated_register_date")(day)
    still_on, stayovers = await on_premises(today)
    checkouts = await checked_out_on(today)
    owed = await unpaid(checkouts)
    cards = optional_report_cards(checkouts)
    register = await _g("_register_day_summary")(today)
    staff_readiness = await _g("_staff_readiness_summary")(today)
    revenue = _money((register.get("incoming_sources") or {}).get("booking_payments"))
    clear = not still_on and not owed
    return {
        "date": today,
        "register": register,
        "staff_readiness": staff_readiness,
        "still_on_premises": still_on,
        "boarding_stayovers": stayovers,
        "unpaid_bookings": owed,
        # Kept for backward compatibility with the existing UI/tests.
        # Report cards are optional and do not block all-clear closeout.
        "missing_report_cards": cards,
        "optional_report_cards": cards,
        "revenue_cash": revenue,
        "completed_count": len(pickups(checkouts)),
        "care_log_totals": await care_totals(today),
        "hard_clear": clear,
        "all_clear": clear,
    }
