import { socialImageUrl } from "./useDocumentMeta";

/**
 * The words that go in a tab, a search result and a shared link.
 *
 * Shared by the storefront and the product page, and written to match the
 * server's version byte for byte (backend `domains/shop/seo.py`) — because
 * a crawler that renders JavaScript sees this one, a link-preview bot sees
 * that one, and the two saying different things about the same page is the
 * kind of inconsistency search engines notice.
 *
 * Every description here comes from real item data. There is no fallback
 * that invents a marketing claim: where nobody has written a description,
 * the text says what the thing IS, not how good it is.
 */

/** The five departments, as a stranger searching the web would name them. */
export const DEPARTMENT_SEO = {
  gear: ["Dog Training Gear", "Leads, harnesses and the kit we actually use."],
  training: ["Dog Training Programs", "Work with a trainer, in person."],
  online_school: ["Online Dog Training School", "Guided courses you work through at home."],
  prepaid: ["Prepaid Daycare Visits", "Buy visits up front, use them whenever."],
  gift_cards: ["Gift Cards", "Emailed straight through. Spend it on anything."],
};

const MAX_DESCRIPTION = 300;

/** Plain words out of whatever an admin typed: tags stripped, whitespace
 *  collapsed, clipped at a word rather than mid-syllable. */
export function plainText(value, limit = MAX_DESCRIPTION) {
  if (typeof value !== "string") return "";
  const text = value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, limit).replace(/\s+\S*$/, "").replace(/[,.;:—-]+$/, "")}…`;
}

export function siteName(shopPage = {}) {
  return plainText(shopPage.business_name, 60) || "Sit Happens";
}

/** The storefront, or one department. */
export function shopMetaFor({ department, shopPage = {}, origin = "" }) {
  const site = siteName(shopPage);
  const [label, tagline] = DEPARTMENT_SEO[department] || [];
  if (label) {
    return {
      title: `${label} | ${site}`,
      description: tagline,
      canonical: `${origin}/shop?dept=${encodeURIComponent(department)}`,
      ogType: "website",
    };
  }
  return {
    title: `Shop | ${site}`,
    // The owner's own subtitle where they have written one — never a claim
    // invented on their behalf.
    description: plainText(shopPage.subtitle)
      || `Training gear, programs and prepaid visits from ${site}.`,
    canonical: `${origin}/shop`,
    ogType: "website",
  };
}

/**
 * One product, course, pack or gift card.
 *
 * The description prefers what the admin wrote for the shop, then the
 * general description, then what a programme says it helps with, and only
 * then a plain factual sentence. The image is the PDP derivative, never the
 * thumbnail: a 128px square stretched across a social card looks broken.
 */
export function itemMetaFor(item, { shopPage = {}, origin = "", isPublic = true } = {}) {
  if (!item) return { title: null };
  const site = siteName(shopPage);
  const name = plainText(item.name, 120);
  const helps = (item.helps_with || []).filter((h) => typeof h === "string").slice(0, 3);
  const description = plainText(item.online_description)
    || plainText(item.description)
    || (helps.length ? `Training for ${helps.join(", ").toLowerCase()}.` : "")
    || `${name} from ${site}.`;
  return {
    title: `${name} | ${site}`,
    description,
    canonical: `${origin}/shop/item/${encodeURIComponent(item.kind)}/${encodeURIComponent(item.id)}`,
    image: socialImageUrl(item.image_id || (item.image_ids || [])[0], origin),
    ogType: "product",
    // An account-only item has no business in a search result. `noindex`
    // here is the last of three defences, after the sitemap that never
    // lists it and the public meta route that 404s for it.
    noindex: !isPublic || item.publicly_visible === false,
  };
}

// ── truthful badges ─────────────────────────────────────────────────────

/**
 * How new is New.
 *
 * Fourteen days from the day the item actually went on the shelf, and only
 * when the catalog gives us such a day. `listed_on` is the server's own
 * derived date — the raw created_at timestamp is admin bookkeeping and is
 * deliberately not in the customer-facing catalog. No date, no badge:
 * "probably new" is not a thing to tell a customer.
 */
export const NEW_FOR_DAYS = 14;

export function isNew(item, now = Date.now()) {
  const raw = item?.listed_on || item?.published_at;
  if (typeof raw !== "string" || !raw) return false;
  const created = Date.parse(raw);
  if (!Number.isFinite(created)) return false;
  const age = now - created;
  // A future timestamp is bad data, not a brand-new product.
  if (age < 0) return false;
  return age <= NEW_FOR_DAYS * 24 * 60 * 60 * 1000;
}
