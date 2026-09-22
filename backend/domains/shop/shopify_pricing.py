"""The price a Shopify-linked product shows in our Shop.

Shopify owns the price of these products; we only mirror it. The mirror had a
hole: the catalogue row for a `shopify_external` product carried
`shopify_display_price` but no `price` key at all, and the storefront card
rendered `money(item.price)` — which turned `undefined` into `$0.00`. Every
Shopify product on the Shop advertised itself as free.

So this module answers one question, in one place: what should we print under
this product, and are we sure enough to print a number at all?

Three shapes are understood, because a price can reach us three ways:

  1. `shopify_display_price` / `shopify_from_price` — what an admin types in
     today. There is no Shopify API integration in this project; these fields
     are the whole of it.
  2. `variants[].price` — the REST shape, if a sync is ever added.
  3. `priceRange.minVariantPrice.amount` — the GraphQL/Storefront shape.

Structured Shopify data wins over the typed-in mirror when both are present,
because Shopify is authoritative for these products and a hand-entered number
is the thing most likely to be stale.

The one rule that matters: a missing price is never a zero. `has_price` False
means "we do not know", and the caller is expected to say so out loud rather
than claim the item is free.
"""

from typing import Any, Optional

# A price we are not sure about is worth less than no price at all, so the
# threshold is deliberately "greater than zero" rather than "not None".
# Shopify merch is not free, and `$0.00` is how a missing value looks when
# nobody checked. Genuinely free items are handled elsewhere (free-claimable
# courses), never by falling through to this.
_MIN_REAL_PRICE = 0.0


def _num(value: Any) -> Optional[float]:
    """A price as a number, or None if it is not one.

    Shopify sends money as a string ("24.99") over REST and GraphQL alike,
    Mongo may hand back a Decimal128, and an admin form posts whatever the
    input had. Booleans are rejected explicitly because `bool` is an `int`
    in Python and `True` would otherwise read as $1.00.
    """
    if value is None or isinstance(value, bool):
        return None
    try:
        out = float(str(value).strip())
    except (TypeError, ValueError):
        return None
    if out != out or out in (float("inf"), float("-inf")):  # NaN / inf
        return None
    return out if out > _MIN_REAL_PRICE else None


def _variant_prices(doc: dict) -> list:
    """Every price we could actually charge, cheapest first.

    Prefers variants Shopify says are purchasable. If none are — everything is
    sold out — the prices still describe the product honestly, so they are used
    rather than showing nothing.
    """
    raw = doc.get("variants")
    if not isinstance(raw, list):
        return []
    available, every = [], []
    for v in raw:
        if isinstance(v, dict):
            price = _num(v.get("price"))
            sellable = v.get("availableForSale", v.get("available", True))
        else:
            price, sellable = _num(v), True
        if price is None:
            continue
        every.append(price)
        if sellable is not False:
            available.append(price)
    return sorted(available or every)


def _range_prices(doc: dict) -> list:
    """min/max from the GraphQL `priceRange` shape."""
    pr = doc.get("priceRange")
    if not isinstance(pr, dict):
        return []
    out = []
    for key in ("minVariantPrice", "maxVariantPrice"):
        node = pr.get(key)
        if isinstance(node, dict):
            amount = _num(node.get("amount"))
        else:
            amount = _num(node)
        if amount is not None:
            out.append(amount)
    return sorted(out)


def resolve(doc: dict) -> dict:
    """What this product's price line should say.

    Returns `amount` (the lowest purchasable price), `from_price` (whether
    cheaper-of-several should be signalled), `has_price`, and a ready-made
    `display` string — or `display: None` when we genuinely do not know, which
    is the caller's cue to point at Shopify instead of inventing a number.
    """
    doc = doc or {}

    prices = _variant_prices(doc) or _range_prices(doc)
    if prices:
        lowest = prices[0]
        # More than one distinct price means the number we show is a floor,
        # not the price — say "From" so nobody arrives at checkout surprised.
        from_price = len(set(prices)) > 1
    else:
        lowest = _num(doc.get("shopify_display_price"))
        from_price = bool(doc.get("shopify_from_price")) if lowest is not None else False

    if lowest is None:
        return {"amount": None, "from_price": False, "has_price": False, "display": None}

    amount = round(lowest, 2)
    money = f"${amount:,.2f}"
    return {
        "amount": amount,
        "from_price": from_price,
        "has_price": True,
        "display": f"From {money}" if from_price else money,
    }
