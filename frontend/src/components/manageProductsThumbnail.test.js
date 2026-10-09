/* Manage Products' list table showed name/category/price/cost/stock/status
 * with no product photo. Its sibling screen, Shop Manager's Items tab,
 * already shows a 40px ItemThumbnail per row for the same catalog data.
 * This mounts the real ManageProductsPanel (not a source-pin) and checks
 * the same shared ItemThumbnail now renders beside each product name,
 * reading the same `image_id` field ShopManager reads.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import ManageProductsPanel from "./ManageProductsPanel";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn(), defaults: { baseURL: "/api" } },
  formatErr: (e) => String(e || ""),
}));
jest.mock("../lib/imageCompress", () => ({ compressImage: jest.fn() }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const { api } = require("../lib/api");
global.IS_REACT_ACT_ENVIRONMENT = true;

const PHOTO_PRODUCT = { id: "p1", name: "Leash", price: 19.99, cost: 5, stock_on_hand: 3, track_inventory: true, active: true, image_id: "img-1" };
const NO_PHOTO_PRODUCT = { id: "p2", name: "Collar", price: 14.99, cost: 4, stock_on_hand: 2, track_inventory: true, active: true, image_id: null };

let container, root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset().mockImplementation(async (url) => {
    if (url === "/pos/products") return { data: [PHOTO_PRODUCT, NO_PHOTO_PRODUCT] };
    if (url === "/shop/categories") return { data: { categories: [] } };
    return { data: [] };
  });
});
afterEach(() => { act(() => root?.unmount()); container.remove(); });

const flush = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve(); }); };
const q = (id) => container.querySelector(`[data-testid="${id}"]`);

test("each product row shows the shared ItemThumbnail, reading image_id", async () => {
  await act(async () => {
    root = createRoot(container);
    root.render(<ManageProductsPanel onClose={() => {}} onChanged={() => {}} />);
  });
  await flush();

  const photoRow = q("product-row-p1");
  const noPhotoRow = q("product-row-p2");
  expect(photoRow).not.toBeNull();
  expect(noPhotoRow).not.toBeNull();

  // A product with an image_id gets a real <img>, built from that id.
  const img = photoRow.querySelector('[data-testid="item-thumbnail-img"]');
  expect(img).not.toBeNull();
  expect(img.getAttribute("src")).toContain("img-1");

  // A product with no image_id falls back to the shared placeholder box,
  // not a broken image request.
  expect(noPhotoRow.querySelector('[data-testid="item-thumbnail-img"]')).toBeNull();
  expect(noPhotoRow.querySelector('[data-testid="item-thumbnail-placeholder"]')).not.toBeNull();

  // Still a pure visual addition: the existing action links are untouched.
  expect(photoRow.querySelector('[data-testid="product-duplicate-p1"]')).not.toBeNull();
  expect(photoRow.querySelector('[data-testid="product-delete-p1"]')).not.toBeNull();
});
