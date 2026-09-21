/**
 * Telling the shop what happened, without getting in the way.
 *
 * Three promises this file has to keep.
 *
 * **It never blocks.** Events queue in memory and flush on a timer, on page
 * hide, and when the queue fills. Nothing waits for a response, nothing
 * awaits a flush before navigating, and every failure is swallowed — a
 * customer must never fail to buy something because an analytics request
 * did not go through.
 *
 * **It never storms.** A product on screen is one impression, not one per
 * render. React's StrictMode double-invokes effects and a filtered list
 * re-renders constantly; both have already produced duplicate work
 * elsewhere in this shop, so deduplication here is explicit rather than
 * hoped for. Impressions are remembered per view-context and reset when the
 * context genuinely changes — a new department, a new search — not when a
 * component happens to re-render.
 *
 * **It never carries content.** What goes out is a reference and a count: a
 * kind, a ref_id, a department, a normalised search term, a quantity. Never
 * a recipient, never a dog, never a name, never a note, never a token. The
 * server enforces that too, with an allowlist, but the browser should not be
 * sending it in the first place.
 *
 * The session id is a random first-party string in sessionStorage. It lasts
 * one browsing session, never leaves this site, is hashed again server-side,
 * and identifies nobody — it exists so "one person looked at four things"
 * can be told apart from "four people looked at one thing each".
 */
import { api } from "./api";

const SESSION_KEY = "sh_shop_session";
const FLUSH_MS = 4000;
const MAX_QUEUE = 30;

let queue = [];
let timer = null;
let sessionId = null;

/** A random id for this visit. sessionStorage, not localStorage: a shopping
 *  session should not be the same one next week. */
export function shopSession() {
  if (sessionId) return sessionId;
  try {
    sessionId = sessionStorage.getItem(SESSION_KEY);
    if (!sessionId) {
      sessionId = (crypto?.randomUUID?.() || String(Math.random()).slice(2)) + Date.now().toString(36);
      sessionStorage.setItem(SESSION_KEY, sessionId);
    }
  } catch {
    // Private mode, or storage blocked. An in-memory id still correlates
    // this page's events, which is better than none and costs nothing.
    sessionId = sessionId || String(Math.random()).slice(2);
  }
  return sessionId;
}

/** Only what the server will accept anyway. Anything else is dropped here so
 *  it never even travels. */
const FIELDS = ["event", "kind", "ref_id", "department", "query", "result_count",
                "quantity", "rec_source", "order_id", "source", "dedupe_key"];

function clean(event) {
  const out = {};
  for (const key of FIELDS) {
    const value = event[key];
    if (value === undefined || value === null || value === "") continue;
    out[key] = value;
  }
  return out.event ? out : null;
}

export function flushShopEvents({ beacon = false } = {}) {
  if (queue.length === 0) return;
  const events = queue;
  queue = [];
  clearTimeout(timer);
  timer = null;

  const body = {
    session: shopSession(),
    viewport_width: typeof window !== "undefined" ? window.innerWidth : null,
    events,
  };
  try {
    if (beacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
      // The page is going away. A normal request would be cancelled mid-
      // flight; a beacon is handed to the browser to deliver afterwards,
      // which is the only way the last events of a visit survive.
      const url = `${api.defaults.baseURL || ""}/public/shop/events`;
      navigator.sendBeacon(url, new Blob([JSON.stringify(body)], { type: "application/json" }));
      return;
    }
    // Deliberately not awaited anywhere. Nothing in the shop should ever
    // wait on this, and a rejection must not surface as an unhandled one.
    api.post("/public/shop/events", body).catch(() => {});
  } catch {
    /* analytics is never worth an exception */
  }
}

/** Queue one event. Flushes on a timer, or immediately once the queue is
 *  full enough that waiting would risk losing it. */
export function trackShop(event) {
  const row = clean(event);
  if (!row) return;
  queue.push(row);
  if (queue.length >= MAX_QUEUE) {
    flushShopEvents();
    return;
  }
  if (!timer) timer = setTimeout(() => flushShopEvents(), FLUSH_MS);
}

/**
 * Start listening for the page going away.
 *
 * `visibilitychange` rather than `unload`: mobile browsers routinely kill a
 * backgrounded tab without ever firing unload, so unload alone loses the end
 * of every phone session — which is most of them.
 */
export function startShopAnalytics() {
  if (typeof document === "undefined") return () => {};
  const onHide = () => { if (document.visibilityState === "hidden") flushShopEvents({ beacon: true }); };
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", () => flushShopEvents({ beacon: true }));
  return () => document.removeEventListener("visibilitychange", onHide);
}

// ───────────────────────────────────────────── deduplication

/**
 * What has already been counted, and in what context.
 *
 * Keyed by a CONTEXT signature — the department and search a list was
 * showing — so scrolling a grid counts each product once, changing
 * department counts them again (a different list, genuinely seen again),
 * and a re-render counts nothing.
 */
const seen = new Map();   // context -> Set(keys)

function once(context, key) {
  let keys = seen.get(context);
  if (!keys) {
    keys = new Set();
    seen.set(context, keys);
    // Contexts accumulate as somebody browses. A handful is a session's
    // worth; more than that and the oldest are no longer interesting.
    if (seen.size > 24) seen.delete(seen.keys().next().value);
  }
  if (keys.has(key)) return false;
  keys.add(key);
  return true;
}

/** Products actually on screen, counted once per list view. */
export function trackImpressions(items, { department = "", search = "" } = {}) {
  const context = `${department}|${search}`;
  for (const item of items || []) {
    if (!item?.kind || !item?.id) continue;
    if (!once(context, `${item.kind}:${item.id}`)) continue;
    trackShop({ event: "product_impression", kind: item.kind, ref_id: item.id,
                department: department || undefined });
  }
}

/** One product_view per meaningful visit to a product page. */
export function trackProductView(kind, refId, department) {
  if (!kind || !refId) return;
  if (!once("pdp", `${kind}:${refId}`)) return;
  trackShop({ event: "product_view", kind, ref_id: refId, department: department || undefined });
}

/**
 * A page-level event that must fire once, not once per effect run.
 *
 * "The shop was opened" is a fact about a page load. React StrictMode runs
 * an effect, tears it down and runs it again, so the naive version reports
 * it twice on every single visit — which is exactly the storm this file
 * exists to prevent, and which browser QA caught it doing.
 */
export function trackOnce(key, event) {
  if (!once("page", key)) return;
  trackShop(event);
}

/** Reset what "already seen" means. Called when a visit genuinely restarts —
 *  a sign-in, a sign-out — so the next visit is counted rather than
 *  swallowed by the last one's memory. */
export function resetShopImpressions() {
  seen.clear();
}
