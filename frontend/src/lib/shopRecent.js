/**
 * The last few things someone looked at in the shop.
 *
 * This is a convenience, not a record. It exists so that closing a product
 * page does not mean losing it, and so a returning visitor has somewhere
 * obvious to pick up. It is deliberately NOT analytics: it holds only the
 * shop items a person opened, never pages, never sessions, never anything
 * they did elsewhere in the app, and it never leaves the browser except as
 * a list of ids sent back to ask "what are these now".
 *
 * What is stored, per entry, is a reference and a time:
 *
 *     {kind, ref_id, at}
 *
 * No price, no name, no picture, no stock. Everything shown is resolved
 * against the live catalogue at render time (POST /shop/discovery), which is
 * both why a stale entry cannot show a stale price and why an item that has
 * since been hidden simply disappears from the list rather than needing to
 * be cleaned up.
 *
 * Scoped like the cart is (lib/cartIntent): one bucket per signed-in client,
 * one for a guest. Two people sharing a computer should not be shown each
 * other's browsing, and on this cap that costs nothing.
 */

export const RECENT_VERSION = 1;

/** Twelve is roughly two rows on a phone and one on a desktop — enough to
 *  be a memory, few enough that it stays a shortcut rather than a history. */
export const MAX_RECENT = 12;

const KINDS = ["product", "credit_pack", "training_program", "gift_card"];
const PREFIX = "sh_recent_v1:";
const GUEST = "guest";

export function recentKey(clientId) {
  const id = typeof clientId === "string" && clientId.trim() ? clientId.trim() : GUEST;
  return PREFIX + id;
}

function safeEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!KINDS.includes(raw.kind)) return null;
  if (typeof raw.ref_id !== "string" || !raw.ref_id || raw.ref_id.length > 128) return null;
  const at = typeof raw.at === "number" && Number.isFinite(raw.at) ? raw.at : 0;
  return { kind: raw.kind, ref_id: raw.ref_id, at };
}

/** Newest first, no repeats, capped. Never throws: a corrupt store reads as
 *  an empty list, because a shop that will not load is worse than a shop
 *  with no history. */
export function readRecent(clientId) {
  let parsed;
  try { parsed = JSON.parse(localStorage.getItem(recentKey(clientId)) || "null"); }
  catch { return []; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  if (parsed.version !== RECENT_VERSION) return [];
  if (!Array.isArray(parsed.items)) return [];

  const seen = new Set();
  const out = [];
  for (const raw of parsed.items.slice(0, MAX_RECENT * 2)) {
    const entry = safeEntry(raw);
    if (!entry) continue;
    const id = `${entry.kind}:${entry.ref_id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(entry);
    if (out.length >= MAX_RECENT) break;
  }
  out.sort((a, b) => b.at - a.at);
  return out;
}

/**
 * Record one visit.
 *
 * Looking at something again moves it to the front rather than adding a
 * second entry — "recently viewed" showing the same leash four times would
 * be an accurate log and a useless list.
 */
export function rememberViewed(clientId, kind, ref_id) {
  const entry = safeEntry({ kind, ref_id, at: Date.now() });
  if (!entry) return readRecent(clientId);
  const next = [entry, ...readRecent(clientId).filter(
    (e) => !(e.kind === entry.kind && e.ref_id === entry.ref_id))].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(recentKey(clientId),
      JSON.stringify({ version: RECENT_VERSION, items: next }));
  } catch { /* storage full or blocked — the list is a convenience, not load-bearing */ }
  return next;
}

export function clearRecent(clientId) {
  try { localStorage.removeItem(recentKey(clientId)); } catch { /* ignore */ }
}

/**
 * Forget everyone's browsing in this browser.
 *
 * Called on sign-out, for the same reason the cart is: what someone was
 * shopping for is theirs, and a shared computer should not hand it to the
 * next person. The guest bucket goes too — after signing out, this browser
 * IS the guest bucket.
 */
export function clearAllRecent() {
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith(PREFIX)) localStorage.removeItem(k);
    }
  } catch { /* nothing we can do, and nothing that should break sign-out */ }
}

/** The request body shape the discovery endpoint expects. */
export function recentRefs(clientId) {
  return readRecent(clientId).map((e) => ({ kind: e.kind, ref_id: e.ref_id }));
}
