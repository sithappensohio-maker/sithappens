// Friends & family bookings — dogs of DIFFERENT families on one booking, one
// family paying (owner request 2026-09-28). The rules live on the server
// (backend/domains/bookings/friends_family.py); these helpers only read the
// rows the server sends so every screen shows the same thing.
//
// Every dog of a friends & family booking carries `bill_to_client_id` (the
// family paying) — the paying family's own dogs too. `client_id` stays the
// dog's own family (report cards, phone numbers, care).

const GONE = ["cancelled", "canceled", "rejected"];

// Can this person use the friends & family booking controls right now? The
// switch comes from the server (/me/permissions `features`), never from the
// permission alone: the owner passes every permission check.
export function friendsFamilyOn(auth) {
  return !!(auth && auth.features && auth.features.friends_family && auth.can && auth.can("friends_family_bookings"));
}

export const isFriendsFamily = (row) => !!(row && row.bill_to_client_id);

// A friend's dog: someone other than its own family pays for it.
export const isFriendsDog = (row) => isFriendsFamily(row) && row.bill_to_client_id !== row.client_id;

export const activeRows = (rows) => (rows || []).filter((r) => !GONE.includes(r.status));

// The dog's place in its booking (0 = the dog paying the first-dog price),
// read the way the server reads it (domains/bookings/group_rank.py).
export function rankOf(row) {
  const idx = row?.pricing_snapshot?.group_dog_index;
  if (idx === null || idx === undefined || idx === "") return row?.multi_dog_discount?.pre_applied ? 1 : 0;
  const n = parseInt(idx, 10);
  return Number.isFinite(n) ? n : 0;
}

export const byRank = (rows) =>
  [...(rows || [])].sort((a, b) => rankOf(a) - rankOf(b) || String(a.created_at || "").localeCompare(String(b.created_at || "")));

const lineTotal = (a) => Number(a.price || 0) * Number(a.qty || 1);

// Is this extra already inside the dog's stored price? The price is stored
// when the dog is booked (or re-priced); extras added later — at check-in,
// from the booking, at checkout — are on top of it. (A checkout's extras
// folded back in by a reopened checkout are inside it.)
const pricedAt = (row) =>
  Date.parse(row?.pricing_snapshot?.price_refreshed_at || row?.pricing_snapshot?.created_at || row?.created_at || "") || null;
function inStoredPrice(row, a) {
  if (a.added_stage === "checkout_folded") return true;
  if (a.added_stage === "checkout") return false;
  const at = Date.parse(a.added_at || "");
  const priced = pricedAt(row);
  return !at || !priced || at <= priced + 60000;
}

// The dog's booked service price as the server stored it (multi-dog discount
// already taken off an extra dog), without its extras. null when not stored.
export function bookedServicePrice(row) {
  if (row?.estimated_price === null || row?.estimated_price === undefined) return null;
  const inside = (row.add_ons || []).filter((a) => inStoredPrice(row, a)).reduce((s, a) => s + lineTotal(a), 0);
  return Math.max(0, Math.round((Number(row.estimated_price) - inside) * 100) / 100);
}

// Dogs of the booking that have gone home and are waiting for the group's one
// bill (the same rule the server uses before refusing a payment on the account).
export const waitingForBill = (rows) =>
  (rows || []).some((r) => r.status === "completed" && (r.group_bill_pending || r.group_bill_claim));

// A family's page: the friends' dogs it pays for, booking by booking, from
// GET /clients/{id}/friends-family ({ waiting_for_bill, groups: [{ group_id,
// waiting, dogs }] }). Its own dogs are listed on the page already.
export function friendsPaidFor(ff, clientId) {
  return ((ff && ff.groups) || [])
    .map((g) => ({ ...g, friends: (g.dogs || []).filter((d) => d.client_id !== clientId) }))
    .filter((g) => g.friends.length > 0 || g.waiting);
}

// How many dogs a booking group has — the ones still booked (a dog taken out
// of the booking, i.e. cancelled, no longer counts).
export function dogsPerGroup(rows) {
  const counts = {};
  for (const b of activeRows(rows)) {
    if (b?.group_id) counts[b.group_id] = (counts[b.group_id] || 0) + 1;
  }
  return counts;
}
