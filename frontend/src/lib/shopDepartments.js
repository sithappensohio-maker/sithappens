import { isNew } from "./shopSeo";
/**
 * What the Shop sells, arranged the way a customer thinks about it.
 *
 * The old Shop had tabs named after database kinds — `product`,
 * `credit_pack`, `training_program` — and put all twenty-three things in one
 * flat grid underneath them. That is a filter, not a shop. Nobody walks into
 * a store looking for a "credit_pack".
 *
 * A DEPARTMENT is the customer-facing idea: Gear, Training, Online School,
 * Prepaid Visits, Gift Cards. It maps onto the kinds underneath, but it also
 * carries how that department should be PRESENTED — because a hoodie and a
 * fourteen-day board-and-train are not the same kind of purchase and should
 * not be sold with the same card.
 *
 * Everything here is a pure function of the catalog the server already
 * sends. No new endpoint, no second source of truth: the same
 * `/shop/catalog` and `/public/shop/catalog` payloads, read differently.
 */

/**
 * `layout` is the promise each department makes about its own presentation:
 *
 *   grid      photography first, many per row — you are browsing objects
 *   editorial wide, explanatory — you are deciding on a service
 *   value     comparison — you are working out which pack is worth it
 *   gift      a present, not a product
 */
export const DEPARTMENTS = [
  {
    key: "gear",
    label: "Gear",
    tagline: "Leads, harnesses and the kit we actually use.",
    layout: "grid",
    kinds: ["product"],
    section: "merch",
  },
  {
    key: "training",
    label: "Training",
    tagline: "Work with a trainer, in person.",
    layout: "editorial",
    kinds: ["training_program"],
    section: "training",
    match: (i) => i.purchase_fulfillment !== "online_school",
  },
  {
    key: "online_school",
    label: "Online School",
    tagline: "Guided courses you work through at home.",
    layout: "editorial",
    kinds: ["training_program"],
    section: "training",
    match: (i) => i.purchase_fulfillment === "online_school",
  },
  {
    key: "prepaid",
    label: "Prepaid Visits",
    tagline: "Buy visits up front, use them whenever.",
    layout: "value",
    kinds: ["credit_pack"],
    section: "prepaid_visits",
  },
  {
    key: "gift_cards",
    label: "Gift Cards",
    tagline: "Emailed straight through. Spend it on anything.",
    layout: "gift",
    kinds: ["gift_card"],
    // Deliberately no `section`: a gift card is money, not a department of
    // the business, and it is not hidden when a section is switched off.
    section: null,
  },
];

export function departmentByKey(key) {
  return DEPARTMENTS.find((d) => d.key === key) || null;
}

/**
 * The old `?section=` links still work.
 *
 * Before departments existed the Shop used the backend's SECTION vocabulary
 * in its URLs — `?section=merch`, `?section=online_school`. Those links are
 * out in the world: in emails, in the public site, possibly bookmarked. A
 * redesign is not a reason to break somebody's bookmark, so a section name
 * resolves to the department that replaced it.
 *
 * `online_school` was never a real section — it was a pseudo-tab — but it
 * appeared in links all the same, so it is mapped here too.
 */
const SECTION_ALIASES = {
  merch: "gear",
  training: "training",
  prepaid_visits: "prepaid",
  online_school: "online_school",
};

export function resolveDepartmentParam(params) {
  if (!params) return null;
  const get = typeof params.get === "function" ? (k) => params.get(k) : (k) => params[k];
  const direct = get("dept");
  if (departmentByKey(direct)) return direct;
  const legacy = SECTION_ALIASES[get("section")] || SECTION_ALIASES[get("tab")];
  return departmentByKey(legacy) ? legacy : null;
}

/** Which department a catalog item belongs in. One department, never two. */
export function departmentForItem(item) {
  if (!item) return null;
  return DEPARTMENTS.find(
    (d) => d.kinds.includes(item.kind) && (!d.match || d.match(item)),
  ) || null;
}

export function itemsInDepartment(items, key) {
  const dept = departmentByKey(key);
  if (!dept) return items || [];
  return (items || []).filter((i) => departmentForItem(i)?.key === key);
}

/**
 * The departments worth showing: the ones with something in them.
 *
 * An empty department is a dead end, and a shop that lists five and fills two
 * looks broken rather than well-stocked. `sectionVisible` lets the admin's
 * existing section switches keep working — it is asked, not second-guessed.
 */
export function visibleDepartments(items, { sectionVisible } = {}) {
  return DEPARTMENTS
    .map((d) => ({ ...d, count: itemsInDepartment(items, d.key).length }))
    .filter((d) => d.count > 0)
    .filter((d) => !d.section || !sectionVisible || sectionVisible(d.section));
}

// ─────────────────────────────────────────────────────────────── searching

/**
 * Fields a shopper could plausibly be typing.
 *
 * Deliberately a short list. Searching every field would match on internal
 * ids and admin notes, and "why did that come up?" is worse than "no
 * results" — see the test that pins the admin-only fields OUT.
 */
const SEARCH_FIELDS = [
  "name", "description", "online_description", "category_name",
  "subcategory_name", "focus", "service_type",
];

const norm = (s) => String(s == null ? "" : s).toLowerCase();

export function searchItems(items, query) {
  const q = norm(query).trim();
  if (!q) return items || [];
  const terms = q.split(/\s+/).filter(Boolean);
  return (items || []).filter((item) => {
    const hay = [
      ...SEARCH_FIELDS.map((f) => norm(item[f])),
      ...(item.helps_with || []).map(norm),
    ].join(" ");
    // Every term must appear, so a second word narrows rather than widens.
    return terms.every((t) => hay.includes(t));
  });
}

// ──────────────────────────────────────────────────────────────── sorting

const priceOf = (i) => Number(i.effective_price ?? i.price ?? i.list_price ?? 0);
// The day the catalog says the item was listed. Items without one sort
// last under "Newest" rather than jumping to the front.
const createdOf = (i) => String(i.listed_on || "");

/**
 * Sorts, each with a deterministic tie-break on name then id.
 *
 * Without the tie-break, two £24 leads swap places between renders and the
 * grid visibly shuffles while you are looking at it.
 */
export const SORTS = [
  {
    key: "featured",
    label: "Featured",
    compare: (a, b) =>
      Number(!!b.featured) - Number(!!a.featured)
      || (a.sort_order ?? 9999) - (b.sort_order ?? 9999),
  },
  { key: "newest", label: "Newest", compare: (a, b) => createdOf(b).localeCompare(createdOf(a)) },
  { key: "price_asc", label: "Price: Low to High", compare: (a, b) => priceOf(a) - priceOf(b) },
  { key: "price_desc", label: "Price: High to Low", compare: (a, b) => priceOf(b) - priceOf(a) },
];
// Deliberately absent: "Best Selling". There is no sales data yet, and a
// sort order invented from nothing is a lie told in a dropdown.

export function sortItems(items, sortKey) {
  const sort = SORTS.find((s) => s.key === sortKey) || SORTS[0];
  return [...(items || [])].sort(
    (a, b) => sort.compare(a, b)
      || String(a.name || "").localeCompare(String(b.name || ""))
      || String(a.id || "").localeCompare(String(b.id || "")),
  );
}

// ────────────────────────────────────────────────────────────── filtering

/**
 * Only offer a filter that would actually divide what is on screen.
 *
 * A category filter listing one category, or an availability filter when
 * everything is in stock, is a control that can only ever do nothing. The
 * brief asks for no twelve filters over six products; this is how that is
 * enforced rather than remembered.
 */
export function availableFilters(items) {
  const list = items || [];
  const categories = [];
  for (const i of list) {
    if (i.category_id && !categories.some((c) => c.id === i.category_id)) {
      categories.push({ id: i.category_id, name: i.category_name || "Other" });
    }
  }
  const prices = list.map(priceOf).filter((n) => n > 0);
  const anyOutOfStock = list.some((i) => i.availability === "out_of_stock" || i.in_stock === false);
  return {
    categories: categories.length > 1 ? categories.sort((a, b) => a.name.localeCompare(b.name)) : [],
    availability: anyOutOfStock,
    priceRange: prices.length > 1
      ? { min: Math.floor(Math.min(...prices)), max: Math.ceil(Math.max(...prices)) }
      : null,
  };
}

export const EMPTY_FILTERS = { categoryId: null, availability: "any", maxPrice: null };

export function applyFilters(items, filters) {
  const f = { ...EMPTY_FILTERS, ...(filters || {}) };
  return (items || []).filter((i) => {
    if (f.categoryId && i.category_id !== f.categoryId) return false;
    if (f.availability === "in_stock"
        && (i.availability === "out_of_stock" || i.in_stock === false)) return false;
    if (f.maxPrice != null && priceOf(i) > f.maxPrice) return false;
    return true;
  });
}

export function activeFilterCount(filters) {
  const f = { ...EMPTY_FILTERS, ...(filters || {}) };
  return [f.categoryId, f.availability !== "any" ? f.availability : null, f.maxPrice]
    .filter((v) => v != null).length;
}

/** Search, then filter, then sort — in that order, so sorting applies to
 *  what is actually on screen rather than to the whole catalog. */
export function browseItems(items, { department, query, filters, sort } = {}) {
  let list = department ? itemsInDepartment(items, department) : (items || []);
  list = searchItems(list, query);
  list = applyFilters(list, filters);
  return sortItems(list, sort);
}

// ─────────────────────────────────────────────────────────────────  badges

/**
 * Badges, and only badges we can prove.
 *
 * No "Best Seller" (no sales data), no "Only 2 left!" urgency theatre. Low
 * stock is shown because it is genuinely useful when it is genuinely true,
 * and `low_stock` is a state the server already computes.
 */
export function badgesFor(item, { bestSellerIds } = {}) {
  if (!item) return [];
  const out = [];
  // Three badges that mean three different things, and must never be
  // confused with one another:
  //
  //   Featured     the operator chose this. An opinion, honestly labelled.
  //   Best Seller  the ORDERS say so. Nobody can set it by hand; it comes
  //                from the server's own rule (top 5 by units in 30 days,
  //                minimum 5 units) and is absent when the shop has not
  //                sold enough for it to mean anything.
  //   New          added within the last two weeks, from a real timestamp.
  //                An item with no reliable date gets no badge rather than
  //                a guessed one.
  //
  // At most one of Best Seller and Featured shows, and Best Seller wins:
  // "other people bought this" is a stronger and more useful claim than
  // "we picked this".
  if (bestSellerIds && bestSellerIds.has(item.id)) {
    out.push({ key: "best_seller", label: "Best Seller", tone: "primary" });
  } else if (item.featured) {
    out.push({ key: "featured", label: "Featured", tone: "primary" });
  }
  if (isNew(item)) out.push({ key: "new", label: "New", tone: "secondary" });
  if (item.availability === "out_of_stock" || item.in_stock === false) {
    out.push({ key: "sold_out", label: "Sold out", tone: "muted" });
  } else if (item.availability === "low_stock") {
    out.push({ key: "low_stock", label: "Low stock", tone: "warn" });
  }
  return out;
}

/**
 * What a prepaid pack is worth per visit — and, only when the catalog can
 * actually prove it, what that saves.
 *
 * `baseline` is the price of one visit bought normally. If it is missing or
 * not bigger than the per-visit price, no saving is claimed: an invented
 * discount is worse than no discount, and this is the function that refuses
 * to invent one.
 */
export function packValue(item, baseline) {
  const qty = Number(item?.display_quantity ?? item?.qty ?? 0);
  const total = priceOf(item);
  if (!qty || !total) return null;
  const each = total / qty;
  const base = Number(baseline || 0);
  const savingPct = base > each ? Math.round(((base - each) / base) * 100) : null;
  return {
    quantity: qty,
    unit: item.display_unit || "visits",
    total,
    each: Math.round(each * 100) / 100,
    savingPct,
    savingTotal: savingPct ? Math.round((base - each) * qty * 100) / 100 : null,
  };
}
