"""Money paid ahead onto a client's account, as a Shop basket line.

Owner request (2026-11-25): a client booking a visit with add-ons should be
able to pay for the add-ons right there. Add-ons cost dollars, not credits,
and there is no bill to pay until staff check the dog out — so the dollars
are taken ahead and held as CREDIT ON FILE on the client's account (the
same thing an overpaid checkout already leaves behind, see
domains/billing/tab_sync.credit_on_file). The pickup bill then uses it.

It rides the Shop's one checkout as a fifth line `kind`, exactly the way a
gift card does: no second payment path, the same idempotency claim, the
same Stripe page — so a credit pack and the add-on money are ONE card
payment.

What it deliberately is and is not:

  * the client pays $X and gets $X on their account. There is no price to
    look up and nothing to discount: the Shop discounts and taxes `product`
    lines only, so this line is never discounted and never taxed;
  * a signed-in client only. A guest has no account for money to sit on;
  * income is counted ONCE, the day the money arrives, as "Tab Payment" —
    the same way a payment taken toward the tab at the desk is counted
    (cash basis). Using the credit at pickup is not new income;
  * a refund is only automatic while the money is still sitting unused on
    the account, the same rule as an unused credit pack or gift card.

Every write is safe to repeat: the Shop re-drives fulfilment on a replayed
webhook and from "Retry Fulfillment".
"""
from __future__ import annotations

from typing import Optional

from fastapi import HTTPException

KIND = "account_credit"
MIN_AMOUNT = 1.0
MAX_AMOUNT = 500.0
METHOD = "stripe_online"

_g = None  # server module globals, resolved live (same pattern as domains.shop.checkout)


def configure(*, server_globals) -> None:
    global _g
    _g = server_globals


def _money(value) -> float:
    try:
        return round(float(value or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def ref_id_for(amount: float) -> str:
    """A stable id for an amount. Cents, so there is no float in a key."""
    return f"ac-{int(round(float(amount) * 100))}"


def amount_for(ref_id: str) -> Optional[float]:
    if not str(ref_id or "").startswith("ac-"):
        return None
    try:
        return round(int(str(ref_id)[3:]) / 100.0, 2)
    except (TypeError, ValueError):
        return None


def price_line(ref_id: str, quantity: int) -> dict:
    """What the line costs: exactly what it puts on the account."""
    amount = amount_for(ref_id)
    if amount is None or not (MIN_AMOUNT <= amount <= MAX_AMOUNT):
        raise HTTPException(status_code=400, detail="That amount can't be paid ahead online.")
    if int(quantity) != 1:
        raise HTTPException(status_code=422, detail="Money paid ahead is one amount per order.")
    return {"unit_price": amount, "name": f"Paid ahead for your visit · ${amount:.2f}"}


def fulfillment_ref(order_id: str, item_id: str) -> str:
    return f"shop_order:{order_id}:item:{item_id}:account_credit"


async def fulfill_line(order: dict, line: dict) -> None:
    """Put the money on the account: one ledger row, one balance change.

    The ledger row is found by its own ref before it is written, and the
    balance moves under its own marker on the client document, so a crash
    between the two — or a second delivery of the same payment — converges
    on exactly one of each.
    """
    db = _g["db"]
    client_id = order.get("client_id")
    if not client_id:
        raise HTTPException(status_code=500, detail="Money paid ahead needs an account to go on.")
    amount = _money(line.get("line_total") or line.get("unit_price"))
    ref = fulfillment_ref(order["id"], line["item_id"])
    tag = f"Paid ahead online · Shop order #{str(order['id'])[:8].upper()}"
    if not await db.payment_ledger.find_one({"fulfillment_ref": ref}, {"_id": 1}):
        await _g["_write_ledger_row"](
            client_id=client_id, type_="payment", amount=-amount, method=METHOD, notes=tag,
            created_by="stripe_webhook",
            extra={"scope": "account", "source": "online_prepay", "shop_order_id": order["id"], "fulfillment_ref": ref})
    await db.clients.find_one_and_update(
        {"id": client_id, "shop_account_credit_applied": {"$ne": ref}},
        {"$inc": {"account_balance": -amount}, "$addToSet": {"shop_account_credit_applied": ref}})


async def assert_refundable(order: dict, line: dict) -> None:
    """Before an in-app Shop refund: the money must still be sitting unused
    on the account. Once a bill has used it, handing it back automatically
    would leave that bill unpaid."""
    db = _g["db"]
    ref = fulfillment_ref(order["id"], line["item_id"])
    client = await db.clients.find_one({"id": order.get("client_id")}, {"_id": 0, "shop_account_credit_applied": 1})
    if ref not in ((client or {}).get("shop_account_credit_applied") or []):
        return  # never reached the account (fulfilment failed): nothing to take back
    amount = _money(line.get("line_total") or line.get("unit_price"))
    on_file = _money(await _g["billing_tab_sync"].credit_on_file(order.get("client_id")))
    if on_file + 0.004 < amount:
        raise HTTPException(
            status_code=409,
            detail=(f"The money paid ahead on this order has already been used (${on_file:.2f} of ${amount:.2f} is "
                    "still on the account). Automatic refund is blocked so money and the account cannot get out of sync."))


async def revoke_line(order: dict, line: dict, attempt_id: str) -> None:
    """After Stripe confirms the refund: take the money back off the account
    and mark the line refunded so a Retry Fulfillment never adds it again."""
    db = _g["db"]
    client_id = order.get("client_id")
    ref = fulfillment_ref(order["id"], line["item_id"])
    marker = f"{attempt_id}:{ref}"
    amount = _money(line.get("line_total") or line.get("unit_price"))
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "shop_account_credit_applied": 1})
    if ref in ((client or {}).get("shop_account_credit_applied") or []):
        if not await db.payment_ledger.find_one({"fulfillment_ref": marker}, {"_id": 1}):
            await _g["_write_ledger_row"](
                client_id=client_id, type_="refund", amount=amount, method=METHOD,
                notes=f"Refunded · money paid ahead · Shop order #{str(order['id'])[:8].upper()}",
                created_by="Stripe shop refund",
                extra={"scope": "account", "source": "online_prepay_refund", "shop_order_id": order["id"], "fulfillment_ref": marker})
        await db.clients.find_one_and_update(
            {"id": client_id, "shop_account_credit_refunds_applied": {"$ne": marker}},
            {"$inc": {"account_balance": amount}, "$addToSet": {"shop_account_credit_refunds_applied": marker}})
    await db.shop_orders.update_one(
        {"id": order["id"], "lines.item_id": line.get("item_id")},
        {"$set": {"lines.$.fulfillment_status": "refunded"}})
