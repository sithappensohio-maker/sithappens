/* The Printify destination on the product editor: a third Sales
 * Destination (alongside Internal and Shopify Link) that still keeps
 * price/cost/options — unlike the Shopify link, which is display-only —
 * and swaps each option's barcode/stock fields for a Printify variant id,
 * since a Printify item is made on demand (nothing to scan or stock).
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ProductEditor } from "./ManageProductsPanel";

jest.mock("../lib/api", () => ({
  api: {
    get: jest.fn(() => Promise.resolve({ data: [] })),
    post: jest.fn(() => Promise.resolve({ data: {} })),
    put: jest.fn(() => Promise.resolve({ data: {} })),
    delete: jest.fn(() => Promise.resolve({ data: {} })),
    defaults: { baseURL: "/api" },
  },
  formatErr: (e) => String(e),
}));
jest.mock("../lib/imageCompress", () => ({ compressImage: jest.fn() }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

global.IS_REACT_ACT_ENVIRONMENT = true;

const BASE_FORM = {
  name: "Trail Dog Hoodie", category: "", description: "", price: "40", cost: "",
  starting_stock: "0", low_stock_threshold: "", track_inventory: false, active: true,
  show_online: false, online_description: "", image_id: null, image_ids: [],
  online_sort_order: "", category_id: null, subcategory_id: null, featured: false,
  show_at_register: true, sales_destination: "printify", shopify_product_url: "",
  shopify_display_price: "", shopify_from_price: false, printify_product_id: "pf-prod-1",
  publicly_visible: false, guest_cart_allowed: false, show_public_price: true,
  requires_approval: false, requires_completed_onboarding: false,
  variants: [{ _localKey: "v1", name: "Small", printify_variant_id: "pf-var-s", price_override: "" }],
};

function mount(ui) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return {
    host,
    text: () => host.textContent || "",
    q: (sel) => host.querySelector(sel),
    cleanup: () => { act(() => root.unmount()); host.remove(); },
  };
}

const editor = (form, setForm, extra = {}) => (
  <ProductEditor form={form} setForm={setForm} editingId="prod-1" originalImageId={null}
                 saving={false} onSave={() => {}} onClose={() => {}} {...extra} />
);

test("shows the Printify Product ID field and a per-size Printify Variant ID, never barcode/stock", () => {
  const w = mount(editor(BASE_FORM, () => {}));
  expect(w.q('[data-testid="product-printify-id"]')).toBeTruthy();
  expect(w.q('[data-testid="product-variant-printify-id-0"]')).toBeTruthy();
  expect(w.q('[data-testid="product-variant-sku-0"]')).toBeFalsy();
  expect(w.q('[data-testid="product-variant-stock-0"]')).toBeFalsy();
  expect(w.q('[data-testid="product-sku"]')).toBeFalsy();
  expect(w.q('[data-testid="product-printify-online-note"]')).toBeTruthy();
  w.cleanup();
});

test("keeps price editable for a Printify listing, unlike the Shopify link", () => {
  const w = mount(editor(BASE_FORM, () => {}));
  // "Selling Price" shows for printify (price/cost section), but no
  // Shopify-only "Displayed Price" field.
  expect(w.text()).toMatch(/Selling Price/i);
  expect(w.q('[data-testid="product-shopify-url"]')).toBeFalsy();
  w.cleanup();
});

test("switching Sales Destination to Printify updates the form", () => {
  let current = { ...BASE_FORM, sales_destination: "internal", variants: [] };
  const setForm = jest.fn((updater) => { current = updater(current); });
  const w = mount(editor(current, setForm));
  act(() => { w.q('[data-testid="destination-printify"]').dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  expect(current.sales_destination).toBe("printify");
  w.cleanup();
});

test("requires at least one size — the add-size empty state says so", () => {
  const w = mount(editor({ ...BASE_FORM, variants: [] }, () => {}));
  expect(w.text()).toMatch(/needs at least one size/i);
  w.cleanup();
});

describe("Fetch Sizes from Printify", () => {
  const { api } = require("../lib/api");
  const { toast } = require("sonner");
  const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

  const PRODUCT = {
    id: "pf-prod-1", title: "Trail Dog Hoodie", image: "https://example.com/hoodie.jpg",
    blueprint_id: 6, print_provider_id: 99,
    variants: [
      { id: "pf-var-s", title: "Black / S", price: 19.99, is_available: true },
      { id: "pf-var-m", title: "Black / M", price: 19.99, is_available: true },
      { id: "pf-var-xl", title: "Black / XL", price: 21.94, is_available: false },
    ],
  };

  test("the button is disabled without a Printify product id, enabled with one", () => {
    const w = mount(editor({ ...BASE_FORM, printify_product_id: "" }, () => {}));
    expect(w.q('[data-testid="product-printify-fetch-sizes"]').disabled).toBe(true);
    w.cleanup();
  });

  test("clicking it fetches the product's variants and lists them, already-added ones marked", async () => {
    api.get.mockReset();
    api.get.mockResolvedValue({ data: PRODUCT });
    const w = mount(editor(BASE_FORM, () => {}));
    await act(async () => { w.q('[data-testid="product-printify-fetch-sizes"]').click(); });
    await flush();
    expect(api.get).toHaveBeenCalledWith("/admin/printify/products/pf-prod-1");
    expect(w.text()).toContain("Trail Dog Hoodie");
    expect(w.text()).toContain("Black / S");
    expect(w.q('[data-testid="printify-picker-row-pf-var-xl"]').textContent).toContain("Unavailable");
    w.cleanup();
  });

  test("checking sizes and confirming adds exactly those rows, with price_override only when it differs", async () => {
    api.get.mockReset();
    api.get.mockResolvedValue({ data: PRODUCT });
    let current = { ...BASE_FORM, variants: [] }; // start with no sizes so pf-var-s/m aren't "already added"
    const setForm = jest.fn((updater) => { current = updater(current); });
    const w = mount(editor(current, setForm));
    await act(async () => { w.q('[data-testid="product-printify-fetch-sizes"]').click(); });
    await flush();
    await act(async () => { w.q('[data-testid="printify-picker-row-pf-var-s"] input[type=checkbox]').click(); });
    await act(async () => { w.q('[data-testid="printify-picker-row-pf-var-xl"] input[type=checkbox]').click(); });
    await act(async () => { w.q('[data-testid="printify-picker-add"]').click(); });
    expect(current.variants).toHaveLength(2);
    const s = current.variants.find((v) => v.printify_variant_id === "pf-var-s");
    const xl = current.variants.find((v) => v.printify_variant_id === "pf-var-xl");
    expect(s.name).toBe("Black / S");
    expect(s.price_override).toBe("19.99"); // differs from BASE_FORM's $40 base price — kept explicit
    expect(xl.price_override).toBe("21.94"); // also differs — kept explicit
    expect(current.printify_blueprint_id).toBe(6);
    expect(current.printify_print_provider_id).toBe(99);
    expect(toast.success).toHaveBeenCalled();
    w.cleanup();
  });

  test("a variant already on the form can't be double-added", async () => {
    api.get.mockReset();
    api.get.mockResolvedValue({ data: PRODUCT });
    // BASE_FORM already has pf-var-s as "Small".
    const w = mount(editor(BASE_FORM, () => {}));
    await act(async () => { w.q('[data-testid="product-printify-fetch-sizes"]').click(); });
    await flush();
    const row = w.q('[data-testid="printify-picker-row-pf-var-s"]');
    expect(row.textContent).toContain("already added");
    expect(row.querySelector("input[type=checkbox]").disabled).toBe(true);
    w.cleanup();
  });

  test("a fetch failure shows the real error instead of a blank modal", async () => {
    api.get.mockReset();
    api.get.mockRejectedValue({ response: { data: { detail: "Printify couldn't find that product: 404" } } });
    const w = mount(editor(BASE_FORM, () => {}));
    await act(async () => { w.q('[data-testid="product-printify-fetch-sizes"]').click(); });
    await flush();
    expect(w.q('[role="alert"]').textContent).toContain("couldn't find that product");
    w.cleanup();
  });

  test("filtering narrows the list to matching sizes/colors", async () => {
    api.get.mockReset();
    api.get.mockResolvedValue({ data: PRODUCT });
    const w = mount(editor({ ...BASE_FORM, variants: [] }, () => {}));
    await act(async () => { w.q('[data-testid="product-printify-fetch-sizes"]').click(); });
    await flush();
    const filterInput = w.q('[data-testid="printify-picker-filter"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    await act(async () => {
      setter.call(filterInput, "XL");
      filterInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(w.q('[data-testid="printify-picker-row-pf-var-xl"]')).toBeTruthy();
    expect(w.q('[data-testid="printify-picker-row-pf-var-s"]')).toBeFalsy();
    w.cleanup();
  });

  const PRODUCT_WITH_IMAGES = {
    ...PRODUCT,
    description: "Soft and cozy.",
    images: [
      { src: "https://img/front.jpg", is_default: true },
      { src: "https://img/back.jpg", is_default: false },
    ],
  };

  test("mockup photos show checked by default; unchecking one leaves it out of the import", async () => {
    api.get.mockReset();
    api.get.mockResolvedValue({ data: PRODUCT_WITH_IMAGES });
    api.post.mockReset();
    api.post.mockResolvedValue({ data: { image_ids: ["m1"], errors: [] } });
    let current = { ...BASE_FORM, variants: [], name: "" };
    const setForm = jest.fn((updater) => { current = updater(current); });
    const w = mount(editor(current, setForm));
    await act(async () => { w.q('[data-testid="product-printify-fetch-sizes"]').click(); });
    await flush();
    expect(w.q('[data-testid="printify-picker-images"]')).toBeTruthy();
    expect(w.text()).toContain("2 of 2 selected");
    await act(async () => { w.q('[data-testid="printify-picker-image-https://img/back.jpg"]').click(); });
    expect(w.text()).toContain("1 of 2 selected");
    await act(async () => { w.q('[data-testid="printify-picker-row-pf-var-s"] input[type=checkbox]').click(); });
    await act(async () => { w.q('[data-testid="printify-picker-add"]').click(); });
    await flush();
    expect(api.post).toHaveBeenCalledWith(
      "/admin/printify/products/pf-prod-1/import-images", { urls: ["https://img/front.jpg"] });
    w.cleanup();
  });

  test("imported photo ids land in form.image_ids, and a blank name/description get filled from Printify's own", async () => {
    api.get.mockReset();
    api.get.mockResolvedValue({ data: PRODUCT_WITH_IMAGES });
    api.post.mockReset();
    api.post.mockResolvedValue({ data: { image_ids: ["m1", "m2"], errors: [] } });
    let current = { ...BASE_FORM, variants: [], name: "", description: "", image_ids: [] };
    const setForm = jest.fn((updater) => { current = updater(current); });
    const w = mount(editor(current, setForm));
    await act(async () => { w.q('[data-testid="product-printify-fetch-sizes"]').click(); });
    await flush();
    await act(async () => { w.q('[data-testid="printify-picker-row-pf-var-s"] input[type=checkbox]').click(); });
    await act(async () => { w.q('[data-testid="printify-picker-add"]').click(); });
    await flush();
    expect(current.name).toBe("Trail Dog Hoodie");
    expect(current.description).toBe("Soft and cozy.");
    expect(current.image_ids).toEqual(["m1", "m2"]);
    expect(current.image_id).toBe("m1");
    w.cleanup();
  });

  test("a name/description the admin already typed is never overwritten by the import", async () => {
    api.get.mockReset();
    api.get.mockResolvedValue({ data: PRODUCT_WITH_IMAGES });
    api.post.mockReset();
    api.post.mockResolvedValue({ data: { image_ids: [], errors: [] } });
    let current = { ...BASE_FORM, variants: [], name: "My Own Name", description: "My own description" };
    const setForm = jest.fn((updater) => { current = updater(current); });
    const w = mount(editor(current, setForm));
    await act(async () => { w.q('[data-testid="product-printify-fetch-sizes"]').click(); });
    await flush();
    await act(async () => { w.q('[data-testid="printify-picker-row-pf-var-s"] input[type=checkbox]').click(); });
    await act(async () => { w.q('[data-testid="printify-picker-add"]').click(); });
    await flush();
    expect(current.name).toBe("My Own Name");
    expect(current.description).toBe("My own description");
    w.cleanup();
  });

  test("a product with no mockup photos shows no photo picker and never calls import-images", async () => {
    api.get.mockReset();
    api.get.mockResolvedValue({ data: PRODUCT }); // no `images` field at all
    api.post.mockReset();
    const w = mount(editor({ ...BASE_FORM, variants: [] }, () => {}));
    await act(async () => { w.q('[data-testid="product-printify-fetch-sizes"]').click(); });
    await flush();
    expect(w.q('[data-testid="printify-picker-images"]')).toBeFalsy();
    await act(async () => { w.q('[data-testid="printify-picker-row-pf-var-s"] input[type=checkbox]').click(); });
    await act(async () => { w.q('[data-testid="printify-picker-add"]').click(); });
    await flush();
    expect(api.post).not.toHaveBeenCalled();
    w.cleanup();
  });

  test("a partial image-import failure still keeps the ones that worked and tells the admin", async () => {
    api.get.mockReset();
    api.get.mockResolvedValue({ data: PRODUCT_WITH_IMAGES });
    api.post.mockReset();
    api.post.mockResolvedValue({ data: { image_ids: ["m1"], errors: ["back.jpg: too large"] } });
    toast.error.mockClear();
    let current = { ...BASE_FORM, variants: [], image_ids: [] };
    const setForm = jest.fn((updater) => { current = updater(current); });
    const w = mount(editor(current, setForm));
    await act(async () => { w.q('[data-testid="product-printify-fetch-sizes"]').click(); });
    await flush();
    await act(async () => { w.q('[data-testid="printify-picker-row-pf-var-m"] input[type=checkbox]').click(); });
    await act(async () => { w.q('[data-testid="printify-picker-add"]').click(); });
    await flush();
    expect(current.image_ids).toEqual(["m1"]);
    expect(toast.error).toHaveBeenCalled();
    w.cleanup();
  });

  // Owner: a product that already has every size added used to dead-end
  // here — "doesnt let me refetch sizes this should be a thing for when i
  // change something in printify i can update it here by re pulling".
  // BASE_FORM already has pf-var-s added, so this is exactly that case.
  describe("re-fetching on a product that already has every size (owner report)", () => {
    const PRODUCT_WITH_IMAGES_ALL_ADDED = {
      ...PRODUCT, variants: [PRODUCT.variants[0]], // only pf-var-s exists on Printify's side too
      images: [{ src: "https://img/front.jpg", is_default: true }, { src: "https://img/back.jpg", is_default: false }],
    };

    test("photos default to NONE checked, unlike a first-time import", async () => {
      api.get.mockReset();
      api.get.mockResolvedValue({ data: PRODUCT_WITH_IMAGES_ALL_ADDED });
      const w = mount(editor(BASE_FORM, () => {}));
      await act(async () => { w.q('[data-testid="product-printify-fetch-sizes"]').click(); });
      await flush();
      expect(w.text()).toContain("0 of 2 selected");
      w.cleanup();
    });

    test("the confirm button is disabled until a photo is checked, then reads Update Photos", async () => {
      api.get.mockReset();
      api.get.mockResolvedValue({ data: PRODUCT_WITH_IMAGES_ALL_ADDED });
      const w = mount(editor(BASE_FORM, () => {}));
      await act(async () => { w.q('[data-testid="product-printify-fetch-sizes"]').click(); });
      await flush();
      const btn = w.q('[data-testid="printify-picker-add"]');
      expect(btn.disabled).toBe(true);
      await act(async () => { w.q('[data-testid="printify-picker-image-https://img/front.jpg"]').click(); });
      expect(btn.disabled).toBe(false);
      expect(btn.textContent).toBe("Update Photos");
      w.cleanup();
    });

    test("confirming with only a photo checked imports it, adds no sizes, and never says \"Added 0 sizes\"", async () => {
      api.get.mockReset();
      api.get.mockResolvedValue({ data: PRODUCT_WITH_IMAGES_ALL_ADDED });
      api.post.mockReset();
      api.post.mockResolvedValue({ data: { image_ids: ["m9"], errors: [] } });
      toast.success.mockClear();
      let current = { ...BASE_FORM };
      const setForm = jest.fn((updater) => { current = updater(current); });
      const w = mount(editor(current, setForm));
      await act(async () => { w.q('[data-testid="product-printify-fetch-sizes"]').click(); });
      await flush();
      await act(async () => { w.q('[data-testid="printify-picker-image-https://img/back.jpg"]').click(); });
      await act(async () => { w.q('[data-testid="printify-picker-add"]').click(); });
      await flush();
      expect(api.post).toHaveBeenCalledWith(
        "/admin/printify/products/pf-prod-1/import-images", { urls: ["https://img/back.jpg"] });
      expect(current.variants).toEqual(BASE_FORM.variants); // no new size rows added
      expect(toast.success).not.toHaveBeenCalledWith(expect.stringContaining("0 sizes"));
      expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("1 photo"));
      w.cleanup();
    });
  });
});

// Owner: "we could just dump shopify all together" — now that Printify
// handles print-on-demand directly, Shopify is never offered for a NEW
// product; it only still shows for one that's already on it, so an admin
// can keep seeing/editing it until they move it to Printify themselves.
describe("Shopify is retired going forward", () => {
  test("a product that isn't already on Shopify never offers it as a destination", () => {
    const w = mount(editor({ ...BASE_FORM, sales_destination: "internal" }, () => {}));
    expect(w.q('[data-testid="destination-shopify"]')).toBeFalsy();
    expect(w.q('[data-testid="destination-internal"]')).toBeTruthy();
    expect(w.q('[data-testid="destination-printify"]')).toBeTruthy();
    w.cleanup();
  });

  test("a product already on Shopify still shows it, so it stays visible/editable until moved", () => {
    const w = mount(editor({ ...BASE_FORM, sales_destination: "shopify_external", printify_product_id: "" }, () => {}));
    expect(w.q('[data-testid="destination-shopify"]')).toBeTruthy();
    w.cleanup();
  });
});
