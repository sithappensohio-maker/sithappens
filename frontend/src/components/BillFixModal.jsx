import { useCallback, useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import { useAuth } from "../lib/auth";
import StuckOnlinePayments from "./StuckOnlinePayments";
import { announcePendingActionsChanged } from "./PendingActionsPanel";

// Line a bill back up with the client's account (audit #7). A bill whose visit
// went on the tab can only be collected while the two agree; this shows where
// they differ and the three ways to fix it. Backend: domains/billing/resolve.py.

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const day = (iso) => String(iso || "").slice(0, 10);

export default function BillFixModal({ invoiceId, onClose, onChanged }) {
  const auth = useAuth();
  const canFix = !!auth?.can?.("delete_records");
  const [pv, setPv] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    api.get(`/invoices/${invoiceId}/reconcile`).then(({ data }) => setPv(data)).catch((e) => setErr(formatErr(e?.response?.data?.detail) || "Couldn't load this bill"));
  }, [invoiceId]);
  useEffect(() => { load(); }, [load]);

  const act = async (body) => {
    setBusy(true); setErr("");
    try {
      const { data } = await api.post(`/invoices/${invoiceId}/reconcile`, body);
      setPv(data); onChanged?.(); announcePendingActionsChanged();
    } catch (e) {
      setErr(formatErr(e?.response?.data?.detail) || "That didn't work");
      load();
    } finally { setBusy(false); }
  };

  const inv = pv?.invoice || {};
  return (
    <div className="fixed inset-0 z-[80] bg-black/75 overflow-y-auto p-4 grid place-items-start sm:place-items-center" data-testid="bill-fix-modal"
         onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-xl my-8 bg-bgCard border border-shBorder rounded-2xl shadow-2xl sh-modal-surface p-5 space-y-4" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.3em] font-black text-shAccent">Fix a bill</p>
            <h2 className="text-xl font-black text-shText mt-1">Bill #{pv?.invoice_number || "…"}</h2>
            {pv && <p className="text-sm text-shTextMuted mt-1">Owed {money(inv.balance)} · Total {money(inv.total)} · Paid {money(inv.amount_paid)}</p>}
          </div>
          <button onClick={onClose} className="text-shTextMuted hover:text-shText" aria-label="Close"><i className="fas fa-times" /></button>
        </div>

        {!pv && !err && <p className="text-shTextMuted text-sm">Loading…</p>}
        {err && <div className="bg-red-500/10 border border-red-500/40 text-red-300 rounded-lg p-3 text-sm font-bold" data-testid="bill-fix-error">{err}</div>}

        {pv?.online_payment && ["reconciliation_required", "refunding"].includes(pv.online_payment.status) && (
          <StuckOnlinePayments invoiceId={invoiceId} highlightId={pv.online_payment.id} onChanged={() => { load(); onChanged?.(); }} />
        )}
        {pv?.refund_activity && <p className="text-sm text-shTextMuted">This bill has a refund on it, so it can't be changed here.</p>}
        {pv?.visits_reopened && <p className="text-sm text-shTextMuted">A visit on this bill was reopened. Check it out again first.</p>}

        {pv && pv.in_step && !pv.online_payment && !pv.can_apply_credit && (
          <p className="text-sm text-shPrimary font-bold" data-testid="bill-fix-in-step"><i className="fas fa-check mr-1" />This bill is in step with the account. Nothing to fix.</p>
        )}

        {pv?.on_tab && pv.difference !== 0 && (
          <div className="border border-shBorder rounded-lg p-3 space-y-2" data-testid="bill-fix-match">
            <p className="text-sm text-shText">
              The bill says <strong>{money(inv.balance)}</strong> is owed. The account history for this visit says <strong>{money(pv.tab_amount)}</strong>.
            </p>
            {canFix && pv.can_match && (
              <button onClick={() => act({ action: "match", expected_balance: inv.balance })} disabled={busy} data-testid="bill-fix-match-btn"
                      className="px-3 py-2 rounded bg-shSecondary text-shText text-[12px] font-black uppercase tracking-wider disabled:opacity-50">
                Set the bill to {money(pv.match_to)}
              </button>
            )}
          </div>
        )}

        {pv?.credit_on_file > 0.005 && pv?.can_apply_credit && (
          <div className="border border-shBorder rounded-lg p-3 space-y-2" data-testid="bill-fix-credit">
            <p className="text-sm text-shText">This client has <strong>{money(pv.credit_on_file)}</strong> of credit on file that no bill uses.</p>
            {canFix && (
              <button onClick={() => act({ action: "apply_credit" })} disabled={busy} data-testid="bill-fix-credit-btn"
                      className="px-3 py-2 rounded bg-shSecondary text-shText text-[12px] font-black uppercase tracking-wider disabled:opacity-50">
                Use {money(Math.min(pv.credit_on_file, Number(inv.balance || 0)))} of it on this bill
              </button>
            )}
          </div>
        )}

        {pv?.unexplained?.length > 0 && (
          <div className="border border-shBorder rounded-lg p-3 space-y-2" data-testid="bill-fix-unexplained">
            <p className="text-sm text-shText">These account entries lowered the balance without naming a bill. Was any of them for this bill?</p>
            {pv.unexplained.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 bg-[var(--sh-card-base)] rounded p-2" data-testid={`bill-fix-row-${r.id}`}>
                <span className="text-[13px] text-shTextMuted">{day(r.created_at)} · {r.type === "payment" ? "Payment" : "Write-off"} {money(-r.amount)}{r.notes ? ` · ${r.notes}` : ""}</span>
                {canFix && pv.can_review && (
                  <button onClick={() => act({ action: "attribute", row_id: r.id })} disabled={busy} data-testid={`bill-fix-attribute-${r.id}`}
                          className="px-2.5 py-1 rounded border border-shBorder text-[11px] font-black uppercase tracking-wider text-shText disabled:opacity-50">For this bill</button>
                )}
              </div>
            ))}
            {canFix && pv.can_review && (
              <button onClick={() => act({ action: "review", through: pv.review_through })} disabled={busy} data-testid="bill-fix-review-btn"
                      className="px-3 py-2 rounded border border-shSecondary/50 text-shSecondary text-[12px] font-black uppercase tracking-wider disabled:opacity-50">
                None of these were for this bill
              </button>
            )}
          </div>
        )}

        {!canFix && pv && (!pv.in_step || pv.can_apply_credit) && <p className="text-[12px] text-shTextMuted">Only staff who can make financial corrections can fix this.</p>}
      </div>
    </div>
  );
}
