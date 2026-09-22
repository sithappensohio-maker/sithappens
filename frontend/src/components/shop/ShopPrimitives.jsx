import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { shopImageProps } from "../../lib/shopImage";
import { badgesFor } from "../../lib/shopDepartments";

/**
 * The small pieces every Shop surface is built from.
 *
 * They exist so a price looks like a price in the grid, on the product page
 * and in the cart — the old Shop formatted money in eleven places and they
 * had drifted. Kept deliberately small: these are primitives, not a design
 * system, and there is exactly one Shop to serve.
 */

export const money = (n) => `$${Number(n || 0).toFixed(2)}`;

/**
 * The price line for one catalogue item.
 *
 * Shopify-linked products do not carry `price` the way our own products do —
 * Shopify owns their price and we only mirror it (see
 * backend/domains/shop/shopify_pricing). Reading `item.price` for one of them
 * used to produce `money(undefined)`, which is `$0.00`, so the entire merch
 * grid advertised itself as free.
 *
 * `null` means "we do not know", which is not the same as zero and must never
 * be rendered as a number.
 */
export function priceProps(item) {
  if (item?.sales_destination === "shopify_external") {
    const resolved = item.shopify_price;
    if (resolved && resolved.has_price) return { display: resolved.display };
    // Older responses (and any client holding a cached payload from before
    // the fix) only have the flat fields — read them rather than showing $0.
    const flat = item.shopify_display_price;
    if (flat != null && Number.isFinite(Number(flat)) && Number(flat) > 0) {
      return { display: `${item.shopify_from_price ? "From " : ""}${money(flat)}` };
    }
    return { unknownLabel: "View price on Shopify" };
  }
  const amount = item?.price != null ? item.price : item?.effective_price;
  return { amount };
}

/**
 * A price, at one of three weights.
 *
 * `was` renders a struck-through original ONLY when it is genuinely higher —
 * a "was" price that isn't higher is a lie, and passing one by accident
 * should show nothing rather than an insult.
 *
 * `display` is a string the server already formatted (so "From $24.99" is
 * decided in one place); `unknownLabel` is what to say when there is no price
 * to show. With neither, an unknown price renders nothing at all — silence
 * beats inventing a number.
 */
export function Price({ amount, was, size = "md", className = "", display = null, unknownLabel = null }) {
  const scale = { sm: "text-[13px]", md: "text-[17px]", lg: "text-[26px] sm:text-[30px]" }[size] || "text-[17px]";
  const known = display != null || (amount != null && Number.isFinite(Number(amount)));
  if (!known) {
    if (!unknownLabel) return null;
    return (
      <span className={`text-shTextMuted font-bold ${size === "lg" ? "text-[15px]" : "text-[12px]"} ${className}`}
            data-testid="shop-price-unknown">
        {unknownLabel}
      </span>
    );
  }
  const showWas = display == null && was != null && Number(was) > Number(amount || 0);
  return (
    <span className={`inline-flex items-baseline gap-2 ${className}`} data-testid="shop-price">
      <span className={`font-black text-shPrimary ${scale} tabular-nums`}>{display != null ? display : money(amount)}</span>
      {showWas && (
        <span className="text-[12px] text-shTextMuted line-through tabular-nums">{money(was)}</span>
      )}
    </span>
  );
}

const BADGE_TONE = {
  primary: "bg-shPrimary text-bgHeader",
  secondary: "border border-shSecondary/50 text-shSecondary bg-shSecondary/10",
  warn: "border border-shOrange/50 text-shOrange bg-shOrange/10",
  muted: "border border-shBorder text-shTextMuted bg-black/25",
};

/** Badges, straight from `badgesFor` — which only ever returns states the
 *  data can prove. Nothing here invents urgency. */
export function Badges({ item, className = "", bestSellerIds }) {
  const badges = badgesFor(item, { bestSellerIds });
  if (!badges.length) return null;
  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {badges.map((b) => (
        <span key={b.key} data-testid={`shop-badge-${b.key}`}
              className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-[0.12em] ${BADGE_TONE[b.tone] || BADGE_TONE.muted}`}>
          {b.label}
        </span>
      ))}
    </div>
  );
}

/** Stock, in words a customer uses. Silent when there is nothing worth
 *  saying — "In stock" on every card is noise, not information. */
export function Availability({ item, className = "" }) {
  const a = item?.availability;
  if (a === "out_of_stock") {
    return <span className={`text-[12px] font-bold text-shTextMuted ${className}`}
                 data-testid="shop-availability">Sold out</span>;
  }
  if (a === "low_stock") {
    return <span className={`text-[12px] font-bold text-shOrange ${className}`}
                 data-testid="shop-availability">Only a few left</span>;
  }
  return null;
}

/**
 * A product image that reserves its space before it arrives.
 *
 * `ratio` is held by padding-bottom rather than by the image, so the grid
 * has its final shape on first paint and nothing jumps as photographs load.
 * That is the whole job — the derivative picking is `shopImageProps`.
 */
/**
 * `<img>` props for one Shop image, with the recovery every Shop surface needs.
 *
 * The fast derivative route (/shop/media/<id>/<size>) is unauthenticated — an
 * `<img>` cannot send a bearer token — so it serves an image only while its
 * item is publicly visible. A signed-in client legitimately sees products that
 * are not: both product editors save `publicly_visible: false` for anything
 * kept off the guest storefront, and for every Shopify listing unconditionally.
 * Those images 404'd and the browser painted the alt text instead, which is
 * what "changing the photo didn't work" looked like — the photo saved fine,
 * its delivery had been revoked.
 *
 * On that 404 we ask the authenticated JSON route, exactly as that endpoint's
 * own docstring says callers should. A guest has no such route and falls
 * through to the caller's placeholder, which is the correct answer for them.
 */
export function useShopImage(imageId, surface, isPublic) {
  const [fallbackSrc, setFallbackSrc] = useState(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => { setFallbackSrc(null); setUnavailable(false); }, [imageId]);

  if (!imageId || unavailable) return { props: null, unavailable: true };
  const base = shopImageProps(imageId, surface, { public: isPublic });
  if (!base) return { props: null, unavailable: true };

  const onError = () => {
    if (isPublic || fallbackSrc) { setUnavailable(true); return; }
    api.get(`/shop/media/${encodeURIComponent(imageId)}`)
      // `data` is stored as a complete data: URL, so it drops straight into src.
      .then((r) => {
        const src = r?.data?.data;
        if (typeof src === "string" && src) setFallbackSrc(src);
        else setUnavailable(true);
      })
      .catch(() => setUnavailable(true));
  };

  // A 404 from a local backend can land BEFORE React attaches its listener,
  // and a missed error event is a permanently broken image. By the time the
  // ref runs, an image that already failed reports complete with no width —
  // so ask it directly rather than trusting the event to have been heard.
  const ref = (el) => {
    if (el && el.complete && el.naturalWidth === 0 && !fallbackSrc) onError();
  };

  // The fallback is one concrete file, so srcSet/sizes would only confuse it.
  const props = fallbackSrc
    ? { src: fallbackSrc, loading: base.loading, decoding: base.decoding }
    : base;
  return { props: { ...props, onError, ref }, unavailable: false };
}

export function ProductImage({ item, surface = "card", ratio = "4 / 5", alt, isPublic, className = "" }) {
  const imageId = (item?.image_ids || []).filter(Boolean)[0] || item?.image_id || null;
  const { props } = useShopImage(imageId, surface, isPublic);
  return (
    <div className={`relative overflow-hidden rounded-xl bg-black/30 ${className}`}
         style={{ aspectRatio: ratio }} data-testid="shop-product-image">
      {props ? (
        <img {...props} alt={alt || item?.name || ""}
             className="absolute inset-0 w-full h-full object-cover transition-[transform,opacity] duration-300 motion-reduce:transition-none" />
      ) : (
        <div className="absolute inset-0 grid place-items-center text-shTextMuted/50">
          <i className="fas fa-camera text-2xl" aria-hidden="true" />
        </div>
      )}
    </div>
  );
}

/**
 * A quantity control that is two real buttons and a live number.
 *
 * The old Shop used bare `<button>`s with a `−` glyph and no label, which a
 * screen reader reads as "minus, button" with no idea what it decrements.
 */
export function QuantityStepper({ value, min = 1, max, onChange, label = "Quantity", idSuffix = "" }) {
  const atMin = value <= min;
  const atMax = max != null && value >= max;
  const btn = "w-9 h-9 rounded-lg border border-shBorder text-shText grid place-items-center "
    + "hover:border-shPrimary/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-shPrimary "
    + "disabled:opacity-30 disabled:cursor-not-allowed transition";
  return (
    <div className="inline-flex items-center gap-2" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(value - 1)} disabled={atMin}
              aria-label={`Decrease ${label.toLowerCase()}`} className={btn}
              data-testid={`shop-qty-minus${idSuffix}`}>−</button>
      <span className="min-w-[2ch] text-center font-black text-shText tabular-nums" aria-live="polite"
            data-testid={`shop-qty-value${idSuffix}`}>{value}</span>
      <button type="button" onClick={() => onChange(value + 1)} disabled={atMax}
              aria-label={`Increase ${label.toLowerCase()}`}
              title={atMax ? "That is all we have" : undefined} className={btn}
              data-testid={`shop-qty-plus${idSuffix}`}>+</button>
    </div>
  );
}

/**
 * The shape of a card before its data arrives.
 *
 * Same aspect ratio and same line heights as the real card, so the grid does
 * not reflow when the catalog lands. A spinner in the middle of an empty
 * page tells you nothing; this tells you how much is coming.
 */
export function CardSkeleton({ ratio = "4 / 5" }) {
  return (
    <div className="animate-pulse motion-reduce:animate-none" data-testid="shop-card-skeleton" aria-hidden="true">
      <div className="rounded-xl bg-white/5" style={{ aspectRatio: ratio }} />
      <div className="h-3.5 mt-3 rounded bg-white/5 w-3/4" />
      <div className="h-3 mt-2 rounded bg-white/5 w-1/3" />
    </div>
  );
}

export function GridSkeleton({ count = 8, className = "" }) {
  return (
    <div className={className} aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading products…</span>
      {Array.from({ length: count }, (_, i) => <CardSkeleton key={i} />)}
    </div>
  );
}

/**
 * The shell every card shares: one link-shaped control around the whole
 * thing, so the card is reachable by keyboard and announced once.
 *
 * The old cards were `<div onClick>` — invisible to the keyboard and to a
 * screen reader, and the reason this is a component rather than a class
 * name. A nested Add-to-Cart button stops its own click from bubbling, so
 * "add" and "open" stay two separate intentions.
 */
export function CardShell({ onOpen, label, children, className = "", testId, favorite }) {
  return (
    <div className={`group relative flex flex-col text-left ${className}`} data-testid={testId}>
      <button type="button" onClick={onOpen} aria-label={label}
              data-testid={testId ? `${testId}-open` : undefined}
              className="absolute inset-0 z-10 rounded-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-shPrimary" />
      {/* Above the card's own full-bleed open button, or the heart would be
          unclickable — every tap would open the product instead of saving
          it. Visible at rest rather than on hover: a control that appears on
          hover does not exist on a phone. */}
      {favorite && <div className="absolute top-2 right-2 z-20">{favorite}</div>}
      {children}
    </div>
  );
}
