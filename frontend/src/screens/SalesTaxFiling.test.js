/**
 * Step 4C — Sales Tax Due & Filing Tracker tab tests.
 *
 * Scaffold follows RegisterTabPermissions.test.js (createRoot + act, CRA
 * resetMocks:true so every mock is re-armed in beforeEach). Fixtures mirror
 * the real GET /admin/sales-tax/tracker payload assembled by
 * server._sales_tax_tracker_payload — the component never computes tax.
 * RegisterHub doctrine: a failed fetch must render an error, never $0.00.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import SalesTaxFilingTab from "./SalesTaxFiling";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
  formatErr: (x) => (x == null ? "" : String(x)),
}));
jest.mock("../lib/useConfirm", () => ({
  useConfirm: () => async () => true,
  ConfirmProvider: ({ children }) => children,
}));

const { api } = require("../lib/api");

global.IS_REACT_ACT_ENVIRONMENT = true;

const period = (over = {}) => ({
  period_key: "2026-07", label: "July 2026",
  period_start: "2026-07-01", period_end: "2026-07-31",
  statutory_due_date: "2026-08-23", adjusted_due_date: null,
  due_date_override_reason: null, effective_due_date: "2026-08-23",
  is_open: false, needs_review: false, variance: null,
  status: "ready_to_file", urgency: "due_soon", days_until_due: 7,
  liability: 240.88,
  liability_detail: {
    bookings_tax_total: 100.0, retail_tax_total: 140.88, total_tax_collected: 240.88,
    gross_tax_charged: 250.88, tax_reversed: -10.0, by_month: [],
  },
  projected_timely_discount: 0.0, projected_amount_to_remit: 240.88,
  ...over,
});

const trackerPayload = (over = {}) => ({
  configured: true, setup_required: false, today: "2026-08-16",
  settings: { filing_frequency: "monthly", tracking_start_date: "2026-07-01", timely_discount_enabled: false, due_date_overrides: {} },
  periods: [period()],
  primary: period(),
  current: null,
  needs_review_periods: [],
  late_warning: null,
  ...over,
});

let container, root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset();
  api.post.mockReset();
  api.put.mockReset();
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  container.remove();
});

async function mount() {
  root = createRoot(container);
  await act(async () => { root.render(<SalesTaxFilingTab />); });
}

const text = (sel) => container.querySelector(sel)?.textContent || "";

test("setup-required state: liability shown, no due date, Set Filing Schedule CTA", async () => {
  api.get.mockResolvedValue({ data: {
    configured: false, setup_required: true, today: "2026-08-16",
    unconfigured_preview: {
      period_key: "2026-08", label: "August 2026", period_start: "2026-08-01",
      period_end: "2026-08-31", liability: 84.1,
      note: "Filing schedule needs setup — due dates are unknown until Ohio's assigned filing frequency is configured.",
    },
    periods: [], primary: null, current: null,
  }});
  await mount();
  expect(container.querySelector('[data-testid="stt-setup-card"]')).toBeTruthy();
  expect(text('[data-testid="stt-preview-liability"]')).toContain("$84.10");
  expect(text('[data-testid="stt-setup-card"]')).not.toContain("Due ");
  expect(container.querySelector('[data-testid="stt-setup-btn"]')).toBeTruthy();
});

test("monthly active obligation: amount, due date, days remaining, actions", async () => {
  api.get.mockResolvedValue({ data: trackerPayload() });
  await mount();
  expect(text('[data-testid="stt-primary-amount"]')).toBe("$240.88");
  expect(text('[data-testid="stt-primary-due"]')).toMatch(/7 days remaining/);
  expect(text('[data-testid="stt-primary-status"]')).toMatch(/Ready to File/i);
  expect(container.querySelector('[data-testid="stt-primary-record-filing"]')).toBeTruthy();
  expect(container.querySelector('[data-testid="stt-primary-view-details"]')).toBeTruthy();
});

test("semiannual active obligation renders the half-year period label", async () => {
  const semi = period({
    period_key: "2026-H1", label: "January–June 2026",
    period_start: "2026-01-01", period_end: "2026-06-30",
    statutory_due_date: "2026-07-23", effective_due_date: "2026-07-23",
  });
  api.get.mockResolvedValue({ data: trackerPayload({ periods: [semi], primary: semi }) });
  await mount();
  expect(text('[data-testid="stt-primary-period"]')).toContain("January–June 2026");
});

test("current accumulating period shows as secondary when older period is outstanding", async () => {
  const cur = period({
    period_key: "2026-08", label: "August 2026", status: "open", urgency: "normal",
    period_start: "2026-08-01", period_end: "2026-08-31",
    effective_due_date: "2026-09-23", liability: 84.1, is_open: true,
  });
  api.get.mockResolvedValue({ data: trackerPayload({ periods: [period(), cur], current: cur }) });
  await mount();
  expect(text('[data-testid="stt-primary-period"]')).toContain("July 2026");
  expect(text('[data-testid="stt-current-liability"]')).toBe("$84.10");
  expect(text('[data-testid="stt-current-card"]')).toContain("not yet closed");
});

test("overdue state is loud: OVERDUE flag, day count, late warning", async () => {
  const od = period({ status: "overdue", urgency: "overdue", days_until_due: undefined, days_overdue: 6 });
  api.get.mockResolvedValue({ data: trackerPayload({
    periods: [od], primary: od,
    late_warning: "Late filing/payment may result in penalties or interest.",
  })});
  await mount();
  expect(text('[data-testid="stt-overdue-flag"]')).toMatch(/6 days past due/i);
  expect(text('[data-testid="stt-late-warning"]')).toContain("penalties or interest");
  expect(text('[data-testid="stt-primary-due"]')).toMatch(/6 days overdue/);
});

test("$0 period stays an obligation until the zero return is recorded", async () => {
  const zero = period({ liability: 0.0, projected_amount_to_remit: 0.0 });
  api.get.mockResolvedValue({ data: trackerPayload({ periods: [zero], primary: zero }) });
  await mount();
  expect(text('[data-testid="stt-primary-amount"]')).toBe("$0.00");
  expect(text('[data-testid="stt-primary-status"]')).toMatch(/Ready to File/i);
  expect(container.querySelector('[data-testid="stt-primary-record-filing"]')).toBeTruthy();
});

const filedPeriod = (over = {}) => period({
  status: "filed_paid", urgency: "normal", filing_id: "f-1",
  filed_date: "2026-08-18", is_zero_return: false,
  snapshot: { liability: 284.17, amount_to_remit: 282.04, timely_discount: -2.13, adjustments: [], due_date: "2026-08-23" },
  confirmation_ref: "ABC123", total_paid: 282.04, remaining_balance: 0.0, payment_count: 1,
  liability: 284.17,
  ...over,
});

test("filed & paid: confirmation, paid amounts, no filing button", async () => {
  api.get.mockResolvedValue({ data: trackerPayload({ periods: [filedPeriod()], primary: filedPeriod() }) });
  await mount();
  expect(text('[data-testid="stt-primary-status"]')).toMatch(/Filed & Paid/i);
  expect(text('[data-testid="stt-primary-filed-line"]')).toContain("ABC123");
  expect(text('[data-testid="stt-primary-filed-line"]')).toContain("$282.04 of $282.04");
  expect(container.querySelector('[data-testid="stt-primary-record-filing"]')).toBeFalsy();
  expect(container.querySelector('[data-testid="stt-primary-record-payment"]')).toBeFalsy();
});

test("partial payment: remaining balance headline + Record Payment CTA", async () => {
  const part = filedPeriod({ status: "filed_payment_pending", total_paid: 100.0, remaining_balance: 182.04 });
  api.get.mockResolvedValue({ data: trackerPayload({ periods: [part], primary: part }) });
  await mount();
  expect(text('[data-testid="stt-primary-amount"]')).toBe("$182.04");
  expect(text('[data-testid="stt-primary-status"]')).toMatch(/Payment Pending/i);
  expect(container.querySelector('[data-testid="stt-primary-record-payment"]')).toBeTruthy();
});

test("needs-review variance is surfaced, snapshot numbers unchanged", async () => {
  const rev = filedPeriod({
    needs_review: true,
    variance: {
      filed_liability: 284.17, current_liability: 276.17, difference: -8.0,
      message: "A transaction/refund dated in this previously filed period changed after the filing was recorded.",
    },
  });
  api.get.mockResolvedValue({ data: trackerPayload({
    periods: [rev], primary: rev, needs_review_periods: ["2026-07"],
  })});
  await mount();
  expect(text('[data-testid="stt-needs-review-banner"]')).toContain("2026-07");
  const v = text('[data-testid="stt-primary-variance"]');
  expect(v).toContain("$284.17");
  expect(v).toContain("$276.17");
  expect(v).toContain("-$8.00");
  expect(v).toContain("changed after the filing was recorded");
});

test("filing history table: filed row, untracked row says No filing record", async () => {
  const untracked = period({
    period_key: "2026-06", label: "June 2026", status: "historical_untracked",
    urgency: "normal", effective_due_date: null, liability: 50.0,
  });
  api.get.mockResolvedValue({ data: trackerPayload({ periods: [untracked, filedPeriod()], primary: filedPeriod() }) });
  await mount();
  expect(text('[data-testid="stt-history-row-2026-07"]')).toContain("$284.17");
  expect(text('[data-testid="stt-history-status-2026-07"]')).toMatch(/Paid/i);
  const juneRow = text('[data-testid="stt-history-row-2026-06"]');
  expect(juneRow).toContain("No filing record");
  expect(text('[data-testid="stt-history-status-2026-06"]')).toMatch(/Not Tracked/i);
});

test("failed fetch renders an error with retry — never a fake $0.00", async () => {
  api.get.mockRejectedValue({ response: { data: { detail: "boom" } } });
  await mount();
  expect(container.querySelector('[data-testid="stt-error"]')).toBeTruthy();
  expect(container.querySelector('[data-testid="stt-retry"]')).toBeTruthy();
  expect(container.textContent).not.toContain("$0.00");
  expect(container.querySelector('[data-testid="stt-primary-card"]')).toBeFalsy();
});

test("record-filing modal posts and swaps in the returned tracker payload", async () => {
  api.get.mockResolvedValue({ data: trackerPayload() });
  api.post.mockResolvedValue({ data: trackerPayload({ periods: [filedPeriod()], primary: filedPeriod() }) });
  await mount();
  await act(async () => {
    container.querySelector('[data-testid="stt-primary-record-filing"]').click();
  });
  expect(container.querySelector('[data-testid="stt-file-modal"]')).toBeTruthy();
  // ledger liability pre-filled from the canonical backend number
  expect(container.querySelector('[data-testid="stt-file-liability"]').value).toBe("240.88");
  await act(async () => {
    container.querySelector('[data-testid="stt-file-save"]').click();
  });
  expect(api.post).toHaveBeenCalledWith("/admin/sales-tax/filings", expect.objectContaining({
    period_key: "2026-07", is_zero_return: false, filed_liability: 240.88,
  }));
  expect(text('[data-testid="stt-primary-status"]')).toMatch(/Filed & Paid/i);
});

test("mobile layout: history table scrolls in its own container, primary card wraps", async () => {
  api.get.mockResolvedValue({ data: trackerPayload() });
  await mount();
  const scroller = container.querySelector('[data-testid="stt-history"] .overflow-x-auto');
  expect(scroller).toBeTruthy();
  expect(container.querySelector('[data-testid="stt-primary-card"]').className).toContain("rounded-xl");
  const wrapRows = container.querySelectorAll('[data-testid="stt-primary-card"] .flex-wrap');
  expect(wrapRows.length).toBeGreaterThan(0);
});
