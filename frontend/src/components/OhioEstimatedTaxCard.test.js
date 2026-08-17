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
    state: { oagi: 126467.61, ohio_adjustments: 0, business_income: 50000, bid_cap: 250000,
             bid_used: 50000, taxable_business_income: 0, business_tax: 0, magi: 176467.61,
             exemption_count: 1, per_exemption: 1850, exemptions_total: 1850,
             exemption_disallowed_high_magi: false, taxable_income: 74617.61,
             taxable_nonbusiness_income: 74617.61, nonbusiness_tax: 1667.61,
             exemption_credit: 0, other_ohio_credits: 0, state_tax: 0 },
    school_district: { applicable: true, base_type: "earned_income", rate_pct: 1.5,
                       taxable_base: 46175, tax: 692.62,
                       note: "Earned-income base: wages + net earnings from self-employment (§1402(a)) — no exemptions, no Business Income Deduction." },
    combined_liability: 692.62,
    withholding: { ohio: 0, school_district: 0, total: 0, allocation: "even (statutory default; actual-date election not supported)" },
    threshold: { amount: 500, after_withholding: 692.62, payment_required: true },
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
  expect(ws).toContain("Business-income tax (3%)");
  expect(ws).toContain("Nonbusiness tax ($332 + 2.75% over $26,050)");
  expect(ws).toContain("no 110% rule in Ohio");
  expect(ws).toContain("Taxable base (earned_income)");
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
