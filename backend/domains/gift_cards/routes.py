"""HTTP routes for gift cards.

Selling a card happens at the register as an ordinary sale line, so there is
no "sell" endpoint here. These are the surrounding jobs: look one up, see
what is left on it, issue one by hand, correct a balance, and kill a lost one.
"""
from __future__ import annotations

from fastapi import Depends

from domains.gift_cards import services


def register_gift_card_routes(*, api, server_globals: dict) -> None:
    require_employee_or_admin = server_globals["require_employee_or_admin"]
    require_admin_and_permission = server_globals["require_admin_and_permission"]
    db = server_globals["db"]

    @api.get("/gift-cards")
    async def list_gift_cards(status: str = "", limit: int = 100,
                              user: dict = Depends(require_admin_and_permission("finance_reports"))):
        """Every card, newest first, plus what you still owe the people
        holding them — the number an accountant asks for."""
        return await services.list_cards(status=status or None, limit=limit)

    @api.get("/gift-cards/lookup/{code}")
    async def lookup_gift_card(code: str, user: dict = Depends(require_employee_or_admin)):
        """Balance and history for one card. Open to anyone on the desk,
        because "how much is left on this?" is a counter question."""
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

    @api.post("/gift-cards/{code}/adjust")
    async def adjust_gift_card(code: str, body: services.GiftCardAdjustIn,
                               user: dict = Depends(require_admin_and_permission("pricing"))):
        return {"ok": True, "card": await services.adjust(code=code, body=body, actor=user)}

    @api.post("/gift-cards/{code}/void")
    async def void_gift_card(code: str, body: services.GiftCardVoidIn,
                             user: dict = Depends(require_admin_and_permission("delete_records"))):
        return {"ok": True, "card": await services.void_card(code=code, body=body, actor=user)}
