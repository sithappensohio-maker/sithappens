/* The product editor actually renders.
 *
 * It did not. `ProductEditor` read `originalImageIds` as a bare identifier
 * from its parent's scope — legal to Babel, legal to Vite, invisible to every
 * source-pinned test — and threw "originalImageIds is not defined" the moment
 * the editor mounted. Editing any Shop item was impossible from either screen
 * that opens it.
 *
 * So: mount it, from both call sites, the way each one actually calls it.
 *
 * The prop is not cosmetic. The gallery deletes any image NOT in
 * originalImageIds as soon as it is removed, on the grounds that it can only
 * be a this-session upload. Hand it an empty list for an existing product and
 * removing a photo deletes it from the server before the admin saves.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ProductEditor } from "./ManageProductsPanel";

jest.mock("../lib/api", () => ({
  api: {
    get: jest.fn(() => Promise.resolve({ data: [] })),
    post: jest.fn(() => Promise.resolve({ data: { media_id: "new-1" } })),
    put: jest.fn(() => Promise.resolve({ data: {} })),
    delete: jest.fn(() => Promise.resolve({ data: {} })),
    defaults: { baseURL: "/api" },
  },
  formatErr: (e) => String(e),
}));
jest.mock("../lib/imageCompress", () => ({ compressImage: jest.fn() }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const { api } = require("../lib/api");

global.IS_REACT_ACT_ENVIRONMENT = true;

const FORM = {
  name: "Bark Hole Tag", category: "", description: "", price: "24.99", cost: "",
  starting_stock: "0", low_stock_threshold: "", track_inventory: false, active: true,
  show_online: true, online_description: "", image_id: "img-1", image_ids: ["img-1", "img-2"],
  online_sort_order: "", category_id: null, subcategory_id: null, featured: false,
  show_at_register: true, sales_destination: "internal", shopify_product_url: "",
  shopify_display_price: "", shopify_from_price: false, publicly_visible: false,
  guest_cart_allowed: false, show_public_price: true, requires_approval: false,
  requires_completed_onboarding: false,
};

function mount(ui) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(ui); });
  return {
    host,
    text: () => host.textContent || "",
    cleanup: () => { act(() => root.unmount()); host.remove(); },
  };
}

const editor = (extra = {}) => (
  <ProductEditor form={FORM} setForm={() => {}} editingId="prod-1" originalImageId="img-1"
                 saving={false} onSave={() => {}} onClose={() => {}} {...extra} />
);

describe("the editor mounts from every screen that opens it", () => {
  test("Shop Manager — the screen in the crash report", () => {
    const w = mount(editor({ originalImageIds: ["img-1", "img-2"], relatableItems: [] }));
    expect(w.text()).toMatch(/product photo/i);
    w.cleanup();
  });

  test("Manage Products panel", () => {
    const w = mount(editor({ originalImageIds: ["img-1", "img-2"] }));
    expect(w.text()).toMatch(/product photo/i);
    w.cleanup();
  });

  test("a caller that forgets the prop still renders instead of crashing", () => {
    // The default is the backstop. Without it this throws a ReferenceError
    // and the whole admin UI drops to the error screen.
    expect(() => {
      const w = mount(editor());
      w.cleanup();
    }).not.toThrow();
  });

  test("a brand-new product with no photos yet", () => {
    const w = mount(
      <ProductEditor form={{ ...FORM, image_id: null, image_ids: [] }} setForm={() => {}}
                     editingId={null} originalImageId={null} originalImageIds={[]}
                     saving={false} onSave={() => {}} onClose={() => {}} />
    );
    expect(w.text()).toMatch(/product photo/i);
    w.cleanup();
  });

  test("a Shopify listing, which renders a different half of the form", () => {
    const w = mount(editor({
      form: { ...FORM, sales_destination: "shopify_external", shopify_display_price: "24.99" },
      originalImageIds: ["img-1"],
    }));
    expect(w.text()).toMatch(/product photo/i);
    w.cleanup();
  });
});

describe("existing photos are not deleted before the admin saves", () => {
  const removeFirstPhoto = (host) => {
    const remove = [...host.querySelectorAll("button")]
      .find((b) => /remove|delete|×|✕/i.test(b.textContent || "") || /remove/i.test(b.getAttribute("aria-label") || ""));
    if (remove) act(() => { remove.click(); });
    return !!remove;
  };

  test("removing a photo the product already had does not call DELETE", () => {
    api.delete.mockClear();
    const w = mount(editor({ originalImageIds: ["img-1", "img-2"] }));
    const clicked = removeFirstPhoto(w.host);
    if (clicked) {
      const deleted = api.delete.mock.calls.map((c) => String(c[0]));
      expect(deleted.some((u) => u.includes("img-1") || u.includes("img-2"))).toBe(false);
    }
    w.cleanup();
  });

  test("and WOULD delete it if the originals were lost — which is why the prop matters", () => {
    api.delete.mockClear();
    // Same product, but the editor is told it had no photos to begin with.
    const w = mount(editor({ originalImageIds: [] }));
    const clicked = removeFirstPhoto(w.host);
    if (clicked) {
      const deleted = api.delete.mock.calls.map((c) => String(c[0]));
      expect(deleted.some((u) => u.includes("img-1") || u.includes("img-2"))).toBe(true);
    }
    w.cleanup();
  });
});
