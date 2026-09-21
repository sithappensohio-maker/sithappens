import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { shopImageProps, shopImageUrl, primaryImageId } from "../lib/shopImage";

/**
 * Legacy image-resolution hook — kept for callers that genuinely need the
 * image BYTES rather than a URL (the Shop Manager upload preview shows a
 * file that is not on any product yet, so it has no servable URL).
 *
 * Nothing that merely DISPLAYS a catalog image should use this any more:
 * it fetches a base64 data URL inside JSON, which is what made a 44-pixel
 * thumbnail cost 3.12 MB. Use `shopImageUrl`/`shopImageProps` instead, so
 * the browser fetches a real image it can cache.
 */
export function useShopMediaSrc(imageId, { public: isPublic = false } = {}) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    if (!imageId) { setSrc(null); return; }
    let cancelled = false;
    const url = isPublic ? `/public/shop/media/${imageId}` : `/shop/media/${imageId}`;
    api.get(url)
      .then(({ data }) => { if (!cancelled) setSrc(data.data); })
      .catch(() => { if (!cancelled) setSrc(null); });
    return () => { cancelled = true; };
  }, [imageId, isPublic]);
  return src;
}

/**
 * The ONE shared item-image thumbnail. Reused by the POS register grid,
 * Shop Manager's Items table, Shop Manager's Categories & Layout item
 * lists, and the client Shop, so there is never a second copy of this
 * render logic.
 *
 * `variant="square"` (default) — a small fixed square, sized via `size`
 * (px, default 44 — the "beside the name" thumbnail used in lists/tables).
 * `variant="banner"` — a full-width, fixed-height rectangle (the POS
 * register tile / client Shop card image). Both variants reserve their
 * exact box size up front via inline width/height (never intrinsic), so
 * nothing shifts layout while the image is still loading or if it's
 * missing entirely.
 *
 * `surface` picks which derivative to request. A 44px row asks for the
 * 128px file, not the 1600px one.
 */
export default function ItemThumbnail({
  imageId, alt, size = 44, variant = "square", fit = "cover", className = "",
  public: isPublic = false, surface,
}) {
  const isBanner = variant === "banner";
  const chosen = surface || (isBanner ? "card" : "thumb");
  const img = shopImageProps(imageId, chosen, { public: isPublic });
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [imageId]);
  // The fast image route serves PUBLICLY VISIBLE catalog imagery only. An
  // account-only product's photo 404s there by design, so those fall back
  // to the authenticated route — the same one this component used before
  // the pipeline existed. Slower, but only for the few items it applies to,
  // and it means tightening the rule broke nothing.
  const fallback = useShopMediaSrc(failed ? imageId : null, { public: isPublic });

  const boxStyle = isBanner
    ? { height: size, width: "100%" }
    : { width: size, height: size, minWidth: size, minHeight: size };
  const shapeClass = isBanner ? "w-full" : "shrink-0";
  // fit="contain" letterboxes instead of cropping — for surfaces where the
  // whole product image must stay readable (e.g. the register grid, where
  // labels/banners carry the product's identity). The faint backdrop keeps
  // the unused gutter looking intentional rather than broken.
  const fitClass = fit === "contain" ? "object-contain bg-black/25" : "object-cover";

  if (img && !failed) {
    return (
      <img {...img} alt={alt || ""} style={boxStyle}
           onError={() => setFailed(true)}
           data-testid="item-thumbnail-img"
           className={`${shapeClass} rounded-md border border-shBorder ${fitClass} ${className}`} />
    );
  }
  if (fallback) {
    return (
      <img src={fallback} alt={alt || ""} style={boxStyle}
           data-testid="item-thumbnail-fallback"
           className={`${shapeClass} rounded-md border border-shBorder ${fitClass} ${className}`} />
    );
  }
  return (
    <div style={boxStyle} data-testid="item-thumbnail-placeholder"
         className={`${shapeClass} rounded-md border border-shBorder grid place-items-center text-shTextMuted ${className}`}>
      <i className={`fas fa-image ${isBanner ? "text-lg" : "text-[11px]"}`} />
    </div>
  );
}

/** A catalog item's primary image, however that item stores it. Saves every
 *  caller from repeating the gallery-or-legacy-field dance. */
export function ItemImage({ item, ...rest }) {
  return <ItemThumbnail imageId={primaryImageId(item)} {...rest} />;
}

export { shopImageUrl };
