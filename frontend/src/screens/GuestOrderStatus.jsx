import { useCallback, useEffect, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { api } from "../lib/api";
import PublicBrandShell from "../components/PublicBrandShell";
import { EmptyState, PremiumButton, SectionCard } from "../components/premium";
import { goTo } from "../lib/goTo";
import { guestOrderToken, rememberGuestOrderToken } from "../lib/shopGuestCart";

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

/* Where a guest lands coming back from Stripe.
 *
 * A guest has no account to log into, so this page is reached the only way
 * it can be: with the token checkout minted. It arrives in the return URL
 * and is kept against the order id in this browser, so a reload, a restored
 * tab, or a later visit still works while a link forwarded to somebody else
 * does not carry an account with it — it carries a read of one order.
 *
 * Paying and fulfilment are not the same moment. Stripe sends the browser
 * back as soon as the card clears, but the order is only really finished
 * when the webhook has been and gone, so this polls for a short while
 * rather than announcing an outcome it does not have yet.
 */
export default function GuestOrderStatus() {
  const { orderId } = useParams();
  // The router's own copy of the query string. jsdom refuses to let a test
  // redefine the global location, so a page that reads it directly cannot be
  // tested for what it does with a token — and "does the token work" is the
  // whole of this page's access control.
  const params = new URLSearchParams(useLocation().search);
  const urlToken = params.get("token") || "";
  const canceled = params.get("stripe") === "cancel";
  const [token] = useState(() => urlToken || guestOrderToken(orderId) || "");
  const [order, setOrder] = useState(null);
  const [state, setState] = useState("loading"); // loading | ok | denied | error
  const [tries, setTries] = useState(0);

  useEffect(() => {
    // The URL is the fresher of the two, and it is also the copy that
    // disappears the moment the address bar is touched.
    if (urlToken) rememberGuestOrderToken(orderId, urlToken);
  }, [orderId, urlToken]);

  const load = useCallback(() => {
    if (!token) { setState("denied"); return; }
    // Header, not a query parameter: the token would otherwise be written
    // into access logs and browser history on every poll. Stripe's return
    // URL still carries it once, which is unavoidable — that is the hop it
    // exists for — and it has been remembered locally by now.
    api.get(`/public/shop/orders/${encodeURIComponent(orderId)}`,
            { headers: { "X-Guest-Token": token } })
      .then(({ data }) => { setOrder(data); setState("ok"); })
      .catch((e) => setState(e?.response?.status === 404 ? "denied" : "error"));
  }, [orderId, token]);

  useEffect(() => { load(); }, [load]);

  // Keep asking while the answer is still "we're waiting on Stripe", and
  // stop after a couple of minutes rather than polling this page forever.
  useEffect(() => {
    if (state !== "ok" || !order) return;
    const settled = order.status !== "pending_payment"
      && (order.status !== "paid" || order.fulfillment_status !== "pending");
    if (settled || tries >= 20) return;
    const t = setTimeout(() => { setTries((n) => n + 1); load(); }, 6000);
    return () => clearTimeout(t);
  }, [state, order, tries, load]);

  const shell = (children, extra = {}) => (
    <PublicBrandShell compact center eyebrow="Order" footer={false}
                      testid="guest-order-status" {...extra}>
      {children}
    </PublicBrandShell>
  );

  if (state === "loading") {
    return shell(
      <SectionCard accent="cyan" className="w-full max-w-md text-center py-10">
        <i className="fas fa-circle-notch fa-spin text-3xl text-shSecondary" />
        <p className="text-shTextMuted text-sm font-semibold mt-4">Looking up your order…</p>
      </SectionCard>,
      { title: "One moment." },
    );
  }

  if (state === "denied") {
    return shell(
      <EmptyState
        icon="fa-receipt" accent="cyan" title="We can't open this order"
        description="This link is missing the key that proves the order is yours, or it has been opened in a different browser. Check your email — your receipt has the details — or get in touch and we'll help."
        ctaLabel="Back to the Shop" onClick={() => goTo("/shop")}
        testId="guest-order-denied"
      />,
      { title: "Order not found." },
    );
  }

  if (state === "error") {
    return shell(
      <EmptyState
        icon="fa-triangle-exclamation" accent="orange" title="Something went wrong"
        description="We couldn't reach your order just now. Nothing has changed — try again in a moment."
        ctaLabel="Try Again" onClick={load} testId="guest-order-retry"
      />,
      { title: "Hmm." },
    );
  }

  const paid = order.status === "paid";
  const waiting = order.status === "pending_payment";
  const title = paid ? "Thank you — you're all set."
    : waiting ? (canceled ? "Checkout was canceled." : "Waiting for your payment…")
      : "There was a problem with this order.";
  const subtitle = paid
    ? `A receipt is on its way to ${order.email || "your email"}.`
    : waiting && canceled
      ? "Nothing was charged. Your basket is still where you left it."
      : waiting
        ? "This page updates itself — no need to refresh."
        : "Nothing further will be charged.";

  return shell(
    <SectionCard accent={paid ? "lime" : "cyan"} className="w-full max-w-md space-y-4 py-7"
                 data-testid="guest-order-card">
      <div className="text-center">
        <i className={`fas ${paid ? "fa-circle-check text-shPrimary" : waiting ? "fa-clock text-shSecondary" : "fa-circle-exclamation text-shOrange"} text-4xl`} />
        <p className="text-[11px] font-black uppercase tracking-[0.22em] text-shTextMuted mt-3">
          Order #{String(orderId).slice(0, 8).toUpperCase()}
        </p>
      </div>

      <div className="space-y-1.5">
        {(order.lines || []).map((l, i) => (
          <div key={`${l.kind}-${i}`} className="flex justify-between gap-3 text-[13px]">
            <span className="text-shText truncate">{l.quantity}× {l.name}</span>
            {l.kind === "gift_card" && (
              <span className="text-[11px] text-shSecondary font-bold shrink-0">Emailed</span>
            )}
            {l.kind === "product" && (
              <span className="text-[11px] text-shTextMuted shrink-0">Pickup</span>
            )}
          </div>
        ))}
        <div className="flex justify-between pt-2 border-t border-shBorder font-black text-shText">
          <span>Total</span><span data-testid="guest-order-total">{money(order.total)}</span>
        </div>
      </div>

      {paid && order.pickup_status === "preparing" && (
        <p className="text-[12px] text-shTextMuted border border-shBorder rounded-lg p-2.5"
           data-testid="guest-order-pickup">
          <i className="fas fa-store mr-1.5" />We&apos;re getting your order ready for collection at
          Sit Happens. We&apos;ll email you when it&apos;s waiting.
        </p>
      )}
      {paid && order.fulfillment_status === "pending" && (
        <p className="text-[12px] text-shTextMuted text-center">
          <i className="fas fa-circle-notch fa-spin mr-1.5" />Finishing up…
        </p>
      )}

      <PremiumButton variant="secondary" className="w-full justify-center"
                     data-testid="guest-order-back"
                     onClick={() => goTo("/shop")}>
        Back to the Shop
      </PremiumButton>
    </SectionCard>,
    { title, subtitle },
  );
}
