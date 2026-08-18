/**
 * Step 4D-2A — jurisdiction-split estimated-payment history tests.
 * Federal / Ohio / school-district ledgers render separately, legacy
 * combined rows stay "jurisdiction unassigned", voided rows stay visible,
 * and no required amount is ever invented.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import EstimatedTaxPayments from "./EstimatedTaxPayments";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn() },
  formatErr: (x) => (x == null ? "" : String(x)),
}));
jest.mock("../lib/useConfirm", () => ({
  useConfirm: () => async () => true,
  ConfirmProvider: ({ children }) => children,
}));

const { api } = require("../lib/api");

global.IS_REACT_ACT_ENVIRONMENT = true;

const payload = () => ({
  tax_year: 2026,
  jurisdictions: {
    federal: { total: 500.0, payments: [
      { id: "f1", period: 1, amount: 500.0, payment_date: "2026-04-10", reference: "EFTPS-123", voided: false },
    ]},
    ohio: { total: 200.0, payments: [
      { id: "o1", period: 1, amount: 200.0, payment_date: "2026-04-12", reference: "OH-9", voided: false },
    ]},
    ohio_school_district: { total: 0.0, payments: [] },
  },
  legacy_unassigned: {
    total: 750.0,
    note: "Recorded before jurisdictions existed — not counted toward federal, Ohio, or school-district history.",
    payments: [{ id: "L1", quarter: 2, amount: 750.0, payment_date: "2025-06-10", payment_method: "EFTPS", memo: "old", jurisdiction: "legacy_unassigned" }],
  },
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
  await act(async () => { root.render(<EstimatedTaxPayments year={2026} />); });
}

const text = (sel) => container.querySelector(sel)?.textContent || "";

test("federal, Ohio, and SD histories render separately and never mix", async () => {
  api.get.mockResolvedValue({ data: payload() });
  await mount();
  expect(text('[data-testid="estpay-federal-total"]')).toBe("$500.00");
  expect(text('[data-testid="estpay-ohio-total"]')).toBe("$200.00");
  expect(text('[data-testid="estpay-ohio_school_district-total"]')).toBe("$0.00");
  expect(text('[data-testid="estpay-federal"]')).not.toContain("OH-9");
  expect(text('[data-testid="estpay-ohio"]')).not.toContain("EFTPS-123");
});

test("legacy combined rows stay visibly unassigned", async () => {
  api.get.mockResolvedValue({ data: payload() });
  await mount();
  const legacy = text('[data-testid="estpay-legacy"]');
  expect(legacy).toContain("jurisdiction unassigned");
  expect(legacy).toContain("$750.00");
  expect(legacy).toContain("not counted toward federal, Ohio, or school-district history");
});

test("no required amount is invented; federal points at the engine card", async () => {
  // Step 4D-2B wording update: federal requirements now come from the
  // engine cards (4D-3 wording: both engines shipped; ledgers never mix).
  api.get.mockResolvedValue({ data: payload() });
  await mount();
  expect(container.textContent).toContain("Required amounts come from the federal and Ohio engine cards");
  expect(container.textContent).toContain("one ledger never reduces another");
  expect(container.textContent).not.toMatch(/you owe|balance owed|required payment: \$/i);
});

test("record modal posts the chosen jurisdiction", async () => {
  api.get.mockResolvedValue({ data: payload() });
  api.post.mockResolvedValue({ data: { id: "new" } });
  await mount();
  await act(async () => { container.querySelector('[data-testid="estpay-record-btn"]').click(); });
  const jur = container.querySelector('[data-testid="estpay-modal-jurisdiction"]');
  await act(async () => {
    const s = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
    s.call(jur, "ohio");
    jur.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const amt = container.querySelector('[data-testid="estpay-modal-amount"]');
  await act(async () => {
    const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    s.call(amt, "150");
    amt.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { container.querySelector('[data-testid="estpay-modal-save"]').click(); });
  expect(api.post).toHaveBeenCalledWith("/admin/estimated-tax/payments", expect.objectContaining({
    jurisdiction: "ohio", tax_year: 2026, amount: 150,
  }));
});

test("voided rows remain visible and struck through", async () => {
  const p = payload();
  p.jurisdictions.federal.payments.push(
    { id: "f2", period: 2, amount: 100.0, payment_date: "2026-06-01", reference: null, voided: true });
  api.get.mockResolvedValue({ data: p });
  await mount();
  const row = text('[data-testid="estpay-row-f2"]');
  expect(row).toContain("voided");
  expect(row).toContain("$100.00");
});


test("future-dated rows are chipped but still totaled in history (4D-2B-1)", async () => {
  const p = payload();
  p.jurisdictions.federal.payments.push(
    { id: "fut1", period: 4, amount: 4000, payment_date: "2026-12-15", reference: null, voided: false, future_dated: true });
  p.jurisdictions.federal.total = 4500;
  api.get.mockResolvedValue({ data: p });
  await mount();
  expect(text('[data-testid="estpay-future-fut1"]')).toBe("future-dated");
});
