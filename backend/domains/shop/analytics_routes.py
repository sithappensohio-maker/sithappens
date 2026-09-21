"""Taking events in, and giving numbers back.

Two very different audiences, so two very different doors:

  * ingestion is open to anybody browsing the shop, signed in or not,
    because a guest's behaviour is most of what there is to learn from. It
    is therefore treated as hostile input throughout: an allowlist builds
    every row, a browser may not name its own client_id, and the events that
    would let a stranger invent sales are refused outright.

  * reporting requires an admin with the finance-reports permission — the
    same gate the rest of the money reporting uses. An ordinary client
    cannot reach it, and neither can a staff account without that
    permission.

Ingestion never blocks anything. It is fire-and-forget from the page's point
of view, it answers quickly, and a failure to record analytics can never
stop somebody buying something.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel, Field

from domains.shop import analytics
from domains.shop import analytics_reports as reports

# Ranges the dashboard offers. A custom range is allowed, and capped: a
# query spanning years would scan far more than the retention window holds.
MAX_RANGE_DAYS = 400


class EventIn(BaseModel):
    event: str = Field(max_length=40)
    kind: Optional[str] = Field(default=None, max_length=40)
    ref_id: Optional[str] = Field(default=None, max_length=128)
    department: Optional[str] = Field(default=None, max_length=40)
    query: Optional[str] = Field(default=None, max_length=300)
    result_count: Optional[int] = None
    quantity: Optional[int] = None
    rec_source: Optional[str] = Field(default=None, max_length=40)
    order_id: Optional[str] = Field(default=None, max_length=128)
    source: Optional[str] = Field(default=None, max_length=60)
    dedupe_key: Optional[str] = Field(default=None, max_length=160)


class EventBatchIn(BaseModel):
    """A page's worth of events, plus the little that describes the visit."""
    session: str = Field(min_length=1, max_length=128)
    viewport_width: Optional[int] = None
    events: List[EventIn] = Field(min_length=1, max_length=analytics.MAX_BATCH)


def register_shop_analytics_routes(*, api, server_globals: dict) -> None:
    def _s(name):
        return server_globals[name]

    async def _limit(request: Request, bucket: str, *, limit: int, window: int) -> None:
        await _s("_enforce_rate_limit")(
            request, bucket, _s("_client_ip")(request), limit=limit, window_seconds=window)

    def _range(start: Optional[str], end: Optional[str], days: Optional[int]):
        """Resolve a date range to UTC bounds, the app's own way.

        Both ends come from `_business_range_utc_bounds`, so a 9pm Eastern
        event lands in the right day and a DST boundary resolves without a
        hard-coded offset. Events and orders are then both filtered on their
        UTC timestamp against the SAME bounds — nothing relies on a stored
        day string agreeing with a queried range.
        """
        today = _s("business_today")()
        from datetime import date, timedelta
        if start and end:
            try:
                s, e = date.fromisoformat(start), date.fromisoformat(end)
            except ValueError:
                raise HTTPException(status_code=422, detail="Dates must be YYYY-MM-DD.")
            if e < s:
                raise HTTPException(status_code=422, detail="The end date is before the start date.")
            if (e - s).days > MAX_RANGE_DAYS:
                raise HTTPException(status_code=422, detail=f"Pick a range of {MAX_RANGE_DAYS} days or fewer.")
        else:
            n = days if isinstance(days, int) and 1 <= days <= MAX_RANGE_DAYS else 7
            e = today
            s = today - timedelta(days=n - 1)
        start_utc, end_utc = _s("_business_range_utc_bounds")(s.isoformat(), e.isoformat())
        return s.isoformat(), e.isoformat(), start_utc, end_utc

    # ─────────────────────────────────────────────────────────── ingestion

    @api.post("/public/shop/events")
    async def record_shop_events(body: EventBatchIn, request: Request):
        """Record a batch of shop events.

        Deliberately one route for guests and signed-in clients both. The
        difference is not which door they come through, it is that a signed-
        in request gets its client_id from ITS OWN SESSION — the body cannot
        name one, so nobody can attribute their browsing to somebody else.
        """
        await _limit(request, "shop_events", limit=240, window=60)

        # Identity comes from the token if there is one, and from nowhere
        # else. The body cannot name a client_id, so no request can attribute
        # one person's browsing to another. An absent, expired or malformed
        # token simply means "a guest" — this route must work for somebody
        # who has never signed in, which is most of who it is for.
        client_id = None
        try:
            user = await _s("get_current_user")(request, None)
            if user and user.get("role") == "client":
                client_id = user.get("client_id")
        except Exception:
            client_id = None

        session = analytics.session_id_from(body.session)
        device = analytics.device_class(body.viewport_width)
        business_date = _s("business_today")().isoformat()
        rows = [
            analytics.build_event(
                e.model_dump(), client_id=client_id, session=session,
                device=device, business_date=business_date)
            for e in body.events
        ]
        written = await analytics.record_many(_s("db"), rows)
        return {"recorded": written}

    # ─────────────────────────────────────────────────────────── reporting

    def _admin():
        return Depends(_s("require_admin_and_permission")("finance_reports"))

    @api.get("/shop-manager/analytics/overview")
    async def shop_analytics_overview(
        start: Optional[str] = None, end: Optional[str] = None, days: Optional[int] = None,
        _: dict = _admin(),
    ):
        """The one dashboard payload: sales, funnel, departments, searches.

        One call rather than six, because six panels loading independently
        is six chances to see a half-drawn screen, and because they share
        the same order read.
        """
        db = _s("db")
        start_day, end_day, start_utc, end_utc = _range(start, end, days)
        orders = await reports._paid_orders(db, start_utc, end_utc)
        catalog = await _s("_build_shop_catalog")(None)
        fulfillment_by_ref = {i["id"]: i.get("purchase_fulfillment") for i in catalog["items"]}
        catalog_by_ref = {i["id"]: i for i in catalog["items"]}

        events_by_ref = await reports.per_ref_counts(
            db, start_utc, end_utc, ["product_impression", "product_view", "add_to_cart"])
        sales_by_ref = reports.units_by_ref(orders)
        product_rows = reports.product_funnel(events_by_ref, sales_by_ref, catalog_by_ref)

        counts = await reports.event_counts(
            db, start_utc, end_utc,
            ["search", "search_zero_results", "favorite_add", "buy_again",
             "recommendation_click", "shopify_outbound"])

        return {
            "range": {"start": start_day, "end": end_day},
            "sales": reports.sales_snapshot(orders),
            "funnel": await reports.shop_funnel(db, start_utc, end_utc, orders),
            "departments": reports.department_performance(orders, fulfillment_by_ref),
            "top_products": product_rows[:10],
            "viewed_not_bought": reports.looked_at_but_not_bought(product_rows),
            "searches": await reports.search_intelligence(db, start_utc, end_utc),
            "best_sellers": await _best_sellers(db),
            "splits": {
                "audience": await reports.split_by(db, start_utc, end_utc, "is_guest", ["shop_view"]),
                "device": await reports.split_by(db, start_utc, end_utc, "device", ["shop_view"]),
            },
            "activity": counts,
        }

    @api.get("/shop-manager/analytics/products")
    async def shop_analytics_products(
        start: Optional[str] = None, end: Optional[str] = None, days: Optional[int] = None,
        department: Optional[str] = None, _: dict = _admin(),
    ):
        """Every product's funnel, for the table an owner sorts through."""
        db = _s("db")
        start_day, end_day, start_utc, end_utc = _range(start, end, days)
        orders = await reports._paid_orders(db, start_utc, end_utc)
        catalog = await _s("_build_shop_catalog")(None)
        catalog_by_ref = {i["id"]: i for i in catalog["items"]}
        events_by_ref = await reports.per_ref_counts(
            db, start_utc, end_utc, ["product_impression", "product_view", "add_to_cart"])
        rows = reports.product_funnel(events_by_ref, reports.units_by_ref(orders), catalog_by_ref)
        if department:
            rows = [r for r in rows if r["department"] == department]
        return {"range": {"start": start_day, "end": end_day}, "products": rows}

    @api.get("/shop-manager/analytics/searches")
    async def shop_analytics_searches(
        start: Optional[str] = None, end: Optional[str] = None, days: Optional[int] = None,
        _: dict = _admin(),
    ):
        """What people looked for, what found nothing, and what led somewhere."""
        db = _s("db")
        start_day, end_day, start_utc, end_utc = _range(start, end, days)
        intelligence = await reports.search_intelligence(db, start_utc, end_utc, limit=30)
        return {
            "range": {"start": start_day, "end": end_day},
            **intelligence,
            "searches_that_led_somewhere": await reports.searches_that_led_somewhere(
                db, start_utc, end_utc),
        }

    async def _best_sellers(db) -> List[Dict[str, Any]]:
        """The badge's own window, independent of whatever range is on screen.

        A Best Seller is a property of the last thirty days, not of the
        dates an admin happens to be looking at — otherwise the badge would
        change meaning every time somebody adjusted a filter.
        """
        from datetime import timedelta
        today = _s("business_today")()
        start = (today - timedelta(days=reports.BEST_SELLER_WINDOW_DAYS - 1)).isoformat()
        s_utc, e_utc = _s("_business_range_utc_bounds")(start, today.isoformat())
        return reports.best_sellers(await reports._paid_orders(db, s_utc, e_utc))

    @api.get("/shop-manager/analytics/best-sellers")
    async def shop_best_sellers(_: dict = _admin()):
        """What the Best Seller badge would say right now, and why."""
        return {
            "rule": {
                "window_days": reports.BEST_SELLER_WINDOW_DAYS,
                "top_n": reports.BEST_SELLER_TOP_N,
                "minimum_units": reports.BEST_SELLER_MIN_UNITS,
                "explanation": (
                    f"Top {reports.BEST_SELLER_TOP_N} by completed units sold in the last "
                    f"{reports.BEST_SELLER_WINDOW_DAYS} days, and at least "
                    f"{reports.BEST_SELLER_MIN_UNITS} units. Nothing qualifies if the shop "
                    "has not sold enough for the badge to mean anything."
                ),
            },
            "best_sellers": await _best_sellers(_s("db")),
        }
