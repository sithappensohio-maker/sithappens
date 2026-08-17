"""Step 4D-2A — Tax Profile foundation + honesty gate tests (A–T).

Covers: confirmed entity classification, backend-authoritative profile
completeness with explicit unset-vs-zero semantics, jurisdiction-split
append-only estimated-payment ledger with the legacy combined rows
quarantined as unassigned, corrected federal payment-period navigation
(June/September/January boundaries + weekend/holiday shifts), and the
honesty-gate relabeling (no "tax due" claims from the legacy flat-rate
reserve in the API payload, CPA PDF, or mileage summary).

Harness conventions as ever (direct async calls on the disposable DB,
ASGI transport for permission gates). Disposable tag TEST_TAXPROF.
"""
import uuid
from datetime import date

import _test_env  # noqa: F401 — must run before `import server`, see its docstring
import httpx
import pytest
import server
from _test_loop import run

TAG = "TEST_TAXPROF"
ADMIN = {"id": "taxprof-admin", "name": "TaxProf QA", "email": "taxprof@test", "role": "admin"}
YEAR = 2026

_http = httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app), base_url="http://test")


@pytest.fixture(autouse=True)
def _clean_profile_state():
    yield
    run(server.db.tax_profiles.delete_many({"tax_year": {"$in": [YEAR, YEAR + 1]}}))
    run(server.db.estimated_tax_payments.delete_many({"memo": TAG}))
    run(server.db.estimated_tax_payments.delete_many({"reference": {"$regex": TAG}}))
    run(server.db.tax_payments.delete_many({"memo": TAG}))


def _get_profile(year=YEAR):
    return run(server.get_tax_profile(year=year, _=ADMIN))


def _patch(body, year=YEAR):
    return run(server.put_tax_profile(year, server.TaxProfilePatchIn(**body), ADMIN))


def _pay(**over):
    body = {"tax_year": YEAR, "jurisdiction": "federal", "period": 1, "amount": 100.0,
            "payment_date": "2026-04-10", "method": "EFTPS", "memo": TAG}
    body.update(over)
    return run(server.record_estimated_tax_payment(server.EstimatedTaxPaymentIn(**body), ADMIN))


def _payments(year=YEAR):
    return run(server.list_estimated_tax_payments(year=year, _=ADMIN))


# ── A — confirmed entity classification ─────────────────────────────────────
def test_a_confirmed_entity():
    p = _get_profile()["profile"]
    e = p["entity"]
    assert e["entity_type"] == "single_member_llc"
    assert e["federal_tax_treatment"] == "disregarded_entity_schedule_c"
    assert e["entity_label"] == "Single-Member LLC"
    assert e["treatment_label"] == "Disregarded Entity / Schedule C"
    assert e["confirmed"] is True


# ── B — no S-corp / C-corp / partnership path ───────────────────────────────
def test_b_no_corporate_paths():
    e = _get_profile()["profile"]["entity"]
    assert e["s_corp_election"] is False
    assert e["c_corp_election"] is False
    assert e["partnership"] is False
    # entity is NOT editable through the patch endpoint
    r = _patch({"federal": {"filing_status": "single"}})
    assert r["profile"]["entity"]["entity_type"] == "single_member_llc"
    # and TaxProfilePatchIn has no entity field at all
    assert "entity" not in server.TaxProfilePatchIn.model_fields


# ── C — empty profile: neither jurisdiction ready, no amounts exposed ───────
def test_c_profile_missing_not_ready():
    # Step 4D-2B contract update: the FEDERAL engine now EXISTS for 2026
    # (engine "available") but an empty profile is still not ready; Ohio
    # stays gated until 4D-2C.
    c = _get_profile()["completeness"]
    for j in ("federal", "ohio"):
        assert c[j]["fields_complete"] is False
        assert c[j]["ready_for_calculation"] is False
        assert len(c[j]["missing_fields"]) >= 3
    assert c["federal"]["engine"] == "available"
    assert c["ohio"]["engine"] == "not_yet_available"
    # legacy reserve payload is explicitly marked non-authoritative
    r = run(server.admin_quarterly_tax(_=ADMIN, year=YEAR))
    assert r["legacy_reserve"] is True
    assert "planning reserve" in r["disclaimer"].lower()
    assert "not" in r["disclaimer"].lower()


# ── D — explicit zero is PROVIDED, not missing ──────────────────────────────
def test_d_explicit_zero_counts_as_provided():
    _patch({"federal": {"withholding_ytd": 0, "withholding_expected_remaining": 0}})
    c = _get_profile()["completeness"]["federal"]
    labels = " | ".join(c["missing_fields"])
    assert "withholding so far" not in labels
    assert "additional federal withholding" not in labels
    p = _get_profile()["profile"]["federal"]
    assert p["withholding_ytd"] == 0.0            # stored as confirmed zero
    assert p["prior_year_agi"] is None            # untouched fields stay unset


# ── E — missing prior-year tax is named exactly ─────────────────────────────
def test_e_missing_field_named():
    # Step 4D-2B contract update: the material-input list grew (every
    # worksheet input must be provided or confirmed zero). This test now
    # fills EVERYTHING except prior-year total tax, and checks the missing
    # list names exactly that field — then completing it flips readiness
    # to TRUE (the engine exists now).
    full = {"filing_status": "married_filing_jointly", "prior_year_agi": 80000,
            "prior_year_full_12_months": True, "prior_year_overpayment_applied": 0,
            "withholding_ytd": 0, "withholding_expected_remaining": 0,
            "w2_wages": 0, "w2_ss_wages": 0, "spouse_wages": 0,
            "other_taxable_income": 0, "other_se_income": 0,
            "credits_estimate": 0, "refundable_credits_estimate": 0,
            "se_health_insurance": 0, "retirement_hsa_adjustments": 0,
            "other_adjustments": 0, "other_expected_federal_taxes": 0,
            "deduction_method": "standard",
            "nonitemizer_charitable_contributions": 0, "schedule_1a_deductions": 0,
            "expects_qualified_investment_income": False, "unusual_tax_situation": False}
    _patch({"federal": full, "projection": {"remaining_business_profit": 0}})
    c = _get_profile()["completeness"]["federal"]
    assert c["fields_complete"] is False
    assert c["missing_fields"] == ["Prior-year federal total tax (for safe-harbor comparison)"]
    _patch({"federal": {"prior_year_total_tax": 9500}})
    c2 = _get_profile()["completeness"]["federal"]
    assert c2["fields_complete"] is True
    assert c2["ready_for_calculation"] is True    # 4D-2B: engine available


# ── F — withholding jurisdictions never mix ─────────────────────────────────
def test_f_withholding_jurisdictions_separate():
    _patch({"federal": {"withholding_ytd": 1000},
            "ohio": {"withholding_ytd": 200},
            "school_district": {"withholding_ytd": 50}})
    p = _get_profile()["profile"]
    assert p["federal"]["withholding_ytd"] == 1000.0
    assert p["ohio"]["withholding_ytd"] == 200.0
    assert p["school_district"]["withholding_ytd"] == 50.0
    # Ohio completeness unaffected by the federal value
    c = _get_profile()["completeness"]["ohio"]
    assert "Ohio withholding so far" not in " | ".join(c["missing_fields"])


# ── G — payment jurisdictions never cross ───────────────────────────────────
def test_g_payment_jurisdictions_separate():
    _pay(jurisdiction="federal", amount=500.0, reference=f"{TAG}-F1")
    _pay(jurisdiction="ohio", amount=200.0, reference=f"{TAG}-O1")
    _pay(jurisdiction="ohio_school_district", amount=75.0, reference=f"{TAG}-S1")
    out = _payments()
    assert out["jurisdictions"]["federal"]["total"] == 500.0
    assert out["jurisdictions"]["ohio"]["total"] == 200.0
    assert out["jurisdictions"]["ohio_school_district"]["total"] == 75.0
    fed_refs = [p["reference"] for p in out["jurisdictions"]["federal"]["payments"]]
    assert f"{TAG}-O1" not in fed_refs and f"{TAG}-S1" not in fed_refs


# ── H — legacy combined rows stay unassigned, reduce nothing ────────────────
def test_h_legacy_rows_unassigned():
    run(server.db.tax_payments.insert_one({
        "id": str(uuid.uuid4()), "year": YEAR, "quarter": 1, "amount": 500.0,
        "payment_date": "2026-04-01", "payment_method": "EFTPS", "memo": TAG,
        "created_at": server.now_iso()}))
    out = _payments()
    legacy = out["legacy_unassigned"]
    assert legacy["total"] == 500.0
    assert legacy["payments"][0]["jurisdiction"] == "legacy_unassigned"
    assert "not counted" in legacy["note"].lower()
    for j in server.ESTIMATED_TAX_JURISDICTIONS:
        assert out["jurisdictions"][j]["total"] == 0.0  # nothing silently reduced


# ── I — append-only history: second payment adds, void never deletes ────────
def test_i_append_only():
    p1 = _pay(amount=300.0, reference=f"{TAG}-A")
    p2 = _pay(amount=200.0, payment_date="2026-06-01", period=2, reference=f"{TAG}-B")
    out = _payments()
    fed = out["jurisdictions"]["federal"]
    assert len(fed["payments"]) == 2 and fed["total"] == 500.0
    voided = run(server.void_estimated_tax_payment(
        p1["id"], server.EstimatedTaxPaymentVoidIn(reason=f"{TAG} typo"), ADMIN))
    assert voided["voided"] is True and voided["void_reason"] == f"{TAG} typo"
    out2 = _payments()
    fed2 = out2["jurisdictions"]["federal"]
    assert len(fed2["payments"]) == 2            # row still visible
    assert fed2["total"] == 200.0                # but excluded from the total
    with pytest.raises(server.HTTPException) as e:
        run(server.void_estimated_tax_payment(
            p1["id"], server.EstimatedTaxPaymentVoidIn(reason="again"), ADMIN))
    assert e.value.status_code == 409
    assert p2["id"] != p1["id"]


# ── J — duplicate payment prevention (4C discipline) ────────────────────────
def test_j_duplicate_prevention():
    _pay(amount=250.0, reference=f"{TAG}-DUP")
    with pytest.raises(server.HTTPException) as e:
        _pay(amount=250.0, reference=f"{TAG}-DUP")
    assert e.value.status_code == 409
    ok = _pay(amount=250.0, reference=f"{TAG}-DUP", allow_duplicate=True)
    assert ok["id"]
    assert _payments()["jurisdictions"]["federal"]["total"] == 500.0


# ── K — federal periods are Pub 505 periods, not calendar quarters ──────────
def test_k_official_periods():
    qs = server._quarter_due_dates(2026)
    assert [q["period_start"] for q in qs] == ["2026-01-01", "2026-04-01", "2026-06-01", "2026-09-01"]
    assert [q["period_end"] for q in qs] == ["2026-03-31", "2026-05-31", "2026-08-31", "2026-12-31"]
    assert [q["due"] for q in qs] == ["2026-04-15", "2026-06-15", "2026-09-15", "2027-01-15"]
    # April and May belong to period 2; June belongs to period 3 (NOT calendar Q2)
    assert server._federal_es_period_for(date(2026, 5, 20))["quarter"] == 2
    assert server._federal_es_period_for(date(2026, 6, 20))["quarter"] == 3
    assert server._federal_es_period_for(date(2026, 9, 20))["quarter"] == 4


# ── L — June 16–30: passed June 15 is never DUE NEXT ────────────────────────
def test_l_june_boundary():
    nd = server._next_federal_es_deadline(date(2026, 6, 20))
    assert nd["due"] == "2026-09-15" and nd["quarter"] == 3
    nd2 = server._next_federal_es_deadline(date(2026, 6, 15))
    assert nd2["due"] == "2026-06-15"  # ON the deadline it is still current


# ── M — September 16–30 ─────────────────────────────────────────────────────
def test_m_september_boundary():
    nd = server._next_federal_es_deadline(date(2026, 9, 16))
    assert nd["due"] == "2027-01-15" and nd["quarter"] == 4 and nd["tax_year"] == 2026


# ── N — January 1–15 belongs to the PRIOR year's 4th installment ────────────
def test_n_january_boundary():
    nd = server._next_federal_es_deadline(date(2027, 1, 5))
    assert nd["tax_year"] == 2026 and nd["quarter"] == 4 and nd["due"] == "2027-01-15"
    nd2 = server._next_federal_es_deadline(date(2027, 1, 16))
    assert nd2["tax_year"] == 2027 and nd2["quarter"] == 1
    # weekend/holiday shifts (verified IRS pattern): Apr 15 2028 is a Saturday,
    # Apr 17 is DC Emancipation Day observed → due Apr 18; Jan 15 2028 Saturday
    # + MLK Monday Jan 17 → due Jan 18.
    assert server._quarter_due_dates(2028)[0]["due"] == "2028-04-18"
    assert server._quarter_due_dates(2027)[3]["due"] == "2028-01-18"
    assert server._quarter_due_dates(2027)[3]["statutory_due"] == "2028-01-15"


# ── O — business revenue regression: service $100, tax $0, income $100 ──────
def test_o_business_revenue_regression():
    rid = str(uuid.uuid4())
    run(server.db.retail_sales.insert_one({
        "id": rid, "date": "2001-05-10", "amount": 100.0,
        "description": f"{TAG} service row", "created_at": "2001-05-10T10:00:00"}))
    try:
        r = run(server.admin_quarterly_tax(_=ADMIN, year=2001))
        assert r["income"]["gross"] >= 100.0
        assert r["net_profit"] >= 100.0
    finally:
        run(server.db.retail_sales.delete_many({"id": rid}))


# ── P — signed-reversal business income unchanged ───────────────────────────
def test_p_refund_regression():
    ids = []
    for amt, kind in ((100.0, None), (-100.0, "refund")):
        d = {"id": str(uuid.uuid4()), "date": "2001-06-10", "amount": amt,
             "description": f"{TAG} refund row", "created_at": "2001-06-10T10:00:00"}
        if kind:
            d["source_kind"] = kind
        ids.append(d["id"])
        run(server.db.retail_sales.insert_one(d))
    try:
        r = run(server.admin_quarterly_tax(_=ADMIN, year=2001))
        assert abs(r["income"]["gross"]) < 0.005  # +100 −100 nets to zero
    finally:
        run(server.db.retail_sales.delete_many({"id": {"$in": ids}}))


# ── Q — restricted Front Desk: 403 everywhere, no leakage ───────────────────
def test_q_front_desk_locked_out():
    uid = str(uuid.uuid4())
    email = f"{TAG.lower()}-fd-{uuid.uuid4().hex[:6]}@example.com"
    run(server.db.users.insert_one({
        "id": uid, "email": email, "name": TAG, "role": "employee", "staff_role": "front_desk",
        "password_hash": "x", "active": True, "must_change_password": False, "needs_password": False}))
    try:
        headers = {"Authorization": f"Bearer {server.create_access_token(uid, email, 'employee', 0)}"}
        for method, path, body in (
            ("GET", f"/api/admin/tax-profile?year={YEAR}", None),
            ("PUT", f"/api/admin/tax-profile/{YEAR}", {"federal": {"filing_status": "single"}}),
            ("GET", f"/api/admin/estimated-tax/payments?year={YEAR}", None),
            ("POST", "/api/admin/estimated-tax/payments",
             {"tax_year": YEAR, "jurisdiction": "federal", "period": 1, "amount": 1.0}),
            ("GET", f"/api/admin/quarterly-tax?year={YEAR}", None),
        ):
            r = run(_http.request(method, path, json=body, headers=headers))
            assert r.status_code == 403, (method, path, r.status_code)
            assert "prior_year" not in r.text and "withholding" not in r.text
    finally:
        run(server.db.users.delete_many({"id": uid}))


# ── R — tax-year separation: 2026 values never leak into 2027 ───────────────
def test_r_tax_year_separation():
    _patch({"federal": {"prior_year_agi": 88000, "prior_year_total_tax": 9100}})
    nxt = _get_profile(year=YEAR + 1)["profile"]
    assert nxt["federal"]["prior_year_agi"] is None
    assert nxt["federal"]["prior_year_total_tax"] is None
    assert nxt["entity"]["entity_type"] == "single_member_llc"  # classification constant
    # audit trail exists on the edited year
    cur = _get_profile()["profile"]
    assert any(a["action"] == "profile_updated" and "prior_year_agi" in a["detail"]
               for a in cur["audit_log"])
    assert cur["updated_by"] == ADMIN["id"]


# ── S — CPA/export wording: no unsupported "tax due" claims ─────────────────
def test_s_cpa_wording():
    src = open("cpa_report.py", encoding="utf-8").read()
    assert "EST. BALANCE OWED" not in src
    assert "BALANCE STILL OWED" not in src
    assert "TOTAL ESTIMATED TAX (YTD)" not in src
    assert "PLANNING RESERVE" in src
    assert "NOT a federal or Ohio estimated-tax payment calculation" in src
    # API payload equally honest
    r = run(server.admin_quarterly_tax(_=ADMIN, year=YEAR))
    assert r["legacy_reserve"] is True


# ── T — mileage: deduction stays, fabricated "tax savings" gone ─────────────
def test_t_mileage_no_savings_claim():
    m = run(server.mileage_summary(year=YEAR, _=ADMIN))
    assert "ytd_deduction" in m and "rate_per_mile" in m
    assert "ytd_tax_savings" not in m
    assert "combined_tax_rate_pct" not in m
