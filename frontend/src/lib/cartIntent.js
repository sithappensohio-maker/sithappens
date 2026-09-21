/**
 * What a cart is allowed to remember between page loads.
 *
 * A cart in this app is INTENT: "one of these, two of those, that gift card
 * to Nan". It is never a record of what anything costs. Prices, tax, totals,
 * stock, eligibility and entitlements are the server's, and they are asked
 * for again every time — on restore, on checkout, and at the moment money
 * moves. Nothing stored here has any authority.
 *
 * That is not a style preference. A price kept in localStorage is a price a
 * customer can edit, and a cart that trusts it is a shop that can be told
 * what to charge. The guest cart has worked this way since Phase 8; this
 * module is that rule extracted so the authenticated cart cannot drift from
 * it, while the two keep their own, different authorization rules.
 *
 *   guest cart  —  one bucket, no identity, only guest-eligible kinds
 *   auth cart   —  one bucket PER CLIENT, any kind they may buy
 *
 * Same serialization, different scope and different gates. Sharing the
 * serializer is the point; sharing the gates would be a bug.
 */

/** Bump only when the stored SHAPE changes. An older or newer version is
 *  discarded rather than guessed at — a cart is not worth a migration bug. */
export const CART_INTENT_VERSION = 1;

const KINDS = ["product", "credit_pack", "training_program", "gift_card"];

// Caps that exist to stop a hand-edited store from becoming a denial of
// service or a wall of text in somebody's order. They are the SERVER's own
// limits (ShopCheckoutIn.items max_length, ShopCartItemIn.quantity le=50),
// copied rather than invented, so a cart can never hold something checkout
// would reject with a 422 the customer cannot act on.
const MAX_LINES = 40;
const MAX_QTY = 50;
const MAX_GIFT = { recipient_email: 200, recipient_name: 120, gift_message: 300 };

const str = (v, max) => (typeof v === "string" && v.length <= max ? v : null);

/**
 * The ONLY fields that survive a reload.
 *
 * Anything not named here is dropped on the way through — which is what
 * makes "no prices are persisted" a property of the code rather than of
 * everybody remembering. `dog_id` and the gift fields are intent too: who
 * the course is for, and who the present is for. Neither is trusted; the
 * server re-checks dog ownership on every restore and again at checkout.
 */
export function safeLine(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!KINDS.includes(raw.kind)) return null;

  const ref_id = str(raw.ref_id, 128);
  if (!ref_id) return null;

  const quantity = raw.quantity;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) return null;

  const line = { kind: raw.kind, ref_id, quantity };

  const dog_id = str(raw.dog_id, 128);
  if (dog_id) line.dog_id = dog_id;

  const g = raw.gift;
  if (g && typeof g === "object") {
    const gift = {};
    for (const [k, max] of Object.entries(MAX_GIFT)) {
      const v = str(g[k], max);
      if (v) gift[k] = v;
    }
    // A name or a message with no address is a present nobody receives, and
    // the server refuses it at checkout — so it is not worth storing either.
    if (gift.recipient_email) line.gift = gift;
  }

  return line;
}

/** What makes two lines the same line. Mirrors the server's own key
 *  (domains/shop/cart._gift_identity) so a cart cannot merge two things the
 *  checkout would keep apart — a $25 card for Nan and one for Sam.
 *
 *  Nothing here is a customer-facing option or variant identifier, because
 *  nothing in this catalogue has one yet. When something does, it belongs
 *  in safeLine AND in this key, together: a key that ignores a variant
 *  merges a small and a large into one line. */
export function lineIdentity(line) {
  const g = line?.gift || {};
  return [
    line?.kind, line?.ref_id, line?.dog_id || "",
    (g.recipient_email || "").trim().toLowerCase(),
    (g.recipient_name || "").trim(),
    (g.gift_message || "").trim(),
  ].join("|");
}

/** Sanitize a whole cart: drop what is malformed, collapse true duplicates,
 *  and cap the length. Never throws — a corrupt store yields an empty cart,
 *  because a shop that will not load is worse than a shop with no cart. */
export function safeLines(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Map();
  for (const item of raw.slice(0, MAX_LINES * 2)) {
    const line = safeLine(item);
    if (!line) continue;
    const id = lineIdentity(line);
    const prev = seen.get(id);
    // Two stored entries for the same thing are one line with the summed
    // quantity — which is what the server does with a duplicated cart line.
    if (prev) prev.quantity = Math.min(MAX_QTY, prev.quantity + line.quantity);
    else seen.set(id, line);
    if (seen.size >= MAX_LINES) break;
  }
  return [...seen.values()];
}

export function serializeCart(lines) {
  return JSON.stringify({ version: CART_INTENT_VERSION, lines: safeLines(lines) });
}

/**
 * Read a stored cart back.
 *
 * Fails safe on every path: bad JSON, wrong shape, a version from a future
 * release, an object where an array should be. All of them mean "no cart",
 * never a crash and never a half-built one.
 */
export function deserializeCart(raw) {
  if (typeof raw !== "string" || !raw) return [];
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return []; }
  // The pre-version shape: a bare array of lines. Not a guess — it is the
  // same line shape, read by the same validator — so a cart written by the
  // build before this one is kept rather than thrown away.
  if (Array.isArray(parsed)) return safeLines(parsed);
  if (!parsed || typeof parsed !== "object") return [];
  // Any OTHER version is discarded rather than interpreted. A newer build
  // may have written a shape this one would misread, and a misread cart
  // becomes a wrong order.
  if (parsed.version !== CART_INTENT_VERSION) return [];
  return safeLines(parsed.lines);
}

// ───────────────────────────────────────────────── authenticated storage

/**
 * One bucket per client.
 *
 * `client_id` is a non-secret, stable identity the frontend already holds
 * from /auth/me. It is NOT a token and grants nothing — it is here purely so
 * that two people sharing a browser cannot be handed each other's cart, even
 * if a logout never ran (a closed tab, an expired token, a crash).
 */
export const AUTH_CART_PREFIX = "sh_cart_v1:";

export function authCartKey(clientId) {
  const id = typeof clientId === "string" ? clientId.trim() : "";
  return id ? AUTH_CART_PREFIX + id : null;
}

export function readAuthCart(clientId) {
  const key = authCartKey(clientId);
  if (!key) return [];
  try { return deserializeCart(localStorage.getItem(key)); }
  catch { return []; }
}

export function writeAuthCart(clientId, lines) {
  const key = authCartKey(clientId);
  if (!key) return;
  try {
    const safe = safeLines(lines);
    if (safe.length) localStorage.setItem(key, serializeCart(safe));
    else localStorage.removeItem(key);   // an empty cart is not worth a row
  } catch { /* storage full or blocked — the cart still works this session */ }
}

/**
 * Forget every authenticated cart in this browser.
 *
 * Called on logout. The alternative — keeping each client's cart under its
 * own key so it returns next time — is friendlier, and it is what the GUEST
 * cart does. It is the wrong trade here: an authenticated cart can name a
 * dog and a gift recipient, and logging out of a shared computer should not
 * leave somebody's family in localStorage. Per-client keys stay as a second
 * line of defence for the times logout never runs.
 */
export function clearAllAuthCarts() {
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith(AUTH_CART_PREFIX)) localStorage.removeItem(k);
    }
  } catch { /* nothing we can do, and nothing that should break sign-out */ }
}
