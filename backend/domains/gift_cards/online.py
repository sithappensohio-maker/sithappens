"""Customers topping up their own gift card, online, with a card payment.

The counter version of this is a register sale: the money and the balance
move together, in one place, with somebody watching. Online there is nobody
watching, the browser cannot be trusted, and Stripe will deliver the same
event more than once. So the shape here is the one the Shop already uses and
which this codebase has settled on:

  * the browser NEVER grants anything — it only starts a Checkout Session;
  * money is applied only from a signature-verified webhook event;
  * applying is broken into steps, each with its OWN durable marker, so the
    whole thing can be re-driven after a crash between any two of them and
    lands in exactly the same place.

The accounting is identical to a counter top-up, because it is the same
event: cash in, revenue recognised now, liability up, no sales tax. The only
difference is `payment_method: "stripe_online"`, so it reports as online
money rather than money in the till — which is true, and is why the drawer
must not move.
"""
from __future__ import annotations

import time
import uuid
from typing import Any, Dict, Optional

from fastapi import HTTPException
from pydantic import BaseModel, Field

from domains.gift_cards import services

_db = None
_stripe = None
_now_iso_fn = None
_business_today_fn = None
_logger = None
_amount_cents = None
_public_url = None
_expires_seconds = 30 * 60
_email_service = None

# A top-up that was started and never paid is not a problem — it is somebody
# closing the tab. These are the states where we stop caring about it.
TERMINAL = ("applied", "failed", "expired")


def configure(*, db, stripe_mod, now_iso, business_today, logger,
              amount_cents, public_url, expires_seconds, email_service=None) -> None:
    global _db, _stripe, _now_iso_fn, _business_today_fn, _logger
    global _amount_cents, _public_url, _expires_seconds, _email_service
    _email_service = email_service
    _db = db
    _stripe = stripe_mod
    _now_iso_fn = now_iso
    _business_today_fn = business_today
    _logger = logger
    _amount_cents = amount_cents
    _public_url = public_url
    _expires_seconds = expires_seconds


class GiftCardTopupSessionIn(BaseModel):
    amount: float = Field(gt=0, le=services.MAX_AMOUNT)
    idempotency_key: str = Field(min_length=8, max_length=128)


class GiftCardPurchaseIn(BaseModel):
    """Buying a brand new digital card as a present.

    The email address is required and is the whole point: there is no plastic
    to hand over, so if the code cannot reach anybody the card is worthless.
    """
    amount: float = Field(ge=services.MIN_AMOUNT, le=services.MAX_AMOUNT)
    recipient_email: str = Field(min_length=3, max_length=200)
    recipient_name: str = Field(default="", max_length=120)
    message: str = Field(default="", max_length=300)
    idempotency_key: str = Field(min_length=8, max_length=128)


async def email_card(card: dict) -> bool:
    """The digital card itself. For the recipient this email IS the card, so
    the code is the loudest thing in it and the balance is right beside it."""
    if _email_service is None:
        return False
    code = services._display(card.get("code") or "")
    amount = services._money(card.get("initial_amount") or card.get("balance"))
    who = (card.get("recipient_name") or "").strip()
    note = (card.get("note") or "").strip()
    body = (
        f'<p style="margin:0 0 14px">{"Hi " + _esc(who) + "," if who else "Hello,"}</p>'
        f'<p style="margin:0 0 18px">Somebody bought you a gift card.</p>'
        f'<div style="border:2px solid #8cc63f;border-radius:10px;padding:18px;text-align:center">'
        f'<div style="font-size:11px;letter-spacing:.22em;text-transform:uppercase;'
        f'color:#8cc63f;font-weight:800">Your code</div>'
        f'<div style="font-size:26px;font-weight:800;letter-spacing:.14em;'
        f'font-family:Courier New,monospace;margin-top:6px">{_esc(code)}</div>'
        f'<div style="font-size:20px;font-weight:800;margin-top:10px">${amount:.2f}</div>'
        f'</div>'
        + (f'<p style="margin:18px 0 0;font-style:italic">“{_esc(note)}”</p>' if note else "")
        + '<p style="margin:18px 0 0">Bring the code in, or read it to us over the phone. '
          'It can be spent on anything we sell and does not expire.</p>'
    )
    return await _email_service._dispatch(
        slug="gift_card_delivered",
        to_email=card.get("recipient_email") or "",
        ctx={"first_name": who, "code": code, "amount": f"{amount:.2f}"},
        rows=[],
        fallback_subject=f"Your gift card · {code}",
        fallback_title="A gift card for you",
        fallback_intro="",
        body_html=body,
        outbox_key=f"gift_card_delivered:{card.get('id')}",
    )


def _esc(v):
    return (str(v or "").replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


def portal_view(card: dict) -> dict:
    """What a customer may see about a card they typed the code for.

    Balance and whether it is usable — nothing else. Not who it was bought
    for, not the note, not its history: somebody holding a code is not
    necessarily the person it was bought for, and the balance is the only
    thing they need to decide whether to top it up.
    """
    return {
        "code_display": services._display(card.get("code") or ""),
        "balance": services._money(card.get("balance")),
        "status": card.get("status"),
        "can_top_up": (card.get("status") or "") in ("active", "spent"),
    }


async def start_topup(*, code: str, body: GiftCardTopupSessionIn, user: dict) -> dict:
    """Begin a top-up. Grants nothing — it only hands back a Stripe URL."""
    card = await services.find_by_code(code)
    amount = services._money(body.amount)
    # The same rule the counter uses, checked before anybody is sent to a
    # payment page for a card that cannot take the money.
    services.assert_toppable(card, amount)

    attempt_id = str(uuid.uuid4())
    ts = _now_iso_fn()
    await _db.gift_card_topup_attempts.insert_one({
        "id": attempt_id,
        "idempotency_key": body.idempotency_key,
        "gift_card_id": card["id"],
        "code": card["code"],
        "amount_cents": _amount_cents(amount),
        "client_id": user.get("client_id"),
        "created_by": user.get("id"),
        "status": "pending",
        "created_at": ts,
        "updated_at": ts,
    })

    try:
        session = _stripe.checkout.Session.create(
            mode="payment",
            line_items=[{
                "price_data": {
                    "currency": "usd",
                    "product_data": {"name": f"Gift card top-up · {services._display(card['code'])}"},
                    "unit_amount": _amount_cents(amount),
                },
                "quantity": 1,
            }],
            success_url=f"{_public_url()}/portal?gift_card_topup={attempt_id}&stripe=success",
            cancel_url=f"{_public_url()}/portal?gift_card_topup={attempt_id}&stripe=cancel",
            expires_at=int(time.time()) + _expires_seconds,
            metadata={
                "sithappens_gift_card_topup_id": attempt_id,
                "sithappens_gift_card_id": card["id"],
            },
            idempotency_key=f"gift_card_topup_create:{attempt_id}",
        )
    except Exception as exc:
        await _db.gift_card_topup_attempts.update_one(
            {"id": attempt_id}, {"$set": {"status": "failed", "updated_at": _now_iso_fn()}})
        _logger.warning("Stripe session creation failed for gift card top-up %s: %s", attempt_id, exc)
        raise HTTPException(status_code=502,
                            detail="Could not start the payment — please try again.")

    await _db.gift_card_topup_attempts.update_one(
        {"id": attempt_id},
        {"$set": {"stripe_checkout_session_id": session["id"],
                  "checkout_url": session.get("url"),
                  "updated_at": _now_iso_fn()}})
    return {"ok": True, "attempt_id": attempt_id, "checkout_url": session.get("url"),
            "amount": amount, "card": portal_view(card)}


async def start_purchase(*, body: GiftCardPurchaseIn, user: dict) -> dict:
    """Begin buying a digital card. Mints nothing — only a Stripe URL."""
    amount = services._money(body.amount)
    if "@" not in body.recipient_email:
        raise HTTPException(status_code=400, detail="Enter a real email address to send it to.")

    attempt_id = str(uuid.uuid4())
    # The card's id is decided NOW, before any money moves, so that however
    # many times the webhook is delivered there is only ever one card.
    card_id = str(uuid.uuid4())
    ts = _now_iso_fn()
    await _db.gift_card_topup_attempts.insert_one({
        "id": attempt_id,
        "kind": "purchase",
        "idempotency_key": body.idempotency_key,
        "card_id": card_id,
        "amount_cents": _amount_cents(amount),
        "recipient_email": body.recipient_email.strip().lower(),
        "recipient_name": (body.recipient_name or "").strip(),
        "message": (body.message or "").strip(),
        "client_id": user.get("client_id"),
        "created_by": user.get("id"),
        "business_date": _business_today_fn().isoformat(),
        "status": "pending",
        "created_at": ts, "updated_at": ts,
    })

    try:
        session = _stripe.checkout.Session.create(
            mode="payment",
            line_items=[{
                "price_data": {
                    "currency": "usd",
                    "product_data": {"name": f"Gift card · ${amount:.2f}"},
                    "unit_amount": _amount_cents(amount),
                },
                "quantity": 1,
            }],
            success_url=f"{_public_url()}/portal?gift_card_purchase={attempt_id}&stripe=success",
            cancel_url=f"{_public_url()}/portal?gift_card_purchase={attempt_id}&stripe=cancel",
            expires_at=int(time.time()) + _expires_seconds,
            metadata={"sithappens_gift_card_topup_id": attempt_id,
                      "sithappens_gift_card_kind": "purchase"},
            idempotency_key=f"gift_card_purchase_create:{attempt_id}",
        )
    except Exception as exc:
        await _db.gift_card_topup_attempts.update_one(
            {"id": attempt_id}, {"$set": {"status": "failed", "updated_at": _now_iso_fn()}})
        _logger.warning("Stripe session creation failed for gift card purchase %s: %s",
                        attempt_id, exc)
        raise HTTPException(status_code=502,
                            detail="Could not start the payment — please try again.")

    await _db.gift_card_topup_attempts.update_one(
        {"id": attempt_id},
        {"$set": {"stripe_checkout_session_id": session["id"],
                  "checkout_url": session.get("url"), "updated_at": _now_iso_fn()}})
    return {"ok": True, "attempt_id": attempt_id, "checkout_url": session.get("url"),
            "amount": amount}


async def apply_purchase(attempt: dict, session_obj: Optional[dict] = None) -> None:
    """Mint the bought card, book it, and email it. Replay-safe throughout.

    The card's id was fixed when the attempt was created, so "has this
    already been minted?" is a lookup rather than a guess, and the unique
    index means two deliveries racing cannot both create it.
    """
    attempt_id = attempt["id"]
    amount = services._money(attempt["amount_cents"] / 100.0)
    card_id = attempt["card_id"]
    ts = _now_iso_fn()

    card = await _db.gift_cards.find_one({"id": card_id}, {"_id": 0})
    if card is None:
        try:
            card = await services.mint_card(
                amount=amount, actor={"id": attempt.get("created_by"), "name": "Online"},
                recipient_name=attempt.get("recipient_name") or "",
                recipient_email=attempt.get("recipient_email") or "",
                note=(attempt.get("message") or "Bought online"),
                client_id=attempt.get("client_id"), origin="digital", card_id=card_id)
        except Exception:
            # Lost the race to another delivery — it minted it, we read it.
            card = await _db.gift_cards.find_one({"id": card_id}, {"_id": 0})
            if card is None:
                raise

    await _db.retail_sales.update_one(
        {"id": f"gcbuy-{attempt_id}"},
        {"$setOnInsert": {
            "id": f"gcbuy-{attempt_id}",
            "date": attempt.get("business_date") or _business_today_fn().isoformat(),
            "amount": amount, "payment_method": "stripe_online",
            "client_id": attempt.get("client_id"), "client_name": "",
            "gift_card_id": card_id, "source_kind": "gift_card_sale",
            "tax_amount": 0.0, "pre_tax_amount": amount, "tax_rate_pct": 0.0,
            "description": f"Gift card {services._display(card['code'])} · bought online",
            "category": "Gift Cards", "created_at": ts, "logged_by": "Online purchase",
        }},
        upsert=True,
    )

    # Its own claim, so a repeat delivery does not send the code twice.
    await services.send_card_email(card)

    await _db.gift_card_topup_attempts.update_one(
        {"id": attempt_id, "status": {"$nin": list(TERMINAL)}},
        {"$set": {"status": "applied", "gift_card_id": card_id,
                  "applied_at": ts, "updated_at": ts}})


async def apply_topup(attempt: dict, session_obj: Optional[dict] = None) -> None:
    """Put the money on the card. Safe to call repeatedly for one attempt.

    Four steps, four independent markers. A crash between any two of them is
    fixed by calling this again: each step asks "have I already done this for
    THIS attempt?" rather than trusting where the last one got to.
    """
    attempt_id = attempt["id"]
    amount = services._money(attempt["amount_cents"] / 100.0)
    card_id = attempt["gift_card_id"]
    ts = _now_iso_fn()

    # ── Step A — the balance. $inc rather than read-then-write, so two
    # deliveries racing cannot both read the old balance; and the
    # applied-attempts list makes a replay a no-op. ──
    moved = await _db.gift_cards.find_one_and_update(
        {"id": card_id,
         "topup_attempts_applied": {"$ne": attempt_id},
         "status": {"$in": ["active", "spent"]}},
        {"$inc": {"balance": amount},
         "$addToSet": {"topup_attempts_applied": attempt_id},
         "$set": {"status": "active", "last_topped_up_at": ts}},
    )
    card = await _db.gift_cards.find_one({"id": card_id}, {"_id": 0})
    if card is None:
        raise HTTPException(status_code=500, detail="Gift card missing during top-up apply")

    # ── Step B — the revenue row, under an id derived from the attempt so a
    # replay updates nothing instead of booking the income twice. ──
    await _db.retail_sales.update_one(
        {"id": f"gctopup-{attempt_id}"},
        {"$setOnInsert": {
            "id": f"gctopup-{attempt_id}",
            "date": attempt.get("business_date") or _business_today_fn().isoformat(),
            "amount": amount,
            "payment_method": "stripe_online",
            "client_id": attempt.get("client_id"),
            "client_name": "",
            "gift_card_id": card_id,
            "source_kind": "gift_card_sale",
            "tax_amount": 0.0, "pre_tax_amount": amount, "tax_rate_pct": 0.0,
            "description": f"Gift card top-up {services._display(attempt['code'])} · online",
            "category": "Gift Cards",
            "created_at": ts,
            "logged_by": "Online top-up",
        }},
        upsert=True,
    )

    # ── Step C — the card's own history, same trick. ──
    await _db.gift_card_transactions.update_one(
        {"id": f"gctopup-{attempt_id}"},
        {"$setOnInsert": {
            "id": f"gctopup-{attempt_id}",
            "gift_card_id": card_id,
            "kind": "topup",
            "amount": amount,
            "balance_after": services._money(card.get("balance")),
            "note": "Topped up online by the customer",
            "actor_id": attempt.get("created_by"),
            "actor_name": "Online",
            "created_at": ts,
        }},
        upsert=True,
    )

    # ── Step D — close the attempt. Last, because it is the least important:
    # the money is already right by here. ──
    await _db.gift_card_topup_attempts.update_one(
        {"id": attempt_id, "status": {"$nin": list(TERMINAL)}},
        {"$set": {"status": "applied", "applied_at": ts, "updated_at": ts}})
    if moved is None:
        _logger.info("Gift card top-up %s re-driven; balance already applied", attempt_id)


async def _attempt_for(session_obj: dict) -> Optional[dict]:
    return await _db.gift_card_topup_attempts.find_one(
        {"stripe_checkout_session_id": session_obj.get("id")}, {"_id": 0})


async def handle_paid(session_obj: dict) -> None:
    attempt = await _attempt_for(session_obj)
    if not attempt:
        return
    if session_obj.get("payment_status") != "paid":
        return  # completed but not actually paid yet — a later event will say
    if attempt.get("status") == "applied":
        return  # already credited; applying again would be a no-op anyway
    if attempt.get("status") in TERMINAL:
        # Paid, but we had already written this attempt off as failed or
        # expired. Stripe should not do that, so something is wrong — and
        # silently ignoring it would mean a customer paid and got nothing.
        # Flag it for a human instead of guessing in either direction.
        await _db.gift_card_topup_attempts.update_one(
            {"id": attempt["id"]},
            {"$set": {"status": "reconciliation_required", "updated_at": _now_iso_fn()}})
        _logger.warning("Gift card attempt %s was paid after being closed as %s",
                        attempt["id"], attempt.get("status"))
        return
    # The amount Stripe actually collected is the authority, not what we
    # stored when the session was created.
    paid_cents = session_obj.get("amount_total")
    if paid_cents is not None and int(paid_cents) != int(attempt["amount_cents"]):
        await _db.gift_card_topup_attempts.update_one(
            {"id": attempt["id"]},
            {"$set": {"status": "reconciliation_required",
                      "stripe_amount_total": int(paid_cents),
                      "updated_at": _now_iso_fn()}})
        _logger.warning("Gift card top-up %s paid %s but expected %s — not applied",
                        attempt["id"], paid_cents, attempt["amount_cents"])
        return
    intent = session_obj.get("payment_intent")
    if intent and not attempt.get("stripe_payment_intent_id"):
        await _db.gift_card_topup_attempts.update_one(
            {"id": attempt["id"]}, {"$set": {"stripe_payment_intent_id": intent}})
    try:
        if attempt.get("kind") == "purchase":
            await apply_purchase(attempt, session_obj)
        else:
            await apply_topup(attempt, session_obj)
    except HTTPException:
        await _db.gift_card_topup_attempts.update_one(
            {"id": attempt["id"], "status": {"$nin": list(TERMINAL)}},
            {"$set": {"status": "reconciliation_required", "updated_at": _now_iso_fn()}})
        raise  # non-2xx so Stripe retries — applying is idempotent, so that is safe


async def _close_unpaid(session_obj: dict, status: str) -> None:
    attempt = await _attempt_for(session_obj)
    if not attempt or attempt.get("status") != "pending":
        return
    # Monotonic: a stale failure can arrive after the paid event, and nothing
    # may take money back off a card because of it.
    await _db.gift_card_topup_attempts.update_one(
        {"id": attempt["id"], "status": "pending"},
        {"$set": {"status": status, "updated_at": _now_iso_fn()}})


async def handle_failed(session_obj: dict) -> None:
    await _close_unpaid(session_obj, "failed")


async def handle_expired(session_obj: dict) -> None:
    await _close_unpaid(session_obj, "expired")


async def handle_event(event_type: str, session_obj: dict) -> None:
    """Everything the webhook needs to know about gift cards, in one door, so
    server.py's dispatcher grows by a branch rather than by a flow."""
    if event_type in ("checkout.session.completed", "checkout.session.async_payment_succeeded"):
        await handle_paid(session_obj)
    elif event_type == "checkout.session.async_payment_failed":
        await handle_failed(session_obj)
    elif event_type == "checkout.session.expired":
        await handle_expired(session_obj)


async def attempt_status(attempt_id: str, user: dict) -> Dict[str, Any]:
    """So the page the customer lands back on can say what happened without
    trusting the query string it was handed."""
    a = await _db.gift_card_topup_attempts.find_one({"id": attempt_id}, {"_id": 0})
    if not a or (a.get("client_id") and a.get("client_id") != user.get("client_id")):
        raise HTTPException(status_code=404, detail="Top-up not found")
    card = await _db.gift_cards.find_one(
        {"id": a.get("gift_card_id") or a.get("card_id")}, {"_id": 0})
    return {
        "status": a.get("status"),
        "amount": services._money(a["amount_cents"] / 100.0),
        "card": portal_view(card) if card else None,
    }
