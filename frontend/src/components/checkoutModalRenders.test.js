/**
 * The checkout screen actually renders.
 *
 * This exists because it did not. A `const` read a few lines above its own
 * declaration — legal to Babel, legal to Vite, invisible to every
 * source-pinned test in this folder — and the whole screen died on mount with
 * "Cannot access '$t' before initialization". Checking a dog out was
 * impossible until it was found by hand.
 *
 * So: mount the thing. A build that compiles is not a screen that works, and
 * this is the most money-critical modal in the app. The assertions here are
 * deliberately thin — the point is that mounting throws nothing, in the
 * states the front desk actually sees.
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
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const { api } = require("../lib/api");

global.IS_REACT_ACT_ENVIRONMENT = true;

const BOOKING = {
  id: "bk-1", dog_id: "d-1", dog_name: "Luna", client_id: "c-1", client_name: "Dana",
  service_type: "daycare", service_id: "svc-1", date: "2026-09-19",
  status: "checked_in", estimated_price: 40, unit_price: 40,
};
const SERVICES = [
  { id: "svc-1", name: "Daycare", service_type: "daycare", base_price: 40, active: true, is_default: true },
  { id: "svc-2", name: "Nail Trim", service_type: "grooming", base_price: 15, active: true, is_addon: true },
];
const PRODUCTS = {
  items: [
    { kind: "product", id: "p-1", name: "Bag of food", effective_price: 20, list_price: 20,
      in_stock: true, taxable: true, track_inventory: false },
    { kind: "product", id: "p-2", name: "Gift card", effective_price: 25, list_price: 25,
      in_stock: true, taxable: false, track_inventory: false },
    { kind: "credit_pack", id: "cp-1", name: "10 days", effective_price: 300, in_stock: true },
  ],
};

let container, root;

const respond = (url) => {
  if (url.includes("/pos/catalog")) return Promise.resolve({ data: PRODUCTS });
  if (url.includes("checkout-group-preview")) return Promise.resolve({ data: { bookings: [BOOKING] } });
  if (url.includes("money-modifier-preview")) {
    return Promise.resolve({ data: { sales_tax: { enabled: true, rate_pct: 6.75, label: "Sales Tax", applies: false } } });
  }
  return Promise.resolve({ data: {} });
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset();
  api.get.mockImplementation((url) => respond(String(url)));
  api.post.mockReset();
  api.post.mockResolvedValue({ data: {} });
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

const mount = async (props = {}) => {
  await act(async () => {
    root = createRoot(container);
    root.render(<CheckoutModal booking={BOOKING} services={SERVICES} onClose={() => {}} {...props} />);
  });
};

test("it mounts without throwing", async () => {
  await mount();
  expect(container.querySelector('[data-testid="checkout-modal"]')).toBeTruthy();
  expect(container.textContent).toContain("Luna");
});

test("the merchandise section appears once the catalog has products", async () => {
  await mount();
  expect(container.querySelector('[data-testid="checkout-shop"]')).toBeTruthy();
  expect(container.querySelector('[data-testid="checkout-shop-toggle"]')).toBeTruthy();
});

test("a Board & Train stay renders the same screen", async () => {
  // The crash was reported on Board & Train; nothing about that path is
  // special, but it is the one that was actually being used.
  await mount({ booking: { ...BOOKING, service_type: "training", dog_name: "Rex" } });
  expect(container.querySelector('[data-testid="checkout-modal"]')).toBeTruthy();
  expect(container.textContent).toContain("Rex");
});

test("it survives a catalog that fails to load", async () => {
  api.get.mockImplementation((url) =>
    String(url).includes("/pos/catalog") ? Promise.reject(new Error("nope")) : respond(String(url)));
  await mount();
  expect(container.querySelector('[data-testid="checkout-modal"]')).toBeTruthy();
  expect(container.querySelector('[data-testid="checkout-shop"]')).toBeFalsy();
});

test("it renders with sales tax switched off", async () => {
  api.get.mockImplementation((url) =>
    String(url).includes("money-modifier-preview")
      ? Promise.resolve({ data: { sales_tax: { enabled: false, rate_pct: 0 } } })
      : respond(String(url)));
  await mount();
  expect(container.querySelector('[data-testid="checkout-modal"]')).toBeTruthy();
});

test("the total is a real number, not NaN", async () => {
  // A missing rate or a missing price must not turn the amount due into
  // "$NaN" on the one screen where the customer is handing money over.
  await mount();
  const total = container.querySelector('[data-testid="checkout-total"]');
  expect(total).toBeTruthy();
  expect(total.textContent).toMatch(/^\$\d+\.\d{2}$/);
});
