/**
 * The cart's pickup-vs-ship choice (Shop gap-list item 5, owner request
 * 2026-10-15) — offered only when every physical line in the cart is
 * itself marked Shippable, never for a guest. The real shipping cost
 * always comes from a FedEx rate quote at checkout (_price_shop_cart);
 * this only proves the UI plumbing (visibility, the address form, and
 * what travels on the real checkout call).
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

const SHIPPABLE = { kind: "product", id: "p1", name: "Dog Bed", price: 60,
  description: "A bed.", availability: "in_stock", in_stock: true,
  track_inventory: true, stock_on_hand: 5, guest_cart_allowed: true, shippable: true,
  category_id: "c1", category_name: "Gear", image_id: null, image_ids: [] };

const NOT_SHIPPABLE = { ...SHIPPABLE, id: "p2", name: "Heavy Crate", shippable: false };

const CATALOG = { items: [SHIPPABLE, NOT_SHIPPABLE] };

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
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
};

const q = (id) => document.querySelector(`[data-testid="${id}"]`);
const type = async (id, value) => {
  const el = q(id);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const click = async (id) => { await act(async () => { q(id).click(); }); };

test("a cart of fully-shippable items offers Ship to me, and filling the address travels on checkout", async () => {
  api.post.mockImplementation((url) => {
    if (url === "/shop/checkout") return Promise.resolve({ data: { url: "https://checkout.stripe.com/x", order_id: "ord-1" } });
    return Promise.resolve({ data: {} });
  });
  await mount(<PortalShop mode="authenticated" cart={[{ kind: "product", ref_id: "p1", quantity: 1 }]} onCartChange={() => {}} />);
  await click("shop-cart-open");

  expect(q("shop-shipping-choice")).toBeTruthy();
  expect(q("shop-shipping-address-form")).toBeFalsy(); // pickup is the default

  await click("shop-shipping-ship");
  expect(q("shop-shipping-address-form")).toBeTruthy();
  // incomplete address blocks checkout
  expect(q("shop-checkout-button").disabled).toBe(true);

  await type("shop-shipping-address1", "1 Main St");
  await type("shop-shipping-city", "Dayton");
  await type("shop-shipping-region", "oh");
  await type("shop-shipping-zip", "45402");
  expect(q("shop-checkout-button").disabled).toBe(false);

  await click("shop-checkout-button");
  const checkoutCall = api.post.mock.calls.find(([url]) => url === "/shop/checkout");
  expect(checkoutCall[1].shipping_address).toEqual({
    address1: "1 Main St", address2: "", city: "Dayton", region: "OH", zip: "45402",
  });
});

test("a cart with even one non-shippable item never offers Ship to me", async () => {
  await mount(<PortalShop mode="authenticated"
    cart={[{ kind: "product", ref_id: "p1", quantity: 1 }, { kind: "product", ref_id: "p2", quantity: 1 }]}
    onCartChange={() => {}} />);
  await click("shop-cart-open");
  expect(q("shop-shipping-choice")).toBeFalsy();
});

test("a guest never sees the shipping option even for a fully-shippable cart", async () => {
  await mount(<PortalShop mode="guest" cart={[{ kind: "product", ref_id: "p1", quantity: 1 }]}
    onCartChange={() => {}} onRequireAccount={() => {}} />);
  await click("shop-cart-open");
  expect(q("shop-shipping-choice")).toBeFalsy();
});

test("switching back to pickup drops the shipping address from checkout", async () => {
  api.post.mockImplementation((url) => {
    if (url === "/shop/checkout") return Promise.resolve({ data: { url: "https://checkout.stripe.com/x", order_id: "ord-1" } });
    return Promise.resolve({ data: {} });
  });
  await mount(<PortalShop mode="authenticated" cart={[{ kind: "product", ref_id: "p1", quantity: 1 }]} onCartChange={() => {}} />);
  await click("shop-cart-open");
  await click("shop-shipping-ship");
  await type("shop-shipping-address1", "1 Main St");
  await type("shop-shipping-city", "Dayton");
  await type("shop-shipping-region", "oh");
  await type("shop-shipping-zip", "45402");
  await click("shop-shipping-pickup");
  await click("shop-checkout-button");
  const checkoutCall = api.post.mock.calls.find(([url]) => url === "/shop/checkout");
  expect(checkoutCall[1].shipping_address).toBeNull();
});
