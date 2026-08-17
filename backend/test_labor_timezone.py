"""Step 4B-7 — labor business-timezone attribution tests.

Locks in the invariant:

    Labor belongs to the America/New_York business day during which the
    work occurred — never the UTC calendar date of its stored timestamp.

Storage stays UTC; only the report windows changed, via
_business_range_utc_bounds / _business_day_utc_bounds (the same canonical
bounds revenue has always used). Cost formulas untouched: the same shift
costs exactly the same, it just lands on the right day. Shifts are
attributed whole by their clock-in business day (pre-existing rule,
preserved). Tag TEST_LABTZ; synthetic dates for absolute assertions,
today-based deltas where the live clock is involved.
"""
import uuid
from datetime import datetime, time, timezone
from zoneinfo import ZoneInfo

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import pl_report
import server
from _test_loop import run

TAG = "TEST_LABTZ"
ADMIN = {"id": "labtz", "name": "LabTZ QA", "email": "labtz@test", "role": "admin"}
NY = ZoneInfo("America/New_York")
RATE = 50.0


def _employee():
    uid = f"{TAG}-emp-{uuid.uuid4().hex[:6]}"
    run(server.db.users.insert_one({"id": uid, "name": f"{TAG} emp", "email": f"{uid}@t",
                                    "role": "employee", "hourly_rate": RATE, "active": True}))
    return uid


def _shift(uid, local_date, start_hm, hours):
    """Insert a completed shift clocked in at local_date start_hm Eastern,
    stored (correctly) as UTC."""
    from datetime import timedelta
    h, m = start_hm
    start_local = datetime.combine(datetime.fromisoformat(local_date).date(), time(h, m), tzinfo=NY)
    start_utc = start_local.astimezone(timezone.utc)
    end_utc = start_utc + timedelta(hours=hours)
    rid = str(uuid.uuid4())
    run(server.db.time_clock_entries.insert_one({
        "id": rid, "user_id": uid,
        "clock_in_at": start_utc.isoformat(), "clock_out_at": end_utc.isoformat(),
        "hours": float(hours), "break_minutes": 0,
    }))
    return rid, start_utc.isoformat()


def _labor_gross(d1, d2=None):
    s = run(server.summary_range(ADMIN, start_date=d1, end_date=d2 or d1))
    return float(s["labor_gross"])


def _cleanup(uid=None, entry_ids=()):
    if uid:
        run(server.db.users.delete_many({"id": uid}))
    if entry_ids:
        run(server.db.time_clock_entries.delete_many({"id": {"$in": list(entry_ids)}}))
    run(server.db.retail_sales.delete_many({"description": {"$regex": TAG}}))


# ── A — ordinary daytime shift stays on its day ─────────────────────────────
def test_a_daytime_shift():
    uid = _employee()
    rid, _ = _shift(uid, "2001-08-16", (10, 0), 4)   # 10a–2p EDT
    try:
        assert _labor_gross("2001-08-16") == 200.0
        assert _labor_gross("2001-08-17") == 0.0
    finally:
        _cleanup(uid, [rid])


# ── B + D — evening EDT shift: UTC rolls, business day doesn't ──────────────
def test_bd_evening_edt_rollover():
    uid = _employee()
    rid, stored = _shift(uid, "2001-08-16", (21, 0), 2)  # 9–11p EDT → 01:00Z NEXT UTC day
    try:
        assert stored.startswith("2001-08-17T01:00")  # stored UTC really rolled over
        assert _labor_gross("2001-08-16") == 100.0     # …but labor stays on the 16th
        assert _labor_gross("2001-08-17") == 0.0
    finally:
        _cleanup(uid, [rid])


# ── C — EST equivalent (winter, UTC-5) ──────────────────────────────────────
def test_c_evening_est_rollover():
    uid = _employee()
    rid, stored = _shift(uid, "2001-01-16", (21, 0), 2)  # 9–11p EST → 02:00Z next UTC day
    try:
        assert stored.startswith("2001-01-17T02:00")
        assert _labor_gross("2001-01-16") == 100.0
        assert _labor_gross("2001-01-17") == 0.0
    finally:
        _cleanup(uid, [rid])


# ── E — spring-forward day is 23 UTC hours, boundaries still exact ──────────
def test_e_spring_forward_day():
    # US DST 2026 begins Sun 2026-03-08 (2 a.m. ET). 04:00 UTC gap day.
    s, e = server._business_range_utc_bounds("2026-03-08", "2026-03-08")
    assert s.startswith("2026-03-08T05:00")   # midnight EST (UTC-5)
    assert e.startswith("2026-03-09T04:00")   # next midnight EDT (UTC-4) — 23h day
    uid = _employee()
    rid, _ = _shift(uid, "2026-03-08", (22, 0), 2)  # 10p EDT = 02:00Z Mar 9
    try:
        assert _labor_gross("2026-03-08") == 100.0
        assert _labor_gross("2026-03-09") == 0.0
    finally:
        _cleanup(uid, [rid])


# ── F — fall-back day is 25 UTC hours ───────────────────────────────────────
def test_f_fall_back_day():
    # US DST 2026 ends Sun 2026-11-01.
    s, e = server._business_range_utc_bounds("2026-11-01", "2026-11-01")
    assert s.startswith("2026-11-01T04:00")   # midnight EDT (UTC-4)
    assert e.startswith("2026-11-02T05:00")   # next midnight EST (UTC-5) — 25h day
    uid = _employee()
    rid, _ = _shift(uid, "2026-11-01", (23, 30), 1)  # 11:30p EST = 04:30Z Nov 2
    try:
        assert _labor_gross("2026-11-01") == 50.0
        assert _labor_gross("2026-11-02") == 0.0
    finally:
        _cleanup(uid, [rid])


# ── G — range conservation: no duplicated or lost labor ─────────────────────
def test_g_range_conservation():
    uid = _employee()
    rid, _ = _shift(uid, "2001-08-16", (21, 0), 2)
    try:
        one = _labor_gross("2001-08-16")
        both = _labor_gross("2001-08-16", "2001-08-17")
        assert one == both == 100.0
    finally:
        _cleanup(uid, [rid])


# ── H — Today P&L includes this evening's business-today shift ──────────────
def test_h_today_pnl_business_today():
    uid = _employee()
    today = server.business_today().isoformat()
    rid, stored = _shift(uid, today, (21, 30), 2)  # 9:30p ET business-today
    try:
        pnl = run(server.today_pnl(ADMIN))
        emp = next((e for e in pnl["per_employee"] if e["user_id"] == uid), None)
        assert emp is not None and emp["cost"] == 100.0
        # And the stored UTC timestamp genuinely belongs to today's NY bounds.
        s, e = server._business_day_utc_bounds(today)
        assert s <= stored < e
    finally:
        _cleanup(uid, [rid])


# ── I + J — summary_range and P&L builder agree exactly ─────────────────────
def test_ij_range_and_pl_agree():
    uid = _employee()
    rid, _ = _shift(uid, "2001-08-16", (21, 0), 2)
    try:
        s = run(server.summary_range(ADMIN, start_date="2001-08-16", end_date="2001-08-16"))
        p = run(pl_report.build_pl_data(server.db, "2001-08-16", "2001-08-16"))
        assert float(s["labor_gross"]) == float(p["payroll"]["gross"]) == 100.0
        assert float(s["labor_total"]) == float(p["payroll"]["total_cost"])
        # The next day carries none of it in either surface.
        p2 = run(pl_report.build_pl_data(server.db, "2001-08-17", "2001-08-17"))
        assert float(p2["payroll"]["gross"]) == 0.0
    finally:
        _cleanup(uid, [rid])


# ── K — the PDF renders straight from the corrected builder value ───────────
def test_k_pdf_uses_builder_labor():
    uid = _employee()
    rid, _ = _shift(uid, "2001-08-16", (21, 0), 2)
    try:
        data = run(pl_report.build_pl_data(server.db, "2001-08-16", "2001-08-16"))
        assert float(data["payroll"]["gross"]) == 100.0
        pdf = pl_report.render_pl_pdf(data, "Sit Happens Test")
        assert pdf[:4] == b"%PDF"  # renders the builder's data, no own math
    finally:
        _cleanup(uid, [rid])


# ── L + M — profit relocation on each day, conservation over the range ──────
def test_lm_profit_relocation_and_conservation():
    uid = _employee()
    rid, _ = _shift(uid, "2001-08-16", (21, 0), 2)   # $100 gross labor
    run(server.db.retail_sales.insert_one({
        "id": str(uuid.uuid4()), "date": "2001-08-16", "amount": 500.0,
        "payment_method": "cash", "description": f"{TAG} revenue",
        "created_at": "2001-08-17T00:30:00+00:00",  # 8:30p ET Aug 16
    }))
    try:
        d1 = run(server.summary_range(ADMIN, start_date="2001-08-16", end_date="2001-08-16"))
        d2 = run(server.summary_range(ADMIN, start_date="2001-08-17", end_date="2001-08-17"))
        both = run(server.summary_range(ADMIN, start_date="2001-08-16", end_date="2001-08-17"))
        # L — the day the work happened carries the labor and the true profit.
        assert d1["completed_total"] == 500.0 and float(d1["labor_gross"]) == 100.0
        assert d1["net_total"] == round(500.0 - float(d1["labor_total"]), 2)
        assert float(d2["labor_gross"]) == 0.0 and d2["completed_total"] == 0.0
        # M — the two-day window conserves everything exactly.
        assert both["completed_total"] == 500.0
        assert float(both["labor_gross"]) == 100.0
        assert both["net_total"] == d1["net_total"]
    finally:
        _cleanup(uid, [rid])
