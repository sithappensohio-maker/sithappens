"""Step 4C — Ohio Sales Tax Due & Filing Tracker tests (A–T).

Two layers, matching the module split:
  * sales_tax_tracker.py pure functions get fixed-date deterministic tests
    (period boundaries, due dates, statuses, priority, urgency, discount);
  * the server endpoints get integration tests on the shared disposable DB
    using DELTA-based liability assertions (absolute totals aren't stable
    there — see test_register_expected_cash._Baseline) plus the ASGI
    transport pattern from test_register_step2.py for permission gates.

Liability dollars are asserted against _sales_tax_window_summary — the
canonical 4B-1/4B-9 helper — never recomputed here. Rows tagged TEST_STT.
"""
import uuid
from datetime import date, timedelta

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import httpx
import pytest
import server
import sales_tax_tracker as stt
from _test_loop import run

TAG = "TEST_STT"
FAKE_ADMIN = {"id": "stt-admin", "name": "STT Owner", "email": "stt@test", "role": "admin"}

_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")


@pytest.fixture(autouse=True)
def _restore_tax_filing_state():
    """Snapshot/restore the filing-schedule settings doc and remove every
    filing + retail row this file creates, so ordering never leaks between
    tests or into other files' totals."""
    before = run(server.db.settings.find_one({"id": server.SALES_TAX_SETTINGS_ID}, {"_id": 0}))
    yield
    run(server.db.settings.delete_many({"id": server.SALES_TAX_SETTINGS_ID}))
    if before:
        run(server.db.settings.update_one(
            {"id": server.SALES_TAX_SETTINGS_ID}, {"$set": before}, upsert=True))
    run(server.db.sales_tax_filings.delete_many({"notes": TAG}))
    run(server.db.sales_tax_filings.delete_many({"audit_log.detail": {"$regex": TAG}}))
    run(server.db.retail_sales.delete_many({"description": {"$regex": TAG}}))
    run(server.db.users.delete_many({"email": {"$regex": TAG.lower()}}))


def _get(path, headers):
    return run(_http.get(f"/api{path}", headers=headers))


def _put(path, body, headers):
    return run(_http.put(f"/api{path}", json=body, headers=headers))


def _post(path, body, headers):
    return run(_http.post(f"/api{path}", json=body, headers=headers))


def _insert_staff(staff_role, role="employee"):
    uid = str(uuid.uuid4())
    email = f"{TAG.lower()}-{staff_role}-{uuid.uuid4().hex[:6]}@example.invalid"
    run(server.db.users.insert_one({
        "id": uid, "email": email, "name": f"{TAG} {staff_role}",
        "role": role, "staff_role": staff_role,
        "password_hash": "x", "active": True, "must_change_password": False, "needs_password": False,
    }))
    token = server.create_access_token(uid, email, role, 0)
    return uid, {"Authorization": f"Bearer {token}"}


def _owner_headers():
    return _insert_staff("owner", role="admin")[1]


def _month_start(months_back: int) -> date:
    d = server.business_today().replace(day=1)
    for _ in range(months_back):
        d = (d - timedelta(days=1)).replace(day=1)
    return d


def _configure_monthly(months_back=2, discount=False):
    run(server.put_sales_tax_filing_settings(server.SalesTaxSettingsIn(
        filing_frequency="monthly",
        tracking_start_date=_month_start(months_back).isoformat(),
        timely_discount_enabled=discount,
    ), FAKE_ADMIN))


def _tracker():
    return run(server._sales_tax_tracker_payload())


def _period_state(payload, key):
    return next(s for s in payload["periods"] if s["period_key"] == key)


def _insert_tax_row(day_iso: str, amount: float, tax: float, **extra):
    row = {"id": str(uuid.uuid4()), "date": day_iso, "description": f"{TAG} row",
           "amount": amount, "tax_amount": tax, "tax_rate_pct": 7.0,
           "created_at": server.now_iso()}
    row.update(extra)
    run(server.db.retail_sales.insert_one(row))
    return row["id"]


def _liability(sd: str, ed: str) -> float:
    return run(server._sales_tax_window_summary(sd, ed))["total_tax_collected"]


# ═══════════════ Pure period/deadline/status math ═══════════════

# ── A — monthly period boundaries + Sep 23 deadline, then next month ────────
def test_a_monthly_period_and_deadline():
    p = stt.period_for_date("monthly", date(2026, 8, 16))
    assert (p["period_start"], p["period_end"]) == ("2026-08-01", "2026-08-31")
    assert p["period_key"] == "2026-08" and p["label"] == "August 2026"
    assert stt.statutory_due_date(p["period_end"]) == "2026-09-23"
    n = stt.next_period("monthly", p)
    assert (n["period_start"], n["period_end"]) == ("2026-09-01", "2026-09-30")
    assert stt.statutory_due_date(n["period_end"]) == "2026-10-23"
    feb = stt.period_for_date("monthly", date(2028, 2, 10))  # leap year edge
    assert feb["period_end"] == "2028-02-29"


# ── B — semiannual Jan–Jun due Jul 23 ───────────────────────────────────────
def test_b_semiannual_first_half():
    p = stt.period_for_date("semiannual", date(2026, 3, 1))
    assert (p["period_start"], p["period_end"]) == ("2026-01-01", "2026-06-30")
    assert p["period_key"] == "2026-H1"
    assert stt.statutory_due_date(p["period_end"]) == "2026-07-23"


# ── C — semiannual Jul–Dec due Jan 23 of the NEXT year ──────────────────────
def test_c_semiannual_second_half_next_year_deadline():
    p = stt.period_for_date("semiannual", date(2026, 8, 16))
    assert (p["period_start"], p["period_end"]) == ("2026-07-01", "2026-12-31")
    assert stt.statutory_due_date(p["period_end"]) == "2027-01-23"
    # fixed halves, never rolling: iterating H1 lands exactly on H2
    assert stt.next_period("semiannual", stt.period_for_date("semiannual", date(2026, 1, 1)))["period_key"] == "2026-H2"


# ── E — current open period accumulates, never overdue ──────────────────────
def test_e_open_period_not_overdue():
    p = stt.period_for_date("monthly", date(2026, 8, 16))
    st = stt.derive_period_state(p, None, date(2026, 8, 16), "2026-08-01")
    assert st["status"] == "open" and st["is_open"]
    assert st["effective_due_date"] == "2026-09-23"
    assert "days_overdue" not in st


# ── F — completed unfiled period before its due date → ready_to_file ────────
def test_f_completed_unpaid_ready_to_file():
    p = stt.period_for_date("monthly", date(2026, 7, 10))
    st = stt.derive_period_state(p, None, date(2026, 8, 16), "2026-07-01")
    assert st["status"] == "ready_to_file"
    assert st["effective_due_date"] == "2026-08-23"
    assert st["days_until_due"] == 7
    assert stt.urgency_for(st, date(2026, 8, 16)) == "warning"


# ── G — past deadline without filing → overdue with day count ───────────────
def test_g_overdue_day_count():
    p = stt.period_for_date("monthly", date(2026, 7, 10))
    st = stt.derive_period_state(p, None, date(2026, 8, 29), "2026-07-01")
    assert st["status"] == "overdue"
    assert st["days_overdue"] == 6
    assert stt.urgency_for(st, date(2026, 8, 29)) == "overdue"


# ── H (pure) — $0 liability is NOT auto-complete; zero return resolves it ───
def test_h_zero_dollar_return_outstanding_until_recorded():
    p = stt.period_for_date("monthly", date(2026, 7, 10))
    st = stt.derive_period_state(p, None, date(2026, 8, 16), "2026-07-01",
                                 current_liability=0.0)
    assert st["status"] == "ready_to_file"  # still an obligation
    zero_filing = {"id": "f1", "is_zero_return": True, "filed_date": "2026-08-10",
                   "snapshot": {"liability": 0.0, "amount_to_remit": 0.0}, "payments": []}
    st2 = stt.derive_period_state(p, zero_filing, date(2026, 8, 16), "2026-07-01",
                                  current_liability=0.0)
    assert st2["status"] == "zero_return_filed"


# ── Q (pure) — pre-tracking periods are historical, never overdue ───────────
def test_q_pre_tracking_periods_untracked():
    p = stt.period_for_date("monthly", date(2026, 1, 10))
    st = stt.derive_period_state(p, None, date(2026, 8, 16), "2026-07-01")
    assert st["status"] == "historical_untracked"
    assert st["effective_due_date"] is None
    assert stt.urgency_for(st, date(2026, 8, 16)) == "normal"


# ── Priority — oldest unresolved beats current; else current open ───────────
def test_priority_oldest_unresolved_first():
    today = date(2026, 8, 16)
    jun = stt.derive_period_state(stt.period_for_date("monthly", date(2026, 6, 5)), None, today, "2026-06-01")
    jul = stt.derive_period_state(stt.period_for_date("monthly", date(2026, 7, 5)), None, today, "2026-06-01")
    aug = stt.derive_period_state(stt.period_for_date("monthly", date(2026, 8, 5)), None, today, "2026-06-01")
    assert stt.pick_primary_period([aug, jul, jun])["period_key"] == "2026-06"
    paid = {"id": "x", "filed_date": "2026-08-01", "is_zero_return": False,
            "snapshot": {"liability": 10.0, "amount_to_remit": 10.0},
            "payments": [{"amount": 10.0}]}
    jun_paid = stt.derive_period_state(stt.period_for_date("monthly", date(2026, 6, 5)), paid, today, "2026-06-01")
    jul_paid = stt.derive_period_state(stt.period_for_date("monthly", date(2026, 7, 5)), paid, today, "2026-06-01")
    assert stt.pick_primary_period([aug, jul_paid, jun_paid])["period_key"] == "2026-08"
    # partial payment keeps the period unresolved and primary
    partial = {**paid, "payments": [{"amount": 4.0}]}
    jul_part = stt.derive_period_state(stt.period_for_date("monthly", date(2026, 7, 5)), partial, today, "2026-06-01")
    assert stt.pick_primary_period([aug, jul_part, jun_paid])["period_key"] == "2026-07"


# ── Urgency ladder ──────────────────────────────────────────────────────────
def test_urgency_ladder():
    p = stt.period_for_date("monthly", date(2026, 7, 10))  # due 2026-08-23
    for today, expect in [(date(2026, 8, 8), "normal"),      # 15 days
                          (date(2026, 8, 9), "due_soon"),    # 14
                          (date(2026, 8, 16), "warning"),    # 7
                          (date(2026, 8, 20), "urgent"),     # 3
                          (date(2026, 8, 22), "urgent"),     # 1
                          (date(2026, 8, 24), "overdue")]:
        st = stt.derive_period_state(p, None, today, "2026-07-01")
        assert stt.urgency_for(st, today) == expect, (today, expect, st["status"])


# ── Timely discount + remit math (never mutates liability) ──────────────────
def test_discount_and_remit_math():
    assert stt.timely_discount_amount(500.0, True) == -3.75
    assert stt.timely_discount_amount(500.0, False) == 0.0
    assert stt.timely_discount_amount(-25.0, True) == 0.0  # credit period: none
    assert stt.amount_to_remit(500.0, [], -3.75) == 496.25
    assert stt.amount_to_remit(500.0, [{"amount": -20.0}, {"amount": 5.5}], 0.0) == 485.5
    # liability input is a plain float — remit math cannot change the ledger


# ── L/M (pure) — snapshot frozen; variance flags needs_review ───────────────
def test_lm_snapshot_immutable_variance_flagged():
    p = stt.period_for_date("monthly", date(2026, 7, 10))
    filing = {"id": "f2", "filed_date": "2026-08-10", "is_zero_return": False,
              "snapshot": {"liability": 300.0, "amount_to_remit": 300.0},
              "payments": [{"amount": 300.0}]}
    st = stt.derive_period_state(p, filing, date(2026, 8, 16), "2026-07-01",
                                 current_liability=300.0)
    assert st["status"] == "filed_paid" and not st["needs_review"]
    st2 = stt.derive_period_state(p, filing, date(2026, 8, 16), "2026-07-01",
                                  current_liability=290.0)
    assert st2["needs_review"]
    assert st2["variance"] == {
        "filed_liability": 300.0, "current_liability": 290.0, "difference": -10.0,
        "message": ("A transaction/refund dated in this previously filed period "
                    "changed after the filing was recorded.")}
    assert filing["snapshot"]["liability"] == 300.0  # untouched


# ── Due-date override: statutory preserved, adjusted distinct ───────────────
def test_due_date_override_distinct_from_statutory():
    p = stt.period_for_date("monthly", date(2026, 7, 10))
    st = stt.derive_period_state(p, None, date(2026, 8, 24), "2026-07-01",
                                 due_override={"date": "2026-08-25", "reason": "Ohio holiday extension"})
    assert st["statutory_due_date"] == "2026-08-23"
    assert st["adjusted_due_date"] == "2026-08-25"
    assert st["status"] == "ready_to_file"  # not overdue under the override


# ═══════════════ Endpoint / DB integration ═══════════════

# ── D — no schedule configured: liability shown, due date NOT asserted ──────
def test_d_setup_required_no_false_due_date():
    run(server.db.settings.delete_many({"id": server.SALES_TAX_SETTINGS_ID}))
    payload = _tracker()
    assert payload["setup_required"] and not payload["configured"]
    assert payload["primary"] is None and payload["periods"] == []
    prev = payload["unconfigured_preview"]
    assert "liability" in prev and "due" not in {k.lower() for k in prev if "due" in k.lower()}
    assert "needs setup" in prev["note"]


# ── Settings save/validation: assigned frequency is explicit, never guessed ─
def test_settings_saved_explicitly():
    run(server.db.settings.delete_many({"id": server.SALES_TAX_SETTINGS_ID}))
    with pytest.raises(server.HTTPException) as e:
        run(server.put_sales_tax_filing_settings(server.SalesTaxSettingsIn(
            filing_frequency="weekly", tracking_start_date="2026-07-01"), FAKE_ADMIN))
    assert e.value.status_code == 400
    with pytest.raises(server.HTTPException) as e:
        run(server.put_sales_tax_filing_settings(server.SalesTaxSettingsIn(
            filing_frequency="monthly"), FAKE_ADMIN))  # missing tracking start
    assert e.value.status_code == 400
    with pytest.raises(server.HTTPException) as e:
        run(server.put_sales_tax_filing_settings(server.SalesTaxSettingsIn(
            filing_frequency="custom", custom={"period_start": "2026-07-01"}), FAKE_ADMIN))
    assert e.value.status_code == 400
    _configure_monthly(months_back=1)
    got = run(server.get_sales_tax_filing_settings(FAKE_ADMIN))
    assert got["configured"] and got["settings"]["filing_frequency"] == "monthly"
    assert got["settings"]["jurisdiction"] == "OH"
    assert got["settings"]["timely_discount_enabled"] is False  # safe default OFF


# ── Custom / special assignment escape hatch ────────────────────────────────
def test_custom_schedule():
    ps, pe = _month_start(2).isoformat(), (_month_start(1) - timedelta(days=1)).isoformat()
    run(server.put_sales_tax_filing_settings(server.SalesTaxSettingsIn(
        filing_frequency="custom",
        custom={"period_start": ps, "period_end": pe,
                "due_date": (server.business_today() + timedelta(days=10)).isoformat(),
                "label": "Ohio special assignment", "note": "Commissioner-assigned interval"},
    ), FAKE_ADMIN))
    payload = _tracker()
    assert payload["configured"]
    assert len(payload["periods"]) == 1
    st = payload["periods"][0]
    assert st["status"] == "ready_to_file"
    assert st["adjusted_due_date"] == (server.business_today() + timedelta(days=10)).isoformat()
    assert payload["primary"]["period_key"] == st["period_key"]


# ── E/F endpoint — current accrues; completed outstanding takes priority ────
def test_ef_priority_completed_over_current():
    _configure_monthly(months_back=2)
    today = server.business_today()
    old = stt.period_for_date("monthly", _month_start(2))
    cur_key = stt.period_for_date("monthly", today)["period_key"]
    _insert_tax_row(old["period_start"], 100.0, 8.0)
    payload = _tracker()
    old_st = _period_state(payload, old["period_key"])
    assert old_st["status"] in ("ready_to_file", "overdue")  # two months back is always completed
    assert payload["primary"]["period_key"] == old["period_key"]  # oldest unresolved wins
    cur_st = _period_state(payload, cur_key)
    assert cur_st["status"] == "open"
    assert payload["current"]["period_key"] == cur_key


# ── G endpoint — period two months back is past its due date → overdue ──────
def test_g_endpoint_overdue_state():
    _configure_monthly(months_back=3)
    old = stt.period_for_date("monthly", _month_start(3))
    payload = _tracker()
    st = _period_state(payload, old["period_key"])
    assert st["status"] == "overdue" and st["days_overdue"] >= 1
    assert st["urgency"] == "overdue"
    assert payload["late_warning"] == "Late filing/payment may result in penalties or interest."


# ── H endpoint — record a $0 return ─────────────────────────────────────────
def test_h_endpoint_zero_return():
    _configure_monthly(months_back=2)
    old = stt.period_for_date("monthly", _month_start(2))
    run(server.record_sales_tax_filing(server.SalesTaxFilingIn(
        period_key=old["period_key"], filed_date=server.business_today().isoformat(),
        is_zero_return=True, filed_liability=0.0, confirmation_ref="ZERO-1",
        notes=TAG), FAKE_ADMIN))
    st = _period_state(_tracker(), old["period_key"])
    assert st["status"] == "zero_return_filed"
    assert st["snapshot"]["amount_to_remit"] == 0.0
    assert st["confirmation_ref"] == "ZERO-1"


# ── I — full payment resolves the filing ────────────────────────────────────
def test_i_full_payment():
    _configure_monthly(months_back=2)
    old = stt.period_for_date("monthly", _month_start(2))
    payload = run(server.record_sales_tax_filing(server.SalesTaxFilingIn(
        period_key=old["period_key"], filed_date=server.business_today().isoformat(),
        filed_liability=300.0, notes=TAG), FAKE_ADMIN))
    st = _period_state(payload, old["period_key"])
    assert st["status"] == "filed_payment_pending" and st["remaining_balance"] == 300.0
    payload = run(server.record_sales_tax_payment(
        st["filing_id"], server.SalesTaxPaymentIn(
            amount=300.0, payment_date=server.business_today().isoformat(),
            reference="OH-CONF-1"), FAKE_ADMIN))
    st = _period_state(payload, old["period_key"])
    assert st["status"] == "filed_paid"
    assert st["total_paid"] == 300.0 and st["remaining_balance"] == 0.0


# ── J/K — partial then second payment; history preserved ────────────────────
def test_jk_partial_and_multiple_payments():
    _configure_monthly(months_back=2)
    old = stt.period_for_date("monthly", _month_start(2))
    payload = run(server.record_sales_tax_filing(server.SalesTaxFilingIn(
        period_key=old["period_key"], filed_date=server.business_today().isoformat(),
        filed_liability=300.0, amount_paid=100.0, payment_reference="PART-1",
        notes=TAG), FAKE_ADMIN))
    st = _period_state(payload, old["period_key"])
    assert st["status"] == "filed_payment_pending"
    assert st["total_paid"] == 100.0 and st["remaining_balance"] == 200.0
    payload = run(server.record_sales_tax_payment(
        st["filing_id"], server.SalesTaxPaymentIn(
            amount=200.0, payment_date=server.business_today().isoformat(),
            reference="PART-2"), FAKE_ADMIN))
    st = _period_state(payload, old["period_key"])
    assert st["status"] == "filed_paid" and st["payment_count"] == 2
    filing = run(server.db.sales_tax_filings.find_one({"id": st["filing_id"]}, {"_id": 0}))
    refs = [p["reference"] for p in filing["payments"]]
    assert refs == ["PART-1", "PART-2"]  # first event never overwritten
    assert all(p.get("recorded_by") == FAKE_ADMIN["id"] for p in filing["payments"])
    assert any(a["action"] == "payment_recorded" for a in filing["audit_log"])


# ── L/M endpoint — snapshot frozen; backdated row → needs_review ────────────
def test_lm_endpoint_snapshot_and_variance():
    _configure_monthly(months_back=2)
    old = stt.period_for_date("monthly", _month_start(2))
    payload = run(server.record_sales_tax_filing(server.SalesTaxFilingIn(
        period_key=old["period_key"], filed_date=server.business_today().isoformat(),
        notes=TAG), FAKE_ADMIN))
    st = _period_state(payload, old["period_key"])
    snap_liab = st["snapshot"]["liability"]
    assert not st["needs_review"]
    # Backdated taxable sale lands inside the already-filed period:
    _insert_tax_row(old["period_start"], 100.0, 8.0)
    st2 = _period_state(_tracker(), old["period_key"])
    assert st2["needs_review"]
    assert st2["variance"]["difference"] == 8.0
    assert st2["snapshot"]["liability"] == snap_liab  # never rewritten
    assert st2["period_key"] in _tracker()["needs_review_periods"]


# ── N — canonical reversal behavior flows through unchanged ─────────────────
def test_n_tax_reversal_nets_to_zero():
    day = _month_start(2).isoformat()
    end = (_month_start(1) - timedelta(days=1)).isoformat()
    before = _liability(day, end)
    _insert_tax_row(day, 100.0, 10.0)
    _insert_tax_row(day, -100.0, -10.0, source_kind="pos_sale_void")
    assert _liability(day, end) == round(before, 2)  # +10 then −10: net zero


# ── O — Stripe partial with unknown tax NEVER fabricates a reversal ─────────
def test_o_stripe_partial_no_fabricated_tax():
    day = _month_start(2).isoformat()
    end = (_month_start(1) - timedelta(days=1)).isoformat()
    pay_id = f"{TAG}-pay-{uuid.uuid4().hex[:6]}"
    before = _liability(day, end)
    _insert_tax_row(day, 110.0, 10.0, payment_id=pay_id, source_kind="shop_order")
    # Partial keyless Stripe reversal (historical shape): 4B-9 must not guess
    run(server.db.retail_sales.insert_one({
        "id": str(uuid.uuid4()), "date": day, "description": f"{TAG} partial stripe refund",
        "amount": -40.0, "source_kind": "stripe_refund", "reversed_payment_id": pay_id,
        "created_at": server.now_iso()}))
    assert _liability(day, end) == round(before + 10.0, 2)  # +10 kept, nothing reversed


# ── P — 9:30 PM Eastern lands on that business day's period ─────────────────
def test_p_business_timezone_period_attribution():
    # 2026-08-15T01:30:00Z == Aug 14, 9:30 PM EDT → business date Aug 14
    biz = server._business_date_from_timestamp("2026-08-15T01:30:00+00:00")
    assert biz == "2026-08-14"
    p = stt.period_for_date("monthly", date.fromisoformat(biz))
    assert p["period_key"] == "2026-08"
    # Winter (EST): 2026-01-01T02:30:00Z == Dec 31 2025, 9:30 PM EST
    assert server._business_date_from_timestamp("2026-01-01T02:30:00+00:00") == "2025-12-31"


# ── R — filing history returns snapshots, payments and statuses ─────────────
def test_r_filing_history():
    _configure_monthly(months_back=2)
    old = stt.period_for_date("monthly", _month_start(2))
    prev = stt.period_for_date("monthly", _month_start(1))
    run(server.record_sales_tax_filing(server.SalesTaxFilingIn(
        period_key=old["period_key"], filed_date=server.business_today().isoformat(),
        filed_liability=284.17, adjustments=[{"label": "Vendor discount", "amount": -2.13}],
        amount_paid=282.04, confirmation_ref="ABC123", notes=TAG), FAKE_ADMIN))
    run(server.record_sales_tax_filing(server.SalesTaxFilingIn(
        period_key=prev["period_key"], filed_date=server.business_today().isoformat(),
        is_zero_return=True, filed_liability=0.0, notes=TAG), FAKE_ADMIN))
    payload = _tracker()
    st = _period_state(payload, old["period_key"])
    assert st["snapshot"]["liability"] == 284.17
    assert st["snapshot"]["adjustments"][0]["amount"] == -2.13
    assert st["snapshot"]["amount_to_remit"] == 282.04
    assert st["total_paid"] == 282.04 and st["status"] == "filed_paid"
    assert st["confirmation_ref"] == "ABC123"
    assert _period_state(payload, prev["period_key"])["status"] == "zero_return_filed"


# ── S — restricted Front Desk: no reads, no mutations ───────────────────────
def test_s_front_desk_locked_out():
    _configure_monthly(months_back=2)
    _, fd = _insert_staff("front_desk")
    assert _get("/admin/sales-tax/tracker", fd).status_code == 403
    assert _get("/admin/sales-tax/filing-settings", fd).status_code == 403
    assert _get("/admin/sales-tax/summary", fd).status_code == 403
    assert _put("/admin/sales-tax/filing-settings",
                {"filing_frequency": "monthly", "tracking_start_date": "2026-07-01"}, fd).status_code == 403
    assert _post("/admin/sales-tax/filings",
                 {"period_key": "2026-07", "filed_date": "2026-08-01"}, fd).status_code == 403
    assert _post("/admin/sales-tax/filings/nope/payments",
                 {"amount": 1.0, "payment_date": "2026-08-01"}, fd).status_code == 403
    owner = _owner_headers()
    assert _get("/admin/sales-tax/tracker", owner).status_code == 200


# ── T — duplicate filing + duplicate payment prevention ─────────────────────
def test_t_duplicate_prevention():
    _configure_monthly(months_back=2)
    old = stt.period_for_date("monthly", _month_start(2))
    payload = run(server.record_sales_tax_filing(server.SalesTaxFilingIn(
        period_key=old["period_key"], filed_date=server.business_today().isoformat(),
        filed_liability=300.0, notes=TAG), FAKE_ADMIN))
    with pytest.raises(server.HTTPException) as e:
        run(server.record_sales_tax_filing(server.SalesTaxFilingIn(
            period_key=old["period_key"], filed_date=server.business_today().isoformat(),
            filed_liability=300.0, notes=TAG), FAKE_ADMIN))
    assert e.value.status_code == 409
    fid = _period_state(payload, old["period_key"])["filing_id"]
    pay = server.SalesTaxPaymentIn(amount=100.0, payment_date=server.business_today().isoformat(),
                                   reference="DUP-REF")
    run(server.record_sales_tax_payment(fid, pay, FAKE_ADMIN))
    with pytest.raises(server.HTTPException) as e:
        run(server.record_sales_tax_payment(fid, pay, FAKE_ADMIN))
    assert e.value.status_code == 409  # identical double-submit rejected
    # explicit intent still allowed (two genuinely identical checks)
    payload = run(server.record_sales_tax_payment(
        fid, server.SalesTaxPaymentIn(amount=100.0, payment_date=pay.payment_date,
                                      reference="DUP-REF", allow_duplicate=True), FAKE_ADMIN))
    assert _period_state(payload, old["period_key"])["total_paid"] == 200.0


# ── Timely discount endpoint flow: visible, capped math, ledger untouched ───
def test_timely_discount_filing_flow():
    _configure_monthly(months_back=2, discount=True)
    old = stt.period_for_date("monthly", _month_start(2))
    day = old["period_start"]
    end = old["period_end"]
    ledger_before = _liability(day, end)
    payload = run(server.record_sales_tax_filing(server.SalesTaxFilingIn(
        period_key=old["period_key"], filed_date=server.business_today().isoformat(),
        filed_liability=500.0, notes=TAG), FAKE_ADMIN))
    st = _period_state(payload, old["period_key"])
    snap = st["snapshot"]
    if st["status"] == "filed_payment_pending" and snap["timely_discount"] != 0.0:
        # filed on/before due date → 0.75% discount, separately visible
        assert snap["timely_discount"] == -3.75
        assert snap["amount_to_remit"] == 496.25
    else:
        # months_back=2 period may already be past due when this runs late in
        # the month — then the discount correctly does NOT apply
        assert snap["timely_discount"] == 0.0
        assert snap["amount_to_remit"] == 500.0
    assert snap["liability"] == 500.0  # liability NEVER absorbs the discount
    assert _liability(day, end) == ledger_before  # ledger untouched by filing
