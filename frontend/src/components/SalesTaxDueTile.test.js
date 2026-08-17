/**
 * Step 4C — dashboard "Sales Tax due" chip tests.
 *
 * salesTaxTileLine is a pure exported helper (PortalEngagementHub pattern)
 * so the wording matrix is asserted without a mount; the mounted tests pin
 * the setup state, the overdue state, the deep-link handoff, and the
 * failed-fetch rule (render NOTHING rather than fabricated tax numbers).
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { SalesTaxDueTile, salesTaxTileLine, FINANCE_TARGET_KEY } from "./SalesTaxDueTile";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn() },
  formatErr: (x) => String(x || ""),
}));

const { api } = require("../lib/api");

global.IS_REACT_ACT_ENVIRONMENT = true;

// ── pure wording matrix ─────────────────────────────────────────────────────

test("salesTaxTileLine covers the alert states", () => {
  expect(salesTaxTileLine(null)).toBeNull();
  const overdue = salesTaxTileLine({
    status: "overdue", urgency: "overdue", label: "July 2026",
    effective_due_date: "2026-08-23", projected_amount_to_remit: 240.88, liability: 240.88,
  });
  expect(overdue.tone).toBe("overdue");
  expect(overdue.text).toContain("OVERDUE");
  expect(overdue.text).toContain("$240.88");

  const dueSoon = salesTaxTileLine({
    status: "ready_to_file", urgency: "warning", label: "July 2026",
    effective_due_date: "2026-08-23", days_until_due: 5,
    projected_amount_to_remit: 284.17, liability: 284.17,
  });
  expect(dueSoon.text).toBe("Sales Tax: Due in 5 days — $284.17");

  const far = salesTaxTileLine({
    status: "ready_to_file", urgency: "normal", label: "July 2026",
    effective_due_date: "2026-09-23", days_until_due: 37,
    projected_amount_to_remit: 284.17, liability: 284.17,
  });
  expect(far.text).toContain("$284.17 due");

  const partial = salesTaxTileLine({
    status: "filed_payment_pending", label: "July 2026", filing_id: "f1",
    remaining_balance: 200.0, effective_due_date: "2026-08-23",
  });
  expect(partial.text).toContain("$200.00 payment remaining");

  const open = salesTaxTileLine({
    status: "open", urgency: "normal", label: "August 2026",
    effective_due_date: "2026-09-23", days_until_due: 38,
    liability: 84.1, projected_amount_to_remit: 84.1,
  });
  expect(open.text).toContain("$84.10 accrued");
});

// ── mounted behavior ────────────────────────────────────────────────────────

let container, root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset();
  sessionStorage.clear();
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  container.remove();
});

async function mount(props = {}) {
  root = createRoot(container);
  await act(async () => { root.render(<SalesTaxDueTile {...props} />); });
}

test("overdue tracker renders the red chip and deep-links to Finance → Sales Tax", async () => {
  api.get.mockResolvedValue({ data: {
    configured: true, setup_required: false,
    primary: {
      status: "overdue", urgency: "overdue", label: "July 2026",
      effective_due_date: "2026-08-23", projected_amount_to_remit: 240.88, liability: 240.88,
    },
    needs_review_periods: [],
  }});
  const onNavigate = jest.fn();
  await mount({ onNavigate });
  expect(api.get).toHaveBeenCalledWith("/admin/sales-tax/tracker");
  const tile = container.querySelector('[data-testid="sales-tax-tile"]');
  expect(tile.textContent).toContain("OVERDUE");
  await act(async () => { tile.click(); });
  expect(onNavigate).toHaveBeenCalledWith("income");
  expect(sessionStorage.getItem(FINANCE_TARGET_KEY)).toBe("sales_tax");
});

test("needs-review badge shows when any filed period drifted", async () => {
  api.get.mockResolvedValue({ data: {
    configured: true, setup_required: false,
    primary: {
      status: "ready_to_file", urgency: "normal", label: "August 2026",
      effective_due_date: "2026-09-23", days_until_due: 30,
      projected_amount_to_remit: 84.1, liability: 84.1,
    },
    needs_review_periods: ["2026-07"],
  }});
  await mount();
  expect(container.querySelector('[data-testid="sales-tax-tile-review"]')).toBeTruthy();
});

test("setup-required renders the setup chip, not numbers", async () => {
  api.get.mockResolvedValue({ data: { configured: false, setup_required: true, primary: null } });
  await mount();
  const tile = container.querySelector('[data-testid="sales-tax-tile-setup"]');
  expect(tile.textContent).toContain("Filing schedule needs setup");
  expect(tile.textContent).not.toContain("$");
});

test("failed fetch renders nothing — no fabricated $0.00 chip", async () => {
  api.get.mockRejectedValue(new Error("network"));
  await mount();
  expect(container.querySelector('[data-testid="sales-tax-tile"]')).toBeFalsy();
  expect(container.querySelector('[data-testid="sales-tax-tile-setup"]')).toBeFalsy();
  expect(container.textContent).toBe("");
});
