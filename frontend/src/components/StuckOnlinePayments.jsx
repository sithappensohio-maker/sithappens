import { useCallback, useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useConfirm } from "../lib/useConfirm";
import { announcePendingActionsChanged } from "./PendingActionsPanel";

// Online payments the customer made but the app couldn't record against the
// bill (the bill had changed). The money is already taken, so each one needs
// a decision: Retry (record it — the server checks with Stripe first) or
// Refund (give it back and free the bill). Backend: domains/billing/resolve.py.

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;

export default function StuckOnlinePayments({ onChanged, highlightId = null, invoiceId = null }) {
  const auth = useAuth();
  const canAct = !!auth?.can?.("delete_records");
  const confirm = useConfirm();
  const [rows, setRows] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [msg, setMsg] = useState({});

  const load = useCallback(() => {
    api.get("/admin/online-payments/stuck")
      .then(({ data }) => setRows((data?.payments || []).filter((p) => !invoiceId || p.invoice_id === invoiceId)))
      .catch(() => setRows([]));
  }, [invoiceId]);
  useEffect(() => { load(); }, [load]);

  const act = async (p, action) => {
    if (action === "close" && !(await confirm({
      title: "Close this payment?",
      body: "The bank gave this money back to the customer. The bill is freed and still owed.",
      confirmText: "Close", tone: "danger",
    }))) return;
    if (action === "refund" && !(await confirm({
      title: "Refund this online payment?",
      body: `${money(p.amount)} goes back to ${p.client_name || "the customer"}'s card. The bill stays open so they can pay the right amount.`,
      confirmText: "Refund", tone: "danger",
    }))) return;
    setBusyId(p.id); setMsg((m) => ({ ...m, [p.id]: "" }));
    try {
      await api.post(`/admin/online-payments/stuck/${p.id}/${action}`);
      setMsg((m) => ({ ...m, [p.id]: action === "retry" ? "Recorded ✓" : action === "close" ? "Closed ✓" : "Refunded ✓" }));
      load(); onChanged?.(); announcePendingActionsChanged();
    } catch (e) {
      setMsg((m) => ({ ...m, [p.id]: formatErr(e?.response?.data?.detail) || "That didn't work" }));
    } finally { setBusyId(null); }
  };

  if (!rows || rows.length === 0) return null;
  return (
    <div className="border border-red-500/40 bg-red-500/5 rounded-xl p-3 mb-3" data-testid="stuck-online-payments">
      <p className="text-[12px] uppercase tracking-widest font-black text-red-300 mb-2">
        <i className="fas fa-triangle-exclamation mr-1" />Paid online, not recorded yet ({rows.length})
      </p>
      <div className="space-y-2">
        {rows.map((p) => (
          <div key={p.id} data-testid={`stuck-payment-${p.id}`}
               className={`rounded-lg border p-3 ${highlightId === p.id ? "border-shAccent" : "border-shBorder"} bg-[var(--sh-card-base)]`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-shText font-black">{money(p.amount)} · {p.client_name || "Client"} · Bill #{p.invoice_number}</p>
                <p className="text-[12px] text-shTextMuted mt-0.5">{p.reason}</p>
                {msg[p.id] && <p className="text-[12px] font-bold mt-1 text-shSecondary" data-testid={`stuck-payment-msg-${p.id}`}>{msg[p.id]}</p>}
              </div>
              {canAct && (
                <div className="flex gap-1.5 shrink-0">
                  {p.can_retry && (
                    <button onClick={() => act(p, "retry")} disabled={busyId === p.id} data-testid={`stuck-payment-retry-${p.id}`}
                            className="px-3 py-1.5 rounded bg-shSecondary text-shText text-[12px] font-black uppercase tracking-wider disabled:opacity-50">Retry</button>
                  )}
                  {p.can_close && (
                    <button onClick={() => act(p, "close")} disabled={busyId === p.id} data-testid={`stuck-payment-close-${p.id}`}
                            className="px-3 py-1.5 rounded border border-shBorder text-shText text-[12px] font-black uppercase tracking-wider disabled:opacity-50">Close</button>
                  )}
                  {p.can_refund && (
                    <button onClick={() => act(p, "refund")} disabled={busyId === p.id} data-testid={`stuck-payment-refund-${p.id}`}
                            className="px-3 py-1.5 rounded border border-red-500/50 text-red-300 text-[12px] font-black uppercase tracking-wider disabled:opacity-50">Refund</button>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
