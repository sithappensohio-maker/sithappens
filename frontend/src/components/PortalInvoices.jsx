/* Stripe Online Payments (Phase 3A) — client-facing invoice list + Pay
 * Online. Hosted Checkout only: this component NEVER loads any Stripe SDK
 * and NEVER talks to Stripe directly — it only ever asks our own backend
 * for a session.url and does a plain browser navigation to it. Browser
 * success is never financial authority: after Stripe redirects back, this
 * polls our own attempt-status endpoint and only shows "Payment successful"
 * once our webhook/local-apply has actually completed.
 */
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { toast } from "sonner";
import NeonEdge from "./premium/NeonEdge";
import PremiumButton from "./premium/PremiumButton";
import { accentRgb } from "./premium/tokens";

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

const STATUS_LABELS = {
  DRAFT: "Draft", OPEN: "Open", PARTIALLY_PAID: "Partially Paid", PAID: "Paid",
  REFUNDED: "Refunded", PARTIALLY_REFUNDED: "Partially Refunded",
};

function readReturnParams() {
  const params = new URLSearchParams(window.location.search);
  const attemptId = params.get("stripe_attempt");
  const stripeState = params.get("stripe");
  if (attemptId) {
    // Clean the URL so refreshing/back doesn't re-trigger polling forever.
    params.delete("stripe_attempt");
    params.delete("stripe");
    const rest = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (rest ? `?${rest}` : ""));
  }
  return { attemptId, stripeState };
}

export default function PortalInvoices() {
  const [invoices, setInvoices] = useState([]);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = () => {
    api.get("/portal/invoices")
      .then(({ data }) => { setInvoices(data.invoices || []); setEnabled(!!data.stripe_online_enabled); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  // ── Returning from Stripe — poll our own status, never trust the URL alone ──
  const [returning, setReturning] = useState(null); // { attemptId, status } | null
  const pollRef = useRef(null);
  useEffect(() => {
    const { attemptId, stripeState } = readReturnParams();
    if (!attemptId) return;
    if (stripeState === "cancel") {
      toast("Payment canceled — nothing was charged.");
      return;
    }
    setReturning({ attemptId, status: "processing" });
    const poll = () => {
      api.get(`/portal/stripe-payment-attempts/${attemptId}`)
        .then(({ data }) => {
          setReturning({ attemptId, status: data.status });
          if (data.status === "applied") {
            toast.success("Payment successful!");
            load();
            clearInterval(pollRef.current);
          } else if (["failed", "expired", "canceled"].includes(data.status)) {
            clearInterval(pollRef.current);
          }
          // pending / reconciliation_required — keep polling, still processing
        })
        .catch(() => {});
    };
    poll();
    pollRef.current = setInterval(poll, 2500);
    return () => clearInterval(pollRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Pay Online modal ─────────────────────────────────────────────────────
  const [payModal, setPayModal] = useState(null); // invoice | null
  const [payMode, setPayMode] = useState("full"); // full | other
  const [otherAmount, setOtherAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [idemKey] = useState(() => crypto.randomUUID());

  const openPay = (inv) => { setPayModal(inv); setPayMode("full"); setOtherAmount(""); };

  const submitPay = async () => {
    if (!payModal) return;
    const amount = payMode === "full" ? null : Number(otherAmount);
    if (payMode === "other") {
      if (!(amount > 0)) { toast.error("Enter a positive amount"); return; }
      if (amount > payModal.balance + 0.005) { toast.error(`Amount can't exceed the balance of ${money(payModal.balance)}`); return; }
    }
    setBusy(true);
    try {
      const body = { idempotency_key: idemKey };
      if (amount != null) body.amount = amount;
      const { data } = await api.post(`/portal/invoices/${payModal.id}/stripe-checkout-session`, body);
      window.location.href = data.url; // plain navigation — no Stripe SDK involved
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not start the online payment");
      setBusy(false);
    }
  };

  if (loading || invoices.length === 0) return null;

  return (
    <NeonEdge accentRgb={accentRgb("purple")} intensity="standard" className="mb-4 sm:mb-6 p-4 sm:p-5" data-testid="portal-invoices">
      <p className="text-[11px] font-black uppercase tracking-[0.3em] text-purple-300 mb-3">
        <i className="fas fa-file-invoice mr-2" />Your Invoices
      </p>

      {returning && (
        <div className="mb-3 border border-shBorder rounded-lg p-3 text-sm" style={{ background: "var(--sh-card-base)" }} data-testid="portal-stripe-return-status">
          {returning.status === "processing" || returning.status === "pending" ? (
            <span className="text-gray-300"><i className="fas fa-circle-notch fa-spin mr-2" />Processing your payment…</span>
          ) : returning.status === "applied" ? (
            <span className="text-shGreen font-black"><i className="fas fa-circle-check mr-2" />Payment successful</span>
          ) : returning.status === "reconciliation_required" ? (
            <span className="text-gray-300"><i className="fas fa-circle-notch fa-spin mr-2" />Still finishing up — this can take a minute.</span>
          ) : (
            <span className="text-shOrange"><i className="fas fa-triangle-exclamation mr-2" />Payment didn&apos;t go through. Nothing was charged twice — try again below.</span>
          )}
        </div>
      )}

      <div className="space-y-2">
        {invoices.map((inv) => {
          const balance = Number(inv.balance || 0);
          const payable = balance > 0.005 && enabled;
          return (
            <div key={inv.id} className="border border-shBorder rounded-lg p-3" style={{ background: "var(--sh-card-base)" }} data-testid={`portal-invoice-${inv.id}`}>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <p className="text-shText font-bold text-sm">Invoice #{inv.invoice_number}</p>
                  <p className="text-[11px] text-shTextMuted">{inv.date} · {STATUS_LABELS[inv.status] || inv.status}</p>
                </div>
                <div className="text-right text-[12px] text-shTextMuted space-y-0.5">
                  <div>Total: <span className="text-shText font-bold">{money(inv.total)}</span></div>
                  {Number(inv.credit_applied || 0) > 0.005 && <div>Credits: <span className="text-shPrimary">{money(inv.credit_applied)}</span></div>}
                  <div>Paid: <span className="text-shText">{money(inv.amount_paid)}</span></div>
                  <div>Balance: <span className={balance > 0.005 ? "text-shAccent font-black" : "text-shPrimary font-black"}>{money(balance)}</span></div>
                </div>
              </div>
              {payable && (
                <PremiumButton variant="primary" onClick={() => openPay(inv)} data-testid={`portal-pay-online-${inv.id}`} className="mt-2 w-full sm:w-auto justify-center">
                  <i className="fas fa-credit-card" />Pay Online
                </PremiumButton>
              )}
            </div>
          );
        })}
      </div>

      {payModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="border border-shBorder rounded-2xl w-full max-w-sm p-5 space-y-3 shadow-sh" style={{ background: "var(--sh-card-base)" }}>
            <p className="text-shText font-bold uppercase tracking-widest">Pay Invoice #{payModal.invoice_number}</p>
            <p className="text-shTextMuted text-sm">Balance due: {money(payModal.balance)}</p>
            <div className="flex gap-2">
              <button onClick={() => setPayMode("full")}
                      className={`flex-1 py-2 rounded-md text-[12px] font-bold uppercase border ${payMode === "full" ? "bg-shPrimary text-bgHeader border-shPrimary" : "border-shBorder text-shTextMuted"}`}
                      style={payMode === "full" ? undefined : { background: "var(--sh-card-base)" }}>
                Pay Full Balance
              </button>
              <button onClick={() => setPayMode("other")}
                      className={`flex-1 py-2 rounded-md text-[12px] font-bold uppercase border ${payMode === "other" ? "bg-shPrimary text-bgHeader border-shPrimary" : "border-shBorder text-shTextMuted"}`}
                      style={payMode === "other" ? undefined : { background: "var(--sh-card-base)" }}>
                Pay Other Amount
              </button>
            </div>
            {payMode === "other" && (
              <input type="number" value={otherAmount} onChange={(e) => setOtherAmount(e.target.value)}
                     placeholder={`Up to ${money(payModal.balance)}`}
                     className="w-full border border-shBorder rounded p-3 text-shText focus:outline-none focus:border-shPrimary/60"
                     style={{ background: "var(--sh-card-base)" }} />
            )}
            <p className="text-[11px] text-shTextMuted">You&apos;ll be taken to Stripe&apos;s secure checkout to enter your card. Sit Happens never sees or stores your card details.</p>
            <div className="flex gap-3 pt-1">
              <PremiumButton variant="ghost" onClick={() => setPayModal(null)} className="flex-1 justify-center py-3">
                Cancel
              </PremiumButton>
              <PremiumButton variant="primary" onClick={submitPay} disabled={busy} className="flex-1 justify-center py-3">
                {busy ? "Redirecting…" : "Continue to Payment"}
              </PremiumButton>
            </div>
          </div>
        </div>
      )}
    </NeonEdge>
  );
}
