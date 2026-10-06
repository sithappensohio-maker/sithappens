"""A bill and the client's account tab tell the same story (audit #7).

Two records say what a client owes. The bill (db.invoices) is what the
portal shows and what payments are taken against. The tab (payment_ledger
rows + clients.account_balance) holds debt left at checkout "on the tab".
A bill whose visit went on the tab is only safe to collect while the two
agree (invoice_ar_status); otherwise a dollar could be collected twice.

They drifted apart three ways, each leaving a bill nobody could pay:
- correcting a visit after checkout (added charge, discount, write-off)
  moved the tab but never the bill — and moved the tab even for visits that
  were never on it (phantom credit / double debt);
- a pack, program or retail sale on partial pay, and a write-off from the
  Accounts Receivable screen, wrote account entries that made every earlier
  open bill "ambiguous" for good;
- the portal still offered online payment for such a bill, so Stripe took
  the money and it could never be applied (see resolve.py).

Rules kept here:
- A visit is "on the tab" only when its CHECKOUT put it there (a checkout
  charge row). Rows written by corrections never count.
- A correction on an open, single-visit bill changes the bill in the same
  atomic step that refuses while an online payment holds it, capped by the
  bill's live balance (the visit's own balance_due goes stale when the bill
  is paid). The tab moves only when the visit is on the tab.
- An added charge on a bill already paid goes on the tab (as before); a
  discount or write-off there is refused — that's a refund.
- Sale rows are tagged and never count against a bill (an overpayment's
  excess stays untagged, since it may have been meant for a bill). An
  Accounts Receivable write-off names the bill it forgives, or comes out of
  the part of the balance that isn't on any bill.

server.py is at its line ceiling, so this module reads the server helpers
it needs live (same pattern as domains.clients.signup_claim).
"""
from __future__ import annotations
from domains.backup import deletion_log

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import HTTPException
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from domains.bookings import friends_family

_server_globals: Optional[dict] = None

REFUND_STATUSES = ("REFUNDED", "PARTIALLY_REFUNDED")
ENDED_STATUSES = ("cancelled", "rejected", "no_show")
CORRECTION_SOURCE = "correction"
CORRECTION_NOTE_PREFIX = "Post-checkout"
SALE_PAYMENT_PREFIX = "Paid at sale · "

MSG_REFUND = ("This bill has a refund on it, so it can't be changed here. "
              "Record a new sale or another refund instead.")
MSG_ONLINE = ("The customer is paying this bill online right now. Wait for that to finish, "
              "or resolve it under Front Desk → Online payments.")
MSG_CHANGED = "This bill just changed. Close this and try again."
MSG_PAID = "Nothing is owed on this bill. Use Refund when money has already been collected."
MSG_GROUP = ("This visit was billed together with other dogs and that bill is still open, "
             "so it can't be changed here. Take payment on the bill first.")
MSG_NEEDS_FIX = "This bill needs fixing first. Open the client's Bills and press Needs fixing."
MSG_RECEIPT_WAITING = ("A visit on this bill was reopened, so the bill still shows the old checkout. "
                       "Its receipt is ready once every visit on it is checked out again.")
MSG_REBUILDING = ("This bill still shows a checkout that was reopened and done again. It is brought up "
                  "to date automatically within a minute or two — try again then.")
MSG_ACCOUNT_NEEDS_FIX = ("One of this client's bills needs fixing first (client → Bills → Needs fixing); "
                         "until then the account can't say how much is really general balance or credit.")


def configure(*, server_globals: dict) -> None:
    global _server_globals
    _server_globals = server_globals


def _g(name: str):
    return _server_globals[name]


def _now() -> str:
    return _g("now_iso")()


def _money(v: Any) -> float:
    try:
        return round(float(v or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def has_refund_activity(invoice: dict) -> bool:
    return _money(invoice.get("refunded_total")) > 0.005 or (invoice.get("status") or "").upper() in REFUND_STATUSES


def is_checkout_charge(row: dict) -> bool:
    """A charge a checkout wrote — the proof a visit's debt went on the tab."""
    return (row.get("type") == "charge" and row.get("source") != CORRECTION_SOURCE
            and not str(row.get("notes") or "").startswith(CORRECTION_NOTE_PREFIX))


async def _reopened_at(booking_id: str) -> str:
    db = _g("db")
    b = (await db.bookings.find_one({"id": booking_id}, {"_id": 0, "financial_reopened_at": 1})
         or await db.bookings_archive.find_one({"id": booking_id}, {"_id": 0, "financial_reopened_at": 1}) or {})
    return b.get("financial_reopened_at") or ""


async def booking_on_tab(booking_id: str) -> bool:
    """Its CURRENT checkout put it on the tab — a charge from before its
    latest reopen was undone by that reopen (audit #14)."""
    rows = await _g("db").payment_ledger.find(
        {"booking_id": booking_id, "type": "charge"},
        {"_id": 0, "type": 1, "source": 1, "notes": 1, "created_at": 1}).to_list(50)
    cut = await _reopened_at(booking_id)
    return any(is_checkout_charge(r) and (r.get("created_at") or "") > cut for r in rows)


async def bill_level_writeoffs(invoice: dict) -> List[dict]:
    """Write-offs made against the bill itself (Accounts Receivable, or an
    earlier write-off Fix bill linked to it), for a bill rebuilt after a
    reopen (audit #14). Read from the tab, where they live — not from the
    bill's old lines — so one left off a rebuild comes back on the next.
    Lines the bill already had keep their wording."""
    rows = await _g("db").payment_ledger.find(
        {"invoice_id": invoice.get("id"), "booking_id": None, "type": {"$ne": "payment"}},
        {"_id": 0}).sort("created_at", 1).to_list(200)
    known: Dict[str, dict] = {}
    for li in invoice.get("line_items") or []:
        src = li.get("source") or {}
        if not li.get("booking_id") and src.get("kind") in ("tab_writeoff", "attribute"):
            known[src.get("ledger_row_id") or src.get("op_id") or ""] = li
    out: List[dict] = []
    for r in rows:
        amt = round(_money(r.get("amount")), 2)
        if amt >= -0.005:
            continue
        line = known.get(r.get("id")) or known.get(r.get("writeoff_op_id") or "-")
        if line is None:
            linked = bool(r.get("attributed_at"))
            line = {"kind": "adjustment", "booking_id": None, "service_id": None, "qty": 1,
                    "description": (f"Earlier write-off on the account ({str(r.get('created_at') or '')[:10]}) applied to this bill"
                                    if linked else f"Write-off · {r.get('notes') or ''}"),
                    "source": {"kind": "attribute" if linked else "tab_writeoff",
                               "op_id": r.get("writeoff_op_id"), "ledger_row_id": r.get("id")}}
        out.append({**line, "unit_price": amt, "amount": amt})
    return out


async def _is_sale_payment(row: dict) -> bool:
    """A sale's own payment can't have paid a bill. Tagged rows say so; an
    older row is recognised by its note plus the sale charge written with it
    (only when it didn't pay more than the sale — the excess might have)."""
    if row.get("sale_kind"):
        return True
    notes = str(row.get("notes") or "")
    if not notes.startswith(SALE_PAYMENT_PREFIX):
        return False
    charge = await _g("db").payment_ledger.find_one(
        {"client_id": row.get("client_id"), "type": "charge", "booking_id": None, "invoice_id": None,
         "created_at": row.get("created_at"), "notes": notes[len(SALE_PAYMENT_PREFIX):]},
        {"_id": 0, "amount": 1})
    return bool(charge) and _money(charge.get("amount")) >= -_money(row.get("amount")) - 0.005


async def unexplained_reductions(client_id: str, after: str, limit: int = 50) -> List[dict]:
    """Account entries after `after` that lowered the balance without naming
    a bill — any of them might have paid part of a bill, so while one exists
    that bill can't be collected safely. Charges (they raise what's owed),
    sale payments and entries staff marked as account-only don't count."""
    rows = await _g("db").payment_ledger.find(
        {"client_id": client_id, "booking_id": None, "invoice_id": None,
         "amount": {"$lt": -0.005}, "created_at": {"$gt": after}},
        {"_id": 0}).sort("created_at", 1).to_list(limit)
    out = []
    for r in rows:
        if r.get("scope") == "account" or await _is_sale_payment(r):
            continue
        out.append(r)
    return out


async def invoice_ar_status(invoice: dict) -> dict:
    """Is this bill's tab history in step with the bill?

    ar_backed — the bill's visit went on the tab at checkout.
    reconciled — the tab rows tagged to this bill add up to its balance, and
    no unexplained account reduction since could have paid part of it."""
    db = _g("db")
    rows = await db.payment_ledger.find(
        {"$or": [{"booking_id": {"$in": invoice.get("booking_ids") or []}}, {"invoice_id": invoice.get("id")}]},
        {"_id": 0}).sort("created_at", 1).to_list(1000)
    seen: set = set()
    booking_net = 0.0
    anchor = None
    # A checkout charge from before a visit's latest reopen was undone by it:
    # it still counts in the sum (its reversal does too), but it no longer
    # makes the bill "on the tab" (audit #14) — once the bill was rebuilt
    # after that reopen. A bill still showing the undone checkout stays
    # anchored on it, so it reads as out of step and can't be paid.
    built = invoice.get("rebuilt_at") or invoice.get("created_at") or ""
    reopened: Dict[str, str] = {}
    for bid in invoice.get("booking_ids") or []:
        cut = await _reopened_at(bid)
        reopened[bid] = cut if cut and cut <= built else ""
    for r in rows:
        if r.get("id") in seen:
            continue
        seen.add(r.get("id"))
        booking_net += float(r.get("amount") or 0)
        if anchor is None and is_checkout_charge(r) and (r.get("created_at") or "") > reopened.get(r.get("booking_id"), ""):
            anchor = r.get("created_at")
    booking_net = round(booking_net, 2)
    ar_backed = anchor is not None
    balance_matches = abs(booking_net - float(invoice.get("balance") or 0)) <= 0.005
    unexplained: List[dict] = []
    if ar_backed:
        reviewed = invoice.get("ar_reviewed_through")
        after = max(anchor or "", reviewed or "")
        unexplained = await unexplained_reductions(invoice.get("client_id"), after)
    return {
        "ar_backed": ar_backed,
        "reconciled": ar_backed and balance_matches and not unexplained,
        "booking_net": booking_net,
        "balance_matches": balance_matches,
        "unexplained": unexplained,
        "anchor": anchor,
    }


def ended_off_bill(booking: dict) -> bool:
    """A reopened visit that then ended another way (cancelled before that
    was refused) — never checked out again, so it comes off its bill at the
    rebuild (audit #14)."""
    return booking.get("status") in ENDED_STATUSES and not _g("_booking_is_financially_locked")(booking)


async def _all_visits_locked(invoice: dict, *, ended_ok: bool = False) -> bool:
    """Every visit on the bill is checked out. `ended_ok` (the rebuild only):
    a reopened visit that ended another way counts too — the rebuild takes
    it off the bill. Everywhere else such a bill stays refused until then."""
    db = _g("db")
    locked = _g("_booking_is_financially_locked")
    for bid in invoice.get("booking_ids") or []:
        b = await db.bookings.find_one({"id": bid}, {"_id": 0}) or await db.bookings_archive.find_one({"id": bid}, {"_id": 0})
        if not b or not (locked(b) or (ended_ok and b.get("status") in ENDED_STATUSES)):
            return False
    return True


async def has_ended_visit(invoice: dict) -> bool:
    """The bill still bills a reopened visit that ended another way (older
    data): it takes no payment until the rebuild takes that visit off."""
    db = _g("db")
    for bid in invoice.get("booking_ids") or []:
        b = await db.bookings.find_one({"id": bid}, {"_id": 0}) or await db.bookings_archive.find_one({"id": bid}, {"_id": 0})
        if b and ended_off_bill(b):
            return True
    return False


async def receipt_refusal(invoice: dict) -> Optional[str]:
    """Why this bill's receipt can't be had yet: it still shows a checkout
    that was reopened (audit #14). None when it can."""
    if await any_visit_reopened(invoice):
        return MSG_RECEIPT_WAITING
    if await bill_needs_rebuild(invoice):
        return MSG_REBUILDING
    return None


async def any_visit_reopened(invoice: dict) -> bool:
    """A visit on this bill is reopened right now (its next checkout rebuilds
    the bill). A visit that no longer exists doesn't count."""
    db = _g("db")
    locked = _g("_booking_is_financially_locked")
    for bid in invoice.get("booking_ids") or []:
        b = await db.bookings.find_one({"id": bid}, {"_id": 0}) or await db.bookings_archive.find_one({"id": bid}, {"_id": 0})
        # A visit that ended another way (cancelled before that was refused)
        # is never checked out again — nothing to wait for.
        if b and not locked(b) and b.get("status") not in ENDED_STATUSES:
            return True
    return False


async def bill_needs_rebuild(invoice: dict) -> bool:
    """A visit on this bill was reopened and checked out again since the bill
    was built (audit #14): rebuild it from the visits as they are now.

    Only a bill that never took money (reopening is refused once it has) and
    only once every visit on it is checked out again — a group bill waits
    for its last dog, so no line is ever dropped."""
    if (invoice.get("status") or "").upper() == "VOID":
        return False
    if _money(invoice.get("amount_paid")) > 0.005 or invoice.get("stripe_active_attempt_id") or has_refund_activity(invoice):
        return False
    built = invoice.get("rebuilt_at") or invoice.get("created_at") or ""
    reopened = False
    for bid in invoice.get("booking_ids") or []:
        if (await _reopened_at(bid)) > built:  # an archived visit counts too
            reopened = True
    return reopened and await _all_visits_locked(invoice, ended_ok=True)


REBUILD_USER = {"id": "system", "name": "Automatic bill update"}


async def rebuild_stale_bills(*, limit: int = 50) -> int:
    """Scheduler job: bring up to date any bill still showing a checkout that
    was reopened and done again — one left behind by a checkout whose bill
    step failed, or by a reopen from before audit #14. Cheap: only visits
    ever reopened are looked at. Returns how many bills were rebuilt."""
    db = _g("db")
    visits = []
    for coll in (db.bookings, db.bookings_archive):  # an older cancelled visit may be archived by now
        visits += await coll.find({"financial_reopened_at": {"$gt": ""}},
                                  {"_id": 0, "id": 1, "financial_reopened_at": 1}).to_list(5000)
    if not visits:
        return 0
    when = {v["id"]: v["financial_reopened_at"] for v in visits}
    bills = await db.invoices.find(
        {"booking_ids": {"$in": list(when)}, "status": {"$ne": "VOID"}, "amount_paid": {"$not": {"$gt": 0.005}},
         "stripe_active_attempt_id": None}, {"_id": 0}).to_list(5000)
    done = 0
    for inv in bills:
        built = inv.get("rebuilt_at") or inv.get("created_at") or ""
        if done >= limit or not inv.get("client_id") or not any(
                when.get(bid, "") > built for bid in inv.get("booking_ids") or []):
            continue
        try:
            # The client's money lock: never in the middle of a checkout (its
            # own step rebuilds the bill), a Fix bill or a write-off.
            guard = await acquire_client_guard(inv["client_id"])
        except HTTPException:
            continue  # busy — next tick
        try:
            fresh = await db.invoices.find_one({"id": inv["id"]}, {"_id": 0})
            if fresh and await bill_needs_rebuild(fresh):
                await _g("_create_invoice_for_bookings")(list(fresh.get("booking_ids") or []), user=REBUILD_USER, ts=_now())
                done += 1
        except Exception as exc:  # one bad bill never stops the rest
            _g("logger").warning("reopened-bill rebuild failed for %s: %s", inv.get("id"), exc)
        finally:
            await release_client_guard(guard)
    if done:
        _g("logger").info("Brought %d bill(s) up to date after reopened checkouts", done)
    return done


async def rebuilt_alongside(invoice: Optional[dict], booking_ids: List[str], ts: str) -> List[dict]:
    """Other bills the same checkout rebuilt (dogs from two reopened bills
    checked out together) — each gets its own receipt."""
    if not invoice:
        return []
    return await _g("db").invoices.find(
        {"booking_ids": {"$in": booking_ids}, "id": {"$ne": invoice.get("id")}, "rebuilt_at": ts},
        {"_id": 0}).to_list(20)


async def payable_now(invoice: dict, amount: Optional[float] = None, *, ignore_reservation: bool = False) -> Tuple[bool, str, str]:
    """(ok, code, message) — can this bill take a payment right now?

    The same answer drives the portal's Pay Online button and the check
    before a Stripe session is opened, so the portal never offers to take
    money the app would then refuse to apply."""
    if (invoice.get("status") or "").upper() == "VOID":
        return False, "void", "This bill was cancelled."
    balance = _money(invoice.get("balance"))
    if balance <= 0.005:
        return False, "paid", "Nothing is owed on this bill."
    if has_refund_activity(invoice):
        return False, "refund", "Please contact us to pay this bill."
    if invoice.get("stripe_active_attempt_id") and not ignore_reservation:
        return False, "online_in_progress", "An online payment for this bill is already under way."
    if not await _all_visits_locked(invoice):
        return False, "reopened", "Please contact us to pay this bill."
    if await bill_needs_rebuild(invoice):
        return False, "needs_review", "We're updating this bill. Please contact us to pay it."
    ar = await invoice_ar_status(invoice)
    if ar["ar_backed"] and not ar["reconciled"]:
        return False, "needs_review", "We're updating this bill. Please contact us to pay it."
    return True, "ok", ""


async def client_bills_in_step(client_id: str) -> Tuple[bool, List[dict]]:
    """(all in step, open tab bills). The tab minus the open bills only means
    "general balance" or "credit" when every one of those bills agrees with
    the tab and is still checked out — otherwise the difference is just
    another bill's drift, and spending it would count money twice."""
    bills = await open_tab_bills(client_id)
    for b in bills:
        if not (await invoice_ar_status(b))["reconciled"] or not await _all_visits_locked(b):
            return False, bills
    return True, bills


async def credit_on_file(client_id: str) -> float:
    """Prepaid credit on the tab that no bill accounts for (an overpaid
    checkout or sale): the tab is lower than the open bills on it. Zero
    while any of the client's bills is out of step (see client_bills_in_step)."""
    ok, bills = await client_bills_in_step(client_id)
    if not ok:
        return 0.0
    client = await _g("db").clients.find_one({"id": client_id}, {"_id": 0, "account_balance": 1}) or {}
    on_bills = sum(_money(b.get("balance")) for b in bills)
    return round(max(0.0, on_bills - _money(client.get("account_balance"))), 2)


async def restatus_invoice(invoice_id: str, ts: Optional[str] = None) -> Optional[dict]:
    """Re-derive a bill's status from its current numbers. Only ever clamps
    rounding dust on the balance — never writes a balance from an older
    snapshot, which could undo a correction that landed in between."""
    db = _g("db")
    inv = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not inv:
        return None
    ts = ts or _now()
    balance = _money(inv.get("balance"))
    if abs(balance) <= 0.005 and inv.get("balance") not in (0, 0.0):
        await db.invoices.update_one({"id": invoice_id, "balance": {"$gte": -0.005, "$lte": 0.005}},
                                     {"$set": {"balance": 0.0}})
        balance = 0.0
    status = _g("_derive_invoice_status")(
        inv, amount_paid=_money(inv.get("amount_paid")), balance=max(balance, 0.0),
        credit_applied=float(inv.get("credit_applied") or 0))
    await db.invoices.update_one({"id": invoice_id}, {"$set": {"status": status, "updated_at": ts}})
    inv.update({"status": status, "balance": balance})
    return inv


# ───────────────────────── claims (idempotency) ─────────────────────────

async def _claim(coll, key: Optional[str], scope: Dict[str, Any]) -> Tuple[Optional[str], Optional[dict]]:
    """Claim-first idempotency: (claim_id, None) to proceed, or (None, done)
    when this exact request already completed. No key → no claim. `scope`
    includes the request's own values, so the same key sent with a changed
    amount is refused rather than answered with the first result."""
    if not key:
        return None, None
    claim_id = str(uuid.uuid4())
    ts = _now()
    try:
        await coll.insert_one({"id": claim_id, "idempotency_key": key, "status": "processing",
                               "result_ref": None, "created_at": ts, "updated_at": ts, **scope})
        return claim_id, None
    except DuplicateKeyError:
        existing = await coll.find_one({"idempotency_key": key}, {"_id": 0}) or {}
        if any(existing.get(k) != v for k, v in scope.items()):
            raise HTTPException(status_code=409, detail="This changed since it was first sent. Close this and start again.")
        if existing.get("status") == "completed":
            return None, existing
        raise HTTPException(status_code=409, detail="This change is already being saved. Wait a moment and refresh.")


async def _finish_claim(db, name: str, claim_id: Optional[str], ok: bool, result_ref: Optional[str] = None) -> None:
    if not claim_id:
        return
    if ok:
        await db[name].update_one({"id": claim_id}, {"$set": {"status": "completed", "result_ref": result_ref, "updated_at": _now()}})
    else:
        await deletion_log.delete_one(db, name, {"id": claim_id})


# ───────────────────────── correcting a checked-out visit ─────────────────────────

def _next_status(on_tab: bool, new_total: float, due: float, paid: float, prev: Optional[str]) -> str:
    if due <= 0.005:
        if paid > 0.005:
            return "paid"
        if new_total <= 0.005:
            return "comped"
        # Settled on the bill, not at the visit: "paid" with nothing paid here
        # would make the reports count the visit's price as collected cash on
        # top of the bill payment. Keep what the visit said.
        return prev or ("paid_partial" if on_tab else "unpaid")
    if on_tab:
        return "paid_partial"  # the "left on the tab" marker money readers rely on
    return "paid_partial" if paid > 0.005 else "unpaid"


async def correct_visit(booking_id: str, body, user: dict) -> dict:
    """Added charge / discount / write-off on a checked-out visit. Runs inside
    the booking's financial-correction guard (server.booking_financial_adjustment)."""
    db = _g("db")
    booking, collection, _archived = await _g("_load_booking_for_financial_correction")(booking_id)
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
    if not _g("_booking_is_financially_locked")(booking):
        raise HTTPException(status_code=409, detail="This booking is not financially locked; edit it before checkout instead.")
    if booking.get("group_bill_pending") or booking.get("group_bill_claim"):
        raise HTTPException(status_code=409, detail=friends_family.MSG_CORRECT_LATER)
    claim_id, done = await _claim(
        db.financial_adjustment_claims, getattr(body, "idempotency_key", None),
        {"booking_id": booking_id, "fingerprint": [body.kind, _money(body.amount), body.reason.strip()]})
    if done:
        fresh, _c, _a = await _g("_load_booking_for_financial_correction")(booking_id)
        return fresh

    kind = body.kind
    amount = _money(body.amount)
    reason = body.reason.strip()
    inv = await db.invoices.find_one({"booking_ids": booking_id, "status": {"$ne": "VOID"}}, {"_id": 0})
    on_tab = await booking_on_tab(booking_id)
    current_total = _money(booking.get("actual_price"))
    current_paid = _money(booking.get("amount_paid"))
    current_due = _money(booking.get("balance_due") if booking.get("balance_due") is not None
                         else _g("_booking_balance_due")(booking))
    try:
        if inv and has_refund_activity(inv):
            raise HTTPException(status_code=409, detail=MSG_REFUND)
        if inv and await bill_needs_rebuild(inv):
            raise HTTPException(status_code=409, detail=MSG_REBUILDING)
        single = inv is not None and len(inv.get("booking_ids") or []) == 1
        bill_balance = _money((inv or {}).get("balance"))
        if inv and single and bill_balance > 0.005:
            mode = "tab_bill" if on_tab else "bill"
            if inv.get("stripe_active_attempt_id"):
                raise HTTPException(status_code=409, detail=MSG_ONLINE)
            if mode == "tab_bill" and kind != "charge" and not (await invoice_ar_status(inv))["reconciled"]:
                # Capped by a bill that disagrees with the tab, a reduction
                # could forgive more (or less) than the tab holds.
                raise HTTPException(status_code=409, detail=MSG_NEEDS_FIX)
            base_due = bill_balance
        elif inv and not single and bill_balance > 0.005:
            raise HTTPException(status_code=409, detail=MSG_GROUP)
        elif inv:
            # Paid bill: an added charge is new debt on the tab; the visit's
            # own due was settled with the bill.
            if kind != "charge":
                raise HTTPException(status_code=409, detail=MSG_PAID)
            mode = "tab"
            base_due = 0.0
        else:
            base_due = current_due
            if kind == "charge":
                # A visit still owed off the tab keeps its debt where it is.
                mode = "visit" if (current_due > 0.005 and not on_tab) else "tab"
            else:
                if current_due <= 0:
                    raise HTTPException(status_code=409, detail="There is no unpaid balance to reduce. Use Refund when money has already been collected.")
                mode = "tab" if on_tab else "visit"
        if kind == "charge":
            delta = amount
        else:
            applied = min(amount, base_due)
            if applied <= 0.005:
                raise HTTPException(status_code=409, detail=MSG_PAID)
            delta = -applied
    except HTTPException:
        await _finish_claim(db, "financial_adjustment_claims", claim_id, ok=False)
        raise

    delta = round(delta, 2)
    money_client = friends_family.payer_id(booking)  # the payer, on a friends & family visit
    moves_tab = mode in ("tab_bill", "tab") and bool(money_client)
    due_after = round(max(0.0, base_due + delta), 2)
    new_total = round(current_total + delta, 2) if mode in ("tab_bill", "bill") else round(max(current_paid, current_total + delta), 2)
    if booking.get("payment_method") == "credits" and mode in ("tab", "visit"):
        # Reports read a credits visit's cash as price − what the credits cover, so a
        # later charge on its price would show as cash collected at checkout.
        # It lives on the tab (or the visit's due) until it is paid.
        new_total = current_total
    new_status = _next_status(mode in ("tab_bill", "tab"), new_total, due_after, current_paid, booking.get("payment_status"))
    before = {"actual_price": current_total, "amount_paid": current_paid, "balance_due": current_due,
              "payment_status": booking.get("payment_status")}
    update = {
        "actual_price": new_total, "balance_due": due_after, "payment_status": new_status,
        "financial_adjustment_total": round(float(booking.get("financial_adjustment_total") or 0) + delta, 2),
        "financial_revision": int(booking.get("financial_revision") or 0) + 1,
        "financial_locked": True,
        "financial_locked_at": booking.get("financial_locked_at") or _now(),
    }
    op_id = str(uuid.uuid4())
    ts = _now()
    label = {"charge": "Added charge", "discount": "Discount", "writeoff": "Write-off"}[kind]
    invoice_moved = False
    ledger_id = None
    balance_moved = False
    event_id = None
    try:
        # 1. The bill first, atomically: refused while an online payment
        #    holds it, and a reduction only while the bill still covers it.
        if mode in ("tab_bill", "bill"):
            filt: Dict[str, Any] = {
                "id": inv["id"], "status": {"$nin": ["VOID", *REFUND_STATUSES]},
                "stripe_active_attempt_id": None, "refunded_total": {"$not": {"$gt": 0.005}},
                "correction_ops": {"$ne": op_id},
                "balance": {"$gte": -delta - 0.005} if delta < 0 else {"$gt": 0.005},
            }
            line = {"kind": "adjustment", "description": f"{label} · {reason}", "booking_id": booking_id,
                    "service_id": None, "qty": 1, "unit_price": delta, "amount": delta,
                    "source": {"kind": CORRECTION_SOURCE, "op_id": op_id}}
            res = await db.invoices.find_one_and_update(
                filt, {"$inc": {"balance": delta, "total": delta, "subtotal": delta},
                       "$push": {"line_items": line, "correction_ops": op_id}, "$set": {"updated_at": ts}},
                return_document=ReturnDocument.AFTER)
            if res is None:
                now_inv = await db.invoices.find_one({"id": inv["id"]}, {"_id": 0, "stripe_active_attempt_id": 1}) or {}
                raise HTTPException(status_code=409, detail=MSG_ONLINE if now_inv.get("stripe_active_attempt_id") else MSG_CHANGED)
            invoice_moved = True
        # 2. The tab, only when this visit's debt lives there.
        if moves_tab:
            note = (f"{CORRECTION_NOTE_PREFIX} charge adjustment · {reason}" if kind == "charge"
                    else f"{CORRECTION_NOTE_PREFIX} {kind} · {reason}")
            row = await _g("_write_ledger_row")(
                client_id=money_client, type_="charge" if kind == "charge" else "adjustment",
                amount=delta, notes=note, booking_id=booking_id, created_by=user.get("id") or "admin", ts=ts,
                extra={"source": CORRECTION_SOURCE, "correction_op_id": op_id})
            ledger_id = row["id"]
            await _g("_adjust_client_balance")(money_client, delta)
            balance_moved = True
        # 3. The visit and its audit event.
        result = await collection.update_one({"id": booking_id}, {"$set": update})
        if result.matched_count != 1:
            raise RuntimeError("Booking disappeared during the adjustment")
        after = {"actual_price": new_total, "amount_paid": current_paid, "balance_due": due_after, "payment_status": new_status}
        event = await _g("_record_booking_financial_event")(
            booking, kind=kind, amount=abs(delta), reason=body.reason, user=user, before=before, after=after)
        event_id = event.get("id")
        if invoice_moved:
            await restatus_invoice(inv["id"], ts)
    except Exception as exc:
        await collection.replace_one({"id": booking_id}, booking, upsert=False)
        if balance_moved:
            await db.clients.update_one({"id": money_client}, {"$inc": {"account_balance": -float(delta)}})
        if ledger_id:
            await deletion_log.delete_one(db, "payment_ledger", {"id": ledger_id})
        if event_id:
            await deletion_log.delete_one(db, "booking_financial_events", {"id": event_id})
        if invoice_moved:
            await db.invoices.update_one(
                {"id": inv["id"], "correction_ops": op_id},
                {"$inc": {"balance": -delta, "total": -delta, "subtotal": -delta},
                 "$pull": {"line_items": {"source.op_id": op_id}, "correction_ops": op_id}})
            await restatus_invoice(inv["id"])
        await _finish_claim(db, "financial_adjustment_claims", claim_id, ok=False)
        if isinstance(exc, HTTPException):
            raise
        _g("logger").exception("Financial adjustment rolled back for booking %s", booking_id)
        raise HTTPException(status_code=500, detail="The adjustment could not be saved safely. No financial changes were kept.") from exc
    await _finish_claim(db, "financial_adjustment_claims", claim_id, ok=True, result_ref=event_id)
    booking.update(update)
    return booking


# ───────────────────────── Accounts Receivable adjustments ─────────────────────────

async def acquire_client_guard(client_id: str) -> tuple:
    """The same per-client money lock corrections and checkout use."""
    db = _g("db")
    keys = [f"financial-client:{client_id}"]
    try:
        owner = await _g("_acquire_capacity_locks")(keys)
    except HTTPException as exc:
        raise HTTPException(status_code=409, detail="Another financial action is already being saved. Wait a moment and refresh.") from exc
    operation_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    stale_before = (now - timedelta(minutes=15)).isoformat()
    client = await db.clients.find_one_and_update(
        {"id": client_id, "$and": [
            {"$or": [{"financial_checkout_in_progress": {"$exists": False}}, {"financial_checkout_in_progress": False},
                     {"financial_checkout_started_at": {"$lt": stale_before}}]},
            {"$or": [{"financial_correction_in_progress": {"$exists": False}}, {"financial_correction_in_progress": False},
                     {"financial_correction_started_at": {"$lt": stale_before}}]},
        ]},
        {"$set": {"financial_correction_in_progress": True, "financial_correction_operation_id": operation_id,
                  "financial_correction_started_at": now.isoformat()}},
        projection={"_id": 0, "id": 1}, return_document=ReturnDocument.BEFORE)
    if not client:
        await _g("_release_capacity_locks")(owner, keys)
        raise HTTPException(status_code=409, detail="Another checkout or financial correction is already in progress for this client.")
    return owner, keys, client_id, operation_id


async def release_client_guard(guard: tuple) -> None:
    await _g("_release_booking_financial_correction_guard")(*guard)


async def open_tab_bills(client_id: str) -> List[dict]:
    """The client's open bills whose visit went on the tab."""
    rows = await _g("db").invoices.find(
        {"client_id": client_id, "status": {"$ne": "VOID"}, "balance": {"$gt": 0.005}}, {"_id": 0}
    ).sort("created_at", 1).to_list(200)
    out = []
    for inv in rows:
        if (await invoice_ar_status(inv))["ar_backed"]:
            out.append(inv)
    return out


async def adjust_tab(client_id: str, body, user: dict) -> dict:
    """POST /clients/{id}/adjustment. A charge adds to the general balance.
    A write-off either names the bill it forgives (bill + tab move together)
    or comes out of the part of the balance that isn't on any bill."""
    db = _g("db")
    amount = _money(body.amount)
    if amount == 0:
        raise HTTPException(status_code=400, detail="Adjustment amount cannot be zero.")
    await _g("_require_register_day_open")(_g("business_today")().isoformat())
    if not await db.clients.find_one({"id": client_id}, {"_id": 0, "id": 1}):
        raise HTTPException(status_code=404, detail="Client not found")
    invoice_id = getattr(body, "invoice_id", None) or None
    if amount > 0 and invoice_id:
        raise HTTPException(status_code=400, detail="To add a charge to a bill, use Correct on that visit.")
    guard = await acquire_client_guard(client_id)
    try:
        claim_id, done = await _claim(db.tab_adjustment_claims, getattr(body, "idempotency_key", None),
                                      {"client_id": client_id, "fingerprint": [amount, invoice_id, body.notes]})
        if done:
            row = await db.payment_ledger.find_one({"id": done.get("result_ref")}, {"_id": 0})
            client = await db.clients.find_one({"id": client_id}, {"_id": 0, "account_balance": 1}) or {}
            return {"ok": True, "balance": _money(client.get("account_balance")), "row": row}
        try:
            out = await _adjust_tab_locked(client_id, amount, invoice_id, body.notes, user)
        except Exception:
            await _finish_claim(db, "tab_adjustment_claims", claim_id, ok=False)
            raise
        await _finish_claim(db, "tab_adjustment_claims", claim_id, ok=True, result_ref=(out.get("row") or {}).get("id"))
        return out
    finally:
        await release_client_guard(guard)


async def _adjust_tab_locked(client_id: str, amount: float, invoice_id: Optional[str], notes: str, user: dict) -> dict:
    if amount < 0 and not invoice_id and await friends_family.waiting_for_group_bill(client_id):
        raise HTTPException(status_code=409, detail=friends_family.MSG_WAITING)
    db = _g("db")
    who = user.get("email", "admin")
    write_row = _g("_write_ledger_row")
    if amount > 0:
        row = await write_row(client_id=client_id, type_="adjustment", amount=amount, notes=notes, created_by=who,
                              extra={"scope": "account", "source": "tab_adjustment"})
        return {"ok": True, "balance": await _g("_adjust_client_balance")(client_id, amount), "row": row}

    applied = -amount
    if not invoice_id:
        client = await db.clients.find_one({"id": client_id}, {"_id": 0, "account_balance": 1}) or {}
        in_step, bills = await client_bills_in_step(client_id)
        if not in_step:
            raise HTTPException(status_code=409, detail=MSG_ACCOUNT_NEEDS_FIX)
        on_bills = round(sum(_money(b.get("balance")) for b in bills), 2)
        general = round(_money(client.get("account_balance")) - on_bills, 2)
        if applied > general + 0.005:
            listed = ", ".join(f"#{b['id'][:8].upper()} ${_money(b.get('balance')):.2f}" for b in bills)
            room = f" Up to ${general:.2f} can come off the general balance." if general > 0.005 else ""
            raise HTTPException(status_code=409, detail=f"This client's balance is on bills ({listed}). Choose the bill to write off.{room}")
        row = await write_row(client_id=client_id, type_="adjustment", amount=-applied, notes=notes, created_by=who,
                              extra={"scope": "account", "source": "tab_adjustment"})
        return {"ok": True, "balance": await _g("_adjust_client_balance")(client_id, -applied), "row": row}

    inv = await db.invoices.find_one({"id": invoice_id, "client_id": client_id}, {"_id": 0})
    if not inv or (inv.get("status") or "").upper() == "VOID":
        raise HTTPException(status_code=404, detail="Bill not found")
    if has_refund_activity(inv):
        raise HTTPException(status_code=409, detail=MSG_REFUND)
    if _money(inv.get("balance")) <= 0.005:
        raise HTTPException(status_code=409, detail="This bill has nothing left to pay.")
    ar = await invoice_ar_status(inv)
    if not ar["ar_backed"]:
        raise HTTPException(status_code=409, detail="This bill isn't on the account tab. Use Correct on the visit instead.")
    if await bill_needs_rebuild(inv):
        raise HTTPException(status_code=409, detail=MSG_REBUILDING)
    if not ar["reconciled"] or not await _all_visits_locked(inv):
        raise HTTPException(status_code=409, detail=MSG_NEEDS_FIX)
    if applied > _money(inv.get("balance")) + 0.005:
        raise HTTPException(status_code=400, detail=f"That's more than the bill's balance of ${_money(inv.get('balance')):.2f}.")
    op_id = str(uuid.uuid4())
    ts = _now()
    line = {"kind": "adjustment", "description": f"Write-off · {notes}", "booking_id": None, "service_id": None,
            "qty": 1, "unit_price": -applied, "amount": -applied, "source": {"kind": "tab_writeoff", "op_id": op_id}}
    res = await db.invoices.find_one_and_update(
        {"id": invoice_id, "status": {"$nin": ["VOID", *REFUND_STATUSES]}, "stripe_active_attempt_id": None,
         "refunded_total": {"$not": {"$gt": 0.005}}, "balance": {"$gte": applied - 0.005}},
        {"$inc": {"balance": -applied, "total": -applied, "subtotal": -applied},
         "$push": {"line_items": line, "correction_ops": op_id}, "$set": {"updated_at": ts}},
        return_document=ReturnDocument.AFTER)
    if res is None:
        now_inv = await db.invoices.find_one({"id": invoice_id}, {"_id": 0, "stripe_active_attempt_id": 1}) or {}
        raise HTTPException(status_code=409, detail=MSG_ONLINE if now_inv.get("stripe_active_attempt_id") else MSG_CHANGED)
    row = None
    moved = False
    try:
        row = await write_row(client_id=client_id, type_="adjustment", amount=-applied, notes=notes, created_by=who,
                              ts=ts, invoice_id=invoice_id, extra={"source": "tab_writeoff", "writeoff_op_id": op_id})
        balance = await _g("_adjust_client_balance")(client_id, -applied)
        moved = True
        fresh = await restatus_invoice(invoice_id, ts)
    except Exception:
        if moved:
            await db.clients.update_one({"id": client_id}, {"$inc": {"account_balance": applied}})
        if row:
            await deletion_log.delete_one(db, "payment_ledger", {"id": row["id"]})
        await db.invoices.update_one(
            {"id": invoice_id, "correction_ops": op_id},
            {"$inc": {"balance": applied, "total": applied, "subtotal": applied},
             "$pull": {"line_items": {"source.op_id": op_id}, "correction_ops": op_id}})
        await restatus_invoice(invoice_id)
        raise
    return {"ok": True, "balance": balance, "row": row, "invoice": fresh}


async def ensure_indexes() -> None:
    db = _g("db")
    await db.financial_adjustment_claims.create_index("idempotency_key", unique=True)
    await db.tab_adjustment_claims.create_index("idempotency_key", unique=True)
