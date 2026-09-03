/**
 * @jest-environment jsdom
 */
import { watchPrimaryActionVisibility, PRIMARY_ACTION_SELECTOR, VISIBLE_RATIO } from "./primaryActionGuard";

// jsdom has no IntersectionObserver: a fake that records observed elements and
// lets the test push reports.
class FakeIO {
  static instances = [];
  constructor(cb, opts) { this.cb = cb; this.opts = opts; this.observed = new Set(); this.disconnected = false; FakeIO.instances.push(this); }
  observe(el) { this.observed.add(el); }
  unobserve(el) { this.observed.delete(el); }
  disconnect() { this.disconnected = true; this.observed.clear(); }
  report(el, ratio) { this.cb([{ target: el, isIntersecting: ratio > 0, intersectionRatio: ratio }]); }
}
const flushMutations = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => { FakeIO.instances = []; window.IntersectionObserver = FakeIO; document.body.innerHTML = ""; });
afterEach(() => { delete window.IntersectionObserver; });

function mark(attr = "data-school-primary") {
  const b = document.createElement("button"); b.setAttribute(attr, "true"); document.body.appendChild(b); return b;
}

test("the selector covers School's marker and the generic opt-in", () => {
  expect(PRIMARY_ACTION_SELECTOR).toBe("[data-school-primary], [data-primary-action]");
  expect(VISIBLE_RATIO).toBe(0.5);
});

test("a marked CTA counts as visible until reported, then follows the observer's threshold", () => {
  const cta = mark();
  const seen = [];
  const stop = watchPrimaryActionVisibility((v) => seen.push(v));
  expect(seen).toEqual([true]); // conservative on first paint: no flash over the CTA
  const io = FakeIO.instances[0];
  expect(io.opts.threshold).toEqual([VISIBLE_RATIO]);
  expect(io.observed.has(cta)).toBe(true);
  io.report(cta, 0.9);
  expect(seen).toEqual([true]);            // still visible, no duplicate emit
  io.report(cta, 0.1);
  expect(seen).toEqual([true, false]);     // scrolled mostly out → promotion may show
  io.report(cta, 0.6);
  expect(seen).toEqual([true, false, true]);
  stop();
  expect(io.disconnected).toBe(true);
});

test("CTAs that mount later are picked up, and removed ones stop counting", async () => {
  const seen = [];
  const stop = watchPrimaryActionVisibility((v) => seen.push(v));
  expect(seen).toEqual([false]);           // nothing marked → nothing to protect
  const cta = mark("data-primary-action"); // the generic opt-in
  await flushMutations();
  expect(seen).toEqual([false, true]);     // pending report counts as visible
  const io = FakeIO.instances[0];
  expect(io.observed.has(cta)).toBe(true);
  cta.remove();
  await flushMutations();
  expect(seen).toEqual([false, true, false]);
  expect(io.observed.has(cta)).toBe(false);
  stop();
});

test("without IntersectionObserver the guard fails open", () => {
  delete window.IntersectionObserver;
  mark();
  const seen = [];
  watchPrimaryActionVisibility((v) => seen.push(v));
  expect(seen).toEqual([false]);
});

test("the guard never touches the install prompt's dismissal storage", () => {
  localStorage.removeItem("sh_install_dismissed_at");
  const cta = mark();
  const stop = watchPrimaryActionVisibility(() => {});
  FakeIO.instances[0].report(cta, 1);
  FakeIO.instances[0].report(cta, 0);
  stop();
  expect(localStorage.getItem("sh_install_dismissed_at")).toBeNull();
});
