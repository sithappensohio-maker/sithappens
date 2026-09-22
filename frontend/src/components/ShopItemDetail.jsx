import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { toast } from "sonner";
import { isFreeClaimable, freePriceLabel, freeCourseCta, rememberFreeClaimIntent } from "../lib/freeCourseClaim";
import { useDocumentMeta, publicOrigin } from "../lib/useDocumentMeta";
import { itemMetaFor } from "../lib/shopSeo";
import { Price, priceProps } from "./shop/ShopPrimitives";
import PremiumButton from "./premium/PremiumButton";
import NeonEdge from "./premium/NeonEdge";
import HuskyDogImage from "./brand/HuskyDogImage";
import { shopImageProps, galleryIds } from "../lib/shopImage";
import { guestItemCta, creditPackDetailLine } from "../lib/shopPolish";
import ProductFacts from "./shop/ProductFacts";

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

function PriceBlock({ item, hiddenPriceMessage }) {
  const isShopify = item.kind === "product" && item.sales_destination === "shopify_external";
  if (isShopify) {
    // One rule for both surfaces: the grid card and this page ask the same
    // helper, so a variant-priced product cannot read "From $24.99" in one
    // place and "$24.99" in the other. Saying where to find the price beats
    // a blank space when Shopify never gave us one.
    const resolved = priceProps(item);
    return <Price {...resolved} size="lg" unknownLabel={resolved.unknownLabel || null} />;
  }
  // Public no-account storefront — price fields are simply ABSENT from the
  // response when hidden (never a zero/malformed value), so this must be
  // checked before falling through to money(undefined) → "$0.00".
  // A deliberately free course reads FREE. A $0 program that is NOT
  // claimable is unpriced, not free, and must never advertise itself as such.
  if (freePriceLabel(item)) {
    return <p className="text-shPrimary font-black text-[26px]" data-testid="shop-detail-free-price">FREE</p>;
  }
  const hasPrice = item.price != null || item.effective_price != null;
  if (!hasPrice) {
    return hiddenPriceMessage ? (
      <p className="text-shTextMuted font-black text-[16px] uppercase tracking-widest" data-testid="shop-detail-hidden-price">
        <i className="fas fa-lock mr-1.5" />{hiddenPriceMessage}
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

function availabilityText(item, isGuest) {
  if (item.kind !== "product" || item.sales_destination === "shopify_external") return null;
  // Public no-account storefront — the public item response never carries
  // track_inventory/in_stock/stock_on_hand (no exact counts leak to
  // guests), only the computed `availability` string. Guest state is
  // derived from that alone; everything below is unchanged for the
  // authenticated/preview response shape.
  if (isGuest) {
    if (item.availability === "out_of_stock") return { label: "Sold Out", tone: "bad" };
    if (item.availability === "low_stock") return { label: "Low Stock", tone: "warn" };
    return { label: "In Stock", tone: "ok" };
  }
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


/**
 * The product gallery.
 *
 * Restrained on purpose — the visual PDP redesign comes later. What this
 * provides is the MECHANICS the redesign will need: a primary image, a
 * thumbnail strip when there is more than one, selection by click or
 * keyboard, and a zoom view that is the only place the large file is ever
 * fetched.
 *
 * A one-image product renders exactly as it did before: no strip, no extra
 * requests, nothing to notice.
 */
function ProductGallery({ ids, alt, isPublic, fallbackSrc }) {
  const [active, setActive] = useState(0);
  const [enlarged, setEnlarged] = useState(false);
  const stripRef = useRef(null);
  useEffect(() => { setActive(0); }, [ids.join(",")]);

  const current = ids[active] || null;
  const hero = shopImageProps(current, "pdp", { public: isPublic });
  const zoom = shopImageProps(current, "zoom", { public: isPublic });

  // Arrow keys move along the strip the way a listbox does, so the gallery
  // is operable without a mouse.
  const onStripKey = (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = e.key === "ArrowRight"
      ? Math.min(ids.length - 1, active + 1)
      : Math.max(0, active - 1);
    setActive(next);
    stripRef.current?.querySelector(`[data-thumb="${next}"]`)?.focus();
  };

  return (
    <>
      <button type="button" onClick={() => hero && setEnlarged(true)}
              data-testid="shop-detail-hero-image"
              aria-label={hero ? `${alt || "Product image"} — view larger` : undefined}
              className="block w-full rounded-xl border border-shBorder overflow-hidden"
              style={{ background: "var(--sh-card-base)", cursor: hero ? "zoom-in" : "default" }}>
        {hero ? (
          // CONTAIN, not cover. A grid card crops to keep the grid tidy; a
          // product page has one job, which is showing the product. A
          // 900x1400 portrait centre-cropped into a 360px band lost its
          // subject completely — the page showed the background and nothing
          // else. The box keeps its fixed height so nothing below it jumps,
          // and the letterboxing sits on the card colour so it reads as
          // deliberate rather than broken.
          <div className="w-full" style={{ height: 360, background: "rgba(0,0,0,0.25)" }}>
            {/* The WRAPPER owns the height, so the box is reserved before the
                bytes arrive and nothing below it jumps. The image then fills
                that box and contains itself inside it. The intrinsic
                width/height attributes are deliberately absent: with them the
                element laid itself out at 900x360, overflowed the box and was
                clipped by the parent — which is the very cropping this was
                meant to stop. */}
            <img {...hero} alt={alt || ""} className="w-full h-full object-contain" />
          </div>
        ) : fallbackSrc ? (
          <div className="relative overflow-hidden" style={{ height: 360 }}>
            <img src={fallbackSrc} alt={alt || ""} className="absolute inset-0 w-full h-full object-cover object-top" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
          </div>
        ) : (
          <div style={{ height: 360 }} className="w-full grid place-items-center text-shTextMuted bg-black/20">
            <i className="fas fa-image text-4xl" />
          </div>
        )}
      </button>

      {ids.length > 1 && (
        <div ref={stripRef} role="listbox" aria-label="Product images"
             onKeyDown={onStripKey} data-testid="shop-detail-thumbs"
             className="flex gap-2 mt-2 overflow-x-auto pb-1">
          {ids.map((id, i) => (
            <button key={id} type="button" role="option" aria-selected={i === active}
                    data-thumb={i} data-testid={`shop-detail-thumb-${i}`}
                    onClick={() => setActive(i)}
                    aria-label={`${alt || "Product"} image ${i + 1} of ${ids.length}`}
                    className={`shrink-0 rounded-lg overflow-hidden border-2 transition ${
                      i === active ? "border-shPrimary" : "border-shBorder hover:border-shPrimary/40"}`}>
              <img {...shopImageProps(id, "thumb", { public: isPublic })}
                   alt="" width={64} height={64}
                   className="w-16 h-16 object-cover" />
            </button>
          ))}
        </div>
      )}

      {enlarged && (
        <div className="fixed inset-0 z-[70] bg-black/90 flex items-center justify-center p-4"
             onClick={() => setEnlarged(false)} data-testid="shop-detail-lightbox"
             role="dialog" aria-modal="true" aria-label={`${alt || "Product"} enlarged`}>
          {/* The only place the 1600px file is ever requested. */}
          <img {...zoom} alt={alt || ""} className="max-w-full max-h-full object-contain rounded" />
        </div>
      )}
    </>
  );
}

export default function ShopItemDetail({ kind, itemId, cart, onAddToCart, onBack, allItems, onOpenItem, mode = "authenticated", onRequireAccount, onGoToOnlineSchool, onClaimFreeCourse, onAddDog, dogs = [],
  // Curated suggestions and this browser's own history, both resolved by
  // the server against the catalogue this viewer is allowed to see. Passed
  // in as a rendered node rather than fetched here, so the page makes ONE
  // discovery request no matter how many places it is shown.
  discoverySlot,
  // The heart, as a function of the loaded item rather than a ready-made
  // node: the page that opens this only knows a kind and an id, so a node
  // built up there is labelled "this item" instead of naming the product.
  favoriteSlot }) {
  // Buying a gift card is buying a present, so the screen asks who it is
  // for. Left blank it simply comes to the buyer, which is the other real
  // case — somebody topping themselves up or handing it over in person.
  const [isGift, setIsGift] = useState(false);
  const [giftEmail, setGiftEmail] = useState("");
  const [giftName, setGiftName] = useState("");
  const [giftMessage, setGiftMessage] = useState("");
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [qty, setQty] = useState(1);
  const isGuest = mode === "guest";

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setNotFound(false); setItem(null); setQty(1);
    const url = isGuest
      ? `/public/shop/item/${encodeURIComponent(kind)}/${encodeURIComponent(itemId)}`
      : `/shop/item/${encodeURIComponent(kind)}/${encodeURIComponent(itemId)}`;
    api.get(url)
      .then(({ data }) => { if (!cancelled) setItem(data); })
      .catch(() => { if (!cancelled) setNotFound(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, itemId, isGuest]);

  // Phase 5 — Online School commerce. Only fetched for the one item kind/
  // fulfillment combination that needs it: a training_program whose
  // program is purchase_fulfillment="online_school". Real server-derived
  // ownership state per dog (GET /portal/school, the same list the
  // Online School dashboard itself reads) — never guessed or cached
  // stale across items.
  const isOnlineSchoolProgram = !isGuest && item?.kind === "training_program" && item.purchase_fulfillment === "online_school";
  const freeClaim = isFreeClaimable(item);

  // Described from the item this page actually loaded, rather than guessed
  // from the route — so the tab, a bookmark and Googlebot all get the real
  // product. A link-preview bot never reaches this code; it is served the
  // server-rendered document instead, built from the same catalogue so the
  // two say the same thing.
  useDocumentMeta({
    ...itemMetaFor(item, { origin: publicOrigin(), isPublic: isGuest }),
    enabled: !!item && !loading && mode !== "preview",
  });
  const [schoolEnrollments, setSchoolEnrollments] = useState(null);
  useEffect(() => {
    if (!isOnlineSchoolProgram) { setSchoolEnrollments(null); return; }
    let cancelled = false;
    // `data || []` is not enough: the endpoint can hand back an OBJECT, and
    // an object is truthy, so it sailed through and then `?.find` threw —
    // `?.` guards null, not the wrong type. Two crashes on this page have
    // now had exactly this shape, so the state is coerced at the boundary
    // and everything downstream can assume an array.
    api.get("/portal/school")
      .then(({ data }) => { if (!cancelled) setSchoolEnrollments(Array.isArray(data) ? data : []); })
      .catch(() => { if (!cancelled) setSchoolEnrollments([]); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnlineSchoolProgram, itemId]);

  // Client's own dogs — for a single-dog client, default/select that dog
  // (per the Phase 5 spec: convenience default only, the server still
  // independently validates ownership at checkout regardless).
  const [selectedDogId, setSelectedDogId] = useState(null);
  useEffect(() => {
    if (!isOnlineSchoolProgram) { setSelectedDogId(null); return; }
    setSelectedDogId(dogs.length === 1 ? dogs[0].id : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnlineSchoolProgram, itemId, dogs.length]);

  const selectedDogEnrollment = isOnlineSchoolProgram && selectedDogId && schoolEnrollments
    ? schoolEnrollments.find((e) => e.dog_id === selectedDogId && e.program_id === itemId)
    : null;
  const selectedDogEligibility = isOnlineSchoolProgram && selectedDogId
    ? (item?.school_prerequisite_eligibility || []).find((e) => e.dog_id === selectedDogId)
    : null;

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
  const outOfStock = isGuest
    ? item.kind === "product" && !isShopifyMerch && item.availability === "out_of_stock"
    : item.kind === "product" && !isShopifyMerch && item.track_inventory && !item.in_stock;
  const isInternalPhysical = item.kind === "product" && !isShopifyMerch;
  const avail = availabilityText(item, isGuest);
  // Guest CTA priority — Shopify (isShopifyMerch, handled unconditionally
  // below) always wins first; anything else that isn't a plain eligible
  // Add to Cart blocks the normal qty-selector/purchase button and shows
  // the matching CTA instead. See guestItemCta's own doc comment for the
  // exact priority order.
  const cta = isGuest ? guestItemCta(item) : null;
  const guestBlocked = isGuest && cta && cta.type !== "add_to_cart" && cta.type !== "shopify";
  const cartQty = (cart || []).find((c) => c.kind === item.kind && c.ref_id === item.id)?.quantity || 0;
  const dogCartQty = isOnlineSchoolProgram && selectedDogId
    ? (cart || []).find((c) => c.kind === item.kind && c.ref_id === item.id && c.dog_id === selectedDogId)?.quantity || 0
    : 0;
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
    if (isOnlineSchoolProgram) {
      onAddToCart(item, 1, selectedDogId);
      toast.success(`${item.name} added to cart`);
      return;
    }
    if (item.kind === "gift_card") {
      const email = giftEmail.trim();
      if (isGift && !email.includes("@")) {
        toast.error("Enter the email address to send this gift card to.");
        return;
      }
      onAddToCart(item, qty, undefined, isGift ? {
        recipient_email: email,
        recipient_name: giftName.trim(),
        gift_message: giftMessage.trim(),
      } : undefined);
      toast.success(isGift ? `Gift card for ${giftName.trim() || email} added to cart`
                           : `${item.name} added to cart`);
      return;
    }
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
          <ProductGallery ids={galleryIds(item)} alt={item.name} isPublic={isGuest} fallbackSrc={isOnlineSchoolProgram ? "/brand/husky-placeholder-silver-white.png" : null} />
        </div>

        <div className="flex flex-col">
          {item.featured && (
            <span className="self-start mb-2 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest bg-shPrimary/10 text-shPrimary">Featured</span>
          )}
          <p className="text-[11px] font-black uppercase tracking-widest text-shSecondary">
            {item.section_label}{item.category_name ? ` · ${item.category_name}` : ""}{item.subcategory_name ? ` → ${item.subcategory_name}` : ""}
          </p>
          {isOnlineSchoolProgram && (
            <div className="flex items-center gap-2 mt-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-shPrimary/10 border border-shPrimary/25 text-shPrimary text-[10px] font-black uppercase tracking-[0.14em]"><i className="fas fa-graduation-cap"/>Online School</span>
              <span className="text-[11px] text-shTextMuted">Train from home with the Sit Happens system</span>
            </div>
          )}
          {/* The heart sits with the title, not on the photograph: on a
              product page the picture is the thing being examined, and a
              control floating on top of it competes with the zoom. */}
          <div className="flex items-start gap-3 mt-1">
            <h1 className={`${isOnlineSchoolProgram ? "sh-display text-3xl sm:text-4xl leading-none" : "text-2xl font-bold"} text-shText flex-1 min-w-0`}>{item.name}</h1>
            {favoriteSlot?.(item, { size: "md" })}
          </div>

          <div className="mt-3">
            <PriceBlock item={item} hiddenPriceMessage={isGuest ? "Sign In for Pricing" : null} />
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
              {creditPackDetailLine(item)}
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

          {isOnlineSchoolProgram && (
            <div className="grid grid-cols-2 gap-2 mt-4" data-testid="shop-detail-school-includes">
              <div className="rounded-xl border border-shSecondary/20 bg-shSecondary/[0.04] p-3"><i className="fas fa-person-chalkboard text-shSecondary"/><p className="text-[12px] font-black text-shText mt-2">Real trainer oversight</p><p className="text-[10px] text-shTextMuted mt-1">{item.school_support?.trainer_checkpoints_included == null ? "Trainer-reviewed checkpoints at required course milestones" : `${item.school_support.trainer_checkpoints_included} trainer-reviewed checkpoint${Number(item.school_support.trainer_checkpoints_included) === 1 ? "" : "s"} included`}</p></div>
              <div className="rounded-xl border border-shPrimary/20 bg-shPrimary/[0.04] p-3"><i className="fas fa-hand-holding-heart text-shPrimary"/><p className="text-[12px] font-black text-shText mt-2">Trainer Assist support</p><p className="text-[10px] text-shTextMuted mt-1">{item.school_support?.trainer_assists_included == null ? "Trainer Assist support is available when direct help is needed" : `${item.school_support.trainer_assists_included} included hands-on assist${Number(item.school_support.trainer_assists_included) === 1 ? "" : "s"}`}</p></div>
              <div className="rounded-xl border border-shBorder bg-black/15 p-3"><i className="fas fa-calendar-days text-shTextMuted"/><p className="text-[12px] font-black text-shText mt-2">Guided program</p><p className="text-[10px] text-shTextMuted mt-1">{item.estimated_weeks ? `About ${item.estimated_weeks} weeks` : "Progress at your dog's pace"}</p></div>
              <div className="rounded-xl border border-shBorder bg-black/15 p-3"><i className="fas fa-mobile-screen-button text-shTextMuted"/><p className="text-[12px] font-black text-shText mt-2">Train from your phone</p><p className="text-[10px] text-shTextMuted mt-1">Lessons, guided practice, progress and trainer feedback in one place</p></div>
            </div>
          )}

          {isOnlineSchoolProgram && (
            <NeonEdge accentRgb="140,198,63" intensity="subtle" className="mt-5 p-4" data-testid="shop-detail-dog-selector">
              <div className="flex items-start gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-shPrimary/10 border border-shPrimary/25 grid place-items-center shrink-0"><i className="fas fa-dog text-shPrimary"/></div>
                <div>
                  <p className="text-[13px] font-black text-shText">Who is taking this course?</p>
                  <p className="text-[11px] text-shTextMuted mt-0.5">Online School enrollment is tied to one dog. Choose the student before checkout.</p>
                </div>
              </div>
              {dogs.length === 0 ? (
                <p className="text-shTextMuted text-[13px] rounded-xl border border-shBorder/50 bg-black/20 p-3">Add a dog to your account before purchasing an Online School course.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {dogs.map((d) => {
                    const enrollment = schoolEnrollments?.find((e) => e.dog_id === d.id && e.program_id === itemId);
                    const eligibility = (item.school_prerequisite_eligibility || []).find((e) => e.dog_id === d.id);
                    const selected = selectedDogId === d.id;
                    const missingNames = (eligibility?.missing || []).map((x) => x.name || x.slug).filter(Boolean);
                    return (
                      <button key={d.id} type="button" onClick={() => setSelectedDogId(d.id)} data-testid={`shop-detail-dog-${d.id}`}
                              className={`flex items-center gap-3 text-left p-2.5 rounded-xl border transition ${selected ? "bg-shPrimary/10 border-shPrimary/45 shadow-[0_0_18px_rgba(140,198,63,0.08)]" : "bg-black/20 border-shBorder/60 hover:border-shPrimary/30"}`}>
                        <div className={`w-11 h-11 rounded-xl overflow-hidden border shrink-0 ${selected ? "border-shPrimary/40" : "border-shBorder"}`}>
                          <HuskyDogImage src={d.photo} name={d.name} alt={d.name} className="w-full h-full object-cover object-top"/>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className={`text-[13px] font-black truncate ${selected ? "text-shPrimary" : "text-shText"}`}>{d.name}</p>
                          <p className="text-[10px] text-shTextMuted truncate">{
                            enrollment?.status === "completed" ? "Course completed"
                              : enrollment?.status === "active" ? "Already enrolled"
                              : enrollment?.status === "withdrawn" ? "Previously withdrawn"
                              : eligibility?.eligible === false ? `Complete: ${missingNames.join(", ")}`
                              : "Available"
                          }</p>
                        </div>
                        <i className={`fas ${selected ? "fa-circle-check text-shPrimary" : "fa-circle text-shTextMuted/40"} text-[12px]`}/>
                      </button>
                    );
                  })}
                </div>
              )}
            </NeonEdge>
          )}
          {isOnlineSchoolProgram && selectedDogId && selectedDogEligibility?.eligible === false && (
            <div className="mt-3 rounded-xl border border-shOrange/35 bg-shOrange/[0.07] p-3" data-testid="shop-detail-prerequisite-blocked">
              <p className="text-[12px] font-black text-shOrange"><i className="fas fa-route mr-1.5"/>Complete the prerequisite course first</p>
              <p className="text-[11px] text-shTextMuted mt-1">
                {dogs.find((d) => d.id === selectedDogId)?.name || "This dog"} needs to complete {(selectedDogEligibility.missing || []).map((x) => x.name || x.slug).filter(Boolean).join(", ")} before enrolling in {item.name}.
              </p>
            </div>
          )}

          <div className="mt-4">
            <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted mb-1">Description</p>
            <FormattedDescription text={item.description} />
          </div>

          {/* The description stays prose, because some of it is prose.
              Everything that is actually a FACT — how many sessions, how
              long, what it helps with, whether a dog must be chosen, how it
              reaches you — lives here instead, laid out by department, and
              renders nothing at all when there is nothing to say. */}
          <ProductFacts item={item} mode={mode} />

          <div className="mt-auto pt-6 space-y-3">
            {/* Buying a gift card is buying a present. Asking here — rather
                than at checkout — means the buyer decides who it is for while
                they are still thinking about the gift, and the cart can then
                show them one line per recipient. */}
            {item.kind === "gift_card" && (
              <div className="rounded-xl border border-shBorder/60 bg-black/20 p-3 space-y-2"
                   data-testid="shop-detail-gift">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={isGift}
                         onChange={(e) => setIsGift(e.target.checked)}
                         data-testid="shop-detail-gift-toggle"
                         className="w-4 h-4 accent-shPrimary"/>
                  <span className="text-[13px] font-black text-shText">
                    This is a gift — email it to someone
                  </span>
                </label>
                {!isGift ? (
                  <p className="text-[11px] text-shTextMuted">
                    We will email it to you, so you can hand it on however you like.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <div>
                      <label htmlFor="gift-to" className="block text-[11px] uppercase tracking-widest text-shTextMuted font-black mb-1">
                        Send it to
                      </label>
                      <input id="gift-to" type="email" value={giftEmail}
                             onChange={(e) => setGiftEmail(e.target.value)}
                             placeholder="their@email.com" data-testid="shop-detail-gift-email"
                             className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2.5 text-shText text-sm"/>
                    </div>
                    <div>
                      <label htmlFor="gift-name" className="block text-[11px] uppercase tracking-widest text-shTextMuted font-black mb-1">
                        Their name (optional)
                      </label>
                      <input id="gift-name" value={giftName}
                             onChange={(e) => setGiftName(e.target.value)}
                             data-testid="shop-detail-gift-name"
                             className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2.5 text-shText text-sm"/>
                    </div>
                    <div>
                      <label htmlFor="gift-msg" className="block text-[11px] uppercase tracking-widest text-shTextMuted font-black mb-1">
                        A short message (optional)
                      </label>
                      <input id="gift-msg" value={giftMessage} maxLength={300}
                             onChange={(e) => setGiftMessage(e.target.value)}
                             data-testid="shop-detail-gift-message"
                             className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2.5 text-shText text-sm"/>
                    </div>
                    <p className="text-[11px] text-shTextMuted">
                      It arrives as soon as the payment goes through.
                    </p>
                  </div>
                )}
              </div>
            )}

            {(item.kind === "product" || item.kind === "gift_card") && !isShopifyMerch && !outOfStock && !atMaxInCart && !guestBlocked && (
              <div className="flex items-center gap-2" data-testid="shop-detail-qty">
                <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="w-9 h-9 rounded border border-shBorder text-shTextMuted hover:text-shText" style={{ background: "var(--sh-card-base)" }}>−</button>
                <span className="w-8 text-center text-shText font-bold">{qty}</span>
                <button onClick={() => setQty((q) => Math.min(maxQty, q + 1))} disabled={qty >= maxQty}
                        className="w-9 h-9 rounded border border-shBorder text-shTextMuted hover:text-shText disabled:opacity-30 disabled:cursor-not-allowed"
                        style={{ background: "var(--sh-card-base)" }}>+</button>
              </div>
            )}

            {/* A deliberately free course never enters the cart: no line, no
                $0 total, no order. This branch is checked before every
                purchase CTA so a free course can never fall through to
                checkout, and the guest case routes through the SAME sign-in
                flow with the intent remembered. */}
            {freeClaim ? (() => {
              const cta = freeCourseCta({ item, isGuest, dogs, selectedDogId, enrollments: schoolEnrollments });
              if (!cta) return null;
              if (cta.type === "sign_in") {
                return (
                  <PremiumButton variant="primary" data-testid="shop-detail-free-signin" className="w-full justify-center py-3"
                                 onClick={() => { rememberFreeClaimIntent(item); onRequireAccount?.(item, "free_course"); }}>
                    {cta.label}
                  </PremiumButton>
                );
              }
              if (cta.type === "continue" || cta.type === "completed") {
                return (
                  <PremiumButton variant="secondary" onClick={() => onGoToOnlineSchool?.()} data-testid="shop-detail-free-continue" className="w-full justify-center py-3">
                    <i className="fas fa-graduation-cap mr-1.5" />{cta.label}
                  </PremiumButton>
                );
              }
              if (cta.type === "blocked") {
                return (
                  <PremiumButton variant="secondary" disabled data-testid="shop-detail-free-blocked" className="w-full justify-center py-3 opacity-60 cursor-not-allowed">
                    {cta.label}
                  </PremiumButton>
                );
              }
              if (cta.type === "add_dog") {
                // Never manufacture a placeholder dog — route into the real
                // add-dog workflow.
                return (
                  <PremiumButton variant="primary" onClick={() => onAddDog?.()} data-testid="shop-detail-free-add-dog" className="w-full justify-center py-3">
                    <i className="fas fa-dog mr-1.5" />{cta.label}
                  </PremiumButton>
                );
              }
              if (cta.type === "choose_dog") {
                return (
                  <PremiumButton variant="primary" disabled data-testid="shop-detail-free-choose-dog" className="w-full justify-center py-3 opacity-50 cursor-not-allowed">
                    {cta.label}
                  </PremiumButton>
                );
              }
              return (
                <PremiumButton variant="primary" onClick={() => onClaimFreeCourse?.(item, selectedDogId)}
                               data-testid="shop-detail-start-free-course" className="w-full justify-center py-3">
                  <i className="fas fa-play mr-1.5 text-[11px]" />{cta.label}
                </PremiumButton>
              );
            })() : isShopifyMerch ? (
              <PremiumButton variant="primary" onClick={handleShopifyClick} data-testid="shop-detail-view-options" className="w-full justify-center py-3">
                View Options <i className="fas fa-arrow-up-right-from-square ml-1 text-[11px]" />
              </PremiumButton>
            ) : isOnlineSchoolProgram ? (
              !selectedDogId ? (
                <PremiumButton variant="primary" disabled data-testid="shop-detail-purchase-disabled" className="w-full justify-center py-3 opacity-50 cursor-not-allowed">
                  Choose a Dog to Continue
                </PremiumButton>
              ) : selectedDogEnrollment?.status === "completed" ? (
                <PremiumButton variant="secondary" onClick={() => onGoToOnlineSchool?.()} data-testid="shop-detail-view-completed-course" className="w-full justify-center py-3">
                  <i className="fas fa-graduation-cap mr-1.5" />View Completed Course
                </PremiumButton>
              ) : selectedDogEnrollment?.status === "active" ? (
                <PremiumButton variant="secondary" onClick={() => onGoToOnlineSchool?.()} data-testid="shop-detail-go-to-online-school" className="w-full justify-center py-3">
                  <i className="fas fa-graduation-cap mr-1.5" />Go to Online School
                </PremiumButton>
              ) : selectedDogEnrollment?.status === "withdrawn" ? (
                // Phase 6 retake policy — the server itself rejects this
                // repurchase with a 409 (see _validate_shop_item_eligibility);
                // show that outcome up front instead of letting the client
                // reach checkout and fail there.
                <PremiumButton variant="secondary" disabled data-testid="shop-detail-withdrawn-disabled" className="w-full justify-center py-3 opacity-60 cursor-not-allowed">
                  Contact Us to Re-enroll
                </PremiumButton>
              ) : selectedDogEligibility?.eligible === false ? (
                <PremiumButton variant="secondary" disabled data-testid="shop-detail-prerequisite-disabled" className="w-full justify-center py-3 opacity-60 cursor-not-allowed">
                  <i className="fas fa-lock mr-1.5"/>Complete Prerequisites First
                </PremiumButton>
              ) : dogCartQty > 0 ? (
                <PremiumButton variant="primary" disabled data-testid="shop-detail-purchase-disabled" className="w-full justify-center py-3 opacity-50 cursor-not-allowed">
                  Already in Cart for This Dog
                </PremiumButton>
              ) : (
                <PremiumButton variant="primary" onClick={handlePurchase} data-testid="shop-detail-purchase" className="w-full justify-center py-3">
                  Buy Course
                </PremiumButton>
              )
            ) : guestBlocked ? (
              cta.type === "hidden_price" ? (
                <PremiumButton variant="primary" onClick={() => onRequireAccount?.(item, "hidden_price")} data-testid="shop-detail-hidden-price-cta" className="w-full justify-center py-3">
                  Sign In for Pricing
                </PremiumButton>
              ) : cta.type === "contact_required" ? (
                <div>
                  <PremiumButton variant="secondary" onClick={() => onRequireAccount?.(item, cta.reason)} data-testid="shop-detail-contact-required" className="w-full justify-center py-3">
                    {cta.reason === "dog" ? "Contact Us — Dog Selection Required" : "Contact Us — Approval Required"}
                  </PremiumButton>
                  <p className="text-[12px] text-shTextMuted mt-1">This item can&apos;t be completed online yet — our team will help you finish it.</p>
                </div>
              ) : (
                <PremiumButton variant="primary" onClick={() => onRequireAccount?.(item, null)} data-testid="shop-detail-sign-in-required" className="w-full justify-center py-3">
                  Sign In to Purchase
                </PremiumButton>
              )
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

      {discoverySlot}
    </div>
  );
}
