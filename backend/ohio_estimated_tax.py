"""Step 4D-2C — 2026 Ohio + School-District Estimated Tax engine (pure).

Independent of federal TAX LAW and of the legacy flat reserve. It shares
only FACTS: the canonical projected annual Sit Happens business profit
and the household income/adjustment facts from the Tax Profile. Federal
AGI is the statutory STARTING POINT for Ohio AGI (R.C. 5747.01(A)), so
the caller passes the same federally-computed AGI the 1040-ES worksheet
produced — arithmetic on facts, not federal tax policy.

Structure (IT 1040 / IT BUS ordering, current statutes — corrected in
Step 4D-2C-1 against the verbatim R.C. text):
  MAGI = federal AGI + owner-entered Ohio adjustments (signed lump).
      The BID is itself an Ohio Schedule-of-Adjustments deduction, so
      OAGI = MAGI − BID and MAGI = OAGI + BID add-back (R.C. 5747.01(II))
      — the pre-BID figure IS modified AGI; nothing is added twice.
  Ohio business income = Schedule C profit + other SE income (both are
      business income under R.C. 5747.01(B); nothing is guessed)
  BID  = min(business income, $250,000 / $125,000 MFS)  (5747.01(A)(28))
  preliminary taxable business income = business income − BID
  exemptions = count × published tier amount by MAGI (zero at ≥ $500k)
  income tax base = max(0, OAGI − exemptions)            (IT 1040 line 5)
  taxable business income = min(preliminary, income tax base) — this IS
      R.C. 5747.02(A)(4)(b): exemptions exceeding OAGI-less-taxable-
      business-income spill over and reduce taxable business income
      before the 3% tax (never below zero) → × 3%
  taxable NONbusiness income = income tax base − taxable business income
      (i.e. OAGI less taxable business income less exemptions, per
      5747.02(A)(3)) → $0 at/below $26,050 else $332 + 2.75% of excess
  projected return tax = business tax + nonbusiness tax − $20 exemption
      credit (5747.022: only if MAGI − exemptions < $30,000) − owner-
      entered other Ohio credits (floor 0)
  ESTIMATED-TAX liability base = business tax + nonbusiness tax − other
      Ohio credits WITHOUT the 5747.022 credit — that credit "shall not
      be considered in determining … the estimated taxes required to be
      paid under section 5747.09" (5747.022, last sentence). The $500
      threshold, the 90% current-year target, and the current-year
      installment schedule all use THIS base; the prior-year path uses
      the owner-entered prior-year liabilities unchanged.
  SDIT: traditional = (MAGI − exemptions) × rate;
        earned income = (wages + spouse wages + SE net earnings ×.9235)
        × rate — NO exemptions, NO BID (R.C. 5748.01) — which is exactly
        why the BID can zero the STATE business tax while SDIT stays
        positive.
  Combined ESTIMATED-tax liability drives the $500 threshold
  (5747.09(B)) and the dual safe-harbor cumulative installments
  (22.5/45/67.5/90% current OR 25/50/75/100% prior; NO 110% rule).
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional


def _r2(v) -> float:
    return round(float(v or 0), 2)


def compute_ohio_state_tax(*, federal_agi: float, business_income: float,
                           filing_status: str, ohio_adjustments: float,
                           exemption_count: int, other_ohio_credits: float,
                           C: Dict[str, Any]) -> Dict[str, Any]:
    # Pre-BID income IS modified AGI: the BID is an Ohio Schedule-of-
    # Adjustments deduction, so OAGI = this − BID and 5747.01(II)'s
    # "OAGI + BID add-back" lands right back here. (4D-2C-1 fix — the
    # earlier engine added the BID a second time.)
    magi = _r2(federal_agi + _r2(ohio_adjustments))
    biz = max(0.0, _r2(business_income))
    bid_cap = C["bid_cap_mfs"] if filing_status == "married_filing_separately" else C["bid_cap"]
    bid_used = _r2(min(biz, bid_cap))
    oagi = _r2(magi - bid_used)                      # IT 1040 line 3 (may be < 0)
    prelim_taxable_business = _r2(biz - bid_used)

    if magi >= C["exemption_zero_magi"]:
        per_exemption = 0.0
    else:
        per_exemption = next(amt for bound, amt in C["exemption_tiers"]
                             if bound is None or magi <= bound)
    exemptions_total = _r2(max(0, int(exemption_count)) * per_exemption)

    # Income tax base (IT 1040 line 5) caps taxable business income:
    # equivalent to R.C. 5747.02(A)(4)(b) — exemptions left over after the
    # nonbusiness side spill into taxable business income, never below 0.
    taxable_income = max(0.0, _r2(oagi - exemptions_total))
    taxable_business = min(prelim_taxable_business, taxable_income)
    unused_exemption_reduction = _r2(prelim_taxable_business - taxable_business)
    business_tax = _r2(taxable_business * C["business_income_rate"])

    # Nonbusiness base per 5747.02(A)(3): OAGI − taxable business income −
    # exemptions (the taxable-business subtraction, NOT a second BID).
    taxable_nonbusiness = max(0.0, _r2(taxable_income - taxable_business))
    if taxable_nonbusiness <= C["nonbusiness_zero_bracket"]:
        nonbusiness_tax = 0.0
    else:
        nonbusiness_tax = _r2(C["nonbusiness_base_tax"]
                              + (taxable_nonbusiness - C["nonbusiness_zero_bracket"])
                              * C["nonbusiness_rate"])

    tax_before_credits = _r2(business_tax + nonbusiness_tax)
    # 5747.022: $20 × exemptions, only when MAGI − exemptions < $30,000.
    credit_income = _r2(magi - exemptions_total)
    exemption_credit = (_r2(max(0, int(exemption_count)) * C["exemption_credit_per"])
                        if credit_income < C["exemption_credit_income_limit"] else 0.0)
    other_credits = _r2(other_ohio_credits)
    # Estimated-tax liability base (5747.09 via 5747.022 last sentence):
    # the $20 credit is NOT considered; other return credits are.
    estimated_tax_liability = max(0.0, _r2(tax_before_credits - other_credits))
    state_tax = max(0.0, _r2(tax_before_credits - exemption_credit - other_credits))
    return {
        "magi": magi, "ohio_adjustments": _r2(ohio_adjustments),
        "oagi": oagi,
        "business_income": biz, "bid_cap": bid_cap, "bid_used": bid_used,
        "preliminary_taxable_business_income": prelim_taxable_business,
        "unused_exemptions_applied_to_business": unused_exemption_reduction,
        "taxable_business_income": taxable_business, "business_tax": business_tax,
        "exemption_count": int(exemption_count),
        "per_exemption": per_exemption, "exemptions_total": exemptions_total,
        "exemption_amounts_basis": C.get("exemption_amounts_basis"),
        "exemption_disallowed_high_magi": magi >= C["exemption_zero_magi"],
        "taxable_income": taxable_income,
        "taxable_nonbusiness_income": taxable_nonbusiness,
        "nonbusiness_tax": nonbusiness_tax,
        "tax_before_credits": tax_before_credits,
        "exemption_credit": exemption_credit,
        "other_ohio_credits": other_credits,
        "estimated_tax_liability": estimated_tax_liability,
        "state_tax": state_tax,
    }


def compute_sdit(*, applicable: str, base_type: Optional[str], rate_pct: Optional[float],
                 magi: float, exemptions_total: float,
                 w2_wages: float, spouse_wages: float,
                 se_profit_total: float, C: Dict[str, Any]) -> Dict[str, Any]:
    if applicable == "no":
        return {"applicable": False, "base_type": None, "rate_pct": 0.0,
                "taxable_base": 0.0, "tax": 0.0,
                "note": "Owner confirmed no school-district income tax."}
    rate = _r2(rate_pct) / 100.0
    if base_type == "earned_income":
        se_net = _r2(max(0.0, se_profit_total) * C["sd_se_earnings_factor"])
        base = _r2(max(0.0, _r2(w2_wages) + _r2(spouse_wages) + se_net))
        note = ("Earned-income base: wages + net earnings from self-employment "
                "(§1402(a)) — no exemptions, no Business Income Deduction.")
    else:
        base = max(0.0, _r2(magi - exemptions_total))
        note = ("Traditional base: Ohio MODIFIED AGI (which ADDS BACK the "
                "Business Income Deduction) less personal exemptions.")
    return {"applicable": True, "base_type": base_type, "rate_pct": _r2(rate_pct),
            "taxable_base": base, "tax": _r2(base * rate), "note": note}


def compute_ohio_estimate(
    *, filing_status: str, federal_agi: float, annual_business_profit: float,
    other_se_income: float, w2_wages: float, spouse_wages: float,
    ohio: Dict[str, Any], school_district: Dict[str, Any],
    constants: Dict[str, Any], next_deadline: Dict[str, Any],
    ohio_payments_total: float, sd_payments_total: float,
    prior_installments_passed: int,
) -> Dict[str, Any]:
    C = constants
    biz_total = _r2(annual_business_profit) + _r2(other_se_income)
    spouse = _r2(spouse_wages) if filing_status == "married_filing_jointly" else 0.0

    state = compute_ohio_state_tax(
        federal_agi=federal_agi, business_income=biz_total,
        filing_status=filing_status,
        ohio_adjustments=ohio["other_expected_ohio_adjustments"],
        exemption_count=int(ohio["exemption_count"]),
        other_ohio_credits=ohio["other_expected_ohio_credits"], C=C)

    sd = compute_sdit(
        applicable=school_district["applicable"],
        base_type=school_district.get("tax_base_type"),
        rate_pct=school_district.get("rate_pct"),
        magi=state["magi"], exemptions_total=state["exemptions_total"],
        w2_wages=_r2(w2_wages), spouse_wages=spouse,
        se_profit_total=biz_total, C=C)

    # Projected RETURN liability (5747.022 credit applied) vs the
    # ESTIMATED-TAX liability base (5747.022 credit excluded — that credit
    # "shall not be considered in determining … the estimated taxes
    # required to be paid under section 5747.09"). SDIT has no such
    # credit, so the school-district share is identical in both.
    combined = _r2(state["state_tax"] + sd["tax"])
    est_state = state["estimated_tax_liability"]
    combined_estimated = _r2(est_state + sd["tax"])

    # ── Withholding (Ohio + SD; NEVER federal) — default even allocation ────
    oh_wh = _r2(_r2(ohio["withholding_ytd"]) + _r2(ohio["withholding_expected_remaining"]))
    sd_wh = _r2(_r2(school_district.get("withholding_ytd")) +
                _r2(school_district.get("withholding_expected_remaining"))) if sd["applicable"] else 0.0
    withholding_total = _r2(oh_wh + sd_wh)

    # ── $500 threshold — R.C. 5747.09(B): MORE THAN $500 after withholding,
    #    measured on the ESTIMATED-TAX base (no 5747.022 credit) ───────────
    after_withholding = _r2(combined_estimated - withholding_total)
    payment_required = after_withholding > C["estimated_tax_threshold"]

    # ── Safe harbor — dual statutory paths, NO 110% rule ────────────────────
    current_target = _r2(combined_estimated * C["safe_harbor_current_year_pct"])
    prior_valid = bool(ohio["prior_year_full_12_months"])
    prior_state = _r2(ohio["prior_year_tax"])
    prior_sd = _r2(school_district.get("prior_year_tax")) if sd["applicable"] else 0.0
    prior_combined = _r2(prior_state + prior_sd) if prior_valid else None
    if prior_combined is not None and prior_combined < current_target:
        selected_path = "prior_year"
    else:
        selected_path = "current_year"

    # ── Cumulative installments — 5747.09(D): lesser of the two schedules
    #    (current-year leg on the ESTIMATED-TAX base; prior-year leg on the
    #    owner-entered prior liabilities, unchanged) ────────────────────────
    k = int(next_deadline["quarter"])
    def cum_required(idx: int) -> float:
        cur = _r2(combined_estimated * C["installment_current_year_pcts"][idx - 1])
        if prior_combined is None:
            return cur
        pri = _r2(prior_combined * C["installment_prior_year_pcts"][idx - 1])
        return min(cur, pri)
    required_through_next = cum_required(k) if payment_required else 0.0
    # Withholding credited evenly across installments (statutory default —
    # actual-date election is NOT supported and said so).
    wh_through_next = _r2(withholding_total * k / 4.0) if payment_required else 0.0
    overpayments = _r2(_r2(ohio["prior_year_overpayment_applied"]) +
                       (_r2(school_district.get("prior_year_overpayment_applied"))
                        if sd["applicable"] else 0.0))
    payments = _r2(_r2(ohio_payments_total) + _r2(sd_payments_total))
    credited = _r2(wh_through_next + overpayments + payments)
    remaining_next = max(0.0, _r2(required_through_next - credited)) if payment_required else 0.0
    ahead_by = max(0.0, _r2(credited - required_through_next)) if payment_required else 0.0
    prior_required = cum_required(min(prior_installments_passed, 4)) if (
        payment_required and prior_installments_passed > 0) else 0.0
    prior_wh = _r2(withholding_total * min(prior_installments_passed, 4) / 4.0)
    prior_underpaid = payment_required and (overpayments + payments + prior_wh) + 0.005 < prior_required

    # Allocation guidance (separately payable obligations) — shares follow
    # the estimated-tax base, since that is what the payments satisfy:
    alloc_state = est_state / combined_estimated if combined_estimated > 0 else 0.0
    return {
        "state": state,
        "school_district": sd,
        "combined_liability": combined,
        "estimated_tax_base": {
            "state": est_state,
            "school_district": sd["tax"],
            "combined": combined_estimated,
            "exemption_credit_excluded": state["exemption_credit"],
            "note": ("R.C. 5747.022: the $20-per-exemption credit is not "
                     "considered when determining estimated taxes under "
                     "R.C. 5747.09 — it still reduces the projected return "
                     "liability."),
        },
        "withholding": {"ohio": oh_wh, "school_district": sd_wh, "total": withholding_total,
                        "allocation": "even (statutory default; actual-date election not supported)"},
        "threshold": {"amount": C["estimated_tax_threshold"],
                      "after_withholding": after_withholding,
                      "payment_required": payment_required,
                      "basis": "estimated-tax liability (5747.022 credit excluded)"},
        "no_payment_reason": (None if payment_required else
                              "Combined Ohio + school-district amount after withholding does not "
                              "exceed the $500 general estimated-payment requirement"),
        "safe_harbor": {
            "current_year_target": current_target,
            "prior_year_target": prior_combined,
            "prior_year_valid": prior_valid,
            "prior_year_state": prior_state, "prior_year_sd": prior_sd,
            "no_110_rule": True,   # Ohio statute has no high-income 110% variant
            "selected_path": selected_path,
        },
        "installments": {
            "method": "regular",
            "next_deadline": next_deadline,
            "required_through_next": required_through_next,
            "withholding_counted_through_next": wh_through_next,
            "prior_year_overpayments_applied": overpayments,
            "payments_recorded": payments,
            "ohio_payments_recorded": _r2(ohio_payments_total),
            "sd_payments_recorded": _r2(sd_payments_total),
            "credited_total": credited,
            "remaining_next_payment": remaining_next,
            "ahead_by": ahead_by,
            "prior_installment_underpaid": prior_underpaid,
            "underpayment_note": ("Includes catch-up toward the current Ohio estimated-tax "
                                  "requirement. Earlier underpayment may still affect "
                                  "interest/penalty calculations." if prior_underpaid else None),
            "allocation_hint": {
                "ohio_state_share": _r2(remaining_next * alloc_state),
                "school_district_share": _r2(remaining_next * (1 - alloc_state)),
                "note": "Ohio state (IT 1040ES/OUPC) and school-district (SD 100ES/OUPC) "
                        "estimated payments are made separately.",
            },
        },
        "not_calculated": [
            "Ohio annualized-income / reasonable-cause underpayment treatment (IT/SD 2210)",
            "Municipal (city) income tax — separate regime, not part of this estimate",
            "Underpayment interest/penalty amounts",
        ],
        "annualized_note": ("Regular estimated-tax method shown. Ohio annualized-income "
                            "treatment is not calculated; CPA review may change installment "
                            "timing for uneven income."),
    }


def ohio_cpa_flags(*, ohio: Dict[str, Any], school_district: Dict[str, Any]) -> List[str]:
    flags: List[str] = []
    if ohio.get("resident") is False:
        flags.append("Non-resident or part-year Ohio residency is not supported — the engine "
                     "assumes a full-year Ohio resident.")
    if ohio.get("unusual_ohio_situation") is True:
        flags.append("Owner marked an unusual Ohio situation (multistate income, part-year "
                     "residency, PTE election, district change, or complex modifications).")
    return flags
