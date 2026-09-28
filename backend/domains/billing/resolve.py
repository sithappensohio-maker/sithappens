"""Staff tools for bills and online payments that got stuck (audit #7).

Stuck online payments. A customer paid a bill online, Stripe took the
money, and the app could not record it against the bill (the bill had
drifted from the account tab). The payment sat in "reconciliation_required"
holding the bill, the portal spun, and no screen showed it. Staff now see
each one (Front Desk → Online payments, and Action Required) and either:
- Retry — after Stripe confirms the payment still stands (not refunded or
  disputed), record it through the normal apply path; or
- Refund — give the money back through Stripe and free the bill, so the
  customer can pay the corrected amount.

Bills out of step. A bill whose visit went on the tab can be repaired from
the client's Bills list:
- Match — set the bill to what the account history says is owed for it;
- Link an earlier account entry — an unexplained payment or write-off on
  the account that was really for this bill (the entry is tagged to it, so
  it can never be counted for another bill);
- Mark reviewed — the unexplained entries listed were not for this bill.
"""
from __future__ import annotations

import uuid
from typing import Any, Dict, List, Literal, Optional

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field

from domains.billing import tab_sync
from domains.billing.tab_sync import _g, _money
from domains.shop import abandon as shop_abandon

MSG_NOT_WAITING = "This payment is no longer waiting — refresh the list."


def _public_attempt(a: dict) -> dict:
    return {k: a.get(k) for k in ("id", "status", "invoice_id", "client_id", "amount_cents", "created_at", "updated_at")}


async def _held_attempt(invoice: dict) -> Optional[dict]:
    aid = invoice.get("stripe_active_attempt_id")
    if not aid:
        return None
    return await _g("db").stripe_payment_attempts.find_one({"id": aid}, {"_id": 0})


# ───────────────────────── portal / admin annotations ─────────────────────────

async def portal_flags(invoice: dict, stripe_enabled: bool) -> dict:
    """What the portal may offer for this bill, plus a plain reason."""
    held = await _held_attempt(invoice)
    online_status = None
    if held and held.get("status") == "pending":
        online_status = "in_progress"
    elif held and held.get("status") == "reconciliation_required":
        online_status = "received"
    ok, code, msg = await tab_sync.payable_now(invoice)
    note = ""
    if online_status == "received":
        note = "We received your online payment and are finishing it up. You won't be charged again."
    elif not ok and code not in ("paid", "void"):
        note = msg
    return {"can_pay_online": bool(ok and stripe_enabled), "online_status": online_status, "pay_note": note}


async def annotate_bills(invoices: List[dict]) -> List[dict]:
    """ClientHub Bills: flag open bills that need a staff fix — out of step
    with the tab, a stuck online payment, or credit on file the desk can't
    take a payment past (it's applied from the Fix dialog)."""
    credit_cache: Dict[str, float] = {}
    for inv in invoices:
        inv["needs_attention"] = False
        inv["online_payment_stuck"] = False
        if (inv.get("status") or "").upper() == "VOID":
            continue
        held = await _held_attempt(inv)
        if held and held.get("status") in ("reconciliation_required", "refunding"):
            inv["online_payment_stuck"] = True
            inv["needs_attention"] = True
        if _money(inv.get("balance")) > 0.005 and not tab_sync.has_refund_activity(inv):
            ar = await tab_sync.invoice_ar_status(inv)
            if ar["ar_backed"] and not ar["reconciled"]:
                inv["needs_attention"] = True
            elif ar["ar_backed"]:
                cid = inv.get("client_id")
                if cid not in credit_cache:
                    credit_cache[cid] = await tab_sync.credit_on_file(cid)
                if credit_cache[cid] > 0.005:
                    inv["needs_attention"] = True
    return invoices


# ───────────────────────── stuck online payments ─────────────────────────

async def _stripe_state(attempt: dict) -> dict:
    """Ask Stripe what really happened to this payment."""
    stripe = _g("stripe")
    pi_id = attempt.get("stripe_payment_intent_id")
    if not pi_id and attempt.get("stripe_checkout_session_id"):
        session = stripe.checkout.Session.retrieve(attempt["stripe_checkout_session_id"]).to_dict()
        pi_id = session.get("payment_intent")
        if pi_id:  # remember it, so the stuck list can match a dispute to it
            await _g("db").stripe_payment_attempts.update_one(
                {"id": attempt["id"], "stripe_payment_intent_id": None}, {"$set": {"stripe_payment_intent_id": pi_id}})
            attempt["stripe_payment_intent_id"] = pi_id
    if not pi_id:
        return {"payment_intent": None, "succeeded": False, "refunded_cents": 0, "disputed": False}
    pi = stripe.PaymentIntent.retrieve(pi_id, expand=["latest_charge"]).to_dict()
    charge = pi.get("latest_charge") if isinstance(pi.get("latest_charge"), dict) else {}
    return {
        "payment_intent": pi_id,
        "succeeded": pi.get("status") == "succeeded",
        "refunded_cents": int((charge or {}).get("amount_refunded") or 0),
        "disputed": bool((charge or {}).get("disputed")),
    }


async def _dispute_state(attempt: dict) -> Optional[str]:
    """"open" / "won" / "lost" for a dispute on this payment, else None."""
    pi = attempt.get("stripe_payment_intent_id")
    if not pi:
        return None
    d = await _g("db").stripe_disputes.find_one({"stripe_payment_intent_id": pi}, {"_id": 0, "status": 1})
    if not d:
        return None
    status = d.get("status")
    return status if status in ("won", "lost") else "open"


async def stuck_payments(limit: int = 100) -> List[dict]:
    db = _g("db")
    rows = await db.stripe_payment_attempts.find(
        {"status": {"$in": ["reconciliation_required", "refunding"]}}, {"_id": 0}).sort("created_at", 1).to_list(limit)
    out = []
    for a in rows:
        inv = await db.invoices.find_one({"id": a.get("invoice_id")}, {"_id": 0}) or {}
        client = await db.clients.find_one({"id": a.get("client_id")}, {"_id": 0, "name": 1}) or {}
        amount = round(int(a.get("amount_cents") or 0) / 100.0, 2)
        code, reason = "ready", "Ready to record — press Retry."
        dispute = await _dispute_state(a)
        if inv and inv.get("stripe_last_applied_attempt_id") == a.get("id"):
            code, reason = "partly_recorded", "Part of this payment was recorded. Press Retry to finish it."
        elif dispute == "open":
            code, reason = "dispute_open", "The customer disputed this charge with their bank. Wait for the bank's decision (Disputes); the bill stays on hold until then."
        elif dispute == "lost":
            code, reason = "dispute_lost", "The bank sided with the customer, so this money went back to them. Press Close to free the bill."
        elif dispute == "won":
            code, reason = "dispute_won", "The dispute was won, so the money stays with you. Press Retry to record it."
        elif a.get("status") == "refunding":
            code, reason = "refunding", "A refund was started but not confirmed. Press Refund to finish it."
        elif not inv:
            code, reason = "missing", "The bill for this payment is missing. Refund it."
        elif tab_sync.has_refund_activity(inv):
            code, reason = "refund", "The bill has a refund on it, so this payment can't be added. Refund it."
        elif _money(inv.get("balance")) < amount - 0.005:
            code, reason = "too_big", f"The bill is now ${_money(inv.get('balance')):.2f}, less than the ${amount:.2f} paid. Refund it, then the customer can pay the new amount."
        else:
            ar = await tab_sync.invoice_ar_status(inv)
            if ar["ar_backed"] and not ar["reconciled"]:
                code, reason = "needs_review", "The bill is out of step with the account. Fix the bill (client → Bills), then Retry — or Refund."
        out.append({
            **_public_attempt(a), "amount": amount, "client_name": client.get("name") or inv.get("client_name"),
            "invoice_number": (a.get("invoice_id") or "")[:8].upper(), "invoice_balance": _money(inv.get("balance")),
            "reason_code": code, "reason": reason,
            "can_retry": code in ("ready", "partly_recorded", "dispute_won"),
            "can_refund": code in ("ready", "refunding", "missing", "refund", "too_big", "needs_review"),
            "can_close": code == "dispute_lost",
        })
    # Shop payments the app couldn't record wait here too (audit #62).
    return out + await shop_abandon.stuck_rows(limit)


async def retry_payment(attempt_id: str) -> dict:
    db = _g("db")
    a = await db.stripe_payment_attempts.find_one({"id": attempt_id}, {"_id": 0})
    if not a:
        shop = await shop_abandon.find_stuck(attempt_id)
        if shop:
            return await shop_abandon.retry_stuck(shop)
        raise HTTPException(status_code=404, detail="Payment not found")
    if a.get("status") != "reconciliation_required":
        raise HTTPException(status_code=409, detail=MSG_NOT_WAITING)
    inv = await db.invoices.find_one({"id": a.get("invoice_id")}, {"_id": 0, "stripe_last_applied_attempt_id": 1}) or {}
    finishing = inv.get("stripe_last_applied_attempt_id") == attempt_id  # half-recorded: always finish it
    state = await _stripe_state(a)
    if not state["succeeded"] and not finishing:
        raise HTTPException(status_code=409, detail="Stripe doesn't show this payment as completed.")
    dispute = await _dispute_state(a)
    if not finishing and (state["refunded_cents"] > 0 or (state["disputed"] and dispute != "won")):
        raise HTTPException(status_code=409, detail="Stripe shows this payment was refunded or is disputed, so it can't be recorded.")
    if state["payment_intent"] and not a.get("stripe_payment_intent_id"):
        await db.stripe_payment_attempts.update_one({"id": attempt_id}, {"$set": {"stripe_payment_intent_id": state["payment_intent"]}})
        a["stripe_payment_intent_id"] = state["payment_intent"]
    try:
        await _g("_apply_stripe_payment")(a)
    except HTTPException as exc:
        raise HTTPException(status_code=409, detail=f"Still can't record it: {exc.detail}")
    return {"ok": True, "attempt": _public_attempt(await db.stripe_payment_attempts.find_one({"id": attempt_id}, {"_id": 0}))}


async def _claim_for_closing(a: dict) -> None:
    """Mark the bill so the payment can no longer be recorded while it is
    being refunded or closed (apply's Step A refuses a bill carrying this
    marker), then move the attempt out of the retryable state."""
    db = _g("db")
    attempt_id = a["id"]
    marked = await db.invoices.update_one(
        {"id": a.get("invoice_id"), "stripe_active_attempt_id": attempt_id,
         "stripe_last_applied_attempt_id": {"$ne": attempt_id}},
        {"$set": {"stripe_refunding_attempt_id": attempt_id}})
    if marked.matched_count != 1:
        inv = await db.invoices.find_one({"id": a.get("invoice_id")}, {"_id": 0, "stripe_last_applied_attempt_id": 1}) or {}
        if inv.get("stripe_last_applied_attempt_id") == attempt_id:
            raise HTTPException(status_code=409, detail="Part of this payment was already recorded. Use Retry to finish it.")
        if inv:  # the bill no longer names this payment; nothing to protect
            return
    await db.stripe_payment_attempts.update_one(
        {"id": attempt_id, "status": "reconciliation_required"}, {"$set": {"status": "refunding", "updated_at": _g("now_iso")()}})


async def _finish_closing(a: dict, status: str, user: dict, refund_id: Optional[str] = None) -> None:
    db = _g("db")
    await db.stripe_payment_attempts.update_one(
        {"id": a["id"], "status": {"$in": ["reconciliation_required", "refunding"]}},
        {"$set": {"status": status, "stripe_refund_id": refund_id, "resolved_at": _g("now_iso")(),
                  "resolved_by": user.get("name") or user.get("email") or user.get("id")}})
    await _g("_release_stripe_reservation_if_owned")(a.get("invoice_id"), a["id"])
    await db.invoices.update_one({"id": a.get("invoice_id"), "stripe_refunding_attempt_id": a["id"]},
                                 {"$unset": {"stripe_refunding_attempt_id": ""}})


async def refund_payment(attempt_id: str, user: dict) -> dict:
    db = _g("db")
    a = await db.stripe_payment_attempts.find_one({"id": attempt_id}, {"_id": 0})
    if not a:
        shop = await shop_abandon.find_stuck(attempt_id)
        if shop:
            return await shop_abandon.refund_stuck(shop, user)
        raise HTTPException(status_code=404, detail="Payment not found")
    if a.get("status") not in ("reconciliation_required", "refunding"):
        raise HTTPException(status_code=409, detail=MSG_NOT_WAITING)
    state = await _stripe_state(a)
    if state["disputed"] or await _dispute_state(a):
        raise HTTPException(status_code=409, detail="This charge is disputed, so it can't be refunded. The bank's decision settles it (Disputes).")
    await _claim_for_closing(a)
    refund_id = None
    if state["refunded_cents"] < int(a.get("amount_cents") or 0):
        if not state["payment_intent"]:
            raise HTTPException(status_code=409, detail="Stripe has no completed payment to refund for this.")
        try:
            refund = _g("stripe").Refund.create(
                payment_intent=state["payment_intent"], idempotency_key=f"stuck_attempt_refund:{attempt_id}",
                metadata={"sithappens_stuck_attempt_id": attempt_id})
        except Exception as exc:
            _g("logger").warning("Stuck-payment refund failed for %s: %s", attempt_id, exc)
            raise HTTPException(status_code=502, detail="Stripe couldn't refund this right now. Press Refund again in a minute.")
        refund_id = refund["id"]
        if (refund.get("status") if hasattr(refund, "get") else None) in ("failed", "canceled"):
            await _reopen_after_failed_refund(a)
            raise HTTPException(status_code=502, detail="Stripe couldn't refund this payment. It's back in the list — try again or contact Stripe.")
    await _finish_closing(a, "refunded", user, refund_id)
    return {"ok": True, "refunded": True, "stripe_refund_id": refund_id}


async def close_disputed_payment(attempt_id: str, user: dict) -> dict:
    """The bank decided a dispute for the customer: the money went back to
    them, so free the bill (it's still owed). While a dispute is open the
    bill stays on hold — if it's won, the money is recorded with Retry."""
    db = _g("db")
    a = await db.stripe_payment_attempts.find_one({"id": attempt_id}, {"_id": 0})
    if not a and (shop := await shop_abandon.find_stuck(attempt_id)):
        return await shop_abandon.close_stuck(shop, user)
    if not a or a.get("status") not in ("reconciliation_required", "refunding"):
        raise HTTPException(status_code=409, detail=MSG_NOT_WAITING)
    if await _dispute_state(a) != "lost":
        raise HTTPException(status_code=409, detail="Close is only for a dispute the bank decided for the customer.")
    await _claim_for_closing(a)
    await _finish_closing(a, "disputed", user)
    return {"ok": True, "closed": True}


async def _reopen_after_failed_refund(a: dict) -> None:
    """The refund didn't happen: the money is still here. Put the payment back
    in the stuck list and hold the bill for it again (if nothing else has)."""
    db = _g("db")
    await db.stripe_payment_attempts.update_one(
        {"id": a["id"], "status": {"$in": ["refunding", "refunded"]}},
        {"$set": {"status": "reconciliation_required", "updated_at": _g("now_iso")()}, "$unset": {"stripe_refund_id": ""}})
    await db.invoices.update_one({"id": a.get("invoice_id"), "stripe_refunding_attempt_id": a["id"]},
                                 {"$unset": {"stripe_refunding_attempt_id": ""}})
    await db.invoices.update_one(
        {"id": a.get("invoice_id"), "stripe_active_attempt_id": None},
        {"$set": {"stripe_active_attempt_id": a["id"], "stripe_reserved_amount_cents": int(a.get("amount_cents") or 0)}})


async def on_stripe_refund(refund_obj: dict) -> bool:
    """Refund webhooks for stuck-payment refunds (they carry our metadata).
    Returns True when handled here — there is no recorded payment for the
    general refund path to reverse. A refund that later fails reopens it."""
    if await shop_abandon.on_stripe_refund(refund_obj):
        return True
    attempt_id = (refund_obj.get("metadata") or {}).get("sithappens_stuck_attempt_id")
    if not attempt_id:
        return False
    a = await _g("db").stripe_payment_attempts.find_one({"id": attempt_id}, {"_id": 0})
    if not a:
        return True
    if refund_obj.get("status") in ("failed", "canceled"):
        await _reopen_after_failed_refund(a)
        _g("logger").warning("Stuck-payment refund %s for attempt %s %s — back in the list",
                             refund_obj.get("id"), attempt_id, refund_obj.get("status"))
    return True


async def pending_action_items() -> List[dict]:
    """Action Required: every stuck online payment (money already taken)."""
    items = []
    urgency = _g("_financial_action_urgency")
    for p in await stuck_payments(limit=200):
        items.append({
            **urgency(p.get("created_at")),
            "id": f"online_payment_stuck:{p['id']}", "type": "online_payment_stuck",
            "type_label": "Online Payment Needs Attention", "priority": "action_required",
            "status": p["reason_code"], "created_at": p.get("created_at"), "client_id": p.get("client_id"),
            "client_name": p.get("client_name"), "dog_id": None, "dog_name": None,
            "service_name": f"${p['amount']:.2f} online · "
                            + (f"Shop order #{p['order_number']}" if p.get("kind") == "shop" else f"Bill #{p['invoice_number']}"),
            "requested_start": None, "requested_date": None, "requested_end_date": None, "requested_time": None,
            "notes": p["reason"][:300],
            "deep_link": {"screen": "pos", "panel": "online_payments", "stuck_attempt_id": p["id"]},
            "required_permission": "delete_records",
        })
    return items


async def pending_action_count() -> int:
    return (await _g("db").stripe_payment_attempts.count_documents({"status": {"$in": ["reconciliation_required", "refunding"]}})
            + await shop_abandon.stuck_count())


# ───────────────────────── repairing a bill ─────────────────────────

async def bill_preview(invoice_id: str) -> dict:
    db = _g("db")
    inv = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Bill not found")
    ar = await tab_sync.invoice_ar_status(inv)
    held = await _held_attempt(inv)
    reopened = not await tab_sync._all_visits_locked(inv)
    refund = tab_sync.has_refund_activity(inv)
    stale = await tab_sync.bill_needs_rebuild(inv)  # rebuilt automatically shortly (audit #14)
    blocked = refund or reopened or stale or (held is not None and held.get("status") == "pending")
    balance = _money(inv.get("balance"))
    credit = await tab_sync.credit_on_file(inv["client_id"]) if ar["ar_backed"] else 0.0
    return {
        "invoice": {k: inv.get(k) for k in ("id", "client_id", "client_name", "status", "total", "amount_paid",
                                            "credit_applied", "balance", "booking_ids", "date")},
        "invoice_number": inv["id"][:8].upper(),
        "on_tab": ar["ar_backed"],
        "tab_amount": ar["booking_net"] if ar["ar_backed"] else None,
        "in_step": (not ar["ar_backed"]) or ar["reconciled"],
        "difference": round(balance - ar["booking_net"], 2) if ar["ar_backed"] else 0.0,
        "match_to": max(0.0, ar["booking_net"]) if ar["ar_backed"] else None,
        "can_match": ar["ar_backed"] and not ar["balance_matches"] and not blocked,
        "unexplained": [{"id": r["id"], "created_at": r.get("created_at"), "amount": _money(r.get("amount")),
                         "type": r.get("type"), "notes": r.get("notes") or ""} for r in ar["unexplained"]],
        "review_through": ar["unexplained"][-1].get("created_at") if ar["unexplained"] else None,
        "can_review": bool(ar["unexplained"]) and not blocked,
        "online_payment": ({**_public_attempt(held), "amount": round(int(held.get("amount_cents") or 0) / 100.0, 2)}
                           if held else None),
        "credit_on_file": credit,
        "can_apply_credit": credit > 0.005 and ar["ar_backed"] and ar["reconciled"] and balance > 0.005 and not blocked
                            and not held,
        "refund_activity": refund,
        "visits_reopened": reopened,
    }


class BillFixIn(BaseModel):
    action: Literal["match", "attribute", "review", "apply_credit"]
    expected_balance: Optional[float] = None
    row_id: Optional[str] = Field(default=None, max_length=100)
    through: Optional[str] = Field(default=None, max_length=64)


async def fix_bill(invoice_id: str, body: BillFixIn, user: dict) -> dict:
    db = _g("db")
    inv = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Bill not found")
    guard = await tab_sync.acquire_client_guard(inv["client_id"])
    try:
        held = await _held_attempt(inv)
        if held and held.get("status") == "pending":
            raise HTTPException(status_code=409, detail=tab_sync.MSG_ONLINE)
        if held and inv.get("stripe_last_applied_attempt_id") == held.get("id"):
            # An online payment half-recorded: finish it first, or the bill
            # would count that money as still owed.
            try:
                await _g("_apply_stripe_payment")(held)
            except HTTPException as exc:
                raise HTTPException(status_code=409, detail=f"Finish the online payment first: {exc.detail}")
            inv = await db.invoices.find_one({"id": invoice_id}, {"_id": 0})
        if tab_sync.has_refund_activity(inv):
            raise HTTPException(status_code=409, detail=tab_sync.MSG_REFUND)
        if not await tab_sync._all_visits_locked(inv):
            raise HTTPException(status_code=409, detail="A visit on this bill was reopened. Check it out again first.")
        if await tab_sync.bill_needs_rebuild(inv):
            raise HTTPException(status_code=409, detail=tab_sync.MSG_REBUILDING)
        ar = await tab_sync.invoice_ar_status(inv)
        if not ar["ar_backed"]:
            raise HTTPException(status_code=400, detail="This bill isn't on the account tab, so there's nothing to line up.")
        balance = _money(inv.get("balance"))
        who = user.get("name") or user.get("email") or user.get("id")
        ts = _g("now_iso")()
        op_id = str(uuid.uuid4())
        entry = {"at": ts, "by": who, "action": body.action, "op_id": op_id}

        if body.action == "match":
            if ar["balance_matches"]:
                raise HTTPException(status_code=409, detail="This bill already matches the account history.")
            if body.expected_balance is None or abs(_money(body.expected_balance) - balance) > 0.005:
                raise HTTPException(status_code=409, detail=tab_sync.MSG_CHANGED)
            new_balance = max(0.0, ar["booking_net"])
            diff = round(new_balance - balance, 2)
            sign = "+" if diff >= 0 else "−"
            line = {"kind": "adjustment", "description": f"Bill matched to the account history ({sign}${abs(diff):.2f})",
                    "booking_id": None, "service_id": None, "qty": 1, "unit_price": diff, "amount": diff,
                    "source": {"kind": "reconcile", "op_id": op_id, "by": who}}
            res = await db.invoices.update_one(
                {"id": invoice_id, "balance": {"$gte": balance - 0.005, "$lte": balance + 0.005},
                 "stripe_active_attempt_id": inv.get("stripe_active_attempt_id")},
                {"$inc": {"balance": diff, "total": diff, "subtotal": diff},
                 "$push": {"line_items": line, "reconciliations": {**entry, "diff": diff}}, "$set": {"updated_at": ts}})
            if res.matched_count != 1:
                raise HTTPException(status_code=409, detail=tab_sync.MSG_CHANGED)

        elif body.action == "attribute":
            row = next((r for r in ar["unexplained"] if r.get("id") == body.row_id), None)
            if not row:
                raise HTTPException(status_code=409, detail="That entry can't be linked to this bill any more. Refresh.")
            amt = -_money(row.get("amount"))
            if amt > balance + 0.005:
                raise HTTPException(status_code=400, detail="That entry is larger than what's left on this bill.")
            tagged = await db.payment_ledger.update_one(
                {"id": row["id"], "invoice_id": None, "booking_id": None},
                {"$set": {"invoice_id": invoice_id, "attributed_at": ts, "attributed_by": who}})
            if tagged.modified_count != 1:
                raise HTTPException(status_code=409, detail="That entry was just linked elsewhere. Refresh.")
            is_payment = row.get("type") == "payment"
            inc = {"balance": -amt, **({"amount_paid": amt} if is_payment else {"total": -amt, "subtotal": -amt})}
            when = str(row.get("created_at") or "")[:10]
            line = {"kind": "credit" if is_payment else "adjustment",
                    "description": f"Earlier {'payment' if is_payment else 'write-off'} on the account ({when}) applied to this bill",
                    "booking_id": None, "service_id": None, "qty": 1, "unit_price": -amt, "amount": -amt,
                    "source": {"kind": "attribute", "op_id": op_id, "ledger_row_id": row["id"], "by": who}}
            res = await db.invoices.update_one(
                {"id": invoice_id, "balance": {"$gte": amt - 0.005}},
                {"$inc": inc, "$push": {"line_items": line, "reconciliations": {**entry, "ledger_row_id": row["id"], "amount": amt}},
                 "$set": {"updated_at": ts}})
            if res.matched_count != 1:
                await db.payment_ledger.update_one({"id": row["id"], "invoice_id": invoice_id},
                                                   {"$set": {"invoice_id": None}, "$unset": {"attributed_at": "", "attributed_by": ""}})
                raise HTTPException(status_code=409, detail=tab_sync.MSG_CHANGED)

        elif body.action == "apply_credit":
            # Credit already on the tab pays toward this bill: the bill and
            # the tab's per-bill rows move together; the tab total is unchanged
            # (the credit was already netted into it). Not new revenue.
            if not ar["reconciled"] or inv.get("stripe_active_attempt_id"):
                raise HTTPException(status_code=409, detail=tab_sync.MSG_CHANGED)
            use = min(await tab_sync.credit_on_file(inv["client_id"]), balance)
            if use <= 0.005:
                raise HTTPException(status_code=409, detail="There's no credit on file to use.")
            line = {"kind": "credit", "description": "Credit on file applied", "booking_id": None, "service_id": None,
                    "qty": 1, "unit_price": -use, "amount": -use, "source": {"kind": "credit_on_file", "op_id": op_id, "by": who}}
            res = await db.invoices.update_one(
                {"id": invoice_id, "stripe_active_attempt_id": None, "balance": {"$gte": use - 0.005}},
                {"$inc": {"balance": -use, "amount_paid": use},
                 "$push": {"line_items": line, "reconciliations": {**entry, "amount": use}}, "$set": {"updated_at": ts}})
            if res.matched_count != 1:
                raise HTTPException(status_code=409, detail=tab_sync.MSG_CHANGED)
            write_row = _g("_write_ledger_row")
            try:
                await write_row(client_id=inv["client_id"], type_="payment", amount=-use, method="credit_on_file",
                                notes=f"Credit on file applied · bill {invoice_id[:8].upper()}", created_by=who, ts=ts,
                                invoice_id=invoice_id, extra={"source": "credit_on_file", "credit_op_id": op_id})
                await write_row(client_id=inv["client_id"], type_="adjustment", amount=use,
                                notes=f"Credit on file used on bill {invoice_id[:8].upper()}", created_by=who, ts=ts,
                                extra={"scope": "account", "source": "credit_on_file", "credit_op_id": op_id})
            except Exception:
                await db.payment_ledger.delete_many({"credit_op_id": op_id})
                await db.invoices.update_one(
                    {"id": invoice_id},
                    {"$inc": {"balance": use, "amount_paid": -use},
                     "$pull": {"line_items": {"source.op_id": op_id}, "reconciliations": {"op_id": op_id}}})
                raise

        else:  # review
            if not ar["unexplained"]:
                raise HTTPException(status_code=409, detail="There's nothing left to review on this bill.")
            newest = ar["unexplained"][-1].get("created_at")
            if not body.through or body.through != newest:
                raise HTTPException(status_code=409, detail="New account activity appeared. Review the list again.")
            await db.invoices.update_one(
                {"id": invoice_id},
                {"$set": {"ar_reviewed_through": newest, "updated_at": ts},
                 "$push": {"reconciliations": {**entry, "through": newest}}})

        await tab_sync.restatus_invoice(invoice_id, ts)
    finally:
        await tab_sync.release_client_guard(guard)
    return await bill_preview(invoice_id)


# ───────────────────────── routes ─────────────────────────

def register_billing_routes(*, api, server_globals: dict) -> None:
    perm = server_globals["require_admin_and_permission"]

    async def get_bill_fix(invoice_id: str, _: dict = Depends(perm("finance_reports"))):
        return await bill_preview(invoice_id)

    async def post_bill_fix(invoice_id: str, body: BillFixIn, user: dict = Depends(perm("delete_records"))):
        return await fix_bill(invoice_id, body, user)

    async def list_stuck(_: dict = Depends(perm("finance_reports"))):
        return {"payments": await stuck_payments()}

    async def post_retry(attempt_id: str, _: dict = Depends(perm("delete_records"))):
        return await retry_payment(attempt_id)

    async def post_refund(attempt_id: str, user: dict = Depends(perm("delete_records"))):
        return await refund_payment(attempt_id, user)

    async def post_close(attempt_id: str, user: dict = Depends(perm("delete_records"))):
        return await close_disputed_payment(attempt_id, user)

    api.add_api_route("/invoices/{invoice_id}/reconcile", get_bill_fix, methods=["GET"])
    api.add_api_route("/invoices/{invoice_id}/reconcile", post_bill_fix, methods=["POST"])
    api.add_api_route("/admin/online-payments/stuck", list_stuck, methods=["GET"])
    api.add_api_route("/admin/online-payments/stuck/{attempt_id}/retry", post_retry, methods=["POST"])
    api.add_api_route("/admin/online-payments/stuck/{attempt_id}/refund", post_refund, methods=["POST"])
    api.add_api_route("/admin/online-payments/stuck/{attempt_id}/close", post_close, methods=["POST"])
    server_globals.update({"billing_bill_preview": get_bill_fix, "billing_fix_bill": post_bill_fix,
                           "billing_stuck_payments": list_stuck, "billing_retry_payment": post_retry,
                           "billing_refund_payment": post_refund})
