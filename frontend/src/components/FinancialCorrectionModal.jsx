import { useMemo, useState } from "react";
import { api } from "../lib/api";

const METHODS = ["cash", "check", "venmo", "paypal", "clover", "card", "transfer", "other"];

function money(value) {
  return `$${(Number(value) || 0).toFixed(2)}`;
}

export default function FinancialCorrectionModal({ booking, onClose, onSaved }) {
  const [action, setAction] = useState("charge");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [method, setMethod] = useState(booking?.payment_method || "clover");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const paidCash = Number(booking?.amount_paid || 0) > 0
    ? Number(booking.amount_paid)
    : Number(booking?.cash_revenue || 0);
  const maxRefund = Math.max(0, paidCash - (Number(booking?.financial_refund_total || 0) || 0));
  const balanceDue = Number(booking?.balance_due || 0) || 0;
  const needsAmount = action !== "reopen";
  const canSubmit = useMemo(() => {
    if (reason.trim().length < (action === "reopen" ? 5 : 3)) return false;
    if (!needsAmount) return true;
    return Number(amount) > 0;
  }, [action, amount, needsAmount, reason]);

  const submit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError("");
    try {
      let response;
      if (action === "refund") {
        response = await api.post(`/bookings/${booking.id}/refund`, {
          amount: Number(amount), payment_method: method, reason: reason.trim(),
        });
      } else if (action === "reopen") {
        response = await api.post(`/bookings/${booking.id}/reopen-checkout`, { reason: reason.trim() });
      } else {
        response = await api.post(`/bookings/${booking.id}/financial-adjustment`, {
          kind: action, amount: Number(amount), reason: reason.trim(),
        });
      }
      onSaved?.(response.data);
      onClose();
    } catch (e) {
      setError(e?.response?.data?.detail || e.message || "Correction failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/75 backdrop-blur-sm overflow-y-auto p-4 grid place-items-start sm:place-items-center" onMouseDown={(e)=>{ if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-xl my-8 bg-bgCard border border-bgHover rounded-2xl shadow-2xl" onMouseDown={(e)=>e.stopPropagation()} data-testid="financial-correction-modal">
        <div className="p-5 border-b border-bgHover flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.3em] font-black text-shOrange">Locked financial record</p>
            <h2 className="text-xl font-black text-white mt-1">{booking.dog_name} · {booking.service_name || booking.service_type}</h2>
            <p className="text-sm text-gray-400 mt-1">Charged {money(booking.actual_price)} · Paid {money(paidCash)} · Due {money(balanceDue)}{Number(booking.financial_refund_total || 0) > 0 ? ` · Refunded ${money(booking.financial_refund_total)}` : ""}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><i className="fas fa-times"/></button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              ["charge", "Add charge", "fa-plus-circle"],
              ["discount", "Discount", "fa-tag"],
              ["writeoff", "Write off", "fa-eraser"],
              ["refund", "Refund", "fa-rotate-left"],
            ].map(([key,label,icon]) => (
              <button key={key} onClick={()=>setAction(key)} className={`rounded-lg border p-3 text-left ${action===key ? "border-shOrange bg-shOrange/10 text-white" : "border-bgHover bg-bgBase text-gray-400 hover:border-shOrange/50"}`}>
                <i className={`fas ${icon} mr-1`}/><span className="text-[12px] uppercase tracking-widest font-black">{label}</span>
              </button>
            ))}
          </div>

          <button onClick={()=>setAction("reopen")} className={`w-full rounded-lg border p-3 text-left ${action==="reopen" ? "border-shBlue bg-shBlue/10 text-white" : "border-bgHover bg-bgBase text-gray-400 hover:border-shBlue/50"}`}>
            <i className="fas fa-lock-open mr-2"/><span className="text-[12px] uppercase tracking-widest font-black">Reopen checkout only when no money or credits were used</span>
          </button>

          {needsAmount && (
            <div>
              <label className="text-[11px] uppercase tracking-widest text-gray-500 font-black">Amount</label>
              <input type="number" min="0.01" step="0.01" value={amount} onChange={(e)=>setAmount(e.target.value)} autoFocus
                     className="w-full mt-1 bg-bgBase border border-bgHover rounded-lg p-3 text-white text-xl font-black focus:border-shOrange focus:outline-none" />
              {action === "refund" && <p className="text-xs text-gray-500 mt-1">Maximum cash refund: {money(maxRefund)}</p>}
              {(action === "discount" || action === "writeoff") && <p className="text-xs text-gray-500 mt-1">These can only reduce the unpaid balance. Refund money already collected instead.</p>}
            </div>
          )}

          {action === "refund" && (
            <div>
              <label className="text-[11px] uppercase tracking-widest text-gray-500 font-black">Refund method</label>
              <select value={method} onChange={(e)=>setMethod(e.target.value)} className="w-full mt-1 bg-bgBase border border-bgHover rounded-lg p-3 text-white">
                {METHODS.map((m)=><option value={m} key={m}>{m}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="text-[11px] uppercase tracking-widest text-gray-500 font-black">Required reason</label>
            <textarea rows={3} value={reason} onChange={(e)=>setReason(e.target.value)} placeholder="Explain exactly why this correction is needed."
                      className="w-full mt-1 bg-bgBase border border-bgHover rounded-lg p-3 text-white resize-none focus:border-shOrange focus:outline-none" />
          </div>

          {error && <div className="bg-red-500/10 border border-red-500/40 text-red-300 rounded-lg p-3 text-sm font-bold">{error}</div>}

          <div className="bg-shBlue/5 border border-shBlue/25 rounded-lg p-3 text-xs text-gray-300">
            <i className="fas fa-shield-halved text-shBlue mr-2"/>The original checkout remains in history. This action creates a separate audit event instead of rewriting or deleting the old record.
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded border border-bgHover text-gray-300 font-black uppercase tracking-widest text-xs">Cancel</button>
            <button onClick={submit} disabled={!canSubmit || busy} className="px-5 py-2 rounded bg-shOrange text-black font-black uppercase tracking-widest text-xs disabled:opacity-40">
              {busy ? "Saving…" : action === "refund" ? "Record refund" : action === "reopen" ? "Reopen safely" : "Record adjustment"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
