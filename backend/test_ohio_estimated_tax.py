"""Steps 4D-2C + 4D-2C-1 — 2026 Ohio + School-District estimated tax tests.

No official 2026 Ohio worked example exists, so control cases are
hand-calculated line-by-line from the CURRENT STATUTES (documented per
test): R.C. 5747.01(A)(28) BID, 5747.01(II) MAGI, 5747.02(A)(4) 3%
business rate incl. the (A)(4)(b) unused-exemption spillover,
5747.02(A)(3)(c) 2026 nonbusiness formula ($332 + 2.75% over $26,050 —
the statute, NOT the stale ES-worksheet chart), 5747.025 exemption
tiers ($2,400/$2,150/$1,900 — the indexed amounts FROZEN for 2025–2026
by H.B. 96 §757.120, per the official IT 1040 instructions), 5747.022
$20 credit (MAGI − exemptions < $30,000; EXCLUDED from the 5747.09
estimated-tax determination by its own last sentence), 5747.09 combined
$500 threshold + dual safe harbor (NO 110% rule) + 22.5/45/67.5/90 vs
25/50/75/100 cumulative installments, 5748.01 SDIT bases. Endpoint
tests pin the annual profit by reading YTD and setting the remaining-
year value to (target − YTD), making every expected number
deterministic. Tag TEST_OHTAX.
"""
import uuid
from datetime import date

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import httpx
import pytest
import server
import ohio_estimated_tax as oe
from ohio_tax_constants import ohio_constants_for
from _test_loop import run

TAG = "TEST_OHTAX"
ADMIN = {"id": "ohtax-admin", "name": "OhTax QA", "email": "ohtax@test", "role": "admin"}
YEAR = 2026
C = ohio_constants_for(2026)

_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")


@pytest.fixture(autouse=True)
def _clean_state():
    yield
    run(server.db.tax_profiles.delete_many({"tax_year": {"$in": [YEAR, 2001]}}))
    run(server.db.estimated_tax_payments.delete_many({"memo": TAG}))
    run(server.db.retail_sales.delete_many({"description": {"$regex": TAG}}))
    run(server.db.users.delete_many({"email": {"$regex": TAG.lower()}}))


def _state(**over):
    base = dict(federal_agi=46467.61, business_income=50000.0, filing_status="single",
                ohio_adjustments=0.0, exemption_count=1, other_ohio_credits=0.0, C=C)
    base.update(over)
    return oe.compute_ohio_state_tax(**base)


# ── A — business income under BID → $0 state business tax ───────────────────
def test_a_business_under_bid():
    st = _state()
    assert st["bid_cap"] == 250000.0
    assert st["bid_used"] == 50000.0
    assert st["taxable_business_income"] == 0.0
    assert st["business_tax"] == 0.0
    assert st["state_tax"] == 0.0     # nothing nonbusiness either
    # 4D-2C-1: MAGI is the PRE-BID figure (OAGI + add-back lands back
    # here) — never OAGI-plus-BID-again. OAGI itself may go negative
    # when the ½-SE deduction pulls federal AGI under the BID.
    assert st["magi"] == 46467.61
    assert st["oagi"] == -3532.39


# ── B — REQUIRED MIXED-INCOME CONTROL (Issue 2): $300k business + $100k
#        W-2. The $250k BID comes out ONCE; the $100k nonbusiness income
#        stays fully in the nonbusiness base. Hand math:
#        MAGI 400,000 → OAGI 150,000 → prelim TBI 50,000 → exemption
#        $1,900 (>$80k tier) → income tax base 148,100 → TBI 50,000 →
#        taxable nonbusiness 98,100 → business 3% = 1,500.00; nonbusiness
#        $332 + 2.75% × 72,050 = 2,313.38 → state 3,813.38 ─────────────────
def test_b_mixed_income_control():
    st = _state(federal_agi=400000.0, business_income=300000.0)
    assert st["magi"] == 400000.0
    assert st["oagi"] == 150000.0                      # BID subtracted once
    assert st["bid_used"] == 250000.0
    assert st["preliminary_taxable_business_income"] == 50000.0
    assert st["exemptions_total"] == 1900.0
    assert st["taxable_income"] == 148100.0            # OAGI − exemptions
    assert st["taxable_business_income"] == 50000.0
    assert st["unused_exemptions_applied_to_business"] == 0.0
    assert st["taxable_nonbusiness_income"] == 98100.0  # the 100k survives
    assert st["business_tax"] == 1500.0
    assert st["nonbusiness_tax"] == 2313.38
    assert st["state_tax"] == 3813.38
    assert st["estimated_tax_liability"] == 3813.38    # no credit here


# ── C — MFS BID is $125,000 ─────────────────────────────────────────────────
def test_c_mfs_bid():
    st = _state(filing_status="married_filing_separately",
                federal_agi=220000.0, business_income=200000.0)
    assert st["bid_cap"] == 125000.0
    assert st["bid_used"] == 125000.0
    assert st["taxable_business_income"] == 75000.0
    assert st["business_tax"] == 2250.0
    # OAGI 95,000 − exemption 1,900 = 93,100 base; nonbusiness remainder
    # 18,100 sits below the $26,050 zero bracket:
    assert st["taxable_nonbusiness_income"] == 18100.0
    assert st["nonbusiness_tax"] == 0.0
    assert st["state_tax"] == 2250.0


# ── D — nonbusiness uses the 2026 statutory formula, never flat 2.75% ───────
def test_d_nonbusiness_statutory_formula():
    # Pure W-2: MAGI 100,000, no business, 1 exemption ($1,900 tier).
    st = _state(federal_agi=100000.0, business_income=0.0)
    assert st["taxable_nonbusiness_income"] == 98100.0
    # Statute: $332 + 2.75% × (98,100 − 26,050) = 2,313.38
    assert st["nonbusiness_tax"] == 2313.38
    assert st["nonbusiness_tax"] != round(98100.0 * 0.0275, 2)  # flat would be 2,697.75
    # at/below $26,050 → zero (2026 zero bracket)
    st2 = _state(federal_agi=27000.0, business_income=0.0)
    assert st2["per_exemption"] == 2400.0            # ≤40k MAGI tier (frozen)
    assert st2["taxable_nonbusiness_income"] == 24600.0
    assert st2["nonbusiness_tax"] == 0.0


# ── E — mixed business + W-2: bases separated correctly ─────────────────────
def test_e_mixed_bases():
    # Pre-BID income 126,467.61 (50k profit − ½SE + 80k other), biz 50k BID'd.
    st = _state(federal_agi=126467.61)
    assert st["bid_used"] == 50000.0 and st["business_tax"] == 0.0
    assert st["oagi"] == 76467.61
    # base = 76,467.61 − 1,900 = 74,567.61 — all nonbusiness
    assert st["taxable_income"] == 74567.61
    assert st["taxable_nonbusiness_income"] == 74567.61
    # 332 + 2.75% × 48,517.61 = 1,666.23
    assert st["nonbusiness_tax"] == 1666.23


# ── F — exemptions: frozen 2026 amounts by MAGI + $500k disallowance ────────
def test_f_exemptions():
    assert _state(federal_agi=30000.0, business_income=0.0)["per_exemption"] == 2400.0   # ≤40k
    assert _state(federal_agi=60000.0, business_income=0.0)["per_exemption"] == 2150.0   # ≤80k
    assert _state(federal_agi=100000.0, business_income=0.0)["per_exemption"] == 1900.0  # >80k
    hi = _state(federal_agi=520000.0, business_income=0.0)
    assert hi["per_exemption"] == 0.0 and hi["exemption_disallowed_high_magi"] is True
    # provenance surfaced (frozen-by-HB-96 basis travels with the numbers)
    assert "H.B. 96" in _state()["exemption_amounts_basis"]


# ── F2 — MAGI tier + $500k boundaries (Issue 4 regression, every tier) ──────
def test_f2_exemption_tier_boundaries():
    cases = [(40000.0, 2400.0), (40000.01, 2150.0), (80000.0, 2150.0),
             (80000.01, 1900.0), (499999.99, 1900.0), (500000.0, 0.0)]
    for magi, expected in cases:
        st = _state(federal_agi=magi, business_income=0.0)
        assert st["per_exemption"] == expected, magi


# ── F3 — $20 credit: MAGI − exemptions < $30,000 (strict), and the credit
#         reduces the RETURN projection but NEVER the estimated-tax base
#         (R.C. 5747.022, last sentence) — Issue 1 ─────────────────────────
def test_f3_exemption_credit_rules():
    low = _state(federal_agi=29000.0, business_income=0.0, exemption_count=3)
    assert low["exemption_credit"] == 60.0
    assert _state(federal_agi=60000.0, business_income=0.0)["exemption_credit"] == 0.0
    # strict boundary: MAGI 32,400 − 2,400 = 30,000 exactly → NOT eligible
    assert _state(federal_agi=32400.0, business_income=0.0)["exemption_credit"] == 0.0
    #                32,399 − 2,400 = 29,999 → eligible
    assert _state(federal_agi=32399.0, business_income=0.0)["exemption_credit"] == 20.0
    # Issue 1 core: W-2 31,000 → nonbusiness tax 402.12; credit $20 applies
    # to the projected return ONLY. Estimated-tax base keeps the full 402.12.
    st = _state(federal_agi=31000.0, business_income=0.0)
    assert st["nonbusiness_tax"] == 402.12
    assert st["exemption_credit"] == 20.0
    assert st["state_tax"] == 382.12                 # projected return
    assert st["estimated_tax_liability"] == 402.12   # 5747.09 base


# ── S1/S2/S3 — R.C. 5747.02(A)(4)(b) unused-exemption spillover (Issue 3):
#   business-only income slightly above the BID; exemptions left after the
#   nonbusiness side reduce taxable business income, never below zero ───────
def test_s1_spillover_partial():
    # biz 260,000, pre-BID income 265,079.41 (260k + 20k other − ½SE),
    # 3 exemptions × $1,900 = 5,700. OAGI 15,079.41; prelim TBI 10,000;
    # nonbusiness before exemptions 5,079.41 → unused 620.59 reduces TBI
    # to 9,379.41 (= income tax base) → 3% = 281.38; nonbusiness taxable 0.
    st = _state(federal_agi=265079.41, business_income=260000.0, exemption_count=3)
    assert st["preliminary_taxable_business_income"] == 10000.0
    assert st["exemptions_total"] == 5700.0
    assert st["taxable_income"] == 9379.41
    assert st["unused_exemptions_applied_to_business"] == 620.59
    assert st["taxable_business_income"] == 9379.41
    assert st["business_tax"] == 281.38
    assert st["taxable_nonbusiness_income"] == 0.0
    assert st["state_tax"] == 281.38


def test_s2_spillover_exact():
    # OAGI 5,700 = prelim TBI 5,700; exemptions 5,700 exactly absorb it.
    st = _state(federal_agi=255700.0, business_income=255700.0, exemption_count=3)
    assert st["preliminary_taxable_business_income"] == 5700.0
    assert st["taxable_business_income"] == 0.0
    assert st["business_tax"] == 0.0
    assert st["state_tax"] == 0.0


def test_s3_spillover_beyond():
    # Unused exemptions exceed taxable business income → floors at zero,
    # tax never negative.
    st = _state(federal_agi=252000.0, business_income=252000.0, exemption_count=3)
    assert st["preliminary_taxable_business_income"] == 2000.0
    assert st["taxable_business_income"] == 0.0
    assert st["business_tax"] == 0.0
    assert st["state_tax"] == 0.0
    assert st["estimated_tax_liability"] == 0.0


def _sd(**over):
    base = dict(applicable="yes", base_type="traditional", rate_pct=1.25,
                magi=126467.61, exemptions_total=1900.0,
                w2_wages=0.0, spouse_wages=0.0, se_profit_total=50000.0, C=C)
    base.update(over)
    return oe.compute_sdit(**base)


# ── G — SD confirmed not applicable → $0 explicitly ─────────────────────────
def test_g_sd_not_applicable():
    sd = _sd(applicable="no")
    assert sd["applicable"] is False and sd["tax"] == 0.0


# ── H — traditional base: MAGI (with BID add-back) − exemptions ─────────────
def test_h_traditional_sd():
    sd = _sd()
    assert sd["taxable_base"] == round(126467.61 - 1900.0, 2)  # 124,567.61
    assert sd["tax"] == round(124567.61 * 0.0125, 2)           # 1,557.10
    assert "ADDS BACK" in sd["note"]


# ── I — earned-income base: wages + SE net earnings (§1402(a)) ──────────────
def test_i_earned_income_sd():
    sd = _sd(base_type="earned_income", rate_pct=1.5, w2_wages=20000.0)
    # 20,000 + 50,000 × .9235 = 66,175 × 1.5% = 992.63
    assert sd["taxable_base"] == 66175.0
    assert sd["tax"] == 992.62   # 992.625 → banker's rounding
    assert "no Business Income Deduction" in sd["note"]


# ── J — BID zeroes STATE business tax but never SDIT (critical case) ────────
def test_j_bid_does_not_kill_sdit():
    st = _state()                       # state tax $0 (fully BID-sheltered)
    assert st["state_tax"] == 0.0
    sd = _sd()                          # traditional SDIT still positive
    assert sd["tax"] > 0.0
    sd2 = _sd(base_type="earned_income", rate_pct=1.5)
    assert sd2["tax"] == round(50000.0 * 0.9235 * 0.015, 2)    # 692.62


def _ohio_section(**over):
    base = dict(resident=True, prior_year_full_12_months=True, prior_year_tax=1200.0,
                prior_year_overpayment_applied=0.0, withholding_ytd=0.0,
                withholding_expected_remaining=0.0, other_expected_ohio_adjustments=0.0,
                other_expected_ohio_credits=0.0, exemption_count=1.0,
                unusual_ohio_situation=False)
    base.update(over)
    return base


def _sd_section(**over):
    base = dict(applicable="no", district_name=None, district_number=None,
                tax_base_type=None, rate_pct=None, withholding_ytd=None,
                withholding_expected_remaining=None, prior_year_tax=None,
                prior_year_overpayment_applied=None)
    base.update(over)
    return base


def _estimate(*, federal_agi=126467.61, profit=50000.0, ohio=None, sd=None,
              quarter=3, oh_paid=0.0, sd_paid=0.0, passed=2, status="single",
              w2=0.0, spouse=0.0, other_se=0.0):
    return oe.compute_ohio_estimate(
        filing_status=status, federal_agi=federal_agi, annual_business_profit=profit,
        other_se_income=other_se, w2_wages=w2, spouse_wages=spouse,
        ohio=ohio or _ohio_section(), school_district=sd or _sd_section(),
        constants=C,
        next_deadline={"tax_year": YEAR, "quarter": quarter, "due": "2026-09-15"},
        ohio_payments_total=oh_paid, sd_payments_total=sd_paid,
        prior_installments_passed=passed)


# ── K/L — the $500 combined threshold (never the federal $1,000) ────────────
def test_kl_500_threshold():
    # Combined 1,666.23 with 1,300 withholding → 366.23 ≤ 500 → not required
    oh = _ohio_section(withholding_ytd=1300.0)
    r = _estimate(ohio=oh)
    assert r["combined_liability"] == 1666.23
    assert r["estimated_tax_base"]["combined"] == 1666.23   # no credit here
    assert r["threshold"]["amount"] == 500.0
    assert r["threshold"]["after_withholding"] == 366.23
    assert r["threshold"]["payment_required"] is False              # (K)
    assert "$500" in r["no_payment_reason"]
    assert r["installments"]["remaining_next_payment"] == 0.0
    r2 = _estimate()                                                # (L) 1,666.23 > 500
    assert r2["threshold"]["payment_required"] is True


# ── K2 — Issue 1 end-to-end: the $20 credit must NOT flip the $500
#   threshold, the 90% target, or the installment base. W-2 31,000,
#   SD traditional 0.5%: return 525.12 but the 5747.09 base is 545.12 —
#   with $41 withholding the payment IS required (the pre-4D-2C-1 engine
#   said no at 484.12 ≤ 500) ────────────────────────────────────────────────
def test_k2_credit_never_reduces_estimated_requirement():
    sd = _sd_section(applicable="yes", district_name="QA Low District",
                     tax_base_type="traditional", rate_pct=0.5,
                     withholding_ytd=0.0, withholding_expected_remaining=0.0,
                     prior_year_tax=0.0, prior_year_overpayment_applied=0.0)
    oh = _ohio_section(withholding_ytd=41.0, prior_year_tax=5000.0)
    r = _estimate(federal_agi=31000.0, profit=0.0, w2=31000.0, ohio=oh, sd=sd)
    s = r["state"]
    assert s["state_tax"] == 382.12                       # return gets credit
    assert s["estimated_tax_liability"] == 402.12         # base does not
    assert r["combined_liability"] == 525.12              # 382.12 + 143.00
    assert r["estimated_tax_base"]["combined"] == 545.12  # 402.12 + 143.00
    assert r["estimated_tax_base"]["exemption_credit_excluded"] == 20.0
    # just ABOVE the boundary on the statutory base (would be below on the
    # credit-reduced number): 545.12 − 41 = 504.12 > 500
    assert r["threshold"]["after_withholding"] == 504.12
    assert r["threshold"]["payment_required"] is True
    assert "5747.022" in r["threshold"]["basis"]
    # 90% current-year target also uses the statutory base
    assert r["safe_harbor"]["current_year_target"] == round(545.12 * 0.9, 2)
    # just BELOW the boundary: 545.12 − 46 = 499.12 ≤ 500 → honestly none
    r2 = _estimate(federal_agi=31000.0, profit=0.0, w2=31000.0,
                   ohio=_ohio_section(withholding_ytd=46.0, prior_year_tax=5000.0), sd=sd)
    assert r2["threshold"]["after_withholding"] == 499.12
    assert r2["threshold"]["payment_required"] is False


# ── M/N — dual safe harbor: 90% current vs 100% prior (lesser) ──────────────
def test_mn_safe_harbor_paths():
    r = _estimate(ohio=_ohio_section(prior_year_tax=5000.0))        # prior higher
    assert r["safe_harbor"]["current_year_target"] == round(1666.23 * 0.9, 2)
    assert r["safe_harbor"]["selected_path"] == "current_year"      # (M)
    r2 = _estimate()                                                # prior 1,200 lower
    assert r2["safe_harbor"]["prior_year_target"] == 1200.0
    assert r2["safe_harbor"]["selected_path"] == "prior_year"       # (N)


# ── O — Ohio has NO federal 110% high-income rule ───────────────────────────
def test_o_no_110_rule():
    # Enormous prior-year AGI context is irrelevant — Ohio's prior-year path
    # is always 100% (the engine exposes no_110_rule and takes prior × 1.0).
    r = _estimate(ohio=_ohio_section(prior_year_tax=1200.0))
    assert r["safe_harbor"]["no_110_rule"] is True
    assert r["safe_harbor"]["prior_year_target"] == 1200.0          # exactly 100%


# ── P — prior-year return under 12 months invalidates that path ─────────────
def test_p_prior_year_not_12_months():
    r = _estimate(ohio=_ohio_section(prior_year_full_12_months=False, prior_year_tax=100.0))
    assert r["safe_harbor"]["prior_year_target"] is None
    assert r["safe_harbor"]["selected_path"] == "current_year"


# ── Q/R/S/T — cumulative installments: lesser of 22.5/45/67.5/90% current
#             (on the estimated-tax base) or 25/50/75/100% prior ────────────
def test_qrst_cumulative_installments():
    for k, cur_pct, pri_pct in ((1, .225, .25), (2, .45, .50), (3, .675, .75), (4, .90, 1.0)):
        r = _estimate(quarter=k)
        expected = min(round(1666.23 * cur_pct, 2), round(1200.0 * pri_pct, 2))
        assert r["installments"]["required_through_next"] == expected, k
    # with an invalid prior year, pure current-year schedule applies:
    r4 = _estimate(quarter=4, ohio=_ohio_section(prior_year_full_12_months=False))
    assert r4["installments"]["required_through_next"] == round(1666.23 * 0.90, 2)


# ── AB — catch-up: cumulative shortfall carried into today's requirement ────
def test_ab_catch_up():
    r = _estimate(quarter=3, oh_paid=100.0, passed=2)
    inst = r["installments"]
    required = min(round(1666.23 * .675, 2), 900.0)     # 900 (prior path)
    assert inst["required_through_next"] == required
    assert inst["remaining_next_payment"] == 800.0
    assert inst["prior_installment_underpaid"] is True
    assert "catch-up" in inst["underpayment_note"].lower()


# ── AA — withholding: Ohio + SD only, even allocation, never federal ────────
def test_aa_withholding():
    sd = _sd_section(applicable="yes", district_name="QA District", tax_base_type="traditional",
                     rate_pct=1.25, withholding_ytd=200.0, withholding_expected_remaining=200.0,
                     prior_year_tax=300.0, prior_year_overpayment_applied=0.0)
    oh = _ohio_section(withholding_ytd=300.0, withholding_expected_remaining=100.0)
    r = _estimate(ohio=oh, sd=sd, quarter=4)
    w = r["withholding"]
    assert w["ohio"] == 400.0 and w["school_district"] == 400.0 and w["total"] == 800.0
    assert "even" in w["allocation"]
    assert r["installments"]["withholding_counted_through_next"] == 800.0   # 4/4 of total


# ── Z — prior-year overpayments applied exactly once (state + SD) ───────────
def test_z_prior_year_overpayment():
    oh = _ohio_section(prior_year_overpayment_applied=150.0)
    r = _estimate(ohio=oh, quarter=3)
    inst = r["installments"]
    assert inst["prior_year_overpayments_applied"] == 150.0
    assert inst["credited_total"] == 150.0
    assert inst["remaining_next_payment"] == 900.0 - 150.0


# ═══════════════ Endpoint tests (deterministic pinned annual profit) ════════

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


def _setup_profile(fed_over=None, ohio_over=None, sd_over=None, profit=50000.0):
    """Pin annual profit EXACTLY: read YTD, set remaining = target − YTD."""
    probe = run(server._ohio_estimated_tax_payload(YEAR, as_of=date(2026, 8, 17)))
    ytd = probe["business_projection"]["actual_ytd_business_profit"]
    run(server.put_tax_profile(YEAR, server.TaxProfilePatchIn(
        federal=_fed_section(**(fed_over or {})),
        ohio=_ohio_section(**(ohio_over or {})),
        school_district=_sd_section(**(sd_over or {})),
        projection={"remaining_business_profit": round(profit - ytd, 2)}), ADMIN))


def _payload(as_of=date(2026, 8, 17)):
    return run(server._ohio_estimated_tax_payload(YEAR, as_of=as_of))


def _pay(amount, pay_date, jurisdiction="ohio", period=3):
    return run(server.record_estimated_tax_payment(server.EstimatedTaxPaymentIn(
        tax_year=YEAR, jurisdiction=jurisdiction, period=period, amount=amount,
        payment_date=pay_date, memo=TAG), ADMIN))


# ── AE — SD applicability unknown → PROFILE_INCOMPLETE, no dollars ──────────
def test_ae_sd_unknown_blocks():
    _setup_profile(sd_over={"applicable": "unknown"})
    r = _payload()
    assert r["status"] == "PROFILE_INCOMPLETE"
    assert "estimate" not in r
    # then confirming "no" (with the rest complete) unblocks:
    _setup_profile(sd_over={"applicable": "no"})
    r2 = _payload()
    assert r2["status"] == "READY"
    assert r2["estimate"]["school_district"]["tax"] == 0.0
    # deterministic hand numbers: profit 50k + 80k other income →
    # combined = state-only 1,666.23 (hand-calculated in test E)
    assert r2["estimate"]["combined_liability"] == 1666.23
    assert r2["estimate"]["estimated_tax_base"]["combined"] == 1666.23
    assert r2["federal_agi_starting_point"] == 126467.61


# ── CASE A (4D-2C-1 manual control) — low income / $20 credit through the
#    endpoint. Profit pinned to $0; W-2 $31,000; SD traditional 0.5%.
#    Return: 402.12 − 20 + 143.00 = 525.12. Estimated base: 545.12.
#    With $41 withholding → 504.12 > $500 → REQUIRED (the credit-reduced
#    number 484.12 would have wrongly said no) ──────────────────────────────
def test_case_a_low_income_credit_endpoint():
    sd = {"applicable": "yes", "district_name": "QA Low District",
          "tax_base_type": "traditional", "rate_pct": 0.5,
          "withholding_ytd": 0.0, "withholding_expected_remaining": 0.0,
          "prior_year_tax": 0.0, "prior_year_overpayment_applied": 0.0}
    _setup_profile(profit=0.0,
                   fed_over={"w2_wages": 31000.0, "w2_ss_wages": 31000.0,
                             "other_taxable_income": 0.0},
                   ohio_over={"withholding_ytd": 41.0, "prior_year_tax": 5000.0},
                   sd_over=sd)
    r = _payload()
    assert r["status"] == "READY"
    assert r["federal_agi_starting_point"] == 31000.0
    s = r["estimate"]["state"]
    assert s["nonbusiness_tax"] == 402.12
    assert s["exemption_credit"] == 20.0
    assert s["state_tax"] == 382.12
    assert s["estimated_tax_liability"] == 402.12
    assert r["estimate"]["school_district"]["tax"] == 143.0
    assert r["estimate"]["combined_liability"] == 525.12
    assert r["estimate"]["estimated_tax_base"]["combined"] == 545.12
    assert r["estimate"]["threshold"]["after_withholding"] == 504.12
    assert r["estimate"]["threshold"]["payment_required"] is True
    assert r["estimate"]["safe_harbor"]["current_year_target"] == 490.61
    inst = r["estimate"]["installments"]
    assert inst["required_through_next"] == 367.96      # .675 × 545.12
    assert inst["withholding_counted_through_next"] == 30.75
    assert inst["remaining_next_payment"] == 337.21
    # below the boundary: withholding 46 → 499.12 ≤ 500 → honest no-payment
    _setup_profile(profit=0.0,
                   fed_over={"w2_wages": 31000.0, "w2_ss_wages": 31000.0,
                             "other_taxable_income": 0.0},
                   ohio_over={"withholding_ytd": 46.0, "prior_year_tax": 5000.0},
                   sd_over=sd)
    r2 = _payload()
    assert r2["estimate"]["threshold"]["after_withholding"] == 499.12
    assert r2["estimate"]["threshold"]["payment_required"] is False


# ── CASE B (4D-2C-1 manual control) — mixed $300k business + $100k other
#    through the endpoint. ½SE = 15,456.23 → federal AGI 384,543.77.
#    OAGI 134,543.77; TBI 50,000; exemption 1,900; base 132,643.77;
#    nonbusiness 82,643.77 → 332 + 2.75% × 56,593.77 = 1,888.33;
#    business 1,500 → state 3,388.33 ─────────────────────────────────────────
def test_case_b_mixed_income_endpoint():
    _setup_profile(profit=300000.0,
                   fed_over={"other_taxable_income": 100000.0},
                   sd_over={"applicable": "no"})
    r = _payload()
    assert r["status"] == "READY"
    assert r["federal_agi_starting_point"] == 384543.77
    s = r["estimate"]["state"]
    assert s["magi"] == 384543.77
    assert s["oagi"] == 134543.77
    assert s["bid_used"] == 250000.0
    assert s["preliminary_taxable_business_income"] == 50000.0
    assert s["taxable_business_income"] == 50000.0
    assert s["exemptions_total"] == 1900.0
    assert s["taxable_income"] == 132643.77
    assert s["taxable_nonbusiness_income"] == 82643.77   # 100k income survives
    assert s["business_tax"] == 1500.0
    assert s["nonbusiness_tax"] == 1888.33
    assert s["state_tax"] == 3388.33
    # prior year 1,200 caps Q3 at 900 (25/50/75/100 schedule)
    assert r["estimate"]["installments"]["required_through_next"] == 900.0


# ── CASE C (4D-2C-1 manual control) — exemption spillover through the
#    endpoint. Profit 260,000 + 20,000 other; 3 exemptions.
#    ½SE = 14,920.59 → federal AGI 265,079.41 → OAGI 15,079.41; prelim TBI
#    10,000; unused exemptions 620.59 reduce it to 9,379.41 → 281.38 ────────
def test_case_c_exemption_spillover_endpoint():
    _setup_profile(profit=260000.0,
                   fed_over={"other_taxable_income": 20000.0},
                   ohio_over={"exemption_count": 3.0},
                   sd_over={"applicable": "no"})
    r = _payload()
    assert r["status"] == "READY"
    assert r["federal_agi_starting_point"] == 265079.41
    s = r["estimate"]["state"]
    assert s["preliminary_taxable_business_income"] == 10000.0
    assert s["unused_exemptions_applied_to_business"] == 620.59
    assert s["taxable_business_income"] == 9379.41
    assert s["business_tax"] == 281.38
    assert s["taxable_nonbusiness_income"] == 0.0
    assert s["state_tax"] == 281.38


# ── CASE D (4D-2C-1 regression) — $0 state / positive SDIT critical case
#    through the endpoint: profit 50,000 only, SD earned-income 1.5% ─────────
def test_case_d_zero_state_positive_sdit_endpoint():
    _setup_profile(profit=50000.0,
                   fed_over={"other_taxable_income": 0.0},
                   sd_over={"applicable": "yes", "district_name": "QA Earned District",
                            "tax_base_type": "earned_income", "rate_pct": 1.5,
                            "withholding_ytd": 0.0, "withholding_expected_remaining": 0.0,
                            "prior_year_tax": 300.0, "prior_year_overpayment_applied": 0.0})
    r = _payload()
    assert r["status"] == "READY"
    s = r["estimate"]["state"]
    assert s["state_tax"] == 0.0                        # BID shelters everything
    assert r["estimate"]["school_district"]["tax"] == 692.62
    assert r["estimate"]["combined_liability"] == 692.62
    assert r["estimate"]["threshold"]["payment_required"] is True
    sh = r["estimate"]["safe_harbor"]
    assert sh["current_year_target"] == 623.36          # 90% of 692.62
    assert sh["selected_path"] == "current_year"        # prior 1,500 is higher
    assert r["estimate"]["installments"]["required_through_next"] == 467.52


# ── U/V/W — payment jurisdiction isolation ──────────────────────────────────
def test_uvw_payment_isolation():
    _setup_profile(sd_over={"applicable": "yes", "district_name": "QA District",
                            "tax_base_type": "earned_income", "rate_pct": 1.5,
                            "withholding_ytd": 0.0, "withholding_expected_remaining": 0.0,
                            "prior_year_tax": 300.0, "prior_year_overpayment_applied": 0.0})
    r0 = _payload()
    assert r0["status"] == "READY"
    _pay(200.0, "2026-08-01", jurisdiction="ohio")                    # (U)
    r1 = _payload()
    assert r1["estimate"]["installments"]["ohio_payments_recorded"] == 200.0
    assert r1["estimate"]["installments"]["sd_payments_recorded"] == 0.0
    _pay(100.0, "2026-08-01", jurisdiction="ohio_school_district")    # (V)
    r2 = _payload()
    assert r2["estimate"]["installments"]["sd_payments_recorded"] == 100.0
    _pay(999.0, "2026-08-01", jurisdiction="federal")                 # (W)
    r3 = _payload()
    assert r3["estimate"]["installments"]["payments_recorded"] == 300.0  # federal ignored


# ── X/Y — future-dated exclusion + same-day inclusion ───────────────────────
def test_xy_payment_date_scoping():
    _setup_profile(sd_over={"applicable": "no"})
    _pay(500.0, "2026-12-15", period=4)
    r = _payload(as_of=date(2026, 8, 17))
    assert r["estimate"]["installments"]["ohio_payments_recorded"] == 0.0
    assert r["future_dated_payments_total"] == 500.0
    assert any(p["future_dated"] for p in r["ohio_payments"])
    _pay(100.0, "2026-08-17")                                         # same-day (Y)
    r2 = _payload(as_of=date(2026, 8, 17))
    assert r2["estimate"]["installments"]["ohio_payments_recorded"] == 100.0
    r3 = _payload(as_of=date(2026, 12, 16))                           # future arrives (X)
    assert r3["estimate"]["installments"]["ohio_payments_recorded"] == 600.0


# ── AC/AD — canonical business income: service revenue + signed refunds ─────
def test_acad_business_income_canonical():
    _setup_profile(sd_over={"applicable": "no"})
    ytd0 = _payload()["business_projection"]["actual_ytd_business_profit"]
    today = server.business_today().isoformat()
    run(server.db.retail_sales.insert_one({
        "id": str(uuid.uuid4()), "date": today, "amount": 100.0,
        "description": f"{TAG} daycare service", "created_at": server.now_iso()}))
    r = _payload()
    assert r["business_projection"]["actual_ytd_business_profit"] == round(ytd0 + 100.0, 2)  # (AC)
    run(server.db.retail_sales.insert_one({
        "id": str(uuid.uuid4()), "date": today, "amount": -100.0, "source_kind": "refund",
        "description": f"{TAG} refund", "created_at": server.now_iso()}))
    r2 = _payload()
    assert r2["business_projection"]["actual_ytd_business_profit"] == ytd0                   # (AD)


# ── AF — unsupported multistate/part-year → CPA_REVIEW_REQUIRED ─────────────
def test_af_cpa_gate():
    _setup_profile(ohio_over={"unusual_ohio_situation": True}, sd_over={"applicable": "no"})
    r = _payload()
    assert r["status"] == "CPA_REVIEW_REQUIRED"
    assert any("unusual Ohio situation" in f for f in r["cpa_review_reasons"])
    assert r["estimate"]["installments"]["remaining_next_payment"] is None
    # non-resident equally gated:
    _setup_profile(ohio_over={"resident": False}, sd_over={"applicable": "no"})
    r2 = _payload()
    assert r2["status"] == "CPA_REVIEW_REQUIRED"
    assert any("full-year Ohio resident" in f for f in r2["cpa_review_reasons"])


# ── AG — unknown tax year → ENGINE_UNAVAILABLE ──────────────────────────────
def test_ag_engine_unavailable():
    r = run(server._ohio_estimated_tax_payload(2001, as_of=date(2001, 8, 17)))
    assert r["status"] == "ENGINE_UNAVAILABLE"
    assert "estimate" not in r


# ── Constants pin — Issue 4: operative 2026 exemption amounts ───────────────
def test_constants_frozen_2026_exemptions():
    assert C["exemption_tiers"] == [(40000.0, 2400.0), (80000.0, 2150.0), (None, 1900.0)]
    assert C["exemption_zero_magi"] == 500000.0
    assert C["exemption_credit_per"] == 20.0
    assert C["exemption_credit_income_limit"] == 30000.0
    assert "H.B. 96" in C["exemption_amounts_basis"]


# ── Front Desk 403 ──────────────────────────────────────────────────────────
def test_front_desk_403():
    uid = str(uuid.uuid4())
    email = f"{TAG.lower()}-fd-{uuid.uuid4().hex[:6]}@example.com"
    run(server.db.users.insert_one({
        "id": uid, "email": email, "name": TAG, "role": "employee", "staff_role": "front_desk",
        "password_hash": "x", "active": True, "must_change_password": False, "needs_password": False}))
    headers = {"Authorization": f"Bearer {server.create_access_token(uid, email, 'employee', 0)}"}
    r = run(_http.get(f"/api/admin/ohio-estimated-tax?year={YEAR}", headers=headers))
    assert r.status_code == 403
    assert "school_district" not in r.text and "bid" not in r.text.lower()
