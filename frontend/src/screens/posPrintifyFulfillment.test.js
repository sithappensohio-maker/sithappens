/**
 * Register checkout for a Printify print-on-demand item: the register must
 * ask pickup-or-ship (and, for ship, a real address) BEFORE opening the
 * tender panel, and must send that choice on the actual sale — the server
 * refuses the sale without it (see backend's _create_pos_sale_impl). A cart
 * with no Printify item must never see this step at all.
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

const HOODIE = {
  kind: "product", id: "p-hoodie", name: "Trail Dog Hoodie", effective_price: 40.00, list_price: 40.00,
  in_stock: true, taxable: true, track_inventory: false, category: "Merch", sales_destination: "printify",
  variants: [{ id: "v-s", name: "Small", sku: "", price: 40.00, stock_on_hand: 0, in_stock: true }],
};

const VARIANT_PRICE = { "v-s": 40.00 };
// Mirrors the real server: 0 with no choice made yet, a fixed mock rate
// once EITHER method is actually chosen (pickup ships to the business,
// not nowhere — owner, 2026-10-17: "i would still need to pay shipping
// to the store") — proves the frontend reads/displays whatever the
// server sends rather than ever computing its own shipping number.
const MOCK_SHIPPING = 4.99;
const priceCart = (lines, fulfillment) => {
  const unitPrice = (l) => l.variant_id ? (VARIANT_PRICE[l.variant_id] || 0) : ({ "p-mug": 18.00 }[l.product_id] || 0);
  const taxable = lines.reduce((n, l) => n + unitPrice(l) * l.qty, 0);
  const subtotal = Math.round(taxable * 100) / 100;
  const shipping = fulfillment?.method === "ship" || fulfillment?.method === "pickup" ? MOCK_SHIPPING : 0;
  return {
    line_items: lines.map((l) => ({ ...l, amount: 0, taxable: true })),
    subtotal, discount_amount: 0, tax_amount: 0, tax_rate_pct: 0,
    taxable_subtotal: subtotal, total: Math.round((subtotal + shipping) * 100) / 100,
    ...(shipping > 0 ? { printify_shipping_amount: shipping } : {}),
  };
};

let container, root, posted;

const GET = {
  "/admin/register/status": { date: "2026-09-19", status: "OPEN", opened_at: "2026-09-19T08:00:00Z", opened_by: "Owner" },
  "/admin/register/day": { totals: { expected_cash: 100 }, activity: [], register_closed: false, method_labels: {} },
  "/employee/roster-today": { roster: [] },
  "/pos/catalog": { items: [MUG, HOODIE] },
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
      return Promise.resolve({ data: priceCart(body?.lines || [], body?.printify_fulfillment) });
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
// PrintifyFulfillmentModal (like WalkInModal) renders via createPortal into
// document.body, not under `container` — query body so portal content and
// in-tree content both resolve through the same helper.
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

test("a cart with no Printify item skips the fulfillment step entirely", async () => {
  await mount();
  await click("pos-product-p-mug");
  await click("pos-checkout-button");
  expect(q("printify-fulfillment-modal")).toBeNull();
  expect(q("pos-tender-screen")).toBeTruthy();
});

test("checkout on a Printify item opens the fulfillment choice before the tender screen", async () => {
  await mount();
  await click("pos-product-p-hoodie");
  await click("pos-variant-v-s");
  await click("pos-checkout-button");
  expect(q("printify-fulfillment-modal")).toBeTruthy();
  expect(q("pos-tender-screen")).toBeNull();
});

test("Ship to Them can't continue until the address is filled in", async () => {
  await mount();
  await click("pos-product-p-hoodie");
  await click("pos-variant-v-s");
  await click("pos-checkout-button");
  await click("printify-method-ship");
  expect(q("printify-fulfillment-continue").disabled).toBe(true);
  await type("printify-first-name", "Jordan");
  await type("printify-last-name", "Rivers");
  await type("printify-email", "jordan@example.com");
  await type("printify-address1", "1 Main St");
  await type("printify-city", "Columbus");
  await type("printify-zip", "43215");
  expect(q("printify-fulfillment-continue").disabled).toBe(false);
});

test("picking up sends pickup with no address on the actual sale", async () => {
  await mount();
  await click("pos-product-p-hoodie");
  await click("pos-variant-v-s");
  await click("pos-checkout-button");
  await click("printify-method-pickup");
  await click("printify-fulfillment-continue");
  expect(q("printify-fulfillment-modal")).toBeNull();
  expect(q("pos-tender-screen")).toBeTruthy();

  // $40 item + $4.99 Printify shipping to the business — pickup is priced
  // the same as ship now (see the dedicated re-pricing test below).
  await click("pos-tender-method-cash");
  await type("pos-tender-amount", "44.99");
  await type("pos-tender-cash-received", "44.99");
  await click("pos-tender-add");
  await click("pos-complete-sale");

  const sale = lastSale();
  expect(sale.body.printify_fulfillment).toEqual({ method: "pickup", shipping_address: null });
});

test("shipping sends the real address on the actual sale", async () => {
  await mount();
  await click("pos-product-p-hoodie");
  await click("pos-variant-v-s");
  await click("pos-checkout-button");
  await click("printify-method-ship");
  await type("printify-first-name", "Jordan");
  await type("printify-last-name", "Rivers");
  await type("printify-email", "jordan@example.com");
  await type("printify-address1", "1 Main St");
  await type("printify-city", "Columbus");
  await type("printify-zip", "43215");
  await click("printify-fulfillment-continue");

  // Total now includes the mocked Printify shipping rate ($40 + $4.99) —
  // confirmPrintifyFulfillment re-prices with the real choice before the
  // tender screen opens, so this is what the cashier actually owes.
  await click("pos-tender-method-cash");
  await type("pos-tender-amount", "44.99");
  await type("pos-tender-cash-received", "44.99");
  await click("pos-tender-add");
  await click("pos-complete-sale");

  const sale = lastSale();
  expect(sale.body.printify_fulfillment.method).toBe("ship");
  expect(sale.body.printify_fulfillment.shipping_address).toMatchObject({
    first_name: "Jordan", last_name: "Rivers", email: "jordan@example.com",
    address1: "1 Main St", city: "Columbus", zip: "43215", country: "US",
  });
});

// Owner request: "i would still like it to be able to have stuff shipped
// or picked up they pay shipping based on printifys shipping" — originally
// "pickup stays free, ship charges the server's own real Printify rate,"
// corrected 2026-10-17 (owner: "i would still need to pay shipping to the
// store") — pickup ships to the business, not nowhere, so it's charged
// the same real rate.
test("choosing Ship re-prices with Printify's own shipping charge before the tender screen opens", async () => {
  await mount();
  await click("pos-product-p-hoodie");
  await click("pos-variant-v-s");
  await click("pos-checkout-button");
  await click("printify-method-ship");
  await type("printify-first-name", "Jordan");
  await type("printify-last-name", "Rivers");
  await type("printify-email", "jordan@example.com");
  await type("printify-address1", "1 Main St");
  await type("printify-city", "Columbus");
  await type("printify-zip", "43215");
  await click("printify-fulfillment-continue");

  // Both the tender screen's own total and the amount pre-filled in for
  // the cashier reflect the real $40 item + $4.99 Printify shipping —
  // never the stale pre-shipping total from before the choice was made.
  expect(q("pos-tender-total").textContent).toContain("44.99");
  expect(q("pos-tender-amount").value).toBe("44.99");
});

// Owner, 2026-10-17: "i would still need to pay shipping to the store so
// what is the proper way to handle that" — Printify always ships
// SOMEWHERE; pickup just means "to us," not free, so it re-prices exactly
// like Ship does (see the sibling test just above).
test("pickup also re-prices with Printify's own shipping charge before the tender screen opens", async () => {
  await mount();
  await click("pos-product-p-hoodie");
  await click("pos-variant-v-s");
  await click("pos-checkout-button");
  await click("printify-method-pickup");
  await click("printify-fulfillment-continue");

  expect(q("pos-tender-total").textContent).toContain("44.99");
  expect(q("pos-tender-amount").value).toBe("44.99");
});

test("the Shipping (Printify) line appears in the cart summary once a ship choice is active", async () => {
  await mount();
  await click("pos-product-p-hoodie");
  await click("pos-variant-v-s");
  await click("pos-checkout-button");
  await click("printify-method-ship");
  await type("printify-first-name", "Jordan");
  await type("printify-last-name", "Rivers");
  await type("printify-email", "jordan@example.com");
  await type("printify-address1", "1 Main St");
  await type("printify-city", "Columbus");
  await type("printify-zip", "43215");
  await click("printify-fulfillment-continue");
  // Cancel back out of tendering to the cart view — the choice itself
  // (and the shipping line it earns) survives, so the cashier can review
  // it before trying payment again. The Cancel button has no testid of
  // its own; found by its label, same as other untested buttons here.
  const cancelBtn = [...document.body.querySelectorAll("button")].find((b) => b.textContent.trim() === "Cancel");
  await act(async () => { cancelBtn.click(); });

  expect(q("pos-cart-printify-shipping")).toBeTruthy();
  expect(q("pos-cart-printify-shipping").textContent).toContain("4.99");
});

test("the Shipping (Printify) line appears for a pickup choice too, not just ship", async () => {
  await mount();
  await click("pos-product-p-hoodie");
  await click("pos-variant-v-s");
  await click("pos-checkout-button");
  await click("printify-method-pickup");
  await click("printify-fulfillment-continue");
  const cancelBtn = [...document.body.querySelectorAll("button")].find((b) => b.textContent.trim() === "Cancel");
  await act(async () => { cancelBtn.click(); });

  expect(q("pos-cart-printify-shipping")).toBeTruthy();
  expect(q("pos-cart-printify-shipping").textContent).toContain("4.99");
});
