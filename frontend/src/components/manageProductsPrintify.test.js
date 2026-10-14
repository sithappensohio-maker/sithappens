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
