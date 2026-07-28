import { useState } from "react";
import { api } from "../lib/api";

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;

// Payment rebuild — Stripe refund UI. Calls the EXISTING, already
// live-tested POST /payments/{id}/stripe-refund endpoint — no refund
// accounting logic lives here, Stripe + that endpoint stay authoritative.
export default function StripeRefundModal({ payment, onClose, onDone }) {
  const [mode, setMode] = useState("full"); // "full" | "partial"
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null); // { status } once a request has been made

  // One stable key per attempt — generated when the modal opens, and only
  // ever regenerated when the user explicitly starts a NEW attempt after a
  // terminal failure (never merely because React rerendered). Reusing the
  // same key after a "failed"/"canceled" result would just replay that dead
  // attempt forever (see create_stripe_refund's idempotency-claim rules).
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const remaining = Number(payment.remaining_refundable || 0);
  const refundAmount = mode === "full" ? remaining : Number(amount || 0);
  const canSubmit = !busy && reason.trim().length >= 3
    && refundAmount > 0.005 && refundAmount <= remaining + 0.005;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    try {
      const { data } = await api.post(`/payments/${payment.payment_id}/stripe-refund`, {
        amount: Math.round(refundAmount * 100) / 100,
        reason: reason.trim(),
        idempotency_key: idempotencyKey,
      });
      setResult(data.refund_attempt);
    } catch (e) {
      setError(e?.response?.data?.detail || "Refund request failed");
    } finally {
      setBusy(false);
    }
  };

  const tryAgain = () => {
    setResult(null);
    setError("");
    setIdempotencyKey(crypto.randomUUID()); // deliberate new attempt, not a rerender
  };

  const finish = () => {
    onDone?.();
    onClose();
  };

  const status = result?.status;
  const succeeded = status === "succeeded";
  const processing = status === "pending" || status === "requires_action";
  const terminalFailure = status === "failed" || status === "canceled";

  return (
    <div className="fixed inset-0 z-[80] bg-black/75 backdrop-blur-sm overflow-y-auto p-4 grid place-items-start sm:place-items-center"
         onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="w-full max-w-md my-8 bg-bgCard border border-bgHover rounded-2xl shadow-2xl"
           onMouseDown={(e) => e.stopPropagation()} data-testid="stripe-refund-modal">
        <div className="p-5 border-b border-bgHover flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.3em] font-black text-shBlue">Refund via Stripe</p>
            <h2 className="text-lg font-black text-white mt-1">
              {payment.client_name || "Client"} · Invoice #{(payment.invoice_id || "").slice(0, 8)}
            </h2>
          </div>
          {!busy && (
            <button onClick={onClose} className="text-gray-500 hover:text-white"><i className="fas fa-times" /></button>
          )}
        </div>

        <div className="p-5 space-y-4">
          <div className="bg-bgBase border border-bgHover rounded-lg p-3 text-sm text-gray-300 space-y-1">
            <div className="flex justify-between"><span>Original payment</span><span className="text-white font-bold">{money(payment.amount)}</span></div>
            <div className="flex justify-between"><span>Already refunded</span><span className="text-white font-bold">{money(payment.refunded_amount)}</span></div>
            <div className="flex justify-between"><span>Remaining refundable</span><span className="text-shGreen font-bold">{money(remaining)}</span></div>
          </div>

          {!result && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setMode("full")}
                        className={`rounded-lg border p-3 text-left ${mode === "full" ? "border-shBlue bg-shBlue/10 text-white" : "border-bgHover bg-bgBase text-gray-400 hover:border-shBlue/50"}`}>
                  <span className="text-[12px] uppercase tracking-widest font-black">Full refund</span>
                  <p className="text-xs mt-0.5 opacity-80">{money(remaining)}</p>
                </button>
                <button onClick={() => setMode("partial")}
                        className={`rounded-lg border p-3 text-left ${mode === "partial" ? "border-shBlue bg-shBlue/10 text-white" : "border-bgHover bg-bgBase text-gray-400 hover:border-shBlue/50"}`}>
                  <span className="text-[12px] uppercase tracking-widest font-black">Partial refund</span>
                </button>
              </div>

              {mode === "partial" && (
                <div>
                  <label className="text-[11px] uppercase tracking-widest text-gray-500 font-black">Amount</label>
                  <input type="number" min="0.01" step="0.01" max={remaining} value={amount}
                         onChange={(e) => setAmount(e.target.value)} autoFocus
                         data-testid="stripe-refund-amount"
                         className="w-full mt-1 bg-bgBase border border-bgHover rounded-lg p-3 text-white text-xl font-black focus:border-shBlue focus:outline-none" />
                </div>
              )}

              <div>
                <label className="text-[11px] uppercase tracking-widest text-gray-500 font-black">Required reason</label>
                <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)}
                          placeholder="Explain why this refund is needed."
                          data-testid="stripe-refund-reason"
                          className="w-full mt-1 bg-bgBase border border-bgHover rounded-lg p-3 text-white resize-none focus:border-shBlue focus:outline-none" />
              </div>

              {error && <div className="bg-red-500/10 border border-red-500/40 text-red-300 rounded-lg p-3 text-sm font-bold">{error}</div>}

              <div className="flex justify-end gap-2">
                <button onClick={onClose} disabled={busy} className="px-4 py-2 rounded border border-bgHover text-gray-300 font-black uppercase tracking-widest text-xs disabled:opacity-50">
                  Cancel
                </button>
                <button onClick={submit} disabled={!canSubmit} data-testid="stripe-refund-submit"
                        className="px-5 py-2 rounded bg-shBlue text-white font-black uppercase tracking-widest text-xs disabled:opacity-40">
                  {busy ? "Processing…" : `Refund ${money(refundAmount || 0)}`}
                </button>
              </div>
            </>
          )}

          {succeeded && (
            <div className="space-y-4">
              <div className="bg-shGreen/10 border border-shGreen/40 text-shGreen rounded-lg p-3 text-sm font-bold" data-testid="stripe-refund-success">
                <i className="fas fa-circle-check mr-2" />Refund successful — {money(refundAmount)} refunded via Stripe.
              </div>
              <div className="flex justify-end">
                <button onClick={finish} className="px-5 py-2 rounded bg-shGreen text-bgHeader font-black uppercase tracking-widest text-xs">Done</button>
              </div>
            </div>
          )}

          {processing && (
            <div className="space-y-4">
              <div className="bg-shOrange/10 border border-shOrange/40 text-shOrange rounded-lg p-3 text-sm font-bold" data-testid="stripe-refund-processing">
                <i className="fas fa-circle-notch fa-spin mr-2" />Refund processing — Stripe hasn't confirmed it yet. It will finish shortly.
              </div>
              <div className="flex justify-end">
                <button onClick={finish} className="px-5 py-2 rounded bg-bgBase border border-bgHover text-gray-200 font-black uppercase tracking-widest text-xs">Close</button>
              </div>
            </div>
          )}

          {terminalFailure && (
            <div className="space-y-4">
              <div className="bg-red-500/10 border border-red-500/40 text-red-300 rounded-lg p-3 text-sm font-bold" data-testid="stripe-refund-failed">
                <i className="fas fa-triangle-exclamation mr-2" />
                Refund {status === "canceled" ? "canceled" : "failed"} — no money was returned. You can try again.
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={onClose} className="px-4 py-2 rounded border border-bgHover text-gray-300 font-black uppercase tracking-widest text-xs">Close</button>
                <button onClick={tryAgain} data-testid="stripe-refund-retry"
                        className="px-5 py-2 rounded bg-shBlue text-white font-black uppercase tracking-widest text-xs">Try Again</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
