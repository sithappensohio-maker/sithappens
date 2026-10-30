"""Recurring bills: what's due when, and marking one paid logs it as an expense.

A bill (collection `bills`) has a usual amount, how often it repeats and its
next due date. Marking it paid logs an expense through the normal expense
path (same validation and register-day lock as any expense), tagged with the
bill and the due date it paid, and moves the bill to its next due date. The
newest payment can be undone: the expense is deleted and the due date goes
back. The Today feed lists bills overdue or due within DUE_SOON_DAYS.
"""
import calendar
import hashlib
import uuid
from datetime import date, timedelta
from typing import Any, Dict, List, Literal, Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field

from domains.backup import deletion_log

DUE_SOON_DAYS = 3
FREQUENCY_MONTHS = {"monthly": 1, "quarterly": 3, "yearly": 12}
Frequency = Literal["weekly", "monthly", "quarterly", "yearly"]
Method = Literal["card", "transfer", "check", "cash", "venmo", "paypal", "other"]


def next_due_after(due: date, frequency: str, due_day: int) -> date:
    """The due date after `due`. Monthly-style bills keep their day of the
    month (`due_day`), using the month's last day when it is shorter, so a
    bill due on the 31st is due Feb 28 and then Mar 31 again."""
    if frequency == "weekly":
        return due + timedelta(days=7)
    m = due.month - 1 + FREQUENCY_MONTHS[frequency]
    year, month = due.year + m // 12, m % 12 + 1
    return date(year, month, min(due_day, calendar.monthrange(year, month)[1]))


def _short(d: date) -> str:
    return f"{d:%a %b} {d.day}"


def bills_brain_item(bills: List[Dict[str, Any]], ts: str) -> Optional[Dict[str, Any]]:
    """The Today feed's card for bills overdue or due within DUE_SOON_DAYS, or None."""
    due = sorted((b for b in bills if b["days_until_due"] <= DUE_SOON_DAYS), key=lambda b: b["next_due"])
    if not due:
        return None
    parts = []
    for b in due[:4]:
        d, when = b["days_until_due"], date.fromisoformat(b["next_due"])
        status = f"overdue since {_short(when)}" if d < 0 else "due today" if d == 0 else f"due {_short(when)}"
        parts.append(f"{b['name']} ${b['amount']:,.2f} {status}")
    if len(due) > 4:
        parts.append(f"+{len(due) - 4} more")
    late = sum(1 for b in due if b["days_until_due"] < 0)
    soon = len(due) - late
    counts = []   # "2 bills due soon", "1 bill overdue", "1 bill overdue, 2 due soon"
    if late:
        counts.append(f"{late} bill{'s' if late != 1 else ''} overdue")
    if soon:
        counts.append(f"{soon} due soon" if late else f"{soon} bill{'s' if soon != 1 else ''} due soon")
    total = sum(b["amount"] for b in due)
    # The id changes when the set of due bills changes, so a hidden card comes back for a new bill.
    key = "|".join(f"{b['id']}:{b['next_due']}" for b in due)
    return {
        "id": f"bills-due:{hashlib.sha1(key.encode()).hexdigest()[:12]}",
        "kind": "bill_due",
        "priority": "urgent" if any(b["days_until_due"] <= 0 for b in due) else "warn",
        "title": f"{', '.join(counts)} — ${total:,.2f}",
        "subtitle": " · ".join(parts),
        "ts": ts,
        "cta": {"type": "open_screen", "screen": "income", "tab": "bills"},
        "icon": "fa-file-invoice-dollar",
    }


def make_bills_domain(*, api, db, business_today, now_iso, require_admin_and_permission,
                      ExpenseIn, create_expense, delete_expense):
    finance = require_admin_and_permission("finance_reports")
    deleter = require_admin_and_permission("delete_records")

    class BillIn(BaseModel):
        name: str = Field(min_length=1, max_length=120)
        payee: Optional[str] = Field(default="", max_length=120)
        amount: float = Field(ge=0)
        category: Optional[str] = Field(default="", max_length=80)
        payment_method: Method = "card"
        frequency: Frequency = "monthly"
        next_due: date
        notes: Optional[str] = Field(default="", max_length=500)
        # Edits only: the due date the form opened with. If a payment or an undo moved the
        # bill since, the save is refused rather than writing the old date back.
        expected_next_due: Optional[date] = None

    class BillPayIn(BaseModel):
        due_date: date            # the due date being paid; must still be the bill's next one
        amount: float = Field(ge=0)
        paid_date: date
        payment_method: Optional[Method] = None
        notes: Optional[str] = Field(default="", max_length=500)
        from_cash_drawer: bool = False   # cash taken out of the register drawer (lowers its expected cash)

    class BillUndoIn(BaseModel):
        expense_id: str = Field(min_length=1)   # the payment the screen offered to undo

    async def _bill(bill_id: str) -> dict:
        bill = await db.bills.find_one({"id": bill_id}, {"_id": 0})
        if not bill:
            raise HTTPException(status_code=404, detail="Bill not found")
        return bill

    def _status(bill: dict, today: date) -> dict:
        days = (date.fromisoformat(bill["next_due"]) - today).days
        status = "overdue" if days < 0 else "due_today" if days == 0 else "due_soon" if days <= DUE_SOON_DAYS else "upcoming"
        return {**bill, "days_until_due": days, "status": status}

    async def bills_view() -> List[dict]:
        """Every bill with how many days until it's due, soonest first."""
        today = business_today()
        rows = await db.bills.find({}, {"_id": 0}).sort("next_due", 1).to_list(500)
        return [_status(b, today) for b in rows]

    async def _last_payment(bill_id: str) -> Optional[dict]:
        """The payment logged most recently (not the latest due date: an edited bill can be paid out of order)."""
        return await db.expenses.find_one(
            {"bill_id": bill_id}, {"_id": 0, "receipt_image": 0}, sort=[("created_at", -1)])

    def _due_within(bill: dict, today: date, days: int) -> float:
        """What a bill comes to on its due dates from today through `days` ahead: a weekly
        bill counts every week. Its overdue date counts with the overdue ones instead, but
        its later due dates inside the window still count."""
        d, end, total = date.fromisoformat(bill["next_due"]), today + timedelta(days=days), 0.0
        due_day = bill.get("due_day") or d.day
        while d < today:
            d = next_due_after(d, bill["frequency"], due_day)
        while d <= end:
            total += float(bill["amount"])
            d = next_due_after(d, bill["frequency"], due_day)
        return total

    def _undoable(bill: dict, last: Optional[dict]) -> bool:
        """Only the newest payment can be undone, and only while the bill still
        sits on the due date that payment moved it to."""
        if not last or not last.get("bill_due_date"):
            return False
        paid_due = date.fromisoformat(last["bill_due_date"])
        return bill["next_due"] == next_due_after(paid_due, bill["frequency"], bill.get("due_day") or paid_due.day).isoformat()

    async def _with_payments(bills: List[dict]) -> List[dict]:
        out = []
        for b in bills:
            last = await _last_payment(b["id"])
            out.append({**b, "last_payment": last and {k: last.get(k) for k in ("id", "date", "amount", "bill_due_date")},
                        "can_undo": _undoable(b, last)})
        return out

    def _fields(body: BillIn) -> dict:
        return {
            "name": body.name.strip(), "payee": (body.payee or "").strip(), "amount": round(float(body.amount), 2),
            "category": (body.category or "").strip(), "payment_method": body.payment_method,
            "frequency": body.frequency, "next_due": body.next_due.isoformat(), "due_day": body.next_due.day,
            "notes": (body.notes or "").strip(), "updated_at": now_iso(),
        }

    @api.get("/admin/bills")
    async def admin_list_bills(_: dict = Depends(finance)):
        bills, today = await bills_view(), business_today()
        return {"bills": await _with_payments(bills), "due_soon_days": DUE_SOON_DAYS,
                "due_next_30": round(sum(_due_within(b, today, 30) for b in bills), 2)}

    @api.post("/admin/bills")
    async def admin_create_bill(body: BillIn, user: dict = Depends(finance)):
        doc = {"id": str(uuid.uuid4()), **_fields(body), "created_at": now_iso(), "created_by": user.get("id")}
        await db.bills.insert_one(dict(doc))
        return _status(doc, business_today())

    @api.put("/admin/bills/{bill_id}")
    async def admin_update_bill(bill_id: str, body: BillIn, _: dict = Depends(finance)):
        bill = await _bill(bill_id)
        fields = _fields(body)
        nd, kept = body.next_due, bill.get("due_day")
        # A weekly bill's due_day is never kept up to date, so only a monthly-style one keeps it.
        if kept and bill.get("frequency") != "weekly" and nd.day == min(kept, calendar.monthrange(nd.year, nd.month)[1]):
            # The same day of the month, shortened for this month: a bill due the 31st that
            # is showing Nov 30 stays a 31st bill when only its amount is edited.
            fields["due_day"] = kept
        expected = body.expected_next_due.isoformat() if body.expected_next_due else bill["next_due"]
        saved = await db.bills.update_one({"id": bill_id, "next_due": expected}, {"$set": fields})
        if saved.matched_count != 1:
            raise HTTPException(status_code=409, detail=(
                f"{bill['name']} was just marked paid, or a payment was undone, so its due date changed. "
                "Close the form and edit it again."))
        return _status(await _bill(bill_id), business_today())

    @api.delete("/admin/bills/{bill_id}")
    async def admin_delete_bill(bill_id: str, _: dict = Depends(deleter)):
        """The bill goes; the expenses already logged for it stay in the expense list."""
        await _bill(bill_id)
        await deletion_log.delete_one(db, "bills", {"id": bill_id})
        return {"ok": True}

    @api.post("/admin/bills/{bill_id}/pay")
    async def admin_pay_bill(bill_id: str, body: BillPayIn, user: dict = Depends(finance)):
        bill = await _bill(bill_id)
        due = body.due_date.isoformat()
        stale = HTTPException(status_code=409, detail=(
            f"{bill['name']} is no longer due {due}: it was already marked paid or its due date changed. "
            "Refresh to see its next due date."))
        if bill["next_due"] != due:
            raise stale
        following = next_due_after(body.due_date, bill["frequency"], bill.get("due_day") or body.due_date.day).isoformat()
        # Move the bill on first, only if nobody else just did: a second click can never log it twice.
        moved = await db.bills.update_one({"id": bill_id, "next_due": due},
                                          {"$set": {"next_due": following, "updated_at": now_iso()}})
        if moved.modified_count != 1:
            raise stale
        notes = f"Bill due {due}" + (f" — {body.notes.strip()}" if (body.notes or "").strip() else "")
        method = body.payment_method or bill.get("payment_method") or "card"
        expense = None
        try:
            expense = await create_expense(ExpenseIn(
                date=body.paid_date.isoformat(), description=bill["name"], amount=body.amount,
                category=bill.get("category") or "", notes=notes, payment_method=method,
                tax_deductible=True, from_cash_drawer=bool(body.from_cash_drawer) and method == "cash",
                vendor=bill.get("payee") or "", recurring=True, recurring_interval=bill["frequency"],
            ), user)
            link = {"bill_id": bill_id, "bill_due_date": due}
            await db.expenses.update_one({"id": expense["id"]}, {"$set": link})
        except Exception:
            if expense is not None:
                # Logged but not linked to the bill: take it out before the due date reopens, or
                # paying again would log this due date twice. If this fails too, the bill stays
                # moved on, since its due date does have an expense.
                await deletion_log.delete_one(db, "expenses", {"id": expense["id"]})
            # No expense is logged (a closed register day, say), so the bill is still due.
            await db.bills.update_one({"id": bill_id, "next_due": following}, {"$set": {"next_due": due}})
            raise
        return {"bill": _status(await _bill(bill_id), business_today()), "expense": {**expense, **link}}

    @api.post("/admin/bills/{bill_id}/undo-payment")
    async def admin_undo_bill_payment(bill_id: str, body: BillUndoIn, user: dict = Depends(deleter)):
        bill = await _bill(bill_id)
        last = await _last_payment(bill_id)
        if not last:
            raise HTTPException(status_code=404, detail=f"{bill['name']} has no payment to undo.")
        if last["id"] != body.expense_id:
            # A stale screen or a retried request: the payment it meant is gone, and the one now
            # newest is an older, real payment that must not be deleted in its place.
            raise HTTPException(status_code=409, detail=(
                f"That {bill['name']} payment was already undone, or a newer one was logged. "
                "Refresh to see the bill."))
        if not _undoable(bill, last):
            raise HTTPException(status_code=409, detail=(
                f"{bill['name']}'s due date was changed after that payment. Delete the expense "
                "from the expense list and set the due date by editing the bill."))
        due = last["bill_due_date"]
        moved = await db.bills.update_one({"id": bill_id, "next_due": bill["next_due"]},
                                          {"$set": {"next_due": due, "updated_at": now_iso()}})
        if moved.modified_count != 1:
            raise HTTPException(status_code=409, detail="That bill just changed. Refresh and try again.")
        try:
            await delete_expense(last["id"], user)   # same register-day lock and deletion log as any expense
        except Exception:
            await db.bills.update_one({"id": bill_id, "next_due": due}, {"$set": {"next_due": bill["next_due"]}})
            raise
        return {"bill": _status(await _bill(bill_id), business_today()), "removed_expense_id": last["id"]}

    return {
        "BillIn": BillIn, "BillPayIn": BillPayIn, "BillUndoIn": BillUndoIn, "bills_view": bills_view,
        "admin_list_bills": admin_list_bills, "admin_create_bill": admin_create_bill,
        "admin_update_bill": admin_update_bill, "admin_delete_bill": admin_delete_bill,
        "admin_pay_bill": admin_pay_bill, "admin_undo_bill_payment": admin_undo_bill_payment,
    }
