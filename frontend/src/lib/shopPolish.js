/* Pure helpers behind the Client Shop polish pass (PortalShop.jsx /
 * ShopItemDetail.jsx) — extracted so the category/sort/stock/status logic
 * can be unit-tested without rendering React or mocking the API. Nothing
 * here talks to the network, mutates stored records, or duplicates the
 * server's own pricing/inventory/fulfillment authority; it only shapes how
 * the client-facing UI reads the catalog/cart/order data it's already given.
 */

// Items scoped to one Shop tab ("all" keeps everything).
export function itemsForTab(items, tab) {
  return tab === "all" ? items : items.filter((i) => i.kind === tab);
}

// Shared by categoryOptionsForTab and categoryGroupsForTab below — pairs
// each configured category with the items (in this tab) actually assigned
// to it, dropping any category with none. Internal only: callers that need
// the Other bucket too should go through categoryGroupsForTab instead.
function realCategoryGroupsForTab(categories, items, tab) {
  const scoped = itemsForTab(items, tab);
  return categories
    .map((category) => ({ category, items: scoped.filter((i) => i.category_id === category.id) }))
    .filter((g) => g.items.length > 0);
}

// Category choices for a tab — only categories that actually contain at
// least one item belonging to that tab, derived from the already-loaded
// catalog (never a second taxonomy fetch/filter system).
export function categoryOptionsForTab(categories, items, tab) {
  return realCategoryGroupsForTab(categories, items, tab).map((g) => g.category);
}

// Synthetic id for the generated "Other" bucket that holds visible items
// with no category assigned — never written back to any stored record, it
// only exists for client-side grouping/navigation.
export const OTHER_CATEGORY_ID = "__other__";

// Visible items in a tab that have no category assigned at all.
export function uncategorizedItemsForTab(items, tab) {
  return itemsForTab(items, tab).filter((i) => !i.category_id);
}

// Category-card groups for the Shop's category-index screen: one entry per
// configured category that has a matching item in this tab (kept in the
// taxonomy's own configured order — categories is already sorted by
// sort_order from GET /shop/catalog/taxonomy), plus a generated "Other"
// entry appended at the end for any uncategorized visible items. Each group
// carries its category record, the matching items, and a count — enough
// for both the card (name/description/count/cover) and the product grid
// underneath it without a second API request per category.
export function categoryGroupsForTab(categories, items, tab) {
  const groups = realCategoryGroupsForTab(categories, items, tab).map((g) => ({ ...g, count: g.items.length }));
  const other = uncategorizedItemsForTab(items, tab);
  if (other.length > 0) {
    groups.push({
      category: { id: OTHER_CATEGORY_ID, name: "Other", description: null, subcategories: [] },
      items: other,
      count: other.length,
    });
  }
  return groups;
}

// A category card's representative thumbnail: the first featured item (an
// admin's explicit "show this one" signal, even if it has no image of its
// own — the card still falls back to the placeholder for it), otherwise the
// first item that actually has an image, otherwise null (renders the
// existing ItemThumbnail placeholder, never a second placeholder image).
export function categoryCoverItem(group) {
  const items = (group && group.items) || [];
  const featured = items.find((i) => i.featured);
  if (featured) return featured;
  return items.find((i) => i.image_id) || null;
}

// Subcategory choices for a tab + selected category — same "must have a
// matching visible item" rule, one level deeper.
export function subcategoryOptionsForTab(categories, items, tab, categoryId) {
  const category = categories.find((c) => c.id === categoryId);
  if (!category) return [];
  const scoped = itemsForTab(items, tab).filter((i) => i.category_id === categoryId);
  const idsWithItems = new Set(scoped.map((i) => i.subcategory_id).filter(Boolean));
  return (category.subcategories || []).filter((s) => idsWithItems.has(s.id));
}

// What the category/subcategory filters should become after switching tabs —
// clears whichever no longer has any matching item in the new tab, rather
// than silently keeping a filter that can never match anything.
export function nextFiltersForTab(items, tab, categoryFilter, subcategoryFilter) {
  if (!categoryFilter) return { categoryFilter: "", subcategoryFilter: "" };
  if (categoryFilter === OTHER_CATEGORY_ID) {
    // The generated "Other" bucket isn't a real category_id on any item, so
    // it can never appear in the catIds set below — validity means "this
    // tab still has at least one uncategorized visible item", not membership.
    return uncategorizedItemsForTab(items, tab).length > 0
      ? { categoryFilter, subcategoryFilter: "" }
      : { categoryFilter: "", subcategoryFilter: "" };
  }
  const scoped = itemsForTab(items, tab);
  const catIds = new Set(scoped.map((i) => i.category_id).filter(Boolean));
  if (!catIds.has(categoryFilter)) return { categoryFilter: "", subcategoryFilter: "" };
  if (!subcategoryFilter) return { categoryFilter, subcategoryFilter: "" };
  const subIds = new Set(scoped.filter((i) => i.category_id === categoryFilter).map((i) => i.subcategory_id).filter(Boolean));
  return { categoryFilter, subcategoryFilter: subIds.has(subcategoryFilter) ? subcategoryFilter : "" };
}

// Featured first, then each item's configured sort_order (credit packs and
// training programs have no such field today, so they fall back to "no
// preference" and settle on the name tiebreaker), then name A-Z. Display-only
// — never rewrites stored records.
export function sortShopItems(list) {
  return [...list].sort((a, b) => {
    const fa = a.featured ? 0 : 1, fb = b.featured ? 0 : 1;
    if (fa !== fb) return fa - fb;
    const soa = a.sort_order ?? Infinity, sob = b.sort_order ?? Infinity;
    if (soa !== sob) return soa - sob;
    return (a.name || "").localeCompare(b.name || "");
  });
}

// Whether an item matches a free-text shop search — name, description,
// category name, and subcategory name. An empty/blank query matches
// everything, so callers can always run this unconditionally instead of
// branching on "is there a search term". Extracted from PortalShop.jsx's
// inline filter so it's covered by these unit tests without rendering.
export function matchesSearchQuery(item, query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return true;
  return (
    (item.name || "").toLowerCase().includes(q)
    || (item.description || "").toLowerCase().includes(q)
    || (item.category_name || "").toLowerCase().includes(q)
    || (item.subcategory_name || "").toLowerCase().includes(q)
  );
}

// Singularizes a unit word ("sessions" -> "session", "classes" -> "class")
// for the "$X.XX per <unit>" price-per-unit display — a light heuristic, not
// a full pluralization library, since program format_unit values are a small
// fixed vocabulary configured by admins.
export function singularUnit(unit) {
  if (!unit) return unit;
  if (/ies$/i.test(unit)) return unit.replace(/ies$/i, "y");
  if (/(sh|ch|ss|x|z)es$/i.test(unit)) return unit.replace(/es$/i, "");
  if (/s$/i.test(unit) && !/ss$/i.test(unit)) return unit.replace(/s$/i, "");
  return unit;
}

// Stock-safe cart quantities — the backend remains the final authority on
// inventory (this never replaces server-side validation), but the client
// shouldn't knowingly let someone add more of a tracked internal product
// than actually exists. Returns null for anything that isn't an
// inventory-tracked internal product (unlimited from the client's point of
// view).
export function stockCeiling(item) {
  if (!item || item.kind !== "product" || item.sales_destination === "shopify_external" || !item.track_inventory) return null;
  return Math.max(0, Math.floor(item.stock_on_hand ?? 0));
}

// Internal (Sit Happens-fulfilled) physical products need pickup messaging;
// credit packs, training programs, and Shopify-linked merchandise never do —
// Shopify owns its own checkout/shipping entirely.
export function isInternalPhysical(item) {
  return !!item && item.kind === "product" && item.sales_destination !== "shopify_external";
}

// My Orders — exact customer-facing status label mapping. Reads only the
// safe fields GET /portal/shop-orders already returns (status,
// fulfillment_status, pickup_status, lines[].kind) — never anything that
// would need Stripe ids/payment-attempt/reservation internals.
export function orderStatusLabel(o) {
  if (o.status === "pending_payment") return "Payment Processing";
  if (o.status === "payment_failed" || o.status === "canceled") return "Not Completed";
  if (o.status !== "paid") return "Payment Processing";
  if (o.fulfillment_status === "needs_attention") return "Needs Attention";
  const hasPhysical = (o.lines || []).some((l) => l.kind === "product");
  if (!hasPhysical) return o.fulfillment_status === "fulfilled" ? "Completed" : "Payment Processing";
  if (o.pickup_status === "picked_up") return "Picked Up";
  if (o.pickup_status === "ready_for_pickup") return "Ready for Pickup";
  if (o.pickup_status === "preparing") return "Preparing for Pickup";
  return "Payment Processing";
}
