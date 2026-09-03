/**
 * @jest-environment jsdom
 */
// lib/schoolViewport — the one place School moves the customer's screen.
// jsdom does no layout, so geometry is stubbed; what is under test is the
// position math, the "if needed" rule, cancellation, and the settle poll.
import { computeRevealTop, revealInSchool, resetSchoolScroll, focusDialogTitle } from "./schoolViewport";

function rect(top, height) { return { top, bottom: top + height, height, left: 0, right: 390, width: 390 }; }

function makeRoot({ top = 75, clientHeight = 769, scrollHeight = 4000, scrollTop = 0 } = {}) {
  const root = document.createElement("div");
  root.setAttribute("data-scroll-root", "");
  Object.defineProperty(root, "clientHeight", { value: clientHeight, configurable: true });
  Object.defineProperty(root, "scrollHeight", { value: scrollHeight, configurable: true });
  root.scrollTop = scrollTop;
  root.getBoundingClientRect = () => rect(top, clientHeight);
  root.scrollTo = jest.fn((o) => { root.scrollTop = typeof o === "object" ? o.top : o; });
  return root;
}

function el(top, height) {
  const e = document.createElement("div");
  e.getBoundingClientRect = () => rect(top, height);
  return e;
}

beforeEach(() => {
  document.body.innerHTML = "";
  Object.defineProperty(window, "innerHeight", { value: 844, configurable: true });
});

test("start alignment puts the target's top just under the header", () => {
  const root = makeRoot({ scrollTop: 100 });
  const target = el(2000, 300);
  expect(computeRevealTop({ root, target, align: "start", offset: 8 })).toBe(100 + (2000 - 75) - 8);
});

test("start alignment clamps to the page's scroll range", () => {
  const root = makeRoot({ scrollTop: 0, scrollHeight: 1000, clientHeight: 769 });
  expect(computeRevealTop({ root, target: el(3000, 100), align: "start", offset: 8 })).toBe(231);
  expect(computeRevealTop({ root, target: el(-500, 100), align: "start", offset: 8 })).toBe(0);
});

test("ifNeeded skips the scroll when the target already sits in the usable window", () => {
  const root = makeRoot();
  expect(computeRevealTop({ root, target: el(200, 300), align: "start", offset: 8, ifNeeded: true })).toBeNull();
  expect(computeRevealTop({ root, target: el(900, 300), align: "start", offset: 8, ifNeeded: true })).not.toBeNull();
});

test("action alignment prefers the card's top when the whole card fits", () => {
  const root = makeRoot({ scrollTop: 500 });
  const card = el(1500, 400);
  const cta = el(1800, 56);
  expect(computeRevealTop({ root, target: card, cta, align: "action", offset: 8 })).toBe(500 + (1500 - 75) - 8);
});

test("action alignment keeps the button on screen when the card is taller than the window", () => {
  const root = makeRoot({ scrollTop: 500, clientHeight: 426 });
  const card = el(1500, 900);
  const cta = el(2300, 56);
  // cta bottom lands at the bottom of the usable window minus the offset
  const winHeight = 426; // no bottom nav in this DOM
  expect(computeRevealTop({ root, target: card, cta, align: "action", offset: 8 }))
    .toBe(500 + (2356 - 75) - (winHeight - 8));
});

test("the usable window stops above the phone tab bar", () => {
  const shell = document.createElement("div");
  shell.setAttribute("data-testid", "school-app");
  const header = document.createElement("header");
  header.getBoundingClientRect = () => rect(0, 75);
  shell.appendChild(header);
  const nav = document.createElement("nav");
  nav.setAttribute("data-testid", "school-nav-mobile");
  nav.getBoundingClientRect = () => rect(777, 67);
  document.body.appendChild(shell);
  document.body.appendChild(nav);
  const root = makeRoot({ scrollTop: 0, clientHeight: 769 });
  const card = el(300, 900);
  const cta = el(1100, 56);
  // window height = (844 - 67) - 75 = 702; cta bottom 1156 → 1156-75-(702-8)
  expect(computeRevealTop({ root, target: card, cta, align: "action", offset: 8 })).toBe(1156 - 75 - 694);
});

test("resetSchoolScroll returns the container to the top", () => {
  const root = makeRoot({ scrollTop: 1243 });
  document.body.appendChild(root);
  expect(resetSchoolScroll()).toBe(true);
  expect(root.scrollTop).toBe(0);
});

test("revealInSchool waits for the target to exist and settle, then scrolls once", async () => {
  const root = makeRoot({ scrollTop: 0 });
  document.body.appendChild(root);
  const target = el(2000, 300);
  target.setAttribute("data-testid", "late");
  const p = revealInSchool('[data-testid="late"]', { pollMs: 5, budgetMs: 500 });
  setTimeout(() => root.appendChild(target), 20);
  const result = await p;
  expect(result).toEqual({ top: 2000 - 75 - 8 });
  expect(root.scrollTo).toHaveBeenCalledTimes(1);
});

test("a newer reveal cancels the one still pending — only one reveal owns a transition", async () => {
  const root = makeRoot({ scrollTop: 0 });
  document.body.appendChild(root);
  const a = el(1000, 100); a.setAttribute("data-testid", "a"); root.appendChild(a);
  const b = el(2000, 100); b.setAttribute("data-testid", "b"); root.appendChild(b);
  const first = revealInSchool('[data-testid="a"]', { pollMs: 5 });
  const second = revealInSchool('[data-testid="b"]', { pollMs: 5 });
  expect(await first).toBeNull();
  expect(await second).toEqual({ top: 2000 - 75 - 8 });
  expect(root.scrollTo).toHaveBeenCalledTimes(1);
});

test("revealInSchool gives up quietly when the target never appears", async () => {
  document.body.appendChild(makeRoot());
  expect(await revealInSchool('[data-testid="never"]', { pollMs: 5, budgetMs: 40 })).toBeNull();
});

test("reduced motion scrolls instantly", async () => {
  window.matchMedia = jest.fn(() => ({ matches: true }));
  const root = makeRoot();
  document.body.appendChild(root);
  const t = el(1500, 100); t.setAttribute("data-testid", "t"); root.appendChild(t);
  await revealInSchool('[data-testid="t"]', { pollMs: 5 });
  expect(root.scrollTo).toHaveBeenCalledWith({ top: 1500 - 75 - 8, behavior: "auto" });
});

test("focusDialogTitle focuses without scrolling", () => {
  const h = document.createElement("h1");
  h.tabIndex = -1;
  h.focus = jest.fn();
  focusDialogTitle(h);
  expect(h.focus).toHaveBeenCalledWith({ preventScroll: true });
});
