/**
 * Register checkout for a Printify item that's ALSO stocked on the shelf
 * (owner, 2026-10-18: "stock some of my printify items... so it doesn't
 * just auto make a new order"). When the shelf only partially covers the
 * cart quantity, the server refuses the sale with a structured 409
 * ("printify_stock_decision_needed") until the cashier picks ship-what's-
 * -on-hand-and-order-the-rest, or skip-the-shelf-and-order-it-all. This
 * must never surface for full stock (sells silently) or zero stock (falls
 * straight through to Printify, same as today) — only the genuinely
 * ambiguous partial case.
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

// Also stocked on the shelf — 1 on hand, so a cart of 3 is a genuine
// partial-stock decision.
const HOODIE = {
  kind: "product", id: "p-hoodie", name: "Trail Dog Hoodie", effective_price: 40.00, list_price: 40.00,
  in_stock: true, taxable: true, track_inventory: true, category: "Merch", sales_destination: "printify",
  variants: [{ id: "v-s", name: "Small", sku: "", price: 40.00, stock_on_hand: 1, in_stock: true }],
};

const priceCart = (lines) => {
  const subtotal = lines.reduce((n, l) => n + 40.00 * l.qty, 0);
  return {
    line_items: lines.map((l) => ({ ...l, amount: 0, taxable: true })),
    subtotal, discount_amount: 0, tax_amount: 0, tax_rate_pct: 0,
    taxable_subtotal: subtotal, total: subtotal,
  };
};

let container, root, posted, checkoutCallCount;

const GET = {
  "/admin/register/status": { date: "2026-09-19", status: "OPEN", opened_at: "2026-09-19T08:00:00Z", opened_by: "Owner" },
  "/admin/register/day": { totals: { expected_cash: 100 }, activity: [], register_closed: false, method_labels: {} },
  "/employee/roster-today": { roster: [] },
  "/pos/catalog": { items: [HOODIE] },
  "/clients": [], "/services": [],
  "/pos/sales": [],
  "/admin/shop-orders": { orders: [] },
  "/admin/shop-orders/unseen-count": { unseen: 0 },
  "/admin/stripe-online-payments": { payments: [] },
};

const STOCK_DECISION_409 = {
  response: {
    status: 409,
    data: {
      detail: "Some Printify items have stock on hand, but not enough to cover this order.",
      detail_object: {
        code: "printify_stock_decision_needed",
        message: "Some Printify items have stock on hand, but not enough to cover this order.",
        lines: [{ product_id: "p-hoodie", variant_id: "v-s", name: "Trail Dog Hoodie", variant_name: "Small", requested: 3, available: 1 }],
      },
    },
  },
};

beforeEach(() => {
  jest.useFakeTimers();
  posted = [];
  checkoutCallCount = 0;
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
      checkoutCallCount += 1;
      if (checkoutCallCount === 1) return Promise.reject(STOCK_DECISION_409);
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
const lastCheckout = () => posted.filter((p) => p.path === "/pos/sales" || p.path === "/pos/checkout").pop();

// Three units of the hoodie, which only has 1 in stock — a genuine
// partial-stock decision the cashier has to make. Re-selecting the same
// product/variant three times merges into the same cart line at qty 3
// (addItem), rather than three separate lines.
const addThreeHoodies = async () => {
  await click("pos-product-p-hoodie");
  await click("pos-variant-v-s");
  await click("pos-product-p-hoodie");
  await click("pos-variant-v-s");
  await click("pos-product-p-hoodie");
  await click("pos-variant-v-s");
  await click("pos-checkout-button");
  await click("printify-method-pickup");
  await click("printify-fulfillment-continue");
  await click("pos-tender-method-cash");
  await type("pos-tender-amount", "120.00");
  await type("pos-tender-cash-received", "120.00");
  await click("pos-tender-add");
  await click("pos-complete-sale");
};

test("a partial-stock shortfall opens the stock decision modal instead of completing the sale", async () => {
  await mount();
  await addThreeHoodies();
  // The modal overlays the tender screen rather than replacing it — same
  // as PrintifyFulfillmentModal already does — so the sale isn't lost,
  // just paused pending a decision.
  expect(q("printify-stock-decision-modal")).toBeTruthy();
  expect(q("pos-tender-screen")).toBeTruthy();
  // Reflects the server's own shortfall numbers, not a frontend guess.
  expect(document.body.textContent).toContain("1 in stock");
  expect(document.body.textContent).toContain("3 requested");
});

test("choosing to ship what's on hand resubmits with printify_use_stock true on that line", async () => {
  await mount();
  await addThreeHoodies();
  await click("printify-stock-use-stock-p-hoodie:v-s");
  await click("printify-stock-decision-continue");

  expect(q("printify-stock-decision-modal")).toBeNull();
  expect(checkoutCallCount).toBe(2);
  const line = lastCheckout().body.lines.find((l) => l.product_id === "p-hoodie");
  expect(line.printify_use_stock).toBe(true);
  expect(line.qty).toBe(3); // the sale still records the full quantity sold
});

test("choosing to order it all from Printify resubmits with printify_use_stock false", async () => {
  await mount();
  await addThreeHoodies();
  await click("printify-stock-order-all-p-hoodie:v-s");
  await click("printify-stock-decision-continue");

  expect(checkoutCallCount).toBe(2);
  const line = lastCheckout().body.lines.find((l) => l.product_id === "p-hoodie");
  expect(line.printify_use_stock).toBe(false);
});

test("Continue stays disabled until every flagged line has a choice", async () => {
  await mount();
  await addThreeHoodies();
  expect(q("printify-stock-decision-continue").disabled).toBe(true);
  await click("printify-stock-use-stock-p-hoodie:v-s");
  expect(q("printify-stock-decision-continue").disabled).toBe(false);
});
