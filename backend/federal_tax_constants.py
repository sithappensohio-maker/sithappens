"""Step 4D-2B — year-versioned FEDERAL tax constants.

Only VERIFIED official values belong here, one entry per tax year. If a
year has no entry, the federal engine is unavailable for it — 2026 values
are never silently reused for 2027.

2026 sources (verified against primary documents in the Step 4D-1 audit,
2026-08-17):
  * Rev. Proc. 2025-32 (2026 inflation adjustments, incl. OBBBA changes)
  * 2026 Form 1040-ES package (Feb 12, 2026): Estimated Tax Worksheet,
    Self-Employment Tax and Deduction Worksheet (p. 9), 2026 Tax Rate
    Schedules (p. 10)
  * Publication 505 (2026 edition), chapter 2
  * SSA 2026 COLA fact sheet (contribution and benefit base)
"""
from typing import Any, Dict, Optional

FEDERAL_TAX_CONSTANTS: Dict[int, Dict[str, Any]] = {
    2026: {
        # ── Standard deduction — Rev. Proc. 2025-32 §2.14 (§63(c)(2)) ──────
        "standard_deduction": {
            "single": 16100.0,
            "married_filing_jointly": 32200.0,
            "married_filing_separately": 16100.0,
            "head_of_household": 24150.0,
            "qualifying_surviving_spouse": 32200.0,
        },
        # ── Tax Rate Schedules — Rev. Proc. 2025-32 §2.01 / 1040-ES p. 10 ──
        # Each bracket: (upper bound of bracket or None for top, rate).
        "brackets": {
            "single": [
                (12400.0, 0.10), (50400.0, 0.12), (105700.0, 0.22),
                (201775.0, 0.24), (256225.0, 0.32), (640600.0, 0.35),
                (None, 0.37),
            ],
            "married_filing_jointly": [
                (24800.0, 0.10), (100800.0, 0.12), (211400.0, 0.22),
                (403550.0, 0.24), (512450.0, 0.32), (768700.0, 0.35),
                (None, 0.37),
            ],
            "married_filing_separately": [
                (12400.0, 0.10), (50400.0, 0.12), (105700.0, 0.22),
                (201775.0, 0.24), (256225.0, 0.32), (384350.0, 0.35),
                (None, 0.37),
            ],
            "head_of_household": [
                (17700.0, 0.10), (67450.0, 0.12), (105700.0, 0.22),
                (201750.0, 0.24), (256200.0, 0.32), (640600.0, 0.35),
                (None, 0.37),
            ],
            # QSS uses the MFJ schedule (1040-ES Rate Schedules).
            "qualifying_surviving_spouse": [
                (24800.0, 0.10), (100800.0, 0.12), (211400.0, 0.22),
                (403550.0, 0.24), (512450.0, 0.32), (768700.0, 0.35),
                (None, 0.37),
            ],
        },
        # ── Self-employment tax — 2026 1040-ES SE Tax Worksheet (p. 9) ─────
        "se_earnings_factor": 0.9235,   # line 3: net profit × 92.35%
        "se_min_net_earnings": 400.0,   # SE tax applies only if ≥ $400 (Sch. SE)
        "se_ss_rate": 0.124,            # Social Security portion
        "se_medicare_rate": 0.029,      # Medicare portion
        "ss_wage_base": 184500.0,       # SSA 2026 taxable maximum; 1040-ES p. 2/9
        # ── Additional Medicare Tax — Pub 505 (2026) ch. 1 / Form 8959 ─────
        "addl_medicare_rate": 0.009,    # statutory, not indexed
        "addl_medicare_thresholds": {
            "single": 200000.0,
            "head_of_household": 200000.0,
            "qualifying_surviving_spouse": 200000.0,
            "married_filing_jointly": 250000.0,
            "married_filing_separately": 125000.0,
        },
        # ── QBI (§199A) — Rev. Proc. 2025-32 §2.26; 1040-ES p. 2, line 2b ──
        "qbi_rate": 0.20,
        "qbi_taxable_income_threshold": {   # above this, wage/UBIA limits apply
            "single": 201750.0,
            "head_of_household": 201750.0,
            "qualifying_surviving_spouse": 403500.0,
            "married_filing_jointly": 403500.0,
            "married_filing_separately": 201775.0,
        },
        "qbi_minimum_deduction": 400.0,     # new 2026 minimum QBID (OBBBA)
        "qbi_minimum_qbi_required": 1000.0, # ≥ $1,000 active-business QBI
        # ── Estimated-payment rules — 2026 1040-ES p. 1, 8; Pub 505 ch. 2 ──
        "estimated_tax_threshold": 1000.0,      # owe ≥ $1,000 after WH/credits
        "safe_harbor_current_year_pct": 0.90,   # 90% of 2026 tax
        "safe_harbor_prior_year_pct": 1.00,     # 100% of 2025 tax
        "safe_harbor_high_income_pct": 1.10,    # 110% above the AGI threshold
        "high_income_agi_threshold": 150000.0,  # 2025 AGI > $150,000…
        "high_income_agi_threshold_mfs": 75000.0,  # …($75,000 if 2026 MFS)
        # Regular installment method (1040-ES line 15): ¼ of the required
        # annual payment per installment → cumulative 25/50/75/100%.
        "installment_cumulative_pcts": [0.25, 0.50, 0.75, 1.00],
        # NIIT (§1411) MAGI thresholds — statutory, used ONLY to flag
        # possible CPA review (the NIIT itself is not calculated).
        "niit_magi_thresholds": {
            "single": 200000.0,
            "head_of_household": 200000.0,
            "qualifying_surviving_spouse": 250000.0,
            "married_filing_jointly": 250000.0,
            "married_filing_separately": 125000.0,
        },
    },
}


def federal_constants_for(year: int) -> Optional[Dict[str, Any]]:
    """The verified constants for a tax year, or None → engine unavailable."""
    return FEDERAL_TAX_CONSTANTS.get(int(year))
