/**
 * The Gift Cards screen, mounted and driven.
 *
 * Two things this screen exists to get right. The first is the number at the
 * top: what you still owe the people holding cards, which is a real liability
 * and the figure an accountant asks for. The second is that issuing a card by
 * hand is NOT a sale — no money came in, so it must never look like income,
 * and the screen has to say so where the decision is made.
 *
 * Mounted rather than read as text, because a screen that compiles is not a
 * screen that works.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import GiftCards from "./GiftCards";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn() },
  formatErr: (e) => String(e?.response?.data?.detail || e || ""),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../components/PageHero", () => ({ __esModule: true, default: () => null }));
jest.mock("../lib/printGiftCard", () => ({ printGiftCard: jest.fn(() => true) }));

const { api } = require("../lib/api");
const { toast } = require("sonner");
const { printGiftCard } = require("../lib/printGiftCard");

global.IS_REACT_ACT_ENVIRONMENT = true;

const CARDS = {
  outstanding_balance: 265.50,
  outstanding_count: 3,
  cards: [
    { id: "gc-1", code_display: "ABCD-EFGH-JKMN", balance: 100.00, initial_amount: 100.00,
      spent: 0, status: "active", recipient_name: "Dana", issued_at: "2026-09-18T10:00:00Z",
      issued_by_name: "Owner" },
    { id: "gc-2", code_display: "PQRS-TUVW-XYZ2", balance: 0, initial_amount: 50.00,
      spent: 50.00, status: "spent", recipient_name: "", issued_at: "2026-09-10T10:00:00Z",
      issued_by_name: "Owner" },
  ],
};
const DETAIL = {
  ...CARDS.cards[0],
  history: [
    { id: "t1", kind: "issue", amount: 100, balance_after: 100, note: "", created_at: "2026-09-18T10:00:00Z" },
    { id: "t2", kind: "redeem", amount: 20, balance_after: 80, note: "Register sale", created_at: "2026-09-19T10:00:00Z" },
  ],
};

let container, root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset();
  api.get.mockImplementation((url) =>
    String(url).includes("/lookup/")
      ? Promise.resolve({ data: DETAIL })
      : Promise.resolve({ data: CARDS }));
  api.post.mockReset();
  api.post.mockResolvedValue({ data: { ok: true, code: "WXYZ-2345-6789" } });
  toast.error.mockReset();
  printGiftCard.mockClear();
  printGiftCard.mockReturnValue(true);
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  container.remove();
});

const mount = async () => {
  await act(async () => { root = createRoot(container); root.render(<GiftCards />); });
};
const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const all = (id) => [...container.querySelectorAll(`[data-testid="${id}"]`)];
const click = async (id) => {
  const el = q(id);
  if (!el) throw new Error(`no [data-testid="${id}"]`);
  await act(async () => { el.click(); });
};
const type = async (id, value) => {
  const el = q(id);
  if (!el) throw new Error(`no [data-testid="${id}"]`);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  await act(async () => {
    setter.call(el, String(value));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

test("it mounts and lists the cards", async () => {
  await mount();
  expect(q("gift-cards-screen")).toBeTruthy();
  expect(q("gift-row-gc-1")).toBeTruthy();
  expect(container.textContent).toContain("ABCD-EFGH-JKMN");
});

test("what you owe card holders is the headline number", async () => {
  await mount();
  const tile = q("gift-outstanding");
  expect(tile.textContent).toContain("$265.50");
  expect(tile.textContent).toMatch(/3 cards still in circulation/);
});

test("a card can be looked up and shows its history", async () => {
  await mount();
  await type("gift-lookup-code", "ABCD-EFGH-JKMN");
  await click("gift-lookup-go");
  expect(q("gift-found")).toBeTruthy();
  expect(all("gift-history-row")).toHaveLength(2);
  expect(q("gift-found").textContent).toContain("$100.00");
});

test("a code that is not a card says so instead of showing nothing", async () => {
  api.get.mockImplementation((url) =>
    String(url).includes("/lookup/")
      ? Promise.reject({ response: { data: { detail: "No gift card with that code." } } })
      : Promise.resolve({ data: CARDS }));
  await mount();
  await type("gift-lookup-code", "NOPE");
  await click("gift-lookup-go");
  expect(q("gift-found")).toBeFalsy();
  expect(toast.error).toHaveBeenCalled();
});

test("issuing by hand says plainly that it is not income", async () => {
  // The whole risk of this button is somebody thinking they just made a sale.
  await mount();
  await click("gift-issue-toggle");
  expect(q("gift-issue-form").textContent).toMatch(/no income/i);
  expect(q("gift-issue-form").textContent).toMatch(/Register/);
});

test("issuing needs an amount and a reason", async () => {
  await mount();
  await click("gift-issue-toggle");
  await click("gift-issue-go");
  expect(api.post).not.toHaveBeenCalled();
  await type("gift-issue-amount", "25");
  await click("gift-issue-go");
  expect(api.post).not.toHaveBeenCalled();   // still no reason
  await type("gift-issue-reason", "Make-good for a bad groom");
  await click("gift-issue-go");
  expect(api.post).toHaveBeenCalledWith("/gift-cards/issue", expect.objectContaining({
    amount: 25, reason: "Make-good for a bad groom",
  }));
});

test("the new code is shown once, big, so it can be written on the card", async () => {
  // It is the only moment a human can read it. If this is missed, the card
  // is worthless plastic and the balance is stranded.
  await mount();
  await click("gift-issue-toggle");
  await type("gift-issue-amount", "25");
  await type("gift-issue-reason", "Make-good");
  await click("gift-issue-go");
  const shown = q("gift-issued");
  expect(shown).toBeTruthy();
  expect(shown.textContent).toContain("WXYZ-2345-6789");
  expect(shown.textContent).toMatch(/Write this on the card/i);
  await click("gift-issued-done");
  expect(q("gift-issued")).toBeFalsy();
});

test("an empty shelf explains where cards come from", async () => {
  api.get.mockImplementation(() =>
    Promise.resolve({ data: { cards: [], outstanding_balance: 0, outstanding_count: 0 } }));
  await mount();
  expect(q("gift-empty").textContent).toMatch(/Register/);
});


// ---------------------------------------------- the four-registry trap
// Photo Specials shipped invisible because a tab was defined, routed and
// rendering, and still had no sidebar link. Four registries, not three.

test("the Gift Cards tab is registered in all FOUR places", () => {
  const fs = require("fs");
  const path = require("path");
  const appSrc = fs.readFileSync(path.join(__dirname, "..", "App.js"), "utf8");
  const routesSrc = fs.readFileSync(path.join(__dirname, "..", "lib", "adminRoutes.js"), "utf8");

  expect(appSrc).toMatch(/\{ id: "gift_cards", label: "Gift Cards", icon: "fa-[a-z-]+", perm: "finance_reports" \}/);
  expect(appSrc).toMatch(/tab === "gift_cards" && navAllowed\("gift_cards"\) && <GiftCards \/>/);
  expect(routesSrc).toMatch(/gift_cards: "\/admin\/gift-cards"/);
  expect(routesSrc).toMatch(/"gift-cards": "gift_cards"/);

  const groups = appSrc.slice(appSrc.indexOf("const NAV_GROUPS = ["),
                              appSrc.indexOf("];", appSrc.indexOf("const NAV_GROUPS = [")));
  expect(groups).toContain('"gift_cards"');
});

test("it lives under Money, where an owner would look for it", () => {
  const fs = require("fs");
  const path = require("path");
  const appSrc = fs.readFileSync(path.join(__dirname, "..", "App.js"), "utf8");
  const money = appSrc.slice(appSrc.indexOf('{ label: "Money"'));
  expect(money.slice(0, money.indexOf("]"))).toContain('"gift_cards"');
});


// ------------------------------------------------------------- printing

test("a freshly issued card can be printed on the spot", async () => {
  await mount();
  await click("gift-issue-toggle");
  await type("gift-issue-amount", "25");
  await type("gift-issue-reason", "Make-good");
  await click("gift-issue-go");
  await click("gift-issued-print");
  expect(printGiftCard).toHaveBeenCalledWith(
    expect.objectContaining({ code_display: "WXYZ-2345-6789", balance: 25 }));
});

test("a looked-up card can be reprinted", async () => {
  await mount();
  await type("gift-lookup-code", "ABCD-EFGH-JKMN");
  await click("gift-lookup-go");
  await click("gift-print");
  expect(printGiftCard).toHaveBeenCalledWith(
    expect.objectContaining({ code_display: "ABCD-EFGH-JKMN" }));
});

test("a blocked pop-up tells the operator instead of doing nothing", async () => {
  printGiftCard.mockReturnValue(false);
  await mount();
  await type("gift-lookup-code", "ABCD-EFGH-JKMN");
  await click("gift-lookup-go");
  await click("gift-print");
  expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/pop-ups/i));
});
