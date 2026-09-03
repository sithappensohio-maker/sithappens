import { useEffect, useState } from "react";

/**
 * Primary-action guard — "is the customer's current primary action on screen?"
 *
 * Floating promotions (the install pill today; anything else later) must not
 * compete with the one thing the app is asking the customer to do next. This
 * module answers that question from the DOM itself, with no polling:
 *
 *  - an IntersectionObserver watches every marked element and reports when it
 *    is at least `VISIBLE_RATIO` inside the viewport (clipped by any scroll
 *    container it lives in, so School's nested scroll root works as-is);
 *  - a MutationObserver re-scans when screens mount/unmount so a CTA that
 *    appears later is picked up without anyone having to register it.
 *
 * Opting in: School already marks its primary CTA with `data-school-primary`.
 * Any other high-priority client CTA can opt into the same protection by
 * adding `data-primary-action` to the element.
 *
 * A freshly observed element counts as visible until the observer reports,
 * so a promotion never flashes over a CTA on first paint.
 */
export const PRIMARY_ACTION_SELECTOR = "[data-school-primary], [data-primary-action]";
export const VISIBLE_RATIO = 0.5;

const ATTRS = ["data-school-primary", "data-primary-action"];

/**
 * Watch the document for visible primary actions. `onChange(visible)` fires
 * whenever the answer changes (and once on start). Returns a stop function.
 */
export function watchPrimaryActionVisibility(onChange, { root = typeof document !== "undefined" ? document : null, ratio = VISIBLE_RATIO } = {}) {
  if (!root || typeof window === "undefined") { onChange(false); return () => {}; }
  const IO = window.IntersectionObserver;
  const MO = window.MutationObserver;
  if (typeof IO !== "function") { onChange(false); return () => {}; } // no way to know: don't block the promotion

  const state = new Map(); // element -> true | false | null (null = not reported yet)
  let last = null;
  const emit = () => {
    let visible = false;
    state.forEach((v) => { if (v !== false) visible = true; });
    if (visible !== last) { last = visible; onChange(visible); }
  };

  const io = new IO((entries) => {
    for (const e of entries) {
      if (!state.has(e.target)) continue;
      state.set(e.target, !!(e.isIntersecting && e.intersectionRatio >= ratio));
    }
    emit();
  }, { threshold: [ratio] });

  const scan = () => {
    const found = new Set(root.querySelectorAll(PRIMARY_ACTION_SELECTOR));
    state.forEach((_, el) => { if (!found.has(el)) { io.unobserve(el); state.delete(el); } });
    found.forEach((el) => { if (!state.has(el)) { state.set(el, null); io.observe(el); } });
    emit();
  };
  scan();

  const mo = typeof MO === "function" ? new MO(scan) : null;
  const body = root.body || root;
  if (mo && body) mo.observe(body, { childList: true, subtree: true, attributes: true, attributeFilter: ATTRS });

  return () => { if (mo) mo.disconnect(); io.disconnect(); state.clear(); };
}

/** React view of the same answer. Conservative (true) until the first report. */
export function usePrimaryActionVisible(enabled = true) {
  const [visible, setVisible] = useState(!!enabled);
  useEffect(() => {
    if (!enabled) { setVisible(false); return undefined; }
    setVisible(true);
    return watchPrimaryActionVisibility(setVisible);
  }, [enabled]);
  return enabled ? visible : false;
}
