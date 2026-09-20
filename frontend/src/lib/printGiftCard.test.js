/* The printable gift card.
 *
 * This is the artefact the customer walks out with, so it has to carry the
 * code legibly, say what the card can be spent on, and not promise anything
 * that is not true. It prints on ordinary paper — a curling till receipt is
 * a poor thing to give as a gift. */
import { giftCardHtml, printGiftCard } from "./printGiftCard";

const CARD = { code_display: "ABCD-EFGH-JKMN", balance: 75, recipient_name: "Dana",
               issued_at: "2026-09-20T10:00:00Z" };

test("the code is on it, and large", () => {
  const html = giftCardHtml(CARD);
  expect(html).toContain("ABCD-EFGH-JKMN");
  expect(html).toMatch(/\.code \{[^}]*font-size:34px/);
});

test("the amount and who it is for are on it", () => {
  const html = giftCardHtml(CARD);
  expect(html).toContain("$75.00");
  expect(html).toContain("for Dana");
});

test("a card with no recipient does not print an empty 'for'", () => {
  const html = giftCardHtml({ ...CARD, recipient_name: "" });
  expect(html).not.toMatch(/class="to"/);
});

test("it says what the card can be spent on and what it cannot do", () => {
  const html = giftCardHtml(CARD);
  expect(html).toMatch(/daycare, boarding, training, grooming/);
  expect(html).toMatch(/does not expire/i);
  expect(html).toMatch(/cannot be exchanged for cash/i);
  // honest about the one thing a shop cannot promise
  expect(html).toMatch(/cannot replace it if it is lost/i);
});

test("a code cannot smuggle markup onto the page", () => {
  const html = giftCardHtml({ code_display: '<img src=x onerror="alert(1)">', balance: 10 });
  expect(html).not.toContain("<img");
  expect(html).toContain("&lt;img");
});

test("it prints itself when opened", () => {
  expect(giftCardHtml(CARD)).toContain("window.print()");
});

test("a blocked pop-up is reported rather than silently doing nothing", () => {
  const open = jest.spyOn(window, "open").mockReturnValue(null);
  global.URL.createObjectURL = jest.fn(() => "blob:x");
  global.URL.revokeObjectURL = jest.fn();
  expect(printGiftCard(CARD)).toBe(false);
  expect(global.URL.revokeObjectURL).toHaveBeenCalled();  // no leaked object
  open.mockRestore();
});

test("a successful print reports success", () => {
  const open = jest.spyOn(window, "open").mockReturnValue({});
  global.URL.createObjectURL = jest.fn(() => "blob:x");
  global.URL.revokeObjectURL = jest.fn();
  expect(printGiftCard(CARD)).toBe(true);
  open.mockRestore();
});
