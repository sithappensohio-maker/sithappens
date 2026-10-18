/**
 * Scanning a barcode to add pickup merchandise during dog checkout (owner,
 * 2026-10-18: "should be able to scan barcodes to add products during dog
 * check[out] as well"). Mirrors the Register's own scanner handling
 * (Pos.jsx's productSearch/scanProductBySku, see posMoneyPath.test.js) —
 * same box doubles as a live search-as-you-type filter, but only an EXACT
 * sku match on Enter adds to the cart (a USB/Bluetooth scanner just types
 * the code and sends Enter; a cashier typing a partial name and hitting
 * Enter must never auto-add something the live filter would have shown).
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { CheckoutModal } from "./CheckoutModal";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), defaults: { baseURL: "/api" } },
  formatErr: (e) => String(e),
}));
jest.mock("../lib/registerBus", () => ({ emitRegisterChanged: jest.fn() }));
jest.mock("../lib/useLiveRefresh", () => ({ useEditLock: jest.fn() }));
jest.mock("../lib/posAgent", () => ({ printReceipt: jest.fn(), openDrawer: jest.fn() }));
jest.mock("./ReceiptLogo", () => () => null);
jest.mock("sonner", () => ({ toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }) }));
jest.mock("../lib/auth", () => ({ useAuth: () => ({ can: () => true }) }));

const { api } = require("../lib/api");
const { toast } = require("sonner");
global.IS_REACT_ACT_ENVIRONMENT = true;

const BOOKING = {
  id: "bk-1", dog_id: "d-1", dog_name: "Luna", client_id: "c-1", client_name: "Dana",
  service_type: "daycare", service_id: "svc-1", date: "2026-09-19",
  status: "checked_in", estimated_price: 40, unit_price: 40,
};
const SERVICES = [
  { id: "svc-1", name: "Daycare", service_type: "daycare", base_price: 40, active: true, is_default: true },
];
const PRODUCTS = {
  items: [
    { kind: "product", id: "p-1", name: "Bag of food", sku: "SKU-FOOD-001", effective_price: 20, list_price: 20,
      in_stock: true, taxable: true, track_inventory: false },
    { kind: "product", id: "p-2", name: "Leash", sku: "SKU-LEASH-002", effective_price: 15, list_price: 15,
      in_stock: true, taxable: true, track_inventory: false },
  ],
};

let container, root;
const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const all = (id) => [...container.querySelectorAll(`[data-testid="${id}"]`)];
const flush = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });
const click = async (id) => {
  const el = q(id);
  if (!el) throw new Error(`no [data-testid="${id}"]`);
  await act(async () => { el.click(); });
  await flush();
};
const type = async (id, value) => {
  const el = q(id);
  if (!el) throw new Error(`no [data-testid="${id}"]`);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
};
const pressEnter = async (id) => {
  const el = q(id);
  if (!el) throw new Error(`no [data-testid="${id}"]`);
  await act(async () => { el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  await flush();
};

const respond = (url) => {
  const u = String(url);
  if (u.includes("/pos/catalog")) return Promise.resolve({ data: PRODUCTS });
  if (u.includes("checkout-group-preview")) return Promise.resolve({ data: { bookings: [BOOKING] } });
  if (u.includes("money-modifier-preview")) return Promise.resolve({ data: { sales_tax: { enabled: false } } });
  if (u.includes("discount-preview")) return Promise.resolve({ data: { eligible: false, preview_base_price: 40, discount: null } });
  return Promise.resolve({ data: {} });
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset();
  api.get.mockImplementation((url) => respond(url));
  api.post.mockReset();
  api.post.mockResolvedValue({ data: {} });
  toast.error.mockClear();
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

const mount = async () => {
  await act(async () => {
    root = createRoot(container);
    root.render(<CheckoutModal booking={BOOKING} services={SERVICES} onClose={() => {}} />);
  });
  await flush();
};

test("scanning a barcode (an exact SKU + Enter) adds the item without a click", async () => {
  await mount();
  await click("checkout-shop-toggle");
  await type("checkout-shop-search", "SKU-FOOD-001");
  await pressEnter("checkout-shop-search");
  expect(q("checkout-product-add-p-1").closest('[data-testid="checkout-product-p-1"]').textContent).toContain("1");
  expect(q("checkout-shop-search").value).toBe(""); // cleared, ready for the next scan
});

test("an unrecognized code says so instead of silently doing nothing", async () => {
  await mount();
  await click("checkout-shop-toggle");
  await type("checkout-shop-search", "NOT-A-REAL-CODE");
  await pressEnter("checkout-shop-search");
  expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("NOT-A-REAL-CODE"));
});

test("typing a partial name and hitting Enter never auto-adds — only an exact code does", async () => {
  await mount();
  await click("checkout-shop-toggle");
  await type("checkout-shop-search", "Leash"); // matches by name, but isn't the sku
  await pressEnter("checkout-shop-search");
  expect(q("checkout-product-minus-p-2")).toBeFalsy(); // never added (minus button only shows once qty > 0)
});

test("typing also live-filters the tile grid, same as the Register's own search", async () => {
  await mount();
  await click("checkout-shop-toggle");
  expect(all("checkout-product-add-p-1").length).toBe(1);
  expect(all("checkout-product-add-p-2").length).toBe(1);
  await type("checkout-shop-search", "food");
  expect(q("checkout-product-add-p-1")).toBeTruthy();
  expect(q("checkout-product-add-p-2")).toBeFalsy();
});

test("scanning twice adds a second one, same as clicking twice", async () => {
  await mount();
  await click("checkout-shop-toggle");
  await type("checkout-shop-search", "SKU-FOOD-001");
  await pressEnter("checkout-shop-search");
  await type("checkout-shop-search", "SKU-FOOD-001");
  await pressEnter("checkout-shop-search");
  expect(q("checkout-product-p-1").textContent).toContain("2");
});
