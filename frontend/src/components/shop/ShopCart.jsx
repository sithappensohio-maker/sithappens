import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { guestItemCta, isInternalPhysical, stockCeiling, cartLineUnitPrice, cartLineVariant } from "../../lib/shopPolish";
import { money, Price, ProductImage, QuantityStepper } from "./ShopPrimitives";

/**
 * The cart, rebuilt around what each line actually IS.
 *
 * None of the commerce logic moved. Quantities, gift identity, stock
 * ceilings, guest eligibility and the checkout call are all exactly where
 * they were — this is the customer's view of them.
 *
 * What changed is that a cart line used to be a name and a number for
 * everything in it, which is fine for a leash and useless for a gift card
 * addressed to somebody else or a course booked to a named dog. A line now
 * says who or what it is for, because that is the thing a shopper checks
 * before they pay.
 */

/**
 * Why a cart cannot be checked out as a guest — by LINE, so the answer is
 * "these two things", not "something".
 *
 * Mirrors `guestItemCta`, which mirrors the server's own rule. The server
 * refuses regardless; this is so the refusal is not a surprise.
 */
export function guestBlockers(lines) {
  return lines
    .map((l) => ({ line: l, cta: guestItemCta(l.item || {}) }))
    .filter(({ cta }) => cta.type !== "add_to_cart" && cta.type !== "shopify")
    .map(({ line }) => line);
}

function LineContext({ line }) {
  const bits = [];
  const variant = cartLineVariant(line.item, line.variant_id);
  if (variant) {
    bits.push({ icon: "fa-ruler", text: variant.name, testId: "cart-line-variant" });
  }
  if (line.personalization) {
    bits.push({
      icon: "fa-pen",
      text: Object.entries(line.personalization).map(([k, v]) => `${k}: ${v}`).join(" · "),
      testId: "cart-line-personalization",
    });
  }
  if (line.dog_name) {
    bits.push({ icon: "fa-paw", text: `For ${line.dog_name}`, testId: "cart-line-dog" });
  }
  if (line.gift?.recipient_email) {
    bits.push({
      icon: "fa-gift",
      text: `To ${line.gift.recipient_name || line.gift.recipient_email}`,
      testId: "cart-line-gift",
    });
  }
  if (line.item && isInternalPhysical(line.item)) {
    bits.push({ icon: "fa-store", text: "Collect in store", testId: "cart-line-pickup" });
  }
  if (line.item?.kind === "gift_card" && !line.gift?.recipient_email) {
    bits.push({ icon: "fa-envelope", text: "Emailed to you", testId: "cart-line-self" });
  }
  if (!bits.length) return null;
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
      {bits.map((b) => (
        <li key={b.testId} data-testid={b.testId}
            className="text-[11.5px] text-shTextMuted inline-flex items-center gap-1.5">
          <i className={`fas ${b.icon} text-shSecondary text-[10px]`} aria-hidden="true" />
          {b.text}
        </li>
      ))}
    </ul>
  );
}

export function CartLine({ line, onQtyChange, onRemove, guestBlocked }) {
  const item = line.item || {};
  // A gift card's quantity is a count of cards for one named person, and a
  // dog-bound course is one enrolment — neither is a thing you buy "three
  // of" from a stepper. Only merchandise gets one.
  // A personalized line is one specific physical item — no stepper, same
  // "one at a time" reasoning as a dog-bound course line (!line.dog_id).
  const adjustable = item.kind === "product" && !line.dog_id && !line.personalization;
  const ceiling = stockCeiling(item);
  const unitPrice = cartLineUnitPrice(item, line.variant_id);

  return (
    <li className={`flex gap-3 py-4 ${guestBlocked ? "opacity-95" : ""}`}
        data-testid={`shop-cart-line-${line.kind}-${line.ref_id}`}>
      <div className="w-[68px] shrink-0">
        <ProductImage item={item} surface="thumb" ratio="1 / 1" alt="" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[14px] font-bold text-shText leading-snug">{item.name || "Item"}</p>
            <LineContext line={line} />
            {guestBlocked && (
              <p className="text-[11.5px] text-shOrange mt-1.5 inline-flex items-center gap-1.5"
                 data-testid="cart-line-needs-account">
                <i className="fas fa-circle-info text-[10px]" aria-hidden="true" />
                Needs an account
              </p>
            )}
          </div>
          <div className="text-right shrink-0">
            <Price amount={unitPrice * line.quantity} size="sm" />
            {line.quantity > 1 && (
              <p className="text-[11px] text-shTextMuted mt-0.5">{money(unitPrice)} each</p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 mt-2.5">
          {adjustable ? (
            <QuantityStepper value={line.quantity} max={ceiling ?? undefined}
                             idSuffix={`-${line.ref_id}`}
                             onChange={(q) => onQtyChange(line.kind, line.ref_id, q, line.dog_id, line.gift, line.variant_id, line.personalization)} />
          ) : (
            <span className="text-[12px] text-shTextMuted">Qty {line.quantity}</span>
          )}
          <button type="button"
                  onClick={() => onRemove(line.kind, line.ref_id, line.dog_id, line.gift, line.variant_id, line.personalization)}
                  aria-label={`Remove ${item.name || "item"} from your cart`}
                  data-testid={`shop-cart-remove-${line.ref_id}`}
                  className="text-[12px] font-bold text-shTextMuted hover:text-shDanger transition
                             focus-visible:outline focus-visible:outline-2 focus-visible:outline-shPrimary rounded
                             px-2 py-2 -my-2 -mr-2">
            Remove
          </button>
        </div>
      </div>
    </li>
  );
}

/**
 * The order summary.
 *
 * Subtotal is the sum of the LINES before tax; tax is its own row; the total
 * is the two added up. The browser QA on guest checkout caught exactly this
 * going wrong once — per-line amounts that already contained their share of
 * the tax, printed above a tax-exclusive subtotal, so the arithmetic on
 * screen did not add up. The labels here are deliberately unambiguous, and
 * the test pinning that stays in place.
 *
 * Tax is only ever shown when the server has told us what it is. Before
 * checkout it has not, so this says so rather than guessing.
 */
export function CartSummary({ subtotal, tax, total, note, discountLabel, discountEstimate }) {
  const showTax = tax != null;
  const showDiscount = discountLabel && discountEstimate > 0;
  // An estimate only — shown so the discount feels real before checkout,
  // but the server (never this) decides the actual amount charged.
  const displayed = showTax ? total : subtotal - (showDiscount ? discountEstimate : 0);
  return (
    <div className="space-y-2" data-testid="shop-cart-summary">
      <div className="flex items-center justify-between text-[13px]">
        <span className="text-shTextMuted">Subtotal</span>
        <span className="text-shText font-bold tabular-nums" data-testid="cart-subtotal">{money(subtotal)}</span>
      </div>
      {showDiscount && (
        <div className="flex items-center justify-between text-[13px]" data-testid="cart-discount">
          <span className="text-shSecondary">Discount ({discountLabel})</span>
          <span className="text-shSecondary font-bold tabular-nums">−{money(discountEstimate)}</span>
        </div>
      )}
      {showTax && (
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-shTextMuted">Sales tax</span>
          <span className="text-shText font-bold tabular-nums" data-testid="cart-tax">{money(tax)}</span>
        </div>
      )}
      <div className="flex items-center justify-between pt-2 border-t border-shBorder">
        <span className="text-shText font-black text-[15px]">Total</span>
        <span className="text-shPrimary font-black text-[20px] tabular-nums" data-testid="cart-total">
          {money(displayed)}
        </span>
      </div>
      <p className="text-[11.5px] text-shTextMuted leading-relaxed pt-1">
        {showTax
          ? "You'll pay on Stripe's secure checkout — Sit Happens never sees your card details."
          : "Sales tax, where it applies, is added at checkout. You'll pay on Stripe's secure checkout — Sit Happens never sees your card details."}
      </p>
      {note}
    </div>
  );
}

/**
 * "Have a code?" — a code is validated for eligibility here (does it
 * exist, is it active, does this account qualify) but the actual discount
 * amount shown is an ESTIMATE computed client-side from the applied code's
 * kind/value; the real one is always computed fresh server-side at
 * checkout (see _price_shop_cart), never trusted from this estimate.
 */
export function DiscountCodeField({ applied, onApply, onRemove, busy }) {
  const [value, setValue] = useState("");
  if (applied) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-shSecondary/40 bg-shSecondary/10 px-3 py-2"
           data-testid="cart-discount-applied">
        <span className="text-[12.5px] font-bold text-shSecondary">
          <i className="fas fa-tag mr-1.5" aria-hidden="true" />
          {applied.code} applied
        </span>
        <button type="button" onClick={onRemove} data-testid="cart-discount-remove"
                className="text-[11.5px] text-shTextMuted hover:text-shDanger underline">
          Remove
        </button>
      </div>
    );
  }
  return (
    <form className="flex gap-2" data-testid="cart-discount-form"
          onSubmit={(e) => { e.preventDefault(); onApply(value); }}>
      <input value={value} onChange={(e) => setValue(e.target.value)}
             placeholder="Have a code?" data-testid="cart-discount-input"
             className="flex-1 min-w-0 rounded-lg border border-shBorder bg-transparent px-3 py-2 text-[13px] text-shText
                        placeholder:text-shTextMuted focus-visible:outline focus-visible:outline-2 focus-visible:outline-shPrimary" />
      <button type="submit" disabled={!value.trim() || busy} data-testid="cart-discount-apply"
              className="shrink-0 px-3.5 py-2 rounded-lg border border-shBorder text-[12px] font-bold text-shText
                         hover:border-shPrimary/60 transition disabled:opacity-40">
        {busy ? "…" : "Apply"}
      </button>
    </form>
  );
}

/**
 * The account-required state.
 *
 * The brief is explicit that a disabled Checkout button is not an answer.
 * This names the lines, says the cart is safe, and gives both doors — and it
 * never offers to remove anything on the shopper's behalf.
 */
export function AccountRequiredNotice({ blockedLines, onSignIn }) {
  return (
    <div className="rounded-xl border border-shSecondary/40 bg-shSecondary/10 p-3.5"
         data-testid="cart-account-required">
      <p className="text-[13px] font-bold text-shText">
        {blockedLines.length === 1
          ? "One item needs to be connected to your account"
          : `${blockedLines.length} items need to be connected to your account`}
      </p>
      <ul className="mt-1.5 space-y-0.5">
        {blockedLines.map((l) => (
          <li key={`${l.kind}-${l.ref_id}`} className="text-[12px] text-shTextMuted">
            · {l.item?.name}
          </li>
        ))}
      </ul>
      <p className="text-[12px] text-shTextMuted mt-2 leading-relaxed">
        Prepaid visits and training are booked to your dog&apos;s account, so we
        need to know whose they are. Sign in and pick up exactly where you left
        off — <strong className="text-shText">your cart stays as it is</strong>.
      </p>
      <button type="button" onClick={onSignIn} data-testid="cart-sign-in"
              className="w-full mt-3 py-2.5 rounded-lg bg-shPrimary text-bgHeader text-[12px] font-black
                         uppercase tracking-widest hover:brightness-110 transition
                         focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-shPrimary">
        Sign in or create an account
      </button>
    </div>
  );
}

const BLANK_SHIPPING_ADDRESS = { address1: "", address2: "", city: "", region: "", zip: "" };

/**
 * Every physical line must itself be shippable — mirrors
 * domains.shop.shipping.cart_shippable exactly (all-or-nothing; a cart
 * with nothing physical is never shippable either). Exported so a
 * parent can reset its own shipping-address state the moment a cart
 * change — adding a pickup-only item, say — makes the choice invalid,
 * not just so CartPanel can decide whether to show it.
 */
export function cartShippable(lines) {
  const physical = (lines || []).filter((l) => l.item?.kind === "product");
  return physical.length > 0 && physical.every((l) => l.item?.shippable);
}

export function shippingAddressComplete(address) {
  return !!(address && address.address1.trim() && address.city.trim() && address.region.trim() && address.zip.trim());
}

/**
 * Pickup vs ship — rendered only when every physical line in the cart
 * can actually be shipped (domains.shop.shipping's all-or-nothing rule;
 * CartPanel below computes that). The real shipping cost is never
 * estimated here — same "calculated at checkout" treatment this app
 * already gives sales tax (see CartSummary's own note) — it comes from a
 * real FedEx rate quote once checkout actually prices the cart.
 */
function ShippingChoice({ address, onChange }) {
  const shipping = address != null;
  const setField = (field, value) => onChange({ ...(address || BLANK_SHIPPING_ADDRESS), [field]: value });
  const fieldCls = "w-full rounded-lg border border-shBorder bg-transparent px-3 py-2 text-[13px] text-shText "
    + "placeholder:text-shTextMuted focus-visible:outline focus-visible:outline-2 focus-visible:outline-shPrimary";

  return (
    <div className="space-y-2" data-testid="shop-shipping-choice">
      <div className="flex gap-2">
        <button type="button" onClick={() => onChange(null)} data-testid="shop-shipping-pickup"
                className={`flex-1 px-3 py-2 rounded-lg text-[12px] font-black uppercase tracking-widest border transition
                           ${!shipping ? "bg-shPrimary text-bgHeader border-shPrimary" : "border-shBorder text-shTextMuted hover:border-shPrimary/50"}`}>
          Pick up in store
        </button>
        <button type="button" onClick={() => onChange(address || BLANK_SHIPPING_ADDRESS)} data-testid="shop-shipping-ship"
                className={`flex-1 px-3 py-2 rounded-lg text-[12px] font-black uppercase tracking-widest border transition
                           ${shipping ? "bg-shPrimary text-bgHeader border-shPrimary" : "border-shBorder text-shTextMuted hover:border-shPrimary/50"}`}>
          Ship to me
        </button>
      </div>
      {shipping && (
        <div className="space-y-2" data-testid="shop-shipping-address-form">
          <input value={address.address1} onChange={(e) => setField("address1", e.target.value)}
                 placeholder="Street address" data-testid="shop-shipping-address1" className={fieldCls} />
          <input value={address.address2} onChange={(e) => setField("address2", e.target.value)}
                 placeholder="Apt / suite (optional)" data-testid="shop-shipping-address2" className={fieldCls} />
          <div className="grid grid-cols-3 gap-2">
            <input value={address.city} onChange={(e) => setField("city", e.target.value)}
                   placeholder="City" data-testid="shop-shipping-city" className={`col-span-1 ${fieldCls}`} />
            <input value={address.region} onChange={(e) => setField("region", e.target.value.toUpperCase())}
                   placeholder="State" maxLength={2} data-testid="shop-shipping-region" className={fieldCls} />
            <input value={address.zip} onChange={(e) => setField("zip", e.target.value)}
                   placeholder="ZIP" data-testid="shop-shipping-zip" className={fieldCls} />
          </div>
          <p className="text-[11px] text-shTextMuted">Shipping cost (FedEx Ground) is calculated at checkout.</p>
        </div>
      )}
    </div>
  );
}

/**
 * Whether the cart has a Printify (print-on-demand) line — mirrors
 * server._price_shop_cart's own `printify_fulfilled` snapshot exactly, so
 * this never disagrees with what checkout will actually require. A cart
 * with one of these needs the pickup-or-ship choice below before checkout,
 * same requirement the register's own PrintifyFulfillmentModal enforces.
 */
export function hasPrintifyLine(lines) {
  return (lines || []).some((l) => l.item?.sales_destination === "printify");
}

const BLANK_PRINTIFY_ADDRESS = { address1: "", address2: "", city: "", region: "", zip: "" };

/**
 * Pickup vs ship for a Printify line — same shape and fields as
 * ShippingChoice, deliberately NOT asking for a name, email or phone:
 * Printify's shipping label uses the buyer's own identity (account name/
 * email, or what a guest typed at checkout), never collected twice. See
 * server._printify_ship_to_address.
 */
export function PrintifyShipChoice({ fulfillment, onChange }) {
  const shipping = fulfillment?.method === "ship";
  const address = fulfillment?.shipping_address || BLANK_PRINTIFY_ADDRESS;
  const setField = (field, value) => onChange({ method: "ship", shipping_address: { ...address, [field]: value } });
  const fieldCls = "w-full rounded-lg border border-shBorder bg-transparent px-3 py-2 text-[13px] text-shText "
    + "placeholder:text-shTextMuted focus-visible:outline focus-visible:outline-2 focus-visible:outline-shPrimary";

  return (
    <div className="space-y-2" data-testid="shop-printify-fulfillment">
      <p className="text-[11px] text-shTextMuted">
        <i className="fas fa-shirt mr-1.5" aria-hidden="true" />
        This order includes a made-to-order item — how should it reach you?
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={() => onChange({ method: "pickup", shipping_address: null })}
                data-testid="shop-printify-pickup"
                className={`flex-1 px-3 py-2 rounded-lg text-[12px] font-black uppercase tracking-widest border transition
                           ${!shipping ? "bg-shPrimary text-bgHeader border-shPrimary" : "border-shBorder text-shTextMuted hover:border-shPrimary/50"}`}>
          Pick up in store
        </button>
        <button type="button" onClick={() => onChange({ method: "ship", shipping_address: address })}
                data-testid="shop-printify-ship"
                className={`flex-1 px-3 py-2 rounded-lg text-[12px] font-black uppercase tracking-widest border transition
                           ${shipping ? "bg-shPrimary text-bgHeader border-shPrimary" : "border-shBorder text-shTextMuted hover:border-shPrimary/50"}`}>
          Ship to me
        </button>
      </div>
      {shipping && (
        <div className="space-y-2" data-testid="shop-printify-address-form">
          <input value={address.address1} onChange={(e) => setField("address1", e.target.value)}
                 placeholder="Street address" data-testid="shop-printify-address1" className={fieldCls} />
          <input value={address.address2} onChange={(e) => setField("address2", e.target.value)}
                 placeholder="Apt / suite (optional)" data-testid="shop-printify-address2" className={fieldCls} />
          <div className="grid grid-cols-3 gap-2">
            <input value={address.city} onChange={(e) => setField("city", e.target.value)}
                   placeholder="City" data-testid="shop-printify-city" className={`col-span-1 ${fieldCls}`} />
            <input value={address.region} onChange={(e) => setField("region", e.target.value.toUpperCase())}
                   placeholder="State" maxLength={2} data-testid="shop-printify-region" className={fieldCls} />
            <input value={address.zip} onChange={(e) => setField("zip", e.target.value)}
                   placeholder="ZIP" data-testid="shop-printify-zip" className={fieldCls} />
          </div>
          <p className="text-[11px] text-shTextMuted">Made after you check out — Printify ships it straight to this address. Shipping cost (Printify's own rate) is calculated at checkout.</p>
        </div>
      )}
    </div>
  );
}

/**
 * The cart itself. A dialog, with the focus handling a dialog owes you:
 * Escape closes it, focus moves in on open and back to whatever opened it
 * on close.
 */
export default function CartPanel({
  lines, subtotal, onQtyChange, onRemove, onCheckout, busy, previewMode,
  onClose, guestMode, onSignIn,
  appliedDiscount, onApplyDiscountCode, onRemoveDiscountCode, discountBusy,
  loyaltyDiscount,
  shippingAddress, onShippingAddressChange,
  printifyFulfillment, onPrintifyFulfillmentChange,
}) {
  const panelRef = useRef(null);
  const returnFocusRef = useRef(null);
  // Collapses the "Have a code?" form behind a link when a loyalty
  // discount is already active — see the render below.
  const [showCodeField, setShowCodeField] = useState(false);

  useEffect(() => {
    returnFocusRef.current = document.activeElement;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    panelRef.current?.querySelector("button")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      try { returnFocusRef.current?.focus?.(); } catch { /* it may be gone */ }
    };
  }, [onClose]);

  const blocked = guestMode ? guestBlockers(lines) : [];
  const blockedKeys = new Set(blocked.map((l) => `${l.kind}:${l.ref_id}`));
  // Shipping V1 is clients only (not guest checkout or preview).
  const canShip = !guestMode && !previewMode && cartShippable(lines);
  const shippingIncomplete = shippingAddress != null && !shippingAddressComplete(shippingAddress);
  // Printify's own ship-or-pickup choice — client cart view only; a guest
  // makes this same choice inside GuestCheckoutPanel instead, where their
  // identity (name/email/phone) already lives.
  const showPrintifyChoice = !guestMode && !previewMode && hasPrintifyLine(lines) && onPrintifyFulfillmentChange;
  const printifyIncomplete = showPrintifyChoice && printifyFulfillment?.method === "ship"
    && !shippingAddressComplete(printifyFulfillment.shipping_address);
  const canCheckout = !previewMode && lines.length > 0 && (!guestMode || blocked.length === 0)
    && !shippingIncomplete && !printifyIncomplete;

  // Every code today is clients_only — gift cards never count (money, not
  // a purchase, same rule the server applies). Estimate only; see
  // CartSummary's own note on this.
  const discountableSubtotal = lines
    .filter((l) => l.item?.kind !== "gift_card")
    .reduce((sum, l) => sum + cartLineUnitPrice(l.item, l.variant_id) * l.quantity, 0);
  const codeEstimate = appliedDiscount
    ? (appliedDiscount.kind === "percent"
        ? Math.round(discountableSubtotal * (appliedDiscount.value / 100) * 100) / 100
        : Math.min(appliedDiscount.value, discountableSubtotal))
    : 0;
  // A loyal client's automatic discount (see domains.shop.loyalty_discount)
  // never stacks with a code — whichever is larger is the one that will
  // actually be charged, a tie favors loyalty. Mirrors _price_shop_cart
  // exactly so this estimate never disagrees with the real checkout.
  const loyaltyEstimate = loyaltyDiscount?.eligible
    ? Math.round(discountableSubtotal * (loyaltyDiscount.pct / 100) * 100) / 100
    : 0;
  const loyaltyWins = loyaltyEstimate > 0 && loyaltyEstimate >= codeEstimate;
  const discountEstimate = loyaltyWins ? loyaltyEstimate : codeEstimate;
  const discountLabel = loyaltyWins
    ? `Loyalty · ${loyaltyDiscount.pct}% off`
    : appliedDiscount
      ? (appliedDiscount.kind === "percent" ? `${appliedDiscount.value}% off` : `${money(appliedDiscount.value)} off`)
      : null;

  return createPortal(
    <div className="fixed inset-0 bg-black/70 flex items-end sm:items-center sm:justify-center z-50"
         role="dialog" aria-modal="true" aria-label="Your cart"
         data-testid="shop-cart-panel">
      <button type="button" aria-label="Close cart" onClick={onClose}
              className="absolute inset-0" tabIndex={-1} />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="shop-cart-h"
           className="relative w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border-t sm:border border-shBorder
                      flex flex-col max-h-[88vh]"
           style={{ background: "var(--sh-card-base)" }}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
          <h2 id="shop-cart-h" className="text-shText font-black uppercase tracking-widest text-sm">
            Your cart{lines.length > 0 && <span className="text-shTextMuted ml-2 tabular-nums">{lines.length}</span>}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close cart"
                  className="text-shTextMuted hover:text-shText w-8 h-8 grid place-items-center rounded
                             focus-visible:outline focus-visible:outline-2 focus-visible:outline-shPrimary">
            <i className="fas fa-xmark" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5">
          {lines.length === 0 ? (
            <div className="py-12 text-center" data-testid="shop-cart-empty">
              <i className="fas fa-bag-shopping text-shTextMuted/40 text-2xl" aria-hidden="true" />
              <p className="text-[15px] font-bold text-shText mt-3">Your cart is empty</p>
              <p className="text-[13px] text-shTextMuted mt-1.5">
                Have a look at the gear — it is all kit we use in class.
              </p>
              <button type="button" onClick={onClose} data-testid="shop-cart-empty-browse"
                      className="mt-5 px-4 py-2.5 rounded-xl bg-shPrimary text-bgHeader text-[12px] font-black uppercase tracking-widest">
                Start shopping
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-shBorder">
              {lines.map((l, i) => (
                <CartLine key={`${l.kind}:${l.ref_id}:${l.dog_id || ""}:${l.variant_id || ""}:${l.personalization ? i : ""}`} line={l}
                          onQtyChange={onQtyChange} onRemove={onRemove}
                          guestBlocked={blockedKeys.has(`${l.kind}:${l.ref_id}`)} />
              ))}
            </ul>
          )}
        </div>

        {lines.length > 0 && (
          <div className="shrink-0 px-5 pt-4 pb-5 border-t border-shBorder space-y-3"
               style={{ background: "var(--sh-card-base)" }}>
            {!guestMode && !previewMode && onApplyDiscountCode && (
              <>
                {!appliedDiscount && loyaltyDiscount?.eligible && (
                  <p className="flex items-center gap-1.5 text-[12px] font-bold text-shSecondary"
                     data-testid="cart-loyalty-note">
                    <i className="fas fa-star" aria-hidden="true" />
                    {loyaltyDiscount.pct}% loyalty discount already applied — thanks for being a regular!
                  </p>
                )}
                {/* A client already getting their automatic loyalty
                    discount doesn't need a full "enter a code" form
                    staring back at them right under "already applied" —
                    reads as being asked for the same discount twice.
                    Collapsed behind a quiet link instead; a code can
                    still win if it's actually better (never stacks with
                    loyalty — see loyaltyEstimate/codeEstimate above). */}
                {appliedDiscount || !loyaltyDiscount?.eligible || showCodeField ? (
                  <DiscountCodeField applied={appliedDiscount} onApply={onApplyDiscountCode}
                                      onRemove={onRemoveDiscountCode} busy={discountBusy} />
                ) : (
                  <button type="button" onClick={() => setShowCodeField(true)} data-testid="cart-discount-toggle"
                          className="text-[11.5px] text-shTextMuted hover:text-shText underline">
                    Have a better code?
                  </button>
                )}
              </>
            )}

            {canShip && onShippingAddressChange && (
              <ShippingChoice address={shippingAddress} onChange={onShippingAddressChange} />
            )}

            {showPrintifyChoice && (
              <PrintifyShipChoice fulfillment={printifyFulfillment} onChange={onPrintifyFulfillmentChange} />
            )}

            <CartSummary subtotal={subtotal} discountLabel={discountLabel} discountEstimate={discountEstimate} />

            {blocked.length > 0 && (
              <AccountRequiredNotice blockedLines={blocked} onSignIn={onSignIn} />
            )}

            <button type="button" onClick={onCheckout} disabled={!canCheckout || busy}
                    data-testid="shop-checkout-button"
                    className="w-full py-3 rounded-xl bg-shPrimary text-bgHeader text-[12px] font-black
                               uppercase tracking-widest hover:brightness-110 transition
                               disabled:opacity-40 disabled:cursor-not-allowed
                               focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-shPrimary">
              {previewMode ? "Preview only — no real orders"
                : busy ? "Redirecting…"
                  : blocked.length > 0 ? "Sign in to check out"
                    : "Continue to secure checkout"}
            </button>

            {guestMode && blocked.length === 0 && (
              <button type="button" onClick={onSignIn} data-testid="shop-checkout-sign-in"
                      className="w-full text-[12px] text-shTextMuted hover:text-shText underline
                                 focus-visible:outline focus-visible:outline-2 focus-visible:outline-shPrimary rounded">
                Or sign in to your account
              </button>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
