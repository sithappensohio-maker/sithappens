"""POS sale request models.

Lifted out of server.py unchanged. They live here because server.py is at
its size ceiling and these are plainly the POS domain's own vocabulary —
what a till is allowed to send. server.py re-imports them, so every existing
reference (including `server.PosSaleLineIn` in the tests) still resolves.

Validation rules are deliberately identical to what server.py enforced: this
was a move, not a rewrite, and a money path is a poor place to combine the
two.
"""
from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class PosSaleLineIn(BaseModel):
    kind: Literal["retail", "custom", "credit_pack", "training_program", "gift_card"] = "retail"
    product_id: Optional[str] = None  # required when kind == "retail"
    pack_id: Optional[str] = None  # required when kind == "credit_pack"
    program_id: Optional[str] = None  # required when kind == "training_program"
    description: Optional[str] = Field(default=None, max_length=200)  # required when kind == "custom"; optional display override for retail/pack/program
    qty: float = Field(default=1, gt=0, le=999)
    # Required when kind == "custom" — the line's total amount (custom lines
    # are always qty-of-one conceptually, e.g. "Replacement leash $12.00").
    custom_amount: Optional[float] = Field(default=None, gt=0)
    custom_reason: Optional[str] = Field(default=None, max_length=300)
    # Step 4C-1 — what a custom line actually IS decides its taxability
    # (structured, never inferred from the description): "merchandise" is
    # taxable retail goods, "service" is never sales-taxable. Defaults to
    # merchandise so existing callers keep today's (taxed) behavior; the
    # register UI presents the choice explicitly.
    custom_kind: Literal["merchandise", "service"] = "merchandise"
    # Required when kind == "gift_card" — what the card is worth. Never
    # sales-taxed; the tax belongs on whatever the card later buys.
    gift_card_amount: Optional[float] = Field(default=None, gt=0, le=1000)
    gift_card_code: Optional[str] = Field(default=None, max_length=40)  # load a printed blank off the rack
    # Adding money to a card somebody already owns, rather than selling a new
    # one. Explicit rather than inferred from the card's state: a mistyped
    # code that happens to land on a live card would otherwise quietly top up
    # a stranger's balance instead of failing.
    gift_card_topup: bool = False
    # Where to send a DIGITAL card. Set it and there is no plastic: the code
    # is emailed to this address and the card is delivered the moment the
    # sale commits.
    gift_card_recipient_email: Optional[str] = Field(default=None, max_length=200)
    recipient_name: Optional[str] = Field(default=None, max_length=120)


class PosSaleDiscountIn(BaseModel):
    kind: Literal["fixed", "percent"]
    value: float = Field(gt=0)
    reason: str = Field(min_length=3, max_length=300)


class PosSaleTenderIn(BaseModel):
    # "card" is the SAME manually-recorded/offline card method used by
    # checkout, refunds, and tab payments everywhere else in the app — it
    # reports into the existing card register bucket and never touches
    # expected drawer cash. It is NOT a processor integration; Stripe
    # Terminal remains a separate, future step.
    method: Literal["cash", "card", "check", "venmo", "paypal", "other", "gift_card"]
    amount: float = Field(gt=0)
    tendered_amount: Optional[float] = Field(default=None, ge=0)  # cash only
    gift_card_code: Optional[str] = Field(default=None, max_length=40)  # gift_card only
    notes: Optional[str] = Field(default=None, max_length=500)  # required when method == "other"
    # Forward-compat placeholder only — unused today. When Stripe Card/
    # Terminal is added later, "method" gains new literals and this field
    # carries the provider's charge/transaction id. Nothing reads or writes
    # this field yet.
    provider_ref: Optional[str] = None


class PosSalePreviewIn(BaseModel):
    lines: List[PosSaleLineIn] = Field(min_length=1)
    discount: Optional[PosSaleDiscountIn] = None
    # Front Desk product/register-integration fix — when a client is
    # selected, retail lines must resolve THEIR grandfathered/tier price,
    # not the raw catalog price. Present on the preview body too (not just
    # the commit body) so the live cart total the cashier sees already
    # reflects it before checkout.
    client_id: Optional[str] = None


class PosSaleIn(PosSalePreviewIn):
    tenders: List[PosSaleTenderIn] = Field(min_length=1)
    workstation_id: Optional[str] = Field(default=None, max_length=100)
    idempotency_key: str = Field(min_length=8, max_length=128)
