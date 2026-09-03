/* School viewport control — the ONE place School moves the customer's screen.
 *
 * Rule: the customer scrolls to read; they never scroll to find what to do
 * next. Every School screen shares a single nested scroll container
 * (`[data-scroll-root]` in SchoolApp.jsx) that sits under a fixed-height
 * header and, on phones, behind a fixed bottom tab bar. `scrollIntoView`
 * knows nothing about either, fires against whatever layout exists at the
 * instant it is called, and lets two callers fight over one transition — the
 * exact failures the mobile audit measured. So nothing in School calls
 * `scrollIntoView` any more; it calls the two functions below.
 *
 *   resetSchoolScroll()   — a screen change gets a fresh viewport.
 *   revealInSchool(...)   — put ONE thing where the customer needs it, after
 *                           the layout has settled, cancelling any reveal
 *                           that was still pending.
 *
 * Alignment:
 *   "start"  — the target's top sits just under the header (reading).
 *   "action" — the target's top if the whole card fits in the usable window;
 *              otherwise its primary button sits just above the tab bar, so
 *              the button is on screen even when the card is tall (acting).
 *
 * `ifNeeded` skips the scroll when the target (and, for "action", its button)
 * is already inside the usable window — a page that opens with the right
 * thing on screen must not jump.
 *
 * Settling: the target is polled with setTimeout (not requestAnimationFrame —
 * a backgrounded tab never fires rAF) until it exists and its position has
 * held still across two polls, or the budget runs out. Step completion
 * refetches the lesson and swaps cards in the actions area; the poll is what
 * keeps the reveal from landing on a layout that is about to change.
 */

export const SCROLL_ROOT_SELECTOR = "[data-scroll-root]";
const HEADER_SELECTOR = '[data-testid="school-app"] > header';
const BOTTOM_NAV_SELECTOR = '[data-testid="school-nav-mobile"]';

const DEFAULTS = { align: "start", offset: 8, ifNeeded: false, budgetMs: 1500, pollMs: 50, cta: null };

let pendingToken = 0;
let pendingCleanup = null;

function docReady() { return typeof document !== "undefined" && typeof window !== "undefined"; }

export function schoolScrollRoot() {
  if (!docReady()) return null;
  return document.querySelector(SCROLL_ROOT_SELECTOR);
}

function visibleHeight(el) {
  if (!el) return 0;
  const r = el.getBoundingClientRect();
  if (r.height <= 0) return 0;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return 0;
  return r.height;
}

export function schoolChromeInsets() {
  if (!docReady()) return { top: 0, bottom: 0 };
  return {
    top: visibleHeight(document.querySelector(HEADER_SELECTOR)),
    bottom: visibleHeight(document.querySelector(BOTTOM_NAV_SELECTOR)),
  };
}

export function prefersReducedMotion() {
  if (!docReady() || typeof window.matchMedia !== "function") return false;
  try { return !!window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

function resolveTarget(target) {
  if (!docReady() || !target) return null;
  if (typeof target === "function") return target() || null;
  if (typeof target === "string") return document.querySelector(target);
  return target;
}

function resolveCta(target, cta) {
  if (!target) return null;
  if (cta) return resolveTarget(cta) || target.querySelector?.(cta) || null;
  return target.querySelector?.("button, a[href]") || null;
}

/** The usable window inside the scroll root, in viewport coordinates. */
export function usableWindow(root) {
  const rootRect = root.getBoundingClientRect();
  const { bottom } = schoolChromeInsets();
  const visibleBottom = Math.min(rootRect.bottom, window.innerHeight - bottom);
  return { top: rootRect.top, bottom: visibleBottom, height: Math.max(0, visibleBottom - rootRect.top) };
}

/** Pure position math, exported for tests. Returns the scrollTop to set, or
 *  null when nothing should move. */
export function computeRevealTop({ root, target, cta, align, offset, ifNeeded }) {
  const rootRect = root.getBoundingClientRect();
  const win = usableWindow(root);
  const targetRect = target.getBoundingClientRect();
  const maxTop = Math.max(0, root.scrollHeight - root.clientHeight);
  const current = root.scrollTop;
  const clamp = (v) => Math.max(0, Math.min(maxTop, Math.round(v)));

  const startTop = current + (targetRect.top - rootRect.top) - offset;

  if (align === "action") {
    const ctaRect = cta ? cta.getBoundingClientRect() : targetRect;
    const fits = targetRect.height + offset * 2 <= win.height;
    if (ifNeeded) {
      const targetTopVisible = targetRect.top >= win.top && targetRect.top <= win.bottom - 80;
      const ctaVisible = ctaRect.top >= win.top && ctaRect.bottom <= win.bottom;
      if (targetTopVisible && ctaVisible) return null;
    }
    if (fits) return clamp(startTop);
    // Tall card: keep the button reachable, reading from the top of it up.
    const ctaAligned = current + (ctaRect.bottom - rootRect.top) - (win.height - offset);
    return clamp(ctaAligned);
  }

  if (ifNeeded) {
    const inWindow = targetRect.top >= win.top && targetRect.top <= win.bottom - 120;
    if (inWindow) return null;
  }
  return clamp(startTop);
}

function cancelPending() {
  pendingToken += 1;
  if (pendingCleanup) { try { pendingCleanup(); } catch { /* ignore */ } }
  pendingCleanup = null;
}

/** A screen change gets a fresh viewport. Cancels any pending reveal. */
export function resetSchoolScroll() {
  cancelPending();
  const root = schoolScrollRoot();
  if (!root) return false;
  root.scrollTop = 0;
  return true;
}

/**
 * Reveal one thing. Resolves to `{ top }` when it scrolled, `{ skipped }`
 * when nothing needed to move, or `null` when the target never appeared or a
 * newer reveal superseded this one.
 */
export function revealInSchool(target, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  cancelPending();
  const token = pendingToken;
  if (!docReady()) return Promise.resolve(null);

  return new Promise((resolve) => {
    const started = Date.now();
    let lastTop = null;
    let timer = null;
    pendingCleanup = () => { if (timer) clearTimeout(timer); resolve(null); };

    const tick = () => {
      if (token !== pendingToken) return; // superseded
      const root = schoolScrollRoot();
      const el = resolveTarget(target);
      const elapsed = Date.now() - started;
      if (!root || !el) {
        if (elapsed >= opts.budgetMs) { pendingCleanup = null; resolve(null); return; }
        timer = setTimeout(tick, opts.pollMs);
        return;
      }
      const top = el.getBoundingClientRect().top;
      const settled = lastTop !== null && Math.abs(top - lastTop) < 1;
      lastTop = top;
      if (!settled && elapsed < opts.budgetMs) { timer = setTimeout(tick, opts.pollMs); return; }

      const cta = opts.align === "action" ? resolveCta(el, opts.cta) : null;
      const next = computeRevealTop({ root, target: el, cta, align: opts.align, offset: opts.offset, ifNeeded: opts.ifNeeded });
      pendingCleanup = null;
      if (next === null) { resolve({ skipped: true }); return; }
      const behavior = prefersReducedMotion() ? "auto" : "smooth";
      if (typeof root.scrollTo === "function") root.scrollTo({ top: next, behavior });
      else root.scrollTop = next;
      resolve({ top: next });
    };
    timer = setTimeout(tick, 0);
  });
}

/** Focus a dialog's heading without letting the browser scroll the dialog to
 *  a control that happened to be focusable — the reason overlays opened
 *  scrolled to their own bottom. */
export function focusDialogTitle(el) {
  if (!el || typeof el.focus !== "function") return;
  try { el.focus({ preventScroll: true }); } catch { try { el.focus(); } catch { /* ignore */ } }
}
