/**
 * The Income list asks the server only for the newest 5,000 rows, whatever period
 * is picked, so an older month never shows (audit #23). The list now asks for the
 * selected range. Mounted.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import Income from "./Income";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(async () => ({ data: [] })), post: jest.fn(), put: jest.fn(), delete: jest.fn(), defaults: { baseURL: "/api" } },
  formatErr: (e) => String(e || ""),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("../lib/useConfirm", () => ({ useConfirm: () => jest.fn(async () => true), usePromptDialog: () => jest.fn(async () => null) }));
jest.mock("../lib/auth", () => ({ useAuth: () => ({ can: () => true, user: { role: "admin" } }) }));
jest.mock("../components/PageHero", () => () => null);
jest.mock("../components/admin/AdminTabs", () => () => null);
jest.mock("../components/CollapsibleDateGroups", () => () => null);
jest.mock("../components/Lightbox", () => () => null);
jest.mock("./AccountsReceivable", () => () => null);
jest.mock("./SalesTaxFiling", () => () => null);
jest.mock("../components/TaxCenter", () => () => null);
jest.mock("../components/SalesTaxDueTile", () => ({ FINANCE_TARGET_KEY: "fin" }));
jest.mock("../components/TakePaymentModal", () => () => null);
jest.mock("../components/FinancialCorrectionModal", () => () => null);
jest.mock("../lib/imageCompress", () => ({ compressImage: jest.fn() }));

const { api } = require("../lib/api");
global.IS_REACT_ACT_ENVIRONMENT = true;

let container, root;
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2031, 5, 12, 12, 0));
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockClear();
});
afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  jest.useRealTimers();
});
const flush = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await Promise.resolve(); }); };

test("the income list asks the server for the selected period, not just the newest rows", async () => {
  await act(async () => {
    root = createRoot(container);
    root.render(<Income />);
  });
  await flush();
  const txCalls = api.get.mock.calls.filter(([url]) => url === "/transactions");
  expect(txCalls.length).toBeGreaterThan(0);
  const params = txCalls[txCalls.length - 1][1]?.params || {};
  expect(params.start_date).toBeTruthy();
  expect(params.end_date).toBeTruthy();
});
