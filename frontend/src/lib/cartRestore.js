import { stockCeiling, cartGiftKey } from "./shopPolish";

/**
 * Turning remembered INTENT back into a real cart.
 *
 * A stored cart says what someone meant to buy. It says nothing about what
 * anything costs, whether it is still sold, whether there is any left, or
 * whether that dog is still theirs — all of which can have changed since
 * the tab was closed. So a restored cart is never used as-is: every line is
 * resolved again against the authenticated catalogue the client is looking
 * at right now, and anything that cannot be resolved is dropped and said
 * out loud rather than carried silently to checkout.
 *
 * Two callers, one set of rules:
 *
 *   restoring a signed-in client's own cart on page load
 *   merging a guest cart into an account after signing in
 *
 * They differ only in what they merge INTO. Keeping the rules in one pure
 * function is what stops "the merge screen checks stock but the reload
 * doesn't" — the kind of difference nobody notices until a customer has
 * bought the last of something twice.
 *
 * None of this is a security boundary. The server prices, reserves and
 * authorizes every line again at checkout and refuses what it must; this
 * is here so the customer sees the truth in the cart instead of at the
 * payment page, and so nothing stale can be presented as current.
 */

export const DROP_REASON = {
  gone: "No longer available",
  shopify: "Fulfilled by Shopify — use its own listing",
  no_price: "Pricing unavailable",
  dog_gone: "The dog this was for is no longer on your account",
  dog_required: "Choose which dog this is for",
  max_qty: "Already at the maximum available quantity",
};

/** Same line = same thing, for the same dog, for the same person. Shared
 *  with the cart itself and with the server's aggregation key, so a merge
 *  can never fuse two lines the checkout would keep apart. */
export const sameCartLine = (a, b) => a.kind === b.kind && a.ref_id === b.ref_id
  && (a.dog_id || undefined) === (b.dog_id || undefined)
  && cartGiftKey(a.gift) === cartGiftKey(b.gift);

/** A training program bought for a specific dog to work through at home.
 *  It is the one kind that is meaningless without a dog attached. */
const needsDog = (item) => item?.kind === "training_program"
  && item?.purchase_fulfillment === "online_school";

/**
 * Resolve one remembered line against what is true now.
 *
 * `existingQty` is what the cart being merged INTO already holds for this
 * same line — so a stock cap is applied to the total, not to the incoming
 * quantity in isolation. Checking the incoming quantity alone is how two
 * carts each pass a "one left" check and together ask for two.
 */
export function resolveCartLine(line, { catalog = [], dogs = [], existingQty = 0 } = {}) {
  const requested = line.quantity;
  const base = { line, item: null, requested, existingQty, finalQty: existingQty, actuallyAdded: 0 };
  const drop = (rejected, item = null) => ({ ...base, item, rejected });

  const item = catalog.find((i) => i.kind === line.kind && i.id === line.ref_id);
  // Not in the catalogue this client can see: withdrawn, deactivated, or
  // never theirs to buy. Either way it cannot be restored.
  if (!item) return drop(DROP_REASON.gone);
  if (item.kind === "product" && item.sales_destination === "shopify_external") {
    return drop(DROP_REASON.shopify, item);
  }
  // No price means nothing to show and nothing to total. The server would
  // still price it, but a cart that displays a blank where money goes is
  // worse than a cart that says the line went away.
  if (item.price == null) return drop(DROP_REASON.no_price, item);

  // Dog ownership. The stored id proves nothing — it is a string somebody
  // could edit — so it only survives if it matches a dog on this account
  // right now. A dog that has been removed, or was never theirs, drops the
  // whole line rather than quietly being re-pointed at a different dog:
  // buying a course for the wrong dog is worse than buying nothing.
  if (line.dog_id && !dogs.some((d) => d.id === line.dog_id)) return drop(DROP_REASON.dog_gone, item);
  if (needsDog(item) && !line.dog_id) return drop(DROP_REASON.dog_required, item);

  const ceiling = stockCeiling(item);
  const requestedTotal = existingQty + requested;
  const finalQty = ceiling != null ? Math.min(requestedTotal, ceiling) : requestedTotal;
  const actuallyAdded = Math.max(0, finalQty - existingQty);
  const rejected = actuallyAdded === 0 && requested > 0
    ? (ceiling != null && ceiling <= existingQty ? DROP_REASON.max_qty : null)
    : null;
  return { line, item, requested, existingQty, finalQty, actuallyAdded, rejected };
}

/** Resolve a whole stored cart against an existing one. */
export function resolveCartLines(lines, { catalog = [], dogs = [], existing = [] } = {}) {
  return (lines || []).map((line) => resolveCartLine(line, {
    catalog, dogs,
    existingQty: (existing.find((c) => sameCartLine(c, line))?.quantity) || 0,
  }));
}

/**
 * Apply resolved lines onto an existing cart.
 *
 * Only the fields a cart line is allowed to have travel across — and the
 * gift travels WITH its line. Rebuilding a line without it is how a card
 * bought for somebody else quietly arrives at the buyer instead.
 */
export function applyResolved(existing, resolved) {
  const next = [...(existing || [])];
  for (const r of resolved) {
    if (r.actuallyAdded <= 0 || !r.item) continue;
    const idx = next.findIndex((c) => sameCartLine(c, r.line));
    if (idx >= 0) {
      next[idx] = { ...next[idx], quantity: r.finalQty };
    } else {
      next.push({
        kind: r.line.kind, ref_id: r.line.ref_id, quantity: r.finalQty,
        ...(r.line.dog_id ? { dog_id: r.line.dog_id } : {}),
        ...(r.line.gift ? { gift: r.line.gift } : {}),
      });
    }
  }
  return next;
}

/**
 * What to tell the customer about a restored cart.
 *
 * Only ever about lines that CHANGED. A cart that came back exactly as it
 * was left needs no announcement — and a notice that fires every reload is
 * a notice people stop reading, including on the reload that mattered.
 */
export function restoreNotices(resolved) {
  const out = [];
  for (const r of resolved) {
    // An item that has left the catalogue has no name to give, because a
    // name is the server's and is deliberately never stored. So the notice
    // says what it can honestly say rather than printing "An item —".
    if (!r.item) { out.push("Something you saved is no longer available"); continue; }
    if (r.rejected) out.push(`${r.item.name} — ${r.rejected.toLowerCase()}`);
    else if (r.actuallyAdded < r.requested) {
      out.push(`${r.item.name} — only ${r.finalQty} available, quantity reduced`);
    }
  }
  return out;
}
