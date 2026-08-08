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
import { EmptyState, FormError, FormInput, FormLabel, PremiumButton, SectionCard, StatusBadge } from "../components/premium";

const fmt = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const fmtDateTime = (iso) => {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); }
  catch { return iso; }
};

const ROW_TYPE_TONE = {
  charge:     { tone: "text-shAccent",  icon: "fa-arrow-up",   label: "Charge" },
  payment:    { tone: "text-shPrimary", icon: "fa-arrow-down", label: "Payment" },
  refund:     { tone: "text-red-400",    icon: "fa-rotate-left", label: "Refund" },
  adjustment: { tone: "text-shSecondary", icon: "fa-pen-to-square", label: "Adjustment" },
};

export default function AccountsReceivableTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [openLedger, setOpenLedger] = useState(null);
  const [payOpen, setPayOpen] = useState(null);
  const [adjOpen, setAdjOpen] = useState(null);
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
      <SectionCard accent="cyan" className="text-center py-8" data-testid="ar-loading">
        <i className="fas fa-circle-notch fa-spin text-2xl text-shSecondary"/>
        <p className="text-shText font-bold mt-3">Loading accounts…</p>
      </SectionCard>
    );
  }
  if (err) {
    return (
      <SectionCard accent="danger" data-testid="ar-err">
        <div className="flex items-start gap-3 text-red-300">
          <i className="fas fa-triangle-exclamation mt-0.5"/>
          <div><p className="font-black">Accounts receivable couldn't load.</p><p className="text-[13px] mt-1 opacity-85">{err}</p></div>
        </div>
      </SectionCard>
    );
  }
  if (!data || !data.clients?.length) {
    return (
      <EmptyState
        icon="fa-circle-check"
        accent="lime"
        title="All settled up"
        description="No clients with outstanding balances or prepaid credits."
        testId="ar-empty"
      />
    );
  }

  return (
    <div className="space-y-4 sh-ar-workspace" data-testid="ar-tab">
      {statementToast && (
        <SectionCard accent="purple" intensity="subtle" className="py-3" data-testid="ar-statement-toast">
          <p className="text-[13px] font-bold text-purple-200"><i className="fas fa-envelope-circle-check mr-2 text-purple-300"/>{statementToast}</p>
        </SectionCard>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3" data-testid="ar-totals">
        <StatTile label="Owed to you" value={fmt(data.total_receivable)} tone="warning" testid="ar-total-receivable"/>
        <StatTile label="Credit on file" value={fmt(data.total_credit_on_file)} tone="success" testid="ar-total-credit"/>
        <StatTile label="Net position" value={fmt(data.net)} tone={data.net >= 0 ? "warning" : "success"} testid="ar-net"/>
      </div>

      <SectionCard accent="cyan" intensity="subtle" className="!p-0 overflow-hidden sh-ar-ledger-list" data-testid="ar-clients-table">
        <div className="px-4 py-3 border-b border-shBorder flex items-center justify-between gap-3">
          <div>
            <p className="sh-eyebrow text-shSecondary"><i className="fas fa-users mr-1.5"/>Accounts with balance</p>
            <p className="text-[13px] text-shTextMuted mt-1">{data.count} client{data.count === 1 ? "" : "s"} need money attention.</p>
          </div>
          <PremiumButton onClick={load} data-testid="ar-refresh" variant="ghost" className="!px-3 !py-2 !min-h-[38px] !text-[12px]">
            <i className="fas fa-rotate-right"/>Refresh
          </PremiumButton>
        </div>

        <ul className="divide-y divide-shBorder/70">
          {data.clients.map((c) => {
            const owed = (c.account_balance || 0) > 0;
            const ledgerOpen = openLedger === c.id || openLedger?.id === c.id;
            return (
              <li key={c.id} className="sh-ar-row" data-testid={`ar-row-${c.id}`}>
                <div className="sh-ar-row__main">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[15px] font-black text-shText truncate">{c.name}</p>
                      <StatusBadge tone={owed ? "warning" : "success"}>{owed ? "Balance due" : "Credit on file"}</StatusBadge>
                    </div>
                    <p className="text-[12px] text-shTextMuted truncate mt-1">{c.email || "No email"} · {c.phone || "No phone"}</p>
                  </div>

                  <div className="sh-ar-row__balance">
                    <p className="text-[10px] font-bold text-shTextMuted">{owed ? "Owes" : "Credit"}</p>
                    <p className={`text-2xl font-black ${owed ? "text-shAccent" : "text-shPrimary"}`} data-testid={`ar-bal-${c.id}`}>{fmt(Math.abs(c.account_balance))}</p>
                  </div>
                </div>

                <div className="sh-ar-row__actions">
                  <PremiumButton
                    onClick={() => setOpenLedger(ledgerOpen ? null : c)}
                    data-testid={`ar-view-ledger-${c.id}`}
                    variant="secondary"
                    className="sh-ar-action"
                  ><i className="fas fa-list"/>{ledgerOpen ? "Hide ledger" : "Ledger"}</PremiumButton>
                  <PremiumButton onClick={() => setPayOpen(c)} data-testid={`ar-apply-payment-${c.id}`} className="sh-ar-action">
                    <i className="fas fa-cash-register"/>Apply payment
                  </PremiumButton>
                  <PremiumButton onClick={() => setAdjOpen(c)} data-testid={`ar-adjust-${c.id}`} variant="cyan" className="sh-ar-action">
                    <i className="fas fa-sliders"/>Adjust
                  </PremiumButton>
                  <PremiumButton
                    onClick={() => sendStatement(c)}
                    disabled={!!sendingStatement[c.id] || !c.email}
                    title={c.email ? `Email ledger statement to ${c.email}` : "No email on file"}
                    data-testid={`ar-send-statement-${c.id}`}
                    variant="secondary"
                    className="sh-ar-action"
                  >
                    <i className={`fas ${sendingStatement[c.id] ? "fa-circle-notch fa-spin" : "fa-envelope"}`}/>
                    {sendingStatement[c.id] ? "Sending…" : "Send statement"}
                  </PremiumButton>
                </div>

                {ledgerOpen && <LedgerDrawer clientId={c.id} clientName={c.name} />}
              </li>
            );
          })}
        </ul>
      </SectionCard>

      {payOpen && (
        <TakePaymentModal presetClientId={payOpen.id} onClose={() => setPayOpen(null)} onSuccess={() => { setPayOpen(null); load(); }} />
      )}
      {adjOpen && (
        <AdjustmentModal client={adjOpen} onClose={() => setAdjOpen(null)} onSuccess={() => { setAdjOpen(null); load(); }} />
      )}
    </div>
  );
}

function StatTile({ label, value, tone, testid }) {
  const accent = tone === "success" ? "lime" : tone === "warning" ? "orange" : "cyan";
  const valueClass = tone === "success" ? "text-shPrimary" : tone === "warning" ? "text-shAccent" : "text-shSecondary";
  return (
    <SectionCard accent={accent} intensity="subtle" className="!p-4" data-testid={testid}>
      <p className="text-[11px] font-bold text-shTextMuted">{label}</p>
      <p className={`text-2xl sm:text-3xl font-black mt-1 ${valueClass}`}>{value}</p>
    </SectionCard>
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
    <div className="sh-ar-ledger" data-testid={`ar-ledger-${clientId}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <p className="text-[11px] font-bold text-shTextMuted"><i className="fas fa-clock-rotate-left mr-1.5 text-shSecondary"/>Ledger · {clientName}</p>
        <StatusBadge tone={balance > 0 ? "warning" : "success"}>Balance {fmt(balance)}</StatusBadge>
      </div>
      <ul className="divide-y divide-shBorder/40">
        {rows.map((r) => {
          const t = ROW_TYPE_TONE[r.type] || { tone: "text-shTextMuted", icon: "fa-receipt", label: r.type };
          return (
            <li key={r.id} className="py-2.5 flex items-center gap-3 text-[13px]" data-testid={`ledger-row-${r.id}`}>
              <span className="w-8 h-8 rounded-lg border border-shBorder bg-black/20 grid place-items-center shrink-0"><i className={`fas ${t.icon} ${t.tone}`}/></span>
              <div className="flex-1 min-w-0">
                <p className="text-shText truncate"><span className={`${t.tone} font-bold text-[11px] mr-2`}>{t.label}</span>{r.notes || ""}</p>
                <p className="text-[11px] text-shTextMuted">{fmtDateTime(r.created_at)}{r.method ? ` · ${r.method}` : ""}</p>
              </div>
              <span className={`${r.amount > 0 ? "text-shAccent" : "text-shPrimary"} font-black whitespace-nowrap`}>{r.amount > 0 ? "+" : ""}{fmt(r.amount)}</span>
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
      await api.post(`/clients/${client.id}/adjustment`, { amount: Number(amount), notes });
      onSuccess();
    } catch (e) {
      setErr(e?.response?.data?.detail || "Adjustment failed");
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-3 sm:p-4" data-testid="ar-adjust-modal" onMouseDown={(e)=>{ if(e.target===e.currentTarget) onClose(); }}>
      <SectionCard accent="cyan" className="w-full max-w-md sh-modal-surface">
        <div className="flex items-start justify-between gap-3 mb-5">
          <div>
            <p className="sh-eyebrow text-shSecondary">Finance correction</p>
            <h3 className="text-xl font-black text-shText mt-1">Manual adjustment</h3>
            <p className="text-[13px] text-shTextMuted mt-1">{client.name} · Balance {fmt(client.account_balance)}</p>
          </div>
          <PremiumButton type="button" variant="ghost" onClick={onClose} className="!px-3 !py-2 !min-h-[40px]" aria-label="Close"><i className="fas fa-times"/></PremiumButton>
        </div>
        <p className="text-[12px] text-shTextMuted mb-4">Use a negative amount to forgive part of the tab. Use a positive amount to add a manual charge.</p>
        <div className="space-y-4">
          <div>
            <FormLabel>Amount (signed)</FormLabel>
            <FormInput type="number" step="0.01" value={amount} onChange={(e)=>setAmount(e.target.value)} data-testid="ar-adj-amount" placeholder="-25.00"/>
          </div>
          <div>
            <FormLabel>Reason (required)</FormLabel>
            <FormInput value={notes} onChange={(e)=>setNotes(e.target.value)} data-testid="ar-adj-notes" placeholder="Goodwill write-off"/>
          </div>
          <FormError>{err}</FormError>
          <div className="grid grid-cols-2 gap-2">
            <PremiumButton type="button" variant="secondary" onClick={onClose} className="justify-center">Cancel</PremiumButton>
            <PremiumButton type="button" variant="cyan" onClick={submit} disabled={busy || amount === "" || Number(amount) === 0 || !notes.trim()} data-testid="ar-adj-submit" className="justify-center">
              {busy ? <><i className="fas fa-circle-notch fa-spin"/>Saving…</> : "Apply adjustment"}
            </PremiumButton>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
