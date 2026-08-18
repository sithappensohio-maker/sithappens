"""Step 4D-3 — Tax Center aggregator tests.

ONE dashboard over FOUR separate obligations. Every dollar the aggregator
shows must be byte-identical to the authoritative detail payload it came
from (federal / Ohio+SD / sales-tax tracker) — these tests assert that
equality directly instead of re-deriving any tax math. Cross-contamination
tests prove each ledger/payment moves ONLY its own obligation. The legacy
planning reserve and legacy jurisdiction-unassigned payments must be
absent from every authoritative list. Rows tagged TEST_TC.
"""
import json
import uuid
from datetime import date, timedelta

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import httpx
import pytest
import server
from _test_loop import run

TAG = "TEST_TC"
ADMIN = {"id": "tc-admin", "name": "TC Owner", "email": "tc@test", "role": "admin"}
YEAR = 2026
AS_OF = date(2026, 8, 18)

_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")


@pytest.fixture(autouse=True)
def _clean_state():
    before = run(server.db.settings.find_one({"id": server.SALES_TAX_SETTINGS_ID}, {"_id": 0}))
    yield
    run(server.db.settings.delete_many({"id": server.SALES_TAX_SETTINGS_ID}))
    if before:
        run(server.db.settings.update_one(
            {"id": server.SALES_TAX_SETTINGS_ID}, {"$set": before}, upsert=True))
    run(server.db.tax_profiles.delete_many({"tax_year": {"$in": [YEAR, 2001]}}))
    run(server.db.estimated_tax_payments.delete_many({"memo": TAG}))
    run(server.db.sales_tax_filings.delete_many({"notes": TAG}))
    run(server.db.sales_tax_filings.delete_many({"audit_log.detail": {"$regex": TAG}}))
    run(server.db.retail_sales.delete_many({"description": {"$regex": TAG}}))
    run(server.db.tax_payments.delete_many({"memo": TAG}))
    run(server.db.users.delete_many({"email": {"$regex": TAG.lower()}}))


# ── profile helpers (same deterministic pinning as the engine suites) ───────

def _fed_section(**over):
    base = dict(
        filing_status="single", prior_year_agi=78000.0, prior_year_total_tax=9200.0,
        prior_year_full_12_months=True, prior_year_overpayment_applied=0.0,
        withholding_ytd=0.0, withholding_expected_remaining=0.0,
        w2_wages=0.0, w2_ss_wages=0.0, spouse_wages=0.0,
        other_taxable_income=80000.0, other_se_income=0.0,
        credits_estimate=0.0, refundable_credits_estimate=0.0,
        se_health_insurance=0.0, retirement_hsa_adjustments=0.0,
        other_adjustments=0.0, other_expected_federal_taxes=0.0,
        deduction_method="standard", itemized_deduction_amount=None,
        nonitemizer_charitable_contributions=0.0, schedule_1a_deductions=0.0,
        expects_qualified_investment_income=False, unusual_tax_situation=False,
    )
    base.update(over)
    return base


def _ohio_section(**over):
    base = dict(resident=True, prior_year_full_12_months=True, prior_year_tax=1200.0,
                prior_year_overpayment_applied=0.0, withholding_ytd=0.0,
                withholding_expected_remaining=0.0, other_expected_ohio_adjustments=0.0,
                other_expected_ohio_credits=0.0, exemption_count=1.0,
                unusual_ohio_situation=False)
    base.update(over)
    return base


def _sd_no(**over):
    base = dict(applicable="no", district_name=None, district_number=None,
                tax_base_type=None, rate_pct=None, withholding_ytd=None,
                withholding_expected_remaining=None, prior_year_tax=None,
                prior_year_overpayment_applied=None)
    base.update(over)
    return base


def _sd_earned(**over):
    base = dict(applicable="yes", district_name="TC Earned District", district_number=None,
                tax_base_type="earned_income", rate_pct=1.5, withholding_ytd=0.0,
                withholding_expected_remaining=0.0, prior_year_tax=300.0,
                prior_year_overpayment_applied=0.0)
    base.update(over)
    return base


def _setup_profile(fed_over=None, ohio_over=None, sd=None, profit=50000.0):
    probe = run(server._ohio_estimated_tax_payload(YEAR, as_of=AS_OF))
    ytd = probe["business_projection"]["actual_ytd_business_profit"]
    run(server.put_tax_profile(YEAR, server.TaxProfilePatchIn(
        federal=_fed_section(**(fed_over or {})),
        ohio=_ohio_section(**(ohio_over or {})),
        school_district=sd or _sd_no(),
        projection={"remaining_business_profit": round(profit - ytd, 2)}), ADMIN))


def _month_start(months_back: int) -> date:
    d = server.business_today().replace(day=1)
    for _ in range(months_back):
        d = (d - timedelta(days=1)).replace(day=1)
    return d


def _configure_sales(months_back: int):
    run(server.put_sales_tax_filing_settings(server.SalesTaxSettingsIn(
        filing_frequency="monthly",
        tracking_start_date=_month_start(months_back).isoformat(),
        timely_discount_enabled=False), ADMIN))


def _sales_off():
    run(server.db.settings.delete_many({"id": server.SALES_TAX_SETTINGS_ID}))


def _insert_taxable_sale(day: date, amount=100.0, tax=7.0):
    run(server.db.retail_sales.insert_one({
        "id": str(uuid.uuid4()), "date": day.isoformat(), "description": f"{TAG} merch",
        "amount": amount, "tax_amount": tax, "tax_rate_pct": 7.0,
        "created_at": server.now_iso()}))


def _pay(amount, pay_date, jurisdiction="federal", period=3):
    return run(server.record_estimated_tax_payment(server.EstimatedTaxPaymentIn(
        tax_year=YEAR, jurisdiction=jurisdiction, period=period, amount=amount,
        payment_date=pay_date, memo=TAG), ADMIN))


def _tc(as_of=AS_OF, year=YEAR):
    return run(server._tax_center_payload(year, as_of=as_of))


def _entry(payload, key):
    return next(e for e in payload["obligations"] if e["key"] == key)


def _entry_prefix(payload, prefix):
    return [e for e in payload["obligations"] if e["key"].startswith(prefix)]


# ═══════════════ REQUIRED FULL-STACK CONTROL SCENARIO ═══════════════

def test_control_scenario_full_stack():
    """All four systems live at once; aggregator numbers must equal the
    authoritative endpoints exactly; contamination must be zero."""
    _configure_sales(months_back=1)                     # prev month ready_to_file
    prev = _month_start(1)
    _insert_taxable_sale(prev + timedelta(days=3))      # unresolved sales filing
    _setup_profile(sd=_sd_earned())                     # fed required; state small; SD positive
    _pay(200.0, "2026-08-01", jurisdiction="ohio")      # one recorded Ohio payment
    _pay(500.0, "2026-12-15", jurisdiction="federal", period=4)   # FUTURE federal

    tc = _tc()
    fed = run(server._federal_estimated_tax_payload(YEAR, as_of=AS_OF))
    oh = run(server._ohio_estimated_tax_payload(YEAR, as_of=AS_OF))
    tracker = run(server._sales_tax_tracker_payload())

    # 1 — every obligation appears separately (no merging, no grand total)
    keys = {e["key"] for e in tc["obligations"]}
    assert {"federal", "ohio", "school_district"} <= keys
    sales_entries = _entry_prefix(tc, "sales_tax:")
    assert len(sales_entries) >= 2                      # prev (actionable) + open month
    assert "grand_total" not in json.dumps(tc)

    # 2 — next action = earliest dated actionable = the sales filing (23rd)
    prev_key = f"sales_tax:{prev.isoformat()[:7]}"
    assert tc["next_action"]["none"] is False
    assert tc["next_action"]["key"] == prev_key
    assert tc["next_action"]["status"] == "FILING_REQUIRED"

    # 3 — federal equals the federal endpoint exactly
    fe = _entry(tc, "federal")
    fi = fed["estimate"]["installments"]
    assert fe["status"] == "PAYMENT_NEEDED"
    assert fe["remaining_amount"] == fi["remaining_next_payment"]
    assert fe["required_amount"] == fi["required_through_next"]
    assert fe["credited_amount"] == fi["credited_total"]
    assert fe["due_date"] == fi["next_deadline"]["due"]
    assert fe["informational"]["projected_annual_tax"] == fed["estimate"]["projected_total_tax"]

    # 4 — Ohio + SD equal the Ohio endpoint exactly (allocation shares)
    oe = _entry(tc, "ohio")
    se = _entry(tc, "school_district")
    hint = oh["estimate"]["installments"]["allocation_hint"]
    assert oe["remaining_amount"] == hint["ohio_state_share"]
    assert se["remaining_amount"] == hint["school_district_share"]
    assert oe["required_amount"] == oh["estimate"]["installments"]["required_through_next"]
    # 4D-2C-1 distinction survives integration:
    assert oe["informational"]["projected_return_liability"] == oh["estimate"]["combined_liability"]
    assert oe["informational"]["estimated_tax_base"] == oh["estimate"]["estimated_tax_base"]["combined"]
    assert se["informational"]["projected_liability"] == oh["estimate"]["school_district"]["tax"]

    # 5 — sales equals the tracker exactly
    sp = next(s for s in tracker["periods"] if s["period_key"] == prev.isoformat()[:7])
    sales_e = next(e for e in sales_entries if e["key"] == prev_key)
    assert sales_e["status"] == "FILING_REQUIRED"
    assert sales_e["remaining_amount"] == sp["projected_amount_to_remit"]
    assert sales_e["due_date"] == sp["effective_due_date"]

    # 6 — the future-dated federal payment did NOT reduce today's amount
    assert fe["future_dated_total"] == 500.0
    assert fi["federal_payments_recorded"] == 0.0        # nothing credited yet

    # 7 — the Ohio payment credited Ohio only (federal untouched by design)
    assert oh["estimate"]["installments"]["ohio_payments_recorded"] == 200.0
    assert fi["federal_payments_recorded"] == 0.0

    # 9 — legacy planning reserve absent from every authoritative surface
    surface = json.dumps({"attention": tc["attention"], "next": tc["next_action"],
                          "upcoming": tc["upcoming_dates"]}).lower()
    assert "reserve" not in surface

    # 8 — record the sales filing + payment → income engines unchanged
    run(server.record_sales_tax_filing(server.SalesTaxFilingIn(
        period_key=prev.isoformat()[:7], filed_date=server.business_today().isoformat(),
        notes=TAG), ADMIN))
    frow = run(server.db.sales_tax_filings.find_one(
        {"period_key": prev.isoformat()[:7]}, {"_id": 0, "id": 1}))
    run(server.record_sales_tax_payment(frow["id"], server.SalesTaxPaymentIn(
        amount=7.0, payment_date=server.business_today().isoformat(), note=TAG), ADMIN))
    fed2 = run(server._federal_estimated_tax_payload(YEAR, as_of=AS_OF))
    oh2 = run(server._ohio_estimated_tax_payload(YEAR, as_of=AS_OF))
    assert fed2["estimate"]["installments"]["remaining_next_payment"] == fi["remaining_next_payment"]
    assert (oh2["estimate"]["installments"]["remaining_next_payment"]
            == oh["estimate"]["installments"]["remaining_next_payment"])
    tc2 = _tc()
    assert _entry(tc2, "federal")["remaining_amount"] == fe["remaining_amount"]


# ═══════════════ single-actionable / ordering scenarios ═══════════════

def test_no_action_state():
    _configure_sales(months_back=0)                     # only the open month
    _setup_profile(fed_over={"withholding_expected_remaining": 60000.0},
                   ohio_over={"withholding_ytd": 1300.0})
    tc = _tc()
    assert tc["next_action"]["none"] is True
    assert tc["attention"] == []
    assert _entry(tc, "federal")["status"] == "NO_PAYMENT_REQUIRED"
    assert _entry(tc, "ohio")["status"] == "NO_PAYMENT_REQUIRED"


def test_only_federal_actionable():
    _configure_sales(months_back=0)
    _setup_profile(ohio_over={"withholding_ytd": 1300.0})
    tc = _tc()
    assert tc["next_action"]["key"] == "federal"
    assert tc["next_action"]["status"] == "PAYMENT_NEEDED"
    assert tc["next_action"]["due_date"] == "2026-09-15"
    assert tc["next_action"]["amount"] > 0
    assert [e["key"] for e in tc["attention"]] == ["federal"]


def test_only_ohio_actionable_and_only_sd():
    # Withholding covers federal; Ohio+SD still owed → both actionable.
    _configure_sales(months_back=0)
    _setup_profile(fed_over={"withholding_expected_remaining": 60000.0}, sd=_sd_earned())
    tc = _tc()
    keys = [e["key"] for e in tc["attention"]]
    assert "federal" not in keys
    assert "ohio" in keys and "school_district" in keys
    # Case-D shape (profit only, no other income): state $0 → SD carries it all.
    _setup_profile(fed_over={"withholding_expected_remaining": 60000.0,
                             "other_taxable_income": 0.0}, sd=_sd_earned())
    tc2 = _tc()
    oe, se = _entry(tc2, "ohio"), _entry(tc2, "school_district")
    assert oe["status"] == "ON_TRACK" and oe["remaining_amount"] == 0.0
    assert se["status"] == "PAYMENT_NEEDED" and se["remaining_amount"] > 0
    assert [e["key"] for e in tc2["attention"]] == ["school_district"]
    assert tc2["next_action"]["key"] == "school_district"


def test_only_sales_actionable_and_zero_filing_required():
    _configure_sales(months_back=1)                     # prev month unfiled, NO taxable rows
    _setup_profile(fed_over={"withholding_expected_remaining": 60000.0},
                   ohio_over={"withholding_ytd": 1300.0})
    tc = _tc()
    prev_key = f"sales_tax:{_month_start(1).isoformat()[:7]}"
    assert [e["key"] for e in tc["attention"]] == [prev_key]
    e = tc["attention"][0]
    # $0 liability still requires the return — never auto-complete.
    assert e["status"] == "FILING_REQUIRED"
    assert e["remaining_amount"] == 0.0
    assert tc["next_action"]["key"] == prev_key
    assert "even when the liability is $0" in tc["next_action"]["sub"]


def test_same_date_obligations_stay_separate():
    _configure_sales(months_back=0)
    _setup_profile(sd=_sd_earned())
    tc = _tc()
    dated = [e for e in tc["attention"] if e.get("due_date") == "2026-09-15"]
    assert {e["key"] for e in dated} == {"federal", "ohio", "school_district"}
    # separate destinations → separate record actions, never merged
    locks = {e["key"]: (e.get("action") or {}).get("lock_jurisdiction") for e in dated}
    assert locks == {"federal": "federal", "ohio": "ohio",
                     "school_district": "ohio_school_district"}


def test_overdue_sales_outranks_future_federal():
    _configure_sales(months_back=2)                     # oldest month now OVERDUE
    _setup_profile()
    old_key = f"sales_tax:{_month_start(2).isoformat()[:7]}"
    tc = _tc()
    assert tc["attention"][0]["key"] == old_key         # never buried
    assert tc["attention"][0]["status"] == "OVERDUE"
    assert tc["next_action"]["key"] == old_key
    assert "penalt" in tc["next_action"]["sub"].lower()  # may-apply wording, no estimate


def test_profile_incomplete_next_action():
    _sales_off()
    _configure_sales(months_back=0)
    tc = _tc()                                          # no profile at all
    assert _entry(tc, "federal")["status"] == "PROFILE_INCOMPLETE"
    assert _entry(tc, "ohio")["status"] == "PROFILE_INCOMPLETE"
    assert _entry(tc, "school_district")["status"] == "PROFILE_INCOMPLETE"
    assert "needs confirmation" in _entry(tc, "school_district")["note"]
    assert tc["next_action"]["none"] is False
    assert tc["next_action"]["status"] == "PROFILE_INCOMPLETE"
    assert "Tax Profile" in tc["next_action"]["sub"] or "profile" in tc["next_action"]["sub"].lower()
    assert tc["profile_readiness"]["federal"]["complete"] is False


def test_cpa_review_state():
    _configure_sales(months_back=0)
    _setup_profile(fed_over={"unusual_tax_situation": True},
                   ohio_over={"unusual_ohio_situation": True, "withholding_ytd": 1300.0})
    tc = _tc()
    fe = _entry(tc, "federal")
    assert fe["status"] == "CPA_REVIEW_REQUIRED"
    assert fe["remaining_amount"] is None               # no dollar while gated
    assert _entry(tc, "ohio")["status"] == "CPA_REVIEW_REQUIRED"
    assert tc["next_action"]["status"] == "CPA_REVIEW_REQUIRED"
    assert "No payment amount is recommended" in tc["next_action"]["sub"]


def test_engine_unavailable_year():
    _configure_sales(months_back=0)
    tc = _tc(as_of=date(2001, 8, 18), year=2001)
    assert _entry(tc, "federal")["status"] == "ENGINE_UNAVAILABLE"
    assert _entry(tc, "ohio")["status"] == "ENGINE_UNAVAILABLE"


def test_federal_zero_because_withholding_covers():
    _configure_sales(months_back=0)
    _setup_profile(fed_over={"withholding_expected_remaining": 60000.0})
    tc = _tc()
    fe = _entry(tc, "federal")
    assert fe["status"] == "NO_PAYMENT_REQUIRED"
    assert all(e["key"] != "federal" for e in tc["attention"])


def test_sd_not_applicable_stays_out_of_attention():
    _configure_sales(months_back=0)
    _setup_profile(sd=_sd_no())
    tc = _tc()
    se = _entry(tc, "school_district")
    assert se["status"] == "NOT_APPLICABLE"
    assert "No Ohio school-district income tax configured" in se["note"]
    assert all(e["key"] != "school_district" for e in tc["attention"])
    # and no SD rows pollute the calendar
    assert all(u["jurisdiction"] != "ohio_school_district" for u in tc["upcoming_dates"])


# ═══════════════ payment-correctness regressions ═══════════════

def test_future_and_voided_payments_excluded():
    _configure_sales(months_back=0)
    _setup_profile()
    base = _entry(_tc(), "federal")["remaining_amount"]
    _pay(300.0, "2026-12-20", jurisdiction="federal", period=4)    # future
    p = _pay(250.0, "2026-08-01", jurisdiction="federal")          # then voided
    run(server.void_estimated_tax_payment(p["id"], server.EstimatedTaxPaymentVoidIn(
        reason=f"{TAG} void"), ADMIN))
    fe = _entry(_tc(), "federal")
    assert fe["remaining_amount"] == base                # neither row counted
    assert fe["future_dated_total"] == 300.0             # visible, not credited
    assert fe["status"] == "PAYMENT_NEEDED"              # never prematurely on-track


def test_legacy_rows_affect_nothing():
    _configure_sales(months_back=0)
    _setup_profile(sd=_sd_earned())
    before = _tc()
    run(server.db.tax_payments.insert_one({
        "id": str(uuid.uuid4()), "year": YEAR, "quarter": 3, "amount": 5000.0,
        "payment_date": "2026-08-01", "payment_method": "EFTPS", "memo": TAG,
        "created_at": server.now_iso()}))
    after = _tc()
    for key in ("federal", "ohio", "school_district"):
        assert _entry(after, key)["remaining_amount"] == _entry(before, key)["remaining_amount"]
    assert after["legacy_unassigned"]["total"] >= 5000.0
    assert "excluded" in after["legacy_unassigned"]["note"]
    # the planning reserve never appears in authoritative surfaces
    surface = json.dumps({"a": after["attention"], "n": after["next_action"]}).lower()
    assert "reserve" not in surface
    assert "planning" not in surface
    assert "reserve" in after["notes"]["planning_reserve"].lower()  # note-only


def test_january_q4_belongs_to_prior_tax_year():
    _configure_sales(months_back=0)
    _setup_profile()
    tc = _tc(as_of=date(2027, 1, 5), year=YEAR)
    fe = _entry(tc, "federal")
    oe = _entry(tc, "ohio")
    assert tc["tax_year"] == YEAR                       # never mixed with 2027
    assert fe["due_date"] == "2027-01-15"               # Q4 of tax year 2026
    assert oe["due_date"] == "2027-01-15"
    assert any(u["date"] == "2027-01-15" and u["jurisdiction"] == "federal"
               for u in tc["upcoming_dates"])


def test_business_date_boundary_on_deadline_day(monkeypatch):
    """On the deadline day itself the installment is still 'due', never
    overdue — and the aggregator's whole clock is the BUSINESS date."""
    _configure_sales(months_back=0)
    _setup_profile()
    tc = _tc(as_of=date(2026, 9, 15))
    fe = _entry(tc, "federal")
    assert fe["due_date"] == "2026-09-15"
    assert fe["status"] == "PAYMENT_NEEDED"             # not OVERDUE on the day
    # default clock = server.business_today() (business timezone, not UTC)
    monkeypatch.setattr(server, "business_today", lambda: date(2026, 9, 15))
    live = run(server._tax_center_payload(YEAR))
    assert live["as_of"] == "2026-09-15"


def test_upcoming_dates_order_and_sources():
    _configure_sales(months_back=1)
    _setup_profile(sd=_sd_earned())
    tc = _tc()
    dates = [u["date"] for u in tc["upcoming_dates"]]
    assert dates == sorted(dates)
    js = {u["jurisdiction"] for u in tc["upcoming_dates"]}
    assert {"federal", "ohio", "ohio_school_district", "sales_tax"} <= js
    assert all("municipal" not in u["label"].lower() for u in tc["upcoming_dates"])


# ═══════════════ access control ═══════════════

def test_front_desk_403_no_leakage():
    uid = str(uuid.uuid4())
    email = f"{TAG.lower()}-fd-{uuid.uuid4().hex[:6]}@example.com"
    run(server.db.users.insert_one({
        "id": uid, "email": email, "name": TAG, "role": "employee", "staff_role": "front_desk",
        "password_hash": "x", "active": True, "must_change_password": False, "needs_password": False}))
    headers = {"Authorization": f"Bearer {server.create_access_token(uid, email, 'employee', 0)}"}
    r = run(_http.get(f"/api/admin/tax-center?year={YEAR}", headers=headers))
    assert r.status_code == 403
    body = r.text.lower()
    for leak in ("federal", "school_district", "sales_tax", "remaining", "liability"):
        assert leak not in body
