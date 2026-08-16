"""Step 4B-1 — sales-tax reversal correctness tests.

Locks in the invariant:

    Tax liability = tax actually retained on taxable sales after valid
    refunds/reversals — reversed EXACTLY ONCE, from the authoritative
    ORIGINAL stored tax amount, never today's configured rate.

Architecture under test (hybrid):
  * new POS void offset rows store the exact negated original tax
    (tax-explicit, 0.0 included, which doubles as the generation marker);
  * historical void rows without a tax_amount key are reconstructed
    read-time in _legacy_void_tax_reversals from the linked original row;
  * /admin/sales-tax/summary and the quarterly Schedule-C tax figure both
    include negative tax rows + the reconstruction;
  * unlinked generic register refunds NEVER fabricate a tax reversal;
  * booking refunds keep their existing proportional negative-tax rows,
    which the summary now actually includes.

Same harness conventions as test_register_expected_cash.py: direct async
server calls on the disposable test DB, isolated synthetic past dates for
absolute assertions, cleanup in finally. Disposable tag TEST_TAX_REV.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import pytest
import server
from _test_loop import run

TAG = "TEST_TAX_REV"
ADMIN = {"id": "tax-test", "name": "Tax QA", "email": "tax@test", "role": "admin"}


@pytest.fixture(autouse=True)
def _restore_tax_settings():
    """The settings doc is shared by every file in a full-suite run — leaving
    sales tax enabled would silently change other files' cart totals. Restore
    whatever was configured before each test."""
    prev = run(server.db.settings.find_one({}, {"_id": 0, "sales_tax": 1})) or {}
    yield
    run(server.db.settings.update_one(
        {}, {"$set": {"sales_tax": prev.get("sales_tax") or {"enabled": False}}}, upsert=True))


def _summary(d):
    return run(server.sales_tax_summary(d, d, ADMIN))


def _set_tax(enabled=True, rate=10.0):
    run(server.db.settings.update_one(
        {},
        {"$set": {"sales_tax": {"enabled": enabled, "rate_pct": rate, "applies_to": {"retail": True}}}},
        upsert=True,
    ))


def _product(price, taxable):
    doc = {"id": str(uuid.uuid4()), "name": f"{TAG} product", "description": "", "sku": "",
           "category": "", "price": price, "active": True, "archived": False,
           "show_at_register": True, "track_inventory": False, "stock_on_hand": 0,
           "category_id": None, "subcategory_id": None, "featured": False, "image_id": None,
           "taxable": taxable}
    run(server.db.pos_products.insert_one(dict(doc)))
    return doc


def _sell(product, tenders):
    body = server.PosSaleIn(
        lines=[{"kind": "retail", "product_id": product["id"], "qty": 1}],
        tenders=tenders, idempotency_key=uuid.uuid4().hex,
    )
    return run(server.create_pos_sale(body, ADMIN))


def _void(sale_id):
    return run(server.void_pos_sale(
        sale_id, server.PosSaleVoidIn(reason=f"{TAG} void", idempotency_key=uuid.uuid4().hex), ADMIN))


class _OpenRegisterDay:
    """Minimal drawer fixture (same discipline as test_register_expected_cash)."""

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


def _cleanup(products=(), sale_ids=(), retail_ids=(), dates=()):
    async def go():
        if products:
            await server.db.pos_products.delete_many({"id": {"$in": list(products)}})
        if sale_ids:
            ids = list(sale_ids)
            await server.db.pos_sales.delete_many({"id": {"$in": ids}})
            await server.db.retail_sales.delete_many({"pos_sale_id": {"$in": ids}})
            await server.db.pos_sale_claims.delete_many({"pos_sale_id": {"$in": ids}})
            await server.db.pos_sale_void_claims.delete_many({"pos_sale_id": {"$in": ids}})
        if retail_ids:
            await server.db.retail_sales.delete_many({"id": {"$in": list(retail_ids)}})
        await server.db.retail_sales.delete_many({"description": {"$regex": TAG}})
    run(go())


class _TaxBaseline:
    """Delta snapshot — the shared disposable DB can hold other files' taxed
    rows for today, so assertions are exact deltas from this baseline."""

    def __init__(self, d):
        s = _summary(d)
        self.retail = float(s["retail_tax_total"])
        self.total = float(s["total_tax_collected"])

    def retail_at(self, delta):
        return round(self.retail + delta, 2)

    def total_at(self, delta):
        return round(self.total + delta, 2)


# ── Test A — taxable POS sale reports its tax ───────────────────────────────
def test_a_taxable_sale_reports_tax():
    _set_tax(rate=10.0)
    p = _product(100.0, taxable=True)
    sale_id = None
    with _OpenRegisterDay() as day:
        try:
            base = _TaxBaseline(day.date)
            r = _sell(p, [{"method": "card", "amount": 110.0}])
            sale_id = r["sale"]["id"]
            assert abs(float(r["sale"]["tax_amount"]) - 10.0) < 0.005
            s = _summary(day.date)
            assert abs(float(s["retail_tax_total"]) - base.retail_at(10.0)) < 0.005
            assert abs(float(s["total_tax_collected"]) - base.total_at(10.0)) < 0.005
        finally:
            _cleanup(products=[p["id"]], sale_ids=[sale_id] if sale_id else ())


# ── Test B — full taxable void nets tax to exactly zero ─────────────────────
def test_b_taxable_void_reverses_tax_exactly_once():
    _set_tax(rate=10.0)
    p = _product(100.0, taxable=True)
    sale_id = None
    with _OpenRegisterDay() as day:
        try:
            base = _TaxBaseline(day.date)
            r = _sell(p, [{"method": "card", "amount": 110.0}])
            sale_id = r["sale"]["id"]
            _void(sale_id)
            s = _summary(day.date)
            assert abs(float(s["retail_tax_total"]) - base.retail_at(0.0)) < 0.005
            assert abs(float(s["total_tax_collected"]) - base.total_at(0.0)) < 0.005
            # The reversal is STORED on the new void row (exact negated
            # original), so no reconstruction is ever needed for it.
            void_row = run(server.db.retail_sales.find_one(
                {"pos_sale_id": sale_id, "source_kind": "pos_sale_void"}, {"_id": 0}))
            assert abs(float(void_row["tax_amount"]) + 10.0) < 0.005
            assert abs(float(void_row["pre_tax_amount"]) + 100.0) < 0.005
        finally:
            _cleanup(products=[p["id"]], sale_ids=[sale_id] if sale_id else ())


# ── Test C — non-taxable void leaves no negative tax artifact ───────────────
def test_c_nontaxable_void_creates_no_tax_artifact():
    _set_tax(rate=10.0)
    p = _product(100.0, taxable=False)
    sale_id = None
    with _OpenRegisterDay() as day:
        try:
            base = _TaxBaseline(day.date)
            r = _sell(p, [{"method": "card", "amount": 100.0}])
            sale_id = r["sale"]["id"]
            _void(sale_id)
            s = _summary(day.date)
            assert abs(float(s["retail_tax_total"]) - base.retail_at(0.0)) < 0.005
            void_row = run(server.db.retail_sales.find_one(
                {"pos_sale_id": sale_id, "source_kind": "pos_sale_void"}, {"_id": 0}))
            # tax-explicit 0.0 marker, no phantom negative
            assert abs(float(void_row["tax_amount"])) < 0.005
        finally:
            _cleanup(products=[p["id"]], sale_ids=[sale_id] if sale_id else ())


# ── Test D — split tender has zero effect on the tax reversal ───────────────
def test_d_split_tender_void_reverses_tax_and_keeps_drawer_math():
    _set_tax(rate=10.0)
    p = _product(100.0, taxable=True)
    sale_id = None
    with _OpenRegisterDay() as day:
        try:
            tax_base = _TaxBaseline(day.date)
            reg0 = run(server._register_day_summary(day.date))
            cash0 = float(reg0["totals"]["expected_cash"])
            r = _sell(p, [
                {"method": "cash", "amount": 40.0, "tendered_amount": 40.0},
                {"method": "card", "amount": 70.0},
            ])
            sale_id = r["sale"]["id"]
            _void(sale_id)
            s = _summary(day.date)
            # Tax reversal is exactly the original $10 — tender mix irrelevant.
            assert abs(float(s["retail_tax_total"]) - tax_base.retail_at(0.0)) < 0.005
            # Step 1 drawer math untouched: cash out = cash in, back to start.
            reg1 = run(server._register_day_summary(day.date))
            assert abs(float(reg1["totals"]["expected_cash"]) - cash0) < 0.005
        finally:
            _cleanup(products=[p["id"]], sale_ids=[sale_id] if sale_id else ())


# ── Test E — HISTORICAL-style void (no tax on the reversal row) ─────────────
def test_e_historical_void_reconstructed_at_read_time():
    d = "2001-03-01"  # isolated synthetic date — absolute assertions
    orig_id, void_id = str(uuid.uuid4()), str(uuid.uuid4())
    try:
        run(server.db.retail_sales.insert_one({
            "id": orig_id, "date": d, "amount": 110.0, "payment_method": "card",
            "tax_amount": 10.0, "tax_rate_pct": 10.0, "pre_tax_amount": 100.0,
            "pos_sale_id": f"{TAG}-hist-sale", "description": f"{TAG} historical taxable sale",
            "created_at": f"{d}T10:00:00",
        }))
        # Pre-fix void shape: full reversal, NO tax_amount key at all.
        run(server.db.retail_sales.insert_one({
            "id": void_id, "date": d, "amount": -110.0, "payment_method": "void",
            "source_kind": "pos_sale_void", "pos_sale_id": f"{TAG}-hist-sale",
            "reversed_retail_sales_id": orig_id,
            "description": f"{TAG} historical void", "created_at": f"{d}T11:00:00",
        }))
        s = _summary(d)
        assert abs(float(s["retail_tax_total"])) < 0.005, s
        assert abs(float(s["total_tax_collected"])) < 0.005
    finally:
        _cleanup(retail_ids=[orig_id, void_id])


# ── Test F — explicit reversal row is NOT also reconstructed ────────────────
def test_f_explicit_reversal_row_never_double_reversed():
    d = "2001-03-02"
    orig_id, void_id = str(uuid.uuid4()), str(uuid.uuid4())
    try:
        run(server.db.retail_sales.insert_one({
            "id": orig_id, "date": d, "amount": 110.0, "payment_method": "card",
            "tax_amount": 10.0, "tax_rate_pct": 10.0, "pre_tax_amount": 100.0,
            "description": f"{TAG} taxable sale", "created_at": f"{d}T10:00:00",
        }))
        # Post-fix void shape: explicit stored negative tax.
        run(server.db.retail_sales.insert_one({
            "id": void_id, "date": d, "amount": -110.0, "payment_method": "void",
            "source_kind": "pos_sale_void", "reversed_retail_sales_id": orig_id,
            "tax_amount": -10.0, "tax_rate_pct": 10.0, "pre_tax_amount": -100.0,
            "description": f"{TAG} explicit void", "created_at": f"{d}T11:00:00",
        }))
        s = _summary(d)
        # +10 −10 = 0 — NOT −10 (which a second, reconstructed reversal would give)
        assert abs(float(s["retail_tax_total"])) < 0.005, s
    finally:
        _cleanup(retail_ids=[orig_id, void_id])


# ── Test G — unlinked generic refund fabricates NO tax ──────────────────────
def test_g_unlinked_register_refund_fabricates_no_tax():
    d = "2001-03-03"
    try:
        # Same shape admin_register_refund writes: no linkage, no tax fields.
        run(server.db.retail_sales.insert_one({
            "id": str(uuid.uuid4()), "date": d, "amount": -15.0, "payment_method": "cash",
            "source_kind": "refund", "category": "Refund",
            "description": f"{TAG} goodwill refund", "created_at": f"{d}T10:00:00",
        }))
        s = _summary(d)
        assert abs(float(s["retail_tax_total"])) < 0.005
        assert abs(float(s["total_tax_collected"])) < 0.005
        # And the live endpoint itself writes no tax field.
        r = run(server.admin_register_refund(server.RegisterRefundIn(
            reason=f"{TAG} live refund", amount=15.0, payment_method="cash",
            date=server.business_today().isoformat()), ADMIN))
        assert "tax_amount" not in r["refund"]
    finally:
        _cleanup(dates=[d])


# ── Test H — linked full generic refund: documented as unsupported ──────────
def test_h_generic_refund_linkage_not_supported_documented():
    """RegisterRefundIn carries no original-transaction linkage (client_id,
    amount, method, reason, notes, date only) — so a 'safely linked full
    refund with automatic exact tax reversal' cannot exist for the generic
    register refund today. This test pins that fact so the day linkage IS
    added, this assertion fails and the tax handling must be designed in.
    The linked flows that DO reverse tax are POS voids (tests B/D/E/F) and
    booking refunds (test I)."""
    fields = set(server.RegisterRefundIn.model_fields.keys())
    assert "original_retail_sales_id" not in fields
    assert "pos_sale_id" not in fields
    assert "tax_amount" not in fields


# ── Test I — booking refund proportional tax regression ─────────────────────
def test_i_booking_refund_negative_tax_row_included_in_summary():
    d = "2001-03-04"
    booking_id = f"{TAG}-bk-{uuid.uuid4().hex[:6]}"
    ids = [str(uuid.uuid4()) for _ in range(2)]
    try:
        # Booking with collected tax (what checkout writes)…
        run(server.db.bookings.insert_one({
            "id": booking_id, "date": d, "status": "completed", "payment_status": "paid",
            "actual_price": 107.25, "amount_paid": 107.25, "payment_method": "card",
            "tax_amount": 7.25, "tax_rate_pct": 7.25, "client_name": TAG, "dog_name": TAG,
            "service_type": "daycare", "created_at": f"{d}T09:00:00",
        }))
        # …and the negative-tax refund row the booking-refund path writes
        # (full refund → full proportional tax: −7.25).
        run(server.db.retail_sales.insert_one({
            "id": ids[0], "date": d, "amount": -107.25, "tax_amount": -7.25,
            "category": "Refund", "payment_method": "card", "booking_id": booking_id,
            "source_kind": "refund", "description": f"{TAG} booking refund",
            "created_at": f"{d}T12:00:00",
        }))
        s = _summary(d)
        # +7.25 booking tax −7.25 refund tax = 0 net liability
        assert abs(float(s["bookings_tax_total"]) - 7.25) < 0.005
        assert abs(float(s["retail_tax_total"]) + 7.25) < 0.005
        assert abs(float(s["total_tax_collected"])) < 0.005
    finally:
        run(server.db.bookings.delete_many({"id": booking_id}))
        _cleanup(retail_ids=ids)


# ── Test J — report is deterministic: re-reading never re-reverses ──────────
def test_j_summary_repeatable_no_accumulation():
    d = "2001-03-05"
    orig_id, void_id = str(uuid.uuid4()), str(uuid.uuid4())
    try:
        run(server.db.retail_sales.insert_one({
            "id": orig_id, "date": d, "amount": 110.0, "tax_amount": 10.0,
            "description": f"{TAG} sale", "created_at": f"{d}T10:00:00",
        }))
        run(server.db.retail_sales.insert_one({
            "id": void_id, "date": d, "amount": -110.0, "source_kind": "pos_sale_void",
            "reversed_retail_sales_id": orig_id,
            "description": f"{TAG} historical void", "created_at": f"{d}T11:00:00",
        }))
        first = _summary(d)
        second = _summary(d)
        assert first["retail_tax_total"] == second["retail_tax_total"] == 0.0
        assert first["total_tax_collected"] == second["total_tax_collected"] == 0.0
        assert first["by_month"] == second["by_month"]
    finally:
        _cleanup(retail_ids=[orig_id, void_id])


# ── Quarterly Schedule-C tax figure inherits the same corrections ───────────
def test_quarterly_tax_collected_reverses_historical_void():
    d = "2001-03-06"
    orig_id, void_id = str(uuid.uuid4()), str(uuid.uuid4())
    try:
        run(server.db.retail_sales.insert_one({
            "id": orig_id, "date": d, "amount": 110.0, "tax_amount": 10.0,
            "description": f"{TAG} sale", "created_at": f"{d}T10:00:00",
        }))
        run(server.db.retail_sales.insert_one({
            "id": void_id, "date": d, "amount": -110.0, "source_kind": "pos_sale_void",
            "reversed_retail_sales_id": orig_id,
            "description": f"{TAG} historical void", "created_at": f"{d}T11:00:00",
        }))
        legacy = run(server._legacy_void_tax_reversals(d, d))
        assert len(legacy) == 1 and abs(legacy[0]["tax_amount"] + 10.0) < 0.005
    finally:
        _cleanup(retail_ids=[orig_id, void_id])
