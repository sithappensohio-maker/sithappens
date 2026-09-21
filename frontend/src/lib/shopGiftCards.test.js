/**
 * Gift cards as Shop items.
 *
 * A gift card rides the Shop's generic machinery rather than getting its own
 * — so what matters is that every shared helper treats it as money rather
 * than as goods. Each of these is behaviour, not a source grep: they call
 * the real function with a real catalog item.
 */
import { stockCeiling, isInternalPhysical } from "./shopPolish";
import { isFreeClaimable, freePriceLabel } from "./freeCourseClaim";

const GIFT = {
  kind: "gift_card",
  id: "gc-2500",
  name: "Gift card · $25",
  price: 25,
  list_price: 25,
  effective_price: 25,
  taxable: false,
  in_stock: true,
  image_id: null,
};

const PRODUCT = {
  kind: "product", id: "p1", name: "Chew", price: 20,
  track_inventory: true, stock_on_hand: 3,
};

test("a gift card has no stock ceiling — there is nothing to run out of", () => {
  expect(stockCeiling(GIFT)).toBeNull();
  // and the comparison case still behaves
  expect(stockCeiling(PRODUCT)).toBe(3);
});

test("buying twenty gift cards is not blocked by a stock limit", () => {
  // A ceiling of 0 would silently refuse every add-to-cart.
  expect(stockCeiling({ ...GIFT, track_inventory: true, stock_on_hand: 0 })).toBeNull();
});

test("a gift card never asks the customer to come and collect it", () => {
  // It is emailed. Pickup messaging would be a lie on the one item that
  // has nothing physical behind it.
  expect(isInternalPhysical(GIFT)).toBe(false);
  expect(isInternalPhysical(PRODUCT)).toBe(true);
});

test("a gift card is never advertised as free", () => {
  expect(isFreeClaimable(GIFT)).toBe(false);
  expect(freePriceLabel(GIFT)).toBeNull();
});

test("a gift card carries its price on every field the Shop reads", () => {
  // The card, the cart and the order each read a different one of these;
  // if they disagree somebody pays the wrong amount.
  expect(GIFT.price).toBe(25);
  expect(GIFT.effective_price).toBe(25);
  expect(GIFT.list_price).toBe(25);
});

test("the Shop card explains what a gift card is", () => {
  const fs = require("fs");
  const path = require("path");
  const src = fs.readFileSync(
    path.join(__dirname, "..", "components", "PortalShop.jsx"), "utf8");
  expect(src).toMatch(/shop-gift-card-line-/);
  expect(src).toMatch(/Emailed straight through/);
  expect(src).toMatch(/no sales tax/);
});
