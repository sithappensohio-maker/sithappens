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

const MULTI_COLOR_SHIRT = {
  kind: "product", id: "shirt-3", name: "Trail Dog Hoodie",
  sales_destination: "printify", price: 19.99, effective_price: 19.99,
  from_price: true, in_stock: true,
  description: "", image_ids: [],
  variants: [
    { id: "v-black-s", name: "Black / S", price: 19.99, is_available: true },
    { id: "v-black-m", name: "Black / M", price: 19.99, is_available: true },
    { id: "v-purple-s", name: "Purple / S", price: 19.99, is_available: false },
    { id: "v-purple-m", name: "Purple / M", price: 21.94, is_available: true },
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
const qa = (sel) => [...container.querySelectorAll(sel)];
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

  // Owner: "is there a reason medium is out of order" — S/L/XL were added
  // first, M/2XL/3XL in a later Fetch Sizes pass, so Printify's (and this
  // product's own stored) array had them in S, L, XL, M, 2XL, 3XL order.
  test("sizes added out of order (a later Fetch Sizes pass) still show in real size order", async () => {
    const outOfOrder = {
      ...SHIRT, variants: [
        { id: "v-s", name: "Black / S", price: 19.99, is_available: true },
        { id: "v-l", name: "Black / L", price: 19.99, is_available: true },
        { id: "v-xl", name: "Black / XL", price: 19.99, is_available: true },
        { id: "v-m", name: "Black / M", price: 19.99, is_available: true },
        { id: "v-2xl", name: "Black / 2XL", price: 21.94, is_available: true },
        { id: "v-3xl", name: "Black / 3XL", price: 21.94, is_available: true },
      ],
    };
    await mountDetail(outOfOrder);
    const order = qa('[data-testid^="shop-detail-variant-v-"]').map((el) => el.textContent);
    expect(order).toEqual(["Black / S", "Black / M", "Black / L", "Black / XL", "Black / 2XL", "Black / 3XL"]);
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

// Owner-reported bug: the item page told a shopper "shipping is not
// available for this item" on a Printify shirt — wrong, it ships just
// fine through the cart's own PrintifyShipChoice. isInternalPhysical
// forgot to exclude Printify the same way it already excludes Shopify.
describe("the pickup-only notice", () => {
  test("a Printify item never claims shipping is unavailable — it ships via its own cart choice", async () => {
    await mountDetail(SHIRT);
    expect(q("shop-detail-pickup-notice")).toBeFalsy();
  });

  test("an internal physical product still shows the pickup notice", async () => {
    await mountDetail(SHIRT_INTERNAL);
    expect(q("shop-detail-pickup-notice")).toBeTruthy();
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

describe("Printify product page — many colors group into a color step then a size step", () => {
  test("a single-color item (SHIRT) never shows a color picker — the flat size list as before", async () => {
    await mountDetail(SHIRT);
    expect(q("shop-detail-color-picker")).toBeFalsy();
    expect(q("shop-detail-variant-v-s").textContent).toBe("Black / S");
  });

  test("a multi-color item shows colors first, no sizes until one is picked", async () => {
    await mountDetail(MULTI_COLOR_SHIRT);
    expect(q("shop-detail-color-picker")).toBeTruthy();
    expect(q("shop-detail-color-Black").textContent).toBe("Black");
    expect(q("shop-detail-color-Purple").textContent).toBe("Purple");
    expect(q("shop-detail-variant-v-black-s")).toBeFalsy(); // no color picked yet
    expect(q("shop-detail-purchase-disabled")).toBeTruthy();
  });

  // Owner: a color button that only ever says "Purple" in plain text reads
  // as a template, not a real store — every real swatch shows the color.
  test("a recognized color shows a real swatch dot in that color", async () => {
    await mountDetail(MULTI_COLOR_SHIRT);
    const swatch = q("shop-detail-color-swatch-Black");
    expect(swatch).toBeTruthy();
    expect(swatch.style.backgroundColor).toBe("rgb(26, 26, 26)"); // #1a1a1a
  });

  test("an unrecognized color name gets no swatch — graceful fallback, not a wrong-looking guess", async () => {
    const weird = { ...MULTI_COLOR_SHIRT, id: "shirt-5",
      variants: MULTI_COLOR_SHIRT.variants.map((v) => ({ ...v, name: v.name.replace("Black", "Galaxy Swirl") })) };
    await mountDetail(weird);
    expect(q("shop-detail-color-swatch-Galaxy Swirl")).toBeFalsy();
    expect(q("shop-detail-color-Galaxy Swirl").textContent).toBe("Galaxy Swirl");
  });

  test("picking a color reveals just that color's sizes, labeled by size alone", async () => {
    await mountDetail(MULTI_COLOR_SHIRT);
    await click(q("shop-detail-color-Black"));
    expect(q("shop-detail-variant-v-black-s").textContent).toBe("S");
    expect(q("shop-detail-variant-v-black-m").textContent).toBe("M");
    expect(q("shop-detail-variant-v-purple-s")).toBeFalsy(); // a different color's size, not shown
  });

  // The exact bug reported live: S/L/XL added first, M/2XL/3XL in a later
  // Fetch Sizes pass — "CHOOSE A SIZE: S L XL M 2XL 3XL" on screen.
  test("a color's sizes show in real size order even when added across two Fetch Sizes passes", async () => {
    const reorderedColors = {
      ...MULTI_COLOR_SHIRT, id: "shirt-6",
      variants: [
        { id: "v-black-s", name: "Black / S", price: 19.99, is_available: true },
        { id: "v-black-l", name: "Black / L", price: 19.99, is_available: true },
        { id: "v-black-xl", name: "Black / XL", price: 19.99, is_available: true },
        { id: "v-black-m", name: "Black / M", price: 19.99, is_available: true },
        { id: "v-black-2xl", name: "Black / 2XL", price: 21.94, is_available: true },
        { id: "v-black-3xl", name: "Black / 3XL", price: 21.94, is_available: true },
        { id: "v-purple-s", name: "Purple / S", price: 19.99, is_available: true },
      ],
    };
    await mountDetail(reorderedColors);
    await click(q("shop-detail-color-Black"));
    const order = qa('[data-testid^="shop-detail-variant-v-black-"]').map((el) => el.textContent);
    expect(order).toEqual(["S", "M", "L", "XL", "2XL", "3XL"]);
  });

  test("a color whose every size is unavailable is disabled", async () => {
    const allSoldOut = {
      ...MULTI_COLOR_SHIRT, id: "shirt-4",
      variants: MULTI_COLOR_SHIRT.variants.map((v) => (v.name.startsWith("Purple") ? { ...v, is_available: false } : v)),
    };
    await mountDetail(allSoldOut);
    expect(q("shop-detail-color-Purple").disabled).toBe(true);
  });

  test("switching colors clears a size chosen under the old one", async () => {
    await mountDetail(MULTI_COLOR_SHIRT);
    await click(q("shop-detail-color-Black"));
    await click(q("shop-detail-variant-v-black-s"));
    expect(q("shop-detail-purchase")).toBeTruthy();
    await click(q("shop-detail-color-Purple"));
    expect(q("shop-detail-purchase-disabled")).toBeTruthy(); // size reset, must choose again
    expect(q("shop-detail-variant-v-purple-m").textContent).toBe("M");
  });

  test("adding to cart after picking color then size hands the real variant id", async () => {
    await mountDetail(MULTI_COLOR_SHIRT);
    await click(q("shop-detail-color-Purple"));
    await click(q("shop-detail-variant-v-purple-m"));
    expect(q("shop-detail-variant-price").textContent).toBe("$21.94");
    await click(q("shop-detail-purchase"));
    expect(added).toHaveLength(1);
    expect(added[0].variantId).toBe("v-purple-m");
  });
});
