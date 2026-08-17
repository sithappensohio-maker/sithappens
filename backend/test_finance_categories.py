"""Step 4B-5 — Finance income category/bucket correctness tests.

Locks in the ONE canonical classifier (_finance_income_category) across
weekly summary, range summary, and the P&L:

  * Retail (items) = merchandise only — POS/manual retail rows and online
    SHOP orders (channel ≠ category); never invoice/tab payments, packs,
    refunds, or voids;
  * invoice / tab / online-invoice payments = "Invoice / Account Payments"
    (honest — the underlying category is not reconstructable from the
    payment row, so it is not guessed);
  * reversals appear as their own negative "Refunds & reversals" line,
    never as a positive revenue category;
  * weekly and range categorize identical rows identically;
  * and the CRITICAL INVARIANT: gross / refunds / net / profit are
    numerically identical to the pre-4B-5 values for the same activity
    (the categories partition the same rows — pinned against the exact
    totals the old code produced for this scenario: gross 580,
    refunds 75, net 505).

Isolated synthetic dates → absolute assertions. Tag TEST_FINCAT.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import pl_report
import server
from _test_loop import run

TAG = "TEST_FINCAT"
ADMIN = {"id": "fincat", "name": "FinCat QA", "email": "fincat@test", "role": "admin"}
D = "2001-07-04"  # Wednesday — weekly window 2001-07-02..08


def _row(amount, **extra):
    doc = {"id": str(uuid.uuid4()), "date": D, "amount": amount,
           "description": f"{TAG} row", "created_at": f"{D}T10:00:00"}
    doc.update(extra)
    run(server.db.retail_sales.insert_one(dict(doc)))
    return doc["id"]


def _booking(amount):
    bid = f"{TAG}-bk-{uuid.uuid4().hex[:6]}"
    run(server.db.bookings.insert_one({
        "id": bid, "date": D, "status": "completed", "payment_status": "paid",
        "actual_price": amount, "amount_paid": amount, "payment_method": "cash",
        "client_name": TAG, "dog_name": TAG, "service_type": "daycare",
        "created_at": f"{D}T09:00:00",
    }))
    return bid


def _weekly():
    return run(server.weekly_summary(ADMIN, ref_date=D))


def _range():
    return run(server.summary_range(ADMIN, start_date=D, end_date=D))


def _pl():
    return run(pl_report.build_pl_data(server.db, D, D))


def _by_service(w, name):
    return next((b for b in w["by_service"] if b["name"] == name), None)


def _cleanup(retail_ids=(), booking_ids=()):
    async def go():
        if retail_ids:
            await server.db.retail_sales.delete_many({"id": {"$in": list(retail_ids)}})
        if booking_ids:
            await server.db.bookings.delete_many({"id": {"$in": list(booking_ids)}})
        await server.db.retail_sales.delete_many({"description": {"$regex": TAG}})
    run(go())


class _Scenario:
    """The required mixed scenario, built once per test that needs it:
    retail +100, pack +50, training +200, booking +75, invoice payment +30,
    tab payment +25, Stripe shop order +60, refund −20, POS sale +40 then
    void −40, Stripe refund −15."""

    def __enter__(self):
        self.retail_ids = []
        self.pos_sale = _row(100.0, payment_method="cash", category="POS")
        void_target = _row(40.0, payment_method="card", category="POS")
        self.retail_ids = [
            self.pos_sale, void_target,
            _row(50.0, payment_method="cash", source_kind="credit_pack_sale"),
            _row(200.0, payment_method="card", source_kind="training_program_sale"),
            _row(30.0, payment_method="venmo", source_kind="invoice_payment"),
            _row(25.0, payment_method="cash", source_kind="tab_payment"),
            _row(60.0, payment_method="stripe_online", source_kind="shop_order"),
            _row(-20.0, payment_method="cash", source_kind="refund", category="Refund"),
            _row(-40.0, payment_method="void", source_kind="pos_sale_void",
                 reversed_retail_sales_id=void_target, tax_amount=0.0),
            _row(-15.0, payment_method="stripe_online", source_kind="stripe_refund"),
        ]
        self.booking = _booking(75.0)
        return self

    def __exit__(self, *exc):
        _cleanup(retail_ids=self.retail_ids, booking_ids=[self.booking])
        return False


# ── A — genuine retail sale stays Retail ────────────────────────────────────
def test_a_retail_sale_stays_retail():
    ids = [_row(100.0, payment_method="cash", category="POS")]
    try:
        w = _weekly()
        assert w["retail_total"] == 100.0
        assert _by_service(w, "Retail (items)")["total"] == 100.0
    finally:
        _cleanup(retail_ids=ids)


# ── B — credit pack: specific category in BOTH weekly and range ─────────────
def test_b_credit_pack_consistent():
    ids = [_row(50.0, payment_method="cash", source_kind="credit_pack_sale")]
    try:
        w, s = _weekly(), _range()
        assert w["credit_pack_sales_total"] == 50.0 and w["retail_total"] == 0.0
        assert _by_service(w, "Credit Packs")["total"] == 50.0
        assert s["credit_pack_sales_total"] == 50.0 and s["retail_total"] == 0.0
    finally:
        _cleanup(retail_ids=ids)


# ── C — training program consistent ─────────────────────────────────────────
def test_c_training_consistent():
    ids = [_row(200.0, payment_method="card", source_kind="training_program_sale")]
    try:
        w, s = _weekly(), _range()
        assert w["training_revenue_total"] == 200.0 and w["retail_total"] == 0.0
        assert s["training_revenue_total"] == 200.0 and s["retail_total"] == 0.0
    finally:
        _cleanup(retail_ids=ids)


# ── D — booking/service stays a service category ────────────────────────────
def test_d_booking_service_category():
    bid = _booking(75.0)
    try:
        w = _weekly()
        assert _by_service(w, "Daycare")["total"] == 75.0
        assert w["retail_total"] == 0.0
        assert _range()["service_total"] == 75.0
    finally:
        _cleanup(booking_ids=[bid])


# ── E — invoice payment is NOT Retail ───────────────────────────────────────
def test_e_invoice_payment_not_retail():
    ids = [_row(30.0, payment_method="venmo", source_kind="invoice_payment")]
    try:
        w, s = _weekly(), _range()
        assert w["retail_total"] == 0.0, w["retail_total"]
        assert w["account_payments_total"] == 30.0
        assert _by_service(w, "Invoice / Account Payments")["total"] == 30.0
        assert s["retail_total"] == 0.0 and s["account_payments_total"] == 30.0
        # Totals still count the money exactly once.
        assert w["completed_total"] == 30.0 and s["completed_total"] == 30.0
    finally:
        _cleanup(retail_ids=ids)


# ── F — tab payment is NOT Retail ───────────────────────────────────────────
def test_f_tab_payment_not_retail():
    ids = [_row(25.0, payment_method="cash", source_kind="tab_payment")]
    try:
        w = _weekly()
        assert w["retail_total"] == 0.0
        assert w["account_payments_total"] == 25.0
    finally:
        _cleanup(retail_ids=ids)


# ── G — Stripe SHOP order is Retail (channel ≠ category) ────────────────────
def test_g_stripe_shop_order_is_retail():
    ids = [_row(60.0, payment_method="stripe_online", source_kind="shop_order")]
    try:
        w = _weekly()
        assert w["retail_total"] == 60.0
        assert w["account_payments_total"] == 0.0
        # …while a Stripe-paid INVOICE stays an account collection.
        ids.append(_row(30.0, payment_method="stripe_online", source_kind="stripe_online_payment"))
        w = _weekly()
        assert w["retail_total"] == 60.0 and w["account_payments_total"] == 30.0
    finally:
        _cleanup(retail_ids=ids)


# ── H — split tender has zero influence on category ─────────────────────────
def test_h_split_tender_full_amount_retail():
    p = {"id": str(uuid.uuid4()), "name": f"{TAG} shirt", "price": 100.0, "active": True,
         "archived": False, "show_at_register": True, "track_inventory": False,
         "taxable": False, "description": "", "sku": "", "category": ""}
    run(server.db.pos_products.insert_one(dict(p)))
    today = server.business_today().isoformat()
    marker = f"{TAG}-{uuid.uuid4()}"
    created = run(server.db.cash_drawer_sessions.find_one_and_update(
        {"date": today},
        {"$setOnInsert": {"date": today, "opening_cash": 0.0, "opened_at": server.now_iso(),
                          "opened_by": marker, "opened_by_name": TAG}},
        upsert=True, projection={"_id": 0})) is None
    sale_id = None
    try:
        base = run(server.weekly_summary(ADMIN, ref_date=today))["retail_total"]
        body = server.PosSaleIn(
            lines=[{"kind": "retail", "product_id": p["id"], "qty": 1}],
            tenders=[{"method": "cash", "amount": 40.0, "tendered_amount": 40.0},
                     {"method": "card", "amount": 60.0}],
            idempotency_key=uuid.uuid4().hex)
        sale_id = run(server.create_pos_sale(body, ADMIN))["sale"]["id"]
        w = run(server.weekly_summary(ADMIN, ref_date=today))
        # The full $100 is Retail — tender composition is a separate dimension.
        assert round(w["retail_total"] - base, 2) == 100.0
    finally:
        run(server.db.pos_products.delete_many({"id": p["id"]}))
        if sale_id:
            run(server.db.pos_sales.delete_many({"id": sale_id}))
            run(server.db.retail_sales.delete_many({"pos_sale_id": sale_id}))
            run(server.db.pos_sale_claims.delete_many({"pos_sale_id": sale_id}))
        if created:
            run(server.db.cash_drawer_sessions.delete_one({"date": today, "opened_by": marker}))


# ── I + J — voids and refunds: their own negative line, never positive Retail ─
def test_ij_reversals_own_negative_line():
    orig = _row(40.0, payment_method="card", category="POS")
    ids = [orig,
           _row(-40.0, payment_method="void", source_kind="pos_sale_void",
                reversed_retail_sales_id=orig, tax_amount=0.0),
           _row(-20.0, payment_method="cash", source_kind="refund", category="Refund")]
    try:
        w = _weekly()
        assert w["retail_total"] == 40.0            # only the genuine sale
        rev = _by_service(w, "Refunds & reversals")
        assert rev is not None and rev["total"] == -60.0
        assert w["refunds_reversals_total"] == 60.0  # 4B-4 magnitude intact
        assert w["net_total"] == -20.0               # 40 − 40 − 20
    finally:
        _cleanup(retail_ids=ids)


# ── K — weekly/range parity for identical rows + L — totals invariant ───────
def test_kl_parity_and_totals_invariant():
    with _Scenario():
        w, s, p = _weekly(), _range(), _pl()
        # K — same rows, same categories, same numbers on every surface.
        for surface in (w, s):
            assert surface["retail_total"] == 200.0, surface["retail_total"]
            assert surface["training_revenue_total"] == 200.0
            assert surface["credit_pack_sales_total"] == 50.0
            assert surface["account_payments_total"] == 55.0
        assert p["income"]["retail_total"] == 200.0
        assert p["income"]["credit_pack_sales_total"] == 50.0
        assert p["income"]["account_payments_total"] == 55.0
        assert p["income"]["training_revenue_total"] == 200.0
        # L — CRITICAL INVARIANT: identical to the pre-4B-5 values captured
        # for this exact scenario (gross 580 / refunds 75 / net 505), on
        # every surface, with profit equal to net (no expenses/labor here).
        assert w["gross_total"] == 580.0 and w["refunds_reversals_total"] == 75.0 and w["net_total"] == 505.0
        assert w["completed_total"] == 505.0 and s["completed_total"] == 505.0
        assert p["income"]["gross_total"] == 580.0
        assert p["income"]["refunds_reversals_total"] == 75.0
        assert p["income"]["net_total"] == 505.0
        assert p["net"] == 505.0 and p["net_before_payroll"] == 505.0
        # Category lines sum back to net — nothing dropped, nothing doubled.
        parts = (w["retail_total"] + w["credit_pack_sales_total"] + w["training_revenue_total"]
                 + w["account_payments_total"] - w["refunds_reversals_total"] + 75.0)  # +booking
        assert round(parts, 2) == 505.0


# ── M — ambiguous historical row: safe fallback, no guessing ────────────────
def test_m_historical_ambiguous_row_fallback():
    # No source_kind, vague description, positive amount — the honest
    # fallback is the catch-all these rows always lived in: Retail (items).
    ids = [_row(12.34, payment_method="cash", description=f"{TAG} misc old entry")]
    try:
        w = _weekly()
        assert w["retail_total"] == 12.34
        assert w["account_payments_total"] == 0.0
        assert server._finance_income_category({"amount": 12.34}) == "retail"
        # …and an ambiguous NEGATIVE row is a reversal, never negative revenue.
        assert server._finance_income_category({"amount": -5.0}) == "refunds_reversals"
    finally:
        _cleanup(retail_ids=ids)
