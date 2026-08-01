import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { toast } from "sonner";
import PremiumButton from "./premium/PremiumButton";
import { useShopMediaSrc } from "./ItemThumbnail";
import { CLIENT_LABELS } from "../lib/clientLabels";

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

/* Plain-text formatter — paragraphs (blank line), line breaks, and short
 * "- "/"• " bullet lists. Built from split()/JSX, never dangerouslySetInnerHTML,
 * so there is no HTML-injection surface no matter what an admin types into a
 * description field. */
function FormattedDescription({ text }) {
  const trimmed = (text || "").trim();
  if (!trimmed) {
    return <p className="text-shTextMuted text-[14px] italic">Additional information is not available yet.</p>;
  }
  const blocks = trimmed.split(/\n\s*\n/);
  return (
    <div className="space-y-3">
      {blocks.map((block, bi) => {
        const lines = block.split("\n");
        const isBulletBlock = lines.every((l) => /^\s*[-•]\s+/.test(l));
        if (isBulletBlock) {
          return (
            <ul key={bi} className="list-disc list-inside space-y-1 text-shText text-[14px] leading-relaxed">
              {lines.map((l, li) => <li key={li}>{l.replace(/^\s*[-•]\s+/, "")}</li>)}
            </ul>
          );
        }
        return (
          <p key={bi} className="text-shText text-[14px] leading-relaxed">
            {lines.map((l, li) => (li === 0 ? l : [<br key={`br-${li}`} />, l]))}
          </p>
        );
      })}
    </div>
  );
}

function PriceBlock({ item }) {
  const isShopify = item.kind === "product" && item.sales_destination === "shopify_external";
  if (isShopify) {
    return item.shopify_display_price != null ? (
      <p className="text-shPrimary font-black text-[26px]">
        {item.shopify_from_price ? "From " : ""}{money(item.shopify_display_price)}
      </p>
    ) : null;
  }
  if ((item.kind === "credit_pack" || item.kind === "product") && item.has_price_override) {
    return (
      <div data-testid="shop-detail-price-override">
        <p className="text-shPrimary font-black text-[26px]">Your price: {money(item.effective_price)}</p>
        <p className="text-[12px] text-shTextMuted font-bold uppercase tracking-widest">Client-specific price</p>
        <p className="text-[13px] text-shTextMuted mt-0.5">
          Standard price: <span className="line-through">{money(item.list_price)}</span>
        </p>
      </div>
    );
  }
  return <p className="text-shPrimary font-black text-[26px]">{money(item.price ?? item.effective_price)}</p>;
}

function availabilityText(item) {
  if (item.kind !== "product" || item.sales_destination === "shopify_external") return null;
  if (!item.track_inventory) return { label: "Available", tone: "ok" };
  if (!item.in_stock) return { label: "Sold Out", tone: "bad" };
  if (item.low_stock_threshold != null && item.stock_on_hand <= item.low_stock_threshold) {
    return { label: "Low Stock", tone: "warn" };
  }
  return { label: "In Stock", tone: "ok" };
}

function purchaseButtonLabel(kind) {
  if (kind === "credit_pack") return "Purchase Pack";
  if (kind === "training_program") return "Purchase Program";
  return "Add to Cart";
}

/* Related items reuse the already-loaded, already-priced catalog array —
 * no second backend call, guaranteed to already be visibility-filtered and
 * resolver-priced exactly like the grid. */
function RelatedItems({ item, allItems, onOpenItem }) {
  if (!allItems || allItems.length === 0) return null;
  let related = allItems.filter((i) => !(i.kind === item.kind && i.id === item.id) && i.kind === item.kind && i.category_id === item.category_id);
  if (related.length < 2) {
    related = allItems.filter((i) => !(i.kind === item.kind && i.id === item.id) && i.kind === item.kind);
  }
  related = related.slice(0, 4);
  if (related.length === 0) return null;
  return (
    <div className="mt-10 pt-6 border-t border-shBorder" data-testid="shop-detail-related">
      <p className="text-[12px] font-black uppercase tracking-widest text-shPrimary mb-3">More in This Category</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {related.map((r) => (
          <button key={`${r.kind}-${r.id}`} onClick={() => onOpenItem(r)} data-testid={`shop-related-${r.kind}-${r.id}`}
                  className="text-left border border-shBorder rounded-lg p-2 hover:border-shPrimary/50 transition" style={{ background: "var(--sh-card-base)" }}>
            <ImgOrPlaceholder imageId={r.image_id} alt={r.name} />
            <p className="text-shText font-bold text-[12px] mt-1.5 truncate">{r.name}</p>
            <p className="text-shPrimary font-black text-[13px]">{money(r.price ?? r.effective_price)}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

function ImgOrPlaceholder({ imageId, alt }) {
  const src = useShopMediaSrc(imageId);
  if (src) return <img src={src} alt={alt || ""} style={{ height: 80 }} className="w-full object-cover rounded" />;
  return (
    <div style={{ height: 80 }} className="w-full rounded border border-shBorder grid place-items-center text-shTextMuted">
      <i className="fas fa-image" />
    </div>
  );
}

function HeroImage({ imageId, alt }) {
  const src = useShopMediaSrc(imageId);
  const [enlarged, setEnlarged] = useState(false);
  return (
    <>
      <button type="button" onClick={() => src && setEnlarged(true)} data-testid="shop-detail-hero-image"
              className="block w-full rounded-xl border border-shBorder overflow-hidden" style={{ background: "var(--sh-card-base)", cursor: src ? "zoom-in" : "default" }}>
        {src ? (
          <img src={src} alt={alt || ""} className="w-full object-cover" style={{ height: 320 }} />
        ) : (
          <div style={{ height: 320 }} className="w-full grid place-items-center text-shTextMuted">
            <i className="fas fa-image text-4xl" />
          </div>
        )}
      </button>
      {enlarged && (
        <div className="fixed inset-0 z-[70] bg-black/90 flex items-center justify-center p-4" onClick={() => setEnlarged(false)} data-testid="shop-detail-lightbox">
          <img src={src} alt={alt || ""} className="max-w-full max-h-full object-contain rounded" />
        </div>
      )}
    </>
  );
}

export default function ShopItemDetail({ kind, itemId, cart, onAddToCart, onBack, allItems, onOpenItem }) {
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [qty, setQty] = useState(1);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setNotFound(false); setItem(null); setQty(1);
    api.get(`/shop/item/${encodeURIComponent(kind)}/${encodeURIComponent(itemId)}`)
      .then(({ data }) => { if (!cancelled) setItem(data); })
      .catch(() => { if (!cancelled) setNotFound(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [kind, itemId]);

  if (loading) {
    return <p className="text-shTextMuted text-sm text-center py-16" data-testid="shop-detail-loading">Loading…</p>;
  }

  if (notFound || !item) {
    return (
      <div className="text-center py-16" data-testid="shop-detail-unavailable">
        <i className="fas fa-circle-exclamation text-shTextMuted text-3xl mb-3" />
        <p className="text-shText font-bold">This item isn&apos;t available right now.</p>
        <p className="text-shTextMuted text-sm mt-1">It may have been removed or is no longer offered.</p>
        <PremiumButton variant="secondary" onClick={onBack} className="mt-5" data-testid="shop-detail-back-unavailable">
          <i className="fas fa-arrow-left mr-1" />Back to Shop
        </PremiumButton>
      </div>
    );
  }

  const isShopifyMerch = item.kind === "product" && item.sales_destination === "shopify_external";
  const outOfStock = item.kind === "product" && !isShopifyMerch && item.track_inventory && !item.in_stock;
  const isInternalPhysical = item.kind === "product" && !isShopifyMerch;
  const avail = availabilityText(item);
  const cartQty = (cart || []).find((c) => c.kind === item.kind && c.ref_id === item.id)?.quantity || 0;
  // Stock-safe quantity — `qty` here is "how many more to add", so the real
  // ceiling is what's left after subtracting what's already sitting in the
  // cart, not just the raw stock_on_hand (which the old maxQty ignored).
  const remainingStock = item.kind === "product" && item.track_inventory
    ? Math.max(0, Math.floor(item.stock_on_hand ?? 0) - cartQty)
    : null;
  const maxQty = remainingStock != null ? Math.max(1, remainingStock) : 99;
  const atMaxInCart = remainingStock === 0;

  const handleShopifyClick = () => {
    api.post("/shop/merch-click", { product_id: item.id }).catch(() => {});
    if (!item.shopify_product_url) return;
    const isMobile = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(max-width: 640px)").matches;
    if (isMobile) window.location.href = item.shopify_product_url;
    else window.open(item.shopify_product_url, "_blank", "noopener,noreferrer");
  };

  const handlePurchase = () => {
    onAddToCart(item, item.kind === "product" ? qty : 1);
    toast.success(item.kind === "product" ? `Added ${qty} to cart` : `${item.name} added to cart`);
  };

  return (
    <div data-testid={`shop-item-detail-${item.kind}-${item.id}`}>
      <PremiumButton variant="secondary" onClick={onBack} data-testid="shop-detail-back" className="mb-4">
        <i className="fas fa-arrow-left mr-1" />Back to Shop
      </PremiumButton>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-10">
        <div>
          <HeroImage imageId={item.image_id} alt={item.name} />
        </div>

        <div className="flex flex-col">
          {item.featured && (
            <span className="self-start mb-2 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest bg-shPrimary/10 text-shPrimary">Featured</span>
          )}
          <p className="text-[11px] font-black uppercase tracking-widest text-shSecondary">
            {item.section_label}{item.category_name ? ` · ${item.category_name}` : ""}{item.subcategory_name ? ` → ${item.subcategory_name}` : ""}
          </p>
          <h1 className="text-2xl font-bold text-shText mt-1">{item.name}</h1>

          <div className="mt-3">
            <PriceBlock item={item} />
          </div>

          {avail && (
            <p className={`mt-2 text-[12px] font-black uppercase tracking-widest ${avail.tone === "bad" ? "text-shDanger" : avail.tone === "warn" ? "text-shOrange" : "text-shGreen"}`} data-testid="shop-detail-availability">
              {avail.label}
              {item.track_inventory && item.in_stock ? ` · ${item.stock_on_hand} available` : ""}
            </p>
          )}

          {isInternalPhysical && (
            <p className="mt-2 text-[12px] text-shOrange bg-shOrange/10 border border-shOrange/30 rounded p-2" data-testid="shop-detail-pickup-notice">
              <i className="fas fa-store mr-1" />Local pickup at Sit Happens — shipping is not available for this item.
            </p>
          )}

          {item.kind === "credit_pack" && (
            <p className="text-shTextMuted text-[13px] mt-2" data-testid="shop-detail-pack-summary">
              Includes {item.qty} {item.service_type} {CLIENT_LABELS.creditPack.toLowerCase()}. Credits are added to your account after successful payment and may be used for eligible {item.service_type} bookings.
            </p>
          )}
          {item.kind === "training_program" && (
            <p className="text-shTextMuted text-[13px] mt-2" data-testid="shop-detail-program-summary">
              Includes {item.format_count} {item.format_unit}.
            </p>
          )}
          {item.kind === "training_program" && item.min_age_months > 0 && (
            <p className="text-shTextMuted text-[13px] mt-1">Dogs must be at least {item.min_age_months} month{item.min_age_months === 1 ? "" : "s"} old.</p>
          )}
          {item.kind === "training_program" && item.prerequisite_names && item.prerequisite_names.length > 0 && (
            <p className="text-shTextMuted text-[13px] mt-1">Requires completing: {item.prerequisite_names.join(", ")}.</p>
          )}

          <div className="mt-4">
            <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted mb-1">Description</p>
            <FormattedDescription text={item.description} />
          </div>

          <div className="mt-auto pt-6 space-y-3">
            {item.kind === "product" && !isShopifyMerch && !outOfStock && !atMaxInCart && (
              <div className="flex items-center gap-2" data-testid="shop-detail-qty">
                <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="w-9 h-9 rounded border border-shBorder text-shTextMuted hover:text-shText" style={{ background: "var(--sh-card-base)" }}>−</button>
                <span className="w-8 text-center text-shText font-bold">{qty}</span>
                <button onClick={() => setQty((q) => Math.min(maxQty, q + 1))} disabled={qty >= maxQty}
                        className="w-9 h-9 rounded border border-shBorder text-shTextMuted hover:text-shText disabled:opacity-30 disabled:cursor-not-allowed"
                        style={{ background: "var(--sh-card-base)" }}>+</button>
              </div>
            )}

            {isShopifyMerch ? (
              <PremiumButton variant="primary" onClick={handleShopifyClick} data-testid="shop-detail-view-options" className="w-full justify-center py-3">
                View Options <i className="fas fa-arrow-up-right-from-square ml-1 text-[11px]" />
              </PremiumButton>
            ) : outOfStock ? (
              <div>
                <button disabled data-testid="shop-detail-purchase-disabled"
                        className="w-full px-3 py-3 rounded-md text-[13px] font-black uppercase tracking-widest border border-shBorder text-shTextMuted cursor-not-allowed"
                        style={{ background: "var(--sh-card-base)" }}>
                  Sold Out
                </button>
                <p className="text-[12px] text-shTextMuted mt-1">This item is currently out of stock.</p>
              </div>
            ) : atMaxInCart ? (
              <div>
                <button disabled data-testid="shop-detail-purchase-disabled"
                        className="w-full px-3 py-3 rounded-md text-[13px] font-black uppercase tracking-widest border border-shBorder text-shTextMuted cursor-not-allowed"
                        style={{ background: "var(--sh-card-base)" }}>
                  Max in Cart
                </button>
                <p className="text-[12px] text-shTextMuted mt-1">You already have the maximum available quantity ({cartQty}) in your cart.</p>
              </div>
            ) : (
              <PremiumButton variant="primary" onClick={handlePurchase} data-testid="shop-detail-purchase" className="w-full justify-center py-3">
                {cartQty > 0 ? `${purchaseButtonLabel(item.kind)} (In Cart: ${cartQty})` : purchaseButtonLabel(item.kind)}
              </PremiumButton>
            )}
          </div>
        </div>
      </div>

      <RelatedItems item={item} allItems={allItems} onOpenItem={onOpenItem} />
    </div>
  );
}
