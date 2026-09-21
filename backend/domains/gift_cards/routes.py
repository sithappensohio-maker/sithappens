"""HTTP routes for gift cards.

Selling a card happens at the register as an ordinary sale line, so there is
no "sell" endpoint here. These are the surrounding jobs: look one up, see
what is left on it, issue one by hand, correct a balance, and kill a lost one.
"""
from __future__ import annotations

from fastapi import Depends, HTTPException, Request

from domains.gift_cards import online, services


def register_gift_card_routes(*, api, server_globals: dict) -> None:
    require_employee_or_admin = server_globals["require_employee_or_admin"]
    require_admin_and_permission = server_globals["require_admin_and_permission"]
    enforce_rate_limit = server_globals["_enforce_rate_limit"]
    client_ip = server_globals["_client_ip"]
    get_current_user = server_globals["get_current_user"]
    _require_stripe_online_enabled = server_globals["_require_stripe_online_enabled"]

    def require_stripe(user: dict) -> None:
        """Portal money paths are for signed-in CLIENTS, and only when online
        payments are actually switched on."""
        if (user or {}).get("role") != "client":
            raise HTTPException(status_code=403, detail="Client account required")
        _require_stripe_online_enabled()

    @api.get("/gift-cards")
    async def list_gift_cards(status: str = "", limit: int = 100,
                              user: dict = Depends(require_admin_and_permission("finance_reports"))):
        """Every card, newest first, plus what you still owe the people
        holding them — the number an accountant asks for."""
        return await services.list_cards(status=status or None, limit=limit)

    @api.get("/gift-cards/lookup/{code}")
    async def lookup_gift_card(code: str, request: Request,
                               user: dict = Depends(require_employee_or_admin)):
        """Balance and history for one card. Open to anyone on the desk,
        because "how much is left on this?" is a counter question.

        Rate-limited anyway. Guessing a code is hopeless on the numbers, but
        the one way to make it less hopeless is to be allowed to try millions
        of them, so nobody is. A real shift looks up a handful of cards; this
        only bites a script.
        """
        await enforce_rate_limit(
            request, "gift_card_lookup", client_ip(request), limit=60, window_seconds=300)
        return await services.card_detail(code)

    @api.post("/gift-cards/issue")
    async def issue_gift_card(body: services.GiftCardIssueIn,
                              user: dict = Depends(require_admin_and_permission("pricing"))):
        """Create a card without selling one — a comp, a make-good, a
        replacement for one that was lost.

        No money changes hands, so this deliberately writes NO revenue row.
        It is a liability you have chosen to take on, and pretending it was
        income would overstate what the business earned.
        """
        card = await services.mint_card(
            amount=body.amount, actor=user, recipient_name=body.recipient_name or "",
            note=body.note or body.reason, client_id=body.client_id, origin="issued")
        return {"ok": True, "card": services.public_view(card),
                "code": services._display(card["code"])}

    @api.get("/portal/gift-cards/{code}")
    async def portal_gift_card(code: str, request: Request,
                               user: dict = Depends(get_current_user)):
        """Balance on a card the customer is holding. Rate-limited for the
        same reason the staff lookup is: a code is a bearer token, and the
        only way to make guessing viable is to allow a lot of guesses."""
        await enforce_rate_limit(
            request, "gift_card_portal_lookup", client_ip(request), limit=30, window_seconds=300)
        return online.portal_view(await services.find_by_code(code))

    @api.post("/portal/gift-cards/{code}/topup-session")
    async def portal_gift_card_topup(code: str, body: online.GiftCardTopupSessionIn,
                                     user: dict = Depends(get_current_user)):
        """Start paying to add money to a card. Grants nothing by itself —
        only a verified Stripe webhook ever moves a balance."""
        require_stripe(user)
        return await online.start_topup(code=code, body=body, user=user)

    @api.post("/portal/gift-cards/purchase-session")
    async def portal_gift_card_purchase(body: online.GiftCardPurchaseIn,
                                        user: dict = Depends(get_current_user)):
        """Buy a digital card for somebody. Mints nothing by itself."""
        require_stripe(user)
        return await online.start_purchase(body=body, user=user)

    @api.get("/portal/gift-card-attempts/{attempt_id}")
    async def portal_gift_card_attempt(attempt_id: str,
                                       user: dict = Depends(get_current_user)):
        """What happened, read from our own records rather than from the
        query string the browser came back with."""
        return await online.attempt_status(attempt_id, user)

    @api.post("/gift-cards/stock")
    async def make_gift_card_stock(body: services.GiftCardStockIn,
                                   user: dict = Depends(require_admin_and_permission("pricing"))):
        """Print-ahead blanks for the rack.

        Deliberately NOT an income event and NOT a liability: a blank card is
        a piece of printed plastic with a code on it. It becomes money only
        when somebody buys it and the Register loads it. That is why this can
        make a hundred at once without the books moving a cent.
        """
        made = await services.mint_stock(quantity=body.quantity, actor=user,
                                         face_value=body.face_value)
        return {"ok": True, "count": len(made), "cards": made}

    @api.post("/gift-cards/{code}/adjust")
    async def adjust_gift_card(code: str, body: services.GiftCardAdjustIn,
                               user: dict = Depends(require_admin_and_permission("pricing"))):
        return {"ok": True, "card": await services.adjust(code=code, body=body, actor=user)}

    @api.post("/gift-cards/{code}/details")
    async def edit_gift_card_details(code: str, body: services.GiftCardDetailsIn,
                                     user: dict = Depends(require_admin_and_permission("pricing"))):
        """Who the card is for, and the note on it. No money moves here."""
        return {"ok": True, "card": await services.edit_details(code=code, body=body, actor=user)}

    @api.post("/gift-cards/{code}/void")
    async def void_gift_card(code: str, body: services.GiftCardVoidIn,
                             user: dict = Depends(require_admin_and_permission("delete_records"))):
        return {"ok": True, "card": await services.void_card(code=code, body=body, actor=user)}
