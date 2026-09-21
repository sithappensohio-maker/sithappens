import { useEffect } from "react";

/**
 * The tab title and the tags in `<head>`, for the app as people actually use it.
 *
 * This is the SECOND half of the metadata story, and it is important to be
 * clear about which half. A social preview bot never runs this code: it
 * fetches the URL once and reads the bytes, so the tags it sees come from
 * the server-rendered document (backend `domains/shop/seo.py`, routed by
 * nginx). What this hook is for is everything else — the browser tab, the
 * PWA, a bookmark, and Googlebot, which does execute JavaScript and will
 * pick these up on the rendered page.
 *
 * Both halves say the same thing, from the same catalogue. If they ever
 * disagree that is a bug, not a strategy.
 *
 * Every tag it adds is removed again when the page changes, so navigating
 * from a product to the shop does not leave the product's description
 * behind on a page it does not describe.
 */

const MANAGED = "data-sh-meta";

function upsert(selector, create) {
  let el = document.head.querySelector(selector);
  if (!el) {
    el = create();
    el.setAttribute(MANAGED, "1");
    document.head.appendChild(el);
  }
  return el;
}

function setMeta(attr, key, content) {
  if (!content) return;
  const el = upsert(`meta[${attr}="${key}"]`, () => {
    const m = document.createElement("meta");
    m.setAttribute(attr, key);
    return m;
  });
  el.setAttribute("content", content);
}

/**
 * @param {object} meta
 * @param {string} meta.title      the whole document title, already branded
 * @param {string} [meta.description]
 * @param {string} [meta.canonical] absolute URL
 * @param {string} [meta.image]     absolute URL, PDP-sized not thumb-sized
 * @param {boolean} [meta.noindex]  for account-only pages
 * @param {boolean} [meta.enabled]  false leaves the document alone entirely
 */
export function useDocumentMeta({ title, description, canonical, image,
                                  noindex = false, ogType = "website", enabled = true }) {
  useEffect(() => {
    if (!enabled || typeof document === "undefined" || !title) return undefined;
    const previousTitle = document.title;
    document.title = title;

    setMeta("name", "description", description);
    setMeta("property", "og:title", title);
    setMeta("property", "og:description", description);
    setMeta("property", "og:type", ogType);
    setMeta("property", "og:url", canonical);
    setMeta("property", "og:image", image);
    setMeta("name", "twitter:card", image ? "summary_large_image" : "summary");
    setMeta("name", "twitter:title", title);
    setMeta("name", "twitter:description", description);
    setMeta("name", "twitter:image", image);
    // An account-only page must say so even here. It is not the primary
    // defence — such pages are absent from the sitemap and refused by the
    // public meta route — but a crawler that renders JavaScript and finds
    // one anyway should be told plainly.
    setMeta("name", "robots", noindex ? "noindex, nofollow" : "index, follow");

    if (canonical) {
      const link = upsert('link[rel="canonical"]', () => {
        const l = document.createElement("link");
        l.setAttribute("rel", "canonical");
        return l;
      });
      link.setAttribute("href", canonical);
    }

    return () => {
      document.title = previousTitle;
      // Only tags this hook created are removed. A tag that shipped in
      // index.html is the app's own and is left exactly where it was.
      document.head.querySelectorAll(`[${MANAGED}]`).forEach((el) => el.remove());
    };
  }, [title, description, canonical, image, noindex, ogType, enabled]);
}

/** The public origin, for canonical URLs. Falls back to the current origin,
 *  which is right in every environment this app actually runs in. */
export function publicOrigin() {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

/**
 * The image a social card should use.
 *
 * The `pdp` derivative, never `thumb`: a 128px square stretched across a
 * Facebook card looks like a mistake, and the bigger file already exists.
 * The PUBLIC media route, because whoever renders the card has no session.
 */
export function socialImageUrl(imageId, origin = publicOrigin()) {
  if (!imageId) return null;
  return `${origin}/api/public/shop/media/${encodeURIComponent(imageId)}/pdp`;
}
