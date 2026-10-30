"""Pay schedule and payday: what each staff member is owed on payday.

The schedule is one settings row (id "payroll_schedule"): how often staff are
paid and one real payday to count from. Paydays repeat every 7 or 14 days from
that date in both directions, so a past payday and an upcoming one both work.
A payday pays every shift since the previous payday, up to the day before it.

The amounts are the Payroll Tax estimate for that period (each shift at the
rate it was worked at, owner excluded as a draw), so a payday never disagrees
with the Payroll Tax tab or the payroll CSV for the same dates.
"""
from datetime import date, timedelta
from typing import Any, Dict, Literal, Optional, Tuple

from fastapi import Depends
from pydantic import BaseModel

SETTINGS_ID = "payroll_schedule"
CADENCE_DAYS = {"weekly": 7, "biweekly": 14}


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


def payday_brain_item(summary: Optional[Dict[str, Any]], ts: str) -> Optional[Dict[str, Any]]:
    """The Today feed's payday card, or None when nothing is owed. Paydays from
    before the schedule was saved never nag: those were already paid. `ts` is
    now, so the card sorts with today's other to-dos instead of below them."""
    if not summary or not summary.get("per_user"):
        return None
    payday = date.fromisoformat(summary["payday"])
    if summary["payday"] < (summary["schedule"].get("set_on") or ""):
        return None
    staff = summary["per_user"]
    names = " · ".join(f"{u['name']} ${u['gross']:,.2f}" for u in staff[:4])
    if len(staff) > 4:
        names += f" · +{len(staff) - 4} more"
    start, end = date.fromisoformat(summary["period_start"]), date.fromisoformat(summary["period_end"])
    subtitle = f"{names} · hours {_short(start)} – {_short(end)}"
    if summary["open_shifts"]:
        n = summary["open_shifts"]
        subtitle += f" · {n} shift{'s' if n != 1 else ''} still clocked in"
    when = "today" if summary["is_today"] else f"was {_short(payday)}"
    count = len(staff)
    return {
        "id": f"payday-due:{summary['payday']}",
        "kind": "payday_due",
        "priority": "urgent" if summary["is_today"] else "warn",
        "title": f"Payday {when} — you owe ${summary['totals']['gross']:,.2f} to {count} staff member{'s' if count != 1 else ''}",
        "subtitle": subtitle,
        "ts": ts,
        "cta": {"type": "open_screen", "screen": "staff", "tab": "payroll"},
        "icon": "fa-money-check-dollar",
    }


def make_payday_domain(*, api, db, business_today, get_owner_user_ids, payroll_estimate,
                       require_admin_and_permission):
    finance = require_admin_and_permission("finance_reports")

    class PayScheduleIn(BaseModel):
        cadence: Literal["weekly", "biweekly"]
        anchor_payday: date

    async def payday_summary(user: dict) -> Optional[Dict[str, Any]]:
        """Who is owed what for the latest payday; None until a schedule is saved."""
        sched = _schedule(await db.settings.find_one({"id": SETTINGS_ID}, {"_id": 0}))
        if not sched:
            return None
        every = CADENCE_DAYS[sched["cadence"]]
        today = business_today()
        payday = latest_payday(date.fromisoformat(sched["anchor_payday"]), every, today)
        start, end, before_change = payday_period(sched, payday)
        if before_change:
            per_user, open_shifts = [], 0
            totals = {"gross": 0.0, "employer_burden": 0.0, "total_cost": 0.0,
                      "employee_withholdings": 0.0, "estimated_take_home": 0.0}
        else:
            estimate = await payroll_estimate(start.isoformat(), end.isoformat(), user)
            per_user, totals = estimate["per_user"], estimate["totals"]
            # A shift still clocked in has no hours yet, so it isn't in the amounts above.
            open_filter: Dict[str, Any] = {
                "clock_in_at": {"$gte": f"{start.isoformat()}T00:00:00", "$lte": f"{end.isoformat()}T23:59:59.999Z"},
                "clock_out_at": {"$in": [None, ""]},
            }
            owner_ids = await get_owner_user_ids()
            if owner_ids:
                open_filter["user_id"] = {"$nin": list(owner_ids)}
            open_shifts = await db.time_clock_entries.count_documents(open_filter)
        return {
            "schedule": sched,
            "today": today.isoformat(),
            "payday": payday.isoformat(),
            "is_today": payday == today,
            "next_payday": (payday + timedelta(days=every)).isoformat(),
            "period_start": start.isoformat(),
            "period_end": end.isoformat(),
            "before_schedule_change": before_change,
            "per_user": per_user,
            "totals": totals,
            "open_shifts": open_shifts,
        }

    @api.get("/admin/payroll/payday")
    async def admin_payroll_payday(user: dict = Depends(finance)):
        summary = await payday_summary(user)
        return {"configured": summary is not None, **(summary or {})}

    @api.put("/admin/payroll/schedule")
    async def admin_payroll_schedule(body: PayScheduleIn, user: dict = Depends(finance)):
        old = await db.settings.find_one({"id": SETTINGS_ID}, {"_id": 0})
        row = saved_schedule(old, body.cadence, body.anchor_payday, business_today())
        await db.settings.replace_one({"id": SETTINGS_ID}, row, upsert=True)
        return await admin_payroll_payday(user)

    return {
        "PayScheduleIn": PayScheduleIn,
        "payday_summary": payday_summary,
        "admin_payroll_payday": admin_payroll_payday,
        "admin_payroll_schedule": admin_payroll_schedule,
    }
