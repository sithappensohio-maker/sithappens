import { API_BASE } from "./api";

/**
 * Shop product image URLs.
 *
 * These are ordinary image URLs, so they go in `src`/`srcset` and the
 * browser treats them like any other picture: it caches them, decodes them
 * natively, and never downloads one twice. That is the whole reason the
 * backend stopped returning base64 inside JSON — a 44-pixel thumbnail was
 * pulling 3.12 MB.
 *
 * Sizes are named for where they are used rather than for their pixel
 * count, so a caller asks for what it is drawing:
 *
 *   thumb  128px   list rows, cart lines
 *   card   400px   catalog cards, search results
 *   pdp    900px   the product page
 *   zoom  1600px   full-screen view, only when asked for
 */
export const SHOP_IMAGE_SIZES = { thumb: 128, card: 400, pdp: 900, zoom: 1600 };

/** One image URL. Returns null when there is no image, so callers can fall
 *  through to their placeholder without a broken request. */
export function shopImageUrl(mediaId, size = "card", { public: isPublic = false } = {}) {
  if (!mediaId) return null;
  const name = SHOP_IMAGE_SIZES[size] ? size : "card";
  const prefix = isPublic ? "/public/shop/media" : "/shop/media";
  return `${API_BASE}${prefix}/${encodeURIComponent(mediaId)}/${name}`;
}

/**
 * A `srcset` offering the browser the sizes that make sense for this
 * surface, so a retina card takes the 400px file and an ordinary one takes
 * the 128px file — the browser decides, using the real pixel widths.
 */
export function shopImageSrcSet(mediaId, sizes, opts) {
  if (!mediaId) return undefined;
  const names = (sizes || []).filter((s) => SHOP_IMAGE_SIZES[s]);
  if (names.length < 2) return undefined;
  return names
    .map((s) => `${shopImageUrl(mediaId, s, opts)} ${SHOP_IMAGE_SIZES[s]}w`)
    .join(", ");
}

/**
 * Everything an <img> needs for a given surface, in one call.
 *
 * `eager` exists for the one image that must NOT be lazy: the product page
 * hero is the largest contentful paint on that page, and deferring it makes
 * the page measurably slower to feel ready. Everything below the fold is
 * lazy.
 */
export function shopImageProps(mediaId, surface = "card", { public: isPublic = false } = {}) {
  const plan = {
    thumb: { size: "thumb", set: ["thumb", "card"], sizes: "64px", eager: false },
    card: { size: "card", set: ["thumb", "card"], sizes: "(max-width: 640px) 45vw, 320px", eager: false },
    pdp: { size: "pdp", set: ["card", "pdp"], sizes: "(max-width: 900px) 100vw, 560px", eager: true },
    zoom: { size: "zoom", set: ["pdp", "zoom"], sizes: "100vw", eager: true },
  }[surface] || { size: "card", set: ["thumb", "card"], sizes: "320px", eager: false };

  const src = shopImageUrl(mediaId, plan.size, { public: isPublic });
  if (!src) return null;
  return {
    src,
    srcSet: shopImageSrcSet(mediaId, plan.set, { public: isPublic }),
    sizes: plan.sizes,
    loading: plan.eager ? "eager" : "lazy",
    // `async` lets the browser decode off the main thread; the hero is
    // decoded synchronously so it paints with the rest of the page.
    decoding: plan.eager ? "sync" : "async",
    fetchPriority: plan.eager ? "high" : "auto",
  };
}

/**
 * Every image on a catalog item, primary first.
 *
 * Mirrors the server's own rule (domains/shop/media.gallery_ids): a product
 * from before galleries existed has only `image_id` and reads back as a
 * one-image gallery, so every caller can be written against galleries alone
 * and nothing legacy needs migrating.
 */
export function galleryIds(item) {
  if (!item) return [];
  const ids = (item.image_ids || []).filter(Boolean).map(String);
  if (ids.length) return [...new Set(ids)];
  return item.image_id ? [String(item.image_id)] : [];
}

export function primaryImageId(item) {
  return galleryIds(item)[0] || null;
}
