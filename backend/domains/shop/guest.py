"""Who is allowed to buy what without an account.

There is exactly ONE rule in this file, and everything that needs to know
the answer asks it here: the public storefront (to decide which button to
draw), the cart (to decide what it will hold), and checkout (to decide what
it will actually charge for). The storefront's answer is a courtesy; the
checkout's answer is the one that counts, and because they are the same
function they cannot drift apart.

The rule comes from FULFILMENT, not from marketing. Ask one question of
each thing we sell: when the money lands, does anything have to be attached
to an account?

  product        no.  It is a thing in a box. Somebody comes and collects
                      it. Nothing is granted, nothing is remembered.
  gift_card      no.  It is money. The code is the bearer instrument; it is
                      emailed to whoever bought it and works for whoever
                      holds it. There is no account for it to live in.
  credit_pack    YES. It mints credit_lots keyed to client_id and increments
                      that client's balance. With no client there is nothing
                      to increment — the money would arrive and buy nothing.
  training_program
                 YES. Either it grants training credits to a client, or (for
                      purchase_fulfillment="online_school") it enrols a
                      named DOG, which belongs to a client. Same problem,
                      twice over.

So the account-bound kinds are not "guest checkout we haven't built yet" —
they are purchases that have nowhere to go. We do not invent a placeholder
client to receive them (that makes a real-looking customer record out of
thin air and every report downstream then has to know about it). We tell
the visitor to sign in, which is the honest answer.

On top of the kind, a product must be opted in ONE AT A TIME
(`guest_cart_allowed` on the product), and any per-item requirement that
needs an account — a dog, an approval, finished onboarding — takes the
answer back to no however the flag is set. A hidden price also means no:
you cannot consent to a price you were not shown.
"""
from __future__ import annotations

from typing import Optional

# Kinds whose fulfilment needs nothing account-shaped. Everything else is
# account-bound BY DEFAULT — a kind added later is refused until somebody
# adds it here deliberately, which is the safe direction to fail in.
GUEST_FULFILLABLE_KINDS = frozenset({"product", "gift_card"})

# Why each account-bound kind is account-bound, in words a customer can read.
_ACCOUNT_BOUND_REASON = {
    "credit_pack": "Prepaid visits are added to your account balance, so you'll need to sign in first.",
    "training_program": "Training programs are booked to your dog's account, so you'll need to sign in first.",
}
_GENERIC_ACCOUNT_REASON = "Please sign in to buy this."


def account_requirements(item_doc: dict) -> bool:
    """True when this item needs something only an account can supply.

    Kept separate because the storefront reports these three flags
    individually and the checkout wants them as one answer.
    """
    return bool(
        item_doc.get("requires_dog", False)
        or item_doc.get("requires_approval", False)
        or item_doc.get("requires_completed_onboarding", False)
    )


def guest_block_reason(
    kind: str,
    item_doc: Optional[dict],
    *,
    price_visible: bool = True,
) -> Optional[str]:
    """Why a guest may not buy this — or None when they may.

    A pure function of the item as it is right now. It reads no settings and
    touches no database, so the storefront can call it once per catalog row
    while it is building a page, and checkout can call it again per cart line
    at the moment of charging, and both get the same answer for the same
    input.
    """
    if item_doc is None:
        return "This item is no longer available."
    if kind not in GUEST_FULFILLABLE_KINDS:
        return _ACCOUNT_BOUND_REASON.get(kind, _GENERIC_ACCOUNT_REASON)

    if kind == "gift_card":
        # Nothing per-card to opt into: the amounts themselves are the
        # configuration, and a shop that sells no gift cards offers no
        # amounts at all (gift_cards.shop.offered_amounts). A card carries
        # no requirements, no stock and no account — it is money.
        return None

    # ── product ──
    if not item_doc.get("active", True):
        return "This item is no longer available."
    if item_doc.get("sales_destination") == "shopify_external":
        # A display-only link. Shopify owns its price, its stock and its
        # checkout; it has never been purchasable in this cart by anyone,
        # signed in or not, and saying "guest checkout" about it would be
        # an offer we cannot honour.
        return "This item is sold through our Shopify store."
    if not item_doc.get("guest_cart_allowed", False):
        # Opt-in, per product, off by default. The absence of a decision is
        # not a yes.
        return "Please sign in to buy this."
    if account_requirements(item_doc):
        return _GENERIC_ACCOUNT_REASON
    if not price_visible:
        # A price the visitor was never shown is a price they cannot agree
        # to. Whether it is hidden shop-wide or on this one item, the same
        # thing is true.
        return "Please sign in to see the price."
    return None


def guest_purchasable(
    kind: str,
    item_doc: Optional[dict],
    *,
    price_visible: bool = True,
) -> bool:
    """The rule, as a yes or no. `guest_block_reason` is the same rule with
    its reasoning attached; this is for callers that only need the verdict."""
    return guest_block_reason(kind, item_doc, price_visible=price_visible) is None


def cart_split(lines) -> dict:
    """Sort already-normalized cart lines into what a guest may buy and what
    they may not, keeping the reason for each refusal.

    `lines` are (kind, item_doc, price_visible) triples — the caller looks
    the documents up, because only the caller knows whether it is holding
    catalog rows or freshly-read database rows.
    """
    allowed, blocked = [], []
    for kind, item_doc, price_visible in lines:
        reason = guest_block_reason(kind, item_doc, price_visible=price_visible)
        if reason is None:
            allowed.append(kind)
        else:
            blocked.append({"kind": kind, "reason": reason})
    return {"allowed": allowed, "blocked": blocked, "guest_ok": not blocked}
