/* Sprint 110di-61 — TakePaymentModal
 *
 * Lightweight "cash register" modal: pick a client, type an amount, choose
 * a method, hit submit. Calls POST /clients/{id}/payment which:
 *   - Reduces client.account_balance by amount
 *   - Writes a `payment` ledger row
 *   - Inserts a `tab_payment` retail_sales row so the cash hits today's P&L
 *   - Emails the client a receipt
 *
 * Used wherever an operator needs to register a walk-in / standalone payment
 * (next to Sell Pack / Sell Program / Add Retail Sale buttons).
 */
import { useEffect, useState } from "react";
import { api } from "../lib/api";

export default function TakePaymentModal({ onClose, onSuccess, presetClientId }) {
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState(presetClientId || "");
  const [clientQuery, setClientQuery] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [balance, setBalance] = useState(null);

  useEffect(() => {
    api.get("/clients").then((r) => {
      const d = r.data;
      setClients(Array.isArray(d) ? d : (d.items || []));
    }).catch(() => setClients([]));
  }, []);

  // Look up current balance whenever a client is picked.
  useEffect(() => {
    if (!clientId) { setBalance(null); return; }
    const c = clients.find((x) => x.id === clientId);
    setBalance(c ? Number(c.account_balance || 0) : null);
  }, [clientId, clients]);

  const selected = clients.find((c) => c.id === clientId);
  const results = clientQuery.trim() && !clientId
    ? clients.filter((c) =>
        (c.name + " " + (c.email || "")).toLowerCase().includes(clientQuery.toLowerCase())
      ).slice(0, 8)
    : [];

  const submit = async () => {
    if (!clientId) { setErr("Pick a client first"); return; }
    if (!amount || Number(amount) <= 0) { setErr("Amount must be greater than 0"); return; }
    setBusy(true); setErr("");
    try {
      const { data } = await api.post(`/clients/${clientId}/payment`, {
        amount: Number(amount), method, notes,
      });
      onSuccess?.(data);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Payment failed");
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-[80] flex items-center justify-center p-4"
         onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
         data-testid="take-payment-modal">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-md p-6 shadow-2xl max-h-[calc(100vh-2rem)] overflow-y-auto card-payment">
        <h3 className="text-xl font-black text-white uppercase tracking-tight mb-1">
          <i className="fas fa-cash-register text-shGreen mr-2"/>Take Payment
        </h3>
        <p className="text-[13px] text-gray-400 mb-4">
          Register a payment from a client (settle a tab, prepay credit, etc.)
        </p>

        {/* Client picker */}
        <label className="text-[11px] uppercase tracking-widest font-black text-gray-500">Client</label>
        {selected ? (
          <div className="mt-1 mb-3 flex items-center justify-between bg-bgBase border border-bgHover rounded p-2"
               data-testid="take-payment-client-selected">
            <div>
              <p className="text-white font-black">{selected.name}</p>
              {balance !== null && Math.abs(balance) > 0.005 && (
                <p className={`text-[12px] font-black ${balance > 0 ? "text-shOrange" : "text-shGreen"}`}>
                  {balance > 0 ? `Owes $${balance.toFixed(2)}` : `Pre-paid $${(-balance).toFixed(2)}`}
                </p>
              )}
            </div>
            <button onClick={() => { setClientId(""); setClientQuery(""); setBalance(null); }}
                    data-testid="take-payment-client-clear"
                    className="text-gray-400 hover:text-white text-[12px] uppercase tracking-widest font-black">Change</button>
          </div>
        ) : (
          <div className="relative mt-1 mb-3">
            <input value={clientQuery} onChange={(e)=>setClientQuery(e.target.value)}
                   placeholder="Type to search clients…"
                   data-testid="take-payment-client-search"
                   className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>
            {results.length > 0 && (
              <div className="absolute z-10 mt-1 w-full bg-bgPanel border border-bgHover rounded shadow-2xl max-h-48 overflow-y-auto">
                {results.map((c) => (
                  <button key={c.id} onClick={()=>{ setClientId(c.id); setClientQuery(""); }}
                          data-testid={`take-payment-client-pick-${c.id}`}
                          className="w-full text-left px-3 py-2 hover:bg-bgHover text-white text-[15px]">
                    <span className="font-black">{c.name}</span> <span className="text-gray-500 text-[13px]">· {c.email || "—"}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <label className="text-[11px] uppercase tracking-widest font-black text-gray-500">Amount</label>
        <input type="number" step="0.01" min="0" value={amount} onChange={(e)=>setAmount(e.target.value)}
               data-testid="take-payment-amount"
               placeholder={balance !== null && balance > 0 ? `$${balance.toFixed(2)}` : "$0.00"}
               className="w-full mt-1 mb-3 bg-bgBase border border-bgHover rounded p-2 text-white text-lg font-black"/>

        <label className="text-[11px] uppercase tracking-widest font-black text-gray-500">Method</label>
        <select value={method} onChange={(e)=>setMethod(e.target.value)} data-testid="take-payment-method"
                className="w-full mt-1 mb-3 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
          <option value="cash">Cash</option><option value="clover">Clover / Credit Card</option>
          <option value="venmo">Venmo</option><option value="paypal">PayPal</option><option value="check">Check</option>
          <option value="other">Other</option>
        </select>

        <label className="text-[11px] uppercase tracking-widest font-black text-gray-500">Notes (optional)</label>
        <input value={notes} onChange={(e)=>setNotes(e.target.value)} data-testid="take-payment-notes"
               placeholder="What's this payment for?"
               className="w-full mt-1 mb-4 bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>

        {err && <p className="text-red-400 text-[13px] mb-3" data-testid="take-payment-error">{err}</p>}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-gray-400 px-4 py-2 font-black uppercase text-[13px] tracking-widest">Cancel</button>
          <button onClick={submit} disabled={busy || !clientId || !amount || Number(amount) <= 0}
                  data-testid="take-payment-submit"
                  className="bg-shGreen text-bgHeader px-6 py-2 rounded font-black uppercase text-[13px] tracking-widest disabled:opacity-50">
            {busy ? "Saving…" : "Take payment"}
          </button>
        </div>
      </div>
    </div>
  );
}
