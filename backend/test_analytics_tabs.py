"""The 5 Analytics drill-down tabs (owner follow-up 2026-11-02, after the
Overview page): GET /analytics/visits, /clients, /services, /retail, /staff.

Every one of these reuses a helper the Overview endpoint (test_analytics_
overview.py) or Finance already has tests for, so these tests focus on what's
NEW here: weekday/no-show math, retention windows, the by-month breakdowns,
the register/online channel split, and the per-month labor loop.

Fixed year 2024 everywhere except retention (genuinely "as of right now" by
design, so it uses business_today() and measures a before/after delta rather
than an absolute count — the disposable DB persists across this session's
other test files, so an absolute "total clients" assertion would be flaky).

Self-contained fixtures (never import another test module).
"""
import uuid

import pytest

import _test_env  # noqa: F401 — configure disposable DB before importing server
import app_entry
server = app_entry.server
from _test_loop import run

TAG = "TEST_ANALYTICS_TABS"


def _booking(date, client_id="n/a", service_type="daycare", price=100.0, status="completed", checked_in_at=None):
    bid = str(uuid.uuid4())
    run(server.db.bookings.insert_one({
        "id": bid, "client_id": client_id, "dog_id": "n/a", "service_type": service_type,
        "date": date, "status": status, "payment_status": "paid",
        "payment_method": "cash", "actual_price": price, "amount_paid": price,
        "checked_in_at": checked_in_at, "created_at": server.now_iso(),
    }))
    return bid


def _retail_sale(date, amount, *, source_kind=None):
    rid = str(uuid.uuid4())
    run(server.db.retail_sales.insert_one({
        "id": rid, "client_id": "n/a", "amount": amount, "tax_amount": 0.0,
        "gift_card_funded": 0.0, "source_kind": source_kind, "date": date, "created_at": server.now_iso(),
    }))
    return rid


def _pos_sale(business_date, product_id, qty, unit_price):
    sid = str(uuid.uuid4())
    line = {
        "kind": "retail", "product_id": product_id, "variant_id": None, "description": f"{TAG} product",
        "qty": qty, "unit_price": unit_price, "amount": qty * unit_price, "net_amount": qty * unit_price,
        "allocated_tax": 0.0, "line_total": qty * unit_price, "taxable": True,
    }
    run(server.db.pos_sales.insert_one({
        "id": sid, "business_date": business_date, "status": "completed",
        "line_items": [line], "total": qty * unit_price,
        "tenders": [{"method": "cash", "amount": qty * unit_price}], "created_at": f"{business_date}T10:00:00",
    }))
    return sid


def _shop_order(created_at_utc, lines):
    oid = str(uuid.uuid4())
    run(server.db.shop_orders.insert_one({
        "id": oid, "status": "paid", "created_at": created_at_utc,
        "total": sum(l["line_total"] for l in lines), "subtotal": sum(l["line_total"] for l in lines),
        "refunded_amount": 0.0, "lines": lines, "is_guest_order": True, "client_id": None,
    }))
    return oid


def _shop_line(kind, ref_id, name, qty, line_total):
    return {"kind": kind, "ref_id": ref_id, "name": name, "quantity": qty, "quantity_refunded": 0,
            "line_total": line_total, "allocated_tax": 0.0, "amount_refunded": 0.0, "tax_refunded": 0.0}


def _clock_entry(user_id, clock_in_at, hours):
    eid = str(uuid.uuid4())
    run(server.db.time_clock_entries.insert_one({
        "id": eid, "user_id": user_id, "clock_in_at": clock_in_at,
        "clock_out_at": clock_in_at, "hours": hours, "pay_rate": 15.0,
    }))
    return eid


def _user(role="employee", is_owner=False, name="Staff Member"):
    uid = str(uuid.uuid4())
    run(server.db.users.insert_one({
        "id": uid, "role": role, "is_owner": is_owner, "name": name, "hourly_rate": 15.0,
        "email": f"{uid}@{TAG.lower()}.test",
    }))
    return uid


def _cleanup(booking_ids=(), retail_ids=(), pos_ids=(), shop_ids=(), clock_ids=(), user_ids=(), client_ids=()):
    async def go():
        if booking_ids:
            await server.db.bookings.delete_many({"id": {"$in": list(booking_ids)}})
        if retail_ids:
            await server.db.retail_sales.delete_many({"id": {"$in": list(retail_ids)}})
        if pos_ids:
            await server.db.pos_sales.delete_many({"id": {"$in": list(pos_ids)}})
        if shop_ids:
            await server.db.shop_orders.delete_many({"id": {"$in": list(shop_ids)}})
        if clock_ids:
            await server.db.time_clock_entries.delete_many({"id": {"$in": list(clock_ids)}})
        if user_ids:
            await server.db.users.delete_many({"id": {"$in": list(user_ids)}})
        if client_ids:
            await server.db.bookings.delete_many({"client_id": {"$in": list(client_ids)}})
    run(go())


# ── Visits ──────────────────────────────────────────────────────────────

def test_visits_tab_weekday_breakdown_and_no_show_rate():
    ids = []
    try:
        # 2024-06-03 is a Monday.
        ids.append(_booking("2024-06-03"))
        ids.append(_booking("2024-06-10"))  # another Monday -> 2 visits, 2 occurrences so far
        ids.append(_booking("2024-06-04", status="no_show"))  # a Tuesday no-show

        data = run(server.analytics_visits(year=2024, _=None))
        monday = next(w for w in data["by_weekday"] if w["name"] == "Monday")
        assert monday["total_visits"] >= 2

        nsr = data["no_show_rate"]
        assert nsr["no_show_count"] >= 1
        assert nsr["resolved_total"] >= nsr["no_show_count"]
        assert nsr["pct"] is not None and 0 <= nsr["pct"] <= 100
    finally:
        _cleanup(booking_ids=ids)


def test_visits_tab_no_show_rate_counts_forfeited_cancellations():
    """Regression: the live cancel flow never writes status=="no_show" — a
    kept-the-money cancellation is status="cancelled" + cancellation_charged
    =True. The no-show query must match that, or it silently reads as zero
    no-shows forever on a business with real forfeited cancellations."""
    ids = []
    try:
        ids.append(_booking("2024-06-05", status="cancelled"))
        run(server.db.bookings.update_one({"id": ids[0]}, {"$set": {"cancellation_charged": True}}))

        data = run(server.analytics_visits(year=2024, _=None))
        assert data["no_show_rate"]["no_show_count"] >= 1
    finally:
        _cleanup(booking_ids=ids)


def test_visits_tab_heatmap_buckets_checked_in_timestamp():
    ids = []
    try:
        # Noon UTC lands inside the Eastern business day in both EST/EDT.
        ids.append(_booking("2024-07-08", checked_in_at="2024-07-08T15:00:00+00:00"))  # ~11am Eastern -> Midday band
        data = run(server.analytics_visits(year=2024, _=None))
        assert data["occupancy_heatmap"]["max_count"] >= 1
    finally:
        _cleanup(booking_ids=ids)


def test_clients_tab_top_clients_excludes_negative_spend_client():
    """Regression: ranking and slicing to 10 BEFORE filtering out <= 0 totals
    used to drop a negative-spend client without promoting the next
    genuinely-positive one into their slot."""
    ids, retail_ids = [], []
    try:
        refund_only_client = f"{TAG}-refund-only-{uuid.uuid4()}"
        modest_client = f"{TAG}-modest-{uuid.uuid4()}"
        retail_ids.append(_retail_sale("2024-08-15", -200.0, source_kind="refund"))
        run(server.db.retail_sales.update_one({"id": retail_ids[0]}, {"$set": {"client_id": refund_only_client}}))
        ids.append(_booking("2024-08-16", client_id=modest_client, price=15.0))

        data = run(server.analytics_clients(year=2024, _=None))
        ids_in_list = {c["client_id"] for c in data["top_clients"]}
        assert refund_only_client not in ids_in_list, "a net-negative client must not show as a top client"
        assert all(c["lifetime_spend"] > 0 for c in data["top_clients"])
    finally:
        _cleanup(booking_ids=ids, retail_ids=retail_ids)


# ── Clients ─────────────────────────────────────────────────────────────

def test_clients_tab_top_clients_ranked_by_lifetime_spend():
    ids = []
    try:
        big_spender = f"{TAG}-big"
        small_spender = f"{TAG}-small"
        ids.append(_booking("2024-08-01", client_id=big_spender, price=500.0))
        ids.append(_booking("2024-08-02", client_id=small_spender, price=20.0))

        data = run(server.analytics_clients(year=2024, _=None))
        by_id = {c["client_id"]: c for c in data["top_clients"]}
        assert big_spender in by_id
        if small_spender in by_id:
            assert by_id[big_spender]["lifetime_spend"] > by_id[small_spender]["lifetime_spend"]
        # Ranked descending.
        totals = [c["lifetime_spend"] for c in data["top_clients"]]
        assert totals == sorted(totals, reverse=True)
    finally:
        _cleanup(booking_ids=ids)


def test_clients_tab_retention_counts_a_visit_from_today():
    fresh_client = f"{TAG}-retention-{uuid.uuid4()}"
    ids = []
    try:
        baseline = run(server.analytics_clients(year=server.business_today().year, _=None))
        base_30d = baseline["retention"]["active_30d"]
        base_total = baseline["retention"]["total_clients_ever"]

        ids.append(_booking(server.business_today().isoformat(), client_id=fresh_client))

        after = run(server.analytics_clients(year=server.business_today().year, _=None))
        assert after["retention"]["active_30d"] == base_30d + 1
        assert after["retention"]["total_clients_ever"] == base_total + 1
    finally:
        _cleanup(booking_ids=ids)


# ── Services ────────────────────────────────────────────────────────────

def test_services_tab_by_month_sums_match_service_mix_totals():
    ids, retail_ids = [], []
    try:
        ids.append(_booking("2024-02-01", service_type="daycare", price=100.0))
        ids.append(_booking("2024-05-01", service_type="daycare", price=50.0))
        retail_ids.append(_retail_sale("2024-02-10", 40.0))

        data = run(server.analytics_services(year=2024, _=None))
        mix = {m["label"]: m["total"] for m in data["service_mix"]}
        by_month_daycare_sum = round(sum(m["Daycare"] for m in data["by_month"]), 2)
        by_month_retail_sum = round(sum(m["Retail"] for m in data["by_month"]), 2)
        assert by_month_daycare_sum == mix.get("Daycare", 0.0)
        assert by_month_retail_sum == mix.get("Retail", 0.0)
    finally:
        _cleanup(booking_ids=ids, retail_ids=retail_ids)


def test_services_tab_credit_pack_redeemed_reuses_summary_range_data():
    data = run(server.analytics_services(year=2024, _=None))
    summary = run(server._summary_range_data("2024-01-01", "2024-12-31"))
    assert data["credit_pack_redeemed"]["count"] == summary["credit_pack_redeemed_count"]
    assert data["credit_pack_redeemed"]["value"] == summary["credit_pack_redeemed_value"]


# ── Retail ──────────────────────────────────────────────────────────────

def test_retail_tab_channel_split_separates_register_and_online():
    pos_ids, shop_ids = [], []
    try:
        pos_ids.append(_pos_sale("2024-09-01", f"{TAG}-reg-prod", qty=4, unit_price=10.0))
        shop_ids.append(_shop_order("2024-09-10T12:00:00+00:00", [_shop_line("product", f"{TAG}-online-prod", "Widget", 2, 20.0)]))

        data = run(server.analytics_retail(year=2024, _=None))
        assert data["channel_split"]["in_store"]["revenue"] >= 40.0
        assert data["channel_split"]["online"]["revenue"] >= 20.0
    finally:
        _cleanup(pos_ids=pos_ids, shop_ids=shop_ids)


def test_retail_tab_in_store_total_requires_product_id_like_top_sellers():
    """Regression: _register_retail_totals used to count a line with no
    product_id while _top_sellers_for_range's register loop always skipped
    it — channel_split.in_store disagreed with the sum reachable via
    top_sellers for the identical sales."""
    pos_ids = []
    try:
        sid = str(uuid.uuid4())
        line_no_product = {
            "kind": "retail", "product_id": None, "variant_id": None, "description": "misc charge",
            "qty": 1.0, "unit_price": 50.0, "amount": 50.0, "net_amount": 50.0,
            "allocated_tax": 0.0, "line_total": 50.0, "taxable": True,
        }
        run(server.db.pos_sales.insert_one({
            "id": sid, "business_date": "2024-09-20", "status": "completed",
            "line_items": [line_no_product], "total": 50.0,
            "tenders": [{"method": "cash", "amount": 50.0}], "created_at": "2024-09-20T10:00:00",
        }))
        pos_ids.append(sid)

        data = run(server.analytics_retail(year=2024, _=None))
        assert data["channel_split"]["in_store"]["revenue"] == 0.0
        assert data["top_sellers"] == []
    finally:
        _cleanup(pos_ids=pos_ids)


def test_retail_tab_by_month_excludes_non_merchandise_categories():
    retail_ids = []
    try:
        retail_ids.append(_retail_sale("2024-10-01", 60.0))  # genuine merchandise
        retail_ids.append(_retail_sale("2024-10-05", 90.0, source_kind="credit_pack_sale"))  # real revenue, not merchandise

        data = run(server.analytics_retail(year=2024, _=None))
        october = next(m for m in data["by_month"] if m["month"] == "2024-10")
        assert october["total"] == 60.0, "the credit pack sale must not count as retail merchandise revenue"
    finally:
        _cleanup(retail_ids=retail_ids)


# ── Staff ───────────────────────────────────────────────────────────────

def test_staff_tab_hours_exclude_owner_and_rank_by_hours():
    user_ids, clock_ids = [], []
    try:
        employee = _user(is_owner=False, name=f"{TAG} Employee")
        owner = _user(is_owner=True, name=f"{TAG} Owner")
        user_ids += [employee, owner]
        clock_ids.append(_clock_entry(employee, "2024-11-05T14:00:00+00:00", 8.0))
        clock_ids.append(_clock_entry(owner, "2024-11-05T14:00:00+00:00", 40.0))

        data = run(server.analytics_staff(year=2024, _=None))
        by_user = {s["user_id"]: s for s in data["staff_hours"]}
        assert employee in by_user and by_user[employee]["hours"] == 8.0
        assert owner not in by_user, "the owner's own hours are a draw, not labor"
    finally:
        _cleanup(user_ids=user_ids, clock_ids=clock_ids)


def test_staff_tab_labor_pct_is_none_without_revenue():
    data = run(server.analytics_staff(year=2019, _=None))
    assert len(data["by_month"]) == 12
    assert all(m["labor_pct_of_revenue"] is None for m in data["by_month"] if m["revenue"] == 0)
