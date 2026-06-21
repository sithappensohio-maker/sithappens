/* Sprint 110di-51 — Accounts Receivable tab inside the Income screen.

Shows every client with a non-zero account_balance:
  • POSITIVE balance = client owes the business (tab / AR)
  • NEGATIVE balance = client has pre-paid credit on file

Operator actions per row:
  • View ledger (timeline of charges + payments)
  • Apply payment (reduces the tab)
  • Manual adjustment (write-off / correction)
*/
import { useEffect, useState } from "react";
import { api } from "../lib/api";

const fmt = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const fmtDateTime = (iso) => {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); }
  catch { return iso; }
};

const ROW_TYPE_TONE = {
  charge:     { tone: "text-shOrange",  icon: "fa-arrow-up",   label: "Charge" },
  payment:    { tone: "text-shGreen",   icon: "fa-arrow-down", label: "Payment" },
  refund:     { tone: "text-red-400",   icon: "fa-rotate-left", label: "Refund" },
  adjustment: { tone: "text-shBlue",    icon: "fa-pen-to-square", label: "Adjustment" },
};

export default function AccountsReceivableTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [openLedger, setOpenLedger] = useState(null); // client row currently expanded
  const [payOpen, setPayOpen] = useState(null);       // client row for "apply payment"
  const [adjOpen, setAdjOpen] = useState(null);       // client row for "adjustment"

  const load = async () => {
    setLoading(true); setErr("");
    try {
      const { data } = await api.get("/admin/accounts-receivable");
      setData(data);
    } catch (e) {
      setErr(e?.response?.data?.detail || "Failed to load AR data");
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  if (loading) {
    return (
      <div className="bg-bgPanel border border-bgHover rounded-xl p-6 text-center text-gray-400"
           data-testid="ar-loading">
        <i className="fas fa-circle-notch fa-spin mr-2"/>Loading accounts…
      </div>
    );
  }
  if (err) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl p-4" data-testid="ar-err">
        {err}
      </div>
    );
  }
  if (!data || !data.clients?.length) {
    return (
      <div className="bg-bgPanel border border-bgHover rounded-xl p-10 text-center text-gray-400"
           data-testid="ar-empty">
        <i className="fas fa-circle-check text-shGreen text-4xl mb-3 block"/>
        <p className="text-[15px] font-black uppercase tracking-widest">All settled up</p>
        <p className="text-[13px] mt-1 text-gray-500">No clients with outstanding balances or prepaid credits.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="ar-tab">
      {/* Totals strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3" data-testid="ar-totals">
        <StatTile label="Owed to you" value={fmt(data.total_receivable)} tone="shOrange"
                  testid="ar-total-receivable"/>
        <StatTile label="Credit on file" value={fmt(data.total_credit_on_file)} tone="shGreen"
                  testid="ar-total-credit"/>
        <StatTile label="Net" value={fmt(data.net)} tone={data.net >= 0 ? "shOrange" : "shGreen"}
                  testid="ar-net"/>
      </div>

      {/* Clients table */}
      <div className="bg-bgPanel border border-bgHover rounded-xl overflow-hidden"
           data-testid="ar-clients-table">
        <div className="px-4 py-3 border-b border-bgHover flex items-center justify-between">
          <h3 className="text-[13px] uppercase tracking-widest font-black text-gray-300">
            <i className="fas fa-users mr-2"/>
            {data.count} client{data.count === 1 ? "" : "s"} with balance
          </h3>
          <button onClick={load} data-testid="ar-refresh"
                  className="text-[12px] uppercase tracking-widest font-black text-gray-400 hover:text-shGreen">
            <i className="fas fa-rotate-right mr-1"/>Refresh
          </button>
        </div>
        <ul className="divide-y divide-bgHover">
          {data.clients.map((c) => {
            const owed = (c.account_balance || 0) > 0;
            return (
              <li key={c.id} className="px-4 py-3" data-testid={`ar-row-${c.id}`}>
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] font-black text-white truncate">{c.name}</p>
                    <p className="text-[12px] text-gray-500 truncate">
                      {c.email || "no email"} · {c.phone || "no phone"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`text-[10px] uppercase tracking-widest font-black ${owed ? "text-shOrange" : "text-shGreen"}`}>
                      {owed ? "Owes" : "Credit"}
                    </p>
                    <p className={`text-2xl font-black ${owed ? "text-shOrange" : "text-shGreen"}`}
                       data-testid={`ar-bal-${c.id}`}>
                      {fmt(Math.abs(c.account_balance))}
                    </p>
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    <button onClick={() => setOpenLedger(openLedger === c.id ? null : c)}
                            data-testid={`ar-view-ledger-${c.id}`}
                            className="bg-bgBase border border-bgHover text-gray-200 px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest hover:border-shBlue hover:text-shBlue transition">
                      <i className="fas fa-list mr-1"/>Ledger
                    </button>
                    <button onClick={() => setPayOpen(c)}
                            data-testid={`ar-apply-payment-${c.id}`}
                            className="bg-shGreen/20 border border-shGreen/40 text-shGreen px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest hover:bg-shGreen/30 transition">
                      <i className="fas fa-cash-register mr-1"/>Apply payment
                    </button>
                    <button onClick={() => setAdjOpen(c)}
                            data-testid={`ar-adjust-${c.id}`}
                            className="bg-shBlue/15 border border-shBlue/40 text-shBlue px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest hover:bg-shBlue/25 transition">
                      <i className="fas fa-sliders mr-1"/>Adjust
                    </button>
                  </div>
                </div>
                {/* Inline ledger drawer */}
                {openLedger === c.id && (
                  <LedgerDrawer clientId={c.id} clientName={c.name} />
                )}
                {/* Also support drawer when state holds the row */}
                {openLedger?.id === c.id && openLedger !== c.id && (
                  <LedgerDrawer clientId={c.id} clientName={c.name} />
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {payOpen && (
        <ApplyPaymentModal client={payOpen} onClose={() => setPayOpen(null)}
                           onSuccess={() => { setPayOpen(null); load(); }} />
      )}
      {adjOpen && (
        <AdjustmentModal client={adjOpen} onClose={() => setAdjOpen(null)}
                         onSuccess={() => { setAdjOpen(null); load(); }} />
      )}
    </div>
  );
}

function StatTile({ label, value, tone, testid }) {
  const tones = {
    shGreen:  "border-shGreen/40 bg-shGreen/10 text-shGreen",
    shOrange: "border-shOrange/40 bg-shOrange/10 text-shOrange",
    shBlue:   "border-shBlue/40 bg-shBlue/10 text-shBlue",
  };
  return (
    <div className={`border rounded-xl p-4 ${tones[tone] || tones.shBlue}`} data-testid={testid}>
      <p className="text-[10px] uppercase tracking-widest font-black opacity-80">{label}</p>
      <p className="text-3xl font-black mt-1">{value}</p>
    </div>
  );
}

function LedgerDrawer({ clientId, clientName }) {
  const [rows, setRows] = useState(null);
  const [balance, setBalance] = useState(0);
  const [err, setErr] = useState("");
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get(`/clients/${clientId}/ledger`);
        setRows(data.rows || []);
        setBalance(data.balance || 0);
      } catch (e) { setErr(e?.response?.data?.detail || "Could not load ledger"); }
    })();
  }, [clientId]);
  if (err) return <p className="mt-3 text-red-400 text-[13px]">{err}</p>;
  if (rows === null) return <p className="mt-3 text-gray-500 text-[13px]"><i className="fas fa-circle-notch fa-spin mr-1"/>Loading…</p>;
  if (rows.length === 0) return <p className="mt-3 text-gray-500 text-[13px]">No ledger entries yet.</p>;
  return (
    <div className="mt-3 bg-bgBase/40 border border-bgHover rounded-lg p-3"
         data-testid={`ar-ledger-${clientId}`}>
      <p className="text-[11px] uppercase tracking-widest font-black text-gray-500 mb-2">
        <i className="fas fa-clock-rotate-left mr-1"/>Ledger · {clientName} · Balance {fmt(balance)}
      </p>
      <ul className="divide-y divide-bgHover/40">
        {rows.map((r) => {
          const t = ROW_TYPE_TONE[r.type] || { tone: "text-gray-300", icon: "fa-receipt", label: r.type };
          return (
            <li key={r.id} className="py-2 flex items-center gap-3 text-[13px]"
                data-testid={`ledger-row-${r.id}`}>
              <i className={`fas ${t.icon} ${t.tone}`}/>
              <div className="flex-1 min-w-0">
                <p className="text-white truncate"><span className={`${t.tone} font-black uppercase tracking-widest text-[11px] mr-2`}>{t.label}</span>{r.notes || ""}</p>
                <p className="text-[11px] text-gray-500">{fmtDateTime(r.created_at)}{r.method ? ` · ${r.method}` : ""}</p>
              </div>
              <span className={`${r.amount > 0 ? "text-shOrange" : "text-shGreen"} font-black`}>
                {r.amount > 0 ? "+" : ""}{fmt(r.amount)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ApplyPaymentModal({ client, onClose, onSuccess }) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async () => {
    setBusy(true); setErr("");
    try {
      await api.post(`/clients/${client.id}/payment`, {
        amount: Number(amount), method, notes,
      });
      onSuccess();
    } catch (e) {
      setErr(e?.response?.data?.detail || "Payment failed");
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
         data-testid="ar-pay-modal" onMouseDown={(e)=>{ if(e.target===e.currentTarget) onClose(); }}>
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-md p-6 shadow-2xl">
        <h3 className="text-xl font-black text-white uppercase tracking-tight mb-1">
          <i className="fas fa-cash-register text-shGreen mr-2"/>Apply Payment
        </h3>
        <p className="text-[13px] text-gray-400 mb-4">{client.name} · Owes {fmt(client.account_balance)}</p>
        <label className="text-[11px] uppercase tracking-widest font-black text-gray-500">Amount</label>
        <input type="number" step="0.01" min="0" value={amount} onChange={(e)=>setAmount(e.target.value)}
               data-testid="ar-pay-amount" placeholder={fmt(Math.max(0, client.account_balance || 0))}
               className="w-full mt-1 mb-3 bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>
        <label className="text-[11px] uppercase tracking-widest font-black text-gray-500">Method</label>
        <select value={method} onChange={(e)=>setMethod(e.target.value)} data-testid="ar-pay-method"
                className="w-full mt-1 mb-3 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
          <option value="cash">Cash</option><option value="card">Card</option>
          <option value="transfer">Transfer</option><option value="check">Check</option>
          <option value="other">Other</option>
        </select>
        <label className="text-[11px] uppercase tracking-widest font-black text-gray-500">Notes (optional)</label>
        <input value={notes} onChange={(e)=>setNotes(e.target.value)} data-testid="ar-pay-notes"
               className="w-full mt-1 mb-4 bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>
        {err && <p className="text-red-400 text-[13px] mb-3">{err}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-gray-400 px-4 py-2 font-black uppercase text-[13px] tracking-widest">Cancel</button>
          <button onClick={submit} disabled={busy || !amount || Number(amount) <= 0}
                  data-testid="ar-pay-submit"
                  className="bg-shGreen text-bgHeader px-6 py-2 rounded font-black uppercase text-[13px] tracking-widest disabled:opacity-50">
            {busy ? "Saving…" : "Apply payment"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AdjustmentModal({ client, onClose, onSuccess }) {
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const submit = async () => {
    setBusy(true); setErr("");
    try {
      await api.post(`/clients/${client.id}/adjustment`, {
        amount: Number(amount), notes,
      });
      onSuccess();
    } catch (e) {
      setErr(e?.response?.data?.detail || "Adjustment failed");
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
         data-testid="ar-adjust-modal" onMouseDown={(e)=>{ if(e.target===e.currentTarget) onClose(); }}>
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-md p-6 shadow-2xl">
        <h3 className="text-xl font-black text-white uppercase tracking-tight mb-1">
          <i className="fas fa-sliders text-shBlue mr-2"/>Manual Adjustment
        </h3>
        <p className="text-[13px] text-gray-400 mb-4">
          {client.name} · Balance {fmt(client.account_balance)}
        </p>
        <p className="text-[12px] text-gray-500 mb-3">
          Use NEGATIVE to forgive part of the tab (write-off). POSITIVE to add to it (manual charge).
        </p>
        <label className="text-[11px] uppercase tracking-widest font-black text-gray-500">Amount (signed)</label>
        <input type="number" step="0.01" value={amount} onChange={(e)=>setAmount(e.target.value)}
               data-testid="ar-adj-amount" placeholder="-25.00"
               className="w-full mt-1 mb-3 bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>
        <label className="text-[11px] uppercase tracking-widest font-black text-gray-500">Reason (required)</label>
        <input value={notes} onChange={(e)=>setNotes(e.target.value)} data-testid="ar-adj-notes"
               placeholder="Goodwill write-off"
               className="w-full mt-1 mb-4 bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>
        {err && <p className="text-red-400 text-[13px] mb-3">{err}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-gray-400 px-4 py-2 font-black uppercase text-[13px] tracking-widest">Cancel</button>
          <button onClick={submit} disabled={busy || amount === "" || !notes.trim()}
                  data-testid="ar-adj-submit"
                  className="bg-shBlue text-white px-6 py-2 rounded font-black uppercase text-[13px] tracking-widest disabled:opacity-50">
            {busy ? "Saving…" : "Apply adjustment"}
          </button>
        </div>
      </div>
    </div>
  );
}
