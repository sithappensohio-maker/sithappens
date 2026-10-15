/**
 * The Shop cart's "have a code?" field — applying a code shows the
 * discount in the cart summary, and the code actually travels on the real
 * checkout call. The real discount amount always comes from the server at
 * checkout (_price_shop_cart); this only proves the UI plumbing works.
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

const CATALOG = {
  items: [
    { kind: "product", id: "p1", name: "Husky Rope Leash", price: 80,
      description: "Six feet of rope.", availability: "in_stock", in_stock: true,
      track_inventory: true, stock_on_hand: 9, guest_cart_allowed: true,
      category_id: "c1", category_name: "Gear", image_id: null, image_ids: [] },
  ],
};

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

const cartLine = { kind: "product", ref_id: "p1", quantity: 1 };

test("applying a valid code shows the discount in the cart summary", async () => {
  api.post.mockImplementation((url) => {
    if (url === "/shop/discount-codes/validate") return Promise.resolve({ data: { code: "WELCOME10", kind: "percent", value: 10 } });
    return Promise.resolve({ data: {} });
  });
  await mount(<PortalShop mode="authenticated" cart={[cartLine]} onCartChange={() => {}} />);
  await click("shop-cart-open");
  await type("cart-discount-input", "welcome10");
  await click("cart-discount-apply");

  expect(api.post).toHaveBeenCalledWith("/shop/discount-codes/validate", { code: "welcome10" });
  expect(q("cart-discount-applied")).toBeTruthy();
  expect(q("cart-discount-applied").textContent).toContain("WELCOME10");
  expect(q("cart-discount")).toBeTruthy();
  expect(q("cart-discount").textContent).toContain("8.00"); // 10% of $80
});

test("an invalid code is refused and never applied", async () => {
  api.post.mockImplementation((url) => {
    if (url === "/shop/discount-codes/validate") return Promise.reject({ response: { data: { detail: "That code isn't valid." } } });
    return Promise.resolve({ data: {} });
  });
  await mount(<PortalShop mode="authenticated" cart={[cartLine]} onCartChange={() => {}} />);
  await click("shop-cart-open");
  await type("cart-discount-input", "nope");
  await click("cart-discount-apply");

  expect(q("cart-discount-applied")).toBeFalsy();
  expect(q("cart-discount-form")).toBeTruthy(); // still showing the entry form, not "applied"
});

test("the applied code travels on the real checkout call", async () => {
  api.post.mockImplementation((url) => {
    if (url === "/shop/discount-codes/validate") return Promise.resolve({ data: { code: "WELCOME10", kind: "percent", value: 10 } });
    if (url === "/shop/checkout") return Promise.resolve({ data: { url: "https://checkout.stripe.com/x", order_id: "ord-1" } });
    return Promise.resolve({ data: {} });
  });
  await mount(<PortalShop mode="authenticated" cart={[cartLine]} onCartChange={() => {}} />);
  await click("shop-cart-open");
  await type("cart-discount-input", "welcome10");
  await click("cart-discount-apply");
  await click("shop-checkout-button");

  const checkoutCall = api.post.mock.calls.find(([url]) => url === "/shop/checkout");
  expect(checkoutCall[1].discount_code).toBe("WELCOME10");
});

test("a guest never sees the discount code field — every code is clients-only", async () => {
  await mount(<PortalShop mode="guest" cart={[cartLine]} onCartChange={() => {}} onRequireAccount={() => {}} />);
  await click("shop-cart-open");
  expect(q("cart-discount-form")).toBeFalsy();
  expect(q("cart-discount-applied")).toBeFalsy();
});
