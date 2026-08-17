"""Step 4D-2C — 2026 Ohio + School-District estimated tax tests (A–AG).

No official 2026 Ohio worked example exists, so control cases are
hand-calculated line-by-line from the CURRENT STATUTES (documented per
test): R.C. 5747.01(A)(28) BID, 5747.02(A)(4) 3% business rate,
5747.02(A)(3)(c) 2026 nonbusiness formula ($332 + 2.75% over $26,050 —
the statute, NOT the stale ES-worksheet chart), 5747.025 exemption
tiers, 5747.022 $20 credit, 5747.09 combined $500 threshold + dual
safe harbor (NO 110% rule) + 22.5/45/67.5/90 vs 25/50/75/100 cumulative
installments, 5748.01 SDIT bases. Endpoint tests pin the annual profit
to exactly $50,000 by reading YTD and setting the remaining-year value
to (50,000 − YTD), making every expected number deterministic.
Tag TEST_OHTAX.
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


# ── B — business income over BID → 3% on the remainder ──────────────────────
def test_b_business_over_bid():
    st = _state(federal_agi=280000.0, business_income=300000.0)
    assert st["bid_used"] == 250000.0
    assert st["taxable_business_income"] == 50000.0
    assert st["business_tax"] == 1500.0            # 3% (R.C. 5747.02(A)(4))
    # taxable income 280,000−250,000−1,850 = 28,150, ALL business → tnb 0
    assert st["taxable_nonbusiness_income"] == 0.0
    assert st["state_tax"] == 1500.0


# ── C — MFS BID is $125,000 ─────────────────────────────────────────────────
def test_c_mfs_bid():
    st = _state(filing_status="married_filing_separately",
                federal_agi=180000.0, business_income=200000.0)
    assert st["bid_cap"] == 125000.0
    assert st["bid_used"] == 125000.0
    assert st["taxable_business_income"] == 75000.0
    assert st["business_tax"] == 2250.0


# ── D — nonbusiness uses the 2026 statutory formula, never flat 2.75% ───────
def test_d_nonbusiness_statutory_formula():
    # Pure W-2: OAGI 100,000, no business, 1 exemption (MAGI 100k → $1,850).
    st = _state(federal_agi=100000.0, business_income=0.0)
    assert st["taxable_nonbusiness_income"] == 98150.0
    # Statute: $332 + 2.75% × (98,150 − 26,050) = 332 + 1,982.75 = 2,314.75
    assert st["nonbusiness_tax"] == 2314.75
    assert st["nonbusiness_tax"] != round(98150.0 * 0.0275, 2)  # flat-rate would be 2,699.13
    # at/below $26,050 → zero (2026 zero bracket)
    st2 = _state(federal_agi=27000.0, business_income=0.0)
    assert st2["per_exemption"] == 2350.0            # ≤40k MAGI tier
    assert st2["taxable_nonbusiness_income"] == 24650.0
    assert st2["nonbusiness_tax"] == 0.0


# ── E — mixed business + W-2: bases separated correctly ─────────────────────
def test_e_mixed_bases():
    # OAGI 126,467.61 (50k profit − ½SE + 80k other), biz 50k fully BID'd.
    st = _state(federal_agi=126467.61)
    assert st["bid_used"] == 50000.0 and st["business_tax"] == 0.0
    # taxable = 126,467.61 − 50,000 − 1,850 = 74,617.61 — all nonbusiness
    assert st["taxable_income"] == 74617.61
    assert st["taxable_nonbusiness_income"] == 74617.61
    # 332 + 2.75% × 48,567.61 = 1,667.61
    assert st["nonbusiness_tax"] == 1667.61


# ── F — exemptions: statutory MAGI tiers + $500k disallowance + $20 credit ──
def test_f_exemptions():
    assert _state(federal_agi=30000.0, business_income=0.0)["per_exemption"] == 2350.0   # ≤40k
    assert _state(federal_agi=60000.0, business_income=0.0)["per_exemption"] == 2100.0   # ≤80k
    assert _state(federal_agi=100000.0, business_income=0.0)["per_exemption"] == 1850.0  # >80k
    hi = _state(federal_agi=520000.0, business_income=0.0)
    assert hi["per_exemption"] == 0.0 and hi["exemption_disallowed_high_magi"] is True
    # MAGI includes the BID add-back: OAGI 46,467.61 + BID 50,000 = 96,467.61
    assert _state()["magi"] == 96467.61
    # $20/exemption credit only at OAGI ≤ $30,000 (R.C. 5747.022)
    low = _state(federal_agi=29000.0, business_income=0.0, exemption_count=3)
    assert low["exemption_credit"] == 60.0
    assert _state(federal_agi=60000.0, business_income=0.0)["exemption_credit"] == 0.0


def _sd(**over):
    base = dict(applicable="yes", base_type="traditional", rate_pct=1.25,
                magi=96467.61, exemptions_total=1850.0,
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
    assert sd["taxable_base"] == round(96467.61 - 1850.0, 2)   # 94,617.61
    assert sd["tax"] == round(94617.61 * 0.0125, 2)            # 1,182.72
    assert "ADDS BACK" in sd["note"]


# ── I — earned-income base: wages + SE net earnings (§1402(a)) ──────────────
def test_i_earned_income_sd():
    sd = _sd(base_type="earned_income", rate_pct=1.5, w2_wages=20000.0)
    # 20,000 + 50,000 × .9235 = 66,175 × 1.5% = 992.63
    assert sd["taxable_base"] == 66175.0
    assert sd["tax"] == 992.62   # 992.625 → banker's rounding
    assert "no Business Income Deduction" in sd["note"]


# ── J — BID zeroes STATE business tax but never SDIT ────────────────────────
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
    # Combined 1,667.61 with 1,300 withholding → 367.61 ≤ 500 → not required
    oh = _ohio_section(withholding_ytd=1300.0)
    r = _estimate(ohio=oh)
    assert r["combined_liability"] == 1667.61
    assert r["threshold"]["amount"] == 500.0
    assert r["threshold"]["after_withholding"] == 367.61
    assert r["threshold"]["payment_required"] is False              # (K)
    assert "$500" in r["no_payment_reason"]
    assert r["installments"]["remaining_next_payment"] == 0.0
    r2 = _estimate()                                                # (L) 1,667.61 > 500
    assert r2["threshold"]["payment_required"] is True


# ── M/N — dual safe harbor: 90% current vs 100% prior (lesser) ──────────────
def test_mn_safe_harbor_paths():
    r = _estimate(ohio=_ohio_section(prior_year_tax=5000.0))        # prior higher
    assert r["safe_harbor"]["current_year_target"] == round(1667.61 * 0.9, 2)
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
#             or 25/50/75/100% prior (statutory dual schedule) ──────────────
def test_qrst_cumulative_installments():
    for k, cur_pct, pri_pct in ((1, .225, .25), (2, .45, .50), (3, .675, .75), (4, .90, 1.0)):
        r = _estimate(quarter=k)
        expected = min(round(1667.61 * cur_pct, 2), round(1200.0 * pri_pct, 2))
        assert r["installments"]["required_through_next"] == expected, k
    # with an invalid prior year, pure current-year schedule applies:
    r4 = _estimate(quarter=4, ohio=_ohio_section(prior_year_full_12_months=False))
    assert r4["installments"]["required_through_next"] == round(1667.61 * 0.90, 2)


# ── AB — catch-up: cumulative shortfall carried into today's requirement ────
def test_ab_catch_up():
    r = _estimate(quarter=3, oh_paid=100.0, passed=2)
    inst = r["installments"]
    required = min(round(1667.61 * .675, 2), 900.0)     # 900 (prior path)
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


# ═══════════════ Endpoint tests (deterministic $50,000 annual profit) ═══════

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


def _setup_profile(fed_over=None, ohio_over=None, sd_over=None):
    """Pin annual profit to EXACTLY $50,000: read YTD, set remaining."""
    probe = run(server._ohio_estimated_tax_payload(YEAR, as_of=date(2026, 8, 17)))
    ytd = probe["business_projection"]["actual_ytd_business_profit"]
    run(server.put_tax_profile(YEAR, server.TaxProfilePatchIn(
        federal=_fed_section(**(fed_over or {})),
        ohio=_ohio_section(**(ohio_over or {})),
        school_district=_sd_section(**(sd_over or {})),
        projection={"remaining_business_profit": round(50000.0 - ytd, 2)}), ADMIN))


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
    # combined = state-only 1,667.61 (hand-calculated in test E)
    assert r2["estimate"]["combined_liability"] == 1667.61
    assert r2["federal_agi_starting_point"] == 126467.61


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
