// Public no-account storefront — shared guest-cart storage + safe pending-
// redirect stash. Kept in one place so PublicShop.jsx (writes/reads the
// guest cart while browsing) and the post-login merge-review screen (reads
// once, clears only after explicit confirmation) never duplicate this
// logic or drift into two different validation rules.

import { safeLine, safeLines, serializeCart, deserializeCart } from "./cartIntent";

export const GUEST_CART_KEY = "sh_guest_cart";
export const PENDING_SHOP_REDIRECT_KEY = "sh_pending_shop_redirect";

// What a guest cart may hold is decided in ONE place — lib/cartIntent.js —
// which the signed-in cart uses too. Prices, stock, names and eligibility
// are never stored by either: they are the server's, and they are asked for
// again on every restore and again at checkout.
//
// What differs here is not the SHAPE but the SCOPE and the RULES:
//
//   guest   one bucket, no identity, and never a dog
//   client  one bucket per client_id, dogs allowed, re-checked server-side
//
// A guest has no account, so they have no dogs — and the server refuses any
// guest line that requires one (domains/shop/guest.guest_block_reason). A
// dog_id in guest storage could therefore only be noise or an attempt, so
// it is dropped on the way in and on the way out rather than carried to a
// checkout that would reject it.
function guestLine(raw) {
  const line = safeLine(raw);
  if (!line) return null;
  delete line.dog_id;
  return line;
}

export function readGuestCart() {
  try {
    return deserializeCart(localStorage.getItem(GUEST_CART_KEY))
      .map(guestLine)
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function writeGuestCart(cart) {
  try {
    const safe = safeLines(Array.isArray(cart) ? cart : []).map(guestLine).filter(Boolean);
    localStorage.setItem(GUEST_CART_KEY, serializeCart(safe));
  } catch { /* ignore — guest cart is a convenience, never load-bearing */ }
}

export function clearGuestCart() {
  try { localStorage.removeItem(GUEST_CART_KEY); } catch { /* ignore */ }
}

// Strict allowlist — a bare /shop page, or a real item-detail path with a
// known kind and a safe id character set. Never an arbitrary redirect URL:
// this is what's stashed across login/registration/onboarding, so an
// unvalidated value here would be an open-redirect-shaped hole.
const SHOP_REDIRECT_ALLOWLIST = [
  /^\/shop$/,
  /^\/shop\/item\/(product|credit_pack|training_program|gift_card)\/[A-Za-z0-9-]{1,64}$/,
];

export function isValidShopRedirectPath(path) {
  return typeof path === "string" && SHOP_REDIRECT_ALLOWLIST.some((re) => re.test(path));
}

export function stashPendingShopRedirect(path) {
  if (!isValidShopRedirectPath(path)) return;
  try { localStorage.setItem(PENDING_SHOP_REDIRECT_KEY, path); } catch { /* ignore */ }
}

// Reads and clears in one step — a pending redirect is only ever consumed
// once. Re-validates on read (not just on write) since the stash could in
// principle be edited directly in localStorage.
export function consumePendingShopRedirect() {
  let path = null;
  try {
    path = localStorage.getItem(PENDING_SHOP_REDIRECT_KEY);
    localStorage.removeItem(PENDING_SHOP_REDIRECT_KEY);
  } catch { /* ignore */ }
  return isValidShopRedirectPath(path) ? path : null;
}

// ── guest order tokens ────────────────────────────────────────────────────
//
// A guest has no session, so the only thing that proves an order is theirs
// is the token checkout handed back. It travels in the Stripe return URL,
// but a URL is easy to lose — a copied link, a stripped query string, a
// browser that restores the tab without it — so it is also kept here,
// against the order id, and that copy is what makes "my orders" work on a
// return visit.
//
// This is a read key for one order. It is not a session: it grants no
// account, buys nothing, and changes nothing.
export const GUEST_ORDER_TOKENS_KEY = "sh_guest_order_tokens";
const MAX_REMEMBERED_ORDERS = 20;

function readTokenMap() {
  try {
    const parsed = JSON.parse(localStorage.getItem(GUEST_ORDER_TOKENS_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

export function rememberGuestOrderToken(orderId, token) {
  if (!orderId || !token) return;
  try {
    const map = readTokenMap();
    map[orderId] = token;
    // Oldest out first, so this cannot grow without bound on a shared
    // machine. Insertion order is the order of the keys.
    const keys = Object.keys(map);
    const trimmed = keys.length > MAX_REMEMBERED_ORDERS
      ? Object.fromEntries(keys.slice(keys.length - MAX_REMEMBERED_ORDERS).map((k) => [k, map[k]]))
      : map;
    localStorage.setItem(GUEST_ORDER_TOKENS_KEY, JSON.stringify(trimmed));
  } catch { /* ignore — the URL token still works */ }
}

export function guestOrderToken(orderId) {
  return readTokenMap()[orderId] || null;
}

export function forgetGuestOrderToken(orderId) {
  try {
    const map = readTokenMap();
    delete map[orderId];
    localStorage.setItem(GUEST_ORDER_TOKENS_KEY, JSON.stringify(map));
  } catch { /* ignore */ }
}
