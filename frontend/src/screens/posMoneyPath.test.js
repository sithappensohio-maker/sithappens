/**
 * The register's money path, driven for real.
 *
 * This is the screen that takes money, and until now nothing tested it doing
 * that — PosNavigation covers layout, RegisterHub covers the drawer tile, and
 * everything else in this folder reads component source as text, which cannot
 * execute a line. That is how a checkout screen shipped that crashed on open,
 * and how a sale could leave a stale drawer figure.
 *
 * So these mount the real component and click through it: add a product, see
 * the total, open the tender screen, pay, complete the sale. The assertions
 * are about MONEY — what the customer is charged, what the request says, what
 * cannot be submitted — not about markup.
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

// One taxable product at a price whose tax does not come out round, so a
// rounding mistake shows up instead of hiding behind a tidy number.
const WIPES = { kind: "product", id: "p-wipes", name: "Ear Wipes", effective_price: 12.99, list_price: 12.99,
                in_stock: true, taxable: true, track_inventory: false, category: "Care" };
const TOY = { kind: "product", id: "p-toy", name: "Rope Toy", effective_price: 7.00, list_price: 7.00,
              in_stock: true, taxable: true, track_inventory: false, category: "Care" };

// What the SERVER says the cart costs. The screen must show this, never its
// own arithmetic — the server is the one that will actually charge it.
const priceCart = (lines) => {
  const subtotal = lines.reduce((n, l) => n + ({ "p-wipes": 12.99, "p-toy": 7.00 }[l.product_id] || 0) * l.qty, 0);
  const tax = Math.round(subtotal * 0.0675 * 100) / 100;
  return {
    line_items: lines.map((l) => ({ ...l, amount: 0, taxable: true })),
    subtotal: Math.round(subtotal * 100) / 100,
    discount_amount: 0, tax_amount: tax, tax_rate_pct: 6.75,
    taxable_subtotal: Math.round(subtotal * 100) / 100,
    total: Math.round((subtotal + tax) * 100) / 100,
  };
};

// Three sold on Monday, one already back — so the screen has to show what is
// LEFT, not what was bought.
const RETURN_PREVIEW = {
  sale_id: "sale-1", receipt_number: "AB12CD34", business_date: "2026-09-16",
  days_old: 3, window_days: 30, can_return: true, blocked_reason: null,
  lines: [
    { line_index: 0, description: "Ear Wipes", kind: "retail", qty: 3, returned_qty: 1,
      remaining_qty: 2, unit_price: 12.99, returnable: true, not_returnable_reason: null },
    { line_index: 1, description: "Nail trim", kind: "custom", qty: 1, returned_qty: 0,
      remaining_qty: 1, unit_price: 15, returnable: false,
      not_returnable_reason: "Services and prepaid packs are not returned here — void the sale instead." },
  ],
  tenders: [{ method: "cash", amount: 32.03 }],
};

let container, root, posted;

const GET = {
  "/admin/register/status": { date: "2026-09-19", status: "OPEN", opened_at: "2026-09-19T08:00:00Z", opened_by: "Owner" },
  "/admin/register/day": { totals: { expected_cash: 100 }, activity: [], register_closed: false, method_labels: {} },
  "/employee/roster-today": { roster: [] },
  "/pos/catalog": { items: [WIPES, TOY] },
  "/clients": [], "/services": [],
  "/pos/sales": [{ id: "sale-1", receipt_number: "AB12CD34", client_name: "Dana",
                   status: "completed", total: 32.03, created_at: "2026-09-19T10:00:00Z" }],
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
  api.get.mockImplementation((path) => {
    if (String(path).includes("/return-preview")) return Promise.resolve({ data: RETURN_PREVIEW });
    return Promise.resolve({ data: path in GET ? GET[path] : {} });
  });
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
const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const all = (id) => [...container.querySelectorAll(`[data-testid="${id}"]`)];
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
const text = () => container.textContent;
const lastSale = () => posted.filter((p) => p.path === "/pos/sales" || p.path === "/pos/checkout").pop();

// ------------------------------------------------------------------ mounting

test("the register mounts and shows its catalog", async () => {
  await mount();
  expect(q("pos-product-p-wipes")).toBeTruthy();
  expect(text()).toContain("Ear Wipes");
});

test("it survives a catalog that fails to load", async () => {
  api.get.mockImplementation((path) =>
    String(path) === "/pos/catalog" ? Promise.reject(new Error("down")) : Promise.resolve({ data: GET[path] ?? {} }));
  await mount();
  expect(q("pos-checkout-button")).toBeTruthy();
});

// ------------------------------------------------------------------ the cart

test("adding a product prices the cart on the SERVER, tax and all", async () => {
  await mount();
  await click("pos-product-p-wipes");
  expect(all("pos-cart-line")).toHaveLength(1);
  // 12.99 + 6.75% = 13.87 — the screen must show what the server returned
  expect(q("pos-cart-subtotal").textContent).toContain("12.99");
  expect(q("pos-cart-tax").textContent).toContain("0.88");
  expect(q("pos-checkout-button").textContent).toContain("13.87");
});

test("the preview asks the server about exactly what is in the cart", async () => {
  await mount();
  await click("pos-product-p-wipes");
  await click("pos-product-p-toy");
  const preview = posted.filter((p) => String(p.path).includes("preview")).pop();
  const lines = preview.body.lines.map((l) => [l.kind, l.product_id, l.qty]);
  expect(lines).toEqual(expect.arrayContaining([
    ["retail", "p-wipes", 1], ["retail", "p-toy", 1],
  ]));
});

test("an empty cart cannot be checked out", async () => {
  await mount();
  expect(q("pos-checkout-button").disabled).toBe(true);
});

test("clearing the cart empties it", async () => {
  await mount();
  await click("pos-product-p-wipes");
  expect(all("pos-cart-line")).toHaveLength(1);
  await click("pos-clear-cart");
  expect(all("pos-cart-line")).toHaveLength(0);
});

// ---------------------------------------------------------------- the tender

const openTender = async () => {
  await mount();
  await click("pos-product-p-wipes");
  await click("pos-checkout-button");
  expect(q("pos-tender-screen")).toBeTruthy();
};

test("the tender screen asks for the server's total", async () => {
  await openTender();
  expect(q("pos-tender-total").textContent).toContain("13.87");
});

test("the sale cannot complete until the money is all there", async () => {
  await openTender();
  expect(q("pos-complete-sale").disabled).toBe(true);
  await type("pos-tender-amount", "5.00");
  await click("pos-tender-add");
  expect(q("pos-complete-sale").disabled).toBe(true);   // 8.87 still owing
  expect(q("pos-tender-remaining").textContent).toContain("8.87");
});

test("a cash sale posts the right money and shows the change", async () => {
  await openTender();
  await click("pos-tender-method-cash");
  await type("pos-tender-amount", "13.87");
  await type("pos-tender-cash-received", "20");
  await click("pos-tender-add");
  expect(q("pos-change-due").textContent).toContain("6.13");
  expect(q("pos-complete-sale").disabled).toBe(false);
  await click("pos-complete-sale");

  const sale = lastSale();
  expect(sale).toBeTruthy();
  expect(sale.body.tenders).toHaveLength(1);
  expect(sale.body.tenders[0]).toMatchObject({ method: "cash", amount: 13.87, tendered_amount: 20 });
  expect(sale.body.lines.map((l) => l.product_id)).toEqual(["p-wipes"]);
  expect(sale.body.idempotency_key).toBeTruthy();
});

test("a split tender adds up to the total and both parts are sent", async () => {
  await openTender();
  await click("pos-tender-method-card");
  await type("pos-tender-amount", "10.00");
  await click("pos-tender-add");
  await click("pos-tender-method-cash");
  await type("pos-tender-amount", "3.87");
  await type("pos-tender-cash-received", "3.87");
  await click("pos-tender-add");

  expect(all("pos-tender-row")).toHaveLength(2);
  expect(q("pos-complete-sale").disabled).toBe(false);
  await click("pos-complete-sale");

  const sale = lastSale();
  const paid = sale.body.tenders.reduce((n, t) => n + Number(t.amount), 0);
  expect(Math.round(paid * 100) / 100).toBe(13.87);
  expect(sale.body.tenders.map((t) => t.method).sort()).toEqual(["card", "cash"]);
});

test("removing a tender puts the money back on the bill", async () => {
  await openTender();
  await click("pos-tender-method-card");
  await type("pos-tender-amount", "13.87");
  await click("pos-tender-add");
  expect(q("pos-complete-sale").disabled).toBe(false);
  await click("pos-tender-remove-0");
  expect(q("pos-complete-sale").disabled).toBe(true);
  expect(all("pos-tender-row")).toHaveLength(0);
});

test("one sale is posted per completed sale, not two", async () => {
  // A double-submit at the counter is a double charge. The key is per-sale,
  // and the button must not fire twice.
  await openTender();
  await click("pos-tender-method-card");
  await type("pos-tender-amount", "13.87");
  await click("pos-tender-add");
  await click("pos-complete-sale");
  const sales = posted.filter((p) => p.path === "/pos/sales" || p.path === "/pos/checkout");
  expect(sales).toHaveLength(1);
});

test("a refused sale surfaces the server's reason and does not pretend it worked", async () => {
  await openTender();
  api.post.mockImplementation((path, body) => {
    posted.push({ path, body });
    if (String(path).includes("preview")) return Promise.resolve({ data: priceCart(body?.lines || []) });
    return Promise.reject({ response: { data: { detail: "Open the register before taking cash payments." } } });
  });
  await click("pos-tender-method-cash");
  await type("pos-tender-amount", "13.87");
  await type("pos-tender-cash-received", "13.87");
  await click("pos-tender-add");
  await click("pos-complete-sale");
  expect(toast.error).toHaveBeenCalled();
  const said = toast.error.mock.calls.flat().join(" ");
  expect(said).toContain("Open the register");
});

// ------------------------------------------------------------------ the tax

test("a cart of taxable goods with tax switched off says so", async () => {
  api.post.mockImplementation((path, body) => {
    posted.push({ path, body });
    if (String(path).includes("preview")) {
      return Promise.resolve({ data: { ...priceCart(body?.lines || []), tax_amount: 0, tax_rate_pct: 0, total: 12.99 } });
    }
    return Promise.resolve({ data: { ok: true, pos_sale_id: "s" } });
  });
  await mount();
  await click("pos-product-p-wipes");
  expect(q("pos-no-tax-notice")).toBeTruthy();
  expect(q("pos-no-tax-notice").textContent).toMatch(/Settings/);
});

test("nothing taxable in the cart means no scary notice", async () => {
  api.post.mockImplementation((path, body) => {
    posted.push({ path, body });
    if (String(path).includes("preview")) {
      return Promise.resolve({ data: { ...priceCart(body?.lines || []), taxable_subtotal: 0, tax_amount: 0, total: 12.99 } });
    }
    return Promise.resolve({ data: { ok: true, pos_sale_id: "s" } });
  });
  await mount();
  await click("pos-product-p-wipes");
  expect(q("pos-no-tax-notice")).toBeFalsy();
});

// ----------------------------------------------------------------- returns

const openReturns = async () => {
  await mount();
  await click("pos-recent-sales-toggle");
  await click("pos-return-sale-1");
  expect(q("pos-return-panel")).toBeTruthy();
};

test("a receipt can be looked up instead of hunting through today", async () => {
  await mount();
  await click("pos-recent-sales-toggle");
  await type("pos-receipt-search", "AB12");
  await click("pos-receipt-find");
  const lookup = api.get.mock.calls.find(([p, cfg]) => String(p) === "/pos/sales" && cfg?.params?.receipt);
  expect(lookup).toBeTruthy();
  expect(lookup[1].params.receipt).toBe("AB12");
});

test("the return panel shows what is LEFT, not what was sold", async () => {
  await openReturns();
  const line = q("pos-return-line-0");
  expect(line.textContent).toContain("2 of 3 left to return");
  expect(q("pos-return-panel").textContent).toContain("3 days ago");
});

test("a service line cannot be returned and says why", async () => {
  await openReturns();
  expect(q("pos-return-qty-1")).toBeFalsy();
  expect(q("pos-return-line-1").textContent).toMatch(/void the sale instead/i);
});

test("nothing can be refunded until something is actually coming back", async () => {
  await openReturns();
  expect(q("pos-return-confirm").disabled).toBe(true);
  await type("pos-return-qty-0", "1");
  expect(q("pos-return-confirm").disabled).toBe(false);
});

test("a reason is required before any money goes back", async () => {
  await openReturns();
  await type("pos-return-qty-0", "1");
  await click("pos-return-confirm");
  expect(posted.some((p) => String(p.path).includes("/return"))).toBe(false);
  expect(toast.error).toHaveBeenCalled();
});

test("the restock choice reaches the server per item", async () => {
  await openReturns();
  await type("pos-return-qty-0", "2");
  await click("pos-return-restock-0");                 // it was chewed
  await type("pos-return-reason", "Dog would not touch it");
  await click("pos-return-confirm");
  const req = posted.find((p) => String(p.path).includes("/return"));
  expect(req).toBeTruthy();
  expect(req.body.lines).toEqual([{ line_index: 0, qty: 2, restock: false }]);
  expect(req.body.reason).toBe("Dog would not touch it");
  expect(req.body.idempotency_key).toBeTruthy();
});

test("a resellable item defaults to going back on the shelf", async () => {
  await openReturns();
  await type("pos-return-qty-0", "1");
  await type("pos-return-reason", "Unopened, wrong size");
  await click("pos-return-confirm");
  const req = posted.find((p) => String(p.path).includes("/return"));
  expect(req.body.lines[0].restock).toBe(true);
});

test("a blocked sale explains itself instead of offering a refund", async () => {
  api.get.mockImplementation((path) => {
    if (String(path).includes("/return-preview")) {
      return Promise.resolve({ data: { ...RETURN_PREVIEW, can_return: false,
        blocked_reason: "This sale is 94 days old. Returns are accepted for 30 days." } });
    }
    return Promise.resolve({ data: path in GET ? GET[path] : {} });
  });
  await openReturns();
  expect(q("pos-return-blocked").textContent).toContain("94 days old");
  expect(q("pos-return-confirm")).toBeFalsy();
});
