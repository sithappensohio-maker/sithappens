"""Step 4B-8 — Finance booking revenue by COLLECTION date tests.

Approved policy: Finance/P&L/quarterly attribute booking revenue to the
America/New_York business date the money was collected (matching the
register); the booking's service date is untouched and keeps driving
operational reporting. Implemented via _booking_collection_events, which
mirrors the register's three-source priority:

  ledger payment rows (event-level, supports partial-payment timing)
  → paid_at-stamped bookings (single full payments)
  → legacy service-date fallback (old rows with neither — documented, so
    historical revenue never disappears and is never guessed).

Isolated synthetic dates → absolute assertions. Tag TEST_COLDATE.
"""
import uuid
from datetime import datetime, time, timezone
from zoneinfo import ZoneInfo

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import pl_report
import server
from _test_loop import run

TAG = "TEST_COLDATE"
ADMIN = {"id": "coldate", "name": "ColDate QA", "email": "coldate@test", "role": "admin"}
NY = ZoneInfo("America/New_York")


def _booking(service_date, amount, paid_at=None, **extra):
    bid = f"{TAG}-bk-{uuid.uuid4().hex[:6]}"
    doc = {"id": bid, "date": service_date, "status": "completed", "payment_status": "paid",
           "actual_price": amount, "amount_paid": amount, "payment_method": "card",
           "client_id": f"{TAG}-client", "client_name": TAG, "dog_id": f"{TAG}-dog",
           "dog_name": TAG, "service_type": "daycare", "service_name": "Daycare",
           "created_at": f"{service_date}T08:00:00+00:00"}
    if paid_at:
        doc["paid_at"] = paid_at
    doc.update(extra)
    run(server.db.bookings.insert_one(doc))
    return bid


def _ledger_payment(bid, amount, created_at):
    run(server.db.payment_ledger.insert_one({
        "id": str(uuid.uuid4()), "client_id": f"{TAG}-client", "type": "payment",
        "amount": -abs(amount), "method": "card", "booking_id": bid,
        "notes": f"{TAG} payment", "created_at": created_at,
    }))


def _range_total(d1, d2=None):
    return float(run(server.summary_range(ADMIN, start_date=d1, end_date=d2 or d1))["completed_total"])


def _cleanup():
    run(server.db.bookings.delete_many({"id": {"$regex": TAG}}))
    run(server.db.payment_ledger.delete_many({"notes": {"$regex": TAG}}))
    run(server.db.retail_sales.delete_many({"description": {"$regex": TAG}}))


# ── A — same-day service and payment ────────────────────────────────────────
def test_a_same_day():
    _booking("2001-10-14", 100.0, paid_at="2001-10-14T18:00:00+00:00")
    try:
        assert _range_total("2001-10-14") == 100.0
    finally:
        _cleanup()


# ── B — service before payment: money lands on the payment day ──────────────
def test_b_service_before_payment():
    _booking("2001-10-10", 100.0, paid_at="2001-10-14T18:00:00+00:00")
    try:
        assert _range_total("2001-10-10") == 0.0
        assert _range_total("2001-10-14") == 100.0
    finally:
        _cleanup()


# ── C — prepaid service ─────────────────────────────────────────────────────
def test_c_prepaid():
    _booking("2001-10-20", 100.0, paid_at="2001-10-01T15:00:00+00:00")
    try:
        assert _range_total("2001-10-01") == 100.0
        assert _range_total("2001-10-20") == 0.0
    finally:
        _cleanup()


# ── D — multi-day boarding: single collection, never spread over nights ─────
def test_d_multiday_boarding_not_spread():
    _booking("2001-10-10", 300.0, paid_at="2001-10-14T18:00:00+00:00",
             end_date="2001-10-14", service_type="boarding", service_name="Boarding")
    try:
        for d in ("2001-10-10", "2001-10-11", "2001-10-12", "2001-10-13"):
            assert _range_total(d) == 0.0, d
        assert _range_total("2001-10-14") == 300.0
    finally:
        _cleanup()


# ── E — pay-later ───────────────────────────────────────────────────────────
def test_e_pay_later():
    _booking("2001-10-10", 100.0, paid_at="2001-10-15T12:00:00+00:00")
    try:
        assert _range_total("2001-10-15") == 100.0
        assert _range_total("2001-10-10") == 0.0
    finally:
        _cleanup()


# ── F — refund stays on the refund date (4B-4 semantics) ────────────────────
def test_f_refund_timing():
    bid = _booking("2001-10-10", 100.0, paid_at="2001-10-14T18:00:00+00:00",
                   financial_refund_total=25.0, financial_refund_status="partial")
    run(server.db.retail_sales.insert_one({
        "id": str(uuid.uuid4()), "date": "2001-10-20", "amount": -25.0,
        "payment_method": "card", "booking_id": bid, "source_kind": "refund",
        "category": "Refund", "description": f"{TAG} refund",
        "created_at": "2001-10-20T15:00:00+00:00"}))
    try:
        w14 = run(server.weekly_summary(ADMIN, ref_date="2001-10-14"))
        assert w14["gross_total"] == 100.0 and w14["net_total"] == 100.0
        w20 = run(server.weekly_summary(ADMIN, ref_date="2001-10-20"))
        assert w20["gross_total"] == 0.0
        assert w20["refunds_reversals_total"] == 25.0
        assert w20["net_total"] == -25.0
    finally:
        _cleanup()


# ── G — partial payments land on their own ledger-event dates ───────────────
def test_g_partial_payments_by_event():
    bid = _booking("2001-10-05", 100.0, paid_at="2001-10-14T18:00:00+00:00",
                   payment_status="paid_partial")
    _ledger_payment(bid, 40.0, "2001-10-01T16:00:00+00:00")
    _ledger_payment(bid, 60.0, "2001-10-14T18:00:00+00:00")
    try:
        # Ledger events are authoritative; the paid_at stamp is ignored for a
        # booking with ledger history, so nothing double-counts.
        assert _range_total("2001-10-01") == 40.0
        assert _range_total("2001-10-14") == 60.0
        assert _range_total("2001-10-05") == 0.0     # service date: nothing collected
        assert _range_total("2001-10-01", "2001-10-14") == 100.0
    finally:
        _cleanup()


# ── H — 9:30 p.m. Eastern payment stays on its business date ────────────────
def test_h_timezone_rollover():
    # Aug 14 2026 9:30 p.m. EDT = Aug 15 01:30Z.
    paid_utc = datetime.combine(datetime(2026, 8, 14).date(), time(21, 30), tzinfo=NY).astimezone(timezone.utc)
    assert paid_utc.isoformat().startswith("2026-08-15T01:30")
    _booking("2026-08-10", 100.0, paid_at=paid_utc.isoformat())
    try:
        assert _range_total("2026-08-14") == 100.0
        assert _range_total("2026-08-15") == 0.0
    finally:
        _cleanup()


# ── I — Today P&L includes today-collected money for an old booking ─────────
def test_i_today_pnl_collection():
    today = server.business_today().isoformat()
    base = float(run(server.today_pnl(ADMIN))["revenue"])
    bid = _booking("2001-01-05", 100.0)  # ancient service date
    _ledger_payment(bid, 100.0, server.now_iso())  # collected TODAY
    try:
        pnl = run(server.today_pnl(ADMIN))
        assert round(float(pnl["revenue"]) - base, 2) == 100.0
        assert round(float(pnl["service_revenue"]), 2) >= 100.0
    finally:
        _cleanup()


# ── J + K — range, P&L, and register agree for the same collection window ───
def test_jk_range_pl_register_reconcile():
    _booking("2001-10-10", 300.0, paid_at="2001-10-14T18:00:00+00:00",
             end_date="2001-10-14", service_type="boarding", service_name="Boarding")
    try:
        s = run(server.summary_range(ADMIN, start_date="2001-10-14", end_date="2001-10-14"))
        p = run(pl_report.build_pl_data(server.db, "2001-10-14", "2001-10-14"))
        reg = run(server._register_day_summary("2001-10-14"))
        assert s["completed_total"] == 300.0
        assert p["income"]["net_total"] == 300.0
        assert float(reg["incoming_sources"]["booking_payments"]) == 300.0
        assert s["by_day"] == [{"date": "2001-10-14", "total": 300.0}]
        # And the by-service line carries the amount under Boarding.
        svc = next(x for x in p["income"]["by_service"] if x["name"] == "Boarding")
        assert svc["total"] == 300.0
    finally:
        _cleanup()


# ── L — operational service-date reporting unchanged ────────────────────────
def test_l_operational_service_date_regression():
    bid = _booking("2001-10-10", 300.0, paid_at="2001-10-14T18:00:00+00:00",
                   end_date="2001-10-14", service_type="boarding")
    try:
        rows = run(server.list_transactions(ADMIN, start_date="2001-10-10", end_date="2001-10-10"))
        assert any(r["id"] == bid for r in rows)  # operational view: service date
        b = run(server.db.bookings.find_one({"id": bid}, {"_id": 0, "date": 1, "end_date": 1}))
        assert b == {"date": "2001-10-10", "end_date": "2001-10-14"}  # nothing rewritten
    finally:
        _cleanup()


# ── M — 4B-6 guard intact under collection dating ───────────────────────────
def test_m_refund_status_guard_regression():
    bid = _booking("2001-10-10", 100.0, paid_at="2001-10-14T18:00:00+00:00",
                   payment_status="refunded",
                   financial_refund_total=100.0, financial_refund_status="full")
    run(server.db.retail_sales.insert_one({
        "id": str(uuid.uuid4()), "date": "2001-10-14", "amount": -100.0,
        "payment_method": "card", "booking_id": bid, "source_kind": "refund",
        "category": "Refund", "description": f"{TAG} refund",
        "created_at": "2001-10-14T19:00:00+00:00"}))
    try:
        assert _range_total("2001-10-14") == 0.0  # +100 collected − 100 refund, once
    finally:
        _cleanup()


# ── N — 4B-4 trio intact ────────────────────────────────────────────────────
def test_n_gross_net_regression():
    _booking("2001-10-10", 100.0, paid_at="2001-10-14T18:00:00+00:00")
    run(server.db.retail_sales.insert_one({
        "id": str(uuid.uuid4()), "date": "2001-10-14", "amount": -25.0,
        "payment_method": "cash", "source_kind": "refund", "category": "Refund",
        "description": f"{TAG} refund", "created_at": "2001-10-14T19:00:00+00:00"}))
    try:
        w = run(server.weekly_summary(ADMIN, ref_date="2001-10-14"))
        assert (w["gross_total"], w["refunds_reversals_total"], w["net_total"]) == (100.0, 25.0, 75.0)
    finally:
        _cleanup()


# ── O — 4B-5 category intact: booking money stays in its service bucket ─────
def test_o_category_regression():
    _booking("2001-10-10", 100.0, paid_at="2001-10-14T18:00:00+00:00")
    try:
        w = run(server.weekly_summary(ADMIN, ref_date="2001-10-14"))
        daycare = next(b for b in w["by_service"] if b["name"] == "Daycare")
        assert daycare["total"] == 100.0
        assert w["retail_total"] == 0.0 and w["account_payments_total"] == 0.0
    finally:
        _cleanup()


# ── P — legacy fallback: no timestamps → service date, never lost ───────────
def test_p_legacy_fallback():
    _booking("2001-10-10", 100.0)  # no paid_at, no ledger rows
    try:
        # Documented fallback: the only date the record has is its service
        # date — the revenue stays visible there instead of disappearing or
        # being guessed onto today.
        assert _range_total("2001-10-10") == 100.0
        assert _range_total("2001-10-14") == 0.0
    finally:
        _cleanup()
