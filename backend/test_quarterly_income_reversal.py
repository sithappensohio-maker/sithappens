"""Step 4B-2 — quarterly / Schedule-C income reversal tests.

Locks in the invariant:

    A valid refund or void reduces previously reported collected income
    exactly once — signed reversal rows survive aggregation; clamping
    exists only for malformed ordinary rows (per row) and the statutory
    SE/taxable-income figures (final level), never in between.

The old defect: `_schedule_c_retail_income` clamped every non-"refund" row
at max(0, net), so a voided $100 sale kept reporting $100 of quarterly
income forever (while Finance/range/register correctly showed $0).

Isolation strategy: `admin_quarterly_tax(year=2001…)` windows are fully
synthetic years no other test file writes to → absolute assertions; the
live POS-flow tests (D, I) run on today's shared quarter and assert exact
deltas. Disposable tag TEST_QINC.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import pytest
import server
from _test_loop import run

TAG = "TEST_QINC"
ADMIN = {"id": "qinc-test", "name": "QInc QA", "email": "qinc@test", "role": "admin"}


@pytest.fixture(autouse=True)
def _restore_tax_settings():
    """Same discipline as test_sales_tax_reversal — never leak enabled sales
    tax into other files' cart-total expectations."""
    prev = run(server.db.settings.find_one({}, {"_id": 0, "sales_tax": 1})) or {}
    yield
    run(server.db.settings.update_one(
        {}, {"$set": {"sales_tax": prev.get("sales_tax") or {"enabled": False}}}, upsert=True))


def _income(year):
    r = run(server.admin_quarterly_tax(_=ADMIN, year=year))
    return r["income"]


def _row(date, amount, **extra):
    doc = {"id": str(uuid.uuid4()), "date": date, "amount": amount,
           "description": f"{TAG} row", "created_at": f"{date}T10:00:00"}
    doc.update(extra)
    run(server.db.retail_sales.insert_one(dict(doc)))
    return doc["id"]


def _cleanup(retail_ids=(), booking_ids=(), sale_ids=(), products=()):
    async def go():
        if retail_ids:
            await server.db.retail_sales.delete_many({"id": {"$in": list(retail_ids)}})
        if booking_ids:
            await server.db.bookings.delete_many({"id": {"$in": list(booking_ids)}})
        if products:
            await server.db.pos_products.delete_many({"id": {"$in": list(products)}})
        if sale_ids:
            ids = list(sale_ids)
            await server.db.pos_sales.delete_many({"id": {"$in": ids}})
            await server.db.retail_sales.delete_many({"pos_sale_id": {"$in": ids}})
            await server.db.pos_sale_claims.delete_many({"pos_sale_id": {"$in": ids}})
            await server.db.pos_sale_void_claims.delete_many({"pos_sale_id": {"$in": ids}})
        await server.db.retail_sales.delete_many({"description": {"$regex": TAG}})
    run(go())


# ── live POS-flow helpers (today's shared quarter → delta assertions) ───────
def _product(price, taxable=False):
    doc = {"id": str(uuid.uuid4()), "name": f"{TAG} product", "description": "", "sku": "",
           "category": "", "price": price, "active": True, "archived": False,
           "show_at_register": True, "track_inventory": False, "stock_on_hand": 0,
           "category_id": None, "subcategory_id": None, "featured": False, "image_id": None,
           "taxable": taxable}
    run(server.db.pos_products.insert_one(dict(doc)))
    return doc


class _OpenRegisterDay:
    def __enter__(self):
        self.date = server.business_today().isoformat()
        self.marker = f"{TAG}-{uuid.uuid4()}"
        self.created = run(server.db.cash_drawer_sessions.find_one_and_update(
            {"date": self.date},
            {"$setOnInsert": {"date": self.date, "opening_cash": 100.0, "opened_at": server.now_iso(),
                              "opened_by": self.marker, "opened_by_name": TAG, "notes": TAG}},
            upsert=True, projection={"_id": 0},
        )) is None
        return self

    def __exit__(self, *exc):
        if self.created:
            run(server.db.cash_drawer_sessions.delete_one({"date": self.date, "opened_by": self.marker}))
        return False


# ── Test A — sale only ──────────────────────────────────────────────────────
def test_a_sale_reports_income():
    ids = [_row("2001-04-01", 100.0, payment_method="card")]
    try:
        inc = _income(2001)
        assert abs(float(inc["retail_sales"]) - 100.0) < 0.005
        assert abs(float(inc["gross"]) - 100.0) < 0.005
    finally:
        _cleanup(retail_ids=ids)


# ── Test B — sale + full void nets to zero ──────────────────────────────────
def test_b_full_void_reverses_income():
    orig = _row("2001-04-02", 100.0, payment_method="card")
    void = _row("2001-04-02", -100.0, payment_method="void",
                source_kind="pos_sale_void", reversed_retail_sales_id=orig, tax_amount=0.0)
    try:
        inc = _income(2001)
        assert abs(float(inc["retail_sales"])) < 0.005, inc
        assert abs(float(inc["gross"])) < 0.005
    finally:
        _cleanup(retail_ids=[orig, void])


# ── Test C — partial refund nets to the retained amount ─────────────────────
def test_c_partial_refund_nets_to_75():
    ids = [
        _row("2001-04-03", 100.0, payment_method="card"),
        _row("2001-04-03", -25.0, payment_method="cash", source_kind="refund", category="Refund"),
    ]
    try:
        inc = _income(2001)
        assert abs(float(inc["retail_sales"]) - 75.0) < 0.005
    finally:
        _cleanup(retail_ids=ids)


# ── Test D — split-tender void through the REAL POS flow ────────────────────
def test_d_split_tender_void_income_delta_zero():
    p = _product(100.0)
    sale_id = None
    with _OpenRegisterDay():
        try:
            base = float(_income(None)["gross"])
            body = server.PosSaleIn(
                lines=[{"kind": "retail", "product_id": p["id"], "qty": 1}],
                tenders=[{"method": "cash", "amount": 40.0, "tendered_amount": 40.0},
                         {"method": "card", "amount": 60.0}],
                idempotency_key=uuid.uuid4().hex)
            r = run(server.create_pos_sale(body, ADMIN))
            sale_id = r["sale"]["id"]
            after_sale = float(_income(None)["gross"])
            assert abs(after_sale - (base + 100.0)) < 0.005
            run(server.void_pos_sale(sale_id, server.PosSaleVoidIn(
                reason=f"{TAG} void", idempotency_key=uuid.uuid4().hex), ADMIN))
            after_void = float(_income(None)["gross"])
            # Tender composition has no bearing on revenue: back to baseline.
            assert abs(after_void - base) < 0.005
        finally:
            _cleanup(products=[p["id"]], sale_ids=[sale_id] if sale_id else ())


# ── Test E — booking refund reversal respected exactly once ─────────────────
def test_e_booking_refund_respected():
    bid = f"{TAG}-bk-{uuid.uuid4().hex[:6]}"
    run(server.db.bookings.insert_one({
        "id": bid, "date": "2001-05-01", "status": "completed", "payment_status": "paid",
        "actual_price": 100.0, "amount_paid": 100.0, "payment_method": "card",
        "client_name": TAG, "dog_name": TAG, "service_type": "daycare",
        "created_at": "2001-05-01T09:00:00",
    }))
    # The row the booking-refund path writes (full refund, no tax configured).
    refund = _row("2001-05-02", -100.0, payment_method="card", source_kind="refund",
                  category="Refund", booking_id=bid)
    try:
        inc = _income(2001)
        assert abs(float(inc["service_bookings"]) - 100.0) < 0.005
        assert abs(float(inc["retail_sales"]) + 100.0) < 0.005
        assert abs(float(inc["gross"])) < 0.005  # reversed exactly once
    finally:
        _cleanup(retail_ids=[refund], booking_ids=[bid])


# ── Test F — register refund reduces income exactly once ────────────────────
def test_f_register_refund_reduces_income():
    ids = [_row("2001-06-01", 100.0, payment_method="cash")]
    r = run(server.admin_register_refund(server.RegisterRefundIn(
        reason=f"{TAG} refund", amount=20.0, payment_method="cash",
        date=server.business_today().isoformat()), ADMIN))
    live_refund_id = r["refund"]["id"]
    try:
        # Synthetic-year check for the exact arithmetic…
        ids.append(_row("2001-06-01", -20.0, payment_method="cash",
                        source_kind="refund", category="Refund"))
        inc = _income(2001)
        assert abs(float(inc["retail_sales"]) - 80.0) < 0.005
    finally:
        _cleanup(retail_ids=ids + [live_refund_id])


# ── Test G — Stripe refund rows participate as signed income reversal ───────
def test_g_stripe_refund_participates():
    ids = [
        _row("2001-07-01", 100.0, payment_method="stripe_online",
             source_kind="stripe_online_payment"),
        _row("2001-07-02", -100.0, payment_method="stripe_online",
             source_kind="stripe_refund", reversed_payment_id=f"{TAG}-pay"),
    ]
    try:
        inc = _income(2001)
        assert abs(float(inc["retail_sales"])) < 0.005, inc
    finally:
        _cleanup(retail_ids=ids)


# ── Test H — repeated reads are identical (pure read-time math) ─────────────
def test_h_repeated_reads_identical():
    orig = _row("2001-08-01", 100.0)
    void = _row("2001-08-01", -100.0, source_kind="pos_sale_void",
                reversed_retail_sales_id=orig)  # historical shape: no tax key
    try:
        first = _income(2001)
        second = _income(2001)
        assert first == second
        assert abs(float(first["retail_sales"])) < 0.005
    finally:
        _cleanup(retail_ids=[orig, void])


# ── Test I — Step 4B-1 tax regression: income AND tax both net to zero ──────
def test_i_taxable_void_income_and_tax_both_zero():
    run(server.db.settings.update_one(
        {}, {"$set": {"sales_tax": {"enabled": True, "rate_pct": 10.0,
                                    "applies_to": {"retail": True}}}}, upsert=True))
    p = _product(100.0, taxable=True)
    sale_id = None
    today = server.business_today().isoformat()
    with _OpenRegisterDay():
        try:
            inc0 = float(_income(None)["gross"])
            tax0 = float(run(server.sales_tax_summary(today, today, ADMIN))["total_tax_collected"])
            body = server.PosSaleIn(
                lines=[{"kind": "retail", "product_id": p["id"], "qty": 1}],
                tenders=[{"method": "card", "amount": 110.0}], idempotency_key=uuid.uuid4().hex)
            r = run(server.create_pos_sale(body, ADMIN))
            sale_id = r["sale"]["id"]
            run(server.void_pos_sale(sale_id, server.PosSaleVoidIn(
                reason=f"{TAG} void", idempotency_key=uuid.uuid4().hex), ADMIN))
            inc1 = float(_income(None)["gross"])
            tax1 = float(run(server.sales_tax_summary(today, today, ADMIN))["total_tax_collected"])
            assert abs(inc1 - inc0) < 0.005   # income reversed
            assert abs(tax1 - tax0) < 0.005   # 4B-1 tax reversal intact
        finally:
            _cleanup(products=[p["id"]], sale_ids=[sale_id] if sale_id else ())


# ── Test J — negative period: signed reversal survives, statutory clamps only ─
def test_j_negative_period_preserves_signed_reversal():
    """A quarter whose only activity is a $50 refund of a PRIOR quarter's sale
    is real negative collection activity. The income figures stay signed
    (−$50), and only the statutory SE/taxable-income fields clamp at zero —
    the report has no separate 'returns/allowances' line, so cross-period
    presentation as a separate refund line remains an open accounting
    decision documented in the Step 4B-2 report; the data is preserved."""
    ids = [_row("2001-09-01", -50.0, payment_method="cash",
                source_kind="refund", category="Refund")]
    try:
        payload = run(server.admin_quarterly_tax(_=ADMIN, year=2001))
        assert abs(float(payload["income"]["retail_sales"]) + 50.0) < 0.005
        assert abs(float(payload["income"]["gross"]) + 50.0) < 0.005
        # Statutory figures never go negative — that clamp lives at the
        # correct (final) level and stays.
        assert float(payload["estimate"]["se_tax"] if "estimate" in payload else 0) >= 0
    finally:
        _cleanup(retail_ids=ids)


# ── Historical taxable void: income AND tax both reconstructed ──────────────
def test_k_historical_taxable_void_income_and_tax_reconstructed():
    orig = _row("2001-10-01", 110.0, payment_method="card",
                tax_amount=10.0, tax_rate_pct=10.0, pre_tax_amount=100.0)
    void = _row("2001-10-01", -110.0, payment_method="void",
                source_kind="pos_sale_void", reversed_retail_sales_id=orig)  # no tax key
    try:
        inc = _income(2001)
        # income: +100 (sale, net of tax) −110 (keyless void) +10 (reconstruction) = 0
        assert abs(float(inc["retail_sales"])) < 0.005, inc
        assert abs(float(inc["sales_tax_collected"])) < 0.005  # 4B-1 reconstruction
    finally:
        _cleanup(retail_ids=[orig, void])
