"""Gift cards as something you can put in the Shop basket.

A shop gift card is a DIGITAL card: there is nothing to post, so buying one
online mints a card and emails the code. It rides the Shop's existing order,
payment and fulfilment machinery rather than inventing a second one — it is
just a fourth line `kind`, priced from a fixed list of amounts and fulfilled
per line like every other kind.

Two things it deliberately does NOT do:

  * it is never taxed. A gift card is money, and the tax lands on whatever
    the card eventually buys. The Shop already taxes only `product` lines,
    so this falls out correctly rather than needing a special case;
  * it has no stock. There is nothing physical to reserve or run out of, so
    none of the inventory path applies.

The amounts come from settings so they can be changed without a deploy, and
they are validated on the way back in: the cart says "this amount" and the
server looks it up rather than believing it, exactly like every other line.
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import HTTPException

from domains.gift_cards import services

# What the Shop offers when nobody has configured anything. Round numbers
# people actually buy, not an arbitrary spread.
DEFAULT_AMOUNTS = (25.0, 50.0, 100.0)

_db = None
_logger = None
_get_settings = None


def configure(*, db, logger, get_settings) -> None:
    global _db, _logger, _get_settings
    _db = db
    _logger = logger
    _get_settings = get_settings


def _clean(amounts) -> List[float]:
    out = []
    for a in amounts or []:
        try:
            v = round(float(a), 2)
        except (TypeError, ValueError):
            continue
        if services.MIN_AMOUNT <= v <= services.MAX_AMOUNT and v not in out:
            out.append(v)
    return sorted(out)


async def offered_amounts() -> List[float]:
    """The amounts the Shop sells, newest config winning, defaults otherwise."""
    try:
        cfg = (await _get_settings()) or {}
    except Exception:
        cfg = {}
    gc = (cfg.get("gift_cards") or {}) if isinstance(cfg.get("gift_cards"), dict) else {}
    if not gc.get("shop_enabled", True):
        return []
    return _clean(gc.get("shop_amounts")) or list(DEFAULT_AMOUNTS)


def ref_id_for(amount: float) -> str:
    """A stable id for an amount. Cents, so there is no float in a key."""
    return f"gc-{int(round(float(amount) * 100))}"


def amount_for(ref_id: str) -> Optional[float]:
    if not str(ref_id or "").startswith("gc-"):
        return None
    try:
        return round(int(str(ref_id)[3:]) / 100.0, 2)
    except (TypeError, ValueError):
        return None


async def catalog_items() -> List[dict]:
    """Shop catalog entries, in the same shape every other kind uses."""
    items = []
    for amount in await offered_amounts():
        items.append({
            "kind": "gift_card",
            "id": ref_id_for(amount),
            "name": f"Gift card · ${amount:.0f}" if amount == int(amount)
                    else f"Gift card · ${amount:.2f}",
            "description": "Emailed straight through — there is nothing to collect. "
                           "Spend it on anything we sell; it does not expire.",
            "list_price": amount,
            "effective_price": amount,
            "pricing_source": "standard",
            "price_override_id": None,
            "has_price_override": False,
            "price": amount,
            "legacy_price": None,
            "has_legacy_override": False,
            # No stock, and never taxed — both are true of money, not goods.
            "in_stock": True,
            "taxable": False,
            "publicly_visible": True,
            "show_public_price": True,
            "requires_completed_onboarding": False,
            "featured": False,
            "image_id": None,
        })
    return items


async def price_line(ref_id: str, quantity: int) -> dict:
    """What a gift card line costs. The amount is looked up, never taken
    from the cart — a cart that could name its own price is not a price."""
    amount = amount_for(ref_id)
    if amount is None or amount not in await offered_amounts():
        raise HTTPException(
            status_code=400,
            detail="That gift card amount is no longer available.")
    return {"unit_price": amount,
            "name": f"Gift card · ${amount:.2f}"}


async def fulfill_line(order: dict, line: dict, *, mint, email) -> dict:
    """Mint the card(s) this line bought and email them.

    Idempotent on the line: the ids are derived from the order and line, so
    a re-driven fulfilment finds the cards already there instead of minting
    a second set. The Shop re-drives fulfilment on retry and from the admin
    "Retry Fulfillment" action, so this WILL be called more than once.
    """
    qty = max(1, int(line.get("quantity") or 1))
    amount = round(float(line.get("unit_price") or 0), 2)
    to = ((line.get("recipient_email") or "").strip()
          or (order.get("client_email") or "").strip())
    made = []
    for i in range(qty):
        card_id = f"gcshop-{order['id']}-{line.get('item_id')}-{i}"
        card = await _db.gift_cards.find_one({"id": card_id}, {"_id": 0})
        if card is None:
            try:
                card = await mint(
                    amount=amount,
                    actor={"id": order.get("client_id"), "name": "Shop"},
                    recipient_name=order.get("client_name") or "",
                    recipient_email=to,
                    note=f"Bought in the Shop · order #{str(order['id'])[:8].upper()}",
                    client_id=order.get("client_id"), origin="digital",
                    card_id=card_id)
            except Exception:
                # Another delivery won the race and minted it; read theirs.
                card = await _db.gift_cards.find_one({"id": card_id}, {"_id": 0})
                if card is None:
                    raise
        if card.get("recipient_email"):
            await email(card)
        made.append(card)
    return {"count": len(made), "codes": [c["code"] for c in made]}
