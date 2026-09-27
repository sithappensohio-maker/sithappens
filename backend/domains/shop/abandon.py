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
