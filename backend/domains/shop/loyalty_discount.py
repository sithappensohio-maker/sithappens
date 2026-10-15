"""Automatic Shop discount for regular clients.

Once a client's lifetime visit count — the SAME count the "visit_count"
trophy award and GET /clients/{id}/visits already use (live + archived
bookings, every one of their dogs, see trophy_service._client_visit_count)
— reaches settings.loyalty.loyalty_tier_bronze_visits, every Shop checkout
gets loyalty_tier_bronze_shop_discount_pct off automatically. Nothing to
enter, nothing to redeem; GET /shop/loyalty-discount lets the Shop page
show it before the client ever opens the cart (owner request 2026-10-15:
"regular clients with at least 10 visits auto get the 10 percent in the
shop ... make it visible to them").

Reuses the Bronze-tier visit setting that already existed (until now shown
disabled, "Not enforced by the app yet", in Day-to-Day Controls) rather
than inventing a parallel one. Silver/gold/platinum stay exactly as
unused as before — this wires up Bronze only, the one perk asked for.

Never stacks with a manual code (domains.shop.discount_codes) —
_price_shop_cart takes whichever discount is larger for a given cart, so
a loyal client is never worse off for having typed in a weaker code, and
the two can't combine into a discount depth nobody reviewed. A tie
favors this discount over a code, since it costs nothing extra and
doesn't use up a limited code's uses. Guests are never eligible — they
have no visit history.
"""
from __future__ import annotations

from typing import Optional

import trophy_service


async def eligible_discount(db, client_id: Optional[str], *, settings: dict) -> Optional[dict]:
    """None when there's no client, the discount is off (threshold or pct
    is 0), or this client hasn't reached the threshold yet. Otherwise
    {pct, min_visits, visits}.

    Defaults to 10 visits / 10% when either key is simply ABSENT from a
    settings doc (same `.get(key, default)` convention as the Shop
    rewards threshold) so this works immediately on the one already-
    deployed settings document, not just a freshly-seeded one — an admin
    only has to touch Day-to-Day Controls to change or disable it."""
    if not client_id:
        return None
    loyalty = (settings or {}).get("loyalty") or {}
    threshold = int(loyalty.get("loyalty_tier_bronze_visits", 10) or 0)
    pct = round(float(loyalty.get("loyalty_tier_bronze_shop_discount_pct", 10) or 0), 2)
    if threshold <= 0 or pct <= 0:
        return None
    visits = await trophy_service._client_visit_count(db, client_id)
    if visits < threshold:
        return None
    return {"pct": pct, "min_visits": threshold, "visits": visits}
