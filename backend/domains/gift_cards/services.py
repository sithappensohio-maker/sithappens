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

import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError
from pydantic import BaseModel, Field

_db = None
_email_sender = None
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


def configure(*, db, now_iso, business_today, logger, email_sender=None) -> None:
    global _db, _now_iso_fn, _business_today_fn, _logger, _email_sender
    _email_sender = email_sender
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


class GiftCardSendEmailIn(BaseModel):
    """Send a card's code by email again, optionally to a corrected address.

    A mistyped address is the usual reason a digital card never arrives;
    before this the only fix was to void the card and start again.
    """
    recipient_email: Optional[str] = Field(default=None, max_length=200)


class GiftCardDetailsIn(BaseModel):
    """The two things about a card that are a note to yourselves, not money.

    Deliberately narrow: there is no amount, no status and no code here.
    Everything that moves money has its own path with its own reasons and
    its own audit trail, and this must never become a back door into any of
    them.
    """
    recipient_name: Optional[str] = Field(default=None, max_length=120)
    note: Optional[str] = Field(default=None, max_length=300)


class GiftCardStockIn(BaseModel):
    """Cards for the rack.

    `face_value` is the amount PRINTED on them, for a $25 or $50 stack. It is
    not a balance: the card is still worth nothing until somebody buys it.
    Leave it out for blanks, which can be sold for any amount.
    """
    quantity: int = Field(default=10, ge=1, le=MAX_STOCK_BATCH)
    face_value: Optional[float] = Field(default=None, gt=0, le=MAX_AMOUNT)


def _money(v: Any) -> float:
    return round(float(v or 0), 2)


def _stored(card: dict) -> Any:
    """The balance EXACTLY as stored, for a compare-and-set filter. Comparing
    against the rounded value never matches a balance an older $inc left as
    11.370000000000001, and the card could then never be spent or topped up.
    Every write here stores the rounded value, so such a card heals on its
    next use."""
    return card.get("balance") if card.get("balance") is not None else 0


def normalize_code(raw: Any) -> str:
    """Accept what a human types: spaces, dashes, lower case, O for 0."""
    text = "".join(ch for ch in str(raw or "").upper() if ch.isalnum())
    return text.replace("O", "0").replace("I", "1").replace("L", "1")


def _display(code: str) -> str:
    return "-".join(code[i:i + CODE_GROUP_LEN] for i in range(0, len(code), CODE_GROUP_LEN))


async def _fresh_code() -> str:
    """A code nothing else is using, as far as a read can tell.

    This is a check-then-use and therefore a race — deliberately. The thing
    that makes a duplicate IMPOSSIBLE is the unique index; this only makes
    hitting it vanishingly unlikely so the retry below almost never runs.
    """
    for _ in range(12):
        code = "".join(secrets.choice(_ALPHABET) for _ in range(CODE_GROUPS * CODE_GROUP_LEN))
        if not await _db.gift_cards.find_one({"code": code}, {"_id": 0, "id": 1}):
            return code
    raise HTTPException(status_code=500, detail="Could not generate a gift card code. Try again.")


def _duplicate_field(exc) -> str:
    """Which unique index a DuplicateKeyError came from.

    It matters: a clash on `code` should be retried with a different code,
    while a clash on `id` means this card already exists — an online purchase
    pins its id precisely so a repeated webhook lands here, and retrying that
    would mint the second card the id was supposed to prevent.
    """
    try:
        return next(iter((exc.details or {}).get("keyPattern") or {}), "")
    except Exception:
        return ""


async def _insert_with_fresh_code(doc: dict) -> dict:
    """Write a card, taking a new code if the database says that one is taken.

    Without this a collision surfaces as a 500 in the middle of settlement —
    which is logged and swallowed — so the customer would be charged and get
    no card. The odds are absurd (31^12), but "absurd" is not "never", and
    the failure mode is somebody's money.
    """
    for _ in range(6):
        doc["code"] = await _fresh_code()
        try:
            await _db.gift_cards.insert_one(dict(doc))
            return doc
        except DuplicateKeyError as exc:
            if _duplicate_field(exc) != "code":
                raise          # an id clash is the caller's business, not ours
            _logger.warning("Gift card code collision on %s — retrying", doc["code"])
    raise HTTPException(status_code=500,
                        detail="Could not generate a gift card code. Try again.")


def email_state(card: dict, queued: Optional[bool] = None) -> str:
    """Whether a card's code reached anybody: sent | queued | not_sent | none.

    Never "sent" unless it really went (audit 2026-09-25 #56 — the Shop used
    to say "emailed" whatever happened):

      * "sent" — the provider accepted it (email_delivered_at), or a card
        emailed before delivery was recorded (code_emailed_at with no send
        in flight);
      * "queued" — waiting in the email queue to be retried. `queued` is the
        truth read from the queue by callers that can (queued_ids); without
        it the card's own flag is used;
      * "not_sent" — nothing went and nothing is waiting: before the first
        try, a send interrupted mid-flight (email_sending_at still set), or
        a failure that could not be queued. Staff can send it.

    A send waiting in the queue wins over an older delivery: that is the one
    staff are waiting on.
    """
    if (card.get("status") or "") in ("voided", "stock") or not (card.get("recipient_email") or "").strip():
        return "none"
    if card.get("email_queued_at") if queued is None else queued:
        return "queued"
    if card.get("email_delivered_at") or (card.get("code_emailed_at") and not card.get("email_sending_at")):
        return "sent"
    return "not_sent"


def _key_card_id(key: str) -> str:
    rest = str(key or "")[len("gift_card_delivered:"):]
    return rest.split(":resend:")[0]


async def queued_ids(card_ids: Optional[List[str]] = None) -> set:
    """Ids of cards with an email really waiting in the queue — the truth
    behind "queued". A backup restore leaves out the queue, so a card's own
    flag can outlive its row; screens read this instead."""
    rows = await _db.email_outbox.find(
        {"key": {"$regex": "^gift_card_delivered:"}, "status": "pending"},
        {"_id": 0, "key": 1}).to_list(5000)
    ids = {_key_card_id(r.get("key")) for r in rows}
    return ids if card_ids is None else ids & set(card_ids)


def delivered_to(card: dict) -> str:
    """The address this card's code already reached, if any."""
    if card.get("email_delivered_to"):
        return str(card["email_delivered_to"]).strip().lower()
    if card.get("code_emailed_at") and not card.get("email_sending_at"):
        return (card.get("recipient_email") or "").strip().lower()
    return ""


def public_view(card: dict, *, queued: Optional[bool] = None) -> dict:
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
        # What is printed on the card, for a fixed-denomination stack. NOT a
        # balance — an unsold $25 card is still worth nothing to anybody.
        "face_value": (None if card.get("face_value") is None
                       else _money(card.get("face_value"))),
        "recipient_name": card.get("recipient_name") or "",
        "recipient_email": card.get("recipient_email") or "",
        "delivery": card.get("delivery") or "print",
        "code_emailed_at": card.get("code_emailed_at"),
        "email_state": email_state(card, queued),
        "email_delivered_to": card.get("email_delivered_to") or "",
        "email_delivered_at": card.get("email_delivered_at"),
        # Where the code already went — the address it can no longer be
        # moved away from without replacing the card (resend_card_email).
        "already_emailed_to": delivered_to(card),
        "email_queued_at": card.get("email_queued_at"),
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
                    origin: str = "sold", recipient_email: str = "",
                    card_id: Optional[str] = None) -> dict:
    """Create one card and its opening transaction. Money accounting is the
    CALLER's job — a sold card is recognised as revenue by the sale that sold
    it, and an issued one by the issuing endpoint."""
    amount = _money(amount)
    if amount < MIN_AMOUNT or amount > MAX_AMOUNT:
        raise HTTPException(
            status_code=400,
            detail=f"A gift card has to be between ${MIN_AMOUNT:.2f} and ${MAX_AMOUNT:.2f}.")
    ts = _now_iso_fn()
    card = {
        # Callers that must be replay-safe (an online purchase re-driven by a
        # repeated webhook) pin the id, so a second attempt collides on the
        # unique index instead of minting a second card.
        "id": card_id or str(uuid.uuid4()),
        "code": "",              # filled in by _insert_with_fresh_code
        "initial_amount": amount,
        "balance": amount,
        "status": "active",
        "origin": origin,
        "recipient_name": (recipient_name or "").strip(),
        "recipient_email": (recipient_email or "").strip().lower(),
        # A card with an address to send it to is a digital card: there is no
        # plastic, the email IS the card, and the code has to reach somebody.
        "delivery": "email" if (recipient_email or "").strip() else "print",
        "note": (note or "").strip(),
        "client_id": client_id or None,
        "sold_via_pos_sale_id": pos_sale_id,
        "issued_at": ts,
        "issued_by": actor.get("id"),
        "issued_by_name": actor.get("name") or actor.get("email") or "",
        "business_date": _business_today_fn().isoformat(),
    }
    await _insert_with_fresh_code(card)
    card.pop("_id", None)
    await _log(card["id"], "issue", amount, amount, actor,
               note=note or "", pos_sale_id=pos_sale_id)
    return card


async def edit_details(*, code: str, body, actor: dict) -> dict:
    """Change who a card is for, and the note on it. Nothing else.

    Useful because the register often takes the money before anybody knows
    whose name goes on it, and because a typo on a card you are about to
    print is worth fixing rather than reprinting around.
    """
    card = await find_by_code(code)
    if (card.get("status") or "") == "voided":
        raise HTTPException(status_code=409, detail="That gift card was voided.")
    changes = {}
    if body.recipient_name is not None:
        changes["recipient_name"] = body.recipient_name.strip()
    if body.note is not None:
        changes["note"] = body.note.strip()
    if not changes:
        return public_view(card, queued=card["id"] in await queued_ids([card["id"]]))
    changes["details_edited_at"] = _now_iso_fn()
    changes["details_edited_by_name"] = actor.get("name") or actor.get("email") or ""
    await _db.gift_cards.update_one({"id": card["id"]}, {"$set": changes})
    # Logged at zero so it appears in the card's history without pretending
    # any money moved — the balance is carried through unchanged.
    await _log(card["id"], "edit", 0.0, _money(card.get("balance")), actor,
               note=(changes.get("recipient_name") or changes.get("note") or "details updated"))
    return public_view({**card, **changes}, queued=card["id"] in await queued_ids([card["id"]]))


def assert_toppable(card: dict, amount: float) -> None:
    """Can this card take more money, and is the amount sane?

    A blank is refused on purpose: it has not been sold, so the thing to do
    is sell it, not top it up. Selling it is what books the revenue, and
    topping up a blank would create a balance with no sale behind it.
    """
    status = card.get("status") or ""
    if status == "voided":
        raise HTTPException(status_code=409, detail="That gift card was voided.")
    if status == "stock":
        raise HTTPException(
            status_code=409,
            detail="That card has not been sold yet — sell it rather than adding to it.")
    if status not in ("active", "spent"):
        raise HTTPException(status_code=409, detail="That card cannot take a top-up.")
    amount = _money(amount)
    if amount < MIN_AMOUNT or amount > MAX_AMOUNT:
        raise HTTPException(
            status_code=400,
            detail=f"A top-up has to be between ${MIN_AMOUNT:.2f} and ${MAX_AMOUNT:.2f}.")
    if _money(card.get("balance")) + amount > MAX_AMOUNT + 0.005:
        raise HTTPException(
            status_code=400,
            detail=(f"That would put ${_money(card.get('balance')) + amount:.2f} on the card, "
                    f"over the ${MAX_AMOUNT:.2f} limit."))


async def topup_card(*, code: str, amount: float, actor: dict,
                     pos_sale_id: str, note: str = "") -> dict:
    """Put more money on a card somebody already owns.

    Accounting is identical to selling a card, because that is what it is:
    cash arrives, revenue is recognised now, and the liability grows by the
    same amount. No sales tax — the tax lands on whatever the card buys.

    The balance precondition is the guard: two tills topping up the same card
    at once must not both read $10 and both write $60, losing one of the
    payments. Same retry-on-contention shape as spending.
    """
    amount = _money(amount)
    for _ in range(5):
        card = await find_by_code(code)
        assert_toppable(card, amount)
        before = _money(card.get("balance"))
        after = _money(before + amount)
        updated = await _db.gift_cards.find_one_and_update(
            {"id": card["id"], "balance": _stored(card),
             "status": {"$in": ["active", "spent"]}},
            {"$set": {"balance": after, "status": "active",
                      "last_topped_up_at": _now_iso_fn()}},
        )
        if updated is None:
            continue  # somebody else moved the balance — re-read and retry
        await _log(card["id"], "topup", amount, after, actor,
                   note=note, pos_sale_id=pos_sale_id)
        return {**card, "balance": after, "status": "active"}
    raise HTTPException(status_code=409, detail="That card is being used somewhere else. Try again.")


def assert_face_value(card: dict, amount: float) -> None:
    """A card with a printed amount can only be sold for that amount.

    Otherwise the customer walks out holding a card that says $25 with $10 on
    it, and the only record that they are different lives in the app. The
    printed number is a promise; this is what keeps it.

    Checked in TWO places on purpose: at the till before the sale commits, so
    a mistake costs nobody anything, and again inside activation, which is
    the only path that can actually move the money.
    """
    face = card.get("face_value")
    if face is None:
        return
    if abs(_money(amount) - _money(face)) > 0.005:
        raise HTTPException(
            status_code=400,
            detail=f"That card has ${_money(face):.2f} printed on it, so it sells for ${_money(face):.2f}.")


def first_email_key(card_id: str) -> str:
    """The email-queue key of a card's automatic first send. A staff re-send
    uses its own key under this prefix (see resend_card_email)."""
    return f"gift_card_delivered:{card_id}"


def _key_prefix(card_id: str) -> dict:
    return {"$regex": "^" + re.escape(first_email_key(card_id)) + "(:|$)"}


_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

# A send still marked in flight after this long was interrupted (a restart
# mid-send); a later delivery attempt may take it over.
_STALE_SEND_MINUTES = 15


async def send_card_email(card: dict, *, sender=None) -> bool:
    """Send a digital card to whoever it is for — the automatic first send.

    Claimed before sending so two deliveries cannot both email the same
    card, and UNCLAIMED again if the send fails — a duplicate email is a
    nuisance, a gift card that never arrives is a lost gift. That trade is
    deliberate and is why this is not a plain "mark and forget".

    The claim checks the card as it is NOW (never voided or unsold) and the
    email is built from what the claim returned, so a card refunded a moment
    ago is never sent. `email_sending_at` marks the send in flight: a restart
    mid-send leaves the card honestly "not sent", never "emailed".

    A send that cannot go out right now (Quiet Hours, the mail service down)
    waits in the email queue, which keeps retrying it
    (email_service.process_email_outbox); the card says so and is stamped
    when it really arrives. While anything for the card is waiting in the
    queue — this first send or a staff re-send — nothing else starts a second
    one. Before (audit 2026-09-25 #56) a failed send was dropped and nothing
    ever tried again.

    Never raises. A sale must not fail because a mail provider is down; the
    card exists either way and staff can send it again from the card's own
    screen (resend_card_email).
    """
    to = (card.get("recipient_email") or "").strip()
    if (card.get("status") or "") == "voided":
        return False   # refunded or reversed before it went out: never send a dead card
    if not to:
        return False
    send = sender or _email_sender
    if send is None:
        return False
    if await _db.email_outbox.find_one({"key": _key_prefix(card["id"]), "status": "pending"}, {"_id": 1}):
        return False   # the email queue already owns this card's delivery
    now = _now_iso_fn()
    stale = (datetime.now(timezone.utc) - timedelta(minutes=_STALE_SEND_MINUTES)).isoformat()
    claimed = await _db.gift_cards.find_one_and_update(
        {"id": card["id"], "status": {"$nin": ["voided", "stock"]},
         "recipient_email": {"$nin": [None, ""]}, "email_delivered_at": None,
         "$or": [{"code_emailed_at": None}, {"email_sending_at": {"$lt": stale}}]},
        {"$set": {"code_emailed_at": now, "email_sending_at": now}},
        return_document=ReturnDocument.AFTER, projection={"_id": 0},
    )
    if claimed is None:
        return False  # already sent, being sent right now, or voided/unsold since the caller read it
    try:
        ok = await send(claimed)
    except Exception as exc:  # a mail provider is not a reason to lose a sale
        ok = False
        _logger.warning("Gift card email failed for %s: %s", card.get("id"), exc)
    if ok:
        await _db.gift_cards.update_one({"id": card["id"]}, {"$unset": {"email_sending_at": ""}})
    else:
        await _db.gift_cards.update_one({"id": card["id"]},
                                        {"$set": {"code_emailed_at": None}, "$unset": {"email_sending_at": ""}})
        if await _db.email_outbox.find_one(
                {"key": first_email_key(card["id"]), "status": "pending"}, {"_id": 1}) is not None:
            await _db.gift_cards.update_one({"id": card["id"], "email_delivered_at": None},
                                            {"$set": {"email_queued_at": _now_iso_fn()}})
    return bool(ok)


async def resend_card_email(*, code: str, body, actor: dict) -> dict:
    """Staff: send a card's code by email again, optionally to a corrected
    address.

    Refused when the code already reached a DIFFERENT address: whoever reads
    that inbox can spend it, so sending the same code somewhere else would
    leave it live in two places. The safe fix is to void the card and issue
    a new one. Correcting an address the code never reached is fine.

    Anything still queued for this card is dropped first, so an email held
    for a mistyped address can never reach a stranger afterwards. Sent now
    when possible; otherwise it waits in the email queue and is retried,
    exactly like the first send.
    """
    card = await find_by_code(code)
    status = card.get("status") or ""
    if status == "voided":
        raise HTTPException(status_code=409, detail="That gift card was voided.")
    if status == "stock":
        raise HTTPException(status_code=409, detail="That card has not been sold yet — there is nothing on it to send.")
    if status == "spent":
        raise HTTPException(status_code=409, detail="That card has been used up — there is nothing left on it to send.")
    raw = body.recipient_email if body.recipient_email is not None else card.get("recipient_email")
    to = (raw or "").strip().lower()
    if not to:
        raise HTTPException(status_code=400, detail="Enter the email address to send it to.")
    if not _EMAIL_RE.match(to):
        raise HTTPException(status_code=400, detail="Enter a real email address to send it to.")
    if _email_sender is None:
        raise HTTPException(status_code=503, detail="Email is not set up, so the card cannot be sent.")
    already = delivered_to(card)
    if not already or already == to:
        # A delivery the provider accepted whose stamp has not landed yet
        # (email_service leaves it "delivered_pending_stamp") still reached
        # that inbox.
        for row in await _db.email_outbox.find(
                {"key": _key_prefix(card["id"]), "status": "delivered_pending_stamp"},
                {"_id": 0, "on_success": 1}).to_list(50):
            got = ((row.get("on_success") or {}).get("to") or "").strip().lower()
            if got and got != to:
                already = got
                break
    if already and already != to:
        raise HTTPException(status_code=409, detail=(
            f"This card's code was already emailed to {already}, so whoever reads that inbox can spend it. "
            f"Void this card and issue a new one for what is left on it, then email the new card to {to}."))
    balance = _money(card.get("balance"))
    changed = to != (card.get("recipient_email") or "").strip().lower()
    fresh = await _db.gift_cards.find_one_and_update(
        {"id": card["id"], "status": "active"}, {"$set": {"recipient_email": to}},
        return_document=ReturnDocument.AFTER, projection={"_id": 0})
    if fresh is None:
        raise HTTPException(status_code=409, detail="That card changed while you were sending it — look it up again.")
    if changed:
        await _log(card["id"], "edit", 0.0, balance, actor, note=f"Email address changed to {to}")
    await _db.email_outbox.delete_many({"key": _key_prefix(card["id"]), "status": "pending"})
    key = f"{first_email_key(card['id'])}:resend:{uuid.uuid4().hex[:12]}"
    try:
        ok = bool(await _email_sender(fresh, outbox_key=key, first=False))
    except Exception as exc:
        ok = False
        _logger.warning("Gift card re-send failed for %s: %s", card.get("id"), exc)
    queued = False
    if ok:
        await _db.gift_cards.update_one({"id": card["id"], "code_emailed_at": None},
                                        {"$set": {"code_emailed_at": _now_iso_fn()}})
    else:
        queued = await _db.email_outbox.find_one({"key": key, "status": "pending"}, {"_id": 1}) is not None
        await _db.gift_cards.update_one(
            {"id": card["id"]},
            {"$set": {"email_queued_at": _now_iso_fn()}} if queued else {"$unset": {"email_queued_at": ""}})
    await _log(card["id"], "email", 0.0, balance, actor,
               note=("Emailed to " if ok else "Waiting to email " if queued else "Could not email ") + to)
    fresh = await _db.gift_cards.find_one({"id": card["id"]}, {"_id": 0}) or fresh
    return {"sent": ok, "queued": queued,
            "card": public_view(fresh, queued=fresh["id"] in await queued_ids([fresh["id"]]))}


async def find_duplicate_codes() -> list:
    """Any code held by more than one card. Should always be empty; worth
    being able to ask rather than assume."""
    rows = await _db.gift_cards.aggregate([
        {"$group": {"_id": "$code", "n": {"$sum": 1}}},
        {"$match": {"n": {"$gt": 1}}},
        {"$limit": 50},
    ]).to_list(50)
    return [r["_id"] for r in rows]


async def code_uniqueness_enforced() -> bool:
    """Is the unique index actually on the collection right now?

    Startup logs a failure, but a log is not something anybody checks. This
    lets a test — and a human — ask the database directly.
    """
    try:
        info = await _db.gift_cards.index_information()
    except Exception:
        return False
    return any(spec.get("unique") and [("code", 1)] == list(spec.get("key") or [])
               for spec in info.values())


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
        # Also unique on our own id: an online purchase pins the id up front
        # so a repeated webhook delivery cannot mint the card twice, and that
        # only holds if the database refuses the second insert.
        await _db.gift_cards.create_index("id", unique=True, name="gift_card_id_unique")
        await _db.gift_card_transactions.create_index("gift_card_id", name="gift_card_txn_card")
        await _db.gift_card_transactions.create_index("operation_id", sparse=True, name="gift_card_txn_operation")
    except Exception as exc:
        # The ONLY thing making a duplicate code impossible is this index. If
        # it will not build, say so loudly and name the codes that are in the
        # way, rather than leaving a quiet warning nobody reads and a
        # guarantee that is no longer true.
        dupes = await find_duplicate_codes()
        _logger.error("GIFT CARD CODE UNIQUENESS IS NOT ENFORCED: index could not "
                      "be created (%s). Duplicate codes present: %s", exc, dupes or "none")


async def mint_stock(*, quantity: int, actor: dict,
                     face_value: Optional[float] = None) -> List[dict]:
    """Print-ahead blanks: real codes, zero balance, not yet sold.

    A blank is NOT money. It books no revenue and appears in no liability —
    there is nothing owed to anybody until a customer pays for one and the
    register loads it. That is the difference between a rack of cards and a
    rack of promises, and it is why these are `status="stock"` rather than
    active cards worth $0.
    """
    face = None if face_value is None else _money(face_value)
    if face is not None and (face < MIN_AMOUNT or face > MAX_AMOUNT):
        raise HTTPException(
            status_code=400,
            detail=f"A gift card has to be between ${MIN_AMOUNT:.2f} and ${MAX_AMOUNT:.2f}.")
    made: List[dict] = []
    ts = _now_iso_fn()
    for _ in range(max(1, min(int(quantity), MAX_STOCK_BATCH))):
        card = {
            "id": str(uuid.uuid4()),
            "code": "",          # filled in by _insert_with_fresh_code
            "initial_amount": 0.0,
            "balance": 0.0,
            "status": "stock",
            "origin": "stock",
            "face_value": face,
            "recipient_name": "", "note": "", "client_id": None,
            "sold_via_pos_sale_id": None,
            "issued_at": ts,
            "issued_by": actor.get("id"),
            "issued_by_name": actor.get("name") or actor.get("email") or "",
            "business_date": _business_today_fn().isoformat(),
        }
        await _insert_with_fresh_code(card)
        card.pop("_id", None)
        await _log(card["id"], "stock", 0.0, 0.0, actor,
                   note=("Printed for the rack" if face is None
                         else f"Printed for the rack · ${face:.2f} card"))
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
    assert_face_value(card, amount)
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
               *, note: str = "", pos_sale_id: Optional[str] = None, **extra: Any) -> str:
    """One history row. Returns its id. `extra` carries where the money went
    (booking_id, operation_id, source, key) so it can be found and reversed."""
    txn_id = str(uuid.uuid4())
    await _db.gift_card_transactions.insert_one({
        "id": txn_id, "gift_card_id": card_id, "kind": kind,
        "amount": _money(amount), "balance_after": _money(balance_after),
        "note": (note or "").strip(), "pos_sale_id": pos_sale_id,
        "created_at": _now_iso_fn(),
        "created_by": actor.get("id"),
        "created_by_name": actor.get("name") or actor.get("email") or "",
        "business_date": _business_today_fn().isoformat(),
        **{k: v for k, v in extra.items() if v is not None},
    })
    return txn_id


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
    queued = card["id"] in await queued_ids([card["id"]])
    return {**public_view(card, queued=queued), "history": history}


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
                 pos_sale_id: Optional[str] = None, note: str = "",
                 booking_id: Optional[str] = None, operation_id: Optional[str] = None,
                 source: Optional[str] = None) -> dict:
    """Take `amount` off a card, atomically.

    The balance is decremented with the old value as a precondition, so two
    tills spending the last $10 at the same moment cannot both succeed.
    `booking_id` / `operation_id` / `source` tag the history row so a
    checkout that fails afterwards can find and return exactly this money.
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
            {"id": card["id"], "balance": _stored(card), "status": "active"},
            {"$set": {"balance": after,
                      "status": "spent" if after <= 0.004 else "active",
                      "last_used_at": _now_iso_fn()}},
        )
        if updated is None:
            continue  # someone else moved the balance — re-read and retry
        txn_id = await _log(card["id"], "redeem", amount, after, actor,
                            note=note, pos_sale_id=pos_sale_id,
                            booking_id=booking_id, operation_id=operation_id, source=source)
        return {"gift_card_id": card["id"], "code_display": _display(card["code"]),
                "redeemed": amount, "balance_after": after, "transaction_id": txn_id}
    raise HTTPException(status_code=409, detail="That card is being used somewhere else. Try again.")


async def refund_to_card(*, card_id: str, amount: float, actor: dict,
                         pos_sale_id: Optional[str] = None, note: str = "",
                         key: Optional[str] = None) -> Optional[dict]:
    """Put money back on a card — the other half of a return paid by gift card."""
    return await credit_card(card_id=card_id, amount=amount, actor=actor, note=note,
                             pos_sale_id=pos_sale_id, key=key or f"refund:{uuid.uuid4()}")


async def credit_card(*, card_id: str, amount: float, actor: dict, key: str, note: str = "",
                      pos_sale_id: Optional[str] = None, **tags: Any) -> Optional[dict]:
    """Give money back to a card, EXACTLY ONCE per `key`.

    Every reason money returns to a card — a sale that failed, a checkout
    that rolled back, a return, a void — has a key naming it. The card
    remembers the keys it has been paid under (`money_keys`), and the
    balance moves only in the same atomic write that adds the key, so a
    retried request, a replayed rollback or two workers racing can never
    return the same money twice. A voided card keeps its status (the money
    is recorded, but a dead card is not revived); a blank is never loaded.
    """
    amount = _money(amount)
    if amount <= 0:
        return None
    for _ in range(5):
        card = await _db.gift_cards.find_one({"id": card_id}, {"_id": 0})
        if not card or (card.get("status") or "") == "stock":
            return None
        if key in (card.get("money_keys") or []):
            return {"gift_card_id": card_id, "balance_after": _money(card.get("balance")), "already": True}
        after = _money(_money(card.get("balance")) + amount)
        status = "voided" if card.get("status") == "voided" else "active"
        updated = await _db.gift_cards.find_one_and_update(
            {"id": card_id, "balance": _stored(card), "money_keys": {"$ne": key}},
            {"$set": {"balance": after, "status": status}, "$addToSet": {"money_keys": key}},
        )
        if updated is None:
            continue
        await _log(card_id, "refund", amount, after, actor, note=note, pos_sale_id=pos_sale_id, key=key, **tags)
        return {"gift_card_id": card_id, "balance_after": after}
    raise HTTPException(status_code=409, detail="That card is being used somewhere else. Try again.")


async def reverse_load(*, card_id: str, amount: float, actor: dict, key: str, note: str = "",
                       pos_sale_id: Optional[str] = None, void_if_empty: bool = False,
                       allow_partial: bool = False, **tags: Any) -> dict:
    """Take back money that was LOADED onto a card (a sale, a top-up, an
    online purchase) because that load is being undone — EXACTLY ONCE per
    `key`. Refuses if the card no longer holds that much: the customer has
    spent it, and taking back money they spent is not a reversal, it's a
    debt. `void_if_empty` retires a card that existed only because of the
    load being undone (its code is on a receipt, so it is voided, never put
    back on the rack)."""
    amount = _money(amount)
    for _ in range(5):
        card = await _db.gift_cards.find_one({"id": card_id}, {"_id": 0})
        if not card:
            raise HTTPException(status_code=404, detail="That gift card no longer exists.")
        if key in (card.get("money_keys") or []):
            return {"gift_card_id": card_id, "balance_after": _money(card.get("balance")), "already": True}
        if allow_partial:
            # Money already refunded outside the till (Stripe): take back what
            # is left, and report what couldn't be — never guess further.
            amount = min(amount, _money(card.get("balance")))
        if _money(card.get("balance")) + 0.004 < amount:
            raise HTTPException(
                status_code=409,
                detail=(f"Gift card {_display(card['code'])} only has ${_money(card.get('balance')):.2f} left of the "
                        f"${amount:.2f} that was put on it — some of it has already been used."))
        after = _money(_money(card.get("balance")) - amount)
        if after <= 0.004 and void_if_empty:
            new = {"balance": 0.0, "status": "voided", "voided_at": _now_iso_fn(),
                   "void_reason": (note or "Reversed").strip(), "voided_by": actor.get("id"),
                   "voided_by_name": actor.get("name") or actor.get("email") or ""}
        else:
            new = {"balance": after, "status": ("spent" if after <= 0.004 else "active")
                   if card.get("status") != "voided" else "voided"}
        updated = await _db.gift_cards.find_one_and_update(
            {"id": card_id, "balance": _stored(card), "money_keys": {"$ne": key}},
            {"$set": new, "$addToSet": {"money_keys": key}},
        )
        if updated is None:
            continue
        await _log(card_id, "reverse", -amount, new["balance"], actor, note=note, pos_sale_id=pos_sale_id, key=key, **tags)
        return {"gift_card_id": card_id, "balance_after": new["balance"], "status": new["status"], "debited": amount}
    raise HTTPException(status_code=409, detail="That card is being used somewhere else. Try again.")


async def return_checkout_charges(*, operation_id: str, actor: dict) -> int:
    """A checkout rolled back: give back every card charge it made for the
    stay (merchandise rung at the same pickup is its own committed sale and
    stays). Keyed per charge, so a rollback that runs twice returns once.
    Returns how many charges went back."""
    if not operation_id:
        return 0
    rows = await _db.gift_card_transactions.find(
        {"operation_id": operation_id, "kind": "redeem", "source": "booking_checkout"}, {"_id": 0},
    ).to_list(100)
    returned = 0
    for r in rows:
        done = await credit_card(
            card_id=r["gift_card_id"], amount=r["amount"], actor=actor,
            key=f"checkout-rollback:{r['id']}", note="Checkout didn't go through — balance returned",
            booking_id=r.get("booking_id"), operation_id=operation_id)
        if done and not done.get("already"):
            returned += 1
    return returned


async def adjust(*, code: str, body, actor: dict) -> dict:
    """Correct a balance by hand. Always leaves a reason behind.

    NOT a way to load a blank: money on a card has to arrive through a sale,
    or the liability appears from nowhere with no income behind it.
    """
    delta = _money(body.amount) * (1 if body.direction == "add" else -1)
    for _ in range(5):
        card = await find_by_code(code)
        if (card.get("status") or "") == "stock":
            raise HTTPException(
                status_code=409,
                detail="That card is a blank from the rack. Sell it at the Register to load it.")
        if (card.get("status") or "") == "voided":
            # A void is final: an "add" would quietly revive a card that was
            # refunded, reversed or reported stolen.
            raise HTTPException(status_code=409, detail="That gift card was voided. Voided cards can't be changed.")
        after = _money(_money(card.get("balance")) + delta)
        if after < 0:
            raise HTTPException(status_code=400, detail="That would take the card below zero.")
        updated = await _db.gift_cards.find_one_and_update(
            {"id": card["id"], "balance": _stored(card)},
            {"$set": {"balance": after, "status": "spent" if after <= 0.004 else "active"}})
        if updated is None:
            continue
        await _log(card["id"], "adjust", delta, after, actor, note=body.reason)
        return {**public_view({**card, "balance": after})}
    raise HTTPException(status_code=409, detail="That card is being used somewhere else. Try again.")


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
    waiting = await queued_ids([c["id"] for c in rows])
    return {
        "cards": [public_view(c, queued=c["id"] in waiting) for c in rows],
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
        topping_up = bool(li.get("gift_card_topup")) and bool(stock_code)
        for _ in range(count):
            if topping_up:
                card = await topup_card(
                    code=stock_code, amount=each, actor=user, pos_sale_id=sale_id,
                    note=f"Topped up on register sale #{receipt}")
            elif stock_code:
                card = await activate_stock_card(
                    code=stock_code, amount=each, actor=user, pos_sale_id=sale_id,
                    recipient_name=li.get("recipient_name") or "",
                    note=f"Sold on register sale #{receipt}")
            else:
                card = await mint_card(
                    amount=each, actor=user,
                    recipient_name=li.get("recipient_name") or "",
                    recipient_email=li.get("recipient_email") or "",
                    note=f"Sold on register sale #{receipt}",
                    client_id=sale.get("client_id"), pos_sale_id=sale_id, origin="sold")
                # A digital card has no plastic to hand over, so the email is
                # the delivery. Best effort: the card is already real.
                if card.get("recipient_email"):
                    await send_card_email(card)
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


# ─────────────────────────────────────────── undoing a sale: void and return

async def paying_cards(sale: dict) -> List[Optional[str]]:
    """For each gift-card tender on a sale (in order), the card that paid it.
    Newer sales record it on the tender; older ones only in the merchandise
    revenue row's `gift_card_ids`. None where it can't be told."""
    ids = [t.get("gift_card_id") for t in (sale.get("tenders") or [])
           if t.get("method") == "gift_card" and _money(t.get("amount")) > 0]
    if all(ids):
        return ids
    fallback: List[str] = []
    if sale.get("retail_sales_id"):
        row = await _db.retail_sales.find_one({"id": sale["retail_sales_id"]}, {"_id": 0, "gift_card_ids": 1})
        fallback = (row or {}).get("gift_card_ids") or []
    return [i or (fallback[n] if n < len(fallback) else None) for n, i in enumerate(ids)]


def funded_offset(row: Optional[dict]) -> dict:
    """The `gift_card_funded` a reversal row must carry so a voided card-paid
    sale nets to zero revenue (the original row's revenue was already reduced
    by what the card paid). Capped at the row's pre-tax amount."""
    funded = _money((row or {}).get("gift_card_funded"))
    if funded <= 0:
        return {}
    pre_tax = _money((row or {}).get("pre_tax_amount")) or _money(
        _money((row or {}).get("amount")) - _money((row or {}).get("tax_amount")))
    if pre_tax <= 0:
        return {}   # the original row's revenue was floored at $0 — there is nothing to give back
    return {"gift_card_funded": -min(funded, pre_tax)}


async def plan_void(sale: dict) -> dict:
    """Read-only, BEFORE a void touches anything: what its gift cards need,
    and a refusal if it can't be done honestly.

      * a card SOLD (or topped up) on the sale gives that money back — so it
        must still hold it. If the customer has spent some, the sale can't
        be voided (that would take back money they already used);
      * a card that PAID for the sale gets its money back — so we must know
        which card it was.
    """
    if (sale.get("status") or "") == "voided":
        return {"sold": [], "spent": []}   # a retry of a finished void: the void's own claim replays it
    if await _db.pos_sale_returns.find_one({"pos_sale_id": sale.get("id")}, {"_id": 1}):
        # Voiding would refund the returned part a second time (to the card,
        # to cash — anywhere) and restock it twice.
        raise HTTPException(
            status_code=409,
            detail="Part of this sale has already been returned, so it can't be voided. Return the rest instead.")
    sold: List[dict] = []
    rows = await _db.retail_sales.find(
        {"pos_sale_id": sale.get("id"), "source_kind": "gift_card_sale"}, {"_id": 0}).to_list(100)
    by_card: Dict[str, List[dict]] = {}
    for r in rows:
        if r.get("gift_card_id"):
            by_card.setdefault(r["gift_card_id"], []).append(r)
    for card_id, rs in by_card.items():
        card = await _db.gift_cards.find_one({"id": card_id}, {"_id": 0})
        amount = _money(sum(_money(r.get("amount")) for r in rs))
        if not card:
            raise HTTPException(status_code=409, detail="A gift card sold on this sale no longer exists, so it can't be voided.")
        if _money(card.get("balance")) + 0.004 < amount:
            raise HTTPException(
                status_code=409,
                detail=(f"Gift card {_display(card['code'])} was sold on this sale and ${amount - _money(card.get('balance')):.2f} "
                        f"of it has already been spent, so the sale can't be voided. Give back the unused "
                        f"${_money(card.get('balance')):.2f} by hand instead."))
        topped_up = await _db.gift_card_transactions.find_one(
            {"gift_card_id": card_id, "pos_sale_id": sale.get("id"), "kind": "topup"}, {"_id": 1})
        # Loaded again since (a top-up at the till or online)? Then it holds the
        # customer's own money too — take back only this sale's, never retire it.
        loaded_since = bool(card.get("topup_attempts_applied")) or bool(await _db.gift_card_transactions.find_one(
            {"gift_card_id": card_id, "kind": "topup", "pos_sale_id": {"$ne": sale.get("id")}}, {"_id": 1}))
        sold.append({"card_id": card_id, "code": card["code"], "amount": amount, "rows": rs,
                     "void_if_empty": not topped_up and not loaded_since,
                     "before": {k: card.get(k) for k in ("balance", "status")}})
    spent: List[dict] = []
    tenders = [t for t in (sale.get("tenders") or []) if t.get("method") == "gift_card" and _money(t.get("amount")) > 0]
    if tenders:
        ids = await paying_cards(sale)
        if not all(ids):
            raise HTTPException(
                status_code=409,
                detail=("This sale was paid with a gift card the system can't identify, so voiding it can't put "
                        "the money back on the card. Void it from the Gift Cards screen by hand instead."))
        for t, cid in zip(tenders, ids):
            card = await _db.gift_cards.find_one({"id": cid}, {"_id": 0, "balance": 1, "status": 1}) or {}
            spent.append({"card_id": cid, "amount": _money(t.get("amount")),
                          "before": {k: card.get(k) for k in ("balance", "status")}})
    return {"sold": sold, "spent": spent}


async def write_void_offsets(plan: dict, sale: dict, *, business_date: str, ts: str, user: dict, reason: str) -> List[str]:
    """One offsetting revenue row per gift card sold on the sale (never
    deleting the original) — the same discipline as the merchandise and
    pack offsets. Returns the ids written, for the void's own rollback."""
    written: List[str] = []
    for s in plan.get("sold") or []:
        for r in s["rows"]:
            row_id = str(uuid.uuid4())
            await _db.retail_sales.insert_one({
                "id": row_id, "date": business_date, "amount": -_money(r.get("amount")),
                "payment_method": "void", "client_id": sale.get("client_id"),
                "client_name": sale.get("client_name"), "pos_sale_id": sale.get("id"),
                "reversed_retail_sales_id": r["id"], "source_kind": "pos_sale_void",
                "gift_card_id": s["card_id"], "tax_amount": 0.0, "tax_rate_pct": 0.0,
                "pre_tax_amount": -_money(r.get("amount")),
                "description": f"Void of POS Sale #{sale.get('receipt_number')} · gift card {_display(s['code'])} · {reason}",
                "created_at": ts, "created_by": user.get("id"),
                "logged_by": user.get("name") or user.get("email") or "admin",
            })
            written.append(row_id)
    return written


async def apply_void(plan: dict, sale: dict, *, claim_id: str, user: dict) -> None:
    """The card half of a void — last, after every other step succeeded.
    Keys carry the void claim, so each card moves once per void attempt; if
    one move fails the ones already made are put back and the void rolls back."""
    note = f"Sale #{sale.get('receipt_number')} voided"
    touched: List[dict] = []
    try:
        for s in plan.get("sold") or []:
            await reverse_load(card_id=s["card_id"], amount=s["amount"], actor=user,
                               key=f"void:{claim_id}:sold:{s['card_id']}", note=note,
                               pos_sale_id=sale.get("id"), void_if_empty=s["void_if_empty"])
            touched.append(s)
        for i, s in enumerate(plan.get("spent") or []):
            await credit_card(card_id=s["card_id"], amount=s["amount"], actor=user,
                              key=f"void:{claim_id}:spent:{i}", note=note, pos_sale_id=sale.get("id"))
            touched.append(s)
    except Exception:
        for s in touched:
            try:
                await _db.gift_cards.update_one(
                    {"id": s["card_id"]},
                    {"$set": {"balance": _money(s["before"].get("balance")), "status": s["before"].get("status")},
                     "$unset": {"voided_at": "", "void_reason": ""}} if s["before"].get("status") != "voided"
                    else {"$set": {"balance": _money(s["before"].get("balance"))}})
            except Exception as exc:
                _logger.critical("Void of sale %s could not restore gift card %s: %s", sale.get("id"), s["card_id"], exc)
        raise


async def refill_for_return(tenders: List[dict], *, sale_id: str, key: str, user: dict, receipt: str) -> None:
    """A return paid (partly) by gift card: that slice goes back on the card,
    once per return request."""
    for i, t in enumerate(tenders):
        if t.get("method") != "gift_card" or not t.get("gift_card_id"):
            continue
        await credit_card(card_id=t["gift_card_id"], amount=t["amount"], actor=user,
                          key=f"return:{key}:{i}", note=f"Return against sale #{receipt}", pos_sale_id=sale_id)
