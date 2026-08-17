/**
 * Step 4D-2B — Federal Estimated Tax card tests. The backend decides the
 * status; the card must render each state without inventing numbers:
 * incomplete → no dollars; CPA review → reasons, no payment; READY →
 * projected tax and safe-harbor target SEPARATE, remaining payment
 * prominent, $0/no-payment states honest, federal-only payment recording.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import FederalEstimatedTaxCard from "./FederalEstimatedTaxCard";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn() },
  formatErr: (x) => (x == null ? "" : String(x)),
}));

const { api } = require("../lib/api");

global.IS_REACT_ACT_ENVIRONMENT = true;

const basePayload = (over = {}) => ({
  tax_year: 2026, as_of: "2026-08-17",
  business_projection: {
    actual_ytd_business_profit: 38000.0,
    projected_remaining_business_profit: 17000.0,
    projected_annual_business_profit: 55000.0,
    projection_confirmed_at: "2026-08-17T12:00:00",
    run_rate_suggestion_remaining: 21000.0,
    run_rate_note: "Straight run-rate of YTD profit — a SUGGESTION only…",
  },
  completeness: { fields_complete: true, missing_fields: [], ready_for_calculation: true, engine: "available" },
  legacy_reserve_is_not_this: true,
  ...over,
});

const readyEstimate = (over = {}) => ({
  worksheet: {
    line_1_agi: 51114.38,
    income_components: { business_profit: 55000, other_se_income: 0, w2_wages: 0, spouse_wages: 0, other_taxable_income: 0, total_income: 55000 },
    adjustments: { se_tax_deduction_half: 3885.62, se_health_insurance: 0, retirement_hsa: 0, other: 0, total: 3885.62 },
    line_2a_deduction: 16600, deduction_source: "standard deduction (single, 2026) + non-itemizer charitable",
    nonitemizer_charitable: { applicable: true, entered: 500, statutory_cap: 1000, allowed: 500, standard_deduction: 16100 },
    line_2b_qbi: { deduction: 7002.88 }, line_2c_schedule_1a: 6000,
    line_2d_total_deductions: 29602.88, taxable_before_qbi: 28514.38,
    line_3_taxable_income: 28011.5,
    line_4_income_tax: 3113.38, bracket_detail: [], line_7_credits: 0, line_8_after_credits: 3113.38,
    line_9_se_tax: { total: 7771.25 }, line_10_other_taxes: { owner_entered: 0, additional_medicare: { tax: 0 }, total: 0 },
    line_11_refundable_credits: 0, line_11c_total_tax: 10884.63,
    line_12a_current_year_pct: 9796.17, line_12b_prior_year: 9200, line_12c_required_annual_payment: 9200,
    line_13_withholding: 0, line_14a: 9200, line_14b_owed_after_withholding: 10884.63,
  },
  projected_total_tax: 10884.63,
  safe_harbor: { current_year_target: 9796.17, prior_year_target: 9200, prior_year_valid: true,
                 high_income_110_applied: false, selected_path: "prior_year", required_annual_payment: 9200 },
  payment_required: true,
  no_payment_reason: null,
  installments: {
    method: "regular",
    next_deadline: { tax_year: 2026, quarter: 3, due: "2026-09-15", period: "Jun 1 – Aug 31, 2026" },
    required_through_next: 6900, withholding_counted: 0, prior_year_overpayment_applied: 0,
    federal_payments_recorded: 0, credited_total: 0, remaining_next_payment: 6900,
    ahead_by: 0, prior_installment_underpaid: false, underpayment_note: null,
  },
  not_calculated: ["Alternative Minimum Tax (AMT)", "Net Investment Income Tax (NIIT)"],
  seasonal_note: "Income substantially uneven/seasonal? The annualized-income method is not currently calculated; CPA review may reduce or change installment timing.",
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
  await act(async () => { root.render(<FederalEstimatedTaxCard year={2026} onOpenProfile={() => {}} />); });
}

const text = (sel) => container.querySelector(sel)?.textContent || "";

test("incomplete profile: missing fields listed, zero dollar amounts", async () => {
  api.get.mockResolvedValue({ data: basePayload({
    status: "PROFILE_INCOMPLETE",
    missing_fields: ["Federal filing status", "Prior-year federal total tax (for safe-harbor comparison)"],
    business_projection: { ...basePayload().business_projection, projected_remaining_business_profit: null, projected_annual_business_profit: null },
  })});
  await mount();
  expect(text('[data-testid="fed-status-chip"]')).toBe("PROFILE INCOMPLETE");
  expect(text('[data-testid="fed-missing-fields"]')).toContain("Federal filing status");
  expect(container.querySelector('[data-testid="fed-remaining-payment"]')).toBeFalsy();
  expect(text('[data-testid="fed-business-projection"]')).toContain("remaining-year expectation not confirmed");
});

test("READY: remaining payment prominent; projected tax and safe harbor separate", async () => {
  api.get.mockResolvedValue({ data: basePayload({ status: "READY", cpa_review_reasons: [], estimate: readyEstimate(), federal_payments: [] }) });
  await mount();
  expect(text('[data-testid="fed-status-chip"]')).toBe("PAYMENT NEEDED");
  expect(text('[data-testid="fed-remaining-payment"]')).toBe("$6900.00");
  expect(text('[data-testid="fed-projected-tax"]')).toBe("$10884.63");
  expect(text('[data-testid="fed-rap"]')).toBe("$9200.00");
  expect(text('[data-testid="fed-sh-path"]')).toBe("100% of prior-year tax");
  expect(text('[data-testid="fed-next-deadline"]')).toContain("09/15/2026");
  expect(text('[data-testid="fed-seasonal-note"]')).toContain("annualized-income method is not currently calculated");
});

test("110% prior-year path is labeled as such", async () => {
  const est = readyEstimate();
  est.safe_harbor.high_income_110_applied = true;
  api.get.mockResolvedValue({ data: basePayload({ status: "READY", cpa_review_reasons: [], estimate: est, federal_payments: [] }) });
  await mount();
  expect(text('[data-testid="fed-sh-path"]')).toBe("110% of prior-year tax");
});

test("no payment required under the $1,000 test", async () => {
  const est = readyEstimate({ payment_required: false,
    no_payment_reason: "Expected amount owed after withholding is under the $1,000 general requirement" });
  est.installments.remaining_next_payment = 0;
  api.get.mockResolvedValue({ data: basePayload({ status: "READY", cpa_review_reasons: [], estimate: est, federal_payments: [] }) });
  await mount();
  expect(text('[data-testid="fed-status-chip"]')).toBe("NO PAYMENT REQUIRED");
  expect(text('[data-testid="fed-no-payment"]')).toContain("$1,000 test");
  expect(container.querySelector('[data-testid="fed-remaining-payment"]')).toBeFalsy();
});

test("ahead of target shows $0 due and the ahead amount", async () => {
  const est = readyEstimate();
  est.installments.remaining_next_payment = 0;
  est.installments.ahead_by = 1100;
  est.installments.credited_total = 8000;
  api.get.mockResolvedValue({ data: basePayload({ status: "READY", cpa_review_reasons: [], estimate: est, federal_payments: [] }) });
  await mount();
  expect(text('[data-testid="fed-status-chip"]')).toBe("ON TRACK");
  expect(text('[data-testid="fed-remaining-payment"]')).toBe("$0.00");
  expect(text('[data-testid="fed-ahead"]')).toContain("$1100.00");
});

test("CPA review: reasons shown, no payment number anywhere", async () => {
  const est = readyEstimate({ payment_required: null });
  est.installments.remaining_next_payment = null;
  api.get.mockResolvedValue({ data: basePayload({
    status: "CPA_REVIEW_REQUIRED",
    cpa_review_reasons: ["Expected qualified dividends / net capital gains need the capital-gain rate worksheet, which Sit Happens does not calculate."],
    estimate: est, federal_payments: [],
  })});
  await mount();
  expect(text('[data-testid="fed-status-chip"]')).toBe("CPA REVIEW REQUIRED");
  expect(text('[data-testid="fed-cpa-review"]')).toContain("capital-gain rate worksheet");
  expect(container.querySelector('[data-testid="fed-remaining-payment"]')).toBeFalsy();
  expect(container.querySelector('[data-testid="fed-record-payment"]')).toBeFalsy();
});

test("worksheet details expose the line breakdown and not-calculated list", async () => {
  api.get.mockResolvedValue({ data: basePayload({ status: "READY", cpa_review_reasons: [], estimate: readyEstimate(), federal_payments: [] }) });
  await mount();
  await act(async () => { container.querySelector('[data-testid="fed-details-toggle"]').click(); });
  const ws = text('[data-testid="fed-worksheet"]');
  expect(ws).toContain("Projected AGI (line 1)");
  expect(ws).toContain("QBI deduction (line 2b)");
  expect(ws).toContain("Self-employment tax");
  expect(ws).toContain("Required annual payment (12c — smaller)");
  expect(ws).toContain("Alternative Minimum Tax (AMT)");
  expect(ws).toContain("prepayment floor");
});

test("record payment posts federal-locked jurisdiction", async () => {
  api.get.mockResolvedValue({ data: basePayload({ status: "READY", cpa_review_reasons: [], estimate: readyEstimate(), federal_payments: [] }) });
  api.post.mockResolvedValue({ data: { id: "np" } });
  await mount();
  await act(async () => { container.querySelector('[data-testid="fed-record-payment"]').click(); });
  const jur = container.querySelector('[data-testid="estpay-modal-jurisdiction"]');
  expect(jur.value).toBe("federal");
  expect(jur.disabled).toBe(true);
  const amt = container.querySelector('[data-testid="estpay-modal-amount"]');
  await act(async () => {
    const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    s.call(amt, "2300");
    amt.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { container.querySelector('[data-testid="estpay-modal-save"]').click(); });
  expect(api.post).toHaveBeenCalledWith("/admin/estimated-tax/payments", expect.objectContaining({
    jurisdiction: "federal", amount: 2300,
  }));
});


test("worksheet shows charity and Schedule 1-A as separate lines (4D-2B-1)", async () => {
  api.get.mockResolvedValue({ data: basePayload({ status: "READY", cpa_review_reasons: [], estimate: readyEstimate(), federal_payments: [], future_dated_payments_total: 0 }) });
  await mount();
  await act(async () => { container.querySelector('[data-testid="fed-details-toggle"]').click(); });
  const ws = text('[data-testid="fed-worksheet"]');
  expect(ws).toContain("Standard deduction");
  expect(ws).toContain("Non-itemizer charitable deduction (cap $1000)");
  expect(ws).toContain("Schedule 1-A additional deductions (line 2c)");
});

test("future-dated federal payments are flagged and excluded from crediting (4D-2B-1)", async () => {
  const est = readyEstimate();
  est.installments.federal_payments_recorded = 0;
  est.installments.credited_total = 0;
  api.get.mockResolvedValue({ data: basePayload({
    status: "READY", cpa_review_reasons: [], estimate: est,
    federal_payments: [{ id: "fut1", period: 4, amount: 4000, payment_date: "2026-12-15", voided: false, future_dated: true }],
    future_dated_payments_total: 4000,
  })});
  await mount();
  expect(text('[data-testid="fed-future-payments-note"]')).toContain("$4000.00");
  expect(text('[data-testid="fed-remaining-payment"]')).toBe("$6900.00"); // unchanged by the future row
});
