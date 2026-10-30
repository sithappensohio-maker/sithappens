/* The Today feed's bills card opens Finance on its Bills tab; Finance opened
 * any other way still starts on Transactions. Mounts the real Finance screen.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import Income from "./Income";
import { runTodayBrainCTA, screenTabFor } from "../lib/todayBrain";

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

const CARD = { id: "bills-due:abc", kind: "bill_due", priority: "warn", title: "1 bill due soon — $80.00",
  cta: { type: "open_screen", screen: "income", tab: "bills" } };

let container; let root;
beforeEach(() => {
  sessionStorage.clear();
  api.get.mockImplementation(async (path) => (path === "/admin/bills" ? { data: { bills: [] } } : { data: [] }));
  container = document.createElement("div");
  document.body.appendChild(container);
});
afterEach(() => { act(() => root?.unmount()); container.remove(); });

const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const mount = async () => {
  root = createRoot(container);
  await act(async () => { root.render(<Income />); });
  for (let i = 0; i < 10; i += 1) await act(async () => { await Promise.resolve(); });
};

test("opening the bills card lands on Finance's Bills tab, once", async () => {
  const onNavigate = jest.fn();
  runTodayBrainCTA(CARD, { onNavigate });
  expect(onNavigate).toHaveBeenCalledWith("income");
  await mount();
  expect(q("bills-tab")).not.toBeNull();
  expect(screenTabFor("income")).toBeNull();
});

test("Finance opened any other way starts on Transactions", async () => {
  await mount();
  expect(q("bills-tab")).toBeNull();
});
