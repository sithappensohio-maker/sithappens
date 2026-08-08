/* Pure helpers behind the Client Shop polish pass (PortalShop.jsx /
 * ShopItemDetail.jsx) — extracted so the category/sort/stock/status logic
 * can be unit-tested without rendering React or mocking the API. Nothing
 * here talks to the network, mutates stored records, or duplicates the
 * server's own pricing/inventory/fulfillment authority; it only shapes how
 * the client-facing UI reads the catalog/cart/order data it's already given.
 */

// Items scoped to one Shop tab ("all" keeps everything). Online School is a
// presentation-only split of the training_program kind: self-guided courses
// (purchase_fulfillment === "online_school") get their own dedicated section,
// and the plain Training section shows the trainer-led rest. The catalog
// kind ("training_program") — and therefore cart/checkout/detail routing —
// is unchanged; this only decides which tab an item is browsed under.
export function itemsForTab(items, tab) {
  if (tab === "all") return items;
  if (tab === "online_school") {
    return items.filter((i) => i.kind === "training_program" && i.purchase_fulfillment === "online_school");
  }
  if (tab === "training_program") {
    return items.filter((i) => i.kind === "training_program" && i.purchase_fulfillment !== "online_school");
  }
  return items.filter((i) => i.kind === tab);
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

// Shop Appearance & Organization — hardcoded fallback metadata for the 3
// permanent section keys, used whenever shop_page settings are absent or
// incomplete so the Shop always renders something sensible on a fresh
// install. Never let admin config touch these KEYS, only the values below.
const DEFAULT_SECTION_META = {
  merch: { label: "Merch & Gear", description: "", image_id: null, visible: true, order: 0 },
  prepaid_visits: { label: "Prepaid Visits", description: "", image_id: null, visible: true, order: 1 },
  training: { label: "Training", description: "", image_id: null, visible: true, order: 2 },
  online_school: { label: "Online School", description: "Self-guided courses your dog learns at home, at your own pace.", image_id: null, visible: true, order: 3 },
};

// Resolved display metadata for one permanent section key — configured
// shop_page.sections[key] values win, falling back to the hardcoded
// defaults above for anything missing/incomplete. Never reads or returns
// the section's own internal key from settings — callers already know it.
export function sectionMetaFor(sectionKey, shopPage) {
  const fallback = DEFAULT_SECTION_META[sectionKey] || { label: sectionKey, description: "", image_id: null, visible: true, order: 0 };
  const configured = (shopPage && shopPage.sections && shopPage.sections[sectionKey]) || {};
  return {
    label: configured.label || fallback.label,
    description: configured.description ?? fallback.description,
    image_id: configured.image_id ?? fallback.image_id,
    visible: configured.visible !== false,
    order: configured.order ?? fallback.order,
  };
}

// The 3 permanent section keys, filtered to visible and sorted by
// configured order — drives TABS/SectionIndex display order/labels without
// ever touching the permanent key values themselves.
export function visibleSectionsInOrder(shopPage) {
  return Object.keys(DEFAULT_SECTION_META)
    .map((key) => ({ key, ...sectionMetaFor(key, shopPage) }))
    .filter((s) => s.visible)
    .sort((a, b) => a.order - b.order);
}

// Category (or section — see PortalShop.jsx's sectionGroups, which attaches
// a synthetic `category: {image_id}` so this same function covers both)
// cover-image resolution. Wraps, never edits, categoryCoverItem below — its
// existing tests/contract stay unchanged; a configured image always wins
// over any item-based fallback.
export function categoryCoverImageId(group, { preferMobile = false } = {}) {
  const cat = group && group.category;
  if (cat) {
    if (preferMobile && cat.mobile_image_id) return cat.mobile_image_id;
    if (cat.image_id) return cat.image_id;
  }
  const item = categoryCoverItem(group);
  return item ? item.image_id : null;
}

// Whether a category-index card should be hidden because it currently has
// zero matching items — category.hide_when_empty (true/false) overrides the
// global shop_page.hide_empty_categories default; null/undefined defers to
// it. A non-empty group is never hidden regardless of either flag.
export function shouldHideEmptyCategory(group, shopPage) {
  if (!group || group.count > 0) return false;
  const override = (group.category || {}).hide_when_empty;
  if (override === true) return true;
  if (override === false) return false;
  return (shopPage && shopPage.hide_empty_categories) !== false;
}

// Stable partition — featured categories first (preserving their existing
// relative configured order), then the rest (preserving theirs). Never a
// full re-sort, and never changes categoryGroupsForTab's own output order.
export function orderCategoryGroupsFeaturedFirst(groups) {
  const featured = groups.filter((g) => g.category && g.category.is_featured);
  const rest = groups.filter((g) => !(g.category && g.category.is_featured));
  return [...featured, ...rest];
}

// Items flagged featured — backs the "featured_items" shop_page.landing_mode.
// Reuses the exact same `featured` field sortShopItems/categoryCoverItem
// already read, never a second featured-item concept.
export function filterFeaturedItems(items) {
  return items.filter((i) => i.featured);
}

// Public no-account storefront — guest-mode CTA priority for one item, in
// this exact order (per the approved plan): Shopify View Options always
// wins first (it bypasses every other check, including pricing); a
// price-hidden item shows its pricing message next, even if it ALSO
// requires approval/a dog, so the visitor never sees a generic "sign in"
// message that omits why; approval/dog are online-checkout hard-blockers
// framed as "contact us", never "just sign in and you're fine"; any other
// account-required item (credit packs/programs always are) shows sign-in/
// create-account; only then does a normal Add to Cart apply. Reads only
// fields the public catalog/item-detail endpoints already compute
// server-side (account_required, guest_cart_allowed, requires_approval,
// requires_dog) — never re-derives eligibility client-side.
export function guestItemCta(item) {
  if (item.kind === "product" && item.sales_destination === "shopify_external") {
    return { type: "shopify" };
  }
  const hasPrice = item.price != null || item.effective_price != null
    || item.list_price != null || item.shopify_display_price != null;
  if (!hasPrice) return { type: "hidden_price" };
  if (item.requires_approval) return { type: "contact_required", reason: "approval" };
  if (item.requires_dog) return { type: "contact_required", reason: "dog" };
  if (item.account_required) return { type: "sign_in" };
  if (item.kind === "product" && item.guest_cart_allowed) return { type: "add_to_cart" };
  return { type: "sign_in" };
}

// Credit-pack customer-facing wording — the ONE shared source for how a
// pack's display_quantity/display_unit/display_dog_count metadata (or its
// absence) gets turned into words, used by PortalShop.jsx, ShopItemDetail.jsx,
// staff/register screens, and the ShopManager/CreditPacksSettings PackEditor
// preview alike. `qty` (the internal credit count actually granted) is never
// relabeled "visits"/"days" unless display metadata explicitly says so — see
// backend/server.py's CreditPackIn.display_quantity docstring for the
// accounting invariant this wording must never violate.
const CREDIT_PACK_NUMBER_WORDS = { 1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine" };
const numberWord = (n) => CREDIT_PACK_NUMBER_WORDS[n] || String(n);
const pluralizeUnit = (unit, n) => (n === 1 ? unit : `${unit}s`);
const pluralizeCredits = (n) => (n === 1 ? "credit" : "credits");
const money = (n) => `$${Number(n || 0).toFixed(2)}`;
// Trims a trailing ".0"/".50" -> "5"/"1.5" so a whole-number quantity or
// credits-per-unit ratio never renders as "10.0" or "1.50".
const trimNum = (n) => (Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2))));

// Normalizes a catalog/register/public item into the shape every wording
// function below reads. hasDisplay is false whenever display_quantity is
// absent or non-positive — the only signal that decides "days for N dogs"
// vs. the honest "N credits" fallback.
export function creditPackDisplayInfo(item) {
  const qty = Number(item.qty || 0);
  const serviceType = item.service_type || "";
  const displayQuantity = item.display_quantity;
  if (displayQuantity == null || Number(displayQuantity) <= 0) {
    return { hasDisplay: false, qty, serviceType, valueEach: item.value_each };
  }
  return {
    hasDisplay: true,
    qty,
    serviceType,
    quantity: Number(displayQuantity),
    unit: item.display_unit || "unit",
    dogCount: item.display_dog_count != null ? Number(item.display_dog_count) : null,
    pricePerUnit: item.display_price_each != null ? Number(item.display_price_each) : null,
    creditsPerUnit: item.credits_per_display_unit != null ? Number(item.credits_per_display_unit) : null,
  };
}

// Client Shop card/grid line, e.g. "10 daycare days for 2 dogs · $37.50 per
// day", falling back to the accurate "15 daycare credits · $25.00 per
// credit" when no display metadata exists.
export function creditPackCardLine(item) {
  const info = creditPackDisplayInfo(item);
  if (!info.hasDisplay) {
    const base = `${info.qty} ${info.serviceType} ${pluralizeCredits(info.qty)}`.trim();
    return info.valueEach != null ? `${base} · ${money(info.valueEach)} per credit` : base;
  }
  const unitLabel = pluralizeUnit(info.unit, info.quantity);
  const dogPart = info.dogCount != null ? ` for ${info.dogCount} dog${info.dogCount === 1 ? "" : "s"}` : "";
  const pricePart = info.pricePerUnit != null ? ` · ${money(info.pricePerUnit)} per ${info.unit}` : "";
  return `${trimNum(info.quantity)} ${info.serviceType} ${unitLabel}${dogPart}${pricePart}`.trim();
}

// Item-detail page paragraph — explicit about BOTH the customer-facing
// package AND the internal credit balance it adds, e.g. "Includes 10
// daycare days for 2 dogs. This purchase adds 15 daycare credits to your
// account. Each two-dog daycare day uses 1.5 credits." Falls back to the
// same honest "N credits" line as the card when no display metadata exists.
export function creditPackDetailLine(item) {
  const info = creditPackDisplayInfo(item);
  if (!info.hasDisplay) {
    const base = `${info.qty} ${info.serviceType} ${pluralizeCredits(info.qty)}`.trim();
    return info.valueEach != null ? `${base} · ${money(info.valueEach)} per credit` : base;
  }
  const unitLabel = pluralizeUnit(info.unit, info.quantity);
  const dogPart = info.dogCount != null ? ` for ${info.dogCount} dog${info.dogCount === 1 ? "" : "s"}` : "";
  const sentences = [
    `Includes ${trimNum(info.quantity)} ${info.serviceType} ${unitLabel}${dogPart}.`,
    `This purchase adds ${info.qty} ${info.serviceType} ${pluralizeCredits(info.qty)} to your account.`,
  ];
  if (info.creditsPerUnit != null) {
    const dogPrefix = info.dogCount != null ? `${numberWord(info.dogCount)}-dog ` : "";
    sentences.push(`Each ${dogPrefix}${info.serviceType} ${info.unit} uses ${trimNum(info.creditsPerUnit)} credits.`);
  }
  return sentences.join(" ");
}

// Staff/register-facing line — shows both values for clarity, e.g. "10 days
// for 2 dogs · grants 15 daycare credits". Falls back to the plain credit
// count when no display metadata exists (same fallback wording as receipts).
export function creditPackStaffLine(item) {
  const info = creditPackDisplayInfo(item);
  if (!info.hasDisplay) {
    return `${info.qty} ${info.serviceType} ${pluralizeCredits(info.qty)}`.trim();
  }
  const unitLabel = pluralizeUnit(info.unit, info.quantity);
  const dogPart = info.dogCount != null ? ` for ${info.dogCount} dog${info.dogCount === 1 ? "" : "s"}` : "";
  return `${trimNum(info.quantity)} ${unitLabel}${dogPart} · grants ${info.qty} ${info.serviceType} ${pluralizeCredits(info.qty)}`;
}

// Admin/internal editor summary lines — always shows the raw credit values;
// when display metadata exists, ALSO shows the customer package breakdown
// (package day count/price/credits-per-day) right alongside it, never in
// place of it.
export function creditPackAdminSummaryLines(item) {
  const info = creditPackDisplayInfo(item);
  const lines = [`Credits granted: ${info.qty}`];
  if (item.value_each != null) lines.push(`Internal per-credit value: ${money(item.value_each)}`);
  if (info.hasDisplay) {
    const unitLabel = pluralizeUnit(info.unit, info.quantity);
    const dogPart = info.dogCount != null ? ` for ${info.dogCount} dog${info.dogCount === 1 ? "" : "s"}` : "";
    lines.push(`Customer package: ${trimNum(info.quantity)} ${unitLabel}${dogPart}`);
    if (info.pricePerUnit != null) lines.push(`Customer price per package ${info.unit}: ${money(info.pricePerUnit)}`);
    if (info.creditsPerUnit != null) lines.push(`Credits per package ${info.unit}: ${trimNum(info.creditsPerUnit)}`);
  }
  return lines;
}

// PackEditor live preview — computed client-side from the form's raw values
// (qty/price/service_type/display_*) since nothing has been saved yet, so
// there's no server-resolved effective_price to read. Always uses the
// pack's own standard `price` (never a client override — the editor has no
// client context), matching e.g. "Clients receive 10 daycare days for 2
// dogs. The account receives 15 daycare credits. Each two-dog day uses 1.5
// credits. $37.50 per two-dog day." Returns null until a positive
// display_quantity is entered.
export function creditPackEditorPreview(form) {
  const qty = Number(form.qty || 0);
  const price = Number(form.price || 0);
  const serviceType = form.service_type || "";
  const displayQuantity = form.display_quantity;
  if (displayQuantity == null || Number(displayQuantity) <= 0) return null;
  const dq = Number(displayQuantity);
  const unit = form.display_unit || "unit";
  const dogCount = form.display_dog_count != null && form.display_dog_count !== "" ? Number(form.display_dog_count) : null;
  const pricePerUnit = price / dq;
  const creditsPerUnit = qty / dq;
  const unitLabel = pluralizeUnit(unit, dq);
  const dogPart = dogCount != null ? ` for ${dogCount} dog${dogCount === 1 ? "" : "s"}` : "";
  const dogPrefix = dogCount != null ? `${numberWord(dogCount)}-dog ` : "";
  return (
    `Clients receive ${trimNum(dq)} ${serviceType} ${unitLabel}${dogPart}. `
    + `The account receives ${qty} ${serviceType} ${pluralizeCredits(qty)}. `
    + `Each ${dogPrefix}${unit} uses ${trimNum(creditsPerUnit)} credits. `
    + `${money(pricePerUnit)} per ${dogPrefix}${unit}.`
  );
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
