/**
 * Product descriptions as real rich text (owner: "the textbox" "with
 * formatting and headers and color and text options", 2026-10-17).
 * ManageProductsPanel.jsx now edits description/online_description with
 * RichTextEditor, so a product's stored description can be real HTML —
 * this proves ShopItemDetail's own FormattedDescription renders it
 * (sanitized) instead of running it through the plain-text paragraph/
 * bullet splitter, while every description written BEFORE this existed
 * (plain text, no tags — also still the only format credit_pack/
 * training_program descriptions ever use, since this component is
 * shared across all three kinds) keeps rendering exactly as it always
 * has, unaffected.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import ShopItemDetail from "./ShopItemDetail";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn() },
  formatErr: (e) => String(e?.response?.data?.detail || e || ""),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const { api } = require("../lib/api");

global.IS_REACT_ACT_ENVIRONMENT = true;

let container, root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  container.remove();
});

const mountDetail = async (item) => {
  api.get.mockResolvedValue({ data: item });
  await act(async () => {
    root = createRoot(container);
    root.render(
      <ShopItemDetail kind="product" itemId={item.id} cart={[]}
                      onAddToCart={() => {}} onBack={() => {}} allItems={[item]} onOpenItem={() => {}}
                      mode="guest" dogs={[]} />,
    );
  });
};

const description = () => container.querySelector(".shop-rich-description, [data-testid='shop-detail'] p");
const html = () => container.querySelector(".shop-rich-description")?.innerHTML;

const BASE = { kind: "product", id: "p1", name: "Leash", price: 20, in_stock: true, image_ids: [] };

test("a plain-text description (no tags) still renders through the old paragraph/bullet splitter", async () => {
  await mountDetail({ ...BASE, description: "Soft and strong.\n\n- Six feet long\n- Brass clip" });
  expect(container.querySelector(".shop-rich-description")).toBeFalsy();
  expect(container.textContent).toContain("Soft and strong.");
  const list = container.querySelector("ul");
  expect(list).toBeTruthy();
  expect(list.textContent).toContain("Six feet long");
});

test("a RichTextEditor-authored description (real tags) renders as real HTML", async () => {
  await mountDetail({ ...BASE, description: "<h2>Durable</h2><p>Soft and <strong>strong</strong>.</p>" });
  const el = container.querySelector(".shop-rich-description");
  expect(el).toBeTruthy();
  expect(el.querySelector("h2").textContent).toBe("Durable");
  expect(el.querySelector("strong").textContent).toBe("strong");
});

test("a script tag in a description is stripped before it ever reaches the page", async () => {
  await mountDetail({ ...BASE, description: '<p>Hello</p><script>window.__pwned = true;</script>' });
  expect(html()).toBe("<p>Hello</p>");
  expect(window.__pwned).toBeUndefined();
});

test("an onerror handler is stripped, not executed", async () => {
  await mountDetail({ ...BASE, description: '<p>Pic</p><img src="x" onerror="window.__pwned = true">' });
  expect(html()).not.toContain("onerror");
  expect(window.__pwned).toBeUndefined();
});

test("an empty description still shows the existing placeholder, neither renderer applies", async () => {
  await mountDetail({ ...BASE, description: "" });
  expect(container.textContent).toContain("Additional information is not available yet.");
});
