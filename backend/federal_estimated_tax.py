"""Step 4D-2B — 2026 Federal Estimated Tax engine (pure functions, no I/O).

Structured around the official 2026 Form 1040-ES Estimated Tax Worksheet
(lines 1–15) and its Self-Employment Tax and Deduction Worksheet, with
Pub 505 (2026) ch. 2 for the regular installment method. Supported path:
the confirmed Sit Happens profile — single-member LLC, disregarded
entity, Schedule C / Schedule SE, one of the five 2026 filing statuses.

Honesty contract:
  * unset (None) profile values are UNKNOWN — the engine refuses to run;
  * unsupported situations return CPA_REVIEW_REQUIRED with exact reasons,
    never a fabricated number;
  * projected tax vs. safe-harbor target vs. next-installment amount are
    distinct outputs, never merged;
  * NOT calculated (and said so in `not_calculated`): AMT, NIIT, the
    qualified dividends/capital-gain worksheet, and the annualized-income
    installment method.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional


def _r2(v: float) -> float:
    return round(float(v or 0), 2)


def compute_bracket_tax(taxable_income: float, brackets: List) -> Dict[str, Any]:
    """Progressive tax from a 2026 Tax Rate Schedule. Returns per-bracket
    detail so the UI can show exactly how the number was built."""
    ti = max(0.0, float(taxable_income))
    tax = 0.0
    lower = 0.0
    detail = []
    for upper, rate in brackets:
        cap = ti if upper is None else min(ti, upper)
        if cap > lower:
            slice_amt = cap - lower
            tax += slice_amt * rate
            detail.append({"from": _r2(lower), "to": _r2(cap), "rate": rate,
                           "tax": _r2(slice_amt * rate)})
        if upper is None or ti <= upper:
            break
        lower = upper
    return {"taxable_income": _r2(ti), "tax": _r2(tax), "brackets": detail}


def compute_se_tax(business_profit: float, other_se_income: float,
                   w2_ss_wages: float, C: Dict[str, Any]) -> Dict[str, Any]:
    """2026 1040-ES Self-Employment Tax and Deduction Worksheet (p. 9).

    line 1a/2: expected Schedule C profit + other SE profit
    line 3:    × 92.35%  (below $400 → no SE tax, per Schedule SE)
    line 4:    Medicare 2.9% on all net earnings
    line 5-8:  Social Security 12.4% on the lesser of net earnings or the
               2026 wage base ($184,500) REDUCED by W-2 social security
               wages already expected
    line 10:   total SE tax;  line 11: deduction = 50%
    """
    total_se_profit = _r2(business_profit) + _r2(other_se_income)
    net_earnings = _r2(max(0.0, total_se_profit) * C["se_earnings_factor"])
    if net_earnings < C["se_min_net_earnings"]:
        return {"total_se_profit": _r2(total_se_profit), "net_earnings": net_earnings,
                "below_threshold": True, "ss_wage_base_remaining": _r2(C["ss_wage_base"]),
                "social_security": 0.0, "medicare": 0.0, "total": 0.0, "deduction_half": 0.0}
    medicare = _r2(net_earnings * C["se_medicare_rate"])
    base_remaining = max(0.0, C["ss_wage_base"] - max(0.0, _r2(w2_ss_wages)))
    ss_taxable = min(net_earnings, base_remaining)
    social_security = _r2(ss_taxable * C["se_ss_rate"])
    total = _r2(social_security + medicare)
    return {
        "total_se_profit": _r2(total_se_profit),
        "net_earnings": net_earnings,
        "below_threshold": False,
        "ss_wage_base_remaining": _r2(base_remaining),
        "ss_taxable": _r2(ss_taxable),
        "social_security": social_security,
        "medicare": medicare,
        "total": total,
        "deduction_half": _r2(total * 0.5),
    }


def compute_additional_medicare(medicare_wages: float, se_net_earnings: float,
                                filing_status: str, C: Dict[str, Any]) -> Dict[str, Any]:
    """Additional Medicare Tax per Form 8959 mechanics (Pub 505 ch. 1):
    0.9% on Medicare wages over the filing-status threshold, plus 0.9% on
    SE earnings over the threshold REDUCED (not below zero) by those wages."""
    thr = C["addl_medicare_thresholds"][filing_status]
    wages_excess = max(0.0, _r2(medicare_wages) - thr)
    se_threshold = max(0.0, thr - max(0.0, _r2(medicare_wages)))
    se_excess = max(0.0, _r2(se_net_earnings) - se_threshold)
    tax = _r2((wages_excess + se_excess) * C["addl_medicare_rate"])
    return {"threshold": thr, "wages_excess": _r2(wages_excess),
            "se_excess": _r2(se_excess), "tax": tax}


def compute_qbi(business_profit: float, other_se_income: float,
                se_deduction_half: float, se_health_insurance: float,
                retirement_adjustments: float, taxable_income_before_qbi: float,
                filing_status: str, C: Dict[str, Any]) -> Dict[str, Any]:
    """§199A QBI deduction, simplified-below-threshold path (Form 8995 as
    referenced by 1040-ES line 2b), incl. the new-for-2026 minimum QBID.

    QBI = qualified business income (Schedule C + other SE profit) reduced
    by the deductions ATTRIBUTABLE to it (½ SE tax, SE health insurance,
    self-employed retirement) — Form 8995 instructions. Deduction =
    lesser of 20% × QBI or 20% × (taxable income before QBI − net capital
    gain [zero here: qualified-gain profiles are CPA-gated upstream]),
    but never less than $400 when active-business QBI ≥ $1,000 (2026
    minimum QBID). Above the taxable-income threshold the wage/UBIA
    limitation applies, which this profile cannot support → CPA review
    (decided by the caller via `above_threshold`)."""
    qbi = _r2(max(0.0, _r2(business_profit) + _r2(other_se_income)
                  - _r2(se_deduction_half) - _r2(se_health_insurance)
                  - _r2(retirement_adjustments)))
    tib = max(0.0, _r2(taxable_income_before_qbi))
    threshold = C["qbi_taxable_income_threshold"][filing_status]
    above_threshold = tib > threshold
    twenty_qbi = _r2(qbi * C["qbi_rate"])
    limit = _r2(tib * C["qbi_rate"])
    deduction = min(twenty_qbi, limit)
    raw_business_qbi = _r2(max(0.0, _r2(business_profit) + _r2(other_se_income)))
    if raw_business_qbi >= C["qbi_minimum_qbi_required"]:
        deduction = max(deduction, C["qbi_minimum_deduction"])
    deduction = _r2(min(deduction, tib))  # never exceeds taxable income
    return {"qbi": qbi, "twenty_pct_qbi": twenty_qbi, "income_limit": limit,
            "threshold": threshold, "above_threshold": above_threshold,
            "minimum_applied": deduction == C["qbi_minimum_deduction"] and twenty_qbi < C["qbi_minimum_deduction"],
            "deduction": deduction}


def compute_federal_estimate(
    *,
    filing_status: str,
    annual_business_profit: float,
    federal: Dict[str, Any],
    constants: Dict[str, Any],
    next_deadline: Dict[str, Any],
    federal_payments_total: float,
    prior_installments_pcts_passed: int,
) -> Dict[str, Any]:
    """The 2026 Estimated Tax Worksheet, line by line. All profile inputs
    must already be non-None (readiness enforced by the caller)."""
    C = constants
    f = federal

    # ── SE tax worksheet ────────────────────────────────────────────────────
    se = compute_se_tax(annual_business_profit, f["other_se_income"], f["w2_ss_wages"], C)

    # ── Line 1 — expected AGI ───────────────────────────────────────────────
    wages = _r2(f["w2_wages"])
    spouse = _r2(f["spouse_wages"]) if filing_status == "married_filing_jointly" else 0.0
    income_total = _r2(annual_business_profit) + _r2(f["other_se_income"]) + wages + spouse + _r2(f["other_taxable_income"])
    adjustments = _r2(se["deduction_half"]) + _r2(f["se_health_insurance"]) + \
        _r2(f["retirement_hsa_adjustments"]) + _r2(f["other_adjustments"])
    agi = _r2(income_total - adjustments)

    # ── Line 2a — deductions ────────────────────────────────────────────────
    if f["deduction_method"] == "itemized":
        deduction = _r2(f["itemized_deduction_amount"])
        deduction_source = "itemized (owner-entered expected amount)"
    else:
        deduction = C["standard_deduction"][filing_status]
        deduction_source = f"standard deduction ({filing_status}, 2026)"

    taxable_before_qbi = max(0.0, _r2(agi - deduction))

    # ── Line 2b — QBI deduction ─────────────────────────────────────────────
    qbi = compute_qbi(annual_business_profit, f["other_se_income"], se["deduction_half"],
                      f["se_health_insurance"], f["retirement_hsa_adjustments"],
                      taxable_before_qbi, filing_status, C)

    # ── Line 3 — taxable income (never negative) ────────────────────────────
    taxable_income = max(0.0, _r2(taxable_before_qbi - qbi["deduction"]))

    # ── Line 4 — regular income tax (2026 Rate Schedules) ───────────────────
    bracket = compute_bracket_tax(taxable_income, C["brackets"][filing_status])
    income_tax = bracket["tax"]

    # ── Line 7/8 — nonrefundable credits (floor at zero) ────────────────────
    credits = _r2(f["credits_estimate"])
    after_credits = max(0.0, _r2(income_tax - credits))

    # ── Line 9 — SE tax; Line 10 — other taxes ──────────────────────────────
    addl_medicare = compute_additional_medicare(wages + spouse, se["net_earnings"],
                                               filing_status, C)
    other_taxes = _r2(f["other_expected_federal_taxes"]) + addl_medicare["tax"]

    # ── Line 11 — total, less refundable credits ────────────────────────────
    total_before_refundable = _r2(after_credits + se["total"] + other_taxes)
    refundable = _r2(f["refundable_credits_estimate"])
    projected_total_tax = max(0.0, _r2(total_before_refundable - refundable))

    # ── Line 12 — required annual payment / safe harbor ─────────────────────
    current_year_target = _r2(projected_total_tax * C["safe_harbor_current_year_pct"])
    prior_valid = bool(f["prior_year_full_12_months"])
    prior_year_target = None
    high_income = False
    if prior_valid:
        agi_threshold = (C["high_income_agi_threshold_mfs"]
                         if filing_status == "married_filing_separately"
                         else C["high_income_agi_threshold"])
        high_income = _r2(f["prior_year_agi"]) > agi_threshold
        pct = C["safe_harbor_high_income_pct"] if high_income else C["safe_harbor_prior_year_pct"]
        prior_year_target = _r2(_r2(f["prior_year_total_tax"]) * pct)
    if prior_year_target is not None and prior_year_target < current_year_target:
        required_annual_payment = prior_year_target
        selected_path = "prior_year"
    else:
        required_annual_payment = current_year_target
        selected_path = "current_year"

    # ── Line 13 — withholding ───────────────────────────────────────────────
    withholding = _r2(_r2(f["withholding_ytd"]) + _r2(f["withholding_expected_remaining"]))

    # ── Line 14a/14b — is an estimated payment required at all? ─────────────
    line_14a = _r2(required_annual_payment - withholding)
    line_14b_owed = _r2(projected_total_tax - withholding)
    payment_required = line_14a > 0 and line_14b_owed >= C["estimated_tax_threshold"]

    # ── Line 15 / Pub 505 regular installment method ────────────────────────
    # Withholding is treated as paid evenly across installments (Pub 505:
    # ¼ on each due date unless the taxpayer elects actual dates) — that is
    # exactly what subtracting it BEFORE the ÷4 achieves. Prior-year
    # overpayment applied is credited to the first required installment(s)
    # (Pub 505), i.e. it joins payments in the cumulative comparison.
    annual_after_withholding = max(0.0, line_14a)
    k = int(next_deadline["quarter"])
    cum_pct = C["installment_cumulative_pcts"][k - 1]
    required_through_next = _r2(annual_after_withholding * cum_pct) if payment_required else 0.0
    prior_overpayment = _r2(f["prior_year_overpayment_applied"])
    credited = _r2(prior_overpayment + _r2(federal_payments_total))
    remaining_next = max(0.0, _r2(required_through_next - credited)) if payment_required else 0.0
    ahead_by = max(0.0, _r2(credited - required_through_next)) if payment_required else _r2(credited)
    # Underpayment exposure on PASSED installments (informational only):
    prior_required = 0.0
    if payment_required and prior_installments_pcts_passed > 0:
        idx = min(prior_installments_pcts_passed, 4) - 1
        prior_required = _r2(annual_after_withholding * C["installment_cumulative_pcts"][idx])
    prior_underpaid = payment_required and credited + 0.005 < prior_required

    return {
        "worksheet": {
            "line_1_agi": agi,
            "income_components": {
                "business_profit": _r2(annual_business_profit),
                "other_se_income": _r2(f["other_se_income"]),
                "w2_wages": wages, "spouse_wages": spouse,
                "other_taxable_income": _r2(f["other_taxable_income"]),
                "total_income": _r2(income_total),
            },
            "adjustments": {
                "se_tax_deduction_half": se["deduction_half"],
                "se_health_insurance": _r2(f["se_health_insurance"]),
                "retirement_hsa": _r2(f["retirement_hsa_adjustments"]),
                "other": _r2(f["other_adjustments"]),
                "total": _r2(adjustments),
            },
            "line_2a_deduction": _r2(deduction),
            "deduction_source": deduction_source,
            "line_2b_qbi": qbi,
            "line_3_taxable_income": taxable_income,
            "line_4_income_tax": income_tax,
            "bracket_detail": bracket["brackets"],
            "line_7_credits": credits,
            "line_8_after_credits": after_credits,
            "line_9_se_tax": se,
            "line_10_other_taxes": {
                "owner_entered": _r2(f["other_expected_federal_taxes"]),
                "additional_medicare": addl_medicare,
                "total": other_taxes,
            },
            "line_11_refundable_credits": refundable,
            "line_11c_total_tax": projected_total_tax,
            "line_12a_current_year_pct": current_year_target,
            "line_12b_prior_year": prior_year_target,
            "line_12c_required_annual_payment": _r2(required_annual_payment),
            "line_13_withholding": withholding,
            "line_14a": line_14a,
            "line_14b_owed_after_withholding": line_14b_owed,
        },
        "projected_total_tax": projected_total_tax,
        "safe_harbor": {
            "current_year_target": current_year_target,
            "prior_year_target": prior_year_target,
            "prior_year_valid": prior_valid,
            "high_income_110_applied": high_income,
            "selected_path": selected_path,
            "required_annual_payment": _r2(required_annual_payment),
        },
        "payment_required": payment_required,
        "no_payment_reason": (None if payment_required else
                              ("Withholding is expected to cover the required annual payment"
                               if line_14a <= 0 else
                               "Expected amount owed after withholding is under the $1,000 general requirement")),
        "installments": {
            "method": "regular",
            "next_deadline": next_deadline,
            "required_through_next": required_through_next,
            "withholding_counted": withholding,
            "prior_year_overpayment_applied": prior_overpayment,
            "federal_payments_recorded": _r2(federal_payments_total),
            "credited_total": credited,
            "remaining_next_payment": remaining_next,
            "ahead_by": ahead_by,
            "prior_installment_underpaid": prior_underpaid,
            "underpayment_note": ("A prior-period underpayment may still be subject to IRS "
                                  "underpayment rules even after catching up."
                                  if prior_underpaid else None),
        },
        "not_calculated": [
            "Alternative Minimum Tax (AMT)",
            "Net Investment Income Tax (NIIT)",
            "Qualified dividends / capital-gain rate worksheet",
            "Annualized-income installment method (Schedule AI)",
        ],
        "seasonal_note": ("Income substantially uneven/seasonal? The annualized-income "
                          "method is not currently calculated; CPA review may reduce or "
                          "change installment timing."),
    }


def federal_cpa_flags(*, filing_status: str, federal: Dict[str, Any],
                      projected_agi_hint: Optional[float],
                      taxable_before_qbi: Optional[float],
                      constants: Dict[str, Any]) -> List[str]:
    """Deterministic unsupported-situation flags. Any flag → CPA_REVIEW_REQUIRED."""
    C = constants
    flags: List[str] = []
    if federal.get("expects_qualified_investment_income") is True:
        flags.append("Expected qualified dividends / net capital gains need the capital-gain "
                     "rate worksheet, which Sit Happens does not calculate.")
    if federal.get("unusual_tax_situation") is True:
        flags.append("Owner marked an unusual tax situation for this year.")
    if taxable_before_qbi is not None:
        thr = C["qbi_taxable_income_threshold"][filing_status]
        if taxable_before_qbi > thr:
            flags.append("Projected income requires the advanced QBI wage/property limitation "
                         "calculation, which Sit Happens does not support.")
    if (projected_agi_hint is not None
            and float(federal.get("other_taxable_income") or 0) > 0
            and projected_agi_hint > C["niit_magi_thresholds"][filing_status]):
        flags.append("Other income at this MAGI level may be subject to Net Investment Income "
                     "Tax, which Sit Happens does not calculate.")
    return flags
