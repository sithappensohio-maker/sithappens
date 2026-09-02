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
import { CLIENT_LABELS } from "../lib/clientLabels";
import ReceiptLogo, { fetchReceiptLogoDataUrl } from "./ReceiptLogo";

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

  // ── Receipt actions — a client may only ever view/email/print their OWN
  // receipts; the backend enforces ownership on every one of these calls,
  // this is just the UI surface for it. ─────────────────────────────────────
  const [receiptViewOpen, setReceiptViewOpen] = useState(null);
  const [emailingId, setEmailingId] = useState(null);

  const viewReceipt = async (invoiceId) => {
    try {
      const { data } = await api.get(`/receipts/invoice/${invoiceId}`);
      setReceiptViewOpen(data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load the receipt");
    }
  };

  const emailReceipt = async (invoiceId) => {
    setEmailingId(invoiceId);
    try {
      const { data } = await api.post(`/receipts/invoice/${invoiceId}/email`, {});
      if (data.ok) toast.success("Receipt emailed to you");
      else toast.error(data.detail || "Could not email the receipt");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not email the receipt");
    }
    setEmailingId(null);
  };

  const printReceipt = async (invoiceId) => {
    let payload;
    try {
      const { data } = await api.get(`/receipts/invoice/${invoiceId}`);
      payload = data;
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load the receipt");
      return;
    }
    const logoSrc = await fetchReceiptLogoDataUrl(payload.business_logo_image_id);
    const w = window.open("", "_blank", "width=380,height=600");
    if (!w) { toast.error("Please allow pop-ups to print your receipt"); return; }
    const lines = (payload.line_items || []).map((li) =>
      `<div style="display:flex;justify-content:space-between;gap:8px;"><span>${li.description || ""}${li.qty > 1 ? ` &times; ${li.qty}` : ""}</span><span>${money(li.amount)}</span></div>`
    ).join("");
    w.document.write(`<!doctype html><html><head><title>Receipt</title>
      <style>body{font-family:ui-monospace,monospace;font-size:13px;padding:16px;color:#000;background:#fff;} .b{font-weight:900;} .hr{border-top:1px solid #999;margin:8px 0;}</style>
      </head><body>
      ${payload.test_receipt ? `<div style="background:#fde68a;text-align:center;font-weight:900;padding:4px;margin-bottom:8px;">${payload.test_label || ""}</div>` : ""}
      ${logoSrc ? `<img src="${logoSrc}" alt="" style="display:block;max-height:56px;margin:0 auto 6px auto;" />` : ""}
      <p class="b">${payload.business_name || ""}</p>
      <p>Receipt #${payload.receipt_number || ""}</p>
      ${payload.client_name ? `<p>Client: ${payload.client_name}</p>` : ""}
      <div class="hr"></div>
      ${lines}
      <div class="hr"></div>
      <div class="b" style="display:flex;justify-content:space-between;"><span>Total</span><span>${money(payload.total ?? payload.invoice_total ?? payload.payment_amount)}</span></div>
      </body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => { w.print(); }, 250);
  };

  const submitPay = async () => {
    if (!payModal) return;
    const amount = payMode === "full" ? null : Number(otherAmount);
    if (payMode === "other") {
      if (!(amount > 0)) { toast.error("Enter a positive amount"); return; }
      if (amount > payModal.balance + 0.005) { toast.error(`Amount can't exceed the amount due of ${money(payModal.balance)}`); return; }
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
        <i className="fas fa-file-invoice mr-2" />Your Bills
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
                  <p className="text-shText font-bold text-sm">{CLIENT_LABELS.invoice} #{inv.invoice_number}</p>
                  <p className="text-[11px] text-shTextMuted">{inv.date} · {STATUS_LABELS[inv.status] || inv.status}</p>
                </div>
                <div className="text-right text-[12px] text-shTextMuted space-y-0.5">
                  <div>Total: <span className="text-shText font-bold">{money(inv.total)}</span></div>
                  {Number(inv.credit_applied || 0) > 0.005 && <div>Credit applied: <span className="text-shPrimary">{money(inv.credit_applied)}</span></div>}
                  <div>Paid: <span className="text-shText">{money(inv.amount_paid)}</span></div>
                  <div>{CLIENT_LABELS.balanceDue}: <span className={balance > 0.005 ? "text-shAccent font-black" : "text-shPrimary font-black"}>{money(balance)}</span></div>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {payable && (
                  <PremiumButton variant="primary" onClick={() => openPay(inv)} data-testid={`portal-pay-online-${inv.id}`} className="w-full sm:w-auto justify-center">
                    <i className="fas fa-credit-card" />Pay Online
                  </PremiumButton>
                )}
                <PremiumButton variant="secondary" onClick={() => viewReceipt(inv.id)} data-testid={`portal-view-receipt-${inv.id}`} className="justify-center">
                  <i className="fas fa-receipt" />View Receipt
                </PremiumButton>
                <PremiumButton variant="secondary" onClick={() => printReceipt(inv.id)} data-testid={`portal-print-receipt-${inv.id}`} className="justify-center">
                  <i className="fas fa-print" />Print Receipt
                </PremiumButton>
                <PremiumButton variant="secondary" onClick={() => emailReceipt(inv.id)} disabled={emailingId === inv.id} data-testid={`portal-email-receipt-${inv.id}`} className="justify-center">
                  <i className="fas fa-envelope" />{emailingId === inv.id ? "Sending…" : "Email Receipt"}
                </PremiumButton>
              </div>
            </div>
          );
        })}
      </div>

      {receiptViewOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 grid place-items-center p-4" onClick={() => setReceiptViewOpen(null)}>
          <div className="bg-white text-black rounded-lg p-5 max-w-sm w-full text-[13px]" onClick={(e) => e.stopPropagation()} data-testid="portal-receipt-view-modal">
            {receiptViewOpen.test_receipt && (
              <div className="bg-amber-200 text-amber-900 text-center font-black text-[10px] uppercase tracking-widest py-1 mb-2 rounded">{receiptViewOpen.test_label}</div>
            )}
            <ReceiptLogo imageId={receiptViewOpen.business_logo_image_id} />
            <p className="font-black text-base">{receiptViewOpen.business_name}</p>
            <p className="text-gray-500 mt-1">Receipt #{receiptViewOpen.receipt_number}</p>
            {receiptViewOpen.client_name && <p className="text-gray-500">Client: {receiptViewOpen.client_name}</p>}
            <div className="border-t border-gray-200 my-2" />
            {(receiptViewOpen.line_items || []).map((li, i) => (
              <div key={i} className="flex justify-between gap-2"><span>{li.description}{li.qty > 1 ? ` × ${li.qty}` : ""}</span><span className="font-bold">{money(li.amount)}</span></div>
            ))}
            <div className="border-t border-gray-200 my-2" />
            <div className="flex justify-between font-black text-base"><span>Total</span><span>{money(receiptViewOpen.total ?? receiptViewOpen.invoice_total ?? receiptViewOpen.payment_amount)}</span></div>
            <button onClick={() => setReceiptViewOpen(null)} className="mt-4 w-full bg-gray-100 text-gray-700 rounded py-2 font-black uppercase text-[12px] tracking-widest">Close</button>
          </div>
        </div>
      )}

      {payModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="border border-shBorder rounded-2xl w-full max-w-sm p-5 space-y-3 shadow-sh" style={{ background: "var(--sh-card-base)" }}>
            <p className="text-shText font-bold uppercase tracking-widest">Pay {CLIENT_LABELS.invoice} #{payModal.invoice_number}</p>
            <p className="text-shTextMuted text-sm">{CLIENT_LABELS.balanceDue}: {money(payModal.balance)}</p>
            <div className="flex gap-2">
              <button onClick={() => setPayMode("full")}
                      className={`flex-1 py-2 rounded-md text-[12px] font-bold uppercase border ${payMode === "full" ? "bg-shPrimary text-bgHeader border-shPrimary" : "border-shBorder text-shTextMuted"}`}
                      style={payMode === "full" ? undefined : { background: "var(--sh-card-base)" }}>
                Pay Full Amount
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
