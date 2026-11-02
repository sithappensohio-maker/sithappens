"""GET /analytics/overview — the new Analytics page's one data source
(owner request 2026-11-02: "how many visits a year/month, best weeks/months,
stuff like this").

Two of these tests are regressions for defects an adversarial review caught
before this endpoint ever shipped:
  * top sellers used to merge ANY online cart line (credit packs, training
    programs, gift cards) into the physical-product leaderboard, while the
    register side only ever contributes merchandise — an asymmetric, wrong
    merge (test_top_sellers_excludes_non_product_online_lines).
  * service mix used to fold EVERY retail_sales row into "Retail" regardless
    of category, so a refund (always negative) or a credit-pack/training-
    program sale (not merchandise) corrupted the Retail share and could even
    drive the whole mix negative (test_service_mix_retail_bucket_is_merchandise_only).

Fixed years (2024 vs 2023) so nothing here depends on what "today" is when
it runs. Self-contained fixtures (never import another test module).
"""
import uuid

import pytest

import _test_env  # noqa: F401 — configure disposable DB before importing server
import app_entry
server = app_entry.server
from _test_loop import run

TAG = "TEST_ANALYTICS_OVERVIEW"


def _booking(date, client_id="n/a", dog_id="n/a", service_type="daycare", price=100.0, status="completed"):
    bid = str(uuid.uuid4())
    run(server.db.bookings.insert_one({
        "id": bid, "client_id": client_id, "dog_id": dog_id, "service_type": service_type,
        "date": date, "status": status, "payment_status": "paid",
        "payment_method": "cash", "actual_price": price, "amount_paid": price,
        "created_at": server.now_iso(),
    }))
    return bid


def _retail_sale(date, amount, *, source_kind=None, tax_amount=0.0):
    rid = str(uuid.uuid4())
    run(server.db.retail_sales.insert_one({
        "id": rid, "client_id": "n/a", "amount": amount, "tax_amount": tax_amount,
        "gift_card_funded": 0.0, "source_kind": source_kind,
        "date": date, "created_at": server.now_iso(),
    }))
    return rid


def _pos_sale(business_date, product_id, qty, unit_price):
    sid = str(uuid.uuid4())
    line = {
        "kind": "retail", "product_id": product_id, "variant_id": None,
        "description": f"{TAG} register product", "qty": qty, "unit_price": unit_price,
        "amount": qty * unit_price, "net_amount": qty * unit_price,
        "allocated_tax": 0.0, "line_total": qty * unit_price, "taxable": True,
    }
    run(server.db.pos_sales.insert_one({
        "id": sid, "business_date": business_date, "status": "completed",
        "line_items": [line], "total": qty * unit_price,
        "tenders": [{"method": "cash", "amount": qty * unit_price}],
        "created_at": f"{business_date}T10:00:00",
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
    return {
        "kind": kind, "ref_id": ref_id, "name": name, "quantity": qty, "quantity_refunded": 0,
        "line_total": line_total, "allocated_tax": 0.0, "amount_refunded": 0.0, "tax_refunded": 0.0,
    }


def _cleanup(booking_ids=(), retail_ids=(), pos_ids=(), shop_ids=()):
    async def go():
        if booking_ids:
            await server.db.bookings.delete_many({"id": {"$in": list(booking_ids)}})
        if retail_ids:
            await server.db.retail_sales.delete_many({"id": {"$in": list(retail_ids)}})
        if pos_ids:
            await server.db.pos_sales.delete_many({"id": {"$in": list(pos_ids)}})
        if shop_ids:
            await server.db.shop_orders.delete_many({"id": {"$in": list(shop_ids)}})
    run(go())


def test_total_visits_counted_with_year_over_year_percentage():
    ids = []
    try:
        ids += [_booking("2024-02-01"), _booking("2024-05-15"), _booking("2024-09-20")]
        ids += [_booking("2023-06-01")]
        data = run(server.analytics_overview(year=2024, _=None))
        assert data["total_visits"] == 3
        assert data["visits_yoy_pct"] == 200.0  # (3 - 1) / 1 * 100
    finally:
        _cleanup(booking_ids=ids)


def test_by_month_zero_fills_every_quiet_month():
    ids = []
    try:
        ids.append(_booking("2024-03-10"))
        data = run(server.analytics_overview(year=2024, _=None))
        by_month = {m["month"]: m for m in data["by_month"]}
        assert len(data["by_month"]) == 12
        assert by_month["2024-03"]["total"] == 1
        assert by_month["2024-01"]["total"] == 0, "a quiet month is a 0-visit bar, not a missing one"
        assert by_month["2024-12"]["total"] == 0
    finally:
        _cleanup(booking_ids=ids)


def test_new_vs_returning_clients_classified_by_first_ever_visit():
    ids = []
    try:
        client_a = f"{TAG}-client-a"
        client_b = f"{TAG}-client-b"
        # A's first-ever visit is January 2024 -> new in Jan, returning in Feb.
        ids.append(_booking("2024-01-10", client_id=client_a))
        ids.append(_booking("2024-02-05", client_id=client_a))
        # B's first-ever visit was back in 2023 -> returning when they show up in Jan 2024.
        ids.append(_booking("2023-05-01", client_id=client_b))
        ids.append(_booking("2024-01-15", client_id=client_b))

        data = run(server.analytics_overview(year=2024, _=None))
        by_month = {m["month"]: m for m in data["clients_by_month"]}
        assert by_month["2024-01"]["new"] == 1, "client A, first-ever visit this month"
        assert by_month["2024-01"]["returning"] == 1, "client B, first-ever visit was in 2023"
        assert by_month["2024-02"]["new"] == 0
        assert by_month["2024-02"]["returning"] == 1, "client A is returning the second time"
    finally:
        _cleanup(booking_ids=ids)


def test_top_sellers_excludes_non_product_online_lines():
    """Regression: units_by_ref() keys purely by ref_id with no kind filter,
    so a credit pack bought online used to merge into the same leaderboard
    as physical merchandise even though the register side only ever
    contributes kind == "retail" (merchandise) lines."""
    pos_ids, shop_ids = [], []
    try:
        reg_product = f"{TAG}-reg-product"
        online_product = f"{TAG}-online-product"
        online_credit_pack = f"{TAG}-online-credit-pack"

        pos_ids.append(_pos_sale("2024-06-01", reg_product, qty=2, unit_price=10.0))
        shop_ids.append(_shop_order("2024-06-15T12:00:00+00:00", [
            _shop_line("product", online_product, "Online Widget", 3, 30.0),
            _shop_line("credit_pack", online_credit_pack, "10-Visit Pack", 1, 100.0),
        ]))

        data = run(server.analytics_overview(year=2024, _=None))
        by_id = {p["product_id"]: p for p in data["top_sellers"]}
        assert reg_product in by_id and by_id[reg_product]["units"] == 2.0
        assert online_product in by_id and by_id[online_product]["units"] == 3.0
        assert online_credit_pack not in by_id, "a credit pack is not a top-selling PRODUCT"
    finally:
        _cleanup(pos_ids=pos_ids, shop_ids=shop_ids)


def test_service_mix_retail_bucket_is_merchandise_only():
    """Regression: every retail_sales row used to be summed into "Retail"
    regardless of category, so a refund (always negative) or a credit-pack
    sale (not merchandise) corrupted the Retail share — a refund alone could
    drive the whole mix negative and invert every percentage."""
    ids, retail_ids = [], []
    try:
        ids.append(_booking("2024-04-01", service_type="daycare", price=100.0))
        retail_ids.append(_retail_sale("2024-04-05", 100.0, tax_amount=5.0))          # genuine merchandise: net 95
        retail_ids.append(_retail_sale("2024-04-06", -50.0, source_kind="refund", tax_amount=-2.0))  # net -48, must be excluded
        retail_ids.append(_retail_sale("2024-04-07", 80.0, source_kind="credit_pack_sale"))  # real revenue, not merchandise

        data = run(server.analytics_overview(year=2024, _=None))
        mix = {m["label"]: m for m in data["service_mix"]}

        assert mix["Retail"]["total"] == 95.0, "the refund and the credit pack must not land in Retail"
        assert mix["Daycare"]["total"] == 100.0
        assert mix["Other"]["total"] == 80.0, "the credit pack sale is real revenue, just not merchandise"
        assert all(m["pct"] >= 0 for m in data["service_mix"]), "no category should show a negative share"
        assert "Refunds" not in mix and "refunds_reversals" not in mix, "a refund is a reduction, not a revenue slice"
    finally:
        _cleanup(booking_ids=ids, retail_ids=retail_ids)


def test_a_future_year_is_rejected_not_silently_inverted():
    future = server.business_today().year + 1
    with pytest.raises(server.HTTPException) as exc:
        run(server.analytics_overview(year=future, _=None))
    assert exc.value.status_code == 400


def test_year_zero_is_rejected():
    with pytest.raises(server.HTTPException) as exc:
        run(server.analytics_overview(year=0, _=None))
    assert exc.value.status_code == 400


def test_fun_stats_and_avg_client_spend_do_not_crash_with_no_activity():
    data = run(server.analytics_overview(year=2019, _=None))
    assert data["fun_stats"]["dogs_served_all_time"] >= 0
    assert data["avg_client_spend"] >= 0.0
    assert data["service_mix"] == []
    assert data["top_sellers"] == []
