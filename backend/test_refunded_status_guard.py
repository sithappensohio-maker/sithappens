"""Step 4B-6 — refunded-status double-subtraction guard tests.

Locks in the invariant:

    A refund reduces collected income exactly once — never via BOTH the
    signed reversal row and status-based suppression of the original.

Two coexisting refund representations (see _cash_revenue's comment):
  * LEGACY status-only — payment_status "refunded", no reversal row: the
    status is the refund; revenue contribution stays $0 (preserved);
  * MODERN row-based — booking_refund writes the negative retail row and
    stamps financial_refund_total WITHOUT touching payment_status. If a
    historical/manual edit also flipped the status, the booking keeps its
    collected revenue and the row subtracts it once (was: −100 net).

Write side: the manual transaction editor already 409s money-field edits
on financially locked bookings (paid/refunded/checked-out are locked), so
the conflicting state cannot be created through the API — pinned here too.

Isolated synthetic dates → absolute assertions. Tag TEST_REFSTAT.
"""
import uuid

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import pl_report
import pytest
import server
from _test_loop import run

TAG = "TEST_REFSTAT"
ADMIN = {"id": "refstat", "name": "RefStat QA", "email": "refstat@test", "role": "admin"}
D = "2001-09-05"  # Wednesday — weekly window 2001-09-03..09


def _booking(amount, payment_status="paid", **extra):
    bid = f"{TAG}-bk-{uuid.uuid4().hex[:6]}"
    doc = {"id": bid, "date": D, "status": "completed", "payment_status": payment_status,
           "actual_price": amount, "amount_paid": amount, "payment_method": "card",
           "client_name": TAG, "dog_name": TAG, "service_type": "daycare",
           "created_at": f"{D}T09:00:00"}
    doc.update(extra)
    run(server.db.bookings.insert_one(doc))
    return bid


def _refund_row(bid, amount, tax=0.0):
    rid = str(uuid.uuid4())
    doc = {"id": rid, "date": D, "amount": -abs(amount), "payment_method": "card",
           "booking_id": bid, "source_kind": "refund", "category": "Refund",
           "description": f"{TAG} refund", "created_at": f"{D}T12:00:00"}
    if tax:
        doc["tax_amount"] = -abs(tax)
    run(server.db.retail_sales.insert_one(doc))
    return rid


def _mark_row_refund(bid, total, full=True):
    """The booking-side stamp booking_refund writes with its reversal row."""
    run(server.db.bookings.update_one({"id": bid}, {"$set": {
        "financial_refund_total": total,
        "financial_refund_status": "full" if full else "partial",
        "financial_locked": True,
    }}))


def _net():
    w = run(server.weekly_summary(ADMIN, ref_date=D))
    s = run(server.summary_range(ADMIN, start_date=D, end_date=D))
    p = run(pl_report.build_pl_data(server.db, D, D))
    assert w["completed_total"] == s["completed_total"] == p["income"]["net_total"], (
        w["completed_total"], s["completed_total"], p["income"]["net_total"])
    return w["completed_total"], w, p


def _cleanup():
    run(server.db.bookings.delete_many({"id": {"$regex": TAG}}))
    run(server.db.retail_sales.delete_many({"description": {"$regex": TAG}}))


# ── A — normal paid booking ─────────────────────────────────────────────────
def test_a_normal_paid_booking():
    _booking(100.0)
    try:
        assert _net()[0] == 100.0
    finally:
        _cleanup()


# ── B — proper full refund nets to zero ─────────────────────────────────────
def test_b_proper_full_refund():
    bid = _booking(100.0)  # payment_status stays "paid" — the real flow's shape
    _refund_row(bid, 100.0)
    _mark_row_refund(bid, 100.0)
    try:
        assert _net()[0] == 0.0
    finally:
        _cleanup()


# ── C — conflicting status + reversal row nets 0, not −100 ──────────────────
def test_c_conflicting_status_and_row():
    bid = _booking(100.0, payment_status="refunded")
    _refund_row(bid, 100.0)
    _mark_row_refund(bid, 100.0)
    try:
        assert _net()[0] == 0.0
    finally:
        _cleanup()


# ── D — legacy status-only refunded booking stays zeroed ────────────────────
def test_d_legacy_status_only_refund():
    _booking(100.0, payment_status="refunded")  # no row, no refund stamp
    try:
        # The status IS the refund in the legacy model — revenue must stay 0,
        # never resurrected to +100.
        assert _net()[0] == 0.0
    finally:
        _cleanup()


# ── E — partial refund ──────────────────────────────────────────────────────
def test_e_partial_refund():
    bid = _booking(100.0)
    _refund_row(bid, 25.0)
    _mark_row_refund(bid, 25.0, full=False)
    try:
        assert _net()[0] == 75.0
    finally:
        _cleanup()


# ── F — partial refund + conflicting status keeps the retained $75 ──────────
def test_f_partial_refund_with_status_conflict():
    bid = _booking(100.0, payment_status="refunded")
    _refund_row(bid, 25.0)
    _mark_row_refund(bid, 25.0, full=False)
    try:
        # collected 100 − row 25 = 75; never 0 and never −25.
        assert _net()[0] == 75.0
    finally:
        _cleanup()


# ── G — multiple partial refunds ────────────────────────────────────────────
def test_g_multiple_partial_refunds():
    bid = _booking(100.0, payment_status="refunded")  # worst case: status also flipped
    _refund_row(bid, 20.0)
    _refund_row(bid, 30.0)
    _mark_row_refund(bid, 50.0, full=False)
    try:
        assert _net()[0] == 50.0
    finally:
        _cleanup()


# ── H — manual editor cannot create the conflicting state ───────────────────
def test_h_manual_editor_guard():
    bid = _booking(100.0)
    _refund_row(bid, 100.0)
    _mark_row_refund(bid, 100.0)
    try:
        with pytest.raises(server.HTTPException) as exc:
            run(server.update_transaction(bid, server.TransactionUpdateIn(payment_status="refunded"), ADMIN))
        assert exc.value.status_code == 409
        assert "locked" in str(exc.value.detail).lower()
        # Financial records unchanged by the rejected request.
        b = run(server.db.bookings.find_one({"id": bid}, {"_id": 0, "payment_status": 1}))
        assert b["payment_status"] == "paid"
        assert _net()[0] == 0.0
    finally:
        _cleanup()


# ── I — historical bad-state resilience (seeded directly) ───────────────────
def test_i_historical_bad_state_resilience():
    # The exact shape production history could contain: refunded status AND
    # a full reversal row — seeded raw, bypassing every endpoint guard.
    bid = _booking(100.0, payment_status="refunded",
                   financial_refund_total=100.0, financial_refund_status="full",
                   financial_locked=True)
    _refund_row(bid, 100.0)
    try:
        total, w, p = _net()
        assert total == 0.0
        # Deterministic on re-read.
        assert _net()[0] == 0.0
    finally:
        _cleanup()


# ── J — tax regression (4B-1): income $0 AND tax $0 after full refund ───────
def test_j_taxable_refund_tax_regression():
    bid = _booking(110.0, payment_status="refunded", tax_amount=10.0, tax_rate_pct=10.0,
                   financial_refund_total=110.0, financial_refund_status="full")
    _refund_row(bid, 110.0, tax=10.0)
    try:
        assert _net()[0] == 0.0
        tax = run(server.sales_tax_summary(D, D, ADMIN))
        assert abs(float(tax["total_tax_collected"])) < 0.005
    finally:
        _cleanup()


# ── K — category regression (4B-5) ──────────────────────────────────────────
def test_k_category_regression():
    bid = _booking(100.0, payment_status="refunded",
                   financial_refund_total=100.0, financial_refund_status="full")
    _refund_row(bid, 100.0)
    try:
        w = run(server.weekly_summary(ADMIN, ref_date=D))
        daycare = next((b for b in w["by_service"] if b["name"] == "Daycare"), None)
        reversals = next((b for b in w["by_service"] if b["name"] == "Refunds & reversals"), None)
        assert daycare and daycare["total"] == 100.0      # collected service revenue
        assert reversals and reversals["total"] == -100.0  # its reversal, once
        assert w["retail_total"] == 0.0
    finally:
        _cleanup()


# ── L — profit changes only by the true net refund amount ───────────────────
def test_l_profit_preservation():
    bid = _booking(100.0, payment_status="refunded",
                   financial_refund_total=25.0, financial_refund_status="partial")
    _refund_row(bid, 25.0)
    run(server.db.expenses.insert_one({"id": str(uuid.uuid4()), "date": D, "amount": 20.0,
                                       "category": "Supplies", "description": f"{TAG} expense",
                                       "created_at": f"{D}T12:00:00"}))
    try:
        p = run(pl_report.build_pl_data(server.db, D, D))
        # net income 75, minus 20 expense → profit 55; NOT 100−20 or −45.
        assert p["income"]["net_total"] == 75.0
        assert p["net_before_payroll"] == 55.0
    finally:
        _cleanup()
        run(server.db.expenses.delete_many({"description": {"$regex": TAG}}))
