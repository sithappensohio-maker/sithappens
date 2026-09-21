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
jest.mock("../lib/printGiftCard", () => ({
  printGiftCard: jest.fn(() => true),
  printGiftCardSheet: jest.fn(() => true),
  PER_SHEET: 8,
}));

const { api } = require("../lib/api");
const { toast } = require("sonner");
const { printGiftCard, printGiftCardSheet } = require("../lib/printGiftCard");

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
  printGiftCardSheet.mockClear();
  printGiftCardSheet.mockReturnValue(true);
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


// ─────────────────────────────────────────────── making a rack of blanks

test("you can make blank cards to sell, and it says they are not income", async () => {
  await mount();
  await click("gift-rack-toggle");
  const form = q("gift-rack-form");
  expect(form).toBeTruthy();
  expect(form.textContent).toMatch(/worth\s+nothing/i);
  expect(form.textContent).toMatch(/its own code/i);
});

test("making a rack asks the backend for that many blanks", async () => {
  api.post.mockResolvedValue({ data: { ok: true, count: 25, cards: [] } });
  await mount();
  await click("gift-rack-toggle");
  await type("gift-rack-qty", "25");
  await click("gift-rack-go");
  expect(api.post).toHaveBeenCalledWith("/gift-cards/stock",
    { quantity: 25, face_value: null });
});

test("a silly quantity is refused before it reaches the backend", async () => {
  await mount();
  await click("gift-rack-toggle");
  await type("gift-rack-qty", "500");
  await click("gift-rack-go");
  expect(api.post).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalled();
});

test("the new blanks can be printed as a sheet", async () => {
  const cards = [
    { id: "s1", code_display: "AAAA-1111-2222", status: "stock", balance: 0 },
    { id: "s2", code_display: "BBBB-3333-4444", status: "stock", balance: 0 },
  ];
  api.post.mockResolvedValue({ data: { ok: true, count: 2, cards } });
  await mount();
  await click("gift-rack-toggle");
  await type("gift-rack-qty", "2");
  await click("gift-rack-go");
  expect(q("gift-rack-made")).toBeTruthy();
  await click("gift-rack-print");
  expect(printGiftCardSheet).toHaveBeenCalledWith(cards);
});

test("a blocked pop-up on the sheet tells the operator", async () => {
  printGiftCardSheet.mockReturnValue(false);
  api.post.mockResolvedValue({ data: { ok: true, count: 1, cards: [{ id: "s1", code_display: "A" }] } });
  await mount();
  await click("gift-rack-toggle");
  await click("gift-rack-go");
  await click("gift-rack-print");
  expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/pop-ups/i));
});

test("a card on the rack shows no balance, because it has none yet", async () => {
  // "$0.00" next to a brand new card reads like a bug or an empty card.
  api.get.mockImplementation((url) =>
    String(url).includes("/lookup/")
      ? Promise.resolve({ data: DETAIL })
      : Promise.resolve({ data: { outstanding_balance: 0, outstanding_count: 0, stock_count: 1,
          cards: [{ id: "s1", code_display: "AAAA-1111-2222", balance: 0, initial_amount: 0,
                    spent: 0, status: "stock", origin: "stock", issued_at: "2026-09-20T10:00:00Z" }] } }));
  await mount();
  const row = q("gift-row-s1");
  expect(row.textContent).toContain("On the rack");
  expect(row.textContent).not.toContain("$0.00");
});

test("blanks are not counted in what you owe", async () => {
  // A rack of cards is not a rack of promises until somebody pays.
  api.get.mockImplementation((url) =>
    String(url).includes("/lookup/")
      ? Promise.resolve({ data: DETAIL })
      : Promise.resolve({ data: { outstanding_balance: 0, outstanding_count: 0, stock_count: 40,
                                  cards: [] } }));
  await mount();
  expect(q("gift-outstanding").textContent).toContain("$0.00");
});


// ────────────────────────────────── fixed-amount stacks, and rack display

test("a stack can have an amount printed on it", async () => {
  api.post.mockResolvedValue({ data: { ok: true, count: 10, cards: [] } });
  await mount();
  await click("gift-rack-toggle");
  await type("gift-rack-qty", "10");
  await type("gift-rack-value", "25");
  await click("gift-rack-go");
  expect(api.post).toHaveBeenCalledWith("/gift-cards/stock",
    { quantity: 10, face_value: 25 });
});

test("the form says what each choice means before you commit", async () => {
  await mount();
  await click("gift-rack-toggle");
  expect(q("gift-rack-form").textContent).toMatch(/Blanks — sell each one for whatever/i);
  await type("gift-rack-value", "50");
  expect(q("gift-rack-form").textContent).toMatch(/only sell these for \$50/i);
});

test("a nonsense printed amount is refused before the backend sees it", async () => {
  await mount();
  await click("gift-rack-toggle");
  await type("gift-rack-value", "-5");
  await click("gift-rack-go");
  expect(api.post).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalled();
});

const rackList = (card) => {
  api.get.mockImplementation((url) =>
    String(url).includes("/lookup/")
      ? Promise.resolve({ data: { ...card, history: [] } })
      : Promise.resolve({ data: { outstanding_balance: 0, outstanding_count: 0,
                                  stock_count: 1, cards: [card] } }));
};

test("a $25 card on the rack shows its printed value, not a balance", async () => {
  rackList({ id: "s1", code_display: "AAAA-1111-2222", balance: 0, initial_amount: 0,
             spent: 0, status: "stock", origin: "stock", face_value: 25,
             issued_at: "2026-09-20T10:00:00Z" });
  await mount();
  const row = q("gift-row-s1");
  expect(row.textContent).toContain("$25.00 card");
  expect(row.textContent).toContain("On the rack");
});

test("looking up a rack card does not claim it is worth $0.00", async () => {
  // It reported "$0.00" in 32px and "$0.00 issued · $0.00 spent", which
  // reads as an empty card rather than one nobody has bought.
  rackList({ id: "s1", code_display: "AAAA-1111-2222", balance: 0, initial_amount: 0,
             spent: 0, status: "stock", origin: "stock", face_value: 25,
             issued_at: "2026-09-20T10:00:00Z" });
  await mount();
  await type("gift-lookup-code", "AAAA-1111-2222");
  await click("gift-lookup-go");
  const panel = q("gift-found");
  expect(panel.textContent).not.toContain("$0.00");
  expect(panel.textContent).toMatch(/not sold yet/i);
});

test("a blank says it sells for any amount", async () => {
  rackList({ id: "s1", code_display: "AAAA-1111-2222", balance: 0, initial_amount: 0,
             spent: 0, status: "stock", origin: "stock", face_value: null,
             issued_at: "2026-09-20T10:00:00Z" });
  await mount();
  await type("gift-lookup-code", "AAAA-1111-2222");
  await click("gift-lookup-go");
  expect(q("gift-found").textContent).toMatch(/sells for any amount/i);
});

test("a rack card is not offered an Add to balance it cannot have", async () => {
  // The backend refuses it on purpose: money reaches a card through a sale.
  rackList({ id: "s1", code_display: "AAAA-1111-2222", balance: 0, initial_amount: 0,
             spent: 0, status: "stock", origin: "stock",
             issued_at: "2026-09-20T10:00:00Z" });
  await mount();
  await type("gift-lookup-code", "AAAA-1111-2222");
  await click("gift-lookup-go");
  expect(q("gift-found")).toBeTruthy();
  expect(q("gift-add")).toBeFalsy();
  expect(q("gift-print")).toBeTruthy();   // printing one is still fine
});

test("a sold card keeps its Add to balance", async () => {
  await mount();
  await type("gift-lookup-code", "ABCD-EFGH-JKMN");
  await click("gift-lookup-go");
  expect(q("gift-add")).toBeTruthy();
});


// ───────────────────────────── picking which cards to print, and editing

test("nothing to print until you tick something", async () => {
  await mount();
  expect(q("gift-print-picked")).toBeFalsy();
});

test("ticking cards offers to print exactly those", async () => {
  // Reprinting one card from last month is the case that matters, because
  // that is when a card has gone missing.
  await mount();
  await click("gift-pick-gc-1");
  expect(q("gift-print-picked").textContent).toMatch(/Print 1/);
  await click("gift-pick-gc-2");
  expect(q("gift-print-picked").textContent).toMatch(/Print 2/);
  await click("gift-print-picked");
  expect(printGiftCardSheet).toHaveBeenCalledWith(
    expect.arrayContaining([expect.objectContaining({ id: "gc-1" }),
                            expect.objectContaining({ id: "gc-2" })]));
  expect(printGiftCardSheet.mock.calls[0][0]).toHaveLength(2);
});

test("unticking a card takes it back out of the print", async () => {
  await mount();
  await click("gift-pick-gc-1");
  await click("gift-pick-gc-2");
  await click("gift-pick-gc-1");
  await click("gift-print-picked");
  expect(printGiftCardSheet.mock.calls[0][0]).toHaveLength(1);
  expect(printGiftCardSheet.mock.calls[0][0][0].id).toBe("gc-2");
});

test("a blocked pop-up on a picked print is reported", async () => {
  printGiftCardSheet.mockReturnValue(false);
  await mount();
  await click("gift-pick-gc-1");
  await click("gift-print-picked");
  expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/pop-ups/i));
});

test("a card's recipient and note can be fixed after the fact", async () => {
  await mount();
  await type("gift-lookup-code", "ABCD-EFGH-JKMN");
  await click("gift-lookup-go");
  await click("gift-edit");
  expect(q("gift-edit-form").textContent).toMatch(/No money moves here/i);
  await type("gift-edit-name", "Dana Marie");
  await type("gift-edit-note", "Birthday");
  await click("gift-edit-save");
  expect(api.post).toHaveBeenCalledWith(
    "/gift-cards/ABCD-EFGH-JKMN/details",
    { recipient_name: "Dana Marie", note: "Birthday" });
});

test("the edit form opens with what the card already says", async () => {
  await mount();
  await type("gift-lookup-code", "ABCD-EFGH-JKMN");
  await click("gift-lookup-go");
  await click("gift-edit");
  expect(q("gift-edit-name").value).toBe("Dana");
});

test("cancelling an edit changes nothing", async () => {
  await mount();
  await type("gift-lookup-code", "ABCD-EFGH-JKMN");
  await click("gift-lookup-go");
  await click("gift-edit");
  await type("gift-edit-name", "Wrong");
  await click("gift-edit-cancel");
  expect(q("gift-edit-form")).toBeFalsy();
  expect(api.post).not.toHaveBeenCalled();
});

test("a failed edit says so instead of looking saved", async () => {
  api.post.mockRejectedValue({ response: { data: { detail: "That gift card was voided." } } });
  await mount();
  await type("gift-lookup-code", "ABCD-EFGH-JKMN");
  await click("gift-lookup-go");
  await click("gift-edit");
  await type("gift-edit-name", "Dana");
  await click("gift-edit-save");
  expect(toast.error).toHaveBeenCalled();
  expect(q("gift-edit-form")).toBeTruthy();   // still open, so it can be retried
});


test("a ticked card that filters out of view does not print an empty sheet", async () => {
  // Tick a card, then narrow the filter so it is no longer listed. The
  // button is still showing (something is ticked) but there is nothing left
  // to print, and silently opening a blank page would look like a failure.
  await mount();
  await click("gift-pick-gc-1");
  api.get.mockImplementation((url) =>
    String(url).includes("/lookup/")
      ? Promise.resolve({ data: DETAIL })
      : Promise.resolve({ data: { outstanding_balance: 0, outstanding_count: 0,
                                  stock_count: 0, cards: [] } }));
  const sel = q("gift-filter");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
  await act(async () => {
    setter.call(sel, "voided");
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await click("gift-print-picked");
  expect(printGiftCardSheet).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/tick the cards/i));
});
