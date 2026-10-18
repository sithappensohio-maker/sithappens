import { useEffect, useRef, useState } from "react";
import { api } from "./api";

/**
 * Stripe Terminal (card reader) charge-and-poll, as a standalone hook.
 *
 * Mirrors Pos.jsx's own chargeTerminal/cancelTerminalCharge exactly — same
 * endpoints, same 1.5s poll interval, same ~2 minute reader timeout — but is
 * written separately rather than shared with Pos.jsx (owner, 2026-10-18:
 * "checking out a dog doesnt offer our card reader"). Pos.jsx is a real,
 * daily-use, real-money code path; this is a new, less-proven caller, and
 * refactoring Pos.jsx to share this would risk destabilizing it for no
 * benefit to this feature. Some duplication is the deliberately safer trade.
 *
 * Unlike Pos.jsx (which appends a succeeded charge straight onto a tenders
 * list and clears its own state), this hook's charge stays at phase
 * "succeeded" with its PaymentIntent id available — callers here don't have
 * a tender list to fold it into; they read charge.paymentIntentId once
 * ready, send it to the server, and reset() when they're done with it.
 *
 * Returns { charge, start(amount), cancel(), reset() }.
 * charge is null, or { paymentIntentId, phase: "waiting"|"succeeded"|"error", amount, error? }.
 */
export function useStripeTerminalCharge() {
  const [charge, setCharge] = useState(null);
  const pollRef = useRef(null);
  const startingRef = useRef(false); // synchronous double-submit guard — React state lags a render behind a fast double-click
  const pollBusyRef = useRef(false); // true while a poll tick's request is in flight, so a slow response can't overlap the next tick

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    pollBusyRef.current = false;
  };
  useEffect(() => () => stopPolling(), []); // stop polling if the component unmounts mid-charge

  const start = async (amount) => {
    if (startingRef.current) return; // a second click/tap before the "waiting" state has rendered
    if (!(amount > 0)) return;
    startingRef.current = true;
    setCharge({ paymentIntentId: null, phase: "waiting", amount });
    try {
      const { data } = await api.post("/pos/terminal/charges", {
        amount: Math.round(amount * 100) / 100, idempotency_key: crypto.randomUUID(),
      });
      const piId = data.payment_intent_id;
      setCharge({ paymentIntentId: piId, phase: "waiting", amount });
      const startedAt = Date.now();
      pollRef.current = setInterval(async () => {
        if (pollBusyRef.current) return; // previous tick's request hasn't resolved yet — never run two at once
        if (Date.now() - startedAt > 120000) { // ~2 minutes — the reader itself times out well before this
          stopPolling();
          startingRef.current = false;
          setCharge({ paymentIntentId: piId, phase: "error", amount, error: "The reader didn't respond in time. Try again." });
          return;
        }
        pollBusyRef.current = true;
        try {
          const { data: status } = await api.get(`/pos/terminal/charges/${piId}`);
          if (status.status === "succeeded") {
            stopPolling();
            startingRef.current = false;
            setCharge({ paymentIntentId: piId, phase: "succeeded", amount });
          } else if (status.status === "canceled" || (status.status === "requires_payment_method" && status.last_payment_error)) {
            // A plain cancellation (reader-side, or a stale cancel call) carries no
            // last_payment_error — only a decline does — but canceled is always terminal.
            stopPolling();
            startingRef.current = false;
            setCharge({ paymentIntentId: piId, phase: "error", amount, error: status.last_payment_error || "The card payment was canceled." });
          }
          // Any other status (requires_confirmation, processing, etc.) — keep polling, the customer is still at the reader.
        } catch {
          // A transient poll failure isn't the charge failing — just try again next tick.
        }
        pollBusyRef.current = false;
      }, 1500);
    } catch (e) {
      startingRef.current = false;
      setCharge({ paymentIntentId: null, phase: "error", amount, error: e?.response?.data?.detail || "Could not start the card reader charge." });
    }
  };

  /** Returns "already_succeeded" if the cancel lost a race with the card
   *  actually completing — the caller should treat the charge as done, not
   *  canceled (same check Pos.jsx's own cancelTerminalCharge does). */
  const cancel = async () => {
    const piId = charge?.paymentIntentId;
    const amount = charge?.amount; // snapshot before state clears below
    stopPolling();
    startingRef.current = false;
    setCharge(null);
    if (!piId) return;
    try {
      await api.post(`/pos/terminal/charges/${piId}/cancel`);
    } catch {
      // The cancel can fail for a reason that matters: the charge already
      // succeeded the instant before Cancel was clicked. One last status
      // check settles which actually happened, rather than silently
      // discarding a card that was genuinely charged.
      try {
        const { data: status } = await api.get(`/pos/terminal/charges/${piId}`);
        if (status.status === "succeeded" && amount > 0) {
          setCharge({ paymentIntentId: piId, phase: "succeeded", amount });
          return "already_succeeded";
        }
      } catch { /* can't reach the backend to settle it — nothing more to do from here */ }
    }
    return undefined;
  };

  const reset = () => { stopPolling(); startingRef.current = false; setCharge(null); };

  return { charge, start, cancel, reset };
}
