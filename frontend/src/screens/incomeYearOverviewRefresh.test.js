/**
 * After a refund on the Income screen the monthly Revenue Trend chart and the
 * This Year totals kept the old number until the page was reopened: their
 * data (/transactions/year-overview) was loaded once and never again (owner,
 * 2026-11-25: "the refund didn't lower the bar graph"). Mounted.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import Income from "./Income";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn(), defaults: { baseURL: "/api" } },
  formatErr: (e) => String(e || ""),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("../lib/useConfirm", () => ({ useConfirm: () => jest.fn(async () => true), usePromptDialog: () => jest.fn(async () => null) }));
jest.mock("../lib/auth", () => ({ useAuth: () => ({ can: () => true, user: { role: "admin" } }) }));
jest.mock("../components/PageHero", () => () => null);
jest.mock("../components/admin/AdminTabs", () => () => null);
// Just the rows, so the Adjust button on a locked visit is on screen.
jest.mock("../components/CollapsibleDateGroups", () => ({ rows, renderRow }) => <div>{(rows || []).map((r) => renderRow(r))}</div>);
jest.mock("../components/Lightbox", () => () => null);
jest.mock("./AccountsReceivable", () => () => null);
jest.mock("./SalesTaxFiling", () => () => null);
jest.mock("../components/TaxCenter", () => () => null);
jest.mock("../components/SalesTaxDueTile", () => ({ FINANCE_TARGET_KEY: "fin" }));
jest.mock("../components/TakePaymentModal", () => () => null);
// Stands in for the refund form: one button that reports "saved".
jest.mock("../components/FinancialCorrectionModal", () => ({ onSaved }) => (
  <button type="button" data-testid="fake-refund-saved" onClick={() => onSaved({})}>saved</button>
));
jest.mock("../lib/imageCompress", () => ({ compressImage: jest.fn() }));

const { api } = require("../lib/api");
global.IS_REACT_ACT_ENVIRONMENT = true;

const VISIT = {
  id: "bk-1", date: "2031-06-10", dog_id: "d-1", dog_name: "Mick", client_name: "Pat",
  service_type: "boarding", service_name: "Boarding", status: "completed", payment_status: "paid",
  payment_method: "cash", actual_price: 100, amount_paid: 100, cash_revenue: 100, financial_locked: true,
};

let container, root;
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2031, 5, 12, 12, 0));
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset();
  api.get.mockImplementation(async (url) => ({ data: url === "/transactions" ? [VISIT] : [] }));
});
afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  jest.useRealTimers();
});
const flush = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await Promise.resolve(); }); };
const yearCalls = () => api.get.mock.calls.filter(([url]) => url === "/transactions/year-overview").length;

test("a saved refund reloads the yearly chart data, not just the list", async () => {
  await act(async () => {
    root = createRoot(container);
    root.render(<Income />);
  });
  await flush();
  expect(yearCalls()).toBe(1);
  const adjust = [...container.querySelectorAll("button")].find((b) => b.title === "Adjust locked financial record");
  expect(adjust).toBeTruthy();
  await act(async () => { adjust.click(); });
  await act(async () => { container.querySelector('[data-testid="fake-refund-saved"]').click(); });
  await flush();
  expect(yearCalls()).toBe(2);
});
