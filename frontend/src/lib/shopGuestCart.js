// Public no-account storefront — shared guest-cart storage + safe pending-
// redirect stash. Kept in one place so PublicShop.jsx (writes/reads the
// guest cart while browsing) and the post-login merge-review screen (reads
// once, clears only after explicit confirmation) never duplicate this
// logic or drift into two different validation rules.

export const GUEST_CART_KEY = "sh_guest_cart";
export const PENDING_SHOP_REDIRECT_KEY = "sh_pending_shop_redirect";

// Guest cart lines may ONLY ever be {kind, ref_id, quantity} — never a
// locally-cached price, name, inventory, eligibility, or visibility flag,
// all of which can go stale or leak stale/incorrect state. Anything that
// doesn't match this shape (a corrupted/tampered localStorage value, or an
// older/different shape from a future change) is dropped rather than
// trusted.
function isValidGuestCartLine(l) {
  return !!l
    && (l.kind === "product" || l.kind === "credit_pack" || l.kind === "training_program")
    && typeof l.ref_id === "string" && l.ref_id.length > 0
    && Number.isInteger(l.quantity) && l.quantity > 0;
}

export function readGuestCart() {
  try {
    const raw = localStorage.getItem(GUEST_CART_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isValidGuestCartLine)
      .map((l) => ({ kind: l.kind, ref_id: l.ref_id, quantity: l.quantity }));
  } catch {
    return [];
  }
}

export function writeGuestCart(cart) {
  try {
    const safe = (Array.isArray(cart) ? cart : []).filter(isValidGuestCartLine)
      .map((l) => ({ kind: l.kind, ref_id: l.ref_id, quantity: l.quantity }));
    localStorage.setItem(GUEST_CART_KEY, JSON.stringify(safe));
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
  /^\/shop\/item\/(product|credit_pack|training_program)\/[A-Za-z0-9-]{1,64}$/,
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
