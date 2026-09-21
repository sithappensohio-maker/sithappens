/**
 * What happens to a guest's cart when they sign in.
 *
 * This is the step the whole guest experience rests on. Somebody browses,
 * fills a basket, hits something that needs an account, signs in — and if
 * the basket is gone at that moment, they do not build it again.
 *
 * Two rules are on trial:
 *
 *   1. Nothing is lost. Every line survives the round trip, including the
 *      name and message on a gift card addressed to somebody else.
 *   2. Nothing is remembered that should not be. The guest cart holds no
 *      prices, and after signing in every line is re-resolved against the
 *      authenticated catalog — so a client with their own rate gets their
 *      own rate, and a price that changed while they were browsing is the
 *      new one.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import GuestCartMergeReview from "./GuestCartMergeReview";
import { writeGuestCart, readGuestCart } from "../lib/shopGuestCart";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn() },
  formatErr: (e) => String(e?.response?.data?.detail || e || ""),
}));

const { api } = require("../lib/api");

global.IS_REACT_ACT_ENVIRONMENT = true;

let container, root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset();
  localStorage.clear();
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  root = null;
});

const mount = (el) => act(() => { root = createRoot(container); root.render(el); });
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const byTestId = (id) => document.querySelector(`[data-testid="${id}"]`);
const text = () => document.body.textContent;

// The authenticated catalog — the ONLY source of price and stock here.
const CATALOG = [
  { kind: "product", id: "p1", name: "Husky Rope Leash", price: 18.0, track_inventory: true, in_stock: true, stock_on_hand: 10 },
  { kind: "product", id: "p2", name: "Low Stock Thing", price: 9.0, track_inventory: true, in_stock: true, stock_on_hand: 1 },
  { kind: "gift_card", id: "gc-2500", name: "Gift card · $25", price: 25.0 },
  { kind: "credit_pack", id: "pk1", name: "5 Daycare Visits", price: 150.0 },
];

const render = (authCart = [], onApply = () => {}) => {
  api.get.mockResolvedValue({ data: { items: CATALOG } });
  mount(<GuestCartMergeReview authCart={authCart} onApply={onApply} onDismiss={() => {}} />);
};

test("the cart a guest built is still there after signing in", async () => {
  writeGuestCart([
    { kind: "product", ref_id: "p1", quantity: 2 },
    { kind: "credit_pack", ref_id: "pk1", quantity: 1 },
  ]);
  let applied = null;
  render([], (next) => { applied = next; });
  await flush();
  expect(byTestId("guest-cart-merge-review")).toBeTruthy();
  expect(text()).toContain("Husky Rope Leash");
  expect(text()).toContain("5 Daycare Visits");

  await act(async () => { byTestId("guest-merge-confirm").click(); });
  expect(applied).toEqual([
    { kind: "product", ref_id: "p1", quantity: 2 },
    { kind: "credit_pack", ref_id: "pk1", quantity: 1 },
  ]);
  // The account-required line came through too — signing in is exactly what
  // made it buyable, so dropping it here would be perverse.
});

test("the price shown after signing in is the account's, never the guest's", async () => {
  // The guest cart stores no price at all, so there is nothing stale to
  // show; the number on screen can only have come from /shop/catalog.
  writeGuestCart([{ kind: "product", ref_id: "p1", quantity: 1, price: 999 }]);
  expect(readGuestCart()[0].price).toBeUndefined();
  render();
  await flush();
  expect(api.get).toHaveBeenCalledWith("/shop/catalog");
  expect(text()).toContain("$18.00");
  expect(text()).not.toContain("999");
});

test("a gift card keeps the person it was addressed to", async () => {
  writeGuestCart([{
    kind: "gift_card", ref_id: "gc-2500", quantity: 1,
    gift: { recipient_email: "nan@example.com", recipient_name: "Nan", gift_message: "Happy birthday" },
  }]);
  let applied = null;
  render([], (next) => { applied = next; });
  await flush();
  expect(byTestId("guest-merge-line-gift").textContent).toContain("Nan");
  await act(async () => { byTestId("guest-merge-confirm").click(); });
  expect(applied[0].gift).toEqual({
    recipient_email: "nan@example.com", recipient_name: "Nan", gift_message: "Happy birthday",
  });
});

test("two cards of the same value for two people stay two lines", async () => {
  // They share a kind and a ref_id. Merging on those alone sends both to
  // whoever happened to be first.
  writeGuestCart([
    { kind: "gift_card", ref_id: "gc-2500", quantity: 1, gift: { recipient_email: "nan@example.com" } },
    { kind: "gift_card", ref_id: "gc-2500", quantity: 1, gift: { recipient_email: "sam@example.com" } },
  ]);
  let applied = null;
  render([], (next) => { applied = next; });
  await flush();
  await act(async () => { byTestId("guest-merge-confirm").click(); });
  expect(applied).toHaveLength(2);
  expect(applied.map((l) => l.gift.recipient_email).sort())
    .toEqual(["nan@example.com", "sam@example.com"]);
});

test("stock is revalidated against the account cart, not the guest quantity alone", async () => {
  // One left, and the authenticated cart already holds it.
  writeGuestCart([{ kind: "product", ref_id: "p2", quantity: 1 }]);
  render([{ kind: "product", ref_id: "p2", quantity: 1 }]);
  await flush();
  expect(byTestId("guest-merge-line-rejected")).toBeTruthy();
  expect(byTestId("guest-merge-confirm").disabled).toBe(true);
});

test("an item that went away while they were browsing says so", async () => {
  writeGuestCart([{ kind: "product", ref_id: "gone", quantity: 1 }]);
  render();
  await flush();
  expect(text()).toContain("No longer available");
});

test("a quantity already partly in the cart is topped up, not doubled", async () => {
  writeGuestCart([{ kind: "product", ref_id: "p1", quantity: 3 }]);
  let applied = null;
  render([{ kind: "product", ref_id: "p1", quantity: 2 }], (next) => { applied = next; });
  await flush();
  await act(async () => { byTestId("guest-merge-confirm").click(); });
  expect(applied).toEqual([{ kind: "product", ref_id: "p1", quantity: 5 }]);
});

test("dismissing leaves the guest cart where it was, so it can come back", async () => {
  const lines = [{ kind: "product", ref_id: "p1", quantity: 1 }];
  writeGuestCart(lines);
  let dismissed = false;
  api.get.mockResolvedValue({ data: { items: CATALOG } });
  mount(<GuestCartMergeReview authCart={[]} onApply={() => {}}
                              onDismiss={() => { dismissed = true; }} />);
  await flush();
  await act(async () => { byTestId("guest-merge-dismiss").click(); });
  expect(dismissed).toBe(true);
  expect(readGuestCart()).toEqual(lines);
});

test("confirming clears the guest cart, so it cannot reappear later", async () => {
  writeGuestCart([{ kind: "product", ref_id: "p1", quantity: 1 }]);
  render();
  await flush();
  await act(async () => { byTestId("guest-merge-confirm").click(); });
  expect(readGuestCart()).toEqual([]);
});

test("with nothing in the guest cart, nothing is shown at all", async () => {
  mount(<GuestCartMergeReview authCart={[]} onApply={() => {}} onDismiss={() => {}} />);
  await flush();
  expect(byTestId("guest-cart-merge-review")).toBeNull();
  expect(api.get).not.toHaveBeenCalled();
});
