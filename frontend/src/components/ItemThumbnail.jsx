import { useEffect, useState } from "react";
import { api } from "../lib/api";

/**
 * The ONE shared image-resolution hook. Physical products, credit packs,
 * and training programs all store only an `image_id` — this is the single
 * place that fetches GET /shop/media/{id}, reused by ItemThumbnail below
 * and by the client Shop's item-detail hero image/lightbox, so there is
 * never a second copy of this fetch-by-id logic.
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
 * fetch-by-id + render logic.
 *
 * `variant="square"` (default) — a small fixed square, sized via `size`
 * (px, default 44 — the "beside the name" thumbnail used in lists/tables).
 * `variant="banner"` — a full-width, fixed-height rectangle (the POS
 * register tile / client Shop card image). Both variants reserve their
 * exact box size up front via inline width/height (never intrinsic), so
 * nothing shifts layout while the image is still loading or if it's
 * missing entirely.
 */
export default function ItemThumbnail({ imageId, alt, size = 44, variant = "square", className = "", public: isPublic = false }) {
  const src = useShopMediaSrc(imageId, { public: isPublic });
  const isBanner = variant === "banner";
  const boxStyle = isBanner
    ? { height: size, width: "100%" }
    : { width: size, height: size, minWidth: size, minHeight: size };
  const shapeClass = isBanner ? "w-full" : "shrink-0";

  if (src) {
    return (
      <img src={src} alt={alt || ""} style={boxStyle}
           className={`${shapeClass} rounded-md border border-shBorder object-cover ${className}`} />
    );
  }
  return (
    <div style={boxStyle} data-testid="item-thumbnail-placeholder"
         className={`${shapeClass} rounded-md border border-shBorder grid place-items-center text-shTextMuted ${className}`}>
      <i className={`fas fa-image ${isBanner ? "text-lg" : "text-[11px]"}`} />
    </div>
  );
}
