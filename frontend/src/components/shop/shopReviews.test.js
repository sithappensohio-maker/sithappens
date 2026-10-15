/**
 * The product-page reviews section: a published list anyone can read,
 * and (for a signed-in client who bought the item) a form to write or
 * edit theirs. The real review and moderation logic lives server-side
 * (domains.shop.reviews) — this only proves the UI reads the right
 * endpoint for the viewer and shows the right form state.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import ShopReviews from "./ShopReviews";

jest.mock("../../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock("sonner", () => ({ toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }) }));

const { api } = require("../../lib/api");
const { toast } = require("sonner");

global.IS_REACT_ACT_ENVIRONMENT = true;

let container, root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset();
  api.post.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  root = null;
});

const mount = async (el) => {
  await act(async () => { root = createRoot(container); root.render(el); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
};

const q = (id) => document.querySelector(`[data-testid="${id}"]`);
const click = async (id) => { await act(async () => { q(id).click(); }); };

const REVIEW = {
  id: "r1", product_id: "p1", client_name: "Sam Client", rating: 5, text: "Great leash!",
  status: "published", created_at: "2026-01-01T00:00:00+00:00",
};

test("a guest sees published reviews and the aggregate, with no write form", async () => {
  api.get.mockResolvedValue({ data: { reviews: [REVIEW], rating_avg: 5, rating_count: 1 } });
  await mount(<ShopReviews productId="p1" mode="guest" />);

  expect(api.get).toHaveBeenCalledWith("/public/shop/products/p1/reviews");
  expect(q("shop-reviews-list")).toBeTruthy();
  expect(q("shop-review-r1").textContent).toContain("Sam Client");
  expect(q("shop-review-r1").textContent).toContain("Great leash!");
  expect(q("shop-review-form")).toBeFalsy();
  expect(q("shop-my-review")).toBeFalsy();
});

test("a client who hasn't bought the item sees no write form and no 'my review' block", async () => {
  api.get.mockResolvedValue({ data: { reviews: [], rating_avg: null, rating_count: 0, my_review: null, can_review: false } });
  await mount(<ShopReviews productId="p1" mode="authenticated" />);

  expect(api.get).toHaveBeenCalledWith("/shop/products/p1/reviews");
  expect(q("shop-review-form")).toBeFalsy();
  expect(q("shop-my-review")).toBeFalsy();
  expect(q("shop-reviews-empty")).toBeTruthy();
});

test("an eligible client sees the write form and can submit a review", async () => {
  api.get.mockResolvedValue({ data: { reviews: [], rating_avg: null, rating_count: 0, my_review: null, can_review: true } });
  api.post.mockResolvedValue({ data: { id: "r2", status: "pending" } });
  await mount(<ShopReviews productId="p1" mode="authenticated" />);

  expect(q("shop-review-form")).toBeTruthy();
  await click("shop-review-star-4");
  await click("shop-review-submit");

  expect(api.post).toHaveBeenCalledWith("/shop/products/p1/reviews", { rating: 4, text: null });
  expect(toast.success).toHaveBeenCalled();
});

test("the submit button stays disabled until a rating is chosen", async () => {
  api.get.mockResolvedValue({ data: { reviews: [], rating_avg: null, rating_count: 0, my_review: null, can_review: true } });
  await mount(<ShopReviews productId="p1" mode="authenticated" />);
  expect(q("shop-review-submit").disabled).toBe(true);
  await click("shop-review-star-3");
  expect(q("shop-review-submit").disabled).toBe(false);
});

test("a client who already reviewed sees their review instead of a blank form, with an edit option", async () => {
  const mine = { id: "r1", rating: 3, text: "Fine", status: "pending" };
  api.get.mockResolvedValue({ data: { reviews: [], rating_avg: null, rating_count: 0, my_review: mine, can_review: false } });
  await mount(<ShopReviews productId="p1" mode="authenticated" />);

  expect(q("shop-my-review")).toBeTruthy();
  expect(q("shop-my-review").textContent).toContain("awaiting approval");
  expect(q("shop-review-form")).toBeFalsy();

  await click("shop-my-review-edit");
  expect(q("shop-review-form")).toBeTruthy();
});

test("a rejected review is labeled as not shown publicly", async () => {
  const mine = { id: "r1", rating: 2, text: "", status: "rejected" };
  api.get.mockResolvedValue({ data: { reviews: [], rating_avg: null, rating_count: 0, my_review: mine, can_review: false } });
  await mount(<ShopReviews productId="p1" mode="authenticated" />);
  expect(q("shop-my-review").textContent).toContain("not shown publicly");
});

test("the aggregate shows stars and a count when there are published reviews", async () => {
  api.get.mockResolvedValue({ data: { reviews: [REVIEW], rating_avg: 4.3, rating_count: 7, my_review: null, can_review: false } });
  await mount(<ShopReviews productId="p1" mode="authenticated" />);
  expect(q("shop-reviews-section").textContent).toContain("(7)");
  expect(q("shop-reviews-section").textContent).toContain("4.3 out of 5");
});
