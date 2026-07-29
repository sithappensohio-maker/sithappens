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
import TakePaymentModal from "../components/TakePaymentModal";

const fmt = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const fmtDateTime = (iso) => {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); }
  catch { return iso; }
};

const ROW_TYPE_TONE = {
  charge:     { tone: "text-shAccent",  icon: "fa-arrow-up",   label: "Charge" },
  payment:    { tone: "text-shPrimary",   icon: "fa-arrow-down", label: "Payment" },
  refund:     { tone: "text-red-400",   icon: "fa-rotate-left", label: "Refund" },
  adjustment: { tone: "text-shSecondary",    icon: "fa-pen-to-square", label: "Adjustment" },
};

export default function AccountsReceivableTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [openLedger, setOpenLedger] = useState(null); // client row currently expanded
  const [payOpen, setPayOpen] = useState(null);       // client row for "apply payment"
  const [adjOpen, setAdjOpen] = useState(null);       // client row for "adjustment"
  // Sprint 110di-53 — Send statement toast state. Keyed by client id so
  // multiple rows can be in-flight at once without stomping each other.
  const [sendingStatement, setSendingStatement] = useState({});
  const [statementToast, setStatementToast] = useState("");

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

  // Sprint 110di-53 — Send a full ledger/statement email to the client.
  // Uses the existing payment methods the business already accepts —
  // no Stripe / payment gateway involvement.
  const sendStatement = async (client) => {
    if (!client.email) {
      setStatementToast(`${client.name} has no email on file.`);
      setTimeout(() => setStatementToast(""), 4000);
      return;
    }
    setSendingStatement((s) => ({ ...s, [client.id]: true }));
    try {
      const { data } = await api.post(`/clients/${client.id}/send-statement`);
      setStatementToast(`Statement sent to ${data.sent_to}.`);
    } catch (e) {
      setStatementToast(e?.response?.data?.detail || "Could not send statement.");
    } finally {
      setSendingStatement((s) => { const n = { ...s }; delete n[client.id]; return n; });
      setTimeout(() => setStatementToast(""), 4500);
    }
  };

  if (loading) {
    return (
      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-6 text-center text-shTextMuted"
           data-testid="ar-loading">
        <i className="fas fa-circle-notch fa-spin mr-2"/>Loading accounts…
      </div>
    );
  }
  if (err) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl p-4 card-danger" data-testid="ar-err">
        {err}
      </div>
    );
  }
  if (!data || !data.clients?.length) {
    return (
      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-10 text-center text-shTextMuted"
           data-testid="ar-empty">
        <i className="fas fa-circle-check text-shPrimary text-4xl mb-3 block"/>
        <p className="text-[15px] font-black uppercase tracking-widest">All settled up</p>
        <p className="text-[13px] mt-1 text-shTextMuted">No clients with outstanding balances or prepaid credits.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="ar-tab">
      {/* Sprint 110di-53 — Send-statement toast (also used for "no email" warnings) */}
      {statementToast && (
        <div className="bg-purple-500/15 border border-purple-500/40 text-purple-200 rounded-lg px-3 py-2 text-[13px] font-black"
             data-testid="ar-statement-toast">
          <i className="fas fa-envelope-circle-check mr-2 text-purple-300"/>{statementToast}
        </div>
      )}
      {/* Totals strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3" data-testid="ar-totals">
        <StatTile label="Owed to you" value={fmt(data.total_receivable)} tone="shAccent"
                  testid="ar-total-receivable"/>
        <StatTile label="Credit on file" value={fmt(data.total_credit_on_file)} tone="shPrimary"
                  testid="ar-total-credit"/>
        <StatTile label="Net" value={fmt(data.net)} tone={data.net >= 0 ? "shAccent" : "shPrimary"}
                  testid="ar-net"/>
      </div>

      {/* Clients table */}
      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl overflow-hidden card-table"
           data-testid="ar-clients-table">
        <div className="px-4 py-3 border-b border-shBorder flex items-center justify-between">
          <h3 className="text-[13px] uppercase tracking-widest font-black text-shTextMuted">
            <i className="fas fa-users mr-2"/>
            {data.count} client{data.count === 1 ? "" : "s"} with balance
          </h3>
          <button onClick={load} data-testid="ar-refresh"
                  className="text-[12px] uppercase tracking-widest font-black text-shTextMuted hover:text-shPrimary">
            <i className="fas fa-rotate-right mr-1"/>Refresh
          </button>
        </div>
        <ul className="divide-y divide-shBorder">
          {data.clients.map((c) => {
            const owed = (c.account_balance || 0) > 0;
            return (
              <li key={c.id} className="px-4 py-3" data-testid={`ar-row-${c.id}`}>
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] font-black text-shText truncate">{c.name}</p>
                    <p className="text-[12px] text-shTextMuted truncate">
                      {c.email || "no email"} · {c.phone || "no phone"}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={`text-[10px] uppercase tracking-widest font-black ${owed ? "text-shAccent" : "text-shPrimary"}`}>
                      {owed ? "Owes" : "Credit"}
                    </p>
                    <p className={`text-2xl font-black ${owed ? "text-shAccent" : "text-shPrimary"}`}
                       data-testid={`ar-bal-${c.id}`}>
                      {fmt(Math.abs(c.account_balance))}
                    </p>
                  </div>
                  <div className="flex gap-1.5 flex-wrap">
                    <button onClick={() => setOpenLedger(openLedger === c.id ? null : c)}
                            data-testid={`ar-view-ledger-${c.id}`}
                            className="bg-[var(--sh-card-base)] border border-shBorder text-gray-200 px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest hover:border-shSecondary hover:text-shSecondary transition">
                      <i className="fas fa-list mr-1"/>Ledger
                    </button>
                    <button onClick={() => setPayOpen(c)}
                            data-testid={`ar-apply-payment-${c.id}`}
                            className="bg-shPrimary/20 border border-shPrimary/40 text-shPrimary px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest hover:bg-shPrimary/30 transition">
                      <i className="fas fa-cash-register mr-1"/>Apply payment
                    </button>
                    <button onClick={() => setAdjOpen(c)}
                            data-testid={`ar-adjust-${c.id}`}
                            className="bg-shSecondary/15 border border-shSecondary/40 text-shSecondary px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest hover:bg-shSecondary/25 transition">
                      <i className="fas fa-sliders mr-1"/>Adjust
                    </button>
                    <button onClick={() => sendStatement(c)}
                            disabled={!!sendingStatement[c.id] || !c.email}
                            title={c.email ? `Email ledger statement to ${c.email}` : "No email on file"}
                            data-testid={`ar-send-statement-${c.id}`}
                            className="bg-purple-500/15 border border-purple-500/40 text-purple-300 px-3 py-1.5 rounded text-[11px] font-black uppercase tracking-widest hover:bg-purple-500/25 transition disabled:opacity-40 disabled:cursor-not-allowed">
                      <i className={`fas ${sendingStatement[c.id] ? "fa-circle-notch fa-spin" : "fa-envelope"} mr-1`}/>
                      {sendingStatement[c.id] ? "Sending…" : "Send statement"}
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

      {/* Money Hub consolidation — this used to be a separate ApplyPaymentModal
          implementation calling POST /clients/{id}/payment directly (no
          tendered/change capture, no hardware integration). Reuses the
          shared TakePaymentModal now — one canonical "take a payment" UI,
          with the same cash/hardware rules as everywhere else. */}
      {payOpen && (
        <TakePaymentModal presetClientId={payOpen.id} onClose={() => setPayOpen(null)}
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
    shPrimary:  "border-shPrimary/40 bg-shPrimary/10 text-shPrimary",
    shAccent: "border-shAccent/40 bg-shAccent/10 text-shAccent",
    shSecondary:   "border-shSecondary/40 bg-shSecondary/10 text-shSecondary",
  };
  return (
    <div className={`border rounded-xl p-4 ${tones[tone] || tones.shSecondary}`} data-testid={testid}>
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
  if (rows === null) return <p className="mt-3 text-shTextMuted text-[13px]"><i className="fas fa-circle-notch fa-spin mr-1"/>Loading…</p>;
  if (rows.length === 0) return <p className="mt-3 text-shTextMuted text-[13px]">No ledger entries yet.</p>;
  return (
    <div className="mt-3 bg-[var(--sh-card-base)]/40 border border-shBorder rounded-lg p-3"
         data-testid={`ar-ledger-${clientId}`}>
      <p className="text-[11px] uppercase tracking-widest font-black text-shTextMuted mb-2">
        <i className="fas fa-clock-rotate-left mr-1"/>Ledger · {clientName} · Balance {fmt(balance)}
      </p>
      <ul className="divide-y divide-shBorder/40">
        {rows.map((r) => {
          const t = ROW_TYPE_TONE[r.type] || { tone: "text-shTextMuted", icon: "fa-receipt", label: r.type };
          return (
            <li key={r.id} className="py-2 flex items-center gap-3 text-[13px]"
                data-testid={`ledger-row-${r.id}`}>
              <i className={`fas ${t.icon} ${t.tone}`}/>
              <div className="flex-1 min-w-0">
                <p className="text-shText truncate"><span className={`${t.tone} font-black uppercase tracking-widest text-[11px] mr-2`}>{t.label}</span>{r.notes || ""}</p>
                <p className="text-[11px] text-shTextMuted">{fmtDateTime(r.created_at)}{r.method ? ` · ${r.method}` : ""}</p>
              </div>
              <span className={`${r.amount > 0 ? "text-shAccent" : "text-shPrimary"} font-black`}>
                {r.amount > 0 ? "+" : ""}{fmt(r.amount)}
              </span>
            </li>
          );
        })}
      </ul>
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
      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-md p-6 shadow-2xl">
        <h3 className="text-xl font-black text-shText uppercase tracking-tight mb-1">
          <i className="fas fa-sliders text-shSecondary mr-2"/>Manual Adjustment
        </h3>
        <p className="text-[13px] text-shTextMuted mb-4">
          {client.name} · Balance {fmt(client.account_balance)}
        </p>
        <p className="text-[12px] text-shTextMuted mb-3">
          Use NEGATIVE to forgive part of the tab (write-off). POSITIVE to add to it (manual charge).
        </p>
        <label className="text-[11px] uppercase tracking-widest font-black text-shTextMuted">Amount (signed)</label>
        <input type="number" step="0.01" value={amount} onChange={(e)=>setAmount(e.target.value)}
               data-testid="ar-adj-amount" placeholder="-25.00"
               className="w-full mt-1 mb-3 bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm"/>
        <label className="text-[11px] uppercase tracking-widest font-black text-shTextMuted">Reason (required)</label>
        <input value={notes} onChange={(e)=>setNotes(e.target.value)} data-testid="ar-adj-notes"
               placeholder="Goodwill write-off"
               className="w-full mt-1 mb-4 bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm"/>
        {err && <p className="text-red-400 text-[13px] mb-3">{err}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="text-shTextMuted px-4 py-2 font-black uppercase text-[13px] tracking-widest">Cancel</button>
          <button onClick={submit} disabled={busy || amount === "" || Number(amount) === 0 || !notes.trim()}
                  data-testid="ar-adj-submit"
                  className="bg-shSecondary text-shText px-6 py-2 rounded font-black uppercase text-[13px] tracking-widest disabled:opacity-50">
            {busy ? "Saving…" : "Apply adjustment"}
          </button>
        </div>
      </div>
    </div>
  );
}
