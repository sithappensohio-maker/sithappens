/**
 * Ship-to-home for an online Printify order (owner request: "this should
 * be fixed", following up on the pickup-only limitation the Phase 3
 * queuing work shipped with). A SEPARATE choice from the Shop's own FedEx
 * ShippingChoice — a Printify line is never admin-flagged shippable, so
 * cart_shippable() never offers FedEx for it; this proves the Printify-
 * specific UI (visibility, the address form, and what travels on the real
 * checkout call) for both the signed-in cart and guest checkout.
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

const PET_TAG = { kind: "product", id: "tag1", name: "Pet ID Tag", price: 12,
  description: "A tag.", availability: "in_stock", in_stock: true,
  sales_destination: "printify", guest_cart_allowed: true, shippable: false,
  category_id: "c1", category_name: "Gear", image_id: null, image_ids: [] };

const PLAIN = { kind: "product", id: "p1", name: "Leash", price: 20,
  description: "A leash.", availability: "in_stock", in_stock: true,
  track_inventory: true, stock_on_hand: 5, guest_cart_allowed: true, shippable: false,
  category_id: "c1", category_name: "Gear", image_id: null, image_ids: [] };

const CATALOG = { items: [PET_TAG, PLAIN] };

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

describe("signed-in client cart", () => {
  test("a cart with a Printify item offers the choice, pickup by default", async () => {
    api.post.mockImplementation((url) => {
      if (url === "/shop/checkout") return Promise.resolve({ data: { url: "https://checkout.stripe.com/x", order_id: "ord-1" } });
      return Promise.resolve({ data: {} });
    });
    await mount(<PortalShop mode="authenticated" cart={[{ kind: "product", ref_id: "tag1", quantity: 1 }]} onCartChange={() => {}} />);
    await click("shop-cart-open");

    expect(q("shop-printify-fulfillment")).toBeTruthy();
    expect(q("shop-printify-address-form")).toBeFalsy();
    expect(q("shop-checkout-button").disabled).toBe(false); // pickup needs no address

    await click("shop-checkout-button");
    const call = api.post.mock.calls.find(([url]) => url === "/shop/checkout");
    expect(call[1].printify_fulfillment).toEqual({ method: "pickup", shipping_address: null });
  });

  test("choosing Ship to me requires a complete address before checkout, then carries it", async () => {
    api.post.mockImplementation((url) => {
      if (url === "/shop/checkout") return Promise.resolve({ data: { url: "https://checkout.stripe.com/x", order_id: "ord-1" } });
      return Promise.resolve({ data: {} });
    });
    await mount(<PortalShop mode="authenticated" cart={[{ kind: "product", ref_id: "tag1", quantity: 1 }]} onCartChange={() => {}} />);
    await click("shop-cart-open");

    await click("shop-printify-ship");
    expect(q("shop-printify-address-form")).toBeTruthy();
    expect(q("shop-checkout-button").disabled).toBe(true);

    await type("shop-printify-address1", "1 Main St");
    await type("shop-printify-city", "Dayton");
    await type("shop-printify-region", "oh");
    await type("shop-printify-zip", "45402");
    expect(q("shop-checkout-button").disabled).toBe(false);

    await click("shop-checkout-button");
    const call = api.post.mock.calls.find(([url]) => url === "/shop/checkout");
    expect(call[1].printify_fulfillment).toEqual({
      method: "ship",
      shipping_address: { address1: "1 Main St", address2: "", city: "Dayton", region: "OH", zip: "45402" },
    });
  });

  test("a cart with no Printify item never shows the choice", async () => {
    await mount(<PortalShop mode="authenticated" cart={[{ kind: "product", ref_id: "p1", quantity: 1 }]} onCartChange={() => {}} />);
    await click("shop-cart-open");
    expect(q("shop-printify-fulfillment")).toBeFalsy();
  });
});

describe("guest checkout", () => {
  test("a guest cart with a Printify item offers the choice inside GuestCheckoutPanel", async () => {
    api.post.mockImplementation((url) => {
      if (url === "/public/shop/cart/price") {
        return Promise.resolve({ data: { lines: [{ kind: "product", ref_id: "tag1", name: "Pet ID Tag", quantity: 1, unit_price: 12, line_subtotal: 12, line_total: 12 }],
          subtotal: 12, tax_amount: 0, tax_rate_pct: 0, total: 12 } });
      }
      if (url === "/public/shop/checkout") return Promise.resolve({ data: { url: "https://checkout.stripe.com/x", order_id: "ord-1", guest_token: "tok" } });
      return Promise.resolve({ data: {} });
    });
    await mount(<PortalShop mode="guest" cart={[{ kind: "product", ref_id: "tag1", quantity: 1 }]}
      onCartChange={() => {}} onRequireAccount={() => {}} />);
    await click("shop-cart-open");
    await click("shop-checkout-button"); // guest mode: opens GuestCheckoutPanel instead of charging

    expect(q("shop-printify-fulfillment")).toBeTruthy();
    await type("guest-checkout-email", "guest@example.com");
    await type("guest-checkout-name", "Rex Guest");
    await click("shop-printify-ship");
    expect(q("guest-checkout-pay").disabled).toBe(true); // incomplete Printify address

    await type("shop-printify-address1", "1 Main St");
    await type("shop-printify-city", "Dayton");
    await type("shop-printify-region", "oh");
    await type("shop-printify-zip", "45402");
    await click("guest-checkout-pay");

    const call = api.post.mock.calls.find(([url]) => url === "/public/shop/checkout");
    expect(call[1].printify_fulfillment).toEqual({
      method: "ship",
      shipping_address: { address1: "1 Main St", address2: "", city: "Dayton", region: "OH", zip: "45402" },
    });
  });
});
