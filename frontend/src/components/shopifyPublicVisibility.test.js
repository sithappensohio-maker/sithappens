/* A Shopify listing is allowed on the guest storefront.
 *
 * It could not be: both editors hardcoded `publicly_visible: false` for a
 * Shopify listing, and the public-storefront controls were hidden from the
 * form entirely, so nobody could turn it on. As a side effect the flag was
 * written as an explicit false, which is what revoked the listing's own
 * product photography (see shopImageFallback.test.js).
 *
 * What must NOT follow: a guest cart. Nothing is bought on our side for these
 * — the button hands the visitor to Shopify — so the guest-cart and
 * account-gate controls stay internal-only, and the server refuses a Shopify
 * guest purchase regardless (backend/domains/shop/guest.guest_block_reason).
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ProductEditor } from "./ManageProductsPanel";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(() => Promise.resolve({ data: [] })), post: jest.fn(), put: jest.fn(), delete: jest.fn(), defaults: { baseURL: "/api" } },
  formatErr: (e) => String(e),
}));
jest.mock("../lib/imageCompress", () => ({ compressImage: jest.fn() }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

global.IS_REACT_ACT_ENVIRONMENT = true;

const BASE = {
  name: "Bark Hole Tag", category: "", description: "", price: "", cost: "",
  starting_stock: "0", low_stock_threshold: "", track_inventory: false, active: true,
  show_online: true, online_description: "", image_id: null, image_ids: [],
  online_sort_order: "", category_id: null, subcategory_id: null, featured: false,
  show_at_register: true, sales_destination: "shopify_external",
  shopify_product_url: "https://example.myshopify.com/products/tag",
  shopify_display_price: "15.99", shopify_from_price: false,
  publicly_visible: true, guest_cart_allowed: false, show_public_price: true,
  requires_approval: false, requires_completed_onboarding: false,
};

function mount(form) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(<ProductEditor form={form} setForm={() => {}} editingId="p1" originalImageId={null}
                               originalImageIds={[]} saving={false} onSave={() => {}} onClose={() => {}} />);
  });
  return {
    text: () => host.textContent || "",
    testId: (id) => host.querySelector(`[data-testid="${id}"]`),
    cleanup: () => { act(() => root.unmount()); host.remove(); },
  };
}

describe("the admin can put a Shopify listing on the public storefront", () => {
  test("the Publicly Visible control is offered for a Shopify listing", () => {
    const w = mount({ ...BASE, publicly_visible: false });
    expect(w.testId("product-publicly-visible")).toBeTruthy();
    w.cleanup();
  });

  test("and the price toggle, so a guest can see what it costs", () => {
    const w = mount(BASE);
    expect(w.testId("product-show-public-price")).toBeTruthy();
    w.cleanup();
  });

  test("it explains what public means for a Shopify item", () => {
    const w = mount(BASE);
    expect(w.testId("product-shopify-public-note")).toBeTruthy();
    expect(w.text()).toMatch(/shopify/i);
    w.cleanup();
  });
});

describe("but it never becomes something a guest can buy here", () => {
  test("no guest-cart control for a Shopify listing", () => {
    const w = mount(BASE);
    expect(w.testId("product-guest-cart-allowed")).toBeNull();
    w.cleanup();
  });

  test("no account gates either — nothing is purchased on our side", () => {
    const w = mount(BASE);
    expect(w.testId("product-requires-approval")).toBeNull();
    expect(w.testId("product-requires-onboarding")).toBeNull();
    w.cleanup();
  });
});

describe("our own products are unchanged", () => {
  const internal = { ...BASE, sales_destination: "internal", price: "18.50" };

  test("an internal public product still offers the full set", () => {
    const w = mount(internal);
    expect(w.testId("product-publicly-visible")).toBeTruthy();
    expect(w.testId("product-guest-cart-allowed")).toBeTruthy();
    expect(w.testId("product-show-public-price")).toBeTruthy();
    expect(w.testId("product-requires-approval")).toBeTruthy();
    expect(w.testId("product-requires-onboarding")).toBeTruthy();
    expect(w.testId("product-shopify-public-note")).toBeNull();
    w.cleanup();
  });

  test("nothing public is offered while the item is not shown online at all", () => {
    const w = mount({ ...internal, show_online: false });
    expect(w.testId("product-publicly-visible")).toBeNull();
    w.cleanup();
  });

  test("the extra controls stay hidden until it is actually public", () => {
    const w = mount({ ...internal, publicly_visible: false });
    expect(w.testId("product-publicly-visible")).toBeTruthy();
    expect(w.testId("product-guest-cart-allowed")).toBeNull();
    expect(w.testId("product-show-public-price")).toBeNull();
    w.cleanup();
  });
});
