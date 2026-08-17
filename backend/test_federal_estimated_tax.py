"""Step 4D-2B — 2026 Federal Estimated Tax engine tests (A–Z + officials).

Pure worksheet math is tested by calling the engine directly with fully
controlled inputs (hand-computed against the 2026 1040-ES worksheet and
Rate Schedules); endpoint tests cover completeness gating, jurisdiction
isolation of payments, canonical business-income flow, and permissions.

OFFICIAL IRS control examples reproduced (Pub 505, 2026 edition, ch. 2):
  * p. 24 "Higher income taxpayers": 2025 tax $42,581, expected 2026 tax
    $71,253, 2025 AGI $180,000 → 90% = $64,128, 110% = $46,839, required
    annual payment $46,839 (IRS whole-dollar; engine keeps cents:
    64,127.70 / 46,839.10).
  * p. 25 regular-installment/amended example: annual requirement $4,100,
    $900 paid, third-period cumulative 75% = $3,075 → $2,175 remaining.
Tag TEST_FEDTAX.
"""
import uuid
from datetime import date

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import httpx
import pytest
import server
import federal_estimated_tax as fe
from federal_tax_constants import federal_constants_for
from _test_loop import run

TAG = "TEST_FEDTAX"
ADMIN = {"id": "fedtax-admin", "name": "FedTax QA", "email": "fedtax@test", "role": "admin"}
YEAR = 2026
C = federal_constants_for(2026)

_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")


@pytest.fixture(autouse=True)
def _clean_state():
    yield
    run(server.db.tax_profiles.delete_many({"tax_year": {"$in": [YEAR, 2001]}}))
    run(server.db.estimated_tax_payments.delete_many({"memo": TAG}))
    run(server.db.retail_sales.delete_many({"description": {"$regex": TAG}}))
    run(server.db.users.delete_many({"email": {"$regex": TAG.lower()}}))


def _fed(**over):
    """A fully-confirmed federal profile section (all material fields zero)."""
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
        expects_qualified_investment_income=False, unusual_tax_situation=False,
    )
    base.update(over)
    return base


def _estimate(profit=55000.0, fed=None, quarter=3, payments=0.0, passed=2, status="single"):
    return fe.compute_federal_estimate(
        filing_status=status, annual_business_profit=profit,
        federal=fed or _fed(filing_status=status), constants=C,
        next_deadline={"tax_year": YEAR, "quarter": quarter, "due": "2026-09-15",
                       "period": "Jun 1 – Aug 31, 2026"},
        federal_payments_total=payments, prior_installments_pcts_passed=passed)


# ── A — simple Schedule C, single, standard deduction (hand-checked) ────────
def test_a_simple_schedule_c_single():
    r = _estimate(profit=55000.0)
    w = r["worksheet"]
    se = w["line_9_se_tax"]
    # SE worksheet: 55,000 × .9235 = 50,792.50 → SS 6,298.27 + Medicare 1,472.98
    assert se["net_earnings"] == 50792.5
    assert se["social_security"] == 6298.27
    assert se["medicare"] == 1472.98
    assert se["total"] == 7771.25
    assert se["deduction_half"] == 3885.62
    assert w["line_1_agi"] == 51114.38            # 55,000 − ½SE
    assert w["line_2a_deduction"] == 16100.0      # 2026 single standard (G)
    # QBI: min(20% × 47,228.76 QBI, 20% × 35,014.38 TI-before) = 7,002.88
    assert w["line_2b_qbi"]["deduction"] == 7002.88
    assert w["line_3_taxable_income"] == 28011.5
    # 2026 single schedule: 1,240 + 12% × 15,611.50 = 3,113.38
    assert w["line_4_income_tax"] == 3113.38
    assert r["projected_total_tax"] == 10884.63
    assert r["safe_harbor"]["current_year_target"] == 9796.17
    assert r["safe_harbor"]["prior_year_target"] == 9200.0
    assert r["safe_harbor"]["selected_path"] == "prior_year"   # (J)
    assert r["payment_required"] is True
    assert r["installments"]["required_through_next"] == 6900.0   # 75% of 9,200
    assert r["installments"]["remaining_next_payment"] == 6900.0


# ── B — W-2 wages consume part of the SS wage base ──────────────────────────
def test_b_w2_ss_interaction():
    se = fe.compute_se_tax(120000.0, 0.0, 100000.0, C)
    assert se["ss_wage_base_remaining"] == 84500.0     # 184,500 − 100,000
    assert se["net_earnings"] == 110820.0              # 120,000 × .9235
    assert se["ss_taxable"] == 84500.0                 # capped by remaining base
    assert se["social_security"] == round(84500.0 * 0.124, 2)
    assert se["medicare"] == round(110820.0 * 0.029, 2)  # Medicare uncapped


# ── C — W-2 wages above the wage base: SS portion zero, Medicare stays ──────
def test_c_w2_above_wage_base():
    se = fe.compute_se_tax(80000.0, 0.0, 190000.0, C)
    assert se["ss_wage_base_remaining"] == 0.0
    assert se["social_security"] == 0.0
    assert se["medicare"] == round(80000.0 * 0.9235 * 0.029, 2)
    assert se["total"] == se["medicare"]


# ── D — married filing jointly: spouse wages, MFJ deduction/brackets ────────
def test_d_married_filing_jointly():
    fed = _fed(filing_status="married_filing_jointly", spouse_wages=40000.0)
    r = _estimate(profit=55000.0, fed=fed, status="married_filing_jointly")
    w = r["worksheet"]
    assert w["income_components"]["spouse_wages"] == 40000.0
    assert w["line_2a_deduction"] == 32200.0           # 2026 MFJ standard
    assert w["line_1_agi"] == 91114.38                 # 55,000 + 40,000 − ½SE
    # MFJ schedule: 2,480 + 12% over 24,800
    ti = w["line_3_taxable_income"]
    assert w["line_4_income_tax"] == round(2480.0 + (ti - 24800.0) * 0.12, 2)


# ── E — head of household ───────────────────────────────────────────────────
def test_e_head_of_household():
    r = _estimate(profit=55000.0, fed=_fed(filing_status="head_of_household"),
                  status="head_of_household")
    w = r["worksheet"]
    assert w["line_2a_deduction"] == 24150.0
    ti = w["line_3_taxable_income"]
    assert w["line_4_income_tax"] == round(1770.0 + (ti - 17700.0) * 0.12, 2)


# ── F — itemized deduction path uses the entered amount ─────────────────────
def test_f_itemized():
    fed = _fed(deduction_method="itemized", itemized_deduction_amount=21000.0)
    r = _estimate(profit=55000.0, fed=fed)
    assert r["worksheet"]["line_2a_deduction"] == 21000.0
    assert "itemized" in r["worksheet"]["deduction_source"]


# ── H — QBI ordinary case + 2026 minimum QBID ───────────────────────────────
def test_h_qbi_supported():
    # Limit path (A asserts it); 20%-of-QBI path with big deduction room:
    q = fe.compute_qbi(50000.0, 0.0, 3532.4, 0.0, 0.0, 200000.0, "married_filing_jointly", C)
    assert q["deduction"] == round((50000.0 - 3532.4) * 0.20, 2)  # 20% × QBI
    # Minimum QBID: tiny profit ≥ $1,000 → floor $400 (new 2026 rule)
    q2 = fe.compute_qbi(1500.0, 0.0, 106.0, 0.0, 0.0, 30000.0, "single", C)
    assert q2["deduction"] == 400.0 and q2["minimum_applied"] is True
    # Under $1,000 of QBI: no minimum floor
    q3 = fe.compute_qbi(800.0, 0.0, 56.5, 0.0, 0.0, 30000.0, "single", C)
    assert q3["deduction"] == round((800.0 - 56.5) * 0.20, 2)


# ── I — QBI advanced case → CPA review, never a fabricated number ───────────
def test_i_qbi_advanced_cpa_gate():
    flags = fe.federal_cpa_flags(
        filing_status="single", federal=_fed(),
        projected_agi_hint=260000.0, taxable_before_qbi=245000.0, constants=C)
    assert any("advanced QBI" in f for f in flags)


# ── K — current-year 90% path when prior year is higher ─────────────────────
def test_k_current_year_lower():
    r = _estimate(profit=55000.0, fed=_fed(prior_year_total_tax=12000.0))
    assert r["safe_harbor"]["selected_path"] == "current_year"
    assert r["safe_harbor"]["required_annual_payment"] == r["safe_harbor"]["current_year_target"]


# ── L — OFFICIAL Pub 505 (2026) p.24 higher-income example ──────────────────
def test_l_official_110_percent_example():
    # Projected 2026 tax pinned to $71,253 via the other-taxes lump.
    fed = _fed(prior_year_agi=180000.0, prior_year_total_tax=42581.0,
               other_expected_federal_taxes=71253.0)
    r = _estimate(profit=0.0, fed=fed)
    assert r["projected_total_tax"] == 71253.0
    sh = r["safe_harbor"]
    assert sh["current_year_target"] == 64127.7        # IRS prints $64,128
    assert sh["prior_year_target"] == 46839.1          # IRS prints $46,839 (110%)
    assert sh["high_income_110_applied"] is True
    assert sh["selected_path"] == "prior_year"
    assert sh["required_annual_payment"] == 46839.1


# ── M — prior-year return under 12 months invalidates that path ─────────────
def test_m_prior_year_not_12_months():
    r = _estimate(profit=55000.0, fed=_fed(prior_year_full_12_months=False,
                                           prior_year_total_tax=100.0))
    assert r["safe_harbor"]["prior_year_target"] is None
    assert r["safe_harbor"]["selected_path"] == "current_year"


# ── N — under the $1,000 general requirement ────────────────────────────────
def test_n_under_1000_threshold():
    # 14a must stay positive (4,500 RAP − 4,200 WH = 300) so the $1,000
    # 14b stop is what fires: owed after withholding = 800 < 1,000.
    fed = _fed(prior_year_full_12_months=False, other_expected_federal_taxes=5000.0,
               withholding_ytd=3000.0, withholding_expected_remaining=1200.0)
    r = _estimate(profit=0.0, fed=fed)
    assert r["projected_total_tax"] == 5000.0
    assert r["worksheet"]["line_14a"] == 300.0
    assert r["worksheet"]["line_14b_owed_after_withholding"] == 800.0
    assert r["payment_required"] is False
    assert "$1,000" in r["no_payment_reason"]
    assert r["installments"]["remaining_next_payment"] == 0.0


# ── O — withholding covers the required annual payment ──────────────────────
def test_o_withholding_covers():
    fed = _fed(withholding_ytd=6000.0, withholding_expected_remaining=4000.0)
    r = _estimate(profit=55000.0, fed=fed)     # RAP 9,200 < 10,000 withholding
    assert r["worksheet"]["line_14a"] <= 0
    assert r["payment_required"] is False
    assert "cover" in r["no_payment_reason"].lower()


# ── R — prior-year overpayment credited exactly once ────────────────────────
def test_r_prior_year_overpayment():
    fed = _fed(prior_year_overpayment_applied=2000.0)
    r = _estimate(profit=55000.0, fed=fed)
    inst = r["installments"]
    assert inst["prior_year_overpayment_applied"] == 2000.0
    assert inst["credited_total"] == 2000.0
    assert inst["remaining_next_payment"] == round(6900.0 - 2000.0, 2)


# ── S — OFFICIAL Pub 505 (2026) p.25 regular-installment example ────────────
def test_s_official_installment_example():
    # Annual requirement $4,100, $900 already paid, third period → 75%.
    fed = _fed(prior_year_full_12_months=False,
               other_expected_federal_taxes=4100.0 / 0.9)  # 90% → 4,100
    r = _estimate(profit=0.0, fed=fed, payments=900.0)
    assert r["safe_harbor"]["required_annual_payment"] == 4100.0
    inst = r["installments"]
    assert inst["required_through_next"] == 3075.0     # 75% × 4,100
    assert inst["remaining_next_payment"] == 2175.0    # 3,075 − 900 (official)
    assert inst["prior_installment_underpaid"] is True # only $900 vs $2,050 due
    assert "underpayment" in inst["underpayment_note"].lower()


# ── T — overpaid/ahead: no negative due ─────────────────────────────────────
def test_t_overpaid_ahead():
    r = _estimate(profit=55000.0, payments=8000.0)
    inst = r["installments"]
    assert inst["remaining_next_payment"] == 0.0
    assert inst["ahead_by"] == round(8000.0 - 6900.0, 2)


# ── Additional Medicare (Form 8959 mechanics) ───────────────────────────────
def test_additional_medicare():
    # Single, wages 190k + SE net earnings 50k: wages excess 0 vs 200k? No —
    # threshold 200k; wages 190k → SE threshold 10k → SE excess 40k → 0.9%.
    m = fe.compute_additional_medicare(190000.0, 50000.0, "single", C)
    assert m["wages_excess"] == 0.0
    assert m["se_excess"] == 40000.0
    assert m["tax"] == 360.0
    # MFS threshold 125k, wages 130k → wages excess 5k; SE threshold 0.
    m2 = fe.compute_additional_medicare(130000.0, 10000.0, "married_filing_separately", C)
    assert m2["wages_excess"] == 5000.0 and m2["se_excess"] == 10000.0
    assert m2["tax"] == 135.0
    # Flows into line 10 of the worksheet:
    fed = _fed(w2_wages=190000.0, w2_ss_wages=190000.0)
    r = _estimate(profit=60000.0, fed=fed)
    assert r["worksheet"]["line_10_other_taxes"]["additional_medicare"]["tax"] > 0


# ── SE $400 threshold + negative profit never yields negative tax ───────────
def test_se_threshold_and_floor():
    se = fe.compute_se_tax(400.0, 0.0, 0.0, C)   # 400 × .9235 = 369.40 < 400
    assert se["below_threshold"] is True and se["total"] == 0.0
    r = _estimate(profit=-5000.0, fed=_fed(prior_year_full_12_months=False))
    assert r["worksheet"]["line_3_taxable_income"] == 0.0
    assert r["worksheet"]["line_4_income_tax"] == 0.0
    assert r["projected_total_tax"] == 0.0
    assert r["payment_required"] is False


# ── U — deadline boundary regressions (4D-2A behavior unchanged) ────────────
def test_u_deadline_regressions():
    assert server._next_federal_es_deadline(date(2026, 6, 20))["due"] == "2026-09-15"
    assert server._next_federal_es_deadline(date(2026, 9, 16))["due"] == "2027-01-15"
    nd = server._next_federal_es_deadline(date(2027, 1, 5))
    assert nd["tax_year"] == 2026 and nd["quarter"] == 4


# ═══════════════ Endpoint-level tests ═══════════════

def _complete_profile(**fed_over):
    run(server.put_tax_profile(YEAR, server.TaxProfilePatchIn(
        federal=_fed(**fed_over), projection={"remaining_business_profit": 0.0}), ADMIN))


def _endpoint():
    return run(server.federal_estimated_tax_endpoint(year=YEAR, _=ADMIN))


# ── X — unset material field blocks calculation ─────────────────────────────
def test_x_incomplete_blocks():
    fed = _fed()
    fed.pop("other_taxable_income")           # leave UNKNOWN
    run(server.put_tax_profile(YEAR, server.TaxProfilePatchIn(
        federal=fed, projection={"remaining_business_profit": 0.0}), ADMIN))
    r = _endpoint()
    assert r["status"] == "PROFILE_INCOMPLETE"
    assert "estimate" not in r
    assert any("Other expected taxable income" in m for m in r["missing_fields"])
    # Unconfirmed projection also blocks:
    run(server.db.tax_profiles.update_one(
        {"tax_year": YEAR}, {"$set": {"projection.remaining_business_profit": None}}))
    r2 = _endpoint()
    assert r2["status"] == "PROFILE_INCOMPLETE"
    assert any("remaining-year" in m for m in r2["missing_fields"])


# ── Y — explicit zeros make it READY; projection math is ytd + remaining ────
def test_y_explicit_zero_ready():
    _complete_profile()
    r = _endpoint()
    assert r["status"] == "READY"
    bp = r["business_projection"]
    assert bp["projected_remaining_business_profit"] == 0.0
    assert bp["projected_annual_business_profit"] == bp["actual_ytd_business_profit"]
    assert bp["projection_confirmed_at"] is not None
    assert "SUGGESTION" in bp["run_rate_note"]
    assert r["estimate"]["projected_total_tax"] >= 0


# ── Z — unsupported complex case → CPA_REVIEW_REQUIRED, no payment number ───
def test_z_cpa_review_gate():
    _complete_profile(expects_qualified_investment_income=True)
    r = _endpoint()
    assert r["status"] == "CPA_REVIEW_REQUIRED"
    assert any("capital-gain" in reason or "capital gains" in reason
               for reason in r["cpa_review_reasons"])
    assert r["estimate"]["installments"]["remaining_next_payment"] is None
    assert r["estimate"]["payment_required"] is None


# ── P/Q — only FEDERAL payments reduce the federal target ───────────────────
def test_pq_payment_jurisdiction_isolation():
    _complete_profile()
    before = _endpoint()
    assert before["status"] == "READY"
    c0 = before["estimate"]["installments"]["credited_total"]
    run(server.record_estimated_tax_payment(server.EstimatedTaxPaymentIn(
        tax_year=YEAR, jurisdiction="ohio", period=1, amount=999.0,
        payment_date="2026-04-10", memo=TAG), ADMIN))
    mid = _endpoint()
    assert mid["estimate"]["installments"]["credited_total"] == c0   # Ohio ignored (Q)
    run(server.record_estimated_tax_payment(server.EstimatedTaxPaymentIn(
        tax_year=YEAR, jurisdiction="federal", period=1, amount=500.0,
        payment_date="2026-04-10", memo=TAG), ADMIN))
    after = _endpoint()
    assert after["estimate"]["installments"]["credited_total"] == round(c0 + 500.0, 2)  # (P)
    # Voiding restores:
    pid = after["federal_payments"][0]["id"]
    run(server.void_estimated_tax_payment(pid, server.EstimatedTaxPaymentVoidIn(
        reason=f"{TAG} undo"), ADMIN))
    assert _endpoint()["estimate"]["installments"]["credited_total"] == c0


# ── V/W — canonical business income flows in (service + signed refunds) ─────
def test_vw_business_income_regression():
    _complete_profile()
    ytd0 = _endpoint()["business_projection"]["actual_ytd_business_profit"]
    today = server.business_today().isoformat()
    run(server.db.retail_sales.insert_one({
        "id": str(uuid.uuid4()), "date": today, "amount": 100.0,
        "description": f"{TAG} daycare service", "created_at": server.now_iso()}))
    r = _endpoint()
    assert r["business_projection"]["actual_ytd_business_profit"] == round(ytd0 + 100.0, 2)  # (V)
    run(server.db.retail_sales.insert_one({
        "id": str(uuid.uuid4()), "date": today, "amount": -100.0, "source_kind": "refund",
        "description": f"{TAG} refund", "created_at": server.now_iso()}))
    r2 = _endpoint()
    assert r2["business_projection"]["actual_ytd_business_profit"] == ytd0  # (W)


# ── Engine unavailable for unverified years ─────────────────────────────────
def test_engine_unavailable_year():
    r = run(server.federal_estimated_tax_endpoint(year=2001, _=ADMIN))
    assert r["status"] == "ENGINE_UNAVAILABLE"
    assert "estimate" not in r


# ── Front Desk 403 on the new endpoint ──────────────────────────────────────
def test_front_desk_403():
    uid = str(uuid.uuid4())
    email = f"{TAG.lower()}-fd-{uuid.uuid4().hex[:6]}@example.com"
    run(server.db.users.insert_one({
        "id": uid, "email": email, "name": TAG, "role": "employee", "staff_role": "front_desk",
        "password_hash": "x", "active": True, "must_change_password": False, "needs_password": False}))
    headers = {"Authorization": f"Bearer {server.create_access_token(uid, email, 'employee', 0)}"}
    r = run(_http.get(f"/api/admin/federal-estimated-tax?year={YEAR}", headers=headers))
    assert r.status_code == 403
    assert "projected" not in r.text and "safe_harbor" not in r.text
