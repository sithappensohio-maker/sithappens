import { guestItemCta, creditPackDisplayInfo, singularUnit } from "../../lib/shopPolish";
import { isFreeClaimable } from "../../lib/freeCourseClaim";
import { packValue } from "../../lib/shopDepartments";
import { Price, Badges, Availability, ProductImage, CardShell, money } from "./ShopPrimitives";

/**
 * Four cards, because we sell four different kinds of thing.
 *
 * The Shop used to have ONE card with a pile of conditionals inside it, and
 * it showed a fourteen-day board-and-train the same way it showed a $14
 * water bowl: square photo, name, price, Add to Cart. That is the single
 * biggest reason the Shop read as an admin screen with products in it.
 *
 * So: a merch card is a photograph. A training card is an argument. A value
 * card is a comparison. A gift card is a present. They share primitives, not
 * a body — adding a fifth kind should mean writing a fifth card, not adding
 * a fifth branch to a card that already has four.
 *
 * Every one of them takes the same props, so the grid does not care which is
 * which.
 */

/** What the button should say and do, for a guest or a signed-in client. */
function useCta(item, mode) {
  const isGuest = mode === "guest";
  const shopify = item.kind === "product" && item.sales_destination === "shopify_external";
  const cta = isGuest ? guestItemCta(item) : null;
  const soldOut = item.availability === "out_of_stock"
    || (item.kind === "product" && !shopify && item.track_inventory && item.in_stock === false);
  return {
    isGuest, shopify, soldOut,
    blocked: isGuest && cta && cta.type !== "add_to_cart" && cta.type !== "shopify",
    reason: cta?.type,
    reasonDetail: cta?.reason,
  };
}

function ActionButton({ children, onClick, variant = "primary", disabled, testId, title }) {
  const base = "w-full relative z-20 px-3 py-2.5 rounded-lg text-[12px] font-black uppercase "
    + "tracking-[0.1em] transition focus-visible:outline focus-visible:outline-2 "
    + "focus-visible:outline-offset-2 focus-visible:outline-shPrimary";
  const look = disabled
    ? "border border-shBorder text-shTextMuted cursor-not-allowed bg-black/20"
    : variant === "primary"
      ? "bg-shPrimary text-bgHeader hover:brightness-110"
      : "border border-shBorder text-shText hover:border-shPrimary/60 bg-black/20";
  return (
    <button type="button" disabled={disabled} title={title} data-testid={testId}
            onClick={(e) => { e.stopPropagation(); onClick?.(e); }}
            className={`${base} ${look}`}>
      {children}
    </button>
  );
}

/** The action row, shared by every card so "Sign in to buy" reads the same
 *  way everywhere it appears. */
function CardAction({ item, mode, onAdd, onOpenDetail, onRequireAccount, onShopify, addLabel }) {
  const s = useCta(item, mode);
  const id = `shop-buy-${item.kind}-${item.id}`;
  // A genuinely free course is CLAIMED, never carted — no $0 order, no
  // Stripe session, no receipt for nothing. The card sends you to the
  // detail page, which is where dog selection and the claim actually live.
  // This survived the card redesign only because the tests that pinned it
  // failed loudly when it did not.
  if (isFreeClaimable(item)) {
    return <ActionButton testId={`shop-start-free-${item.id}`}
                         onClick={() => onOpenDetail?.(item)}>
      Start Free Course
    </ActionButton>;
  }
  if (s.shopify) {
    return <ActionButton testId={id} variant="secondary" onClick={() => onShopify?.(item)}>
      View on Shopify <i className="fas fa-arrow-up-right-from-square ml-1 text-[10px]" aria-hidden="true" />
    </ActionButton>;
  }
  if (s.blocked) {
    const label = s.reason === "hidden_price" ? "Sign in for pricing"
      : s.reason === "contact_required"
        ? (s.reasonDetail === "dog" ? "Contact us — dog required" : "Contact us — approval required")
        : "Sign in to buy";
    return <ActionButton testId={id} variant="secondary"
                         onClick={() => onRequireAccount?.(item, s.reasonDetail || s.reason)}>
      {label}
    </ActionButton>;
  }
  if (s.soldOut) {
    return <ActionButton testId={id} disabled title="This is out of stock">Sold out</ActionButton>;
  }
  return <ActionButton testId={id} onClick={() => onAdd?.(item, 1)}>{addLabel}</ActionButton>;
}

// ══════════════════════════════════════════════════════════ merchandise

/**
 * A thing in a box. The photograph does the selling, so it gets the space
 * and everything else is one line each. No description — a paragraph on a
 * grid card is a paragraph nobody reads.
 */
export function MerchCard(props) {
  const { item, mode, onOpenDetail } = props;
  return (
    <CardShell favorite={props.favoriteSlot?.(item)} onOpen={() => onOpenDetail?.(item)} label={`View ${item.name}`}
               testId={`shop-card-${item.kind}-${item.id}`}
               className="rounded-2xl">
      <ProductImage item={item} surface="card" ratio="4 / 5" isPublic={mode === "guest"}
                    className="group-hover:[&>img]:scale-[1.03]" />
      <Badges item={item} bestSellerIds={props.bestSellerIds} className="absolute top-2 left-2 z-[5]" />
      <div className="pt-3 flex flex-col gap-1 flex-1">
        <p className="text-[14px] font-bold text-shText leading-snug line-clamp-2">{item.name}</p>
        <div className="flex items-center justify-between gap-2 mt-auto pt-1">
          {isFreeClaimable(item) ? (
            <p className="text-shPrimary font-black text-[18px]"
               data-testid={`shop-free-badge-${item.id}`}>FREE</p>
          ) : (
            <Price amount={item.price} />
          )}
          <Availability item={item} />
        </div>
      </div>
      <div className="pt-3"><CardAction {...props} addLabel="Add to Cart" /></div>
    </CardShell>
  );
}

// ═══════════════════════════════════════════════════════════════ training

/**
 * Not a T-shirt.
 *
 * Somebody deciding on a $950 programme needs to know what it is for before
 * they need to know what it costs, so this card leads with what it helps
 * with and how long it takes. Everything shown comes from the program
 * document — `helps_with`, `format`, `estimated_weeks`. Where a program has
 * not filled those in, the card simply says less rather than inventing a
 * promise on the trainer's behalf.
 */
export function TrainingCard(props) {
  const { item, mode, onOpenDetail } = props;
  const helps = (item.helps_with || []).slice(0, 3);
  const count = item.format_count ?? item.format?.count;
  const unit = item.format_unit || item.format?.unit;
  const weeks = item.estimated_weeks;
  const isSchool = item.purchase_fulfillment === "online_school";
  const facts = [
    count ? `${count} ${count === 1 ? singularUnit(unit) : unit || "sessions"}` : null,
    weeks ? `about ${weeks} weeks` : null,
    isSchool ? "Work at your own pace" : item.requires_dog ? "Choose your dog at checkout" : null,
  ].filter(Boolean);

  return (
    <CardShell favorite={props.favoriteSlot?.(item)} onOpen={() => onOpenDetail?.(item)} label={`View ${item.name}`}
               testId={`shop-card-${item.kind}-${item.id}`}
               className="rounded-2xl border border-shBorder overflow-hidden bg-[var(--sh-card-base)] hover:border-shSecondary/50 transition">
      <div className="grid sm:grid-cols-[minmax(0,200px)_1fr]">
        <ProductImage item={item} surface="card" ratio="4 / 3" isPublic={mode === "guest"}
                      className="rounded-none sm:rounded-none" />
        <div className="p-4 flex flex-col gap-2 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {isSchool && (
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-shSecondary">
                  <i className="fas fa-graduation-cap mr-1.5" aria-hidden="true" />Online School
                </p>
              )}
              <h3 className="sh-display text-[18px] sm:text-[20px] text-shText leading-tight mt-0.5">{item.name}</h3>
            </div>
            <Badges item={item} bestSellerIds={props.bestSellerIds} />
          </div>

          {item.description && (
            <p className="text-[13px] text-shTextMuted leading-relaxed line-clamp-2">{item.description}</p>
          )}

          {helps.length > 0 && (
            <ul className="flex flex-wrap gap-1.5 mt-0.5" aria-label="What this helps with">
              {helps.map((h) => (
                <li key={h} className="px-2 py-1 rounded-full border border-shSecondary/30 bg-shSecondary/10 text-shSecondary text-[11px] font-bold">
                  {h}
                </li>
              ))}
            </ul>
          )}

          {facts.length > 0 && (
            <p className="text-[12px] text-shTextMuted">{facts.join(" · ")}</p>
          )}

          <div className="flex items-center justify-between gap-3 mt-auto pt-2">
            {isFreeClaimable(item) ? (
              <p className="text-shPrimary font-black text-[18px]"
                 data-testid={`shop-free-badge-${item.id}`}>FREE</p>
            ) : (
              <Price amount={item.price} size="md" />
            )}
            <div className="w-[150px] shrink-0">
              <CardAction {...props} addLabel={isSchool ? "Enrol" : "Add to Cart"} />
            </div>
          </div>
        </div>
      </div>
    </CardShell>
  );
}

// ═══════════════════════════════════════════════════════ prepaid value

/**
 * A comparison, not a product.
 *
 * The number that decides a prepaid pack is the price per visit, so that is
 * the number this card makes big. A saving is shown ONLY when a real
 * single-visit baseline proves one — `packValue` returns null rather than
 * guessing, and this card shows nothing rather than a made-up percentage.
 */
export function ValueCard(props) {
  const { item, mode, onOpenDetail, baselinePrice } = props;
  const value = packValue(item, baselinePrice);
  const info = creditPackDisplayInfo(item);
  return (
    <CardShell favorite={props.favoriteSlot?.(item)} onOpen={() => onOpenDetail?.(item)} label={`View ${item.name}`}
               testId={`shop-card-${item.kind}-${item.id}`}
               className="rounded-2xl border border-shBorder bg-[var(--sh-card-base)] p-5 hover:border-shPrimary/50 transition">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-shTextMuted">
            {info.serviceType === "training" ? "Training" : "Daycare"}
          </p>
          <h3 className="sh-display text-[22px] text-shText leading-tight mt-1">{item.name}</h3>
        </div>
        {value?.savingPct != null && (
          <span className="px-2 py-1 rounded-full bg-shPrimary text-bgHeader text-[11px] font-black uppercase tracking-wider shrink-0"
                data-testid="shop-pack-saving">Save {value.savingPct}%</span>
        )}
      </div>

      {value && (
        <div className="mt-4 flex items-end gap-2">
          <span className="text-[34px] font-black text-shPrimary leading-none tabular-nums"
                data-testid="shop-pack-each">{money(value.each)}</span>
          <span className="text-[13px] text-shTextMuted pb-1">
            per {singularUnit(value.unit)}
          </span>
        </div>
      )}

      <p className="text-[13px] text-shTextMuted mt-2">
        {value ? `${value.quantity} ${value.unit} · ${money(item.price)} up front` : money(item.price)}
      </p>
      <p className="text-[12px] text-shTextMuted mt-3 leading-relaxed">
        Use them whenever you like — they do not expire, and they come off
        your balance automatically at check-in.
      </p>

      <div className="mt-4"><CardAction {...props} addLabel="Add to Cart" /></div>
    </CardShell>
  );
}

// ══════════════════════════════════════════════════════════ gift cards

/**
 * A present. It should not look like a bag of kibble with a price on it.
 *
 * The amount is the whole product, so the amount is the whole card.
 */
export function GiftCardCard(props) {
  const { item, onOpenDetail } = props;
  return (
    <CardShell favorite={props.favoriteSlot?.(item)} onOpen={() => onOpenDetail?.(item)} label={`Buy a ${item.name}`}
               testId={`shop-card-${item.kind}-${item.id}`}
               className="rounded-2xl p-5 border border-shPrimary/30 bg-gradient-to-br from-shPrimary/12 via-[var(--sh-card-base)] to-shSecondary/10 hover:border-shPrimary/60 transition">
      <div className="flex items-center justify-between">
        <i className="fas fa-gift text-shPrimary text-lg" aria-hidden="true" />
        <span className="text-[10px] font-black uppercase tracking-[0.18em] text-shTextMuted">Gift card</span>
      </div>
      {/* Stage 1 — a fixed 40px was wider than the tile in a two-up phone
          grid, so "$100.00" — the whole product — overflowed its own card.
          The type now starts smaller and grows with the room available. */}
      <p className="text-[28px] sm:text-[36px] lg:text-[40px] font-black text-shText leading-none mt-4 tabular-nums break-words">
        {money(item.price)}
      </p>
      <p className="text-[12px] text-shTextMuted mt-3 leading-relaxed"
         data-testid={`shop-gift-card-line-${item.id}`}>
        Emailed straight through — there is nothing to collect. Spend it on
        anything we sell; it does not expire, and there is no sales tax on it.
      </p>
      <div className="mt-4"><CardAction {...props} addLabel="Choose this amount" /></div>
    </CardShell>
  );
}

/**
 * The right card for the thing. One place decides, so a new department
 * cannot end up rendering through whichever card happened to be default.
 */
export function ShopCard(props) {
  const kind = props.item?.kind;
  if (kind === "gift_card") return <GiftCardCard {...props} />;
  if (kind === "credit_pack") return <ValueCard {...props} />;
  if (kind === "training_program") return <TrainingCard {...props} />;
  return <MerchCard {...props} />;
}
