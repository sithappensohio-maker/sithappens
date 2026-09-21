"""One checkout, two kinds of buyer.

Before this existed there was a single checkout that assumed a signed-in
client, and the obvious way to add guest checkout was to write a second one
beside it. That is the mistake this file avoids. A second orchestration
would have its own idempotency claim, its own reservation ordering, its own
Stripe failure cleanup — and the day somebody fixes a race in one of them,
the other quietly keeps the bug. Money paths must not come in pairs.

So the sequence lives here exactly once, and the only thing that varies is
the BUYER:

    a client  has an account. Prices can be theirs (grandfathered rates,
              overrides), entitlements have somewhere to land, and Stripe
              gets a real Customer so their cards accumulate in one place.

    a guest   has an email address and nothing else. They pay list price,
              they may only buy things that need no account (see
              domains.shop.guest), and Stripe is told the address without
              a Customer being created — we do not manufacture records for
              people who have not asked to be customers.

Everything else — claim-first idempotency, per-line eligibility, inventory
reservation, the attempt row, the Stripe session, the cleanup when Stripe
itself falls over — is identical, because it is the same code.

A note on the guest token. A guest has no session, so something has to
prove an order is theirs when they come back to look at it. That something
is a 256-bit token minted here and handed back once. The database stores
only its SHA-256, so a dump of shop_orders does not hand anybody else's
order over, and a comparison is done in constant time. Email is NOT proof
of ownership — knowing an address is not the same as being the person who
paid — so nothing in this file ever matches an order to a person by email.
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException
from pymongo.errors import DuplicateKeyError

from domains.shop import guest as shop_guest

_g = None  # server module globals, resolved live (see configure)


def configure(*, server_globals) -> None:
    global _g
    _g = server_globals


def _s(name):
    """One server-module global, read at CALL time.

    Not snapshotted at import: the test suite rebinds server.db per test
    loop, and a snapshot would pin a closed one.
    """
    return _g[name]


# ────────────────────────────────────────────────────────────── the buyer

@dataclass(frozen=True)
class Buyer:
    """Who is paying, reduced to what checkout actually needs to know."""
    client_id: Optional[str]       # None for a guest. Never a placeholder id.
    name: str
    email: str
    is_guest: bool
    doc: Optional[dict] = None     # the client document, for the client path
    # Guest only, and only for orders somebody has to come and collect.
    # Nothing is posted, so there is no shipping address to take; what the
    # desk needs is a name to call out and a number to ring if the order
    # sits there. A client already has both on their account.
    phone: str = ""

    @property
    def identity_key(self) -> str:
        """What makes this buyer's idempotency claims their own.

        A guest's key is derived from their email so that two guests who
        happen to submit identical carts still get separate claims, and so
        that no guest's claim can ever look like a signed-in client's.
        """
        if self.client_id:
            return self.client_id
        return "guest:" + hashlib.sha256(self.email.strip().lower().encode("utf-8")).hexdigest()


def client_buyer(client: dict) -> Buyer:
    return Buyer(
        client_id=client.get("id"),
        name=client.get("name") or "",
        email=client.get("email") or "",
        is_guest=False,
        doc=client,
    )


def clean_guest_name(name: str) -> str:
    """Tidy a name. Deliberately does NOT strip markup any more.

    It used to remove `<` and `>`, because the operator's new-order email
    interpolated this value into HTML without escaping it. That was the
    wrong place to fix it: it only covered guests (an account holder's name
    took the same path and was not cleaned), and it quietly mangled anybody
    actually called `John <Sam> Smith`. The renderer escapes on output now
    (email_service._h), so the name is stored as the person typed it and is
    made safe where it becomes markup.

    What remains has nothing to do with markup and is kept: collapse runs of
    whitespace so a name is one line, and cap the length so the field cannot
    be used to post a novel.
    """
    return " ".join((name or "").split())[:120]


def guest_buyer(*, email: str, name: str, phone: str = "") -> Buyer:
    """A buyer with no account. The name is cleaned HERE rather than at the
    route, so no future caller can create a guest buyer that skips it."""
    return Buyer(client_id=None, name=clean_guest_name(name),
                 email=(email or "").strip().lower(), is_guest=True, doc=None,
                 phone=clean_guest_name(phone)[:40])


# ────────────────────────────────────────────────────────── guest tokens

def mint_guest_token() -> tuple[str, str]:
    """A new token and the hash to store. The token is shown once."""
    token = secrets.token_urlsafe(32)
    return token, hash_guest_token(token)


def hash_guest_token(token: str) -> str:
    return hashlib.sha256((token or "").encode("utf-8")).hexdigest()


def guest_token_matches(order: dict, token: Optional[str]) -> bool:
    """Constant-time. A guest order with no stored hash matches nothing —
    an order that somehow lost its token is unreachable, not open."""
    stored = (order or {}).get("guest_token_hash")
    if not stored or not token:
        return False
    return hmac.compare_digest(str(stored), hash_guest_token(token))


# ──────────────────────────────────────────────────────── the one sequence

async def create_checkout(*, buyer: Buyer, items, idempotency_key: str) -> dict:
    """Price, reserve, and start paying for a cart. Returns
    {url, order_id, guest_token?}.

    Claim-first idempotency: an order id is claimed against the caller's
    idempotency key BEFORE anything is priced, so a retried request resumes
    the same order, the same reservation and the same Stripe session rather
    than charging twice.
    """
    db = _s("db")
    now_iso = _s("now_iso")
    stripe = _s("stripe")
    logger = _s("logger")

    _s("_require_stripe_online_enabled")()
    normalized_items = _s("_normalize_cart_lines")(items)

    fingerprint_items = [
        {"kind": it.kind, "ref_id": it.ref_id, "quantity": it.quantity, "dog_id": it.dog_id}
        for it in normalized_items
    ]
    fingerprint = _s("_request_fingerprint")(buyer.identity_key, fingerprint_items)
    order_id = str(uuid.uuid4())
    ts = now_iso()
    guest_token, guest_token_hash = mint_guest_token() if buyer.is_guest else (None, None)

    # ── claim ──
    try:
        await db.shop_checkout_claims.insert_one({
            "id": str(uuid.uuid4()), "idempotency_key": idempotency_key,
            "request_fingerprint": fingerprint,
            "client_id": buyer.client_id, "buyer_key": buyer.identity_key,
            "shop_order_id": order_id, "created_at": ts, "updated_at": ts,
        })
    except DuplicateKeyError:
        existing = await db.shop_checkout_claims.find_one({"idempotency_key": idempotency_key}, {"_id": 0})
        # buyer_key is checked as well as client_id because for a guest
        # client_id is None on BOTH sides: without it, one guest presenting
        # another guest's idempotency key would compare None to None, agree,
        # and be handed back a Stripe URL for a cart that is not theirs.
        # Claims written before buyer_key existed have client_id set (they
        # are all client claims) and fall back to that check alone.
        if (not existing
                or existing.get("client_id") != buyer.client_id
                or (existing.get("buyer_key") or buyer.identity_key) != buyer.identity_key
                or existing.get("request_fingerprint") != fingerprint):
            raise HTTPException(status_code=409, detail="This idempotency key was already used for a different request.")
        order_id = existing["shop_order_id"]

    order = await db.shop_orders.find_one({"id": order_id}, {"_id": 0})
    if not order:
        priced = await _s("_price_shop_cart")(normalized_items, client_id=buyer.client_id)
        if priced["total"] <= 0.005:
            raise HTTPException(status_code=400, detail="Cart total must be greater than zero.")

        await _check_every_line(buyer, priced["lines"])
        if buyer.is_guest and not buyer.name and any(
                l["kind"] == "product" for l in priced["lines"]):
            # Nothing is posted; merchandise is collected in person. Without
            # a name the desk has a paid order and no idea who to give it
            # to. Enforced here rather than only in the form, because the
            # form is not what decides.
            raise HTTPException(
                status_code=422,
                detail="Please add your name so we know who to hand your order to.")

        order_doc = {
            "id": order_id,
            # None, not a stand-in. Every downstream reader already uses
            # order.get("client_id"), and the accounting rows it writes
            # (Payment, retail_sales) have always allowed a sale with no
            # client — that is what a walk-in is.
            "client_id": buyer.client_id,
            "client_name": buyer.name, "client_email": buyer.email,
            "is_guest_order": buyer.is_guest,
            "client_phone": buyer.phone,
            "guest_token_hash": guest_token_hash,
            "status": "pending_payment", "fulfillment_status": "pending", "pickup_status": None,
            "lines": priced["lines"], "subtotal": priced["subtotal"], "tax_amount": priced["tax_amount"],
            "tax_rate_pct": priced["tax_rate_pct"], "total": priced["total"], "currency": "USD",
            "stripe_active_attempt_id": None, "stripe_reserved_amount_cents": None,
            "shop_last_applied_attempt_id": None,
            "admin_unseen": True,
            "created_at": ts, "updated_at": ts,
        }
        try:
            await db.shop_orders.insert_one(order_doc)
            order = order_doc
        except DuplicateKeyError:
            order = await db.shop_orders.find_one({"id": order_id}, {"_id": 0})
    elif buyer.is_guest:
        # Resuming a claim: the token was minted on the first attempt and is
        # the one already on the order. Handing back a fresh one would lock
        # the buyer out of the order they are about to pay for.
        guest_token = None

    if order.get("status") in ("payment_failed", "canceled"):
        raise HTTPException(status_code=409, detail="This order can no longer be paid — please start a new checkout.")
    # A resumed order must belong to the buyer in front of us. The claim
    # check above already proved that for the CLAIM; this proves it for the
    # ORDER, which is the thing that actually holds the money. They are not
    # the same statement: a claim row and the order it points at could come
    # apart through a bad migration, a hand-edit, or a bug nobody has written
    # yet, and this is the check that notices.
    if (bool(order.get("is_guest_order")) != buyer.is_guest
            or order.get("client_id") != buyer.client_id
            or (buyer.is_guest
                and (order.get("client_email") or "").strip().lower() != buyer.email.strip().lower())):
        raise HTTPException(status_code=409, detail="This idempotency key was already used for a different request.")

    for line in order["lines"]:
        await _s("_reserve_shop_inventory_line")(order, line)

    amount_cents = _s("_stripe_amount_cents")(order["total"])
    attempt_id = str(uuid.uuid4())
    try:
        await db.shop_payment_attempts.insert_one({
            "id": attempt_id, "idempotency_key": idempotency_key, "request_fingerprint": fingerprint,
            "shop_order_id": order_id, "client_id": buyer.client_id, "amount_cents": amount_cents,
            "status": "pending",
            "stripe_checkout_session_id": None, "stripe_checkout_session_url": None,
            "stripe_payment_intent_id": None, "stripe_customer_id": None,
            "card_brand": None, "card_last4": None, "applied_payment_id": None,
            "created_at": ts, "updated_at": ts, "expires_at": None,
        })
    except DuplicateKeyError:
        existing = await db.shop_payment_attempts.find_one({"idempotency_key": idempotency_key}, {"_id": 0})
        if not existing or existing.get("shop_order_id") != order_id:
            raise HTTPException(status_code=409, detail="This idempotency key was already used for a different request.")
        if existing.get("stripe_checkout_session_url"):
            return _result(existing["stripe_checkout_session_url"], order_id, guest_token)
        if existing.get("status") in _s("SHOP_PAYMENT_ATTEMPT_TERMINAL_STATUSES"):
            raise HTTPException(status_code=409, detail="This payment attempt has already been resolved.")
        attempt_id = existing["id"]

    reserved_order = await _s("_acquire_shop_order_reservation")(order_id, attempt_id, amount_cents)
    if reserved_order is None:
        current = await db.shop_orders.find_one({"id": order_id}, {"_id": 0, "stripe_active_attempt_id": 1})
        if not (current and current.get("stripe_active_attempt_id") == attempt_id):
            await db.shop_payment_attempts.delete_one({"id": attempt_id, "stripe_checkout_session_id": None})
            raise HTTPException(status_code=409, detail="This order already has an active online payment in progress.")

    expires_at = datetime.now(timezone.utc) + timedelta(seconds=_s("STRIPE_CHECKOUT_EXPIRES_SECONDS"))
    stripe_customer_id = (buyer.doc or {}).get("stripe_customer_id")
    try:
        if not buyer.is_guest and not stripe_customer_id:
            customer = stripe.Customer.create(
                name=buyer.name or None, email=buyer.email or None,
                metadata={"sithappens_client_id": buyer.client_id},
            )
            stripe_customer_id = customer["id"]
            await db.clients.update_one({"id": buyer.client_id}, {"$set": {"stripe_customer_id": stripe_customer_id}})

        line_items = [{
            "price_data": {
                "currency": "usd", "product_data": {"name": l["name"]},
                "unit_amount": _s("_stripe_amount_cents")(l["unit_price"]),
            },
            "quantity": l["quantity"],
        } for l in order["lines"]]
        if order.get("tax_amount"):
            line_items.append({
                "price_data": {
                    "currency": "usd", "product_data": {"name": "Sales tax"},
                    "unit_amount": _s("_stripe_amount_cents")(order["tax_amount"]),
                },
                "quantity": 1,
            })

        session_kwargs = dict(
            mode="payment",
            line_items=line_items,
            success_url=_success_url(order_id, buyer, guest_token, order),
            cancel_url=_cancel_url(order_id, buyer, guest_token, order),
            expires_at=int(expires_at.timestamp()),
            metadata={
                "sithappens_attempt_id": attempt_id, "sithappens_shop_order_id": order_id,
                "sithappens_client_id": buyer.client_id or "",
                "sithappens_guest_order": "1" if buyer.is_guest else "0",
            },
            idempotency_key=f"shop_attempt_create:{attempt_id}",
        )
        if buyer.is_guest:
            # Stripe is told where to send its own receipt, but no Customer
            # is created: a guest has not asked to become one, and a stray
            # Customer per guest checkout is a mess nobody can clean up.
            session_kwargs["customer_email"] = buyer.email or None
        else:
            session_kwargs["customer"] = stripe_customer_id
        session = stripe.checkout.Session.create(**session_kwargs)
    except Exception as exc:
        await db.shop_payment_attempts.update_one({"id": attempt_id}, {"$set": {"status": "failed", "updated_at": now_iso()}})
        await _s("_release_shop_order_reservation_if_owned")(order_id, attempt_id)
        await db.shop_orders.update_one(
            {"id": order_id, "status": {"$ne": "paid"}},
            {"$set": {"status": "payment_failed", "updated_at": now_iso()}},
        )
        await _s("_release_shop_order_inventory")(order_id)
        logger.warning("Stripe Checkout Session creation failed for shop attempt %s: %s", attempt_id, exc)
        raise HTTPException(status_code=502, detail="Could not start the online payment — please try again.")

    await db.shop_payment_attempts.update_one(
        {"id": attempt_id},
        {"$set": {
            "stripe_checkout_session_id": session["id"], "stripe_checkout_session_url": session["url"],
            "stripe_customer_id": stripe_customer_id, "expires_at": expires_at.isoformat(), "updated_at": now_iso(),
        }},
    )
    return _result(session["url"], order_id, guest_token)


def _result(url: str, order_id: str, guest_token: Optional[str]) -> dict:
    out = {"url": url, "order_id": order_id}
    if guest_token:
        out["guest_token"] = guest_token
    return out


def _success_url(order_id: str, buyer: Buyer, guest_token: Optional[str], order: dict) -> str:
    base = _s("_app_public_url")()
    if not buyer.is_guest:
        return f"{base}/portal?shop_order={order_id}&stripe=success"
    # The token goes in the URL because the guest has nowhere else to keep
    # it across a redirect from Stripe. It is single-order scoped and grants
    # read-only status — not an account, not a session.
    suffix = f"&token={guest_token}" if guest_token else ""
    return f"{base}/shop/order/{order_id}?stripe=success{suffix}"


def _cancel_url(order_id: str, buyer: Buyer, guest_token: Optional[str], order: dict) -> str:
    base = _s("_app_public_url")()
    if not buyer.is_guest:
        return f"{base}/portal?shop_order={order_id}&stripe=cancel"
    suffix = f"&token={guest_token}" if guest_token else ""
    return f"{base}/shop/order/{order_id}?stripe=cancel{suffix}"


async def public_prices_enabled() -> bool:
    """Whether the storefront shows prices to people who are not signed in.
    One settings read, shared by the cart preview and by checkout, so both
    judge an item by the same standard."""
    settings = await _s("get_settings")()
    return bool(((settings or {}).get("shop_page") or {}).get("show_public_prices", True))


async def _check_every_line(buyer: Buyer, lines) -> None:
    """The gate, run once per line, immediately before an order exists.

    A rejection here means no order row is ever written — the idempotency
    claim is the only trace, and the same key can be retried once whatever
    was wrong is fixed.
    """
    db = _s("db")
    collection_for = _s("_SHOP_ITEM_COLLECTION_NAME")
    show_prices = await public_prices_enabled() if buyer.is_guest else True
    for line in lines:
        kind = line["kind"]
        item_doc = None
        if kind in collection_for:
            item_doc = await db[collection_for[kind]].find_one({"id": line["ref_id"]}, {"_id": 0})

        if buyer.is_guest:
            # FIRST, always. Everything below this point assumes an account
            # exists somewhere to attach things to; this is the check that
            # makes that assumption true. A gift card has no catalog row, so
            # it is judged on its kind alone — which is the whole rule for
            # it anyway.
            # Price visibility is resolved for real, not assumed. A product
            # whose price guests are not shown must not become visible by
            # the back door of a Stripe page listing it.
            price_visible = show_prices and bool((item_doc or {}).get("show_public_price", True))
            reason = shop_guest.guest_block_reason(
                kind, item_doc if kind in collection_for else {}, price_visible=price_visible)
            if reason:
                raise HTTPException(status_code=403, detail=reason)

        if kind == "gift_card":
            continue  # no catalog row, no stock, no eligibility to check
        # Passing {} for the client is safe ONLY because the guest gate
        # above has already refused every kind and every flag whose check
        # reads the client: credit packs, training programs, requires_dog,
        # requires_approval and requires_completed_onboarding are all
        # account-bound and never reach here on the guest path.
        client_for_gate = buyer.doc if not buyer.is_guest else {}
        await _s("_validate_shop_item_eligibility")(
            client_for_gate, kind, item_doc, int(line["quantity"]), dog_id=line.get("dog_id"))
