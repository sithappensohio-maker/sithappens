/**
 * Step 4D-3 — Tax Center tests. Pins: backend-derived Next Tax Action and
 * statuses (React never infers from dollars); separate obligations with NO
 * fake grand total; jurisdiction-locked record actions; SD-unknown
 * confirmation path; legacy-reserve exclusion (note-only); municipal +
 * sales-vs-income explainers; dashboard-tile line mapping; and source pins
 * proving the tile/tab are finance-permission-gated.
 */
import fs from "fs";
import path from "path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import TaxCenterTab, { taxCenterTileLine } from "./TaxCenter";
import { ConfirmProvider } from "../lib/useConfirm";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
  formatErr: (x) => (x == null ? "" : String(x)),
}));

const { api } = require("../lib/api");

global.IS_REACT_ACT_ENVIRONMENT = true;

const incompleteCard = {
  tax_year: 2026, status: "PROFILE_INCOMPLETE", missing_fields: ["Filing status"],
  business_projection: { actual_ytd_business_profit: 0, projected_remaining_business_profit: null, projected_annual_business_profit: null },
  completeness: { fields_complete: false, missing_fields: ["Filing status"] },
};

const payments = {
  tax_year: 2026,
  jurisdictions: { federal: { payments: [], total: 0 }, ohio: { payments: [], total: 0 },
                   ohio_school_district: { payments: [], total: 0 } },
  legacy_unassigned: { payments: [], total: 0, note: "" },
};

const fedEntry = {
  key: "federal", jurisdiction: "federal", label: "Federal Estimated Tax",
  period_label: "Tax year 2026", status: "PAYMENT_NEEDED", status_label: "PAYMENT NEEDED",
  priority: 2, actionable: true, due_date: "2026-09-15",
  required_amount: 6900, credited_amount: 0, remaining_amount: 6900,
  future_dated_total: 500, catch_up: false,
  action: { type: "record_payment", lock_jurisdiction: "federal" }, detail: "federal_card",
};

const sdUnknownEntry = {
  key: "school_district", jurisdiction: "ohio_school_district", label: "School District",
  period_label: "Tax year 2026", status: "PROFILE_INCOMPLETE", status_label: "PROFILE INCOMPLETE",
  priority: 6, actionable: true, note: "School-district tax status needs confirmation.",
  action: { type: "open_profile" }, detail: "tax_profile",
};

const salesEntry = {
  key: "sales_tax:2026-07", jurisdiction: "sales_tax", label: "Ohio Sales Tax",
  period_label: "July 2026", status: "FILING_REQUIRED", status_label: "FILING REQUIRED",
  priority: 3, actionable: true, due_date: "2026-08-23",
  required_amount: 296.93, remaining_amount: 296.93,
  action: { type: "open_sales_tax" }, detail: "sales_tax_tab",
};

const aggregator = (over = {}) => ({
  tax_year: 2026, as_of: "2026-08-18",
  obligations: [fedEntry, sdUnknownEntry, salesEntry,
    { key: "sales_tax:2026-08", jurisdiction: "sales_tax", label: "Ohio Sales Tax",
      period_label: "August 2026", status: "UPCOMING", status_label: "UPCOMING",
      priority: 7, actionable: false, due_date: "2026-09-23",
      informational: { accrued_liability: 12.5 }, action: { type: "open_sales_tax" } }],
  attention: [salesEntry, fedEntry, sdUnknownEntry],
  next_action: { none: false, key: "sales_tax:2026-07", status: "FILING_REQUIRED",
                 status_label: "FILING REQUIRED", jurisdiction: "sales_tax",
                 due_date: "2026-08-23", amount: 296.93,
                 headline: "Ohio Sales Tax — July 2026 return due 2026-08-23",
                 sub: "Filing is required even when the liability is $0." },
  upcoming_dates: [
    { date: "2026-08-23", jurisdiction: "sales_tax", label: "Ohio sales tax — July 2026 filing/payment" },
    { date: "2026-09-15", jurisdiction: "federal", label: "Federal estimated tax — installment 3 (1040-ES)" },
    { date: "2026-09-15", jurisdiction: "ohio", label: "Ohio estimated tax — installment 3 (IT 1040ES)" },
  ],
  profile_readiness: {
    federal: { complete: true, missing_count: 0, cpa_review: false },
    ohio: { complete: false, missing_count: 3, cpa_review: false },
    school_district: { applicable: "unknown" },
  },
  legacy_unassigned: { total: 100, count: 1, note: "Recorded before jurisdictions existed — excluded from every obligation, amount, and status above." },
  notes: {
    explainer: "Sales tax is money collected from taxable merchandise sales and remitted to Ohio. Federal, Ohio, and school-district estimated taxes are income-tax obligations based on the owner's tax situation.",
    municipal: "Municipal income tax is not calculated by Sit Happens Tax Center.",
    planning_reserve: "The legacy planning reserve is a budgeting tool only — it is excluded from every authoritative amount, status, and deadline shown here.",
    recording: "Recording a payment documents money you already sent externally. Nothing here sends money to the IRS or Ohio.",
  },
  ...over,
});

function mockRoutes(agg) {
  api.get.mockImplementation((url) => {
    if (url.startsWith("/admin/tax-center")) return Promise.resolve({ data: agg });
    if (url.startsWith("/admin/federal-estimated-tax")) return Promise.resolve({ data: incompleteCard });
    if (url.startsWith("/admin/ohio-estimated-tax")) return Promise.resolve({ data: incompleteCard });
    if (url.startsWith("/admin/estimated-tax/payments")) return Promise.resolve({ data: payments });
    if (url.startsWith("/admin/tax-profile")) return Promise.resolve({ data: { profile: {}, completeness: {} } });
    return Promise.resolve({ data: {} });
  });
}

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

async function mount(agg = aggregator()) {
  mockRoutes(agg);
  root = createRoot(container);
  await act(async () => {
    root.render(<ConfirmProvider><TaxCenterTab onOpenSalesTax={() => {}} /></ConfirmProvider>);
  });
}

const text = (sel) => container.querySelector(sel)?.textContent || "";

test("next action + separate obligations, and NO fake grand total", async () => {
  await mount();
  expect(text('[data-testid="taxcenter-next-headline"]')).toContain("Ohio Sales Tax — July 2026 return due");
  expect(container.querySelector('[data-testid="taxcenter-attention-row-sales_tax:2026-07"]')).toBeTruthy();
  expect(container.querySelector('[data-testid="taxcenter-attention-row-federal"]')).toBeTruthy();
  expect(text('[data-testid="taxcenter-amount-federal"]')).toBe("$6900.00");
  // separate obligations only — never one combined figure
  expect(container.textContent).not.toMatch(/Total Taxes Owed/i);
  expect(container.textContent).not.toMatch(/grand total/i);
  // sales vs income explainer + municipal disclaimer
  expect(text('[data-testid="taxcenter-explainer"]')).toContain("money collected from taxable merchandise sales");
  expect(text('[data-testid="taxcenter-municipal"]')).toContain("not calculated by Sit Happens Tax Center");
  // external-recording honesty line
  expect(text('[data-testid="taxcenter-recording-note"]')).toContain("Nothing here sends money to the IRS or Ohio");
});

test("statuses come from the backend payload, not dollar inference", async () => {
  await mount();
  expect(text('[data-testid="taxcenter-status-federal"]')).toBe("PAYMENT NEEDED");
  expect(text('[data-testid="taxcenter-status-sales_tax:2026-07"]')).toBe("FILING REQUIRED");
  // future-dated payments surfaced but never subtracted client-side
  expect(text('[data-testid="taxcenter-future-federal"]')).toContain("$500.00");
});

test("SD unknown → confirmation row routed to Tax Profile", async () => {
  await mount();
  const row = text('[data-testid="taxcenter-attention-row-school_district"]');
  expect(row).toContain("School-district tax status needs confirmation");
  expect(container.querySelector('[data-testid="taxcenter-profile-school_district"]')).toBeTruthy();
});

test("record action opens the jurisdiction-LOCKED modal", async () => {
  await mount();
  await act(async () => { container.querySelector('[data-testid="taxcenter-record-federal"]').click(); });
  const jur = container.querySelector('[data-testid="estpay-modal-jurisdiction"]');
  expect(jur.value).toBe("federal");
  expect(jur.disabled).toBe(true);
});

test("legacy planning reserve appears ONLY as the Planning Tools note", async () => {
  await mount();
  expect(text('[data-testid="taxcenter-planning-note"]')).toContain("budgeting tool only");
  // never in next action / attention
  expect(text('[data-testid="taxcenter-next-action"]')).not.toMatch(/reserve/i);
  expect(text('[data-testid="taxcenter-attention"]')).not.toMatch(/reserve/i);
  expect(text('[data-testid="taxcenter-upcoming"]')).not.toMatch(/reserve/i);
});

test("no-action state renders the all-clear", async () => {
  await mount(aggregator({
    attention: [],
    next_action: { none: true, headline: "No immediate tax action required", sub: "All tracked obligations are on track, resolved, or not yet due." },
  }));
  expect(text('[data-testid="taxcenter-next-headline"]')).toBe("No immediate tax action required");
  expect(container.querySelector('[data-testid="taxcenter-attention-empty"]')).toBeTruthy();
});

test("profile readiness summary reflects backend readiness", async () => {
  await mount();
  const r = text('[data-testid="taxcenter-readiness"]');
  expect(r).toContain("Federal: Complete");
  expect(r).toContain("Missing information (3)");
  expect(r).toContain("School district: Unknown");
});

describe("dashboard tile line (pure)", () => {
  test("maps backend next_action to tile tones", () => {
    expect(taxCenterTileLine({ none: true }).tone).toBe("ok");
    expect(taxCenterTileLine({ none: false, status: "OVERDUE", headline: "x" }).tone).toBe("overdue");
    expect(taxCenterTileLine({ none: false, status: "PAYMENT_NEEDED", headline: "x" }).tone).toBe("warning");
    expect(taxCenterTileLine({ none: false, status: "PROFILE_INCOMPLETE", headline: "x" }).tone).toBe("warning");
    expect(taxCenterTileLine(null)).toBeNull();
  });
});

describe("integration source pins (no mount)", () => {
  const dash = fs.readFileSync(path.join(__dirname, "../screens/Dashboard.jsx"), "utf8");
  const income = fs.readFileSync(path.join(__dirname, "../screens/Income.jsx"), "utf8");

  test("dashboard tile is owner/finance-gated", () => {
    expect(dash).toMatch(/widgetOn\("tax_center"\) && can\("finance_reports"\) && <TaxCenterTile/);
  });

  test("Finance hosts the Tax Center tab and deep-link", () => {
    expect(income).toMatch(/key: "tax_center", label: "Tax Center"/);
    expect(income).toMatch(/<TaxCenterTab onOpenSalesTax=/);
    expect(income).toMatch(/stored === "sales_tax" \|\| stored === "tax_center"/);
  });
});
