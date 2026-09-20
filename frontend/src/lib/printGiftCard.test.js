/* The printable gift card.
 *
 * This is the artefact the customer walks out with, so it has to carry the
 * code legibly, say what the card can be spent on, and not promise anything
 * that is not true. It prints on ordinary paper — a curling till receipt is
 * a poor thing to give as a gift. */
import { giftCardHtml, giftCardSheetHtml, printGiftCard, printGiftCardSheet,
         PER_SHEET } from "./printGiftCard";

const CARD = { code_display: "ABCD-EFGH-JKMN", balance: 75, recipient_name: "Dana",
               issued_at: "2026-09-20T10:00:00Z" };

test("the code is on it, and legible", () => {
  const html = giftCardHtml(CARD);
  expect(html).toContain("ABCD-EFGH-JKMN");
  // monospace so 8 and B cannot be confused, and big enough on a small card
  expect(html).toMatch(/\.code \{[^}]*Courier New/);
  expect(html).toMatch(/\.code \{[^}]*font-size:12\.5pt/);
});

test("it is a real gift-card rectangle, not a sheet of paper", () => {
  // CR80 — the same size as a bank card, so it fits a wallet and a sleeve.
  const html = giftCardHtml(CARD);
  expect(html).toMatch(/width:85\.6mm/);
  expect(html).toMatch(/height:53\.98mm/);
});

test("the background colours actually print", () => {
  // Browsers drop background colours in print unless told not to. Without
  // this the card comes out as white paper with lime text on it.
  const html = giftCardHtml(CARD);
  expect(html).toMatch(/print-color-adjust: exact/);
  expect(html).toMatch(/-webkit-print-color-adjust: exact/);
});

test("it is printed in the brand's colours", () => {
  const html = giftCardHtml(CARD, { colors: { green: "#8cc63f", navy: "#060c2e",
                                              header: "#03061a", panel: "#0c143e" } });
  expect(html).toContain("#8cc63f");
  expect(html).toContain("#060c2e");
});

test("a recoloured theme recolours the card", () => {
  // Brand & Theme can repaint the app at runtime; the printed card follows
  // rather than freezing whatever the palette was the day this was written.
  const html = giftCardHtml(CARD, { colors: { green: "#ff00aa", navy: "#111111",
                                              header: "#000000", panel: "#222222" } });
  expect(html).toContain("#ff00aa");
  expect(html).not.toContain("#8cc63f");
});

test("both a front and a back are printed", () => {
  const html = giftCardHtml(CARD);
  expect((html.match(/class="card/g) || []).length).toBe(2);
  expect(html).toMatch(/How to use it/i);
  expect(html).toMatch(/Cut along the edges/i);
});

test("the amount and who it is for are on the front", () => {
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
  // The card legitimately contains one <img> now (the husky), so the old
  // "no <img> anywhere" check would pass for the wrong reason. Pin the two
  // things that actually matter: the code is escaped, and nothing executes.
  const html = giftCardHtml({ code_display: '<img src=x onerror="alert(1)">', balance: 10 });
  expect(html).toContain("&lt;img");
  expect(html).not.toContain('onerror="alert');
  expect(html).not.toContain("<img src=x");
});

test("a hostile logo url cannot break out of the src attribute", () => {
  const html = giftCardHtml(CARD, { logo: 'x" onerror="alert(1)' });
  expect(html).not.toContain('onerror="alert');
  expect(html).toContain("&quot; onerror=&quot;");
});


// ------------------------------------------------------------ the husky

test("the husky is on the front", () => {
  const html = giftCardHtml(CARD, { logo: "/logo.png" });
  expect(html).toContain('<div class="husky"><img src="/logo.png"');
});

test("he is cropped out of the one logo the app already has", () => {
  // Deliberately NOT a second cropped copy of the mascot: one logo.png, so
  // replacing it replaces him here too.
  const html = giftCardHtml(CARD);
  expect(html).toContain("/logo.png");
  expect(html).toMatch(/\.husky \{[^}]*overflow:hidden/);
});

test("he sits behind the amount rather than competing with it", () => {
  const html = giftCardHtml(CARD);
  const op = html.match(/\.husky \{[^}]*opacity:([\d.]+)/);
  expect(op).toBeTruthy();
  expect(Number(op[1])).toBeLessThan(0.6);
});

test("a card can be printed without him", () => {
  // No artwork is better than a broken-image box if logo.png ever moves.
  const html = giftCardHtml(CARD, { logo: null });
  expect(html).not.toContain('class="husky"');
  expect(html).toContain("$75.00");
});

test("printing waits for the artwork instead of racing it", () => {
  // A fixed delay prints a hole in the card whenever the image is slow.
  const html = giftCardHtml(CARD);
  expect(html).toMatch(/document\.images/);
  expect(html).toMatch(/i\.onload = i\.onerror = r/);
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


// ───────────────────────────────────────────── blanks, and sheets of them

const BLANK = { code_display: "QRST-UVWX-YZ23", balance: 0, status: "stock", origin: "stock" };

test("a blank prints its code where the amount would go, not $0.00", () => {
  // "$0.00" in 31pt lime on a card somebody is about to buy is a lie in the
  // most alarming place on it.
  const html = giftCardHtml(BLANK);
  expect(html).not.toContain("$0.00");
  expect(html).toContain("QRST-UVWX-YZ23");
  expect(html).toMatch(/class="frontcode"/);
});

test("a blank does not print a recipient line it cannot know", () => {
  const html = giftCardHtml({ ...BLANK, recipient_name: "Dana" });
  expect(html).not.toContain("for Dana");
});

test("a sold card still prints its amount", () => {
  const html = giftCardHtml(CARD);
  expect(html).toContain("$75.00");
  expect(html).not.toMatch(/class="frontcode"/);
});

test("a sheet prints every card, each with its own code", () => {
  // The whole point of a rack: 25 cards is 25 balances, not 25 copies.
  const cards = ["AAAA-1111-2222", "BBBB-3333-4444", "CCCC-5555-6666"]
    .map((code_display) => ({ code_display, status: "stock", balance: 0 }));
  const html = giftCardSheetHtml(cards);
  for (const c of cards) expect(html).toContain(c.code_display);
  expect((html.match(/class="card"/g) || []).length).toBe(3);
});

test("a sheet breaks pages between cards, never through one", () => {
  const cards = Array.from({ length: PER_SHEET + 1 }, (_, i) => ({
    code_display: `AAAA-BBBB-${String(1000 + i)}`, status: "stock", balance: 0 }));
  const html = giftCardSheetHtml(cards);
  expect((html.match(/class="sheet"/g) || []).length).toBe(2);
  expect(html).toMatch(/\.sheet \{[^}]*page-break-after:always/);
});

test("a sheet of 25 comes out as 25 distinct cards over 4 pages", () => {
  const cards = Array.from({ length: 25 }, (_, i) => ({
    code_display: `ZZ${String(i).padStart(2, "0")}-AAAA-BBBB`, status: "stock", balance: 0 }));
  const html = giftCardSheetHtml(cards);
  expect((html.match(/class="card"/g) || []).length).toBe(25);
  expect((html.match(/class="sheet"/g) || []).length).toBe(Math.ceil(25 / PER_SHEET));
  expect(new Set(cards.map((c) => c.code_display)).size).toBe(25);
});

test("an empty rack prints nothing rather than a blank page", () => {
  expect(giftCardSheetHtml([])).toBe("");
  expect(printGiftCardSheet([])).toBe(false);
});

test("a sheet is real card size, so the cuts line up", () => {
  const html = giftCardSheetHtml([BLANK]);
  expect(html).toMatch(/width:85\.6mm/);
  expect(html).toMatch(/height:53\.98mm/);
});

test("a sheet waits for the husky before printing", () => {
  const html = giftCardSheetHtml([BLANK]);
  expect(html).toMatch(/document\.images/);
});

test("a hostile code cannot smuggle markup onto a sheet", () => {
  const html = giftCardSheetHtml([{ code_display: '"><script>alert(1)</script>', status: "stock" }]);
  expect(html).not.toContain("<script>alert");
  expect(html).toContain("&lt;script&gt;");
});

test("a blocked pop-up on a sheet is reported, not silently nothing", () => {
  const open = jest.spyOn(window, "open").mockReturnValue(null);
  global.URL.createObjectURL = jest.fn(() => "blob:x");
  global.URL.revokeObjectURL = jest.fn();
  expect(printGiftCardSheet([BLANK])).toBe(false);
  expect(global.URL.revokeObjectURL).toHaveBeenCalled();
  open.mockRestore();
});
