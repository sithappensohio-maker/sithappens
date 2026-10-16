/**
 * The automatic Shop loyalty discount — a regular client (GET
 * /shop/loyalty-discount says eligible) sees a banner and the cart already
 * shows the discount with nothing entered, never stacked with a weaker
 * code, overridden by a stronger one. The real discount amount always
 * comes from the server at checkout (_price_shop_cart); this only proves
 * the UI plumbing works.
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

const mockGet = (loyalty) => (url) => {
  if (url.includes("/catalog/taxonomy")) return Promise.resolve({ data: { categories: [], subcategories: [] } });
  if (url.includes("/catalog")) return Promise.resolve({ data: CATALOG });
  if (url.includes("/dogs")) return Promise.resolve({ data: [] });
  if (url === "/shop/loyalty-discount") return Promise.resolve({ data: loyalty });
  return Promise.resolve({ data: {} });
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset();
  api.post.mockReset();
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

test("an eligible client sees the loyalty banner and the cart already shows the discount", async () => {
  api.get.mockImplementation(mockGet({ eligible: true, pct: 10, visits: 12, min_visits: 10 }));
  await mount(<PortalShop mode="authenticated" cart={[cartLine]} onCartChange={() => {}} />);

  expect(q("shop-loyalty-banner")).toBeTruthy();
  expect(q("shop-loyalty-banner").textContent).toContain("10% off");

  await click("shop-cart-open");
  expect(q("cart-loyalty-note")).toBeTruthy();
  expect(q("cart-discount")).toBeTruthy();
  expect(q("cart-discount").textContent).toContain("8.00"); // 10% of $80
  expect(q("cart-discount-applied")).toBeFalsy(); // nothing was "entered" — it's automatic
});

test("an ineligible client sees neither the banner nor a cart discount", async () => {
  api.get.mockImplementation(mockGet({ eligible: false }));
  await mount(<PortalShop mode="authenticated" cart={[cartLine]} onCartChange={() => {}} />);

  expect(q("shop-loyalty-banner")).toBeFalsy();
  await click("shop-cart-open");
  expect(q("cart-loyalty-note")).toBeFalsy();
  expect(q("cart-discount")).toBeFalsy();
});

test("a guest never gets the loyalty banner or discount", async () => {
  api.get.mockImplementation(mockGet({ eligible: true, pct: 10, visits: 12, min_visits: 10 }));
  await mount(<PortalShop mode="guest" cart={[cartLine]} onCartChange={() => {}} onRequireAccount={() => {}} />);

  expect(q("shop-loyalty-banner")).toBeFalsy();
  await click("shop-cart-open");
  expect(q("cart-discount")).toBeFalsy();
});

test("the loyalty discount beats a weaker entered code — the cart shows loyalty winning", async () => {
  api.get.mockImplementation(mockGet({ eligible: true, pct: 10, visits: 12, min_visits: 10 }));
  api.post.mockImplementation((url) => {
    if (url === "/shop/discount-codes/validate") return Promise.resolve({ data: { code: "SMALL5", kind: "percent", value: 5 } });
    return Promise.resolve({ data: {} });
  });
  await mount(<PortalShop mode="authenticated" cart={[cartLine]} onCartChange={() => {}} />);
  await click("shop-cart-open");
  // The code field is collapsed behind a link once loyalty is already
  // giving a discount — see cart-discount-toggle.
  await click("cart-discount-toggle");
  await type("cart-discount-input", "small5");
  await click("cart-discount-apply");

  // the code itself shows as applied (what they typed)...
  expect(q("cart-discount-applied")).toBeTruthy();
  // ...but the actual discount shown is the bigger loyalty one, not the code's.
  expect(q("cart-discount").textContent).toContain("Loyalty");
  expect(q("cart-discount").textContent).toContain("8.00"); // 10% of $80, not 5% ($4)
});

test("a stronger entered code beats the loyalty discount", async () => {
  api.get.mockImplementation(mockGet({ eligible: true, pct: 10, visits: 12, min_visits: 10 }));
  api.post.mockImplementation((url) => {
    if (url === "/shop/discount-codes/validate") return Promise.resolve({ data: { code: "BIG20", kind: "percent", value: 20 } });
    return Promise.resolve({ data: {} });
  });
  await mount(<PortalShop mode="authenticated" cart={[cartLine]} onCartChange={() => {}} />);
  await click("shop-cart-open");
  await click("cart-discount-toggle");
  await type("cart-discount-input", "big20");
  await click("cart-discount-apply");

  expect(q("cart-discount").textContent).not.toContain("Loyalty");
  expect(q("cart-discount").textContent).toContain("16.00"); // 20% of $80
});

// Owner: "you have the loyal customer thing already applied and its
// asking for a code for that as well" — showing the full "enter a code"
// form right under "already applied" read as asking for the same
// discount twice.
test("a client already getting the loyalty discount sees a quiet link, not the full code form", async () => {
  api.get.mockImplementation(mockGet({ eligible: true, pct: 10, visits: 12, min_visits: 10 }));
  await mount(<PortalShop mode="authenticated" cart={[cartLine]} onCartChange={() => {}} />);
  await click("shop-cart-open");

  expect(q("cart-loyalty-note")).toBeTruthy();
  expect(q("cart-discount-toggle")).toBeTruthy();
  expect(q("cart-discount-form")).toBeFalsy();

  await click("cart-discount-toggle");
  expect(q("cart-discount-form")).toBeTruthy();
  expect(q("cart-discount-toggle")).toBeFalsy();
});

test("a client with no loyalty discount sees the code form directly, nothing collapsed", async () => {
  api.get.mockImplementation(mockGet({ eligible: false }));
  await mount(<PortalShop mode="authenticated" cart={[cartLine]} onCartChange={() => {}} />);
  await click("shop-cart-open");

  expect(q("cart-loyalty-note")).toBeFalsy();
  expect(q("cart-discount-toggle")).toBeFalsy();
  expect(q("cart-discount-form")).toBeTruthy();
});
