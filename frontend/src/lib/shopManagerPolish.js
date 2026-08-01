/* Pure helpers behind the Admin Shop Utility Addendum (ShopManager.jsx) —
 * extracted so the inventory-status/warning/margin/order-status logic can be
 * unit-tested without rendering React or mocking the API. Display-only:
 * nothing here mutates stored records or duplicates backend authority over
 * inventory, pricing, or fulfillment.
 */

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

// Float stock comparisons use the same tolerance as the backend's own
// _mutate_product_stock so "zero" and "at threshold" read consistently here.
export const STOCK_TOLERANCE = 0.0005;

// Clear status + quantity instead of a bare number — Shopify-linked listings
// never show internal stock (Shopify remains authoritative for those).
export function inventoryStatus(it) {
  if (it.kind !== "physical_product") return null;
  if (it.sales_destination === "shopify_external") return { label: "Shopify Managed", tone: "muted" };
  if (!it.track_inventory) return { label: "Not Tracked", tone: "muted" };
  const qty = it.stock_on_hand ?? 0;
  if (qty <= STOCK_TOLERANCE) return { label: `Out of Stock · ${qty}`, tone: "bad" };
  if (it.low_stock_threshold != null && qty <= it.low_stock_threshold) return { label: `Low Stock · ${qty}`, tone: "warn" };
  return { label: `In Stock · ${qty}`, tone: "ok" };
}

export function joinWords(words) {
  if (words.length <= 1) return words[0] || "";
  if (words.length === 2) return `${words[0]} and ${words[1]}`;
  return `${words.slice(0, -1).join(", ")}, and ${words[words.length - 1]}`;
}

// Admin-only, visual-only setup/status warnings — never changes an item's
// actual visibility. Combined into as few badges as make sense: a bundled
// "Needs Setup" badge for online-listing gaps, a separate stock badge, and a
// single "Hidden Everywhere" badge only when both channels are off (the
// Shop/Register columns already show each channel individually).
export function itemWarnings(it) {
  const badges = [];
  if (it.show_online) {
    const gaps = [];
    if (it.missing_image) gaps.push("image");
    if (it.missing_description) gaps.push("description");
    if (!it.category_id) gaps.push("category");
    else if (it.category_hidden) gaps.push("active category");
    if (gaps.length > 0) badges.push({ label: `Needs Setup · Missing ${joinWords(gaps)}`, tone: "warn" });
  }
  if (it.kind === "physical_product" && it.track_inventory && it.active) {
    const qty = it.stock_on_hand ?? 0;
    if (qty <= STOCK_TOLERANCE) badges.push({ label: "Out of Stock", tone: "bad" });
    else if (it.low_stock_threshold != null && qty <= it.low_stock_threshold) badges.push({ label: `Low Stock · ${qty} remaining`, tone: "warn" });
  }
  if (!it.show_online && !it.show_at_register) badges.push({ label: "Hidden Everywhere", tone: "muted" });
  return badges;
}

// Cost/margin — display-only, admin-only, internal physical products only. A
// missing cost is never treated as zero.
export function marginDisplay(it) {
  if (it.kind !== "physical_product" || it.sales_destination === "shopify_external") return null;
  if (it.cost == null) return { cost: "Cost not entered", gm: null };
  const cost = Number(it.cost);
  const price = Number(it.list_price || 0);
  const gmDollars = price - cost;
  const gmPercent = price > 0 ? (gmDollars / price) * 100 : null;
  return {
    cost: money(cost),
    gm: `${money(gmDollars)}${gmPercent != null ? ` (${gmPercent.toFixed(1)}%)` : ""}`,
  };
}

// Items-tab view filters (All/Missing Details/Uncategorized/Low Stock/Out of
// Stock/Hidden/Inactive/Archived). `items` is whatever the endpoint already
// returned for the current view (Archived's own include_archived=true call
// mixes archived in with everything else server-side — filtering down to
// ONLY archived rows happens here).
export function filterItemsByView(items, view) {
  if (view === "archived") return items.filter((it) => it.kind === "physical_product" && it.archived);
  if (view === "missing_details") {
    return items.filter((it) => it.show_online && (it.missing_description || it.missing_image || !it.category_id || it.category_hidden));
  }
  if (view === "low_stock") {
    return items.filter((it) => it.kind === "physical_product" && it.active && it.track_inventory
      && (it.stock_on_hand ?? 0) > STOCK_TOLERANCE && it.low_stock_threshold != null && (it.stock_on_hand ?? 0) <= it.low_stock_threshold);
  }
  if (view === "out_of_stock") {
    return items.filter((it) => it.kind === "physical_product" && it.active && it.track_inventory && (it.stock_on_hand ?? 0) <= STOCK_TOLERANCE);
  }
  if (view === "inactive") return items.filter((it) => !it.active);
  return items;
}

// Online Orders tab — one computed status per order, driving both the
// filters and the status label. Mirrors Front Desk's own Online Orders
// panel logic (Pos.jsx) exactly, so the two admin surfaces never disagree
// about what an order's state actually is.
export function orderRef(o) { return (o.id || "").slice(0, 8).toUpperCase(); }

export function orderComputedStatus(o) {
  const hasPhysical = (o.lines || []).some((l) => l.kind === "product");
  if (o.fulfillment_status === "needs_attention") return "needs_attention";
  if (hasPhysical) {
    if (o.pickup_status === "picked_up") return "picked_up";
    if (o.pickup_status === "ready_for_pickup") return "ready_for_pickup";
    if (o.pickup_status === "preparing") return "preparing";
    return "processing";
  }
  return o.fulfillment_status === "fulfilled" ? "completed" : "processing";
}

export function filterOrdersByView(orders, filter) {
  if (filter === "new") return orders.filter((o) => o.admin_unseen === true);
  if (filter === "open") return orders.filter((o) => ["preparing", "ready_for_pickup", "needs_attention"].includes(orderComputedStatus(o)));
  if (filter === "completed") return orders.filter((o) => ["picked_up", "completed"].includes(orderComputedStatus(o)));
  if (filter !== "all") return orders.filter((o) => orderComputedStatus(o) === filter);
  return orders;
}

export function searchOrders(orders, search) {
  const q = search.trim().toLowerCase();
  if (!q) return orders;
  return orders.filter((o) => (
    (o.client_name || "").toLowerCase().includes(q)
    || orderRef(o).toLowerCase().includes(q)
    || (o.lines || []).some((l) => (l.name || "").toLowerCase().includes(q))
  ));
}
