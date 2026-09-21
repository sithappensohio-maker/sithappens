"""Buying without an account.

Three routes, and between them they hold one line: the server decides
everything that costs money. The browser sends what is in the basket and an
email address to send the card to. It does not send prices, totals, tax,
titles, stock, or any statement about what it is allowed to buy — all of
that is looked up here, from the database, every time.

  POST /public/shop/cart/price   what this basket actually costs, and which
                                 of it a guest is allowed to have. Pure
                                 read: nothing is reserved or charged.
  POST /public/shop/checkout     the real thing. Same engine the signed-in
                                 checkout uses (domains.shop.checkout).
  GET  /public/shop/orders/{id}  how it went — for somebody holding the
                                 token that checkout minted, and nobody
                                 else.

The preview and the checkout ask the SAME function whether a guest may buy
a line (domains.shop.guest). That matters more than it looks: the preview
is what the page believes, the checkout is what actually happens, and a
storefront where those two disagree either blocks sales it should allow or
offers sales it cannot complete.
"""
from __future__ import annotations

from typing import List

from fastapi import HTTPException, Request
from pydantic import BaseModel, EmailStr, Field

from domains.shop import checkout as shop_checkout
from domains.shop import orders as shop_orders_view
from domains.shop import guest as shop_guest
from domains.shop.cart import ShopCartItemIn, _normalize_cart_lines


class GuestCartIn(BaseModel):
    items: List[ShopCartItemIn] = Field(min_length=1, max_length=40)


class GuestCheckoutIn(BaseModel):
    items: List[ShopCartItemIn] = Field(min_length=1, max_length=40)
    idempotency_key: str = Field(min_length=8, max_length=128)
    # Where the receipt, and any gift card, goes. This is the ONLY thing a
    # guest tells us about themselves, and it is not treated as identity:
    # it does not create an account, it does not match them to an existing
    # one, and it does not give them access to anything.
    email: EmailStr
    # Required in practice for anything collected in person — see
    # checkout.create_checkout, which refuses a merchandise order with no
    # name because the desk would have nobody to hand it to.
    name: str = Field(default="", max_length=120)
    # Optional, always. Useful when a collection order sits uncollected;
    # never required, and never used to look anybody up.
    phone: str = Field(default="", max_length=40)


def register_guest_shop_routes(*, api, server_globals: dict) -> None:
    def _s(name):
        return server_globals[name]

    async def _guest_shop_open() -> None:
        """Guest buying rides on the public storefront being open at all.
        There is no second switch: a shop nobody can browse is not a shop
        strangers can buy from."""
        await _s("_public_shop_settings_or_404")()

    async def _limit(request: Request, key: str, *, limit: int, window: int) -> None:
        await _s("_enforce_rate_limit")(
            request, key, _s("_client_ip")(request), limit=limit, window_seconds=window)

    async def _priced_guest_cart(items) -> dict:
        """Price a basket AS A GUEST, refusing anything a guest may not buy.

        Order matters: eligibility is decided before pricing, so a product
        whose price is hidden from guests is never priced here — otherwise
        this endpoint would be a way to read exactly the number the setting
        exists to hide.
        """
        db = _s("db")
        normalized = _normalize_cart_lines(items)
        collection_for = _s("_SHOP_ITEM_COLLECTION_NAME")
        show_prices = await shop_checkout.public_prices_enabled()

        blocked = []
        for it in normalized:
            item_doc = None
            if it.kind in collection_for:
                item_doc = await db[collection_for[it.kind]].find_one({"id": it.ref_id}, {"_id": 0})
            price_visible = show_prices and bool((item_doc or {}).get("show_public_price", True))
            reason = shop_guest.guest_block_reason(
                it.kind, item_doc if it.kind in collection_for else {}, price_visible=price_visible)
            if reason:
                blocked.append({"kind": it.kind, "ref_id": it.ref_id, "reason": reason})
        if blocked:
            # A mixed basket is not partly checked out. The guest is told
            # exactly which lines are the problem so the page can offer the
            # two honest choices: sign in, or take those lines out.
            raise HTTPException(status_code=403, detail={
                "message": "Some items in your cart need an account.",
                "blocked": blocked,
            })
        return await _s("_price_shop_cart")(normalized, client_id=None)

    @api.post("/public/shop/cart/price")
    async def price_public_shop_cart(body: GuestCartIn, request: Request):
        """What this basket costs, decided here and not in the browser.

        Read-only: no order, no reservation, no claim, no charge. Safe to
        call on every change to the cart, which is the point — the total a
        guest sees before checkout should be the total they are charged.
        """
        await _guest_shop_open()
        await _limit(request, "public_shop_cart_price", limit=60, window=60)
        priced = await _priced_guest_cart(body.items)
        return {
            "lines": [
                # BOTH halves of the line. line_total carries this line's
                # share of the sales tax; line_subtotal does not. A summary
                # that lists line_total under a tax-exclusive subtotal shows
                # lines that visibly do not add up to it, and charges tax
                # twice to the eye.
                {"kind": l["kind"], "ref_id": l["ref_id"], "name": l["name"],
                 "quantity": l["quantity"], "unit_price": l["unit_price"],
                 "line_subtotal": l["line_subtotal"], "line_total": l["line_total"]}
                for l in priced["lines"]
            ],
            "subtotal": priced["subtotal"],
            "tax_amount": priced["tax_amount"],
            "tax_rate_pct": priced["tax_rate_pct"],
            "total": priced["total"],
        }

    async def _sweep_abandoned_reservations(limit: int = 5) -> None:
        """Give back stock that an abandoned checkout is still holding.

        A checkout reserves stock before the customer pays, and releases it
        when somebody looks at the order and finds Stripe long finished with
        it. For a signed-in client that happens naturally — they come back.
        A guest checkout needs no account, so it widens who can take the last
        item off the shelf and simply walk away, and nothing else in the
        system goes looking.

        So new guest checkouts pay for old ones: each one clears a few
        attempts whose Stripe session has expired. It is bounded (five, each
        one Stripe call) so this stays a checkout and not a batch job, and it
        is self-balancing — the more guests arrive, the more sweeping gets
        done. Stripe remains the authority on whether an attempt is really
        dead; nothing is released on a clock alone.
        """
        db = _s("db")
        from datetime import datetime, timezone
        cutoff = datetime.now(timezone.utc).isoformat()
        stale = await db.shop_payment_attempts.find(
            {"status": "pending", "expires_at": {"$lt": cutoff, "$ne": None},
             "stripe_checkout_session_id": {"$ne": None}},
            {"_id": 0},
        ).sort("expires_at", 1).to_list(limit)
        for attempt in stale:
            try:
                await _s("_verify_and_reconcile_shop_session")(attempt)
            except Exception:
                # Best effort, always. A guest trying to buy something must
                # never fail because somebody else's abandoned order could
                # not be tidied up.
                _s("logger").warning(
                    "sweep of abandoned shop attempt %s failed", attempt.get("id"), exc_info=True)

    @api.post("/public/shop/checkout")
    async def create_public_shop_checkout(body: GuestCheckoutIn, request: Request):
        """Start paying, with no account.

        Rate limited harder than browsing is: every call that gets this far
        creates a Stripe Checkout Session, and sessions cost money to make
        and clutter to clean up. The limit is per IP and generous enough
        that a real person retrying a failed card never meets it.
        """
        await _guest_shop_open()
        await _limit(request, "public_shop_checkout", limit=10, window=3600)
        await _sweep_abandoned_reservations()
        email = str(body.email).strip().lower()
        return await shop_checkout.create_checkout(
            buyer=shop_checkout.guest_buyer(
                email=email, name=(body.name or "").strip(),
                phone=(body.phone or "").strip()),
            items=body.items,
            idempotency_key=body.idempotency_key,
        )

    @api.get("/public/shop/orders/{order_id}")
    async def public_shop_order_status(order_id: str, request: Request, token: str = ""):
        """How a guest order went.

        The token is the whole of the authorization. It is not an account,
        it grants nothing but a read of this one order, and it is compared
        against a stored hash in constant time. A wrong token and a made-up
        order id give the same 404, so this cannot be used to find out
        which order ids exist.

        It is read from a HEADER first and a query parameter second. The
        query parameter has to exist — Stripe sends the customer back to a
        URL, and that is the only place a token can ride on that first hop —
        but query strings end up in access logs, proxy logs and browser
        history, so every request after that one sends the header instead.
        """
        await _limit(request, "public_shop_order_status", limit=60, window=60)
        token = (request.headers.get("x-guest-token") or token or "").strip()
        db = _s("db")
        order = await db.shop_orders.find_one({"id": order_id}, {"_id": 0})
        if not order or not order.get("is_guest_order"):
            raise HTTPException(status_code=404, detail="Order not found.")
        if not shop_checkout.guest_token_matches(order, token):
            raise HTTPException(status_code=404, detail="Order not found.")

        # Same self-healing the signed-in status route does: if Stripe was
        # meant to have finished by now and we never heard, go and ask.
        attempt = await db.shop_payment_attempts.find_one({"shop_order_id": order_id}, {"_id": 0})
        if attempt and attempt.get("status") == "pending" and attempt.get("expires_at"):
            try:
                from datetime import datetime, timezone
                if datetime.now(timezone.utc) > datetime.fromisoformat(attempt["expires_at"]):
                    await _s("_verify_and_reconcile_shop_session")(attempt)
                    order = await db.shop_orders.find_one({"id": order_id}, {"_id": 0})
            except HTTPException:
                pass  # verification itself failed — show current state, let them poll

        # The same receipt a signed-in client gets, built by the same
        # allowlist (domains/shop/orders.py) so neither view can quietly
        # start returning a field the other would not.
        #
        # Pictures come from the PUBLIC catalogue, which is the right
        # restriction rather than an oversight: a guest looking at their own
        # receipt should not be shown the photography of an account-only
        # product, even one they somehow bought. A missing picture costs a
        # thumbnail; the alternative costs a rule.
        #
        # No "buy again" here. Those actions depend on an account — dog
        # ownership, enrolments, a client's own pricing — and a guest has
        # none of them. Guessing at eligibility for a buyer we cannot
        # identify is exactly what the recommendation rules refuse to do.
        # ...and a receipt must not depend on the storefront being OPEN.
        # _public_visible_shop_items raises 404 when public browsing is
        # switched off, which would have turned every guest's own order page
        # into "Shop is not available" the moment an admin closed the public
        # shop. They already paid; the receipt is theirs either way. A closed
        # storefront costs the thumbnails and nothing else.
        try:
            public_items = await _s("_public_visible_shop_items")()
        except HTTPException:
            public_items = []
        items_by_ref = {(i["kind"], i["id"]): i for i in public_items}
        view = shop_orders_view.detail(order, items_by_ref=items_by_ref, actions_by_item_id={})
        view["email"] = order.get("client_email")
        return view
