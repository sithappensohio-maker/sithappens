"""Turning events and orders into the handful of numbers worth looking at.

Where each number comes from is the whole design, so it is stated once here
and never varied:

    MONEY, ORDERS, UNITS      →  shop_orders, status == "paid"
    BEHAVIOUR (views, carts,  →  shop_events
     searches, checkout starts)

That split is not tidiness. It means a stranger posting invented events can
move a view count and can never move a dollar, and it means the revenue on
this dashboard is the same revenue the accounting sees, because it is read
from the same rows.

Dates follow the app's existing business-day rule, through the app's own
`_business_range_utc_bounds`. Events and orders are both filtered on their
UTC timestamp against those bounds, so nothing depends on a stored day
string agreeing with a queried range — the exact class of brittleness that
has already bitten this project's tax reporting once.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

# ── departments ─────────────────────────────────────────────────────────
#
# The same five the storefront shows, decided the same way (see
# frontend/src/lib/shopDepartments.js). Mirrored rather than imported
# because one is Python and one is JavaScript; kept deliberately tiny so
# the two cannot drift far.

DEPARTMENT_LABELS = {
    "gear": "Gear",
    "training": "Training",
    "online_school": "Online School",
    "prepaid": "Prepaid Visits",
    "gift_cards": "Gift Cards",
}


def department_of(kind: Optional[str], fulfillment: Optional[str] = None) -> Optional[str]:
    if kind == "product":
        return "gear"
    if kind == "credit_pack":
        return "prepaid"
    if kind == "gift_card":
        return "gift_cards"
    if kind == "training_program":
        return "online_school" if fulfillment == "online_school" else "training"
    return None


def _money(value) -> float:
    try:
        return round(float(value or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def _rate(numerator: float, denominator: float) -> Optional[float]:
    """A percentage, or None when there is nothing to divide by.

    None rather than 0: "no views yet" and "lots of views, no sales" are
    different facts, and a dashboard that prints 0% for both tells an owner
    something untrue about a product nobody has seen.
    """
    if not denominator:
        return None
    return round((numerator / denominator) * 100, 1)


# ── the money half: read from orders, never from events ──────────────────

async def _paid_orders(db, start_utc: str, end_utc: str) -> List[dict]:
    return await db.shop_orders.find(
        {"status": "paid", "created_at": {"$gte": start_utc, "$lt": end_utc}},
        {"_id": 0, "id": 1, "created_at": 1, "total": 1, "subtotal": 1,
         "refunded_amount": 1, "lines": 1, "is_guest_order": 1, "client_id": 1},
    ).to_list(20000)


def _line_revenue(line: dict) -> float:
    """What this line actually earned, after anything given back.

    A refunded line is not revenue. Netting it here rather than reporting
    gross means the dashboard and the accounting agree about a month in
    which something was returned.
    """
    return round(_money(line.get("line_total")) - _money(line.get("amount_refunded")), 2)


def _line_units(line: dict) -> int:
    sold = int(line.get("quantity") or 0) - int(line.get("quantity_refunded") or 0)
    return max(0, sold)


def sales_snapshot(orders: List[dict]) -> Dict[str, Any]:
    """Revenue, orders, units, average order value."""
    revenue = 0.0
    units = 0
    guest_orders = 0
    for order in orders:
        for line in order.get("lines") or []:
            revenue += _line_revenue(line)
            units += _line_units(line)
        if order.get("is_guest_order"):
            guest_orders += 1
    count = len(orders)
    return {
        "revenue": round(revenue, 2),
        "orders": count,
        "units": units,
        # AOV over ORDERS, not over line items — the number an owner means
        # when they ask what a typical basket is worth.
        "average_order_value": round(revenue / count, 2) if count else None,
        "guest_orders": guest_orders,
        "account_orders": count - guest_orders,
    }


def department_performance(orders: List[dict], fulfillment_by_ref: Dict[str, str]) -> List[Dict[str, Any]]:
    """Money by department.

    Exact, not attributed: each order line carries its own total, so a cart
    holding a leash and a course splits between Gear and Online School with
    no guesswork. This is the one place where a multi-item basket does NOT
    create an attribution problem, and it is worth saying so.
    """
    rows: Dict[str, Dict[str, Any]] = {}
    for order in orders:
        for line in order.get("lines") or []:
            dept = department_of(line.get("kind"),
                                 line.get("fulfillment_kind")
                                 or fulfillment_by_ref.get(str(line.get("ref_id"))))
            if not dept:
                continue
            row = rows.setdefault(dept, {"department": dept, "label": DEPARTMENT_LABELS[dept],
                                         "revenue": 0.0, "units": 0, "orders": set()})
            row["revenue"] = round(row["revenue"] + _line_revenue(line), 2)
            row["units"] += _line_units(line)
            row["orders"].add(order["id"])
    out = [{**r, "orders": len(r["orders"])} for r in rows.values()]
    out.sort(key=lambda r: (-r["revenue"], r["department"]))
    return out


def units_by_ref(orders: List[dict]) -> Dict[str, Dict[str, Any]]:
    """Units and revenue per item reference, from paid orders alone."""
    out: Dict[str, Dict[str, Any]] = {}
    for order in orders:
        for line in order.get("lines") or []:
            ref = str(line.get("ref_id") or "")
            if not ref:
                continue
            row = out.setdefault(ref, {"kind": line.get("kind"), "name": line.get("name"),
                                       "units": 0, "revenue": 0.0, "orders": set()})
            row["units"] += _line_units(line)
            row["revenue"] = round(row["revenue"] + _line_revenue(line), 2)
            row["orders"].add(order["id"])
    for row in out.values():
        row["orders"] = len(row["orders"])
    return out


# ── the behaviour half: read from events ─────────────────────────────────

async def event_counts(db, start_utc: str, end_utc: str, names: List[str]) -> Dict[str, int]:
    """How many of each event, in one aggregation rather than one query per
    name. Indexed on (event, at)."""
    pipeline = [
        {"$match": {"event": {"$in": names}, "at": {"$gte": start_utc, "$lt": end_utc}}},
        {"$group": {"_id": "$event", "n": {"$sum": 1}}},
    ]
    rows = await db.shop_events.aggregate(pipeline).to_list(100)
    return {r["_id"]: r["n"] for r in rows}


async def distinct_sessions(db, start_utc: str, end_utc: str, names: List[str]) -> Dict[str, int]:
    """Distinct SESSIONS per event, which is what a funnel step means.

    "Product viewers" is people who looked at a product, not page views: a
    funnel counting views would happily report more viewers than visitors.
    """
    pipeline = [
        {"$match": {"event": {"$in": names}, "at": {"$gte": start_utc, "$lt": end_utc}}},
        {"$group": {"_id": {"event": "$event", "session": "$session_id"}}},
        {"$group": {"_id": "$_id.event", "n": {"$sum": 1}}},
    ]
    rows = await db.shop_events.aggregate(pipeline).to_list(100)
    return {r["_id"]: r["n"] for r in rows}


async def per_ref_counts(db, start_utc: str, end_utc: str, names: List[str]) -> Dict[str, Dict[str, int]]:
    """Per-item event counts, keyed ref_id -> {event: n}."""
    pipeline = [
        {"$match": {"event": {"$in": names}, "at": {"$gte": start_utc, "$lt": end_utc},
                    "ref_id": {"$exists": True}}},
        {"$group": {"_id": {"ref": "$ref_id", "event": "$event"}, "n": {"$sum": 1}}},
    ]
    rows = await db.shop_events.aggregate(pipeline).to_list(20000)
    out: Dict[str, Dict[str, int]] = {}
    for r in rows:
        out.setdefault(r["_id"]["ref"], {})[r["_id"]["event"]] = r["n"]
    return out


async def shop_funnel(db, start_utc: str, end_utc: str, orders: List[dict]) -> Dict[str, Any]:
    """Shop visitors → product viewers → carts → checkout starts → orders.

    Every step but the last counts DISTINCT SESSIONS, so the funnel narrows
    the way a funnel should. The last step counts orders from the order
    collection, because that is the only number here that is money-adjacent
    and it is not the browser's to report.
    """
    sessions = await distinct_sessions(
        db, start_utc, end_utc,
        ["shop_view", "product_view", "add_to_cart", "checkout_started"])
    visitors = sessions.get("shop_view", 0)
    viewers = sessions.get("product_view", 0)
    carts = sessions.get("add_to_cart", 0)
    starts = sessions.get("checkout_started", 0)
    completed = len(orders)
    return {
        "visitors": visitors,
        "product_viewers": viewers,
        "carts": carts,
        "checkout_starts": starts,
        "orders": completed,
        "rates": {
            # Each rate is the step over the one above it, plus the single
            # end-to-end number an owner actually asks for.
            "visit_to_product_view": _rate(viewers, visitors),
            "product_view_to_cart": _rate(carts, viewers),
            "cart_to_checkout": _rate(starts, carts),
            "checkout_to_order": _rate(completed, starts),
            "visit_to_order": _rate(completed, visitors),
        },
    }


async def split_by(db, start_utc: str, end_utc: str, field: str, names: List[str]) -> Dict[str, int]:
    """Distinct sessions split by one dimension — guest/auth, or device."""
    pipeline = [
        {"$match": {"event": {"$in": names}, "at": {"$gte": start_utc, "$lt": end_utc}}},
        {"$group": {"_id": {"k": f"${field}", "session": "$session_id"}}},
        {"$group": {"_id": "$_id.k", "n": {"$sum": 1}}},
    ]
    rows = await db.shop_events.aggregate(pipeline).to_list(50)
    return {str(r["_id"]): r["n"] for r in rows if r["_id"] is not None}


async def search_intelligence(db, start_utc: str, end_utc: str, limit: int = 15) -> Dict[str, Any]:
    """What people typed, and what came back empty.

    The zero-results list is the most useful thing in this whole file: it is
    a list of products customers expected to find here and did not.
    """
    async def top(match: dict) -> List[Dict[str, Any]]:
        pipeline = [
            {"$match": {**match, "at": {"$gte": start_utc, "$lt": end_utc},
                        "query": {"$exists": True, "$ne": ""}}},
            {"$group": {"_id": "$query", "searches": {"$sum": 1},
                        "sessions": {"$addToSet": "$session_id"}}},
            {"$project": {"query": "$_id", "searches": 1, "sessions": {"$size": "$sessions"}, "_id": 0}},
            {"$sort": {"searches": -1, "query": 1}},
            {"$limit": limit},
        ]
        return await db.shop_events.aggregate(pipeline).to_list(limit)

    return {
        "top_searches": await top({"event": "search"}),
        "zero_result_searches": await top({"event": "search_zero_results"}),
    }


async def searches_that_led_somewhere(db, start_utc: str, end_utc: str, limit: int = 10) -> List[Dict[str, Any]]:
    """Searches whose session went on to view a product or add to a cart.

    Session-level, and honestly so: this says "the session that ran this
    search later did X", not "this search caused X". Somebody may have
    searched, given up, browsed a department and bought from there. That is
    still a far more useful signal than a raw search count, and calling it
    correlation rather than attribution is the difference between a report
    an owner can trust and one that flatters the search box.
    """
    pipeline = [
        {"$match": {"event": "search", "at": {"$gte": start_utc, "$lt": end_utc},
                    "query": {"$exists": True, "$ne": ""}}},
        {"$group": {"_id": {"q": "$query", "s": "$session_id"}}},
        {"$group": {"_id": "$_id.q", "sessions": {"$addToSet": "$_id.s"}}},
        {"$project": {"query": "$_id", "sessions": 1, "_id": 0}},
    ]
    rows = await db.shop_events.aggregate(pipeline).to_list(500)
    if not rows:
        return []
    all_sessions = sorted({s for r in rows for s in r["sessions"]})
    outcome_pipeline = [
        {"$match": {"event": {"$in": ["product_view", "add_to_cart"]},
                    "at": {"$gte": start_utc, "$lt": end_utc},
                    "session_id": {"$in": all_sessions}}},
        {"$group": {"_id": {"s": "$session_id", "e": "$event"}}},
    ]
    outcomes = await db.shop_events.aggregate(outcome_pipeline).to_list(20000)
    viewed = {o["_id"]["s"] for o in outcomes if o["_id"]["e"] == "product_view"}
    carted = {o["_id"]["s"] for o in outcomes if o["_id"]["e"] == "add_to_cart"}
    out = []
    for r in rows:
        sessions = set(r["sessions"])
        out.append({
            "query": r["query"],
            "sessions": len(sessions),
            "led_to_product_view": len(sessions & viewed),
            "led_to_add_to_cart": len(sessions & carted),
        })
    out.sort(key=lambda r: (-r["led_to_add_to_cart"], -r["led_to_product_view"], -r["sessions"]))
    return out[:limit]


# ── the product funnel ───────────────────────────────────────────────────
#
# Formulas, stated once:
#
#   impressions       count of product_impression        (events)
#   views             count of product_view              (events)
#   cart_adds         count of add_to_cart               (events)
#   units             paid quantity minus refunded       (orders)
#   revenue           paid line_total minus refunded     (orders)
#
#   view_to_cart      cart_adds / views
#   cart_to_purchase  units / cart_adds
#   view_to_purchase  units / views
#
# What is deliberately NOT here is a per-product checkout-start figure. A
# checkout start belongs to a CART, and a cart can hold four things; splitting
# one start four ways would invent a number. Checkout starts are reported at
# shop and department level only, where they are real.

def product_funnel(events_by_ref: Dict[str, Dict[str, int]],
                   sales_by_ref: Dict[str, Dict[str, Any]],
                   catalog_by_ref: Dict[str, dict]) -> List[Dict[str, Any]]:
    refs = set(events_by_ref) | set(sales_by_ref)
    rows = []
    for ref in refs:
        ev = events_by_ref.get(ref, {})
        sale = sales_by_ref.get(ref, {})
        item = catalog_by_ref.get(ref) or {}
        views = ev.get("product_view", 0)
        cart_adds = ev.get("add_to_cart", 0)
        units = int(sale.get("units", 0))
        kind = item.get("kind") or sale.get("kind")
        rows.append({
            "ref_id": ref,
            "kind": kind,
            # The live name where the item still exists, the name it was sold
            # under otherwise — so a withdrawn product still reads as itself.
            "name": item.get("name") or sale.get("name") or "(no longer in the catalogue)",
            "department": department_of(kind, item.get("purchase_fulfillment")),
            "available": ref in catalog_by_ref,
            "impressions": ev.get("product_impression", 0),
            "views": views,
            "cart_adds": cart_adds,
            "units": units,
            "revenue": round(float(sale.get("revenue", 0.0)), 2),
            "orders": int(sale.get("orders", 0)),
            "stock_on_hand": item.get("stock_on_hand") if item.get("track_inventory") else None,
            "view_to_cart": _rate(cart_adds, views),
            "cart_to_purchase": _rate(units, cart_adds),
            "view_to_purchase": _rate(units, views),
        })
    rows.sort(key=lambda r: (-r["revenue"], -r["units"], -r["views"], r["name"]))
    return rows


def looked_at_but_not_bought(rows: List[Dict[str, Any]], *, min_views: int = 5,
                             limit: int = 10) -> List[Dict[str, Any]]:
    """Products people keep opening and nobody buys.

    `min_views` exists so a product with one view and no sale does not top
    the list at a 0% conversion rate. One view is not evidence of anything.
    """
    out = [r for r in rows if r["views"] >= min_views and r["units"] == 0]
    out.sort(key=lambda r: (-r["views"], r["name"]))
    return out[:limit]


# ── best sellers ─────────────────────────────────────────────────────────

# The rule, in full, so the badge can be defended:
#
#   A product is a Best Seller when, over the trailing 30 business days, it
#   is in the TOP 5 by completed units sold AND has sold at least 5 units.
#
# Both halves matter. Top-5 alone would crown whatever sold twice in a quiet
# month; a threshold alone would badge everything in a good one. Units rather
# than revenue, because revenue makes the most expensive thing the "best
# seller" whether or not anybody bought it twice.
#
# Nobody can set this by hand. It is computed from paid orders, and if the
# shop has not sold enough for the badge to mean anything, NOTHING is badged
# — which is the honest outcome for a small shop in a slow month.

BEST_SELLER_WINDOW_DAYS = 30
BEST_SELLER_TOP_N = 5
BEST_SELLER_MIN_UNITS = 5


def best_sellers(orders: List[dict]) -> List[Dict[str, Any]]:
    sales = units_by_ref(orders)
    qualifying = [
        {"ref_id": ref, "kind": row["kind"], "name": row["name"],
         "units": row["units"], "revenue": row["revenue"]}
        for ref, row in sales.items() if row["units"] >= BEST_SELLER_MIN_UNITS
    ]
    qualifying.sort(key=lambda r: (-r["units"], -r["revenue"], r["name"]))
    return qualifying[:BEST_SELLER_TOP_N]


# ── the badge, cached ────────────────────────────────────────────────────
#
# Working out the best sellers means reading thirty days of paid orders, and
# the catalogue is built on every shop page load. Doing both together would
# make browsing pay for a badge, so the answer is cached for a few minutes.
#
# Staleness is fine here in a way it would never be for a price: the badge
# describes a thirty-day trend, and a trend that is five minutes out of date
# is the same trend.

_BEST_SELLER_CACHE: Dict[str, Any] = {"at": 0.0, "ids": frozenset()}
_BEST_SELLER_TTL_SECONDS = 600


async def best_seller_ids(db, *, today_iso: str, bounds) -> frozenset:
    """The ids the Best Seller badge applies to right now.

    Never raises. A catalogue must load whether or not this works — the
    badge is decoration, and a shop that will not open because a badge could
    not be computed is a far worse outcome than a missing badge.
    """
    import time
    now = time.monotonic()
    if now - _BEST_SELLER_CACHE["at"] < _BEST_SELLER_TTL_SECONDS:
        return _BEST_SELLER_CACHE["ids"]
    try:
        from datetime import date, timedelta
        end = date.fromisoformat(today_iso)
        start = end - timedelta(days=BEST_SELLER_WINDOW_DAYS - 1)
        start_utc, end_utc = bounds(start.isoformat(), end.isoformat())
        orders = await _paid_orders(db, start_utc, end_utc)
        ids = frozenset(row["ref_id"] for row in best_sellers(orders))
    except Exception:
        ids = _BEST_SELLER_CACHE["ids"]
    _BEST_SELLER_CACHE.update({"at": now, "ids": ids})
    return ids


def reset_best_seller_cache() -> None:
    """For tests, which must not see a previous test's badge."""
    _BEST_SELLER_CACHE.update({"at": 0.0, "ids": frozenset()})
