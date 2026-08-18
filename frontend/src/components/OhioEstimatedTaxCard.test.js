/**
 * Step 4D-2C — Ohio + SDIT card tests. Pins: incomplete → no dollars;
 * CPA review; state vs school-district separation (incl. the critical
 * $0-state + positive-SDIT case); $500 threshold states; safe-harbor
 * labels with NO federal 110% copy; future-payment note; jurisdiction-
 * locked record buttons.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import OhioEstimatedTaxCard from "./OhioEstimatedTaxCard";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn() },
  formatErr: (x) => (x == null ? "" : String(x)),
}));

const { api } = require("../lib/api");

global.IS_REACT_ACT_ENVIRONMENT = true;

const readyPayload = (over = {}) => ({
  tax_year: 2026, as_of: "2026-08-17",
  business_projection: { actual_ytd_business_profit: 38000, projected_remaining_business_profit: 12000, projected_annual_business_profit: 50000, projection_confirmed_at: "x" },
  completeness: { fields_complete: true, missing_fields: [], ready_for_calculation: true, engine: "available" },
  municipal_note: "Municipal (city) income tax is a separate regime and is NOT part of this Ohio/school-district estimate.",
  status: "READY", cpa_review_reasons: [],
  federal_agi_starting_point: 126467.61,
  future_dated_payments_total: 0,
  ohio_payments: [], sd_payments: [],
  estimate: {
    // Coherent Case-D numbers (4D-2C-1): profit 50k only → MAGI 46,467.61,
    // OAGI −3,532.39 after the BID, state $0, SDIT survives.
    state: { magi: 46467.61, ohio_adjustments: 0, oagi: -3532.39,
             business_income: 50000, bid_cap: 250000, bid_used: 50000,
             preliminary_taxable_business_income: 0,
             unused_exemptions_applied_to_business: 0,
             taxable_business_income: 0, business_tax: 0,
             exemption_count: 1, per_exemption: 2150, exemptions_total: 2150,
             exemption_amounts_basis: "2026 amounts $2,400/$2,150/$1,900 by MAGI tier — the indexed values frozen for 2025–2026 by H.B. 96 (Section 757.120); $0 at MAGI of $500,000 or more (R.C. 5747.025).",
             exemption_disallowed_high_magi: false, taxable_income: 0,
             taxable_nonbusiness_income: 0, nonbusiness_tax: 0,
             tax_before_credits: 0, exemption_credit: 0, other_ohio_credits: 0,
             estimated_tax_liability: 0, state_tax: 0 },
    school_district: { applicable: true, base_type: "earned_income", rate_pct: 1.5,
                       taxable_base: 46175, tax: 692.62,
                       note: "Earned-income base: wages + net earnings from self-employment (§1402(a)) — no exemptions, no Business Income Deduction." },
    combined_liability: 692.62,
    estimated_tax_base: { state: 0, school_district: 692.62, combined: 692.62,
                          exemption_credit_excluded: 0,
                          note: "R.C. 5747.022: the $20-per-exemption credit is not considered when determining estimated taxes under R.C. 5747.09 — it still reduces the projected return liability." },
    withholding: { ohio: 0, school_district: 0, total: 0, allocation: "even (statutory default; actual-date election not supported)" },
    threshold: { amount: 500, after_withholding: 692.62, payment_required: true,
                 basis: "estimated-tax liability (5747.022 credit excluded)" },
    no_payment_reason: null,
    safe_harbor: { current_year_target: 623.36, prior_year_target: 1500, prior_year_valid: true,
                   prior_year_state: 1200, prior_year_sd: 300, no_110_rule: true, selected_path: "current_year" },
    installments: {
      method: "regular", next_deadline: { tax_year: 2026, quarter: 3, due: "2026-09-15" },
      required_through_next: 467.52, withholding_counted_through_next: 0,
      prior_year_overpayments_applied: 0, payments_recorded: 0,
      ohio_payments_recorded: 0, sd_payments_recorded: 0, credited_total: 0,
      remaining_next_payment: 467.52, ahead_by: 0, prior_installment_underpaid: false,
      underpayment_note: null,
      allocation_hint: { ohio_state_share: 0, school_district_share: 467.52,
                        note: "Ohio state (IT 1040ES/OUPC) and school-district (SD 100ES/OUPC) estimated payments are made separately." },
    },
    not_calculated: ["Ohio annualized-income / reasonable-cause underpayment treatment (IT/SD 2210)"],
    annualized_note: "Regular estimated-tax method shown. Ohio annualized-income treatment is not calculated; CPA review may change installment timing for uneven income.",
  },
  ...over,
});

let container, root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset(); api.post.mockReset();
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null; container.remove();
});

async function mount() {
  root = createRoot(container);
  await act(async () => { root.render(<OhioEstimatedTaxCard year={2026} onOpenProfile={() => {}} />); });
}

const text = (sel) => container.querySelector(sel)?.textContent || "";

test("incomplete: missing fields listed, no dollars", async () => {
  api.get.mockResolvedValue({ data: readyPayload({
    status: "PROFILE_INCOMPLETE", estimate: undefined,
    missing_fields: ["Whether an Ohio school-district income tax applies to your home district"],
  })});
  await mount();
  expect(text('[data-testid="oh-status-chip"]')).toBe("PROFILE INCOMPLETE");
  expect(text('[data-testid="oh-missing-fields"]')).toContain("school-district income tax");
  expect(container.querySelector('[data-testid="oh-remaining-payment"]')).toBeFalsy();
});

test("critical case: $0 state tax with positive SDIT, shown separately", async () => {
  api.get.mockResolvedValue({ data: readyPayload() });
  await mount();
  expect(text('[data-testid="oh-state-tax"]')).toBe("$0.00");        // BID-sheltered
  expect(text('[data-testid="oh-sd-tax"]')).toBe("$692.62");         // SDIT survives
  expect(text('[data-testid="oh-combined"]')).toBe("$692.62");
  expect(text('[data-testid="oh-remaining-payment"]')).toBe("$467.52");
  expect(text('[data-testid="oh-allocation"]')).toContain("School district");
  expect(text('[data-testid="oh-sh-path"]')).toBe("90% of current-year projection");
  expect(text('[data-testid="oh-municipal-note"]')).toContain("separate regime");
});

test("$500 threshold not triggered → honest no-payment state", async () => {
  const p = readyPayload();
  p.estimate.threshold = { amount: 500, after_withholding: 367.61, payment_required: false };
  p.estimate.installments.remaining_next_payment = 0;
  api.get.mockResolvedValue({ data: p });
  await mount();
  expect(text('[data-testid="oh-status-chip"]')).toBe("NO PAYMENT REQUIRED");
  expect(text('[data-testid="oh-no-payment"]')).toContain("$500 threshold");
  expect(container.querySelector('[data-testid="oh-remaining-payment"]')).toBeFalsy();
});

test("prior-year path is 100% — never a federal 110% label", async () => {
  const p = readyPayload();
  p.estimate.safe_harbor.selected_path = "prior_year";
  p.estimate.safe_harbor.prior_year_target = 600;
  api.get.mockResolvedValue({ data: p });
  await mount();
  expect(text('[data-testid="oh-sh-path"]')).toBe("100% of prior-year Ohio+SD tax");
  expect(container.textContent).not.toMatch(/110%/);
});

test("CPA review: reasons shown, no payment number", async () => {
  const p = readyPayload({ status: "CPA_REVIEW_REQUIRED",
    cpa_review_reasons: ["Non-resident or part-year Ohio residency is not supported — the engine assumes a full-year Ohio resident."] });
  p.estimate.installments.remaining_next_payment = null;
  p.estimate.threshold.payment_required = null;
  api.get.mockResolvedValue({ data: p });
  await mount();
  expect(text('[data-testid="oh-status-chip"]')).toBe("CPA REVIEW REQUIRED");
  expect(text('[data-testid="oh-cpa-review"]')).toContain("full-year Ohio resident");
  expect(container.querySelector('[data-testid="oh-remaining-payment"]')).toBeFalsy();
  expect(container.querySelector('[data-testid="oh-record-payment"]')).toBeFalsy();
});

test("drill-down shows BID, statutory nonbusiness formula, and SD base", async () => {
  api.get.mockResolvedValue({ data: readyPayload() });
  await mount();
  await act(async () => { container.querySelector('[data-testid="oh-details-toggle"]').click(); });
  const ws = text('[data-testid="oh-worksheet"]');
  expect(ws).toContain("Business Income Deduction (max $250000.00)");
  expect(ws).toContain("Ohio AGI (after BID)");
  expect(ws).toContain("Modified AGI (sets exemption tier)");
  expect(ws).toContain("Business-income tax (3%)");
  expect(ws).toContain("Nonbusiness tax ($332 + 2.75% over $26,050)");
  expect(ws).toContain("no 110% rule in Ohio");
  expect(ws).toContain("Taxable base (earned_income)");
  // 4D-2C-1: three numbers, never one unexplained "Ohio tax"
  expect(ws).toContain("Projected Ohio return tax (state + SD)");
  expect(ws).toContain("Estimated-tax calculation base (R.C. 5747.09)");
  // frozen-exemption provenance surfaced
  expect(ws).toContain("H.B. 96");
});

test("4D-2C-1: $20 credit shown on the return but excluded from the estimated base", async () => {
  const p = readyPayload();
  // Case-A-style override: return 525.12 vs estimated base 545.12
  p.estimate.state = { ...p.estimate.state, magi: 31000, oagi: 31000,
    per_exemption: 2400, exemptions_total: 2400, taxable_income: 28600,
    taxable_nonbusiness_income: 28600, nonbusiness_tax: 402.12,
    tax_before_credits: 402.12, exemption_credit: 20,
    estimated_tax_liability: 402.12, state_tax: 382.12 };
  p.estimate.school_district = { ...p.estimate.school_district, base_type: "traditional", rate_pct: 0.5, taxable_base: 28600, tax: 143.0 };
  p.estimate.combined_liability = 525.12;
  p.estimate.estimated_tax_base = { ...p.estimate.estimated_tax_base, state: 402.12, school_district: 143.0, combined: 545.12, exemption_credit_excluded: 20 };
  api.get.mockResolvedValue({ data: p });
  await mount();
  await act(async () => { container.querySelector('[data-testid="oh-details-toggle"]').click(); });
  const ws = text('[data-testid="oh-worksheet"]');
  expect(ws).toContain("$20 exemption credit (return only)");
  expect(ws).toContain("$525.12");                       // projected return
  expect(ws).toContain("$545.12");                       // 5747.09 base
  expect(text('[data-testid="oh-estbase-note"]')).toContain("5747.09");
});

test("4D-2C-1: unused-exemption spillover line appears when applied", async () => {
  const p = readyPayload();
  p.estimate.state = { ...p.estimate.state, preliminary_taxable_business_income: 10000,
    unused_exemptions_applied_to_business: 620.59, taxable_business_income: 9379.41,
    business_tax: 281.38 };
  api.get.mockResolvedValue({ data: p });
  await mount();
  await act(async () => { container.querySelector('[data-testid="oh-details-toggle"]').click(); });
  expect(text('[data-testid="oh-worksheet"]')).toContain("Unused exemptions applied to business income (R.C. 5747.02(A)(4)(b))");
});

test("record buttons lock their jurisdiction", async () => {
  api.get.mockResolvedValue({ data: readyPayload() });
  api.post.mockResolvedValue({ data: { id: "np" } });
  await mount();
  await act(async () => { container.querySelector('[data-testid="oh-record-sd-payment"]').click(); });
  const jur = container.querySelector('[data-testid="estpay-modal-jurisdiction"]');
  expect(jur.value).toBe("ohio_school_district");
  expect(jur.disabled).toBe(true);
});

test("future-dated payments flagged, not credited", async () => {
  const p = readyPayload({ future_dated_payments_total: 500 });
  api.get.mockResolvedValue({ data: p });
  await mount();
  expect(text('[data-testid="oh-future-payments-note"]')).toContain("$500.00");
  expect(text('[data-testid="oh-remaining-payment"]')).toBe("$467.52");  // unchanged
});
