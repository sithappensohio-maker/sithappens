"""Pay schedule and payday: what each staff member is owed on payday.

The schedule is one settings row (id "payroll_schedule"): how often staff are
paid and one real payday to count from. Paydays repeat every 7 or 14 days from
that date in both directions, so a past payday and an upcoming one both work.
A payday pays every shift since the previous payday, up to the day before it.

The amounts are the Payroll Tax estimate for that period (each shift at the
rate it was worked at, owner excluded as a draw), so a payday never disagrees
with the Payroll Tax tab or the payroll CSV for the same dates.

Marking someone paid records the payment (collection `payroll_payments`): who,
how much, how and when. It is not an expense: the P&L already counts payroll
from timecards. Cash taken from the register drawer is also recorded as a till
adjustment, so the drawer's expected cash stays right. What is still owed is
the estimate minus what was paid; the payday card on Today goes once nothing is.
"""
import uuid
from datetime import date, timedelta
from typing import Any, Dict, List, Literal, Optional, Tuple

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError

from domains.backup import deletion_log

SETTINGS_ID = "payroll_schedule"
CADENCE_DAYS = {"weekly": 7, "biweekly": 14}
PayMethod = Literal["cash", "check", "transfer", "venmo", "paypal", "card", "other"]


def latest_payday(anchor: date, every_days: int, today: date) -> date:
    """The most recent payday on or before `today`."""
    return anchor + timedelta(days=((today - anchor).days // every_days) * every_days)


def pay_period(payday: date, every_days: int) -> Tuple[date, date]:
    """First and last day of the hours a payday pays."""
    return payday - timedelta(days=every_days), payday - timedelta(days=1)


def _short(d: date) -> str:
    return f"{d:%a %b} {d.day}"


def _schedule(row: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """The saved schedule row, or None when there isn't a usable one."""
    if not row or row.get("cadence") not in CADENCE_DAYS:
        return None
    try:
        date.fromisoformat(row.get("anchor_payday") or "")
    except ValueError:
        return None
    return row


def saved_schedule(old: Optional[Dict[str, Any]], cadence: str, anchor: date, today: date) -> Dict[str, Any]:
    """The schedule row to save when the owner saves `cadence`/`anchor` today.

    set_on is the day the paydays took effect; paydays before it never show a
    card. paid_through is the last day an earlier schedule's paydays paid, so a
    new schedule's first payday starts the day after it.
    """
    row = {"id": SETTINGS_ID, "cadence": cadence, "anchor_payday": anchor.isoformat(), "set_on": today.isoformat()}
    old = _schedule(old)
    if not old:
        return row
    every, old_every = CADENCE_DAYS[cadence], CADENCE_DAYS[old["cadence"]]
    old_anchor = date.fromisoformat(old["anchor_payday"])
    paid_through = old.get("paid_through")
    if old_every == every and (anchor - old_anchor).days % every == 0:
        # Same paydays, so nothing changed: an unpaid payday keeps its card.
        row["set_on"] = old.get("set_on") or row["set_on"]
    else:
        # New paydays. The old schedule's last payday before today paid every hour
        # before it. Only a payday on or after the old schedule's set_on was real;
        # earlier ones are its dates projected backwards.
        last_paid = latest_payday(old_anchor, old_every, today - timedelta(days=1))
        if last_paid.isoformat() >= (old.get("set_on") or ""):
            paid_through = max(paid_through or "", (last_paid - timedelta(days=1)).isoformat())
    if paid_through:
        row["paid_through"] = paid_through
    return row


def payday_period(sched: Dict[str, Any], payday: date) -> Tuple[date, date, bool]:
    """First and last day of the hours `payday` pays, and whether it is a payday
    from before a schedule change, which pays nothing itself (start > end)."""
    every = CADENCE_DAYS[sched["cadence"]]
    start, end = pay_period(payday, every)
    if not sched.get("paid_through") or not sched.get("set_on"):
        return start, end, False
    set_on = date.fromisoformat(sched["set_on"])
    if payday < set_on:
        # The schedule changed after this date, so this payday never happened.
        # Its unpaid hours are on the first payday after the change.
        return end + timedelta(days=1), end, True
    if payday - timedelta(days=every) < set_on:
        # First payday since the change: every hour no earlier payday paid.
        return date.fromisoformat(sched["paid_through"]) + timedelta(days=1), end, False
    return start, end, False


def with_payments(per_user: List[Dict[str, Any]], payments: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], Dict[str, float]]:
    """Each person's pay with what was already paid toward it and what is left.

    A payment's `amount` is the gross pay it settles; `withheld` is the part of
    it kept back for taxes, so the cash handed over is amount − withheld.
    Someone paid who no longer has hours here (a shift was removed after) still
    shows, owed nothing, so the payment is not lost from view. Someone with
    hours but no pay rate is flagged rather than shown as paid."""
    by_user: Dict[str, List[Dict[str, Any]]] = {}
    for p in payments:
        by_user.setdefault(p.get("user_id"), []).append(p)
    rows = [dict(u) for u in per_user]
    seen = {u["user_id"] for u in rows}
    for uid, ps in by_user.items():
        if uid not in seen:
            rows.append({"user_id": uid, "name": ps[0].get("name") or "Staff member", "hours": 0.0, "gross": 0.0,
                         "estimated_take_home": 0.0})
    for u in rows:
        u["payments"] = by_user.get(u["user_id"], [])
        u["paid"] = round(sum(float(p.get("amount") or 0) for p in u["payments"]), 2)
        u["remaining"] = round(float(u.get("gross") or 0) - u["paid"], 2)
        u["no_rate"] = float(u.get("hours") or 0) > 0 and float(u.get("gross") or 0) <= 0.005 and u["paid"] <= 0.005
    paid = round(sum(u["paid"] for u in rows), 2)
    remaining = round(sum(u["remaining"] for u in rows if u["remaining"] > 0.005), 2)
    return rows, {"paid": paid, "remaining": remaining}


def payday_brain_item(summary: Optional[Dict[str, Any]], ts: str) -> Optional[Dict[str, Any]]:
    """The Today feed's payday card, or None when nothing is owed. Paydays from
    before the schedule was saved never nag: those were already paid. Nor does
    anyone already marked paid. Someone who worked with no pay rate is named,
    so they aren't silently left out. `ts` is now, so the card sorts with
    today's other to-dos instead of below them."""
    if not summary or not summary.get("per_user"):
        return None
    payday = date.fromisoformat(summary["payday"])
    if summary["payday"] < (summary["schedule"].get("set_on") or ""):
        return None
    owed = [u for u in summary["per_user"] if u.get("remaining", u["gross"]) > 0.005]
    no_rate = [u for u in summary["per_user"] if u.get("no_rate")]
    if not owed and not no_rate:
        return None
    parts = [f"{u['name']} ${u.get('remaining', u['gross']):,.2f}" for u in owed] + \
            [f"{u['name']}: no pay rate set" for u in no_rate]
    names = " · ".join(parts[:4])
    if len(parts) > 4:
        names += f" · +{len(parts) - 4} more"
    start, end = date.fromisoformat(summary["period_start"]), date.fromisoformat(summary["period_end"])
    subtitle = f"{names} · hours {_short(start)} – {_short(end)}"
    if summary["open_shifts"]:
        n = summary["open_shifts"]
        subtitle += f" · {n} shift{'s' if n != 1 else ''} still clocked in"
    when = "today" if summary["is_today"] else f"was {_short(payday)}"
    if owed:
        count = len(owed)
        title = (f"Payday {when} — you owe ${summary['totals'].get('remaining', summary['totals']['gross']):,.2f} "
                 f"to {count} staff member{'s' if count != 1 else ''}")
    else:
        count = len(no_rate)
        title = f"Payday {when} — {count} staff member{'s' if count != 1 else ''} worked with no pay rate set"
    return {
        "id": f"payday-due:{summary['payday']}",
        "kind": "payday_due",
        "priority": "urgent" if summary["is_today"] else "warn",
        "title": title,
        "subtitle": subtitle,
        "ts": ts,
        "cta": {"type": "open_screen", "screen": "staff", "tab": "payroll"},
        "icon": "fa-money-check-dollar",
    }


def make_payday_domain(*, api, db, business_today, get_owner_user_ids, payroll_estimate,
                       require_admin_and_permission, now_iso, TillAdjustmentIn, add_till_adjustment,
                       delete_till_adjustment):
    finance = require_admin_and_permission("finance_reports")
    deleter = require_admin_and_permission("delete_records")   # undoing a payment removes records, as for bills

    class PayScheduleIn(BaseModel):
        cadence: Literal["weekly", "biweekly"]
        anchor_payday: date

    class PaydayPaymentIn(BaseModel):
        user_id: str = Field(min_length=1)
        amount: float = Field(gt=0, le=100000)        # the gross pay this settles
        withheld: float = Field(default=0, ge=0, le=100000)   # kept back for taxes; the rest is handed over
        payment_method: PayMethod = "cash"
        paid_on: Optional[date] = None
        from_cash_drawer: bool = False   # the cash handed over came out of the register drawer
        notes: str = Field(default="", max_length=500)
        request_id: str = Field(min_length=8, max_length=80)   # one per Mark paid: a resend is recorded once

    async def payday_summary(user: dict, payday: Optional[date] = None) -> Optional[Dict[str, Any]]:
        """Who is owed what for a payday (the latest one unless given); None until
        a schedule is saved. A given payday must be one of the schedule's, on or
        before today and not before the schedule was set."""
        sched = _schedule(await db.settings.find_one({"id": SETTINGS_ID}, {"_id": 0}))
        if not sched:
            return None
        every = CADENCE_DAYS[sched["cadence"]]
        today = business_today()
        anchor = date.fromisoformat(sched["anchor_payday"])
        latest = latest_payday(anchor, every, today)
        set_on = sched.get("set_on") or ""
        if payday is None:
            payday = latest
        elif (payday - anchor).days % every or payday > today or payday.isoformat() < set_on:
            raise HTTPException(status_code=422, detail="That isn't one of your paydays.")
        start, end, before_change = payday_period(sched, payday)
        if before_change:
            per_user, open_shifts, payments = [], 0, []
            totals = {"gross": 0.0, "employer_burden": 0.0, "total_cost": 0.0,
                      "employee_withholdings": 0.0, "estimated_take_home": 0.0}
        else:
            estimate = await payroll_estimate(start.isoformat(), end.isoformat(), user)
            per_user, totals = estimate["per_user"], dict(estimate["totals"])
            # A shift still clocked in has no hours yet, so it isn't in the amounts above.
            open_filter: Dict[str, Any] = {
                "clock_in_at": {"$gte": f"{start.isoformat()}T00:00:00", "$lte": f"{end.isoformat()}T23:59:59.999Z"},
                "clock_out_at": {"$in": [None, ""]},
            }
            owner_ids = await get_owner_user_ids()
            if owner_ids:
                open_filter["user_id"] = {"$nin": list(owner_ids)}
            open_shifts = await db.time_clock_entries.count_documents(open_filter)
            # Payments are matched to the hours they paid, not the payday's date: after a schedule
            # change, what was paid on the old schedule's payday still counts against the same hours.
            payments = await db.payroll_payments.find(
                {"period_start": {"$lte": end.isoformat()}, "period_end": {"$gte": start.isoformat()}},
                {"_id": 0}).sort("created_at", 1).to_list(None)
        per_user, paid = with_payments(per_user, payments)
        statuses = {u["id"]: u.get("tax_status") or "1099" for u in await db.users.find(
            {"id": {"$in": [u["user_id"] for u in per_user]}}, {"_id": 0, "id": 1, "tax_status": 1}).to_list(None)}
        for u in per_user:
            u["tax_status"] = statuses.get(u["user_id"], "1099")
        earlier = payday - timedelta(days=every)
        return {
            "schedule": sched,
            "today": today.isoformat(),
            "payday": payday.isoformat(),
            "is_today": payday == today,
            "is_latest": payday == latest,
            "previous_payday": earlier.isoformat() if earlier.isoformat() >= set_on else None,
            "next_payday": (payday + timedelta(days=every)).isoformat(),
            "period_start": start.isoformat(),
            "period_end": end.isoformat(),
            "before_schedule_change": before_change,
            "per_user": per_user,
            "totals": {**totals, **paid},
            "open_shifts": open_shifts,
        }

    @api.get("/admin/payroll/payday")
    async def admin_payroll_payday(payday: Optional[date] = None, user: dict = Depends(finance)):
        summary = await payday_summary(user, payday)
        return {"configured": summary is not None, **(summary or {})}

    @api.put("/admin/payroll/schedule")
    async def admin_payroll_schedule(body: PayScheduleIn, user: dict = Depends(finance)):
        old = await db.settings.find_one({"id": SETTINGS_ID}, {"_id": 0})
        row = saved_schedule(old, body.cadence, body.anchor_payday, business_today())
        await db.settings.replace_one({"id": SETTINGS_ID}, row, upsert=True)
        return await admin_payroll_payday(None, user)

    def _drawer_marker(request_id: str) -> str:
        return f"payroll_request:{request_id}"

    async def _take_from_drawer(payment: Dict[str, Any], user: dict) -> Dict[str, Any]:
        """The till removal for a payment handed over from the drawer. Found by its
        marker first, so a retry after a crash never takes the cash out twice. A
        refusal (that register day is closed out) removes the payment again."""
        marker = _drawer_marker(payment["request_id"])
        adj = await db.till_adjustments.find_one({"notes": marker}, {"_id": 0, "id": 1})
        if not adj:
            try:
                res = await add_till_adjustment(TillAdjustmentIn(
                    date=payment["paid_on"], direction="remove", amount=payment["handed_over"], adjustment_type="other",
                    reason=f"Payroll: paid {payment['name']} for payday {payment['payday']}", notes=marker), user)
            except Exception:
                await deletion_log.delete_one(db, "payroll_payments", {"id": payment["id"]})
                raise
            adj = res["adjustment"]
        await db.payroll_payments.update_one({"id": payment["id"]}, {"$set": {"till_adjustment_id": adj["id"]}})
        return {**payment, "till_adjustment_id": adj["id"]}

    @api.post("/admin/payroll/payday/{payday}/payments")
    async def admin_payroll_mark_paid(payday: date, body: PaydayPaymentIn, user: dict = Depends(finance)):
        """Mark a staff member paid (all or part of what they are owed) on a payday."""
        replay = await db.payroll_payments.find_one({"request_id": body.request_id}, {"_id": 0})
        if replay:
            if replay.get("from_cash_drawer") and not replay.get("till_adjustment_id"):
                replay = await _take_from_drawer(replay, user)
            return {"payment": replay, **await admin_payroll_payday(date.fromisoformat(replay["payday"]), user)}
        summary = await payday_summary(user, payday)
        if not summary:
            raise HTTPException(status_code=409, detail="Set a pay schedule first.")
        person = next((u for u in summary["per_user"] if u["user_id"] == body.user_id), None)
        if not person:
            raise HTTPException(status_code=404, detail="That staff member isn't owed pay on this payday.")
        today = business_today()
        paid_on = body.paid_on or today
        if paid_on > today:
            raise HTTPException(status_code=422, detail="The date paid can't be in the future.")
        amount, withheld = round(float(body.amount), 2), round(float(body.withheld), 2)
        if withheld >= amount:
            raise HTTPException(status_code=422, detail="Withheld for taxes must be less than the pay.")
        drawer = body.from_cash_drawer and body.payment_method == "cash"
        doc = {
            "id": str(uuid.uuid4()), "request_id": body.request_id, "payday": payday.isoformat(),
            "period_start": summary["period_start"], "period_end": summary["period_end"],
            "user_id": body.user_id, "name": person["name"], "amount": amount, "withheld": withheld,
            "handed_over": round(amount - withheld, 2), "owed_when_paid": person.get("remaining", person["gross"]),
            "payment_method": body.payment_method, "paid_on": paid_on.isoformat(),
            "from_cash_drawer": drawer, "till_adjustment_id": None,
            "notes": body.notes.strip(), "created_at": now_iso(),
            "created_by": user.get("id"), "created_by_name": user.get("name") or user.get("email") or "admin",
        }
        try:
            # The payment first: a resend finds it, so the drawer is never touched twice.
            await db.payroll_payments.insert_one(dict(doc))
        except DuplicateKeyError:
            doc = await db.payroll_payments.find_one({"request_id": body.request_id}, {"_id": 0})
            return {"payment": doc, **await admin_payroll_payday(payday, user)}
        if drawer:
            doc = await _take_from_drawer(doc, user)
        return {"payment": doc, **await admin_payroll_payday(payday, user)}

    @api.delete("/admin/payroll/payments/{payment_id}")
    async def admin_payroll_undo_payment(payment_id: str, user: dict = Depends(deleter)):
        """Undo a Mark paid, and the drawer entry it made."""
        payment = await db.payroll_payments.find_one({"id": payment_id}, {"_id": 0})
        if not payment:
            raise HTTPException(status_code=404, detail="That payment was already undone.")
        adj_id = payment.get("till_adjustment_id")
        if not adj_id and payment.get("from_cash_drawer"):
            adj_id = ((await db.till_adjustments.find_one({"notes": _drawer_marker(payment["request_id"])}, {"_id": 0, "id": 1}))
                      or {}).get("id")
        if adj_id:
            try:
                await delete_till_adjustment(adj_id, user)
            except HTTPException as e:
                if e.status_code != 404:   # already gone is fine; a closed register day is not
                    raise
        await deletion_log.delete_one(db, "payroll_payments", {"id": payment_id})
        return await admin_payroll_payday(date.fromisoformat(payment["payday"]), user)

    return {
        "PayScheduleIn": PayScheduleIn,
        "PaydayPaymentIn": PaydayPaymentIn,
        "admin_payroll_mark_paid": admin_payroll_mark_paid,
        "admin_payroll_undo_payment": admin_payroll_undo_payment,
        "payday_summary": payday_summary,
        "admin_payroll_payday": admin_payroll_payday,
        "admin_payroll_schedule": admin_payroll_schedule,
    }
