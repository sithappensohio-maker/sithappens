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

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, EmailStr, Field


class PosSaleLineIn(BaseModel):
    kind: Literal["retail", "custom", "credit_pack", "training_program", "gift_card"] = "retail"
    product_id: Optional[str] = None  # required when kind == "retail"
    # Set only when the product has variants and one was picked (e.g. a
    # size) — never set for a plain, non-variant product. Resolves its own
    # price_override/stock against product.variants; see _price_pos_cart.
    variant_id: Optional[str] = None
    # Required, filled in, when the product has any
    # printify_personalization_fields (e.g. {"Name": "Rex", "Phone":
    # "330-555-0101"}) — carried onto the outbox row so process_outbox can
    # build the actual personalized product before ordering it (see
    # domains/printify/client.create_personalized_product). Never priced;
    # purely descriptive text the customer supplied.
    personalization: Optional[Dict[str, str]] = None
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
    # Register-only (owner, 2026-10-18): resolves a stocked Printify item
    # whose shelf stock doesn't fully cover this line's quantity. None
    # (the default, every other line) means "no decision made/needed yet" —
    # _pos_resolve_printify_stock treats that as a real choice still owed
    # whenever stock is PARTIAL, and refuses the sale with a 409 until it's
    # set. True: ship what's on the shelf, order the rest from Printify.
    # False: skip the shelf, order the full quantity from Printify. Ignored
    # for every line that isn't a Printify-fulfilled product with
    # track_inventory on, and ignored entirely by the online Shop (that
    # checkout path never looks at stock for a Printify item at all).
    printify_use_stock: Optional[bool] = None


class PosSaleDiscountIn(BaseModel):
    kind: Literal["fixed", "percent"]
    value: float = Field(gt=0)
    reason: str = Field(min_length=3, max_length=300)


class PosSaleTenderIn(BaseModel):
    # "card" is the SAME manually-recorded/offline card method used by
    # checkout, refunds, and tab payments everywhere else in the app — it
    # reports into the existing card register bucket and never touches
    # expected drawer cash. It is NOT a processor integration; use
    # "stripe_terminal" for an actual card-present charge on the reader.
    method: Literal["cash", "card", "check", "venmo", "paypal", "other", "gift_card", "stripe_terminal"]
    amount: float = Field(gt=0)
    tendered_amount: Optional[float] = Field(default=None, ge=0)  # cash only
    gift_card_code: Optional[str] = Field(default=None, max_length=40)  # gift_card only
    notes: Optional[str] = Field(default=None, max_length=500)  # required when method == "other"
    # Required when method == "stripe_terminal" — the Stripe PaymentIntent id
    # the reader actually charged. Re-verified against Stripe's own API (not
    # trusted as given) and consumed exactly once via a unique-indexed claim
    # before a sale carrying it is allowed to commit.
    provider_ref: Optional[str] = None


class PrintifyShippingAddressIn(BaseModel):
    """Where Printify ships the finished item — required on a sale whose
    chosen fulfillment is "ship" (see PrintifyFulfillmentIn). Never used for
    "pickup"; Printify ships that to the business's own address instead."""
    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(min_length=1, max_length=80)
    email: EmailStr
    phone: str = Field(default="", max_length=40)
    address1: str = Field(min_length=1, max_length=200)
    address2: str = Field(default="", max_length=200)
    city: str = Field(min_length=1, max_length=100)
    region: str = Field(min_length=1, max_length=100)  # state
    zip: str = Field(min_length=1, max_length=20)
    country: str = Field(default="US", max_length=2)


class PrintifyFulfillmentIn(BaseModel):
    """The customer's pickup-or-ship choice for a cart containing a
    Printify-fulfilled line — required on the sale commit body whenever one
    is present (checked server-side against the actual cart, never trusted
    from the client alone; see _create_pos_sale_impl)."""
    method: Literal["pickup", "ship"]
    shipping_address: Optional[PrintifyShippingAddressIn] = None


class PosSalePreviewIn(BaseModel):
    lines: List[PosSaleLineIn] = Field(min_length=1)
    discount: Optional[PosSaleDiscountIn] = None
    # Front Desk product/register-integration fix — when a client is
    # selected, retail lines must resolve THEIR grandfathered/tier price,
    # not the raw catalog price. Present on the preview body too (not just
    # the commit body) so the live cart total the cashier sees already
    # reflects it before checkout.
    client_id: Optional[str] = None
    # The pickup-or-ship choice for a cart with a Printify-fulfilled line —
    # required at commit time (checked server-side against each line's
    # actual product in _create_pos_sale_impl, never trusted from a client-
    # side guess), but present on the preview body too so the live total
    # the cashier sees already includes Printify's own real shipping cost
    # once a choice is made, same reasoning as client_id above. Ignored
    # when the cart has no Printify line, or no choice has been made yet.
    printify_fulfillment: Optional[PrintifyFulfillmentIn] = None


class PosSaleIn(PosSalePreviewIn):
    tenders: List[PosSaleTenderIn] = Field(min_length=1)
    workstation_id: Optional[str] = Field(default=None, max_length=100)
    idempotency_key: str = Field(min_length=8, max_length=128)
