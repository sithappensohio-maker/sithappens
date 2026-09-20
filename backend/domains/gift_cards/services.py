"""Gift cards: money the customer has already paid for.

A gift card is spendable on anything Sit Happens sells — a bag of food, a
week of boarding, a grooming appointment. It is not a visit credit (those are
a fixed number of days and live in credit_packs) and it is not a discount. It
is a balance.

ACCOUNTING — written down deliberately, because this is the part that is easy
to get quietly wrong:

    Sell a $100 card     -> +$100 revenue, $0 sales tax, +$100 cash
    Redeem $53.38 of it  -> +$50.00 goods revenue, +$3.38 tax owed to Ohio
       (on $50 + tax)       -$50.00 offset, already recognised at issue
                            $0 cash
    ------------------------------------------------------------------
    Totals                  $100 revenue on $100 cash, $3.38 tax owed

Revenue is recognised when the card is SOLD (the owner's decision, and the
right one on a cash basis). Redemption therefore books no new revenue: the
offset row cancels the goods revenue the card paid for, exactly as a prepaid
visit credit already does — `_cash_revenue` returns 0 for a pure credit
redemption for the same reason.

Two rules follow from that and must not be softened:

  * A gift card is NEVER sales-taxable when sold. Tax belongs on what the card
    buys. Taxing both charges the customer tax twice on the same money.
  * The offset covers only the PRE-TAX revenue the card funded. The sales tax
    on those goods was really collected and is really owed to Ohio.
"""
from __future__ import annotations

import secrets
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from pydantic import BaseModel, Field

_db = None
_now_iso_fn = None
_business_today_fn = None
_logger = None

# No 0/O/1/I/L — a code gets read off a card by a person, over the phone,
# under bad lighting.
#
# 31 characters over 12 places is ~59.5 bits: 7.9 x 10^17 possibilities, so
# guessing one at random is hopeless. That only holds if the numbers are
# genuinely unpredictable, which is why this uses `secrets` and NOT `random`.
# Python's `random` is a Mersenne Twister — see enough of its output and you
# can reconstruct its state and compute every code it will ever produce next.
# For money that is not a theoretical distinction.
_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
CODE_GROUPS = 3
CODE_GROUP_LEN = 4

# One print run. Big enough for a rack, small enough that a slipped keypress
# cannot mint a thousand codes.
MAX_STOCK_BATCH = 100
MIN_AMOUNT = 1.0
MAX_AMOUNT = 1000.0


def configure(*, db, now_iso, business_today, logger) -> None:
    global _db, _now_iso_fn, _business_today_fn, _logger
    _db = db
    _now_iso_fn = now_iso
    _business_today_fn = business_today
    _logger = logger


# ────────────────────────────────────────────────────────────────── models

class GiftCardIssueIn(BaseModel):
    """Issue a card directly — a comp, a replacement, an owner decision.

    Selling one to a customer goes through the register instead, so it is a
    real sale with a tender and a receipt.
    """

    amount: float = Field(gt=0, le=MAX_AMOUNT)
    recipient_name: Optional[str] = Field(default=None, max_length=120)
    note: Optional[str] = Field(default=None, max_length=300)
    # When set, the balance lands on this client's account instead of on a
    # card with a code — the "no card at all" flavour, for a client who is
    # already yours.
    client_id: Optional[str] = None
    reason: str = Field(min_length=3, max_length=300)


class GiftCardAdjustIn(BaseModel):
    amount: float = Field(gt=0, le=MAX_AMOUNT)
    direction: str = Field(pattern="^(add|remove)$")
    reason: str = Field(min_length=3, max_length=300)


class GiftCardVoidIn(BaseModel):
    reason: str = Field(min_length=3, max_length=300)


class GiftCardStockIn(BaseModel):
    """Blank cards for the rack. No amount: a blank is worth nothing until
    somebody buys it, which is the whole point of printing them ahead."""
    quantity: int = Field(default=10, ge=1, le=MAX_STOCK_BATCH)


def _money(v: Any) -> float:
    return round(float(v or 0), 2)


def normalize_code(raw: Any) -> str:
    """Accept what a human types: spaces, dashes, lower case, O for 0."""
    text = "".join(ch for ch in str(raw or "").upper() if ch.isalnum())
    return text.replace("O", "0").replace("I", "1").replace("L", "1")


def _display(code: str) -> str:
    return "-".join(code[i:i + CODE_GROUP_LEN] for i in range(0, len(code), CODE_GROUP_LEN))


async def _fresh_code() -> str:
    for _ in range(12):
        code = "".join(secrets.choice(_ALPHABET) for _ in range(CODE_GROUPS * CODE_GROUP_LEN))
        if not await _db.gift_cards.find_one({"code": code}, {"_id": 0, "id": 1}):
            return code
    raise HTTPException(status_code=500, detail="Could not generate a gift card code. Try again.")


def public_view(card: dict) -> dict:
    """What a screen may see. Never the raw code of somebody else's card —
    the last four are enough to recognise it on a list."""
    code = card.get("code") or ""
    return {
        "id": card.get("id"),
        "code_display": _display(code),
        "last4": code[-4:],
        "initial_amount": _money(card.get("initial_amount")),
        "balance": _money(card.get("balance")),
        "status": card.get("status"),
        # A screen needs to tell "blank on the rack" from "sold and spent" —
        # both have a zero balance and they mean opposite things.
        "origin": card.get("origin") or "",
        "recipient_name": card.get("recipient_name") or "",
        "note": card.get("note") or "",
        "client_id": card.get("client_id"),
        "issued_at": card.get("issued_at"),
        "issued_by_name": card.get("issued_by_name") or "",
        "sold_via_pos_sale_id": card.get("sold_via_pos_sale_id"),
        "spent": _money(_money(card.get("initial_amount")) - _money(card.get("balance"))),
    }


# ──────────────────────────────────────────────────────────────── issuing

async def mint_card(*, amount: float, actor: dict, recipient_name: str = "", note: str = "",
                    client_id: Optional[str] = None, pos_sale_id: Optional[str] = None,
                    origin: str = "sold") -> dict:
    """Create one card and its opening transaction. Money accounting is the
    CALLER's job — a sold card is recognised as revenue by the sale that sold
    it, and an issued one by the issuing endpoint."""
    amount = _money(amount)
    if amount < MIN_AMOUNT or amount > MAX_AMOUNT:
        raise HTTPException(
            status_code=400,
            detail=f"A gift card has to be between ${MIN_AMOUNT:.2f} and ${MAX_AMOUNT:.2f}.")
    code = await _fresh_code()
    ts = _now_iso_fn()
    card = {
        "id": str(uuid.uuid4()),
        "code": code,
        "initial_amount": amount,
        "balance": amount,
        "status": "active",
        "origin": origin,
        "recipient_name": (recipient_name or "").strip(),
        "note": (note or "").strip(),
        "client_id": client_id or None,
        "sold_via_pos_sale_id": pos_sale_id,
        "issued_at": ts,
        "issued_by": actor.get("id"),
        "issued_by_name": actor.get("name") or actor.get("email") or "",
        "business_date": _business_today_fn().isoformat(),
    }
    await _db.gift_cards.insert_one(dict(card))
    card.pop("_id", None)
    await _log(card["id"], "issue", amount, amount, actor,
               note=note or "", pos_sale_id=pos_sale_id)
    return card


async def ensure_indexes() -> None:
    """One code, one card — enforced by the database, not by hope.

    Minting checks for a collision and then inserts, which is a
    check-then-write and therefore a race: two blanks printed in the same
    instant could in principle both pass the check. The odds are absurd
    (31^12 codes), but a duplicate means two customers sharing one balance,
    and that is not a thing to leave to probability when an index is free.
    """
    try:
        await _db.gift_cards.create_index("code", unique=True, name="gift_card_code_unique")
    except Exception as exc:  # a pre-existing duplicate would block creation
        _logger.warning("Gift card code index not created (non-fatal): %s", exc)


async def mint_stock(*, quantity: int, actor: dict) -> List[dict]:
    """Print-ahead blanks: real codes, zero balance, not yet sold.

    A blank is NOT money. It books no revenue and appears in no liability —
    there is nothing owed to anybody until a customer pays for one and the
    register loads it. That is the difference between a rack of cards and a
    rack of promises, and it is why these are `status="stock"` rather than
    active cards worth $0.
    """
    made: List[dict] = []
    ts = _now_iso_fn()
    for _ in range(max(1, min(int(quantity), MAX_STOCK_BATCH))):
        code = await _fresh_code()
        card = {
            "id": str(uuid.uuid4()),
            "code": code,
            "initial_amount": 0.0,
            "balance": 0.0,
            "status": "stock",
            "origin": "stock",
            "recipient_name": "", "note": "", "client_id": None,
            "sold_via_pos_sale_id": None,
            "issued_at": ts,
            "issued_by": actor.get("id"),
            "issued_by_name": actor.get("name") or actor.get("email") or "",
            "business_date": _business_today_fn().isoformat(),
        }
        await _db.gift_cards.insert_one(dict(card))
        card.pop("_id", None)
        await _log(card["id"], "stock", 0.0, 0.0, actor, note="Printed for the rack")
        made.append({**public_view(card), "code": card["code"]})
    return made


async def activate_stock_card(*, code: str, amount: float, actor: dict,
                              pos_sale_id: str, recipient_name: str = "",
                              note: str = "") -> dict:
    """Load a blank from the rack because somebody just paid for it.

    The status precondition is the whole guard: two tills scanning the same
    card at once, or a double-submitted sale, and exactly one wins. The loser
    gets told the card is already sold rather than silently overwriting a
    balance somebody has already walked out with.
    """
    amount = _money(amount)
    if amount < MIN_AMOUNT or amount > MAX_AMOUNT:
        raise HTTPException(
            status_code=400,
            detail=f"A gift card has to be between ${MIN_AMOUNT:.2f} and ${MAX_AMOUNT:.2f}.")
    card = await find_by_code(code)
    if (card.get("status") or "") != "stock":
        raise HTTPException(
            status_code=409,
            detail=("That card was already sold." if card.get("status") == "active"
                    else "That card cannot be sold — look it up to see why."))
    ts = _now_iso_fn()
    loaded = await _db.gift_cards.find_one_and_update(
        {"id": card["id"], "status": "stock"},
        {"$set": {"status": "active", "balance": amount, "initial_amount": amount,
                  "sold_via_pos_sale_id": pos_sale_id, "activated_at": ts,
                  "recipient_name": (recipient_name or "").strip(),
                  "note": (note or "").strip(),
                  "sold_by": actor.get("id"),
                  "sold_by_name": actor.get("name") or actor.get("email") or ""}},
    )
    # find_one_and_update returns the doc as it was BEFORE the write, so None
    # means the precondition lost: somebody else sold this card first.
    if loaded is None:
        raise HTTPException(status_code=409, detail="That card was already sold.")
    await _log(card["id"], "activate", amount, amount, actor,
               note=note or "", pos_sale_id=pos_sale_id)
    return {**card, "status": "active", "balance": amount, "initial_amount": amount,
            "sold_via_pos_sale_id": pos_sale_id, "activated_at": ts,
            "recipient_name": (recipient_name or "").strip()}


async def _log(card_id: str, kind: str, amount: float, balance_after: float, actor: dict,
               *, note: str = "", pos_sale_id: Optional[str] = None) -> None:
    await _db.gift_card_transactions.insert_one({
        "id": str(uuid.uuid4()), "gift_card_id": card_id, "kind": kind,
        "amount": _money(amount), "balance_after": _money(balance_after),
        "note": (note or "").strip(), "pos_sale_id": pos_sale_id,
        "created_at": _now_iso_fn(),
        "created_by": actor.get("id"),
        "created_by_name": actor.get("name") or actor.get("email") or "",
        "business_date": _business_today_fn().isoformat(),
    })


# ───────────────────────────────────────────────────────────────── reading

async def find_by_code(raw_code: str) -> dict:
    code = normalize_code(raw_code)
    if not code:
        raise HTTPException(status_code=400, detail="Enter a gift card code.")
    card = await _db.gift_cards.find_one({"code": code}, {"_id": 0})
    if not card:
        raise HTTPException(status_code=404, detail="No gift card with that code.")
    return card


async def card_detail(raw_code: str) -> dict:
    card = await find_by_code(raw_code)
    history = await _db.gift_card_transactions.find(
        {"gift_card_id": card["id"]}, {"_id": 0},
    ).sort("created_at", 1).to_list(500)
    return {**public_view(card), "history": history}


def spendable(card: dict) -> float:
    if (card.get("status") or "") != "active":
        return 0.0
    return max(0.0, _money(card.get("balance")))


def assert_spendable(card: dict, amount: float) -> None:
    status = card.get("status") or ""
    if status == "voided":
        raise HTTPException(status_code=409, detail="That gift card was voided.")
    if status == "stock":
        # A blank off the rack. "No balance left" would send the operator
        # hunting for a spending mistake; the real answer is that nobody has
        # bought it yet.
        raise HTTPException(
            status_code=409,
            detail="That card has not been sold yet — sell it at the Register first.")
    if status != "active" or spendable(card) <= 0:
        raise HTTPException(status_code=409, detail="That gift card has no balance left.")
    if _money(amount) > spendable(card) + 0.005:
        raise HTTPException(
            status_code=400,
            detail=f"That card only has ${spendable(card):.2f} left.")


# ──────────────────────────────────────────────────────────────── spending

async def redeem(*, code: str, amount: float, actor: dict,
                 pos_sale_id: Optional[str] = None, note: str = "") -> dict:
    """Take `amount` off a card, atomically.

    The balance is decremented with the old value as a precondition, so two
    tills spending the last $10 at the same moment cannot both succeed.
    """
    amount = _money(amount)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="A redemption has to be more than zero.")
    for _ in range(5):
        card = await find_by_code(code)
        assert_spendable(card, amount)
        before = _money(card.get("balance"))
        after = _money(before - amount)
        updated = await _db.gift_cards.find_one_and_update(
            {"id": card["id"], "balance": before, "status": "active"},
            {"$set": {"balance": after,
                      "status": "spent" if after <= 0.004 else "active",
                      "last_used_at": _now_iso_fn()}},
        )
        if updated is None:
            continue  # someone else moved the balance — re-read and retry
        await _log(card["id"], "redeem", amount, after, actor,
                   note=note, pos_sale_id=pos_sale_id)
        return {"gift_card_id": card["id"], "code_display": _display(card["code"]),
                "redeemed": amount, "balance_after": after}
    raise HTTPException(status_code=409, detail="That card is being used somewhere else. Try again.")


async def refund_to_card(*, card_id: str, amount: float, actor: dict,
                         pos_sale_id: Optional[str] = None, note: str = "") -> Optional[dict]:
    """Put money back on a card — the other half of a return paid by gift card."""
    amount = _money(amount)
    if amount <= 0:
        return None
    card = await _db.gift_cards.find_one({"id": card_id}, {"_id": 0})
    if not card:
        return None
    after = _money(_money(card.get("balance")) + amount)
    await _db.gift_cards.update_one(
        {"id": card_id},
        {"$set": {"balance": after, "status": "active" if card.get("status") != "voided" else "voided"}})
    await _log(card_id, "refund", amount, after, actor, note=note, pos_sale_id=pos_sale_id)
    return {"gift_card_id": card_id, "balance_after": after}


async def adjust(*, code: str, body, actor: dict) -> dict:
    """Correct a balance by hand. Always leaves a reason behind.

    NOT a way to load a blank: money on a card has to arrive through a sale,
    or the liability appears from nowhere with no income behind it.
    """
    card = await find_by_code(code)
    if (card.get("status") or "") == "stock":
        raise HTTPException(
            status_code=409,
            detail="That card is a blank from the rack. Sell it at the Register to load it.")
    delta = _money(body.amount) * (1 if body.direction == "add" else -1)
    after = _money(_money(card.get("balance")) + delta)
    if after < 0:
        raise HTTPException(status_code=400, detail="That would take the card below zero.")
    await _db.gift_cards.update_one(
        {"id": card["id"]},
        {"$set": {"balance": after, "status": "spent" if after <= 0.004 else "active"}})
    await _log(card["id"], "adjust", delta, after, actor, note=body.reason)
    return {**public_view({**card, "balance": after})}


async def void_card(*, code: str, body, actor: dict) -> dict:
    """Kill a card — lost, stolen, issued in error. The balance is kept so the
    record still says what was on it when it died."""
    card = await find_by_code(code)
    if (card.get("status") or "") == "voided":
        return public_view(card)
    await _db.gift_cards.update_one(
        {"id": card["id"]},
        {"$set": {"status": "voided", "voided_at": _now_iso_fn(),
                  "void_reason": body.reason.strip(),
                  "voided_by": actor.get("id"),
                  "voided_by_name": actor.get("name") or actor.get("email") or ""}})
    await _log(card["id"], "void", _money(card.get("balance")), _money(card.get("balance")),
               actor, note=body.reason)
    return public_view({**card, "status": "voided"})


async def list_cards(*, status: Optional[str] = None, limit: int = 100) -> dict:
    query: Dict[str, Any] = {}
    if status in ("active", "spent", "voided", "stock"):
        query["status"] = status
    rows = await _db.gift_cards.find(query, {"_id": 0}).sort("issued_at", -1).to_list(max(1, min(limit, 500)))
    # Only ACTIVE cards are owed. Blanks on the rack are worth nothing to
    # anybody until they are sold, so they must never inflate this.
    outstanding = await _db.gift_cards.find({"status": "active"}, {"_id": 0, "balance": 1}).to_list(2000)
    on_the_rack = await _db.gift_cards.count_documents({"status": "stock"})
    return {
        "cards": [public_view(c) for c in rows],
        # What you owe the people holding cards. Worth seeing in one number.
        "outstanding_balance": round(sum(_money(c.get("balance")) for c in outstanding), 2),
        "outstanding_count": len(outstanding),
        "stock_count": on_the_rack,
    }


# ──────────────────────────────────────────────────── settling a register sale

async def settle_sale(*, sale_id: str, sale: dict, user: dict,
                      redeemed: List[dict], selling: List[Any]) -> List[dict]:
    """Everything a gift card owes the books once a sale has committed.

    Two halves, and they pull in opposite directions:

      * cards SOLD on this sale are revenue now, so each gets its own
        revenue row — the same shape a credit pack's sale already writes;
      * cards SPENT on this sale funded goods whose revenue was already
        recognised when those cards were sold, so the pre-tax slice they paid
        for is recorded on the sale's revenue row as `gift_card_funded` and
        subtracted by the one canonical revenue helper. No phantom negative
        row, which would otherwise show up as a refund it is not.
    """
    minted: List[dict] = []
    if selling:
        minted = await _mint_sold_cards(sale_id=sale_id, sale=sale, user=user, selling=selling)
    if redeemed:
        await _record_funding(sale_id=sale_id, sale=sale, redeemed=redeemed)
    # Handed back so the register can print the card the moment it is sold —
    # this is the only point the code is available to a person.
    return minted


async def _mint_sold_cards(*, sale_id: str, sale: dict, user: dict, selling: List[Any]) -> List[dict]:
    minted: List[dict] = []
    business_date = sale.get("business_date") or _business_today_fn().isoformat()
    receipt = sale.get("receipt_number") or ""
    for idx, li in enumerate(sale.get("line_items") or []):
        if li.get("kind") != "gift_card":
            continue
        codes: List[str] = []
        count = int(li.get("qty") or 1)
        each = _money(_money(li.get("net_amount") if li.get("net_amount") is not None
                             else li.get("amount")) / max(count, 1))
        # A line may name a blank that is already printed and on the rack.
        # Then the sale LOADS that card rather than minting a new one: the
        # customer walks out with the physical card they chose, and the code
        # on it is the code that now has money on it.
        stock_code = (li.get("gift_card_code") or "").strip()
        for _ in range(count):
            if stock_code:
                card = await activate_stock_card(
                    code=stock_code, amount=each, actor=user, pos_sale_id=sale_id,
                    recipient_name=li.get("recipient_name") or "",
                    note=f"Sold on register sale #{receipt}")
            else:
                card = await mint_card(
                    amount=each, actor=user,
                    recipient_name=li.get("recipient_name") or "",
                    note=f"Sold on register sale #{receipt}",
                    client_id=sale.get("client_id"), pos_sale_id=sale_id, origin="sold")
            # Revenue, now — the owner's chosen treatment, and the right one
            # on a cash basis. Never sales-taxable: the tax lands on whatever
            # the card is eventually spent on.
            await _db.retail_sales.insert_one({
                "id": str(uuid.uuid4()), "date": business_date, "amount": each,
                "payment_method": (sale.get("tenders") or [{}])[0].get("method") or "other",
                "client_id": sale.get("client_id"), "client_name": sale.get("client_name") or "",
                "pos_sale_id": sale_id, "gift_card_id": card["id"],
                "source_kind": "gift_card_sale",
                "tax_amount": 0.0, "pre_tax_amount": each, "tax_rate_pct": 0.0,
                "description": f"Gift card {_display(card['code'])} · sale #{receipt}",
                "category": "Gift Cards",
                "created_at": _now_iso_fn(), "created_by": user.get("id"),
                "logged_by": user.get("name") or user.get("email") or "admin",
            })
            minted.append({**public_view(card), "code": card["code"]})
            codes.append(_display(card["code"]))
        if codes:
            # Put the code into the SALE's own line so it lands on the printed
            # receipt. The thermal printer is driven by the local agent from a
            # fixed payload shape — it renders line descriptions, and nothing
            # here can teach it a new kind of document. Writing the code into
            # the description means the till receipt itself is proof of the
            # card, on the printer that is already at the counter, and a
            # reprint works months later. The full certificate is a separate,
            # page-printer thing.
            await _db.pos_sales.update_one(
                {"id": sale_id, f"line_items.{idx}.kind": "gift_card"},
                {"$set": {f"line_items.{idx}.description":
                          f"{li.get('description')} · {' · '.join(codes)}"}})
    return minted


async def _record_funding(*, sale_id: str, sale: dict, redeemed: List[dict]) -> None:
    """Mark how much PRE-TAX revenue on this sale a gift card already paid for.

    Proportional, because a card pays for goods and their tax together: $53.38
    off a sale that is $50 of goods plus $3.38 of tax funded $50 of revenue.
    The tax slice is deliberately NOT discounted — it was really collected and
    is really owed to Ohio.
    """
    total = _money(sale.get("total"))
    if total <= 0:
        return
    tax = _money(sale.get("tax_amount"))
    pre_tax_share = (total - tax) / total
    funded = _money(sum(_money(r.get("redeemed")) for r in redeemed) * pre_tax_share)
    if funded <= 0:
        return
    row_id = sale.get("retail_sales_id")
    if not row_id:
        # Nothing merchandise-shaped on this sale to attach it to; the
        # entitlement rows carry their own revenue and are not gift-funded.
        return
    await _db.retail_sales.update_one(
        {"id": row_id},
        {"$set": {"gift_card_funded": funded,
                  "gift_card_ids": [r.get("gift_card_id") for r in redeemed]}})
