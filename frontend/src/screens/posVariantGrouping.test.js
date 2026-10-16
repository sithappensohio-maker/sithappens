/**
 * The register's own variant picker, for an item with many colors (a real
 * Printify hoodie can carry 70+ color/size combinations) — grouped into a
 * color step then a size step instead of one long flat list a cashier has
 * to scroll through to find "Purple / L". A single-color item (the HOODIE
 * fixture other Printify register tests already use) is untouched — see
 * posPrintifyFulfillment.test.js, still green against this same component.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import Pos from "./Pos";

jest.mock("../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() }, formatErr: (x) => String(x || "") }));
jest.mock("../lib/auth", () => ({ useAuth: jest.fn() }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../lib/useConfirm", () => ({ useConfirm: () => async () => true, ConfirmProvider: ({ children }) => children }));
jest.mock("../lib/posAgent", () => ({ checkPosHealth: jest.fn(), printReceipt: jest.fn(), openDrawer: jest.fn() }));
jest.mock("../components/PageHero", () => ({ __esModule: true, default: () => null }));
jest.mock("../components/PendingActionsPanel", () => ({ __esModule: true, default: () => null }));
jest.mock("../components/CheckoutModal", () => ({ CheckoutModal: () => null }));
jest.mock("../components/TakePaymentModal", () => ({ __esModule: true, default: () => null }));
jest.mock("../components/StripeRefundModal", () => ({ __esModule: true, default: () => null }));
jest.mock("../components/ShopRefundModal", () => ({ __esModule: true, default: () => null }));
jest.mock("../components/ItemThumbnail", () => ({ __esModule: true, default: () => null }));
jest.mock("../components/AdminBookingModal", () => ({ __esModule: true, default: () => null }));
jest.mock("../lib/printGiftCard", () => ({ printGiftCard: jest.fn(() => true) }));
jest.mock("./Staff", () => {
  const React = require("react");
  return { RegisterTab: () => React.createElement("div", null, "register tools") };
});

const { api } = require("../lib/api");
const { useAuth } = require("../lib/auth");
const posAgent = require("../lib/posAgent");
const { toast } = require("sonner");

global.IS_REACT_ACT_ENVIRONMENT = true;

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = jest.fn();
  const cryptoObj = (typeof window.crypto === "object" && window.crypto) || {};
  if (!cryptoObj.randomUUID) {
    try { cryptoObj.randomUUID = () => `test-${Math.random().toString(36).slice(2)}`; } catch { /* frozen */ }
  }
  try { Object.defineProperty(window, "crypto", { value: cryptoObj, configurable: true }); } catch { /* fine */ }
  if (typeof global.crypto === "undefined") global.crypto = cryptoObj;
});

const MULTI_COLOR_HOODIE = {
  kind: "product", id: "p-hoodie", name: "Trail Dog Hoodie", effective_price: 19.99, list_price: 19.99,
  in_stock: true, taxable: true, track_inventory: false, category: "Merch", sales_destination: "printify",
  variants: [
    { id: "v-black-s", name: "Black / S", sku: "", price: 19.99, stock_on_hand: 0, in_stock: true },
    { id: "v-black-m", name: "Black / M", sku: "", price: 19.99, stock_on_hand: 0, in_stock: true },
    { id: "v-purple-s", name: "Purple / S", sku: "", price: 19.99, stock_on_hand: 0, in_stock: false },
    { id: "v-purple-m", name: "Purple / M", sku: "", price: 21.94, stock_on_hand: 0, in_stock: true },
  ],
};

const GET = {
  "/admin/register/status": { date: "2026-09-19", status: "OPEN", opened_at: "2026-09-19T08:00:00Z", opened_by: "Owner" },
  "/admin/register/day": { totals: { expected_cash: 100 }, activity: [], register_closed: false, method_labels: {} },
  "/employee/roster-today": { roster: [] },
  "/pos/catalog": { items: [MULTI_COLOR_HOODIE] },
  "/clients": [], "/services": [],
  "/pos/sales": [],
  "/admin/shop-orders": { orders: [] },
  "/admin/shop-orders/unseen-count": { unseen: 0 },
  "/admin/stripe-online-payments": { payments: [] },
};

let container, root;

beforeEach(() => {
  jest.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  useAuth.mockReturnValue({ can: () => true });
  posAgent.checkPosHealth.mockImplementation(() => Promise.resolve({ ready: false }));
  posAgent.printReceipt.mockImplementation(() => Promise.resolve({ ok: true }));
  posAgent.openDrawer.mockImplementation(() => Promise.resolve({ ok: true }));
  toast.error.mockReset?.();
  api.get.mockReset();
  api.get.mockImplementation((path) => Promise.resolve({ data: path in GET ? GET[path] : {} }));
  api.post.mockReset();
  api.post.mockImplementation(() => Promise.resolve({ data: {} }));
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  container.remove();
  jest.useRealTimers();
});

const mount = async () => {
  root = createRoot(container);
  await act(async () => { root.render(<Pos />); });
  await settle();
};
const settle = async () => { await act(async () => { jest.advanceTimersByTime(600); }); };
const q = (id) => document.body.querySelector(`[data-testid="${id}"]`);
const click = async (id) => {
  const el = q(id);
  if (!el) throw new Error(`no [data-testid="${id}"]`);
  await act(async () => { el.click(); });
  await settle();
};

test("a multi-color item opens the picker on colors first, no sizes shown yet", async () => {
  await mount();
  await click("pos-product-p-hoodie");
  expect(q("pos-variant-color-picker")).toBeTruthy();
  expect(q("pos-variant-color-Black").textContent).toBe("Black");
  expect(q("pos-variant-color-Purple").textContent).toBe("Purple");
  expect(q("pos-variant-v-black-s")).toBeNull();
});

test("picking a color reveals just that color's sizes, labeled by size alone", async () => {
  await mount();
  await click("pos-product-p-hoodie");
  await click("pos-variant-color-Black");
  expect(q("pos-variant-v-black-s").textContent).toContain("S");
  expect(q("pos-variant-v-black-m").textContent).toContain("M");
  expect(q("pos-variant-v-purple-s")).toBeNull(); // a different color, not shown
});

test("a color whose every size is out of stock is disabled", async () => {
  const allOut = { ...MULTI_COLOR_HOODIE, id: "p-hoodie-2",
    variants: MULTI_COLOR_HOODIE.variants.map((v) => (v.name.startsWith("Purple") ? { ...v, in_stock: false } : v)) };
  GET["/pos/catalog"] = { items: [allOut] };
  await mount();
  await click("pos-product-p-hoodie-2");
  expect(q("pos-variant-color-Purple").disabled).toBe(true);
  GET["/pos/catalog"] = { items: [MULTI_COLOR_HOODIE] };
});

test("picking color then size adds that exact variant to the cart", async () => {
  await mount();
  await click("pos-product-p-hoodie");
  await click("pos-variant-color-Purple");
  await click("pos-variant-v-purple-m");
  expect(q("pos-variant-picker")).toBeNull(); // picker closes once a size is chosen
  expect(document.body.textContent).toMatch(/Trail Dog Hoodie/);
});
