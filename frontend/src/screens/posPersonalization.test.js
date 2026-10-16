/**
 * Register checkout for a personalized Printify item (e.g. a pet tag with
 * its own Name/Phone fields): the register must ask for every declared
 * field BEFORE the item reaches the cart, refuse to add it with any field
 * blank, show staff what was entered right there in the cart line (so it
 * can be checked before the sale is taken), and send it on the actual
 * sale. A cart with no personalized item must never see any of this.
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

const MUG = { kind: "product", id: "p-mug", name: "Trail Dog Mug", effective_price: 18.00, list_price: 18.00,
              in_stock: true, taxable: true, track_inventory: false, category: "Merch", sales_destination: "internal" };

const PET_TAG = {
  kind: "product", id: "p-tag", name: "Pet ID Tag", effective_price: 15.99, list_price: 15.99,
  in_stock: true, taxable: true, track_inventory: false, category: "Merch", sales_destination: "printify",
  variants: [{ id: "v-1in", name: "1\"", sku: "", price: 15.99, stock_on_hand: 0, in_stock: true }],
  personalization_fields: ["Name", "Phone"],
};

const priceCart = (lines) => {
  const unitPrice = (l) => l.product_id === "p-tag" ? 15.99 : ({ "p-mug": 18.00 }[l.product_id] || 0);
  const taxable = lines.reduce((n, l) => n + unitPrice(l) * l.qty, 0);
  const subtotal = Math.round(taxable * 100) / 100;
  return {
    line_items: lines.map((l) => ({ ...l, amount: 0, taxable: true })),
    subtotal, discount_amount: 0, tax_amount: 0, tax_rate_pct: 0,
    taxable_subtotal: subtotal, total: subtotal,
  };
};

let container, root, posted;

const GET = {
  "/admin/register/status": { date: "2026-09-19", status: "OPEN", opened_at: "2026-09-19T08:00:00Z", opened_by: "Owner" },
  "/admin/register/day": { totals: { expected_cash: 100 }, activity: [], register_closed: false, method_labels: {} },
  "/employee/roster-today": { roster: [] },
  "/pos/catalog": { items: [MUG, PET_TAG] },
  "/clients": [], "/services": [],
  "/pos/sales": [],
  "/admin/shop-orders": { orders: [] },
  "/admin/shop-orders/unseen-count": { unseen: 0 },
  "/admin/stripe-online-payments": { payments: [] },
};

beforeEach(() => {
  jest.useFakeTimers();
  posted = [];
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
  api.post.mockImplementation((path, body) => {
    posted.push({ path, body });
    if (String(path).includes("/pos/sales/preview") || String(path).includes("/pos/checkout/preview")) {
      return Promise.resolve({ data: priceCart(body?.lines || []) });
    }
    if (String(path) === "/pos/sales" || String(path) === "/pos/checkout") {
      return Promise.resolve({ data: { ok: true, pos_sale_id: "sale-1", sale: { id: "sale-1" } } });
    }
    return Promise.resolve({ data: {} });
  });
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
const type = async (id, value) => {
  const el = q(id);
  if (!el) throw new Error(`no [data-testid="${id}"]`);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  await act(async () => {
    setter.call(el, String(value));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
};
const lastSale = () => posted.filter((p) => p.path === "/pos/sales" || p.path === "/pos/checkout").pop();

test("a plain item never opens the personalization form", async () => {
  await mount();
  await click("pos-product-p-mug");
  expect(q("pos-personalization-form")).toBeNull();
  expect(q("pos-cart-line")).toBeTruthy();
});

test("picking a personalized item's size opens the personalization form instead of adding it", async () => {
  await mount();
  await click("pos-product-p-tag");
  await click("pos-variant-v-1in");
  expect(q("pos-personalization-form")).toBeTruthy();
  // Not added to the cart yet — the form isn't a confirmation, it's a gate.
  expect(q("pos-cart-line")).toBeNull();
});

test("the form shows a field for every declared name", async () => {
  await mount();
  await click("pos-product-p-tag");
  await click("pos-variant-v-1in");
  expect(q("pos-personalization-Name")).toBeTruthy();
  expect(q("pos-personalization-Phone")).toBeTruthy();
});

test("adding with a field blank refuses and keeps the form open", async () => {
  await mount();
  await click("pos-product-p-tag");
  await click("pos-variant-v-1in");
  await type("pos-personalization-Name", "Rex");
  await click("pos-personalization-add");
  expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Phone"));
  expect(q("pos-personalization-form")).toBeTruthy();
  expect(q("pos-cart-line")).toBeNull();
});

test("filling in every field adds one cart line showing what was entered", async () => {
  await mount();
  await click("pos-product-p-tag");
  await click("pos-variant-v-1in");
  await type("pos-personalization-Name", "  Rex  ");
  await type("pos-personalization-Phone", "330-555-0101");
  await click("pos-personalization-add");
  expect(q("pos-personalization-form")).toBeNull();
  const lines = document.body.querySelectorAll('[data-testid="pos-cart-line"]');
  expect(lines.length).toBe(1);
  const summary = q("pos-cart-personalization-0");
  expect(summary.textContent).toContain("Name: Rex");
  expect(summary.textContent).toContain("Phone: 330-555-0101");
});

test("adding the same tag again opens a fresh form rather than incrementing quantity", async () => {
  await mount();
  await click("pos-product-p-tag");
  await click("pos-variant-v-1in");
  await type("pos-personalization-Name", "Rex");
  await type("pos-personalization-Phone", "330-555-0101");
  await click("pos-personalization-add");
  await click("pos-product-p-tag");
  await click("pos-variant-v-1in");
  await type("pos-personalization-Name", "Buddy");
  await type("pos-personalization-Phone", "330-555-0202");
  await click("pos-personalization-add");
  const lines = document.body.querySelectorAll('[data-testid="pos-cart-line"]');
  expect(lines.length).toBe(2);
  expect(q("pos-cart-personalization-0").textContent).toContain("Rex");
  expect(q("pos-cart-personalization-1").textContent).toContain("Buddy");
});

test("the real sale carries the personalization through", async () => {
  await mount();
  await click("pos-product-p-tag");
  await click("pos-variant-v-1in");
  await type("pos-personalization-Name", "Rex");
  await type("pos-personalization-Phone", "330-555-0101");
  await click("pos-personalization-add");
  await click("pos-checkout-button");
  await click("printify-method-pickup");
  await click("printify-fulfillment-continue");
  await click("pos-tender-method-cash");
  await type("pos-tender-amount", "15.99");
  await type("pos-tender-cash-received", "20.00");
  await click("pos-tender-add");
  await click("pos-complete-sale");
  const sale = lastSale();
  expect(sale.body.lines[0].personalization).toEqual({ Name: "Rex", Phone: "330-555-0101" });
});
