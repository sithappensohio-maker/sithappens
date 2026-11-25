/**
 * Log Retail Sale treated every amount as merchandise and carved sales tax
 * out of it, so a month of daycare/boarding/training income from before the
 * app could not be entered without owing Ohio tax on it (owner, 2026-11-25).
 * The form now has a "No sales tax — this is service income" box. Mounted.
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
const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const flush = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await Promise.resolve(); }); };
const type = async (id, value) => {
  const el = q(id);
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  await act(async () => { set.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); });
};

beforeEach(async () => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2031, 5, 12, 12, 0));
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset();
  api.get.mockImplementation(async (url) => ({ data: url === "/retail-sales/categories" ? { categories: [] } : [] }));
  api.post.mockReset();
  api.post.mockResolvedValue({ data: {} });
  await act(async () => { root = createRoot(container); root.render(<Income />); });
  await flush();
  await act(async () => { q("retail-add-btn").click(); });
});
afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  jest.useRealTimers();
});

const fillAndSave = async () => {
  await type("retail-date", "2031-01-31");
  await type("retail-amount", "4200");
  await type("retail-description", "January income (before app)");
  await act(async () => { q("retail-save").click(); });
  await flush();
  return api.post.mock.calls.find(([url]) => url === "/retail-sales")[1];
};

test("ticking the box sends a back-dated sale with no sales tax", async () => {
  expect(q("retail-no-tax").checked).toBe(false);
  await act(async () => { q("retail-no-tax").click(); });
  const body = await fillAndSave();
  expect(body).toMatchObject({ date: "2031-01-31", amount: 4200, apply_tax: false });
});

test("left unticked, a sale is still merchandise with sales tax in it", async () => {
  const body = await fillAndSave();
  expect(body.apply_tax).toBe(true);
});
