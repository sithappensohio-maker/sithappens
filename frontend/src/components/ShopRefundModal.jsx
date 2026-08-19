import { useMemo, useState } from "react";
import { api } from "../lib/api";

const money = (n) => `$${Number(n || 0).toFixed(2)}`;

export default function ShopRefundModal({ payment, onClose, onDone }) {
  const refundableLines = useMemo(() => (payment.shop_lines || []).map((line) => ({
    ...line,
    remainingQty: Math.max(0, Number(line.quantity || 0) - Number(line.quantity_refunded || 0)),
  })).filter((line) => line.remainingQty > 0), [payment]);
  const [selected, setSelected] = useState(() => Object.fromEntries(refundableLines.map((l) => [l.item_id, 0])));
  const [reason, setReason] = useState("");
  const [restock, setRestock] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const requestLines = refundableLines.flatMap((line) => {
    const qty = Number(selected[line.item_id] || 0);
    return qty > 0 ? [{ item_id: line.item_id, quantity: qty }] : [];
  });
  const canSubmit = !busy && reason.trim().length >= 3 && requestLines.length > 0;

  const setLineQty = (line, raw) => {
    const max = line.remainingQty;
    // Entitlements are intentionally all-or-nothing. Physical products may
    // be quantity-partial.
    const value = line.kind === "product" ? Math.max(0, Math.min(max, Number(raw || 0))) : (raw ? max : 0);
    setSelected((prev) => ({ ...prev, [line.item_id]: value }));
  };

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    try {
      const { data } = await api.post(`/shop-orders/${payment.shop_order_id}/stripe-refund`, {
        lines: requestLines,
        reason: reason.trim(),
        restock_products: restock,
        idempotency_key: idempotencyKey,
      });
      setResult(data.refund_attempt);
    } catch (e) {
      setError(e?.response?.data?.detail || "Shop refund request failed");
    } finally {
      setBusy(false);
    }
  };

  const status = result?.status;
  const succeeded = status === "succeeded";
  const processing = status === "pending" || status === "requires_action";
  const failed = status === "failed" || status === "canceled";

  return (
    <div className="fixed inset-0 z-[80] bg-black/75 backdrop-blur-sm overflow-y-auto p-4 grid place-items-start sm:place-items-center"
         onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="w-full max-w-xl my-8 bg-bgCard border border-shBorder rounded-2xl shadow-2xl sh-modal-surface"
           onMouseDown={(e) => e.stopPropagation()} data-testid="shop-refund-modal">
        <div className="p-5 border-b border-shBorder flex justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.3em] font-black text-shSecondary">Refund Shop Order</p>
            <h2 className="text-lg font-black text-shText mt-1">{payment.client_name || "Client"} · Order #{payment.shop_order_id.slice(0, 8)}</h2>
          </div>
          {!busy && <button onClick={onClose} className="text-shTextMuted hover:text-shText"><i className="fas fa-times" /></button>}
        </div>
        <div className="p-5 space-y-4">
          {!result && <>
            <div className="space-y-2">
              {refundableLines.map((line) => {
                const entitlement = line.kind !== "product";
                const qty = Number(selected[line.item_id] || 0);
                return <div key={line.item_id} className="border border-shBorder rounded-xl p-3" data-testid={`shop-refund-line-${line.item_id}`}>
                  <div className="flex gap-3 items-center justify-between">
                    <div className="min-w-0">
                      <p className="font-bold text-shText truncate">{line.name}</p>
                      <p className="text-xs text-shTextMuted">{line.kind.replaceAll("_", " ")} · {line.remainingQty} refundable · line total {money(line.line_total)}</p>
                    </div>
                    {entitlement ? (
                      <label className="flex items-center gap-2 text-xs font-black uppercase text-shTextMuted">
                        <input type="checkbox" checked={qty > 0} onChange={(e) => setLineQty(line, e.target.checked)} />
                        Refund all
                      </label>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-shTextMuted">Qty</span>
                        <input type="number" min="0" max={line.remainingQty} step="1" value={qty}
                               onChange={(e) => setLineQty(line, e.target.value)}
                               className="w-20 bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText" />
                      </div>
                    )}
                  </div>
                  {entitlement && <p className="text-[11px] text-amber-300 mt-2">Credits/program entitlements can only be automatically refunded if the remaining line is unused. Training history is preserved.</p>}
                </div>;
              })}
            </div>
            {refundableLines.some((l) => l.kind === "product") && (
              <label className="flex items-start gap-3 border border-shBorder rounded-xl p-3">
                <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} className="mt-1" />
                <span><span className="font-bold text-shText">Return refunded physical items to inventory</span><span className="block text-xs text-shTextMuted">Turn this off if the item is damaged, missing, or should not go back on the shelf.</span></span>
              </label>
            )}
            <div>
              <label className="text-[11px] uppercase tracking-widest text-shTextMuted font-black">Required reason</label>
              <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)}
                        className="w-full mt-1 bg-[var(--sh-card-base)] border border-shBorder rounded-lg p-3 text-shText resize-none" />
            </div>
            {error && <div className="bg-red-500/10 border border-red-500/40 text-red-300 rounded-lg p-3 text-sm font-bold">{error}</div>}
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="px-4 py-2 rounded border border-shBorder text-shTextMuted font-black uppercase text-xs">Cancel</button>
              <button onClick={submit} disabled={!canSubmit} data-testid="shop-refund-submit"
                      className="px-5 py-2 rounded bg-shSecondary text-shText font-black uppercase text-xs disabled:opacity-40">{busy ? "Processing…" : "Refund Selected"}</button>
            </div>
          </>}
          {succeeded && <div className="space-y-4"><div className="bg-shPrimary/10 border border-shPrimary/40 text-shPrimary rounded-lg p-3 text-sm font-bold">Refund successful. Stripe and local order/entitlement records were reconciled.</div><div className="flex justify-end"><button onClick={() => { onDone?.(); onClose(); }} className="px-5 py-2 rounded bg-shPrimary text-bgHeader font-black uppercase text-xs">Done</button></div></div>}
          {processing && <div className="space-y-4"><div className="bg-shAccent/10 border border-shAccent/40 text-shAccent rounded-lg p-3 text-sm font-bold">Stripe is still processing this refund. Local reversal waits for Stripe success.</div><div className="flex justify-end"><button onClick={() => { onDone?.(); onClose(); }} className="px-5 py-2 rounded border border-shBorder text-shText font-black uppercase text-xs">Close</button></div></div>}
          {failed && <div className="space-y-4"><div className="bg-red-500/10 border border-red-500/40 text-red-300 rounded-lg p-3 text-sm font-bold">Refund {status}. No successful local reversal was applied.</div><div className="flex justify-end gap-2"><button onClick={onClose} className="px-4 py-2 rounded border border-shBorder text-shTextMuted font-black uppercase text-xs">Close</button><button onClick={() => { setResult(null); setError(""); setIdempotencyKey(crypto.randomUUID()); }} className="px-5 py-2 rounded bg-shSecondary text-shText font-black uppercase text-xs">Try Again</button></div></div>}
        </div>
      </div>
    </div>
  );
}
