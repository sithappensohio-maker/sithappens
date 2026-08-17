"""Step 4D-2C — year-versioned OHIO tax constants (2026 only).

Verified against CURRENT OFFICIAL PRIMARY SOURCES (Step 4D-1 audit,
re-checked 2026-08-17): Ohio Revised Code 5747.01, 5747.02, 5747.022,
5747.025, 5747.05, 5747.09, 5748.01 (codes.ohio.gov, current versions
incl. HB 96 eff. 9/30/2025 and SB 9 eff. 3/5/2026) and the published
2026 Ohio Estimated Income Tax instructions.

DOCUMENTED FORM-VS-STATUTE CONFLICTS (statute controls, per task rule):
  1. Nonbusiness rate: the published 2026 Ohio ES worksheet still prints
     the pre-HB 96 two-bracket chart ($342 + 2.75% to $100k; $2,394.32 +
     3.125% above). R.C. 5747.02(A)(3)(c) for taxable years beginning in
     2026 imposes a SINGLE rate: $332.00 + 2.75% of the excess over
     $26,050. The statute is implemented here.
  2. Personal exemption: the 2026 ES worksheet estimates a flat $1,900
     per exemption; R.C. 5747.025 (current) sets tiered statutory
     amounts by modified AGI. The statutory tiers are implemented; final
     GDP-deflator-indexed 2026 amounts arrive with the 2026 IT 1040
     instructions (not yet published) and may increase them slightly.
"""
from typing import Any, Dict, Optional

OHIO_TAX_CONSTANTS: Dict[int, Dict[str, Any]] = {
    2026: {
        # ── Business Income Deduction — R.C. 5747.01(A)(28) (SB 9) ─────────
        "bid_cap": 250000.0,          # all filers except…
        "bid_cap_mfs": 125000.0,      # …married filing separately
        # ── Business-income rate — R.C. 5747.02(A)(4)(a): flat 3% ──────────
        "business_income_rate": 0.03,
        # ── Nonbusiness income — R.C. 5747.02(A)(3)(c), TY 2026+ ───────────
        "nonbusiness_zero_bracket": 26050.0,   # no tax at or below
        "nonbusiness_base_tax": 332.0,         # $332.00 plus…
        "nonbusiness_rate": 0.0275,            # …2.75% of the excess
        # ── Personal exemption — R.C. 5747.025 (HB 96) statutory tiers ─────
        # by MODIFIED AGI (R.C. 5747.01(II): OAGI + BID add-back).
        "exemption_tiers": [           # (MAGI upper bound or None, amount)
            (40000.0, 2350.0),
            (80000.0, 2100.0),
            (None, 1850.0),
        ],
        "exemption_zero_magi": 500000.0,   # NEW 2026: no exemption at/above
        # ── $20 personal/dependent exemption credit — R.C. 5747.022 ────────
        "exemption_credit_per": 20.0,
        "exemption_credit_oagi_limit": 30000.0,  # only if OAGI ≤ $30,000
        # ── Estimated-payment rules — R.C. 5747.09 ─────────────────────────
        # "Estimated taxes" = COMBINED liability under Ch. 5747 (state) AND
        # Ch. 5748 (school district). Declaration required when estimated
        # taxes less withholding are MORE THAN $500 (5747.09(B)) — never
        # the federal $1,000 figure.
        "estimated_tax_threshold": 500.0,
        # Safe harbor (5747.09(D)/(E)): cumulative payments must reach
        # 22.5/45/67.5/90% of CURRENT-year combined liability, OR
        # 25/50/75/100% of the PRIOR-year combined tax (prior-year return
        # must reflect a 12-month year). Ohio has NO federal-style 110%
        # higher-income variant — verified against the statute.
        "installment_current_year_pcts": [0.225, 0.45, 0.675, 0.90],
        "installment_prior_year_pcts": [0.25, 0.50, 0.75, 1.00],
        "safe_harbor_current_year_pct": 0.90,
        "safe_harbor_prior_year_pct": 1.00,
        # ── SDIT (Ch. 5748 / R.C. 5748.01) ─────────────────────────────────
        # traditional base = modified AGI (incl. the BID ADD-BACK) less
        # personal exemptions; earned-income base = wages/compensation +
        # net earnings from self-employment (§1402(a), i.e. × 92.35%),
        # with NO exemptions and NO BID. Rates vary by district (local
        # vote) — always owner-confirmed, never invented.
        "sd_se_earnings_factor": 0.9235,
    },
}


def ohio_constants_for(year: int) -> Optional[Dict[str, Any]]:
    """Verified constants for a tax year, or None → engine unavailable.
    2026 values are never silently reused for other years."""
    return OHIO_TAX_CONSTANTS.get(int(year))
