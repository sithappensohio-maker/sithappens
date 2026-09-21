import { createPortal } from "react-dom";
import { useEffect, useRef } from "react";
import { guestItemCta, isInternalPhysical, stockCeiling } from "../../lib/shopPolish";
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
  const adjustable = item.kind === "product" && !line.dog_id;
  const ceiling = stockCeiling(item);

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
            <Price amount={(item.price || 0) * line.quantity} size="sm" />
            {line.quantity > 1 && (
              <p className="text-[11px] text-shTextMuted mt-0.5">{money(item.price)} each</p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 mt-2.5">
          {adjustable ? (
            <QuantityStepper value={line.quantity} max={ceiling ?? undefined}
                             idSuffix={`-${line.ref_id}`}
                             onChange={(q) => onQtyChange(line.kind, line.ref_id, q, line.dog_id, line.gift)} />
          ) : (
            <span className="text-[12px] text-shTextMuted">Qty {line.quantity}</span>
          )}
          <button type="button"
                  onClick={() => onRemove(line.kind, line.ref_id, line.dog_id, line.gift)}
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
export function CartSummary({ subtotal, tax, total, note }) {
  const showTax = tax != null;
  return (
    <div className="space-y-2" data-testid="shop-cart-summary">
      <div className="flex items-center justify-between text-[13px]">
        <span className="text-shTextMuted">Subtotal</span>
        <span className="text-shText font-bold tabular-nums" data-testid="cart-subtotal">{money(subtotal)}</span>
      </div>
      {showTax && (
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-shTextMuted">Sales tax</span>
          <span className="text-shText font-bold tabular-nums" data-testid="cart-tax">{money(tax)}</span>
        </div>
      )}
      <div className="flex items-center justify-between pt-2 border-t border-shBorder">
        <span className="text-shText font-black text-[15px]">Total</span>
        <span className="text-shPrimary font-black text-[20px] tabular-nums" data-testid="cart-total">
          {money(showTax ? total : subtotal)}
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

/**
 * The cart itself. A dialog, with the focus handling a dialog owes you:
 * Escape closes it, focus moves in on open and back to whatever opened it
 * on close.
 */
export default function CartPanel({
  lines, subtotal, onQtyChange, onRemove, onCheckout, busy, previewMode,
  onClose, guestMode, onSignIn,
}) {
  const panelRef = useRef(null);
  const returnFocusRef = useRef(null);

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
  const canCheckout = !previewMode && lines.length > 0 && (!guestMode || blocked.length === 0);

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
              {lines.map((l) => (
                <CartLine key={`${l.kind}:${l.ref_id}:${l.dog_id || ""}`} line={l}
                          onQtyChange={onQtyChange} onRemove={onRemove}
                          guestBlocked={blockedKeys.has(`${l.kind}:${l.ref_id}`)} />
              ))}
            </ul>
          )}
        </div>

        {lines.length > 0 && (
          <div className="shrink-0 px-5 pt-4 pb-5 border-t border-shBorder space-y-3"
               style={{ background: "var(--sh-card-base)" }}>
            <CartSummary subtotal={subtotal} />

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
