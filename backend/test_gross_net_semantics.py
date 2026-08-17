"""Step 4B-4 — gross / refunds & reversals / net semantic tests.

Locks in the definitions, application-wide:

    Gross collected  = positive collected income in the window, BEFORE
                       refunds/reversals (never manufactured from
                       out-of-window sales — see test G);
    Refunds & reversals = magnitude of in-window reversal activity
                       (refunds, POS voids, invoice-payment voids,
                       Stripe refunds — any negative income row);
    Net collected    = gross − refunds & reversals.

And the profit invariant: net income − expenses − labor is numerically
IDENTICAL to what the old (mislabeled) formulas produced — only the
decomposition above it changed.

Surfaces under test: /transactions/weekly-summary (new honest gross_total +
refunds_reversals_total + net_total), pl_report.build_pl_data (+ PDF data),
the register tax-summary CSV trio, and the Step 3 register trio (regression).
Isolated synthetic 2001 dates → absolute assertions. Tag TEST_GROSSNET.
"""
import csv
import io
import uuid

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import pl_report
import server
from _test_loop import run

TAG = "TEST_GROSSNET"
ADMIN = {"id": "gn-test", "name": "GN QA", "email": "gn@test", "role": "admin"}

# Week of Mon 2001-04-02 … Sun 2001-04-08; month window for P&L.
WEEK_REF = "2001-04-04"
D = "2001-04-03"
PL_START, PL_END = "2001-04-01", "2001-04-30"


def _weekly():
    w = run(server.weekly_summary(ADMIN, ref_date=WEEK_REF))
    return {"gross": float(w["gross_total"]), "refunds": float(w["refunds_reversals_total"]),
            "net": float(w["net_total"]), "completed": float(w["completed_total"])}


def _pl():
    p = run(pl_report.build_pl_data(server.db, PL_START, PL_END))
    inc = p["income"]
    return p, {"gross": float(inc["gross_total"]), "refunds": float(inc["refunds_reversals_total"]),
               "net": float(inc["net_total"])}


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


def _cleanup(retail_ids=(), booking_ids=()):
    async def go():
        if retail_ids:
            await server.db.retail_sales.delete_many({"id": {"$in": list(retail_ids)}})
        if booking_ids:
            await server.db.bookings.delete_many({"id": {"$in": list(booking_ids)}})
        await server.db.retail_sales.delete_many({"description": {"$regex": TAG}})
        await server.db.expenses.delete_many({"description": {"$regex": TAG}})
    run(go())


# ── Test A — sale only ──────────────────────────────────────────────────────
def test_a_sale_only():
    ids = [_row(100.0, payment_method="card")]
    try:
        w = _weekly()
        assert (w["gross"], w["refunds"], w["net"]) == (100.0, 0.0, 100.0), w
        _, p = _pl()
        assert (p["gross"], p["refunds"], p["net"]) == (100.0, 0.0, 100.0), p
    finally:
        _cleanup(retail_ids=ids)


# ── Test B — sale + partial refund ──────────────────────────────────────────
def test_b_partial_refund():
    ids = [_row(100.0, payment_method="card"),
           _row(-25.0, payment_method="cash", source_kind="refund", category="Refund")]
    try:
        w = _weekly()
        assert (w["gross"], w["refunds"], w["net"]) == (100.0, 25.0, 75.0), w
        _, p = _pl()
        assert (p["gross"], p["refunds"], p["net"]) == (100.0, 25.0, 75.0), p
    finally:
        _cleanup(retail_ids=ids)


# ── Test C — sale + full void ───────────────────────────────────────────────
def test_c_full_void():
    orig = _row(100.0, payment_method="card")
    void = _row(-100.0, payment_method="void", source_kind="pos_sale_void",
                reversed_retail_sales_id=orig, tax_amount=0.0)
    try:
        w = _weekly()
        assert (w["gross"], w["refunds"], w["net"]) == (100.0, 100.0, 0.0), w
        _, p = _pl()
        assert (p["gross"], p["refunds"], p["net"]) == (100.0, 100.0, 0.0), p
    finally:
        _cleanup(retail_ids=[orig, void])


# ── Test D — mixed transaction set ──────────────────────────────────────────
def test_d_mixed_set():
    pos = _row(100.0, payment_method="card")
    bid = _booking(200.0)
    ids = [pos,
           _row(-25.0, payment_method="cash", source_kind="refund", category="Refund"),
           _row(50.0, payment_method="cash", source_kind="credit_pack_sale"),
           _row(-100.0, payment_method="void", source_kind="pos_sale_void",
                reversed_retail_sales_id=pos, tax_amount=0.0)]
    try:
        w = _weekly()
        assert (w["gross"], w["refunds"], w["net"]) == (350.0, 125.0, 225.0), w
        _, p = _pl()
        assert (p["gross"], p["refunds"], p["net"]) == (350.0, 125.0, 225.0), p
    finally:
        _cleanup(retail_ids=ids, booking_ids=[bid])


# ── Test E — Stripe refund ──────────────────────────────────────────────────
def test_e_stripe_refund():
    ids = [_row(100.0, payment_method="stripe_online", source_kind="stripe_online_payment"),
           _row(-25.0, payment_method="stripe_online", source_kind="stripe_refund")]
    try:
        w = _weekly()
        assert (w["gross"], w["refunds"], w["net"]) == (100.0, 25.0, 75.0), w
    finally:
        _cleanup(retail_ids=ids)


# ── Test F — booking full refund ────────────────────────────────────────────
def test_f_booking_full_refund():
    bid = _booking(100.0)
    refund = _row(-100.0, payment_method="cash", source_kind="refund",
                  category="Refund", booking_id=bid)
    try:
        w = _weekly()
        assert (w["gross"], w["refunds"], w["net"]) == (100.0, 100.0, 0.0), w
        _, p = _pl()
        assert (p["gross"], p["refunds"], p["net"]) == (100.0, 100.0, 0.0), p
    finally:
        _cleanup(retail_ids=[refund], booking_ids=[bid])


# ── Test G — refund-only period: gross is NEVER manufactured ────────────────
def test_g_refund_only_period_no_manufactured_gross():
    """The original sale lies outside the window; only the −$50 refund is in
    it. Gross must be $0 (positive in-window activity only), net −$50."""
    outside = str(uuid.uuid4())
    run(server.db.retail_sales.insert_one({
        "id": outside, "date": "2001-03-20", "amount": 50.0,  # prior window
        "description": f"{TAG} prior-period sale", "created_at": "2001-03-20T10:00:00",
    }))
    refund = _row(-50.0, payment_method="cash", source_kind="refund", category="Refund")
    try:
        w = _weekly()
        assert (w["gross"], w["refunds"], w["net"]) == (0.0, 50.0, -50.0), w
        _, p = _pl()
        assert (p["gross"], p["refunds"], p["net"]) == (0.0, 50.0, -50.0), p
    finally:
        _cleanup(retail_ids=[outside, refund])


# ── Test H + J — profit invariant across the semantic fix ───────────────────
def test_h_profit_unchanged():
    """net(new) − expenses − labor must equal the pre-fix profit, which used
    the old (mislabeled, numerically net) gross: 100 − 25 − 20 = 55."""
    ids = [_row(100.0, payment_method="card"),
           _row(-25.0, payment_method="cash", source_kind="refund", category="Refund")]
    run(server.db.expenses.insert_one({
        "id": str(uuid.uuid4()), "date": D, "amount": 20.0, "category": "Supplies",
        "description": f"{TAG} expense", "created_at": f"{D}T12:00:00",
    }))
    try:
        data, p = _pl()
        assert p["net"] == 75.0
        assert abs(float(data["net_before_payroll"]) - 55.0) < 0.005   # 75 − 20
        assert abs(float(data["net"]) - 55.0) < 0.005                  # payroll 0 in window
        # Cross-report: Finance range net for the same day agrees.
        s = run(server.summary_range(ADMIN, start_date=D, end_date=D))
        assert abs(float(s["net_before_labor"]) - 55.0) < 0.005
    finally:
        _cleanup(retail_ids=ids)


# ── Test K — P&L PDF receives the trio and still renders ────────────────────
def test_k_pdf_data_and_render():
    ids = [_row(100.0, payment_method="card"),
           _row(-25.0, payment_method="cash", source_kind="refund", category="Refund")]
    try:
        data, p = _pl()
        assert (p["gross"], p["refunds"], p["net"]) == (100.0, 25.0, 75.0)
        pdf = pl_report.render_pl_pdf(data, "Sit Happens Test")
        assert pdf[:4] == b"%PDF"
    finally:
        _cleanup(retail_ids=ids)


# ── Test L — tax-summary CSV honest labels ──────────────────────────────────
def test_l_tax_summary_csv_labels():
    ids = [_row(100.0, payment_method="cash"),
           _row(-25.0, payment_method="cash", source_kind="refund", category="Refund")]
    try:
        resp = run(server.admin_register_export_csv(
            kind="tax-summary", start_date=D, end_date=D, user=ADMIN))
        text = resp.body.decode("utf-8")
        assert "Gross cash collected" not in text
        rows = dict((r[0], r[1]) for r in csv.reader(io.StringIO(text)) if len(r) == 2)
        assert float(rows["Gross collected (all tenders)"]) == 100.0
        assert float(rows["Refunds & reversals"]) == 25.0
        assert float(rows["Net collected (all tenders)"]) == 75.0
    finally:
        _cleanup(retail_ids=ids)


# ── Test M — Step 3 register trio regression ────────────────────────────────
def test_m_register_trio_regression():
    ids = [_row(100.0, payment_method="cash"),
           _row(-25.0, payment_method="cash", source_kind="refund", category="Refund")]
    try:
        day = run(server._register_day_summary(D))
        t = day["totals"]
        assert abs(float(t["gross_incoming_total"]) - 100.0) < 0.005
        assert abs(float(t["refund_total"]) - 25.0) < 0.005
        assert abs(float(t["incoming_total"]) - 75.0) < 0.005
    finally:
        _cleanup(retail_ids=ids)
