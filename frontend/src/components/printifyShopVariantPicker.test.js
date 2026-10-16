/**
 * Own-Shop Phase 2 — a Printify item sold through the Shop's own cart
 * instead of Shopify: size/color selection on the product page, a real
 * per-size price, and the grid card routing to that page instead of
 * offering an instant add (there is no single sellable price to add at).
 *
 * Mounts the real product page and the real merch card — the thing this
 * guards against is a quick-add path that reaches the cart with no
 * variant_id, which _price_shop_cart would then correctly refuse server-
 * side, but only after a confusing checkout failure.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import ShopItemDetail from "./ShopItemDetail";
import { MerchCard } from "./shop/ShopCards";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn() },
  formatErr: (e) => String(e?.response?.data?.detail || e || ""),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const { api } = require("../lib/api");
const { toast } = require("sonner");

global.IS_REACT_ACT_ENVIRONMENT = true;

const SHIRT = {
  kind: "product", id: "shirt-1", name: "Trail Dog Hoodie",
  sales_destination: "printify", price: 19.99, effective_price: 19.99,
  from_price: true, in_stock: true,
  description: "", image_ids: [],
  variants: [
    { id: "v-s", name: "Black / S", price: 19.99, is_available: true },
    { id: "v-xl", name: "Black / XL", price: 21.94, is_available: true },
    { id: "v-sold-out", name: "Black / 3XL", price: 23.06, is_available: false },
  ],
};

const SHIRT_INTERNAL = {
  kind: "product", id: "shirt-2", name: "Leash",
  sales_destination: "internal", price: 24.0, effective_price: 24.0,
  track_inventory: false, in_stock: true,
  description: "", image_ids: [],
  variants: [
    { id: "v-black", name: "Black", price: 24.0, in_stock: true },
    { id: "v-red", name: "Red", price: 26.0, in_stock: true },
  ],
};

const PET_TAG = {
  kind: "product", id: "tag-1", name: "Pet ID Tag",
  sales_destination: "printify", price: 12.0, effective_price: 12.0,
  in_stock: true, description: "", image_ids: [],
  personalization_fields: ["Name", "Phone"],
};

let container, root, added;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  added = [];
  api.get.mockReset();
  toast.error.mockReset();
  toast.success.mockReset();
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  container.remove();
});

const mountDetail = async (item, props = {}) => {
  api.get.mockResolvedValue({ data: item });
  await act(async () => {
    root = createRoot(container);
    root.render(
      <ShopItemDetail
        kind="product" itemId={item.id} cart={[]}
        onAddToCart={(it, qty, dogId, gift, variantId, personalization) => added.push({ it, qty, dogId, gift, variantId, personalization })}
        onBack={() => {}} allItems={[item]} onOpenItem={() => {}}
        mode="authenticated" dogs={[]} {...props} />);
  });
};
const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const click = async (el) => { await act(async () => { el.click(); }); };
const type = async (id, value) => {
  const el = q(id);
  if (!el) throw new Error(`no [data-testid="${id}"]`);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  await act(async () => {
    setter.call(el, String(value));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

describe("Printify product page — size required", () => {
  test("the size picker lists every enabled variant, unavailable one disabled", async () => {
    await mountDetail(SHIRT);
    expect(q("shop-detail-variant-picker")).toBeTruthy();
    expect(q("shop-detail-variant-v-s").textContent).toBe("Black / S");
    expect(q("shop-detail-variant-v-xl").textContent).toBe("Black / XL");
    expect(q("shop-detail-variant-v-sold-out").disabled).toBe(true);
  });

  test("the price reads \"From\" until a size is picked", async () => {
    await mountDetail(SHIRT);
    expect(q("shop-price").textContent).toBe("From $19.99");
  });

  test("purchase is disabled with no size chosen", async () => {
    await mountDetail(SHIRT);
    expect(q("shop-detail-purchase-disabled")).toBeTruthy();
    expect(q("shop-detail-purchase-disabled").textContent).toMatch(/choose a size/i);
    expect(q("shop-detail-purchase")).toBeFalsy();
  });

  test("picking a size shows its own price and enables Add to Cart", async () => {
    await mountDetail(SHIRT);
    await click(q("shop-detail-variant-v-xl"));
    expect(q("shop-detail-variant-price").textContent).toBe("$21.94");
    expect(q("shop-detail-purchase")).toBeTruthy();
    expect(q("shop-detail-purchase-disabled")).toBeFalsy();
  });

  test("Add to Cart hands the chosen variant id to onAddToCart", async () => {
    await mountDetail(SHIRT);
    await click(q("shop-detail-variant-v-xl"));
    await click(q("shop-detail-purchase"));
    expect(added).toHaveLength(1);
    expect(added[0].variantId).toBe("v-xl");
    expect(toast.success).toHaveBeenCalled();
  });

  test("clicking a sold-out size does nothing", async () => {
    await mountDetail(SHIRT);
    await click(q("shop-detail-variant-v-sold-out"));
    expect(q("shop-detail-purchase-disabled")).toBeTruthy();
  });
});

describe("An internal product with options — picking stays optional", () => {
  test("Add to Cart works with nothing picked, at the base price", async () => {
    await mountDetail(SHIRT_INTERNAL);
    expect(q("shop-detail-purchase")).toBeTruthy();
    await click(q("shop-detail-purchase"));
    expect(added).toHaveLength(1);
    expect(added[0].variantId).toBeUndefined();
  });

  test("picking an option still swaps in its own price and is passed through", async () => {
    await mountDetail(SHIRT_INTERNAL);
    await click(q("shop-detail-variant-v-red"));
    expect(q("shop-detail-variant-price").textContent).toBe("$26.00");
    await click(q("shop-detail-purchase"));
    expect(added[0].variantId).toBe("v-red");
  });
});

describe("Merch card — a Printify item routes to the detail page", () => {
  test("shows \"Choose Size\" instead of an instant add, and a From price", () => {
    const opened = [];
    const host = document.createElement("div");
    document.body.appendChild(host);
    const r = createRoot(host);
    act(() => {
      r.render(<MerchCard item={SHIRT} mode="client" onOpenDetail={(it) => opened.push(it)} />);
    });
    const btn = [...host.querySelectorAll("button")].find((b) => /choose size/i.test(b.textContent));
    expect(btn).toBeTruthy();
    expect(host.textContent).toMatch(/From \$19\.99/);
    act(() => { btn.click(); });
    expect(opened).toEqual([SHIRT]);
    act(() => r.unmount());
    host.remove();
  });
});

describe("Printify product page — personalization required", () => {
  test("shows one input per declared field", async () => {
    await mountDetail(PET_TAG);
    expect(q("shop-detail-personalization")).toBeTruthy();
    expect(q("shop-detail-personalization-Name")).toBeTruthy();
    expect(q("shop-detail-personalization-Phone")).toBeTruthy();
  });

  test("purchase is disabled until every field is filled", async () => {
    await mountDetail(PET_TAG);
    expect(q("shop-detail-purchase-disabled")).toBeTruthy();
    expect(q("shop-detail-purchase-disabled").textContent).toMatch(/Name/);
    expect(q("shop-detail-purchase-disabled").textContent).toMatch(/Phone/);
    expect(q("shop-detail-purchase")).toBeFalsy();
  });

  test("filling only one field still refuses, naming just the missing one", async () => {
    await mountDetail(PET_TAG);
    await type("shop-detail-personalization-Name", "Rex");
    expect(q("shop-detail-purchase-disabled").textContent).toMatch(/Phone/);
    expect(q("shop-detail-purchase-disabled").textContent).not.toMatch(/Name/);
    expect(q("shop-detail-purchase")).toBeFalsy();
  });

  test("filling every field enables purchase and hands the values to onAddToCart", async () => {
    await mountDetail(PET_TAG);
    await type("shop-detail-personalization-Name", "Rex");
    await type("shop-detail-personalization-Phone", "330-555-0101");
    expect(q("shop-detail-purchase-disabled")).toBeFalsy();
    expect(q("shop-detail-purchase")).toBeTruthy();
    await click(q("shop-detail-purchase"));
    expect(added).toHaveLength(1);
    expect(added[0].personalization).toEqual({ Name: "Rex", Phone: "330-555-0101" });
  });

  test("a plain item never shows a personalization form", async () => {
    await mountDetail(SHIRT_INTERNAL);
    expect(q("shop-detail-personalization")).toBeFalsy();
  });
});
