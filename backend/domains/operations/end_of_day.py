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

from domains.bookings import friends_family

from board_train_scheduling import board_train_stay_info
from domains.billing import tab_sync
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
    "payment_status": 1, "payment_method": 1, "is_prepaid_program_session": 1, "report_card": 1,
    "admin_checkout_resolution": 1,
    "bill_to_client_id": 1, "bill_to_client_name": 1,  # friends & family: whose tab holds it (friends_family.payer_id)
}
# Counting what is owed never needs the report card (its photos are inline).
_OWING_FIELDS = {k: v for k, v in _CHECKOUT_FIELDS.items() if k != "report_card"}
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


def _stored_due(b: Dict[str, Any]) -> float:
    return max(0.0, _money(b.get("balance_due"))) if b.get("balance_due") is not None else 0.0


def _parse(stamp: Any) -> Optional[datetime]:
    try:
        dt = datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _net_of_discounts(charges: List[Tuple[datetime, float]], off: float) -> List[Tuple[datetime, float]]:
    """A visit's tab charges less its own tab discounts / write-offs, taken
    off its newest charges first."""
    out = []
    for when, amt in sorted(charges, reverse=True):
        took = min(amt, off)
        off = _money(off - took)
        if amt - took > 0.005:
            out.append((when, _money(amt - took)))
    return out


def _on_bill(inv: Optional[Dict[str, Any]], row: Dict[str, Any]) -> bool:
    """This correction is part of the bill's own balance: it moved the bill,
    or a Fix bill "match" since folded the tab history into it."""
    inv = inv or {}
    if row.get("correction_op_id") and row["correction_op_id"] in (inv.get("correction_ops") or []):
        return True
    made = _parse(row.get("created_at"))
    matched = [_parse(x.get("at")) for x in inv.get("reconciliations") or [] if x.get("action") == "match"]
    return bool(made) and any(m and made <= m for m in matched)


_BILL_FIELDS = {"_id": 0, "id": 1, "booking_ids": 1, "balance": 1, "created_at": 1, "rebuilt_at": 1,
                "correction_ops": 1, "reconciliations": 1}


async def _bills_and_tab_charges(
        visits: List[Dict[str, Any]]
) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, float], Dict[str, float], Dict[str, float]]:
    """Each visit's bill, and what each visit's post-checkout corrections put
    on the tab rather than onto its bill — only corrections to its current
    checkout (a reopened visit's earlier ones were undone by the reopen) and
    only what the family's tab still holds of them. Also each visit's raw
    correction total, before that.

    What the tab still holds is worked out the way a tab payment settles it:
    oldest debt first. So the family's GENERAL balance (the tab less its open
    tab bills, which are counted through the bills) belongs to its newest
    general debts — every charge put on the tab after a checkout (net of that
    visit's own tab discounts), a sale left on account, a manual tab charge —
    handed out newest first (audit #18)."""
    db = _g("db")
    ids = [b["id"] for b in visits]
    checked_out = {b["id"]: _parse(b.get("checked_out_at")) for b in visits}
    bills: Dict[str, Dict[str, Any]] = {}
    for inv in await db.invoices.find(
        {"booking_ids": {"$in": ids}, "status": {"$ne": "VOID"}}, _BILL_FIELDS,
    ).sort("created_at", 1).to_list(None):
        for bid in inv.get("booking_ids") or []:
            bills[bid] = inv
    corr = {"$or": [{"source": CORRECTION_SOURCE}, {"notes": {"$regex": f"^{CORRECTION_NOTE_PREFIX}"}}]}
    far_past = datetime.min.replace(tzinfo=timezone.utc)
    tab: Dict[str, float] = {}
    charged: Dict[str, List[Tuple[datetime, float]]] = {}  # each charge the visit put on the tab, and when
    taken_off: Dict[str, float] = {}  # its discounts / write-offs that came off the tab
    folded: Dict[str, float] = {}  # its corrections that are inside its bill
    for r in await db.payment_ledger.find(
        {"booking_id": {"$in": ids}, **corr},
        {"_id": 0, "booking_id": 1, "amount": 1, "correction_op_id": 1, "created_at": 1},
    ).to_list(None):
        bid = r.get("booking_id")
        made, out = _parse(r.get("created_at")), checked_out.get(bid)
        if made and out and made < out:
            continue  # belongs to an earlier checkout, before a reopen
        if _on_bill(bills.get(bid), r):
            folded[bid] = _money(folded.get(bid, 0.0) + _money(r.get("amount")))
            continue  # already in its bill's balance
        amt = _money(r.get("amount"))
        tab[bid] = _money(tab.get(bid, 0) + amt)
        if amt > 0.005:
            charged.setdefault(bid, []).append((made or far_past, amt))
        else:
            taken_off[bid] = _money(taken_off.get(bid, 0.0) - amt)
    raw = dict(tab)
    owing_tab = {bid for bid, amt in tab.items() if amt > 0.005}
    if not owing_tab:
        return bills, tab, raw, folded
    client_of = {b["id"]: friends_family.payer_id(b) for b in visits}  # whose tab holds it: the payer, on friends & family
    cids = sorted({client_of[bid] for bid in owing_tab if isinstance(client_of.get(bid), str)})
    held = {c["id"]: max(0.0, _money(c.get("account_balance")))
            for c in await db.clients.find({"id": {"$in": cids}}, {"_id": 0, "id": 1, "account_balance": 1}).to_list(None)}
    drift: Dict[str, List[Dict[str, Any]]] = {}
    for c in list(held):
        in_step, open_bills = await tab_sync.client_bills_in_step(c)
        if in_step:
            held[c] = max(0.0, _money(held[c] - sum(_money(i.get("balance")) for i in open_bills)))
        else:
            drift[c] = open_bills
    live: Dict[str, float] = dict(raw)  # each visit's live post-checkout tab rows, net
    debts: Dict[str, List[Tuple[datetime, float, Optional[str]]]] = {c: [] for c in held}  # (when, amount, visit or None)
    for bid in owing_tab:
        c = client_of.get(bid)
        if c in debts:
            debts[c].extend((when, amt, bid) for when, amt in _net_of_discounts(charged.get(bid, []), taken_off.get(bid, 0.0)))
    sales: Dict[Tuple[str, Any], Tuple[datetime, float]] = {}
    other: List[Dict[str, Any]] = []
    for r in await db.payment_ledger.find(
        {"client_id": {"$in": list(held)}, "invoice_id": None,
         "$or": [{"sale_kind": {"$exists": True, "$ne": None}},
                 {"booking_id": None, "type": "adjustment", "amount": {"$gt": 0}, "source": {"$ne": "credit_on_file"}},
                 {"booking_id": {"$nin": ids + [None]}, **corr}]},
        {"_id": 0, "client_id": 1, "booking_id": 1, "sale_kind": 1, "sale_id": 1, "type": 1,
         "amount": 1, "created_at": 1, "correction_op_id": 1},
    ).to_list(None):
        made = _parse(r.get("created_at")) or far_past
        if r.get("sale_kind"):
            key = (r["client_id"], r.get("sale_id") or id(r))
            when, amt = sales.get(key, (made, 0.0))
            sales[key] = (min(when, made), _money(amt + _money(r.get("amount"))))
        elif r.get("booking_id"):
            other.append(r)
        else:
            debts[r["client_id"]].append((made, _money(r.get("amount")), None))
    for (c, _s), (when, amt) in sales.items():
        if amt > 0.005:
            debts[c].append((when, amt, None))
    if other:
        # The family's other visits: only their live post-checkout charges —
        # not ones on their bill, and not ones a reopen undid (a reopened or
        # redone visit's cut-off is the later of its reopen and checkout).
        oids = sorted({r["booking_id"] for r in other})
        cut: Dict[str, Optional[datetime]] = {}
        for b in await _g("_booking_rows_anywhere")(
                {"id": {"$in": oids}}, {"_id": 0, "id": 1, "checked_out_at": 1, "financial_reopened_at": 1},
                limit=BIG, sort_field="id"):
            stamps = [t for t in (_parse(b.get("checked_out_at")), _parse(b.get("financial_reopened_at"))) if t]
            cut[b["id"]] = max(stamps) if stamps else None
        obill: Dict[str, Dict[str, Any]] = {}
        for inv in await db.invoices.find({"booking_ids": {"$in": oids}, "status": {"$ne": "VOID"}}, _BILL_FIELDS).to_list(None):
            for bid in inv.get("booking_ids") or []:
                obill[bid] = inv
        ocharged: Dict[Tuple[str, str], List[Tuple[datetime, float]]] = {}
        ooff: Dict[Tuple[str, str], float] = {}
        for r in other:
            made, since = _parse(r.get("created_at")), cut.get(r["booking_id"])
            if _on_bill(obill.get(r["booking_id"]), r) or (made and since and made <= since):
                continue
            key = (r["client_id"], r["booking_id"])
            amt = _money(r.get("amount"))
            live[r["booking_id"]] = _money(live.get(r["booking_id"], 0.0) + amt)
            if amt > 0.005:
                ocharged.setdefault(key, []).append((made or far_past, amt))
            else:
                ooff[key] = _money(ooff.get(key, 0.0) - amt)
        for (c, obid), items in ocharged.items():
            debts[c].extend((when, amt, None) for when, amt in _net_of_discounts(items, ooff.get((c, obid), 0.0)))
    for c, open_bills in drift.items():
        # A bill out of step with the tab: its balance can't be trusted, but
        # the tab rows tagged to it can. What the tab holds for the bill
        # itself (its checkout charges, payments, reversals — not its visits'
        # later charges, listed as general debts above) isn't general balance.
        own = 0.0
        for inv in open_bills:
            net = _money((await tab_sync.invoice_ar_status(inv)).get("booking_net"))
            own += max(0.0, _money(net - sum(live.get(v, 0.0) for v in inv.get("booking_ids") or [])))
        held[c] = max(0.0, _money(held[c] - own))
    # A write-off on the general balance names no charge: it may have
    # reversed a NEWER charge (a paid visit's mistaken charge can only be
    # undone there, as can a sale left on account), so newest-first would
    # hand the rest to that charge and hide an older real one. A visit
    # charged before such a write-off keeps the plain cap: its charges,
    # never more than the general balance.
    wo_at: Dict[str, datetime] = {}
    for r in await db.payment_ledger.find(
        {"client_id": {"$in": list(held)}, "invoice_id": None, "booking_id": None, "type": "adjustment",
         "amount": {"$lt": 0}, "sale_kind": None},
        {"_id": 0, "client_id": 1, "created_at": 1},
    ).to_list(None):
        made = _parse(r.get("created_at")) or far_past
        wo_at[r["client_id"]] = max(made, wo_at.get(r["client_id"], far_past))
    got: Dict[str, float] = {}
    for c, items in debts.items():
        left = held[c]
        for when, amt, bid in sorted(items, key=lambda x: (x[0], x[2] or ""), reverse=True):
            took = min(amt, left)
            left = _money(left - took)
            if bid is not None:
                got[bid] = _money(got.get(bid, 0.0) + took)
    for bid in owing_tab:
        c = client_of.get(bid)
        if c not in held:
            tab[bid] = 0.0
        elif c in wo_at and any(when < wo_at[c] for when, _a in charged.get(bid, [])):
            tab[bid] = min(raw[bid], held[c])
        else:
            # never more than the visit's own charges net of its tab discounts
            tab[bid] = min(got.get(bid, 0.0), raw[bid])
    return bills, tab, raw, folded


async def unpaid(checkouts: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    # A prepaid program session is settled at checkout (price 0) — unless it
    # picked up a real charge (an add-on on the tab, a charge added after
    # checkout), which is owed like on any visit (audit #18).
    cands = [b for b in checkouts if max(_visit_due(b), _computed_due(b), _stored_due(b)) > 0.005]
    if not cands:
        return []
    # The price arithmetic says settled, yet the visit stores a due: only a
    # post-checkout charge explains it (a credits visit or a prepaid session
    # keeps its price). It counts while its bill or the tab still holds it.
    tab_only = {b["id"] for b in cands if max(_visit_due(b), _computed_due(b)) <= 0.005}
    bills, tab, raw, folded = await _bills_and_tab_charges(cands)
    # A bill describes the visit unless it predates the visit's latest
    # checkout (billed at an earlier checkout, then reopened).
    usable: Dict[str, bool] = {}
    for b in cands:
        bill = bills.get(b["id"])
        # a bill rebuilt at the latest checkout describes it (audit #14)
        made, out = _parse((bill or {}).get("rebuilt_at") or (bill or {}).get("created_at")), _parse(b.get("checked_out_at"))
        usable[b["id"]] = bool(bill is not None and bill.get("balance") is not None and not (made and out and made < out))
    # Against a live bill the visit's due is its full price arithmetic (a
    # due stored at a correction goes stale when a bill payment is voided);
    # the bill caps it. Without one, the stored due is the best we have.
    # Credits paid a credits visit's price: its only claim on the bill is what
    # was charged on it after checkout (a charge leaves it "paid_partial" with
    # nothing paid, so its price arithmetic would claim the whole price).
    due_of = {b["id"]: (_stored_due(b) if b["id"] in tab_only
                        else _money(max(0.0, folded.get(b["id"], 0.0)) + max(0.0, raw.get(b["id"], 0.0)))
                        if usable[b["id"]] and b.get("payment_method") == "credits"
                        else max(_visit_due(b), _computed_due(b)) if usable[b["id"]] else _visit_due(b)) for b in cands}
    # A bill covering several dogs is shared out, in its own order, so the
    # same balance isn't listed once per dog.
    share: Dict[str, float] = {}
    for inv in {id(v): v for v in bills.values()}.values():
        if inv.get("balance") is None:
            continue
        left = max(0.0, _money(inv.get("balance")))
        # A tab_only visit's due was charged to the tab, not this bill: it
        # takes a share only after the other dogs.
        for bid in sorted(inv.get("booking_ids") or [], key=lambda x: x in tab_only):
            if usable.get(bid):
                # Its own charges that went on the tab are not this bill's.
                share[bid] = min(max(0.0, due_of[bid] - max(0.0, raw.get(bid, 0.0))), left)
                left = _money(left - share[bid])
    rows = []
    for b in cands:
        bid = b["id"]
        due = due_of[bid]
        if usable[bid]:
            # Its part of the bill plus what the tab still holds of its own
            # later charges (a paid bill's visit keeps only the latest charge
            # in its stored due, so the tab part is never capped by it).
            amount = share.get(bid, 0.0) + max(0.0, tab.get(bid, 0.0))
        elif bid in tab:
            # No bill, but charges added after checkout went on the tab: only
            # the part of them the tab no longer holds comes off. The rest of
            # the stored due (the checkout's own debt, a charge kept on the
            # visit) stays owed.
            put_on_tab = max(0.0, raw.get(bid, 0.0))
            amount = max(0.0, due - put_on_tab) + max(0.0, tab.get(bid, 0.0))
            if bills.get(bid) is None:
                # With no bill the visit's own due holds every charge and any
                # discount made on it since — never more than that.
                amount = min(due, amount)
        elif bid in tab_only:
            amount = 0.0  # nothing on a bill or the tab explains the stored due
        else:
            amount = due
        amount = _money(amount)
        if amount <= 0.005:
            continue  # paid on the bill after checkout
        rows.append({
            "booking_id": b["id"],
            "dog_name": b.get("dog_name", ""),
            "client_name": b.get("client_name", ""),
            "billed_to": b.get("bill_to_client_name") or "",  # friends & family: who pays for this dog
            "amount": amount,
            "service_type": b.get("service_type", ""),
            "checked_out_at": b.get("checked_out_at") or "",
        })
    return rows


async def owed(visits: List[Dict[str, Any]]) -> float:
    """What these visits still really owe, by the same rule as the unpaid
    list: a bill paid after checkout leaves the visit's own stored due
    behind, so the bill's live balance decides (audit #18)."""
    rows = await unpaid([b for b in visits if b.get("status") == "completed"])
    return _money(sum(r["amount"] for r in rows))


async def owing_visit_count() -> int:
    """How many visits still really owe money (Action Required)."""
    rows = await _g("db").bookings.find(
        {"status": {"$nin": ["cancelled", "rejected"]}, "balance_due": {"$gt": 0}}, _OWING_FIELDS).to_list(None)
    return len(await unpaid(rows))


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
