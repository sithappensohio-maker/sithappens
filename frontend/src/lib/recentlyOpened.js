// Recently Opened — per-staff-user localStorage list of the records a
// staff member has actually opened (clients, dogs, bookings, bills, shop
// orders), most recent first. Same user-namespaced localStorage pattern as
// pinned favorites (sh_pinned_favorites_${uid}). Local storage is a cache
// of *what to show*, never a source of permission — the caller must always
// filter the returned list against the user's live permissions before
// rendering (see `permKeyForKind` below), since a permission revoked after
// an item was recorded must hide it immediately.

const LIMIT = 10;

const key = (uid) => `sh_recently_opened_${uid || "anon"}`;

export function getRecents(uid) {
  try {
    const raw = localStorage.getItem(key(uid));
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function addRecent(uid, entry) {
  if (!entry?.kind || !entry?.id) return;
  try {
    const list = getRecents(uid).filter((e) => !(e.kind === entry.kind && e.id === entry.id));
    list.unshift({ ...entry, ts: Date.now() });
    localStorage.setItem(key(uid), JSON.stringify(list.slice(0, LIMIT)));
  } catch {
    // localStorage unavailable/full — recently-opened is a convenience,
    // never worth surfacing an error for.
  }
}

export function clearRecents(uid) {
  try { localStorage.removeItem(key(uid)); } catch { /* ignore */ }
}

// The permission that governs whether a recently-opened entry of this kind
// may still be shown — mirrors the exact gating used by the search endpoint
// (backend/server.py `search()`) so Recently Opened can never reveal more
// than a fresh search would.
const PERM_FOR_KIND = {
  client: "clients_view",
  dog: "dogs_view",
  booking: null, // matches GET /bookings — no extra staff-only gate beyond authentication
  invoice: "finance_reports",
  payment: "finance_reports",
  shop_order: "take_payments",
  prepaid_purchase: "finance_reports",
};

export function visibleRecents(uid, can) {
  return getRecents(uid).filter((e) => {
    const perm = PERM_FOR_KIND[e.kind];
    return !perm || can(perm);
  });
}
