"""Stock held for a Shop checkout that will never be paid is let go.

Audit 2026-09-25 #57 (owner chose option A, 2026-09-27). A checkout holds the
physical items it is buying (pos_products.stock_reserved + shop_reservations)
from the moment it starts, so two people cannot pay for the last one. Before,
two paths never let go:

  * a checkout that stopped BEFORE reaching Stripe — say the second item in
    the basket had too few left once other checkouts' holds were counted —
    kept whatever it had already held, for good: no payment attempt, so no
    Stripe event and no sweep ever saw it. Each try stranded another unit,
    and the Shop showed the item sold out while it sat on the shelf;
  * a checkout the buyer walked away from stayed held until Stripe's
    "expired" webhook arrived — and if it never did and nobody reopened the
    order, forever.

Now:
  * rollback_unstarted — a checkout that stops before any payment started
    gives back what it held, and its order and idempotency claim are removed
    so the same basket can simply be tried again;
  * cancel_checkout — backing out of Stripe (the cancel link) closes that
    Stripe page and lets go at once;
  * sweep — a scheduler job that settles every abandoned checkout on its
    own, and repairs holds already stranded (orders that never reached
    Stripe, orders a crash left half-settled, holds whose order is gone or
    already cancelled).

Stripe stays the authority: stock is let go only when Stripe says the page
EXPIRED, or its bank payment FAILED. A paid page is applied; a bank payment
still processing is left alone (never cancelled out from under real money).

Every step that could race a live checkout of the same order takes the order
out of play FIRST (a guarded delete or status flip that fails if a payment
has started) and lets go of stock only after winning it.

server.py is at its line ceiling, so this reads the server helpers it needs
live (same pattern as domains.bookings.late_day).
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

_server_globals: Optional[dict] = None

# An order that has been waiting this long without ever reaching Stripe was
# abandoned mid-checkout (a crash, a closed tab before the redirect).
UNSTARTED_STALE_MINUTES = 60
# How often the sweep may ask Stripe about the same attempt.
RECHECK_MINUTES = 15
SWEEP_LIMIT = 50
# Stripe round trips per tick; the rest rotate in via abandon_checked_at.
STRIPE_SWEEP_LIMIT = 10
# Attempts that can never be paid.
DEAD_ATTEMPT_STATUSES = ("failed", "expired", "canceled")


def configure(*, server_globals: dict) -> None:
    global _server_globals
    _server_globals = server_globals


def _g(name: str):
    return _server_globals[name]


def _as_dict(obj) -> Dict[str, Any]:
    if obj is None:
        return {}
    if hasattr(obj, "to_dict"):
        return obj.to_dict()
    return dict(obj)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


async def _stripe_call(fn, *args) -> Dict[str, Any]:
    """Stripe's client blocks, and this runs inside a web worker (the
    scheduler and the cancel routes) — keep it off the event loop."""
    return _as_dict(await asyncio.to_thread(fn, *args))


async def _pull_holds(order: dict) -> None:
    """Remove (not mark released) the order's product holds, so a retry of
    the same basket can hold them again."""
    db = _g("db")
    for line in order.get("lines") or []:
        if line.get("kind") != "product":
            continue
        ref = _g("_shop_inventory_ref")(order["id"], line["item_id"])
        await db.pos_products.update_one(
            {"id": line["ref_id"], "shop_reservations": {"$elemMatch": {"ref": ref, "state": "reserved"}}},
            {"$inc": {"stock_reserved": -float(line["quantity"])},
             "$pull": {"shop_reservations": {"ref": ref}},
             "$set": {"updated_at": _g("now_iso")()}},
        )


async def rollback_unstarted(order_id: str, idempotency_key: str) -> None:
    """A checkout stopped before any payment started (an item ran short while
    holding stock): give back every hold on this order and remove the order
    and its claim, so the same basket can be tried again from scratch.

    The guarded delete comes first and decides everything: if another request
    with the same key has already taken this order to Stripe, the delete
    misses and its holds (which share these refs) stay untouched."""
    db = _g("db")
    if await db.shop_payment_attempts.find_one({"shop_order_id": order_id}, {"_id": 1}):
        return
    order = await db.shop_orders.find_one_and_delete(
        {"id": order_id, "status": "pending_payment", "stripe_active_attempt_id": None},
        projection={"_id": 0})
    if not order:
        return
    # Claim next, so a retry with this key starts a new order (new refs).
    await db.shop_checkout_claims.delete_one({"idempotency_key": idempotency_key, "shop_order_id": order_id})
    await _pull_holds(order)


async def _fail_unsent_attempt(attempt: dict) -> None:
    """An attempt that never got a Stripe page (a crash between recording it
    and creating the page): nothing can be paid, so let go."""
    db = _g("db")
    done = await db.shop_payment_attempts.find_one_and_update(
        {"id": attempt["id"], "status": "pending", "stripe_checkout_session_id": None},
        {"$set": {"status": "failed", "updated_at": _g("now_iso")()}})
    if done is None:
        return
    await _g("_release_shop_order_reservation_if_owned")(attempt["shop_order_id"], attempt["id"])
    await _g("_release_shop_order_inventory")(attempt["shop_order_id"])
    await db.shop_orders.update_one(
        {"id": attempt["shop_order_id"], "status": "pending_payment"},
        {"$set": {"status": "payment_failed", "updated_at": _g("now_iso")()}})


def _other_stripe_mode(sid: str) -> bool:
    """A cs_test_ page under a live key can never carry money — left over
    from before the account went live. One-way on purpose: a cs_live_ page
    is hosted by Stripe and can still be paid whatever key this app holds
    (say prod is briefly on a test key), so it is retried later, never
    released on a missing-resource answer."""
    key = _g("STRIPE_SECRET_KEY") or ""
    return sid.startswith("cs_test_") and "_live_" in key


async def settle_attempt(attempt: dict, *, expire_now: bool = False) -> str:
    """Ask Stripe what became of one pending checkout and act on it.

    Returns "paid", "released", "waiting" (a bank payment still processing, or
    a page still open) or "skipped". `expire_now` closes a still-open page
    first — the buyer came back through the cancel link. Raises if Stripe
    cannot be reached; callers decide what that means."""
    if attempt.get("status") != "pending":
        return "skipped"
    sid = attempt.get("stripe_checkout_session_id")
    if not sid:
        await _fail_unsent_attempt(attempt)
        return "released"
    stripe = _g("stripe")
    session: Dict[str, Any] = {}
    if expire_now:
        try:
            session = await _stripe_call(stripe.checkout.Session.expire, sid)
        except Exception:
            session = {}   # not open any more (paid, expired, completed) — read it instead
    if not session:
        try:
            session = await _stripe_call(stripe.checkout.Session.retrieve, sid)
        except Exception as exc:
            if getattr(exc, "code", None) == "resource_missing" and _other_stripe_mode(sid):
                await _g("_handle_shop_checkout_session_expired_event")({"id": sid})
                return "released"
            raise
        if session.get("status") == "open" and not expire_now:
            expires = attempt.get("expires_at") or ""
            if expires and expires < _iso(datetime.now(timezone.utc)):
                # Past its own expiry but Stripe has not closed it yet.
                try:
                    session = await _stripe_call(stripe.checkout.Session.expire, sid)
                except Exception:
                    pass
    if session.get("payment_status") == "paid":
        await _g("_verify_and_reconcile_shop_session")(attempt)
        return "paid"
    if session.get("status") == "expired":
        await _g("_handle_shop_checkout_session_expired_event")({**session, "id": sid})
        return "released"
    if session.get("status") == "complete" and session.get("payment_status") == "unpaid":
        # Complete + unpaid is a bank payment still processing — or one that
        # FAILED. Only the PaymentIntent tells them apart.
        pi = session.get("payment_intent")
        pi_id = pi.get("id") if isinstance(pi, dict) else pi
        if pi_id:
            intent = await _stripe_call(stripe.PaymentIntent.retrieve, pi_id)
            if intent.get("status") in ("requires_payment_method", "canceled"):
                await _g("_handle_shop_checkout_session_failed_event")({**session, "id": sid})
                return "released"
    return "waiting"


async def cancel_checkout(order: dict) -> dict:
    """The buyer backed out of Stripe: close the page and let go now.

    Safe to call more than once and whatever state the order is in — a paid
    order stays paid (a payment that already went through is applied, never
    cancelled). An attempt still being set up (no Stripe page yet) is left to
    the sweep: its request may be creating the page right now."""
    db = _g("db")
    attempts = await db.shop_payment_attempts.find(
        {"shop_order_id": order["id"], "status": "pending", "stripe_checkout_session_id": {"$ne": None}},
        {"_id": 0}).to_list(10)
    for attempt in attempts:
        try:
            await settle_attempt(attempt, expire_now=True)
        except Exception as exc:
            # Stripe unreachable: the sweep settles it later.
            _g("logger").warning("cancel_checkout could not settle attempt %s: %s", attempt.get("id"), exc)
    fresh = await db.shop_orders.find_one({"id": order["id"]}, {"_id": 0, "status": 1}) or {}
    return {"status": fresh.get("status")}


# ── Money that could not be recorded (audit #62) ──────────────────────────
#
# Owner decision 2026-09-28 (option B): the Shop takes card payments only (no
# bank transfers that clear days later), and any online Shop payment the app
# could not record — money that arrived after its order was cancelled, or a
# payment whose recording failed — is flagged for staff in Front Desk → Online
# payments ("Paid online, not recorded yet") and Action Required, with Retry
# and Refund, instead of being ignored. Rows carry kind "shop"; the list,
# the buttons and the count live in domains/billing/resolve.py.

STUCK_STATUSES = ("reconciliation_required", "refunding")


async def mark_paid_after_close(attempt: dict, session_obj: dict) -> None:
    """Stripe says paid, but this checkout was already written off (its order
    cancelled, its items back on sale). Never ignore the money: flag it."""
    db = _g("db")
    ts = _g("now_iso")()
    pi = session_obj.get("payment_intent")
    pi = pi.get("id") if isinstance(pi, dict) else pi
    done = await db.shop_payment_attempts.update_one(
        {"id": attempt["id"], "status": {"$in": list(DEAD_ATTEMPT_STATUSES)}},
        {"$set": {"status": "reconciliation_required", "paid_after_close": attempt.get("status"),
                  "stripe_payment_intent_id": pi or attempt.get("stripe_payment_intent_id"), "updated_at": ts}})
    if done.modified_count:
        await db.shop_orders.update_one(
            {"id": attempt["shop_order_id"]},
            {"$set": {"paid_after_cancel": {"at": ts, "attempt_id": attempt["id"],
                                            "amount_cents": int(session_obj.get("amount_total") or attempt.get("amount_cents") or 0)},
                      "updated_at": ts}})
        _g("logger").warning("Shop attempt %s was paid after being closed as %s — flagged for staff",
                             attempt["id"], attempt.get("status"))


async def _stripe_money_state(attempt: dict) -> dict:
    """What Stripe says happened to this payment: refunded already (from the
    Dashboard), disputed, or still there to refund."""
    stripe = _g("stripe")
    pi = attempt.get("stripe_payment_intent_id")
    if not pi and attempt.get("stripe_checkout_session_id"):
        session = await _stripe_call(stripe.checkout.Session.retrieve, attempt["stripe_checkout_session_id"])
        pi = session.get("payment_intent")
        pi = pi.get("id") if isinstance(pi, dict) else pi
        if pi:
            await _g("db").shop_payment_attempts.update_one({"id": attempt["id"]}, {"$set": {"stripe_payment_intent_id": pi}})
            attempt["stripe_payment_intent_id"] = pi
    if not pi:
        return {"payment_intent": None, "refunded_cents": 0, "disputed": False}
    intent = _as_dict(await asyncio.to_thread(lambda: stripe.PaymentIntent.retrieve(pi, expand=["latest_charge"])))
    charge = intent.get("latest_charge") if isinstance(intent.get("latest_charge"), dict) else {}
    return {"payment_intent": pi, "refunded_cents": int((charge or {}).get("amount_refunded") or 0),
            "disputed": bool((charge or {}).get("disputed"))}


async def _dispute(attempt: dict) -> Optional[str]:
    """"open" / "won" / "lost" for a dispute on this payment, else None."""
    pi = attempt.get("stripe_payment_intent_id")
    if not pi:
        return None
    d = await _g("db").stripe_disputes.find_one({"stripe_payment_intent_id": pi}, {"_id": 0, "status": 1})
    if not d:
        return None
    if d.get("status") == "warning_closed":   # an inquiry closed with no chargeback: the money stayed
        return "won"
    return d.get("status") if d.get("status") in ("won", "lost") else "open"


async def stuck_rows(limit: int = 100) -> list:
    """Shop payments waiting on staff, shaped like the bill rows."""
    db = _g("db")
    out = []
    for a in await db.shop_payment_attempts.find(
            {"status": {"$in": list(STUCK_STATUSES)}}, {"_id": 0}).sort("created_at", 1).to_list(limit):
        order = await db.shop_orders.find_one({"id": a.get("shop_order_id")}, {"_id": 0}) or {}
        amount = round(int(a.get("amount_cents") or 0) / 100.0, 2)
        retry = refund = close = False
        dispute = await _dispute(a)
        if dispute == "open":
            code, reason = ("dispute_open", "The customer disputed this charge with their bank. Wait for the bank's "
                            "decision (Disputes); nothing can be done here until then.")
        elif dispute == "lost":
            code, reason, close = ("dispute_lost", "The bank sided with the customer, so this money went back to them. "
                                   "Press Close.", True)
        elif a.get("status") == "refunding":
            code, reason, refund = "refunding", "A refund was started but not confirmed. Press Refund to finish it.", True
        elif order and order.get("shop_last_applied_attempt_id") == a.get("id"):
            code, reason, retry = ("partly_recorded", "Part of this payment was recorded on its order. Press Retry to "
                                   "finish it (refund it from the order afterwards if needed).", True)
        elif a.get("paid_after_close") or order.get("status") == "canceled" or not order:
            code, reason, refund = ("paid_after_cancel", "This payment arrived after the order was cancelled, and its "
                                    "items went back on sale. Refund it — if they still want the items, they can order again.", True)
        else:
            code, reason, retry, refund = ("ready", "This Shop payment wasn't recorded on its order. Press Retry — or "
                                           "Refund it.", True, True)
        number = (a.get("shop_order_id") or "")[:8].upper()
        out.append({
            "id": a["id"], "kind": "shop", "status": a.get("status"), "created_at": a.get("created_at"),
            "client_id": order.get("client_id"), "invoice_id": None, "shop_order_id": a.get("shop_order_id"),
            "client_name": order.get("client_name") or order.get("guest_name") or order.get("client_email") or "Shop customer",
            "amount": amount, "invoice_number": number, "order_number": number,
            "reason_code": code, "reason": reason, "can_retry": retry, "can_refund": refund, "can_close": close,
        })
    return out


async def stuck_count() -> int:
    return await _g("db").shop_payment_attempts.count_documents({"status": {"$in": list(STUCK_STATUSES)}})


async def find_stuck(attempt_id: str) -> Optional[dict]:
    return await _g("db").shop_payment_attempts.find_one({"id": attempt_id}, {"_id": 0})


async def retry_stuck(attempt: dict) -> dict:
    from fastapi import HTTPException
    if attempt.get("status") != "reconciliation_required":
        raise HTTPException(status_code=409, detail="This payment isn't waiting any more. Refresh the list.")
    if attempt.get("paid_after_close"):
        raise HTTPException(status_code=409, detail="This order was cancelled and its items went back on sale. Refund the payment.")
    session = await _stripe_call(_g("stripe").checkout.Session.retrieve, attempt["stripe_checkout_session_id"])
    if session.get("payment_status") != "paid":
        raise HTTPException(status_code=409, detail="Stripe doesn't show this payment as completed.")
    state = await _stripe_money_state(attempt)
    if state["refunded_cents"] > 0 or (state["disputed"] and await _dispute(attempt) != "won"):
        raise HTTPException(status_code=409, detail="Stripe shows this payment was refunded or is disputed, so it can't be recorded.")
    try:
        await _g("_apply_shop_payment")(attempt, session)
    except HTTPException as exc:
        raise HTTPException(status_code=409, detail=f"Still can't record it: {exc.detail}")
    return {"ok": True}


async def refund_stuck(attempt: dict, user: dict) -> dict:
    """Give the money back. Only for a payment none of which was recorded on
    its order (a recorded one is refunded from the order itself)."""
    from fastapi import HTTPException
    db = _g("db")
    stripe = _g("stripe")
    attempt_id = attempt["id"]
    if attempt.get("status") not in STUCK_STATUSES:
        raise HTTPException(status_code=409, detail="This payment isn't waiting any more. Refresh the list.")
    order = await db.shop_orders.find_one({"id": attempt.get("shop_order_id")}, {"_id": 0, "shop_last_applied_attempt_id": 1}) or {}
    if order.get("shop_last_applied_attempt_id") == attempt_id:
        raise HTTPException(status_code=409, detail="Part of this payment was already recorded. Use Retry to finish it.")
    state = await _stripe_money_state(attempt)
    pi = state["payment_intent"]
    if not pi:
        raise HTTPException(status_code=409, detail="Stripe has no completed payment to refund for this.")
    dispute = await _dispute(attempt)
    # Stripe keeps a charge marked "disputed" after the dispute ends; one that
    # ended our way (or was withdrawn) no longer stands in the way.
    if dispute in ("open", "lost") or (state["disputed"] and dispute != "won"):
        raise HTTPException(status_code=409, detail="This charge is disputed, so it can't be refunded. The bank's decision settles it (Disputes).")
    await db.shop_payment_attempts.update_one(
        {"id": attempt_id, "status": "reconciliation_required"}, {"$set": {"status": "refunding", "updated_at": _g("now_iso")()}})
    refund_id = None
    if state["refunded_cents"] < int(attempt.get("amount_cents") or 0):   # not already given back (the Dashboard)
        # One request per try: after a refund Stripe reported as failed, the
        # next press is a new refund, never a replay of the failed one.
        tries = int(attempt.get("refund_tries") or 0)
        try:
            refund = _as_dict(await asyncio.to_thread(lambda: stripe.Refund.create(
                payment_intent=pi, idempotency_key=f"shop_stuck_refund:{attempt_id}:{tries}",
                metadata={"sithappens_shop_stuck_attempt_id": attempt_id})))
        except Exception as exc:
            _g("logger").warning("Stuck Shop payment refund failed for %s: %s", attempt_id, exc)
            raise HTTPException(status_code=502, detail="Stripe couldn't refund this right now. Press Refund again in a minute.")
        if refund.get("status") in ("failed", "canceled"):
            await _reopen_stuck(attempt_id)
            raise HTTPException(status_code=502, detail="Stripe couldn't refund this payment. It's back in the list — try again or contact Stripe.")
        refund_id = refund.get("id")
    ts = _g("now_iso")()
    await db.shop_payment_attempts.update_one(
        {"id": attempt_id, "status": {"$in": list(STUCK_STATUSES)}},
        {"$set": {"status": "refunded", "stripe_refund_id": refund_id, "resolved_at": ts,
                  "resolved_by": user.get("name") or user.get("email") or user.get("id"), "updated_at": ts}})
    await db.shop_orders.update_one({"id": attempt.get("shop_order_id"), "paid_after_cancel.attempt_id": attempt_id},
                                    {"$set": {"paid_after_cancel.refunded_at": ts}})
    await _close_order_behind(attempt, ts)
    return {"ok": True, "refunded": True, "stripe_refund_id": refund_id}


async def _close_order_behind(attempt: dict, ts: str) -> None:
    """The money went back, so the order it was for is over: cancel it (if
    it never became paid) and put its items back on sale."""
    db = _g("db")
    oid = attempt.get("shop_order_id")
    closed = await db.shop_orders.update_one(
        {"id": oid, "status": {"$nin": ["paid", "canceled"]}, "shop_last_applied_attempt_id": None,
         "stripe_active_attempt_id": {"$in": [None, attempt["id"]]}},
        {"$set": {"status": "canceled", "updated_at": ts}})
    await _g("_release_shop_order_reservation_if_owned")(oid, attempt["id"])
    if closed.modified_count:
        await _g("_release_shop_order_inventory")(oid)


async def close_stuck(attempt: dict, user: dict) -> dict:
    """The bank decided a dispute for the customer: the money went back to
    them, so the payment is over."""
    from fastapi import HTTPException
    if attempt.get("status") not in STUCK_STATUSES:
        raise HTTPException(status_code=409, detail="This payment isn't waiting any more. Refresh the list.")
    if await _dispute(attempt) != "lost":
        raise HTTPException(status_code=409, detail="Close is only for a dispute the bank decided for the customer.")
    ts = _g("now_iso")()
    await _g("db").shop_payment_attempts.update_one(
        {"id": attempt["id"], "status": {"$in": list(STUCK_STATUSES)}},
        {"$set": {"status": "disputed", "resolved_at": ts, "updated_at": ts,
                  "resolved_by": user.get("name") or user.get("email") or user.get("id")}})
    await _close_order_behind(attempt, ts)
    return {"ok": True, "closed": True}


async def _reopen_stuck(attempt_id: str, refund_id: Optional[str] = None) -> None:
    """A refund that failed: back in the list, and the next press is a new try.
    A stale failure for an older try never reopens a later refund."""
    q: Dict[str, Any] = {"id": attempt_id, "status": {"$in": ["refunding", "refunded"]}}
    if refund_id:
        q["stripe_refund_id"] = {"$in": [None, refund_id]}
    await _g("db").shop_payment_attempts.update_one(
        q, {"$set": {"status": "reconciliation_required", "updated_at": _g("now_iso")()},
            "$unset": {"stripe_refund_id": ""}, "$inc": {"refund_tries": 1}})


async def on_stripe_refund(refund_obj: dict) -> bool:
    """Refund webhooks for these refunds (they carry our metadata). A refund
    that later fails puts the payment back in the list."""
    attempt_id = (refund_obj.get("metadata") or {}).get("sithappens_shop_stuck_attempt_id")
    if not attempt_id:
        return False
    if refund_obj.get("status") in ("failed", "canceled"):
        await _reopen_stuck(attempt_id, refund_obj.get("id"))
        _g("logger").warning("Stuck Shop payment refund %s for %s %s — back in the list",
                             refund_obj.get("id"), attempt_id, refund_obj.get("status"))
    return True


def register_abandon_routes(*, api, server_globals: dict) -> None:
    """POST /shop/orders/{id}/cancel-checkout — the signed-in buyer came back
    through Stripe's cancel link. (The guest twin lives in guest_routes,
    behind the order's token.)"""
    from fastapi import Depends, HTTPException

    get_current_user = server_globals["get_current_user"]

    @api.post("/shop/orders/{order_id}/cancel-checkout")
    async def cancel_shop_checkout(order_id: str, user: dict = Depends(get_current_user)):
        if user.get("role") != "client" or not user.get("client_id"):
            raise HTTPException(status_code=403, detail="Client account required")
        order = await server_globals["db"].shop_orders.find_one({"id": order_id}, {"_id": 0})
        if not order or order.get("is_guest_order") or order.get("client_id") != user.get("client_id"):
            raise HTTPException(status_code=404, detail="Order not found")
        return await cancel_checkout(order)


async def sweep(*, now: Optional[datetime] = None, limit: int = SWEEP_LIMIT,
                stripe_limit: int = STRIPE_SWEEP_LIMIT) -> Dict[str, int]:
    """Scheduler job: settle abandoned checkouts and repair stranded holds.

    Cheap when there is nothing to do; asks Stripe about any one attempt at
    most every RECHECK_MINUTES and about at most `stripe_limit` attempts per
    tick, so the web worker it runs in is never tied up."""
    db = _g("db")
    now = now or datetime.now(timezone.utc)
    now_s = _iso(now)
    stale_s = _iso(now - timedelta(minutes=UNSTARTED_STALE_MINUTES))
    recheck_s = _iso(now - timedelta(minutes=RECHECK_MINUTES))
    out = {"settled": 0, "released_unstarted": 0, "repaired_holds": 0, "errors": 0}

    # 1. Checkouts past their Stripe page's expiry — ask Stripe.
    due = await db.shop_payment_attempts.find(
        {"status": "pending", "stripe_checkout_session_id": {"$ne": None}, "expires_at": {"$lt": now_s, "$ne": None},
         "$or": [{"abandon_checked_at": None}, {"abandon_checked_at": {"$lt": recheck_s}}]},
        {"_id": 0}).sort("expires_at", 1).to_list(stripe_limit)
    for attempt in due:
        await db.shop_payment_attempts.update_one({"id": attempt["id"]}, {"$set": {"abandon_checked_at": now_s}})
        try:
            if await settle_attempt(attempt) in ("paid", "released"):
                out["settled"] += 1
        except Exception as exc:
            out["errors"] += 1
            _g("logger").info("abandoned-checkout sweep could not settle %s yet: %s", attempt.get("id"), exc)

    # 2. Attempts that never got a Stripe page, long ago.
    for attempt in await db.shop_payment_attempts.find(
            {"status": "pending", "stripe_checkout_session_id": None, "created_at": {"$lt": stale_s}},
            {"_id": 0}).to_list(limit):
        await _fail_unsent_attempt(attempt)
        out["released_unstarted"] += 1

    # 3. Orders nothing can pay any more, long ago: never reached Stripe, or
    #    every attempt is over (a crash between an attempt's final write and
    #    the order's). Filtered in the database, oldest first, so orders still
    #    waiting on a live attempt can never crowd these out.
    stranded = await db.shop_orders.aggregate([
        {"$match": {"status": "pending_payment", "created_at": {"$lt": stale_s}}},
        {"$sort": {"created_at": 1}},
        {"$lookup": {"from": "shop_payment_attempts", "localField": "id",
                     "foreignField": "shop_order_id", "as": "attempts"}},
        {"$match": {"attempts": {"$not": {"$elemMatch": {"status": {"$nin": list(DEAD_ATTEMPT_STATUSES)}}}}}},
        {"$limit": limit},
        {"$project": {"_id": 0, "id": 1, "attempt_ids": "$attempts.id"}},
    ]).to_list(limit)
    for order in stranded:
        # Close the order FIRST, and only if no live checkout holds its payment
        # slot: once closed, a resumed checkout can no longer start paying for
        # it; one that already did keeps its order and its holds.
        flipped = await db.shop_orders.update_one(
            {"id": order["id"], "status": "pending_payment",
             "stripe_active_attempt_id": {"$in": [None, *order.get("attempt_ids", [])]}},
            {"$set": {"status": "canceled", "updated_at": _g("now_iso")()}})
        if flipped.modified_count != 1:
            continue
        await _g("_release_shop_order_inventory")(order["id"])
        out["released_unstarted"] += 1

    # 4. Holds whose order is gone or already cancelled/failed (stranded by
    #    the old code, or by a crash between two writes).
    for product in await db.pos_products.find(
            {"shop_reservations": {"$elemMatch": {"state": "reserved"}}},
            {"_id": 0, "id": 1, "shop_reservations": 1}).to_list(500):
        for entry in product.get("shop_reservations") or []:
            if entry.get("state") != "reserved":
                continue
            order = await db.shop_orders.find_one({"id": entry.get("order_id")}, {"_id": 0, "status": 1})
            if order and order.get("status") not in ("canceled", "payment_failed"):
                continue   # live, paid (awaiting its commit) — or handled above
            if order:
                await _g("_release_shop_order_inventory")(entry["order_id"])
            else:
                await db.pos_products.update_one(
                    {"id": product["id"], "shop_reservations": {"$elemMatch": {"ref": entry.get("ref"), "state": "reserved"}}},
                    {"$inc": {"stock_reserved": -float(entry.get("quantity") or 0)},
                     "$set": {"shop_reservations.$.state": "released", "shop_reservations.$.updated_at": now_s,
                              "updated_at": now_s}})
            out["repaired_holds"] += 1
    return out
