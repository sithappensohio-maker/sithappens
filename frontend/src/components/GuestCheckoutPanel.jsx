import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api";
import PremiumButton from "./premium/PremiumButton";
import { goTo } from "../lib/goTo";
import { rememberGuestOrderToken } from "../lib/shopGuestCart";

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

/* Checking out with no account.
 *
 * The only thing this asks for is an email address, because that is the
 * only thing buying without an account actually needs: somewhere to send
 * the receipt, and somewhere to send a gift card. It does not ask for a
 * password, it does not quietly create an account, and it does not try to
 * match the address to an existing customer — knowing an address is not the
 * same as being the person who owns it.
 *
 * Every number shown here comes back from the server (POST
 * /public/shop/cart/price). Nothing is added up in the browser: the total
 * on this panel and the total Stripe charges are produced by the same code,
 * so they cannot disagree.
 *
 * If the basket contains something a guest may not buy — prepaid visits, a
 * training program, anything needing a dog — the server says so by line and
 * this panel offers the two honest ways forward: sign in, or take those
 * lines out. It never silently drops them and charges for the rest.
 */
export default function GuestCheckoutPanel({ cart, onClose, onSignIn, onRemoveLines }) {
  const [priced, setPriced] = useState(null);      // null = still asking
  const [blocked, setBlocked] = useState(null);
  const [err, setErr] = useState("");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  // One idempotency key per basket, not per click. Minting a fresh one
  // inside the handler means an impatient double-tap is two different
  // requests to the server, which is two orders and two Stripe sessions —
  // the second of which sits there holding stock nobody is going to pay
  // for. Held in a ref so re-rendering (typing an email does it on every
  // keystroke) never rotates it mid-checkout.
  const idemKey = useRef(null);

  const payload = useMemo(() => cart.map((c) => ({
    kind: c.kind, ref_id: c.ref_id, quantity: c.quantity,
    recipient_email: c.gift?.recipient_email || null,
    recipient_name: c.gift?.recipient_name || null,
    gift_message: c.gift?.gift_message || null,
  })), [cart]);

  useEffect(() => {
    let cancelled = false;
    // A different basket is a different purchase, so it gets its own key.
    idemKey.current = null;
    setPriced(null); setBlocked(null); setErr("");
    api.post("/public/shop/cart/price", { items: payload })
      .then(({ data }) => { if (!cancelled) setPriced(data); })
      .catch((e) => {
        if (cancelled) return;
        // lib/api stringifies object error details, so the structured
        // version is read from detail_object — without it this branch would
        // silently never fire and every refusal would look like a generic
        // failure.
        const detail = e?.response?.data?.detail_object || e?.response?.data?.detail;
        if (detail && typeof detail === "object" && Array.isArray(detail.blocked)) {
          setBlocked(detail.blocked);
        } else {
          setErr("We couldn't price your cart just now. Please try again.");
        }
      });
    return () => { cancelled = true; };
  }, [payload]);

  const emailLooksReal = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  // Merchandise is collected in person, so somebody has to be named on it.
  // A gift card is emailed and nobody comes to the counter, so it does not.
  // The server enforces this too — the form only says so earlier.
  const needsPickupName = (cart || []).some((c) => c.kind === "product");
  const ready = emailLooksReal && (!needsPickupName || name.trim().length > 0);

  const pay = async () => {
    if (!ready || busy) return;
    if (!idemKey.current) idemKey.current = crypto.randomUUID();
    setBusy(true); setErr("");
    try {
      const { data } = await api.post("/public/shop/checkout", {
        items: payload,
        idempotency_key: idemKey.current,
        email: email.trim(),
        name: name.trim(),
        phone: phone.trim(),
      });
      // Kept before the redirect, never after: once the browser leaves for
      // Stripe there is no "after".
      rememberGuestOrderToken(data.order_id, data.guest_token);
      goTo(data.url);
    } catch (e) {
      setBusy(false);
      const detail = e?.response?.data?.detail_object || e?.response?.data?.detail;
      if (detail && typeof detail === "object" && Array.isArray(detail.blocked)) {
        setBlocked(detail.blocked);
      } else {
        setErr(typeof detail === "string" ? detail : "Checkout couldn't start. Nothing was charged.");
      }
    }
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
         data-testid="guest-checkout-panel">
      <div className="border border-shBorder rounded-2xl w-full max-w-md p-5 space-y-4 max-h-[85vh] overflow-y-auto shadow-sh"
           style={{ background: "var(--sh-card-base)" }}>
        <div className="flex items-center justify-between">
          <p className="text-shText font-bold uppercase tracking-widest text-sm">Checkout</p>
          <button onClick={onClose} className="text-shTextMuted hover:text-shText" aria-label="Close">
            <i className="fas fa-xmark" />
          </button>
        </div>

        {blocked ? (
          <div className="space-y-3" data-testid="guest-checkout-blocked">
            <p className="text-shText text-sm font-bold">
              Some of this needs to be connected to your account.
            </p>
            <p className="text-[12px] text-shTextMuted">
              Sign in and pick up exactly where you left off — your cart stays
              as it is, including anything you addressed to somebody else.
            </p>
            <ul className="space-y-1.5">
              {blocked.map((b, i) => (
                <li key={`${b.kind}-${b.ref_id}-${i}`}
                    className="text-[12px] text-shTextMuted border border-shBorder rounded-lg p-2.5">
                  {b.reason}
                </li>
              ))}
            </ul>
            <PremiumButton variant="primary" onClick={onSignIn} className="w-full justify-center"
                           data-testid="guest-checkout-sign-in">
              Sign In to Buy These
            </PremiumButton>
            <PremiumButton variant="secondary" data-testid="guest-checkout-drop-blocked"
                           className="w-full justify-center"
                           onClick={() => onRemoveLines(blocked.map((b) => ({ kind: b.kind, ref_id: b.ref_id })))}>
              Remove Them and Keep Going
            </PremiumButton>
          </div>
        ) : (
          <>
            {priced === null ? (
              <p className="text-shTextMuted text-sm py-6 text-center">
                <i className="fas fa-circle-notch fa-spin mr-2" />Checking prices…
              </p>
            ) : (
              <div className="space-y-2" data-testid="guest-checkout-summary">
                {priced.lines.map((l, i) => (
                  <div key={`${l.kind}-${l.ref_id}-${i}`} className="flex justify-between gap-3 text-[13px]">
                    <span className="text-shText truncate">{l.quantity}× {l.name}</span>
                    {/* Pre-tax, because the tax is its own row below. Showing
                        line_total here makes the lines visibly fail to add up
                        to the subtotal printed under them. */}
                    <span className="text-shTextMuted shrink-0">{money(l.line_subtotal ?? l.line_total)}</span>
                  </div>
                ))}
                <div className="pt-2 border-t border-shBorder space-y-1">
                  <div className="flex justify-between text-[12px] text-shTextMuted">
                    <span>Subtotal</span><span>{money(priced.subtotal)}</span>
                  </div>
                  {priced.tax_amount > 0 && (
                    <div className="flex justify-between text-[12px] text-shTextMuted">
                      <span>Sales tax</span><span>{money(priced.tax_amount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-black text-shText">
                    <span>Total</span><span data-testid="guest-checkout-total">{money(priced.total)}</span>
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <label className="block text-[11px] font-black uppercase tracking-widest text-shTextMuted">
                Email for your receipt
              </label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                     data-testid="guest-checkout-email" autoComplete="email" inputMode="email"
                     placeholder="you@example.com"
                     className="w-full px-3 py-2.5 rounded-lg border border-shBorder bg-black/20 text-shText text-sm" />
              <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                     data-testid="guest-checkout-name" autoComplete="name"
                     placeholder={needsPickupName ? "Your name" : "Your name (optional)"}
                     className="w-full px-3 py-2.5 rounded-lg border border-shBorder bg-black/20 text-shText text-sm" />
              {needsPickupName && (
                <>
                  <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                         data-testid="guest-checkout-phone" autoComplete="tel"
                         placeholder="Phone (optional)"
                         className="w-full px-3 py-2.5 rounded-lg border border-shBorder bg-black/20 text-shText text-sm" />
                  <p className="text-[11px] text-shTextMuted" data-testid="guest-checkout-pickup-note">
                    <i className="fas fa-store mr-1.5" />You&apos;ll collect this at Sit Happens —
                    we need a name to hand it over, and a number in case we need to reach you.
                  </p>
                </>
              )}
              <p className="text-[11px] text-shTextMuted">
                No account is created. We use this to send your receipt — and, if you bought one,
                the gift card. You&apos;ll pay on Stripe&apos;s secure checkout; Sit Happens never
                sees your card details.
              </p>
            </div>

            {err && <p className="text-[12px] text-shDanger" data-testid="guest-checkout-error">{err}</p>}

            {/* Pinned to the bottom of the card, which scrolls. On a 320px
                phone the pickup fields push the button past the fold, and a
                Pay button you have to go looking for is a Pay button that
                does not get pressed. The backdrop is opaque so the content
                does not read through it as it scrolls underneath. */}
            <div className="sticky bottom-0 -mx-5 px-5 pt-3 pb-1 space-y-2
                            border-t border-shBorder"
                 style={{ background: "var(--sh-card-base)" }}>
              <PremiumButton variant="primary" onClick={pay}
                             disabled={busy || !ready || priced === null}
                             data-testid="guest-checkout-pay" className="w-full justify-center py-3">
                {busy ? "Redirecting…" : priced ? `Pay ${money(priced.total)}` : "Pay"}
              </PremiumButton>
              <button onClick={onSignIn} data-testid="guest-checkout-sign-in-instead"
                      className="w-full text-[12px] text-shTextMuted hover:text-shText underline">
                I have an account — sign in instead
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
