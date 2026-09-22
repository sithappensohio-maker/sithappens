import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, formatErr } from "../lib/api";
import { goTo } from "../lib/goTo";

/**
 * Gift cards, from the customer's side.
 *
 * Three jobs: check what is left on a card, put more money on one, and buy
 * one for somebody else as a digital card.
 *
 * Nothing here grants anything. Every button that involves money only asks
 * the backend to start a Stripe Checkout Session and then hands the browser
 * over to Stripe; the balance moves later, when Stripe tells the server it
 * was paid. That is why the "did it work?" panel re-reads the attempt from
 * our own records instead of believing the query string it came back with.
 */
const money = (n) => `$${Number(n || 0).toFixed(2)}`;

const input =
  "w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2.5 text-shText text-sm";
const label =
  "block text-[11px] uppercase tracking-widest text-shTextMuted mb-1 font-black";
const primary =
  "min-h-[44px] px-5 rounded bg-shPrimary text-bgHeader text-[12px] font-black uppercase tracking-widest disabled:opacity-50";

const idemKey = () =>
  `gc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export default function PortalGiftCards() {
  const [busy, setBusy] = useState(false);

  // ── what happened, for somebody coming back from Stripe ──────────────
  const [outcome, setOutcome] = useState(null);
  useEffect(() => {
    let attemptId = null;
    try {
      const q = new URLSearchParams(window.location.search);
      attemptId = q.get("gift_card_topup") || q.get("gift_card_purchase");
    } catch { /* no query string to read */ }
    if (!attemptId) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/portal/gift-card-attempts/${attemptId}`);
        if (!cancelled) setOutcome(data);
      } catch { /* nothing useful to say — leave the panel off */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── checking a balance ───────────────────────────────────────────────
  const [code, setCode] = useState("");
  const [card, setCard] = useState(null);
  const check = useCallback(async () => {
    const c = code.trim();
    if (!c) { toast.error("Enter the code from your card."); return; }
    setBusy(true);
    try {
      const { data } = await api.get(`/portal/gift-cards/${encodeURIComponent(c)}`);
      setCard(data);
    } catch (e) {
      setCard(null);
      toast.error(formatErr(e) || "No card with that code.");
    }
    setBusy(false);
  }, [code]);

  // ── adding money to it ───────────────────────────────────────────────
  const [topupAmount, setTopupAmount] = useState("");
  const addMoney = async () => {
    const amount = Number(topupAmount);
    if (!(amount > 0)) { toast.error("How much would you like to add?"); return; }
    setBusy(true);
    try {
      const { data } = await api.post(
        `/portal/gift-cards/${encodeURIComponent(code.trim())}/topup-session`,
        { amount, idempotency_key: idemKey() });
      if (data?.checkout_url) goTo(data.checkout_url);
      else toast.error("Could not start the payment.");
    } catch (e) {
      toast.error(formatErr(e) || "Could not start the payment.");
    }
    setBusy(false);
  };

  // ── buying one for somebody ──────────────────────────────────────────
  const [buyOpen, setBuyOpen] = useState(false);
  const [buyAmount, setBuyAmount] = useState("");
  const [buyEmail, setBuyEmail] = useState("");
  const [buyName, setBuyName] = useState("");
  const [buyMessage, setBuyMessage] = useState("");
  const buy = async () => {
    const amount = Number(buyAmount);
    if (!(amount > 0)) { toast.error("Pick an amount."); return; }
    if (!buyEmail.includes("@")) { toast.error("Where should we send it?"); return; }
    setBusy(true);
    try {
      const { data } = await api.post("/portal/gift-cards/purchase-session", {
        amount, recipient_email: buyEmail.trim(), recipient_name: buyName.trim(),
        message: buyMessage.trim(), idempotency_key: idemKey(),
      });
      if (data?.checkout_url) goTo(data.checkout_url);
      else toast.error("Could not start the payment.");
    } catch (e) {
      toast.error(formatErr(e) || "Could not start the payment.");
    }
    setBusy(false);
  };

  return (
    <div className="sh-front-desk-panel p-4 sm:p-5" data-testid="portal-gift-cards">
      <h2 className="text-shText text-[15px] uppercase tracking-widest font-black">
        Gift cards
      </h2>

      {outcome && (
        <div className="rounded-xl border border-shBorder p-3 mt-3" data-testid="gift-outcome">
          {outcome.status === "applied" ? (
            <p className="text-shPrimary text-sm font-black" data-testid="gift-outcome-done">
              Thank you — {money(outcome.amount)} is on the card.
              {outcome.card ? ` It now holds ${money(outcome.card.balance)}.` : ""}
            </p>
          ) : outcome.status === "pending" ? (
            <p className="text-shTextMuted text-sm" data-testid="gift-outcome-pending">
              Your payment is still going through. This page will be right once
              it lands — nothing else for you to do.
            </p>
          ) : (
            <p className="text-shTextMuted text-sm" data-testid="gift-outcome-none">
              That payment did not go through, so nothing was charged and
              nothing was added.
            </p>
          )}
        </div>
      )}

      {/* ── balance ─────────────────────────────────────────────────── */}
      <div className="mt-4">
        <label className={label} htmlFor="gift-code">Check a card</label>
        <div className="flex flex-wrap gap-2">
          <input id="gift-code" value={code} onChange={(e) => { setCode(e.target.value); setCard(null); }}
                 placeholder="XXXX-XXXX-XXXX" data-testid="portal-gift-code"
                 className={`${input} flex-1 min-w-[180px]`} />
          <button onClick={check} disabled={busy} data-testid="portal-gift-check"
                  className={primary}>Check</button>
        </div>
      </div>

      {card && (
        <div className="rounded-xl border border-shBorder p-3 mt-3" data-testid="portal-gift-found">
          <p className="text-shPrimary text-2xl font-black">{money(card.balance)}</p>
          <p className="text-[12px] text-shTextMuted">
            {card.code_display}
            {card.status === "voided" ? " · this card was cancelled"
              : card.status === "stock" ? " · not active yet — we will set it up when you buy it"
              : ""}
          </p>

          {card.can_top_up && (
            <div className="mt-3">
              <label className={label} htmlFor="gift-topup">Add money to it</label>
              <div className="flex flex-wrap gap-2">
                <input id="gift-topup" type="number" min="1" value={topupAmount}
                       onChange={(e) => setTopupAmount(e.target.value)}
                       placeholder="Amount" data-testid="portal-gift-topup-amount"
                       className={`${input} flex-1 min-w-[140px]`} />
                <button onClick={addMoney} disabled={busy} data-testid="portal-gift-topup-go"
                        className={primary}>
                  {busy ? "Starting…" : "Pay by card"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── buying one ──────────────────────────────────────────────── */}
      <div className="mt-5 pt-4 border-t border-shBorder">
        <button onClick={() => setBuyOpen((v) => !v)} data-testid="portal-gift-buy-toggle"
                className="inline-flex items-center min-h-[44px] py-2 px-1 -mx-1 text-shPrimary text-[12px] font-black uppercase tracking-widest">
          <i className="fas fa-gift mr-1.5" />Send someone a gift card
        </button>

        {buyOpen && (
          <div className="mt-3 space-y-2" data-testid="portal-gift-buy-form">
            <p className="text-[12px] text-shTextMuted">
              We email the card straight to them — there is nothing to collect
              and nothing to post.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label className={label}>Amount</label>
                <input type="number" min="1" value={buyAmount}
                       onChange={(e) => setBuyAmount(e.target.value)}
                       data-testid="portal-gift-buy-amount" className={input} />
              </div>
              <div>
                <label className={label}>Send it to</label>
                <input type="email" value={buyEmail}
                       onChange={(e) => setBuyEmail(e.target.value)}
                       placeholder="their@email.com"
                       data-testid="portal-gift-buy-email" className={input} />
              </div>
              <div>
                <label className={label}>Their name (optional)</label>
                <input value={buyName} onChange={(e) => setBuyName(e.target.value)}
                       data-testid="portal-gift-buy-name" className={input} />
              </div>
              <div>
                <label className={label}>A short message (optional)</label>
                <input value={buyMessage} onChange={(e) => setBuyMessage(e.target.value)}
                       data-testid="portal-gift-buy-message" className={input} />
              </div>
            </div>
            <button onClick={buy} disabled={busy} data-testid="portal-gift-buy-go"
                    className={primary}>
              {busy ? "Starting…" : "Pay by card"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
