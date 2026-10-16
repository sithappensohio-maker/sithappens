/**
 * Owner-reported bug: "clicking check out needs to open the cart befor
 * strip so thy can pick shipping or not" — the floating tray's own
 * "Checkout" button sent a signed-in client straight to Stripe, skipping
 * the cart panel entirely, which is the only place the pickup-or-ship
 * choice lives. It must open the cart instead, same as "View Cart". A
 * guest is unaffected — their "Checkout" already opens GuestCheckoutPanel
 * (which has its own ship choice built in), never Stripe directly.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import PortalShop from "./PortalShop";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
  formatErr: (e) => String(e || ""),
}));
jest.mock("sonner", () => ({ toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }) }));

const { api } = require("../lib/api");

global.IS_REACT_ACT_ENVIRONMENT = true;

const PLAIN = { kind: "product", id: "p1", name: "Leash", price: 20,
  description: "A leash.", availability: "in_stock", in_stock: true,
  track_inventory: true, stock_on_hand: 5, guest_cart_allowed: true, shippable: false,
  category_id: "c1", category_name: "Gear", image_id: null, image_ids: [] };

const CATALOG = { items: [PLAIN] };

let container, root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset();
  api.post.mockReset();
  api.get.mockImplementation((url) => {
    if (url.includes("/catalog/taxonomy")) return Promise.resolve({ data: { categories: [], subcategories: [] } });
    if (url.includes("/catalog")) return Promise.resolve({ data: CATALOG });
    if (url.includes("/dogs")) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: {} });
  });
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  root = null;
});

const mount = async (el) => {
  await act(async () => {
    root = createRoot(container);
    root.render(<MemoryRouter>{el}</MemoryRouter>);
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
};

const q = (id) => document.querySelector(`[data-testid="${id}"]`);
const click = async (id) => { await act(async () => { q(id).click(); }); };

const cartLine = { kind: "product", ref_id: "p1", quantity: 1 };

test("a signed-in client's tray Checkout opens the cart panel, not Stripe directly", async () => {
  api.post.mockImplementation((url) => {
    if (url === "/shop/checkout") return Promise.resolve({ data: { url: "https://checkout.stripe.com/x", order_id: "ord-1" } });
    return Promise.resolve({ data: {} });
  });
  await mount(<PortalShop mode="authenticated" cart={[cartLine]} onCartChange={() => {}} />);

  expect(q("shop-tray-checkout")).toBeTruthy();
  expect(q("shop-checkout-button")).toBeFalsy(); // cart panel not open yet

  await click("shop-tray-checkout");

  expect(q("shop-checkout-button")).toBeTruthy(); // cart panel is now open
  expect(api.post).not.toHaveBeenCalledWith("/shop/checkout", expect.anything());
});

test("a guest's tray Checkout still goes straight to guest checkout, unaffected", async () => {
  api.post.mockImplementation((url) => {
    if (url === "/public/shop/cart/price") return Promise.resolve({ data: { total: 20, subtotal: 20, tax: 0, lines: [{ kind: "product", ref_id: "p1", name: "Leash", quantity: 1, unit_price: 20, line_total: 20 }] } });
    return Promise.resolve({ data: {} });
  });
  await mount(<PortalShop mode="guest" cart={[cartLine]} onCartChange={() => {}} onRequireAccount={() => {}} />);

  expect(q("shop-tray-checkout")).toBeTruthy();
  await click("shop-tray-checkout");

  // Guest checkout is its own panel (with its own ship choice), never the
  // signed-in CartPanel and never a direct Stripe redirect.
  expect(q("shop-checkout-button")).toBeFalsy();
  expect(q("guest-checkout-panel")).toBeTruthy();
});
