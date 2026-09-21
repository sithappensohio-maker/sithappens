"""Business intelligence that cannot be lied to.

The premise of this file is that the ingestion endpoint is a public, unauthenticated
POST, which means anybody on the internet can send it anything. So most of what
follows is one question:

    can a stranger with curl change a number the owner would act on?

The answer has to be no for every number that matters, and the reason it is no
is structural rather than defensive: **money is never read from events.**
Revenue, units and orders come from `shop_orders` where status == "paid" — the
same rows the accounting reads. A forged event can move a view count. It cannot
move a dollar, and several tests below try.

The rest is about the numbers being *right*: business-day boundaries that do not
drift, rates that say "no data" instead of "0%", a Best Seller badge that stays
empty until the sales support it.

Every test isolates its own data and its own date range. Analytics aggregates are
exactly where a suite starts passing because of somebody else's leftover rows.
"""
import contextlib
import uuid
from datetime import datetime, timedelta, timezone

import _test_env  # noqa: F401 — must run before `import server`
import server
from _test_loop import run
from fastapi import HTTPException

from domains.shop import analytics
from domains.shop import analytics_reports as reports
from domains.shop import analytics_routes
from domains.shop import seo

TAG = "TEST_SHOP_ANALYTICS"


# ─────────────────────────────────────────────────────────────── harness

class _Req:
    def __init__(self, ip=None, token=None):
        ip = ip or f"198.20.{uuid.uuid4().int % 250}.{uuid.uuid4().int % 250}"
        self.client = type("C", (), {"host": ip})()
        self.headers = {"Authorization": f"Bearer {token}"} if token else {}
        self.url = type("U", (), {"path": "/api/public/shop/events"})()


def _admin():
    return {"id": str(uuid.uuid4()), "role": "admin", "name": f"{TAG} admin"}


def _endpoint(name):
    for r in server.app.routes:
        if getattr(r, "endpoint", None) is not None and r.endpoint.__name__ == name:
            return r.endpoint
    raise AssertionError(f"route {name} is not registered")


@contextlib.contextmanager
def _clean():
    """Every test owns its data and removes it. Analytics aggregates over a
    shared collection are exactly where a suite starts passing for the wrong
    reason."""
    marker = f"{TAG}-{uuid.uuid4().hex[:8]}"
    reports.reset_best_seller_cache()
    try:
        yield marker
    finally:
        run(server.db.shop_events.delete_many({"session_id": {"$regex": "^"} , "source": marker}))
        run(server.db.shop_events.delete_many({"ref_id": {"$regex": f"^{marker}"}}))
        run(server.db.shop_orders.delete_many({"client_name": marker}))
        reports.reset_best_seller_cache()


def _post(events, session="sess-one", width=1440, token=None):
    body = analytics_routes.EventBatchIn(
        session=session, viewport_width=width,
        events=[analytics_routes.EventIn(**e) for e in events])
    return run(_endpoint("record_shop_events")(body, _Req(token=token)))


def _stored(**query):
    return run(server.db.shop_events.find(query, {"_id": 0}).to_list(500))


def _today():
    return server.business_today().isoformat()


def _bounds(days=1):
    end = server.business_today()
    start = end - timedelta(days=days - 1)
    return server._business_range_utc_bounds(start.isoformat(), end.isoformat())


def _order(marker, lines, *, status="paid", when=None, guest=False):
    doc = dict(
        id=str(uuid.uuid4()), client_id=None if guest else f"{marker}-client",
        client_name=marker, is_guest_order=guest, status=status,
        fulfillment_status="fulfilled",
        created_at=(when or datetime.now(timezone.utc)).isoformat(),
        lines=lines, subtotal=sum(l["line_total"] for l in lines),
        total=sum(l["line_total"] for l in lines), currency="USD")
    run(server.db.shop_orders.insert_one(doc))
    doc.pop("_id", None)
    return doc


def _line(ref, name, price, qty=1, kind="product", **kw):
    out = dict(item_id=str(uuid.uuid4()), kind=kind, ref_id=ref, name=name,
               quantity=qty, unit_price=price, line_subtotal=price * qty,
               line_total=price * qty, allocated_tax=0.0, fulfillment_status="fulfilled")
    out.update(kw)
    return out


# ─────────────────────────────────────────── what may be recorded at all

def test_a_browser_cannot_declare_that_an_order_completed():
    # The single most important test in this file. If this ever fails,
    # anybody with curl can invent sales.
    for forged in ("order_completed", "checkout_completed"):
        try:
            _post([{"event": forged, "order_id": "made-up"}])
            raise AssertionError(f"a browser was allowed to post {forged}")
        except HTTPException as e:
            assert e.status_code == 403
            assert "server" in e.detail


def test_an_unknown_event_is_refused_rather_than_stored():
    try:
        _post([{"event": "steal_everything"}])
        raise AssertionError("an invented event name was accepted")
    except HTTPException as e:
        assert e.status_code == 422


def test_a_browser_cannot_name_a_client_id():
    # There is no field for it, and the row is built from an allowlist — so
    # even a body that carries one stores the truth instead.
    with _clean() as marker:
        _post([{"event": "shop_view", "ref_id": f"{marker}-x", "kind": "product"}])
        row = _stored(ref_id=f"{marker}-x")[0]
        assert row["client_id"] is None
        assert row["is_guest"] is True


def test_nothing_private_is_stored_however_it_is_sent():
    with _clean() as marker:
        # Every field a shop knows that analytics must never learn.
        _post([{
            "event": "add_to_cart", "kind": "product", "ref_id": f"{marker}-p", "quantity": 2,
            "recipient_email": "nan@example.com", "recipient_name": "Nan",
            "dog_name": "Rex", "client_name": "Sam Smith", "gift_message": "Happy birthday",
            "guest_token": "secret-token", "card_last4": "4242", "ip": "203.0.113.7",
            "user_agent": "Mozilla/5.0 (everything about this browser)",
        }])
        row = _stored(ref_id=f"{marker}-p")[0]
        blob = str(row)
        for secret in ("nan@example.com", "Nan", "Rex", "Sam Smith", "Happy birthday",
                       "secret-token", "4242", "203.0.113.7", "Mozilla"):
            assert secret not in blob, f"{secret} reached analytics"
        assert set(row) <= {
            "id", "event", "at", "day", "session_id", "client_id", "is_guest",
            "device", "expires_at", "kind", "ref_id", "department", "query",
            "result_count", "quantity", "rec_source", "source", "order_id", "dedupe_key",
        }


def test_building_an_event_from_a_raw_dict_still_drops_everything_private():
    # The route's request model already refuses unknown fields, so this is
    # the SECOND guard — and the one that matters for any caller that hands
    # build_event a plain dict, as the payment path does.
    row = analytics.build_event(
        {"event": "add_to_cart", "kind": "product", "ref_id": "p1",
         "recipient_email": "nan@example.com", "dog_name": "Rex",
         "client_name": "Sam", "guest_token": "secret", "revenue": 9999},
        client_id=None, session="s", device="desktop", business_date="2026-09-21")
    blob = str(row)
    for secret in ("nan@example.com", "Rex", "Sam", "secret", "9999"):
        assert secret not in blob, f"{secret} survived build_event"
    assert "revenue" not in row


def test_the_session_id_is_hashed_rather_than_stored():
    # A browser that put something meaningful in this field stores an
    # unusable digest instead.
    with _clean() as marker:
        _post([{"event": "shop_view", "kind": "product", "ref_id": f"{marker}-h"}],
              session="sam.smith@example.com")
        row = _stored(ref_id=f"{marker}-h")[0]
        assert "sam.smith@example.com" not in row["session_id"]
        assert len(row["session_id"]) == 32


def test_the_same_visitor_correlates_across_events():
    with _clean() as marker:
        _post([{"event": "shop_view"}, {"event": "product_view", "kind": "product",
                                        "ref_id": f"{marker}-a"}], session="visitor-1")
        _post([{"event": "add_to_cart", "kind": "product", "ref_id": f"{marker}-a"}],
              session="visitor-1")
        sessions = {r["session_id"] for r in _stored(ref_id=f"{marker}-a")}
        assert len(sessions) == 1


def test_a_batch_is_capped():
    try:
        _post([{"event": "shop_view"}] * (analytics.MAX_BATCH + 1))
        raise AssertionError("an oversized batch was accepted")
    except Exception as e:
        assert "40" in str(e) or "too_long" in str(e) or "at most" in str(e)


# ─────────────────────────────────────────────── deduplication

def test_a_checkout_start_is_counted_once_per_attempt():
    # A customer pressing Checkout twice is one attempt, keyed on the same
    # idempotency key the server uses to recognise the retry.
    with _clean():
        key = f"idem-{uuid.uuid4().hex}"
        _post([{"event": "checkout_started", "dedupe_key": key}], session="dd-1")
        _post([{"event": "checkout_started", "dedupe_key": key}], session="dd-1")
        rows = _stored(dedupe_key=f"checkout_started:{analytics.session_id_from('dd-1')}:{key}")
        assert len(rows) == 1


def test_two_different_people_starting_checkout_are_two_starts():
    with _clean():
        key = "shared-key"
        _post([{"event": "checkout_started", "dedupe_key": key}], session="person-a")
        _post([{"event": "checkout_started", "dedupe_key": key}], session="person-b")
        rows = run(server.db.shop_events.find(
            {"event": "checkout_started", "dedupe_key": {"$regex": "shared-key$"}},
            {"_id": 0}).to_list(10))
        assert len(rows) == 2


def test_one_bad_event_in_a_batch_does_not_lose_the_others():
    with _clean() as marker:
        key = f"idem-{uuid.uuid4().hex}"
        _post([{"event": "checkout_started", "dedupe_key": key}], session="batch-1")
        _post([
            {"event": "checkout_started", "dedupe_key": key},              # duplicate
            {"event": "product_view", "kind": "product", "ref_id": f"{marker}-keep"},
        ], session="batch-1")
        assert len(_stored(ref_id=f"{marker}-keep")) == 1


def test_an_order_completion_is_recorded_once_however_often_it_replays():
    with _clean() as marker:
        order = {"id": f"{marker}-order", "client_id": f"{marker}-client",
                 "is_guest_order": False}
        for _ in range(4):   # webhook, retry, manual reconciliation, retry again
            run(analytics.record_order_completed(server.db, order, business_date=_today()))
        rows = _stored(event="order_completed", order_id=f"{marker}-order")
        assert len(rows) == 1


# ─────────────────────────────────────────────── searches

def test_a_search_is_normalised_for_reporting():
    with _clean():
        _post([{"event": "search", "query": "  Rope   LEASH ", "result_count": 3}],
              session="s-norm")
        row = _stored(event="search", session_id=analytics.session_id_from("s-norm"))[0]
        assert row["query"] == "rope leash"


def test_normalisation_does_not_destroy_meaning():
    # Trim, collapse, lower-case — and nothing else. A normaliser that
    # de-pluralised would merge two genuinely different searches.
    assert analytics.normalize_query("Leashes") == "leashes"
    assert analytics.normalize_query("leash") == "leash"
    assert analytics.normalize_query("") == ""
    assert analytics.normalize_query(None) == ""


def test_a_search_event_without_a_query_is_refused():
    try:
        _post([{"event": "search", "result_count": 0}])
        raise AssertionError("a search with no query was stored")
    except HTTPException as e:
        assert e.status_code == 422


def test_zero_result_searches_are_their_own_report():
    with _clean():
        _post([{"event": "search", "query": "harness", "result_count": 4},
               {"event": "search_zero_results", "query": "puppy pads", "result_count": 0},
               {"event": "search_zero_results", "query": "puppy pads", "result_count": 0}],
              session="s-zero")
        start, end = _bounds(1)
        out = run(reports.search_intelligence(server.db, start, end))
        zero = {r["query"]: r for r in out["zero_result_searches"]}
        assert "puppy pads" in zero
        assert zero["puppy pads"]["searches"] == 2
        assert zero["puppy pads"]["sessions"] == 1
        assert "harness" not in zero


def test_searches_that_led_somewhere_are_correlation_and_say_so():
    with _clean() as marker:
        _post([{"event": "search", "query": "leash", "result_count": 2},
               {"event": "product_view", "kind": "product", "ref_id": f"{marker}-p"},
               {"event": "add_to_cart", "kind": "product", "ref_id": f"{marker}-p"}],
              session="s-led")
        start, end = _bounds(1)
        rows = run(reports.searches_that_led_somewhere(server.db, start, end))
        led = {r["query"]: r for r in rows}
        assert led["leash"]["led_to_product_view"] == 1
        assert led["leash"]["led_to_add_to_cart"] == 1


# ─────────────────────────────────────────────── device + audience

def test_the_viewport_decides_the_device_class():
    assert analytics.device_class(375) == "mobile"
    assert analytics.device_class(768) == "tablet"
    assert analytics.device_class(1440) == "desktop"
    # Nonsense is not a device.
    for bad in (None, 0, -5, "phone", True):
        assert analytics.device_class(bad) in (None, "mobile")


def test_device_is_recorded_from_the_viewport_not_the_user_agent():
    with _clean() as marker:
        _post([{"event": "shop_view", "kind": "product", "ref_id": f"{marker}-m"}],
              session="s-dev", width=375)
        assert _stored(ref_id=f"{marker}-m")[0]["device"] == "mobile"


# ─────────────────────────────────────────────── money comes from orders

def test_revenue_comes_from_paid_orders_and_events_cannot_touch_it():
    with _clean() as marker:
        _order(marker, [_line(f"{marker}-p", "Leash", 24.0, 2)])
        # Now try to inflate it from the browser, every way the schema allows.
        _post([{"event": "add_to_cart", "kind": "product", "ref_id": f"{marker}-p",
                "quantity": 999},
               {"event": "buy_again", "kind": "product", "ref_id": f"{marker}-p",
                "quantity": 999}], session="forger")
        start, end = _bounds(1)
        orders = run(reports._paid_orders(server.db, start, end))
        mine = [o for o in orders if any(l["ref_id"] == f"{marker}-p" for l in o["lines"])]
        snapshot = reports.sales_snapshot(mine)
        assert snapshot["revenue"] == 48.0
        assert snapshot["units"] == 2


def test_an_unpaid_order_is_not_revenue():
    with _clean() as marker:
        _order(marker, [_line(f"{marker}-x", "Leash", 24.0)], status="pending_payment")
        start, end = _bounds(1)
        orders = run(reports._paid_orders(server.db, start, end))
        assert all(not any(l["ref_id"] == f"{marker}-x" for l in o["lines"]) for o in orders)


def test_a_refunded_line_is_netted_out_of_revenue_and_units():
    with _clean() as marker:
        order = _order(marker, [_line(f"{marker}-r", "Leash", 24.0, 2,
                                      quantity_refunded=1, amount_refunded=24.0)])
        snapshot = reports.sales_snapshot([order])
        assert snapshot["revenue"] == 24.0
        assert snapshot["units"] == 1


def test_average_order_value_is_per_order_not_per_line():
    with _clean() as marker:
        a = _order(marker, [_line(f"{marker}-1", "A", 10.0), _line(f"{marker}-2", "B", 30.0)])
        b = _order(marker, [_line(f"{marker}-3", "C", 20.0)])
        snapshot = reports.sales_snapshot([a, b])
        assert snapshot["revenue"] == 60.0
        assert snapshot["orders"] == 2
        assert snapshot["average_order_value"] == 30.0


def test_no_orders_means_no_average_rather_than_zero():
    snapshot = reports.sales_snapshot([])
    assert snapshot["orders"] == 0
    # An average of nothing is not zero. Printing 0.00 would tell an owner
    # their typical basket is worthless.
    assert snapshot["average_order_value"] is None


def test_guest_and_account_orders_are_counted_apart():
    with _clean() as marker:
        a = _order(marker, [_line(f"{marker}-g", "A", 10.0)], guest=True)
        b = _order(marker, [_line(f"{marker}-a", "B", 10.0)])
        snapshot = reports.sales_snapshot([a, b])
        assert snapshot["guest_orders"] == 1
        assert snapshot["account_orders"] == 1


# ─────────────────────────────────────────────── the product funnel

def test_a_product_funnel_uses_events_for_behaviour_and_orders_for_sales():
    with _clean() as marker:
        ref = f"{marker}-funnel"
        _order(marker, [_line(ref, "Leash", 20.0, 3)])
        _post([{"event": "product_impression", "kind": "product", "ref_id": ref}] * 1
              + [{"event": "product_view", "kind": "product", "ref_id": ref}] * 1
              + [{"event": "add_to_cart", "kind": "product", "ref_id": ref}] * 1,
              session="funnel-a")
        _post([{"event": "product_view", "kind": "product", "ref_id": ref}],
              session="funnel-b")
        start, end = _bounds(1)
        events = run(reports.per_ref_counts(
            server.db, start, end, ["product_impression", "product_view", "add_to_cart"]))
        # Filtered by the line's own ref, not by client_name: the reporting
        # projection deliberately leaves a client's name out, so a test that
        # filtered on it would silently match nothing and pass a zero.
        orders = [o for o in run(reports._paid_orders(server.db, start, end))
                  if any(l["ref_id"] == ref for l in o["lines"])]
        rows = {r["ref_id"]: r for r in reports.product_funnel(
            events, reports.units_by_ref(orders), {})}
        row = rows[ref]
        assert row["views"] == 2 and row["cart_adds"] == 1 and row["units"] == 3
        assert row["view_to_cart"] == 50.0
        assert row["view_to_purchase"] == 150.0   # 3 units from 2 views: honest, not capped


def test_a_product_nobody_has_seen_reports_no_rate_rather_than_zero():
    rows = reports.product_funnel({}, {"x": {"kind": "product", "name": "X", "units": 0,
                                             "revenue": 0.0, "orders": 0}}, {})
    assert rows[0]["view_to_cart"] is None
    assert rows[0]["view_to_purchase"] is None


def test_looked_at_but_not_bought_ignores_products_with_barely_any_views():
    rows = [
        {"ref_id": "a", "name": "Seen a lot", "views": 30, "units": 0},
        {"ref_id": "b", "name": "Seen once", "views": 1, "units": 0},
        {"ref_id": "c", "name": "Sold", "views": 40, "units": 4},
    ]
    out = reports.looked_at_but_not_bought(rows)
    assert [r["ref_id"] for r in out] == ["a"]


def test_a_withdrawn_product_still_reads_as_itself_in_reporting():
    # Name from the ORDER when the catalogue no longer has the item, so a
    # discontinued product does not become "(unknown)" in last month's sales.
    rows = reports.product_funnel({}, {"gone": {"kind": "product", "name": "Old Leash",
                                                "units": 2, "revenue": 40.0, "orders": 1}}, {})
    assert rows[0]["name"] == "Old Leash"
    assert rows[0]["available"] is False


# ─────────────────────────────────────────────── departments

def test_department_revenue_splits_a_mixed_basket_exactly():
    # The one place a multi-item cart creates NO attribution problem: each
    # line carries its own total.
    with _clean() as marker:
        order = _order(marker, [
            _line(f"{marker}-leash", "Leash", 24.0, 1, kind="product"),
            _line(f"{marker}-course", "Recall", 119.0, 1, kind="training_program",
                  fulfillment_kind="online_school"),
            _line(f"{marker}-pack", "10 Visits", 280.0, 1, kind="credit_pack"),
        ])
        rows = {r["department"]: r for r in reports.department_performance([order], {})}
        assert rows["gear"]["revenue"] == 24.0
        assert rows["online_school"]["revenue"] == 119.0
        assert rows["prepaid"]["revenue"] == 280.0


def test_an_in_person_program_is_training_not_online_school():
    assert reports.department_of("training_program", None) == "training"
    assert reports.department_of("training_program", "credits_only") == "training"
    assert reports.department_of("training_program", "online_school") == "online_school"


# ─────────────────────────────────────────────── best sellers

def test_the_best_seller_rule_needs_real_volume():
    with _clean() as marker:
        # Four units is not a best seller, however quiet the month.
        order = _order(marker, [_line(f"{marker}-few", "Barely sold", 10.0,
                                      reports.BEST_SELLER_MIN_UNITS - 1)])
        assert reports.best_sellers([order]) == []


def test_a_product_with_enough_sales_qualifies():
    with _clean() as marker:
        order = _order(marker, [_line(f"{marker}-many", "Popular", 10.0,
                                      reports.BEST_SELLER_MIN_UNITS)])
        out = reports.best_sellers([order])
        assert [r["ref_id"] for r in out] == [f"{marker}-many"]


def test_best_sellers_rank_by_units_not_by_price():
    # Revenue ranking would crown the most expensive thing whether or not
    # anybody bought it twice.
    with _clean() as marker:
        order = _order(marker, [
            _line(f"{marker}-cheap", "Cheap", 5.0, 20),
            _line(f"{marker}-dear", "Expensive", 900.0, 6),
        ])
        out = reports.best_sellers([order])
        assert out[0]["ref_id"] == f"{marker}-cheap"


def test_the_list_is_capped():
    with _clean() as marker:
        order = _order(marker, [
            _line(f"{marker}-{i}", f"Item {i}", 10.0, 10 + i)
            for i in range(reports.BEST_SELLER_TOP_N + 3)
        ])
        assert len(reports.best_sellers([order])) == reports.BEST_SELLER_TOP_N


def test_nobody_can_set_best_seller_by_hand():
    # There is no input for it anywhere: the flag is computed and tagged on.
    assert "best_seller" not in server.PosProductIn.model_fields
    assert "best_seller" not in server.ProgramIn.model_fields
    assert "best_seller" not in server.CreditPackIn.model_fields


# ─────────────────────────────────────────────── dates

def test_a_range_uses_the_business_day_not_utc():
    # The helper the rest of the app's money reporting already uses. An
    # evening order must land on the day it happened, DST included.
    start, end = server._business_range_utc_bounds("2026-03-08", "2026-03-08")
    assert start < end
    # 8 March 2026 is a US DST spring-forward day: 23 hours, not 24.
    delta = (datetime.fromisoformat(end) - datetime.fromisoformat(start))
    assert delta == timedelta(hours=23)


def test_an_event_lands_on_the_business_date_it_happened():
    with _clean() as marker:
        _post([{"event": "shop_view", "kind": "product", "ref_id": f"{marker}-day"}])
        assert _stored(ref_id=f"{marker}-day")[0]["day"] == _today()


def test_a_backwards_range_is_refused():
    fn = _endpoint("shop_analytics_overview")
    try:
        run(fn(start="2026-09-20", end="2026-09-01", days=None, _=_admin()))
        raise AssertionError("a backwards range was accepted")
    except HTTPException as e:
        assert e.status_code == 422


def test_an_absurd_range_is_refused():
    fn = _endpoint("shop_analytics_overview")
    try:
        run(fn(start="2000-01-01", end="2026-09-01", days=None, _=_admin()))
        raise AssertionError("a 26-year range was accepted")
    except HTTPException as e:
        assert e.status_code == 422


# ─────────────────────────────────────────────── retention

def test_every_event_carries_its_own_expiry():
    with _clean() as marker:
        _post([{"event": "shop_view", "kind": "product", "ref_id": f"{marker}-ttl"}])
        row = _stored(ref_id=f"{marker}-ttl")[0]
        assert row["expires_at"] is not None
        expires = row["expires_at"]
        if isinstance(expires, str):
            expires = datetime.fromisoformat(expires)
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        days = (expires - datetime.now(timezone.utc)).days
        assert analytics.RETENTION_DAYS - 2 <= days <= analytics.RETENTION_DAYS


# ─────────────────────────────────────────────── permissions

def test_reporting_is_not_open_to_the_public():
    # Every reporting route sits behind the same finance-reports permission
    # the rest of the money reporting uses.
    for name in ("shop_analytics_overview", "shop_analytics_products",
                 "shop_analytics_searches", "shop_best_sellers"):
        fn = _endpoint(name)
        deps = [str(d) for d in getattr(fn, "__defaults__", ()) or ()]
        assert any("Depends" in d for d in deps), f"{name} has no dependency guard"


def test_a_client_cannot_reach_shop_reporting():
    guard = server.require_admin_and_permission("finance_reports")
    for role in ({"role": "client", "client_id": "c1"}, {"role": "employee"}):
        try:
            run(guard(user=role))
            raise AssertionError(f"{role['role']} reached shop reporting")
        except HTTPException as e:
            assert e.status_code == 403


# ─────────────────────────────────────────────── SEO helpers

def test_a_description_is_never_invented():
    # No description anywhere: the fallback says what the thing IS.
    item = {"kind": "product", "name": "Rope Leash", "id": "p1"}
    assert seo.description_for(item, "Rope Leash from Sit Happens.") == "Rope Leash from Sit Happens."


def test_a_description_prefers_what_the_admin_wrote():
    item = {"online_description": "Six feet of rope.", "description": "Other."}
    assert seo.description_for(item, "fallback") == "Six feet of rope."


def test_markup_in_a_description_does_not_reach_a_meta_tag():
    item = {"online_description": "<b>Bold</b> &amp; <script>x</script> braided"}
    out = seo.description_for(item, "fallback")
    assert "<" not in out and "script" not in out
    assert "Bold" in out and "braided" in out


def test_structured_data_fits_the_thing_being_sold():
    settings, base = {}, "https://example.com"
    product = seo.structured_data({"kind": "product", "id": "p", "name": "Leash", "price": 24.0},
                                  settings, base)
    course = seo.structured_data({"kind": "training_program", "id": "t", "name": "Recall",
                                  "price": 119.0, "purchase_fulfillment": "online_school"},
                                 settings, base)
    pack = seo.structured_data({"kind": "credit_pack", "id": "k", "name": "10 Visits",
                                "price": 280.0}, settings, base)
    assert product["@type"] == "Product"
    assert course["@type"] == "Course" and course["provider"]["@type"] == "Organization"
    assert pack["@type"] == "Service"


def test_structured_data_invents_nothing():
    data = seo.structured_data(
        {"kind": "product", "id": "p", "name": "Leash", "price": 24.0}, {}, "https://example.com")
    for invented in ("aggregateRating", "review", "reviewCount", "brand", "manufacturer",
                     "shippingDetails", "hasMerchantReturnPolicy", "sku", "gtin"):
        assert invented not in data


def test_a_hidden_price_does_not_reappear_as_an_offer():
    data = seo.structured_data(
        {"kind": "product", "id": "p", "name": "Leash", "price": 24.0,
         "show_public_price": False}, {}, "https://example.com")
    assert "offers" not in data
    assert "24" not in str(data)


def test_availability_is_read_from_real_stock():
    out_of_stock = {"kind": "product", "availability": "out_of_stock"}
    assert seo.availability_for(out_of_stock).endswith("OutOfStock")
    assert seo.availability_for({"kind": "product", "in_stock": True}).endswith("InStock")
    # A service does not run out.
    assert seo.availability_for({"kind": "credit_pack"}).endswith("InStock")


def test_a_rendered_document_escapes_everything_interpolated():
    doc = seo.render_document(
        title='Leash <script>alert("title")</script>',
        description='<img src=x onerror=alert("desc")>',
        canonical='https://example.com/"><script>alert("href")</script>',
        image='https://example.com/x.jpg"><script>alert("img")</script>',
        site="Sit Happens", og_type="product",
        body_heading='<script>alert("heading")</script>',
        body_lines=['<script>alert("body")</script>'],
        jsonld={"name": '</script><script>alert("jsonld")</script>'})
    # Every interpolation point, checked separately — an earlier version of
    # this test asserted one string that only the body heading produced, so
    # removing the escape from the TITLE went unnoticed.
    for payload in ("title", "desc", "href", "img", "heading", "body", "jsonld"):
        assert f'<script>alert("{payload}")</script>' not in doc, f"{payload} was not escaped"
    # Deliberately NOT asserting that the substring "onerror=" is absent:
    # it survives correct escaping as inert text inside an attribute value,
    # and this project has already once flagged a correctly-escaped document
    # on exactly that. What matters is that the payload cannot CLOSE an
    # attribute or open a tag.
    assert 'content="<' not in doc
    assert 'href="https://example.com/">' not in doc
    # A tag that survived escaping would render; an escaped one reads as text.
    assert "&lt;script&gt;" in doc
    # The one character that can close a script tag from inside a JSON string.
    assert "\\u003c/script" in doc


def test_robots_never_blocks_the_whole_site():
    txt = seo.robots_txt("https://example.com")
    assert "Disallow: /\n" not in txt        # the mistake that kills a shop's traffic
    assert "Disallow: /portal" in txt
    assert "Disallow: /admin" in txt
    assert "Sitemap: https://example.com/sitemap.xml" in txt
    # A social card cannot render without fetching the picture.
    assert "Allow: /api/public/shop/media/" in txt


def test_a_sitemap_contains_only_what_it_was_given():
    xml = seo.sitemap_xml([{"loc": "https://example.com/shop"}])
    assert "<loc>https://example.com/shop</loc>" in xml
    for private in ("/portal", "/admin", "/cart", "/orders", "token"):
        assert private not in xml


# ─────────────────────────────────── the pages a crawler actually receives

@contextlib.contextmanager
def _public_shop_open(**overrides):
    settings = run(server.get_settings())
    before = (settings.get("shop_page") or {}).copy()
    sp = before.copy()
    sp.update({"public_shop_enabled": True, "public_browsing_enabled": True,
               "show_public_prices": True, "show_public_merch": True,
               "show_public_training": True, "show_public_prepaid": True})
    sp.update(overrides)
    run(server.db.settings.update_one({}, {"$set": {"shop_page": sp}}, upsert=True))
    try:
        yield sp
    finally:
        run(server.db.settings.update_one({}, {"$set": {"shop_page": before}}, upsert=True))


@contextlib.contextmanager
def _product(**kw):
    defaults = dict(name=f"{TAG} Leash {uuid.uuid4().hex[:6]}", price=24.0,
                    show_online=True, active=True, starting_stock=5, track_inventory=True,
                    publicly_visible=True, online_description="Six feet of braided rope.")
    defaults.update(kw)
    created = run(server.create_pos_product(server.PosProductCreateIn(**defaults), _admin()))
    try:
        yield created
    finally:
        run(server.db.pos_products.delete_one({"id": created["id"]}))


def _meta_html(kind, item_id):
    with _public_shop_open():
        response = run(_endpoint("public_shop_item_meta")(kind, item_id, _Req()))
    return response.body.decode("utf-8")


def test_a_public_product_page_is_real_html_before_any_javascript_runs():
    # The whole point of the server-rendered route: a link-preview bot reads
    # bytes, and these are the bytes.
    with _product() as p:
        page = _meta_html("product", p["id"])
        assert page.startswith("<!doctype html>")
        assert "<title>" + p["name"] + " | " in page
        assert 'property="og:title"' in page
        assert 'property="og:description"' in page
        assert 'rel="canonical"' in page
        assert "/shop/item/product/" + p["id"] in page
        assert "application/ld+json" in page
        assert "Six feet of braided rope." in page


def test_the_social_image_is_the_large_derivative_not_the_thumbnail():
    with _product(image_id="img-abc") as p:
        page = _meta_html("product", p["id"])
        assert "/api/public/shop/media/img-abc/pdp" in page
        assert "/thumb" not in page
        assert 'name="twitter:card" content="summary_large_image"' in page


def test_a_hidden_product_has_no_public_page_at_all():
    with _product() as p:
        run(server.db.pos_products.update_one({"id": p["id"]}, {"$set": {"show_online": False}}))
        try:
            _meta_html("product", p["id"])
            raise AssertionError("a hidden product served a public page")
        except HTTPException as e:
            assert e.status_code == 404


def test_an_account_only_product_has_no_public_page_either():
    with _product(publicly_visible=False) as p:
        try:
            _meta_html("product", p["id"])
            raise AssertionError("an account-only product served a public page")
        except HTTPException as e:
            assert e.status_code == 404


def test_a_made_up_id_looks_exactly_like_a_hidden_one():
    try:
        _meta_html("product", str(uuid.uuid4()))
        raise AssertionError("an invented id served a page")
    except HTTPException as e:
        assert e.status_code == 404
        assert e.detail == "Not found."


def test_the_sitemap_lists_public_products_and_nothing_private():
    with _product() as visible, _product(publicly_visible=False) as private:
        with _public_shop_open():
            xml = run(_endpoint("public_shop_sitemap")(_Req())).body.decode("utf-8")
        assert visible["id"] in xml
        assert private["id"] not in xml
        for never in ("/portal", "/admin", "/cart", "/orders", "/favorites", "token"):
            assert never not in xml


def test_every_sitemap_entry_carries_a_real_lastmod_date():
    """A <lastmod> a crawler can use, from a date the catalog actually has.

    This nearly shipped empty. lastmod was reading `created_at` off the
    public catalog item, and `created_at` was removed from that catalog
    when the no-internal-leak contract caught it (see
    tests/test_client_shop_catalog.py). Nothing failed — the field just
    quietly stopped being emitted, which is the worst kind of SEO bug
    because the sitemap still validates.
    """
    with _product() as p:
        with _public_shop_open():
            xml = run(_endpoint("public_shop_sitemap")(_Req())).body.decode("utf-8")
    entry = xml.split(f"/{p['id']}")[1].split("</url>")[0]
    assert "<lastmod>" in entry, entry
    stamp = entry.split("<lastmod>")[1].split("</lastmod>")[0]
    datetime.strptime(stamp, "%Y-%m-%d")


def test_a_hidden_product_leaves_the_sitemap():
    with _product() as p:
        with _public_shop_open():
            before = run(_endpoint("public_shop_sitemap")(_Req())).body.decode("utf-8")
        assert p["id"] in before
        run(server.db.pos_products.update_one({"id": p["id"]}, {"$set": {"active": False}}))
        with _public_shop_open():
            after = run(_endpoint("public_shop_sitemap")(_Req())).body.decode("utf-8")
        assert p["id"] not in after


def test_robots_is_generated_and_does_not_block_the_shop():
    txt = run(_endpoint("public_shop_robots")(_Req())).body.decode("utf-8")
    assert "Disallow: /portal" in txt
    assert "Disallow: /shop\n" not in txt
    assert "Sitemap:" in txt


def test_the_landing_page_has_its_own_title():
    with _public_shop_open():
        page = run(_endpoint("public_shop_landing_meta")(_Req(), None)).body.decode("utf-8")
        dept = run(_endpoint("public_shop_landing_meta")(_Req(), "gear")).body.decode("utf-8")
    assert "<title>Shop | " in page
    assert "<title>Dog Training Gear | " in dept
    # Unique canonicals, or search engines treat them as one page.
    assert "dept=gear" in dept
    assert "dept=gear" not in page


# ─────────────────────────────────── relationships across every item type

def _new_program(**kw):
    defaults = dict(name=f"{TAG} Program {uuid.uuid4().hex[:6]}", type="private_lessons",
                    available_online=True, active=True, price=119.0)
    defaults.update(kw)
    return run(server.create_program(server.ProgramIn(**defaults), _admin()))


def test_a_training_program_can_be_related_to_a_product():
    prog = _new_program()
    try:
        with _product() as p:
            saved = run(server.update_program(prog["id"], server.ProgramIn(
                name=prog["name"], type="private_lessons", available_online=True,
                active=True, price=119.0,
                shop_relationships=[{"rel": "complements", "kind": "product",
                                     "ref_id": p["id"]}]), False, False, _admin()))
            assert saved["shop_relationships"][0]["ref_id"] == p["id"]
    finally:
        run(server.db.programs.delete_one({"id": prog["id"]}))


def test_a_credit_pack_can_be_related_too():
    pack = run(server.create_credit_pack(server.CreditPackIn(
        name=f"{TAG} Pack {uuid.uuid4().hex[:6]}", qty=10, price=280.0,
        available_online=True, active=True), _admin()))
    try:
        with _product() as p:
            saved = run(server.update_credit_pack(pack["id"], server.CreditPackIn(
                name=pack["name"], qty=10, price=280.0, available_online=True, active=True,
                shop_relationships=[{"rel": "related", "kind": "product",
                                     "ref_id": p["id"]}]), _admin()))
            assert saved["shop_relationships"][0]["ref_id"] == p["id"]
    finally:
        run(server.db.credit_packs.delete_one({"id": pack["id"]}))


def test_a_program_cannot_be_related_to_itself():
    prog = _new_program()
    try:
        run(server.update_program(prog["id"], server.ProgramIn(
            name=prog["name"], type="private_lessons", available_online=True, active=True,
            price=119.0, shop_relationships=[{"rel": "related", "kind": "training_program",
                                              "ref_id": prog["id"]}]), False, False, _admin()))
        raise AssertionError("a program was related to itself")
    except HTTPException as e:
        assert e.status_code == 422
    finally:
        run(server.db.programs.delete_one({"id": prog["id"]}))


def test_a_program_save_from_elsewhere_keeps_its_curation():
    # ProgramIn.model_dump() turns an unmentioned field into None. Without
    # the merge rule, saving a schedule would wipe an admin's curation.
    prog = _new_program()
    try:
        with _product() as p:
            run(server.update_program(prog["id"], server.ProgramIn(
                name=prog["name"], type="private_lessons", available_online=True, active=True,
                price=119.0, shop_relationships=[{"rel": "related", "kind": "product",
                                                  "ref_id": p["id"]}]), False, False, _admin()))
            run(server.update_program(prog["id"], server.ProgramIn(
                name=prog["name"], type="private_lessons", available_online=True,
                active=True, price=129.0), False, False, _admin()))
            after = run(server.db.programs.find_one({"id": prog["id"]}, {"_id": 0}))
            assert len(after.get("shop_relationships") or []) == 1
            assert after["price"] == 129.0
    finally:
        run(server.db.programs.delete_one({"id": prog["id"]}))


def test_featured_is_the_operators_choice_and_best_seller_is_not():
    with _product(featured=True) as p:
        doc = run(server.db.pos_products.find_one({"id": p["id"]}, {"_id": 0}))
        assert doc["featured"] is True
        assert "best_seller" not in doc


def test_an_inactive_item_cannot_reach_the_storefront_by_being_featured():
    with _product(featured=True) as p:
        run(server.db.pos_products.update_one({"id": p["id"]}, {"$set": {"active": False}}))
        catalog = run(server._build_shop_catalog(None))
        assert all(i["id"] != p["id"] for i in catalog["items"])
