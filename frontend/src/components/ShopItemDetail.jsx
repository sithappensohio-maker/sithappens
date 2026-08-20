import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { toast } from "sonner";
import { isFreeClaimable, freePriceLabel, freeCourseCta, rememberFreeClaimIntent } from "../lib/freeCourseClaim";
import PremiumButton from "./premium/PremiumButton";
import NeonEdge from "./premium/NeonEdge";
import HuskyDogImage from "./brand/HuskyDogImage";
import { useShopMediaSrc } from "./ItemThumbnail";
import { guestItemCta, creditPackDetailLine } from "../lib/shopPolish";

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
    return item.shopify_display_price != null ? (
      <p className="text-shPrimary font-black text-[26px]">
        {item.shopify_from_price ? "From " : ""}{money(item.shopify_display_price)}
      </p>
    ) : null;
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

/* Related items reuse the already-loaded, already-priced catalog array —
 * no second backend call, guaranteed to already be visibility-filtered and
 * resolver-priced exactly like the grid. */
function RelatedItems({ item, allItems, onOpenItem, isPublic }) {
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
            <ImgOrPlaceholder imageId={r.image_id} alt={r.name} isPublic={isPublic} />
            <p className="text-shText font-bold text-[12px] mt-1.5 truncate">{r.name}</p>
            {/* A claimable free course reads FREE here too, so the label a
                client sees never depends on which strip they found it in. */}
            {isFreeClaimable(r) ? (
              <p className="text-shPrimary font-black text-[13px]" data-testid={`shop-related-free-${r.id}`}>FREE</p>
            ) : (r.price ?? r.effective_price) != null && (
              <p className="text-shPrimary font-black text-[13px]">{money(r.price ?? r.effective_price)}</p>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function ImgOrPlaceholder({ imageId, alt, isPublic }) {
  const src = useShopMediaSrc(imageId, { public: isPublic });
  if (src) return <img src={src} alt={alt || ""} style={{ height: 80 }} className="w-full object-cover rounded" />;
  return (
    <div style={{ height: 80 }} className="w-full rounded border border-shBorder grid place-items-center text-shTextMuted">
      <i className="fas fa-image" />
    </div>
  );
}

function HeroImage({ imageId, alt, isPublic, fallbackSrc }) {
  const src = useShopMediaSrc(imageId, { public: isPublic });
  const [enlarged, setEnlarged] = useState(false);
  return (
    <>
      <button type="button" onClick={() => src && setEnlarged(true)} data-testid="shop-detail-hero-image"
              className="block w-full rounded-xl border border-shBorder overflow-hidden" style={{ background: "var(--sh-card-base)", cursor: src ? "zoom-in" : "default" }}>
        {src ? (
          <img src={src} alt={alt || ""} className="w-full object-cover" style={{ height: 360 }} />
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
      {enlarged && (
        <div className="fixed inset-0 z-[70] bg-black/90 flex items-center justify-center p-4" onClick={() => setEnlarged(false)} data-testid="shop-detail-lightbox">
          <img src={src} alt={alt || ""} className="max-w-full max-h-full object-contain rounded" />
        </div>
      )}
    </>
  );
}

export default function ShopItemDetail({ kind, itemId, cart, onAddToCart, onBack, allItems, onOpenItem, mode = "authenticated", onRequireAccount, onGoToOnlineSchool, onClaimFreeCourse, onAddDog, dogs = [] }) {
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
  const [schoolEnrollments, setSchoolEnrollments] = useState(null);
  useEffect(() => {
    if (!isOnlineSchoolProgram) { setSchoolEnrollments(null); return; }
    let cancelled = false;
    api.get("/portal/school").then(({ data }) => { if (!cancelled) setSchoolEnrollments(data || []); }).catch(() => { if (!cancelled) setSchoolEnrollments([]); });
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
          <HeroImage imageId={item.image_id} alt={item.name} isPublic={isGuest} fallbackSrc={isOnlineSchoolProgram ? "/brand/husky-placeholder-silver-white.png" : null} />
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
          <h1 className={`${isOnlineSchoolProgram ? "sh-display text-3xl sm:text-4xl leading-none" : "text-2xl font-bold"} text-shText mt-1`}>{item.name}</h1>

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

          <div className="mt-auto pt-6 space-y-3">
            {item.kind === "product" && !isShopifyMerch && !outOfStock && !atMaxInCart && !guestBlocked && (
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

      <RelatedItems item={item} allItems={allItems} onOpenItem={onOpenItem} isPublic={isGuest} />
    </div>
  );
}
