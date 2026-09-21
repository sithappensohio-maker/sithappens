/**
 * Buying a gift card in the Shop, from the product page.
 *
 * The defect this covers end to end: gift cards were catalogued, priced and
 * fulfillable, and still unbuyable — the cart rejected the kind, and nothing
 * on screen collected a recipient. These tests mount the real product page
 * and check what it actually hands to the cart, because a form that renders
 * is not a form that submits.
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
const { toast } = require("sonner");

global.IS_REACT_ACT_ENVIRONMENT = true;

const GIFT = {
  kind: "gift_card", id: "gc-2500", name: "Gift card · $25",
  price: 25, effective_price: 25, list_price: 25,
  description: "Emailed straight through.", taxable: false, in_stock: true,
};

let container, root, added;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  added = [];
  api.get.mockReset();
  api.get.mockResolvedValue({ data: GIFT });
  toast.error.mockReset();
  toast.success.mockReset();
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  container.remove();
});

const mount = async (props = {}) => {
  await act(async () => {
    root = createRoot(container);
    root.render(
      <ShopItemDetail
        kind="gift_card" itemId="gc-2500" cart={[]}
        onAddToCart={(item, qty, dogId, gift) => added.push({ item, qty, dogId, gift })}
        onBack={() => {}} allItems={[GIFT]} onOpenItem={() => {}}
        mode="authenticated" dogs={[]} {...props} />);
  });
};
const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const click = async (el) => { await act(async () => { el.click(); }); };
const type = async (id, value) => {
  const el = q(id);
  if (!el) throw new Error(`no [data-testid="${id}"]`);
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, "value").set;
  await act(async () => {
    setter.call(el, String(value));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const toggleGift = async () => {
  const el = q("shop-detail-gift-toggle");
  if (!el) throw new Error("no gift toggle rendered");
  await act(async () => { el.click(); });   // a real click flips .checked
};
const addBtn = () =>
  [...container.querySelectorAll("button")].find((b) => /add to cart/i.test(b.textContent));

test("the product page offers to make it a gift", async () => {
  await mount();
  expect(q("shop-detail-gift")).toBeTruthy();
  expect(q("shop-detail-gift-toggle")).toBeTruthy();
});

test("not a gift means it comes to the buyer, and it says so", async () => {
  await mount();
  expect(q("shop-detail-gift").textContent).toMatch(/email it to you/i);
  expect(q("shop-detail-gift-email")).toBeFalsy();
  await click(addBtn());
  expect(added).toHaveLength(1);
  expect(added[0].gift).toBeUndefined();
});

test("making it a gift asks who it is for", async () => {
  await mount();
  await toggleGift();
  expect(q("shop-detail-gift-email")).toBeTruthy();
  expect(q("shop-detail-gift-name")).toBeTruthy();
  expect(q("shop-detail-gift-message")).toBeTruthy();
});

test("the recipient actually reaches the cart", async () => {
  // The whole defect in one assertion: a form that collects a recipient and
  // does not hand it over is the same as no form.
  await mount();
  await toggleGift();
  await type("shop-detail-gift-email", "dana@example.com");
  await type("shop-detail-gift-name", "Dana");
  await type("shop-detail-gift-message", "Happy birthday");
  await click(addBtn());
  expect(added).toHaveLength(1);
  expect(added[0].gift).toEqual({
    recipient_email: "dana@example.com",
    recipient_name: "Dana",
    gift_message: "Happy birthday",
  });
});

test("a gift with no address is refused before it reaches the cart", async () => {
  await mount();
  await toggleGift();
  await type("shop-detail-gift-email", "not-an-email");
  await click(addBtn());
  expect(added).toHaveLength(0);
  expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/email address/i));
});

test("a gift card can be bought more than one at a time", async () => {
  // It is merchandise-shaped: buying three $25 cards is an ordinary thing.
  await mount();
  expect(q("shop-detail-qty")).toBeTruthy();
});

test("every gift field has a real label attached to it", async () => {
  // Placeholder-only inputs are invisible to a screen reader.
  await mount();
  await toggleGift();
  for (const id of ["gift-to", "gift-name", "gift-msg"]) {
    const input = container.querySelector(`#${id}`);
    expect(input).toBeTruthy();
    expect(container.querySelector(`label[for="${id}"]`)).toBeTruthy();
  }
});


// ---------------------------------------------------------------------------
// The last hop: cart line → checkout body.
// Mounting PortalShop (1,400 lines, a dozen endpoints) to assert one payload
// is not worth it, so this pins the RULE in its source the way the Online
// School commerce guards already do. A mutation proved it was needed: the
// recipient could be dropped here and every other test still passed.
// ---------------------------------------------------------------------------

test("checkout sends the gift with its line, not just the product and quantity", () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "PortalShop.jsx"), "utf8");
  const payload = src.match(/items: cart\.map\([\s\S]{0,500}?\)\),/);
  expect(payload).toBeTruthy();
  for (const field of ["recipient_email", "recipient_name", "gift_message"]) {
    expect(payload[0]).toMatch(new RegExp(`${field}: c\.gift`));
  }
});

test("a gift card line keeps its own identity in the cart", () => {
  // Two cards of the same value for two different people must stay two
  // lines — and a quantity change on one must not move the other.
  //
  // The rule is tested directly rather than by grepping for the helper's
  // definition: it moved to lib/shopPolish so the cart, the checkout and
  // the post-sign-in merge all key a gift card the same way, and a test
  // pinned to the file it used to live in broke on the move without
  // anything actually being wrong.
  const { cartGiftKey } = require("../lib/shopPolish");
  const forNan = { recipient_email: "nan@example.com", recipient_name: "Nan", gift_message: "x" };
  const forSam = { recipient_email: "sam@example.com", recipient_name: "Sam", gift_message: "x" };
  expect(cartGiftKey(forNan)).not.toBe(cartGiftKey(forSam));
  // Same person, typed differently, is still the same person.
  expect(cartGiftKey({ ...forNan, recipient_email: " NAN@example.com " })).toBe(cartGiftKey(forNan));
  // No gift at all is its own identity, shared by every ordinary line.
  expect(cartGiftKey(null)).toBe(cartGiftKey(undefined));
  expect(cartGiftKey(null)).not.toBe(cartGiftKey(forNan));

  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(path.join(__dirname, "PortalShop.jsx"), "utf8");
  for (const fn of ["addToCart", "changeQty", "removeFromCart"]) {
    const at = src.indexOf(`const ${fn} = (`);
    expect(at).toBeGreaterThan(-1);
    expect(src.slice(at, at + 520)).toMatch(/cartGiftKey/);
  }
});
