"""Step 4D-2B-1 — federal worksheet completion + payment date scoping (A–S).

Covers the three patch items against official 2026 rules:
  1. Non-itemizer charitable deduction (Pub 505 2026 Worksheet 2-1 line 2a:
     standard deduction + up to $1,000 / $2,000 MFJ of cash/check gifts).
  2. Schedule 1-A additional deductions (worksheet line 2c) as an
     owner-entered lump, readiness-material with null ≠ 0.
  3. Federal payment crediting by ACTUAL payment date against a frozen
     as-of date — a December payment can no longer zero out September's
     requirement in August (bug reproduced pre-fix: Dec 15 $4,000 payment
     made remaining_next_payment 0.00 on Aug 17).
Tag TEST_FEDPATCH.
"""
import uuid
from datetime import date

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import pytest
import server
import federal_estimated_tax as fe
from federal_tax_constants import federal_constants_for
from _test_loop import run

TAG = "TEST_FEDPATCH"
ADMIN = {"id": "fedpatch-admin", "name": "FedPatch QA", "email": "fedpatch@test", "role": "admin"}
YEAR = 2026
C = federal_constants_for(2026)


@pytest.fixture(autouse=True)
def _clean_state():
    yield
    run(server.db.tax_profiles.delete_many({"tax_year": YEAR}))
    run(server.db.estimated_tax_payments.delete_many({"memo": TAG}))


def _fed(**over):
    base = dict(
        filing_status="single", prior_year_agi=78000.0, prior_year_total_tax=9200.0,
        prior_year_full_12_months=True, prior_year_overpayment_applied=0.0,
        withholding_ytd=0.0, withholding_expected_remaining=0.0,
        w2_wages=0.0, w2_ss_wages=0.0, spouse_wages=0.0,
        other_taxable_income=0.0, other_se_income=0.0,
        credits_estimate=0.0, refundable_credits_estimate=0.0,
        se_health_insurance=0.0, retirement_hsa_adjustments=0.0,
        other_adjustments=0.0, other_expected_federal_taxes=0.0,
        deduction_method="standard", itemized_deduction_amount=None,
        nonitemizer_charitable_contributions=0.0, schedule_1a_deductions=0.0,
        expects_qualified_investment_income=False, unusual_tax_situation=False,
    )
    base.update(over)
    return base


def _estimate(profit=55000.0, fed=None, status="single", payments=0.0):
    return fe.compute_federal_estimate(
        filing_status=status, annual_business_profit=profit,
        federal=fed or _fed(filing_status=status), constants=C,
        next_deadline={"tax_year": YEAR, "quarter": 3, "due": "2026-09-15",
                       "period": "Jun 1 – Aug 31, 2026"},
        federal_payments_total=payments, prior_installments_pcts_passed=2)


def _profile(**fed_over):
    """Endpoint profile with a DETERMINISTIC requirement: the disposable
    DB's 2026 book profit is small/variable, so a 15,000 other-taxes lump
    keeps 90% of current-year above the 9,200 prior-year target → required
    annual payment is always 9,200 (through Q3: 6,900), and the $1,000
    threshold is always met."""
    fed_over.setdefault("other_expected_federal_taxes", 15000.0)
    run(server.put_tax_profile(YEAR, server.TaxProfilePatchIn(
        federal=_fed(**fed_over), projection={"remaining_business_profit": 0.0}), ADMIN))


def _pay(amount, pay_date, jurisdiction="federal", period=3):
    return run(server.record_estimated_tax_payment(server.EstimatedTaxPaymentIn(
        tax_year=YEAR, jurisdiction=jurisdiction, period=period, amount=amount,
        payment_date=pay_date, memo=TAG), ADMIN))


def _payload(as_of):
    return run(server._federal_estimated_tax_payload(YEAR, as_of=as_of))


# ── A — standard + confirmed $0 charity: line 2a = statutory standard ───────
def test_a_standard_zero_charity():
    r = _estimate()
    w = r["worksheet"]
    assert w["line_2a_deduction"] == 16100.0
    ch = w["nonitemizer_charitable"]
    assert ch["applicable"] is True and ch["entered"] == 0.0 and ch["allowed"] == 0.0
    assert ch["statutory_cap"] == 1000.0


# ── B — qualifying charity increases line 2a ────────────────────────────────
def test_b_charity_increases_2a():
    r = _estimate(fed=_fed(nonitemizer_charitable_contributions=500.0))
    w = r["worksheet"]
    assert w["line_2a_deduction"] == 16600.0        # 16,100 + 500
    assert w["nonitemizer_charitable"]["allowed"] == 500.0
    base = _estimate()
    # taxable income falls by 500 net of the QBI-limit interaction
    assert w["line_3_taxable_income"] < base["worksheet"]["line_3_taxable_income"]


# ── C — single cap: entered above $1,000 is capped, never inflates 2a ───────
def test_c_single_cap():
    r = _estimate(fed=_fed(nonitemizer_charitable_contributions=5000.0))
    ch = r["worksheet"]["nonitemizer_charitable"]
    assert ch["entered"] == 5000.0
    assert ch["statutory_cap"] == 1000.0
    assert ch["allowed"] == 1000.0
    assert r["worksheet"]["line_2a_deduction"] == 17100.0   # 16,100 + 1,000 max


# ── D — MFJ receives the $2,000 cap ─────────────────────────────────────────
def test_d_mfj_cap():
    fed = _fed(filing_status="married_filing_jointly", spouse_wages=0.0,
               nonitemizer_charitable_contributions=5000.0)
    r = _estimate(fed=fed, status="married_filing_jointly")
    ch = r["worksheet"]["nonitemizer_charitable"]
    assert ch["statutory_cap"] == 2000.0 and ch["allowed"] == 2000.0
    assert r["worksheet"]["line_2a_deduction"] == 34200.0   # 32,200 + 2,000
    # QSS files as surviving spouse, NOT a joint return → $1,000 cap
    assert C["nonitemizer_charitable_cap"]["qualifying_surviving_spouse"] == 1000.0


# ── E — itemized path: charity add-on not applied, never double-counted ─────
def test_e_itemized_no_double_count():
    fed = _fed(deduction_method="itemized", itemized_deduction_amount=21000.0,
               nonitemizer_charitable_contributions=800.0)
    r = _estimate(fed=fed)
    w = r["worksheet"]
    assert w["line_2a_deduction"] == 21000.0        # entered amount only
    assert w["nonitemizer_charitable"]["applicable"] is False
    assert w["nonitemizer_charitable"]["allowed"] == 0.0


# ── F — charity unset blocks the standard path (unknown ≠ zero) ─────────────
def test_f_charity_unset_blocks():
    fed = _fed()
    fed.pop("nonitemizer_charitable_contributions")
    run(server.put_tax_profile(YEAR, server.TaxProfilePatchIn(
        federal=fed, projection={"remaining_business_profit": 0.0}), ADMIN))
    r = _payload(as_of=date(2026, 8, 17))
    assert r["status"] == "PROFILE_INCOMPLETE"
    assert any("charitable" in m for m in r["missing_fields"])
    # …but on the ITEMIZED path the same unset field never blocks:
    fed2 = _fed(deduction_method="itemized", itemized_deduction_amount=21000.0)
    fed2.pop("nonitemizer_charitable_contributions")
    run(server.put_tax_profile(YEAR, server.TaxProfilePatchIn(
        federal=fed2, projection={"remaining_business_profit": 0.0}), ADMIN))
    r2 = _payload(as_of=date(2026, 8, 17))
    assert r2["status"] == "READY"


# ── G/I — Schedule 1-A: confirmed zero permits readiness; unset blocks ──────
def test_gi_schedule_1a_zero_vs_unset():
    _profile(schedule_1a_deductions=0.0)
    assert _payload(as_of=date(2026, 8, 17))["status"] == "READY"      # (G)
    fed = _fed(schedule_1a_deductions=None)   # explicit clear → unset
    run(server.put_tax_profile(YEAR, server.TaxProfilePatchIn(
        federal=fed, projection={"remaining_business_profit": 0.0}), ADMIN))
    r = _payload(as_of=date(2026, 8, 17))
    assert r["status"] == "PROFILE_INCOMPLETE"                          # (I)
    assert any("Schedule 1-A" in m for m in r["missing_fields"])


# ── H — Schedule 1-A reduces taxable income on line 2c, not Schedule C ──────
def test_h_schedule_1a_positive():
    base = _estimate()
    r = _estimate(fed=_fed(schedule_1a_deductions=6000.0))
    w = r["worksheet"]
    assert w["line_2c_schedule_1a"] == 6000.0
    # Business profit / AGI untouched — it is a PERSONAL deduction:
    assert w["income_components"]["business_profit"] == base["worksheet"]["income_components"]["business_profit"]
    assert w["line_1_agi"] == base["worksheet"]["line_1_agi"]
    assert w["line_2d_total_deductions"] == round(
        w["line_2a_deduction"] + w["line_2b_qbi"]["deduction"] + 6000.0, 2)
    assert w["line_3_taxable_income"] == round(w["line_1_agi"] - w["line_2d_total_deductions"], 2)


# ── J — combined worksheet vs hand calculation (official 2026 line math) ────
def test_j_combined_hand_calculation():
    # Single, $55,000 profit, $500 charity, $6,000 Schedule 1-A, standard.
    r = _estimate(fed=_fed(nonitemizer_charitable_contributions=500.0,
                           schedule_1a_deductions=6000.0))
    w = r["worksheet"]
    # SE: unchanged → AGI 51,114.38 (55,000 − 3,885.62)
    assert w["line_1_agi"] == 51114.38
    # 2a = 16,100 + 500 = 16,600 ; 2c = 6,000
    assert w["line_2a_deduction"] == 16600.0
    assert w["line_2c_schedule_1a"] == 6000.0
    # taxable before QBI = 51,114.38 − 16,600 − 6,000 = 28,514.38
    assert w["taxable_before_qbi"] == 28514.38
    # QBI = min(20% × 47,228.76 = 9,445.75, 20% × 28,514.38 = 5,702.88) = 5,702.88
    assert w["line_2b_qbi"]["deduction"] == 5702.88
    # 2d = 16,600 + 5,702.88 + 6,000 = 28,302.88 ; line 3 = 22,811.50
    assert w["line_2d_total_deductions"] == 28302.88
    assert w["line_3_taxable_income"] == 22811.5
    # Single schedule: 1,240 + 12% × (22,811.50 − 12,400) = 2,489.38
    assert w["line_4_income_tax"] == 2489.38


# ── K — future payment must not reduce today's requirement (the bug) ────────
def test_k_future_payment_excluded():
    _profile()
    _pay(4000.0, "2026-12-15", period=4)
    r = _payload(as_of=date(2026, 8, 17))
    inst = r["estimate"]["installments"]
    assert inst["federal_payments_recorded"] == 0.0     # Dec 15 not counted
    assert inst["remaining_next_payment"] == 6900.0     # Sep 15 requirement intact
    assert r["future_dated_payments_total"] == 4000.0
    assert any(p["future_dated"] for p in r["federal_payments"])  # still visible


# ── L — payment after the next deadline doesn't satisfy it early ────────────
def test_l_payment_after_deadline():
    _profile()
    _pay(4000.0, "2026-10-01", period=4)
    inst = _payload(as_of=date(2026, 8, 17))["estimate"]["installments"]
    assert inst["federal_payments_recorded"] == 0.0
    assert inst["remaining_next_payment"] == 6900.0


# ── M — past payment counts ─────────────────────────────────────────────────
def test_m_past_payment_counts():
    _profile()
    _pay(2000.0, "2026-08-01")
    inst = _payload(as_of=date(2026, 8, 17))["estimate"]["installments"]
    assert inst["federal_payments_recorded"] == 2000.0
    assert inst["remaining_next_payment"] == 4900.0


# ── N — same-day payment counts (business-date convention, inclusive) ───────
def test_n_same_day_boundary():
    _profile()
    _pay(1000.0, "2026-08-17")
    inst = _payload(as_of=date(2026, 8, 17))["estimate"]["installments"]
    assert inst["federal_payments_recorded"] == 1000.0
    # …and one day earlier it was future-dated:
    inst2 = _payload(as_of=date(2026, 8, 16))["estimate"]["installments"]
    assert inst2["federal_payments_recorded"] == 0.0


# ── O — a future payment starts counting exactly once its date arrives ──────
def test_o_future_becomes_current():
    _profile()
    _pay(4000.0, "2026-12-15", period=4)
    before = _payload(as_of=date(2026, 8, 17))
    assert before["estimate"]["installments"]["federal_payments_recorded"] == 0.0
    after = _payload(as_of=date(2026, 12, 16))
    inst = after["estimate"]["installments"]
    assert inst["federal_payments_recorded"] == 4000.0   # exactly once
    assert after["future_dated_payments_total"] == 0.0
    assert not any(p["future_dated"] for p in after["federal_payments"])


# ── P — voided payments never count, past or future ─────────────────────────
def test_p_voided_never_counts():
    _profile()
    p1 = _pay(2000.0, "2026-08-01")
    run(server.void_estimated_tax_payment(
        p1["id"], server.EstimatedTaxPaymentVoidIn(reason=f"{TAG} void"), ADMIN))
    inst = _payload(as_of=date(2026, 8, 17))["estimate"]["installments"]
    assert inst["federal_payments_recorded"] == 0.0
    assert inst["remaining_next_payment"] == 6900.0


# ── Q — Ohio / SD payments still never reduce the federal target ────────────
def test_q_jurisdiction_isolation():
    _profile()
    _pay(999.0, "2026-08-01", jurisdiction="ohio")
    _pay(500.0, "2026-08-01", jurisdiction="ohio_school_district")
    inst = _payload(as_of=date(2026, 8, 17))["estimate"]["installments"]
    assert inst["federal_payments_recorded"] == 0.0
    assert inst["remaining_next_payment"] == 6900.0


# ── R — catch-up/cumulative behavior intact after date filtering ────────────
def test_r_catch_up_regression():
    _profile()
    _pay(900.0, "2026-04-10", period=1)     # only $900 against Q1+Q2 (2×2,300)
    r = _payload(as_of=date(2026, 8, 17))
    inst = r["estimate"]["installments"]
    assert inst["federal_payments_recorded"] == 900.0
    assert inst["required_through_next"] == 6900.0
    assert inst["remaining_next_payment"] == 6000.0     # cumulative catch-up
    assert inst["prior_installment_underpaid"] is True
    assert "underpayment" in inst["underpayment_note"].lower()


# ── S — official Pub 505 control examples unchanged to the cent ─────────────
def test_s_official_examples_regression():
    # p.24 higher-income: 42,581 / 71,253 / AGI 180,000
    fed = _fed(prior_year_agi=180000.0, prior_year_total_tax=42581.0,
               other_expected_federal_taxes=71253.0)
    r = _estimate(profit=0.0, fed=fed)
    assert r["safe_harbor"]["current_year_target"] == 64127.7
    assert r["safe_harbor"]["prior_year_target"] == 46839.1
    assert r["safe_harbor"]["required_annual_payment"] == 46839.1
    # p.25 installment: 4,100 annual, 900 paid, 75% → 2,175
    fed2 = _fed(prior_year_full_12_months=False,
                other_expected_federal_taxes=4100.0 / 0.9)
    r2 = _estimate(profit=0.0, fed=fed2, payments=900.0)
    assert r2["installments"]["required_through_next"] == 3075.0
    assert r2["installments"]["remaining_next_payment"] == 2175.0
