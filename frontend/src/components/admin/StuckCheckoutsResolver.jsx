import { useEffect, useState } from "react";
import { api, formatErr } from "../../lib/api";
import { toast } from "sonner";

/* Bulk resolver for stuck stays — checked in, never checked out, scheduled
   end already passed. DELIBERATELY NON-FINANCIAL (mirrors the backend rule):
   resolving stamps the checkout and completes the booking with an audit
   reason, but never bills, deducts credits, or touches prices. A stay that
   still needs to be CHARGED must go through the normal checkout modal. */

export default function StuckCheckoutsResolver({ onClose, onResolved }) {
  const [rows, setRows] = useState(null);
  const [selected, setSelected] = useState({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get("/admin/bookings/stuck-checkouts")
      .then(r => {
        const list = r.data || [];
        setRows(list);
        setSelected(Object.fromEntries(list.map(b => [b.id, true])));
      })
      .catch(e => { toast.error(formatErr(e.response?.data?.detail) || "Could not load stuck checkouts"); setRows([]); });
  }, []);

  const selectedIds = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);
  const toggle = (id) => setSelected(s => ({ ...s, [id]: !s[id] }));

  const resolve = async () => {
    if (selectedIds.length === 0) { toast.error("Select at least one booking"); return; }
    if (reason.trim().length < 3) { toast.error("Enter a short reason for the audit trail"); return; }
    setBusy(true);
    try {
      const { data } = await api.post("/admin/bookings/resolve-stuck-checkouts", {
        booking_ids: selectedIds, reason: reason.trim(),
      });
      toast.success(`Resolved ${data.resolved_count} booking${data.resolved_count === 1 ? "" : "s"}${data.skipped?.length ? ` · ${data.skipped.length} skipped` : ""}`);
      onResolved?.();
      onClose();
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail) || "Could not resolve");
    }
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-sm grid place-items-center p-3 sm:p-6" onClick={onClose} data-testid="stuck-checkouts-modal">
      <div onClick={(e) => e.stopPropagation()}
           className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-2xl shadow-2xl max-h-[calc(var(--app-height)_-_2rem)] flex flex-col min-h-0">
        <div className="px-5 py-4 border-b border-shBorder shrink-0">
          <h2 className="text-lg font-black uppercase italic text-shText tracking-tight"><i className="fas fa-door-open text-shAccent mr-2"/>Resolve Stuck Checkouts</h2>
          <p className="text-[13px] text-shTextMuted mt-1">
            These dogs are recorded as still on-site past their scheduled stay. Resolving marks them checked out
            <span className="text-shText font-bold"> without charging anything</span> — a stay that still needs payment should use the normal checkout instead.
          </p>
        </div>
        <div className="overflow-y-auto flex-1 min-h-0 p-4 space-y-1.5">
          {rows === null && <p className="text-shTextMuted text-sm p-4 text-center"><i className="fas fa-spinner fa-spin mr-2"/>Loading…</p>}
          {rows !== null && rows.length === 0 && <p className="text-shTextMuted text-sm p-4 text-center">Nothing stuck — all clear.</p>}
          {(rows || []).map(b => (
            <label key={b.id} className="flex items-center gap-3 rounded-lg border border-shBorder bg-black/20 px-3 py-2 cursor-pointer" data-testid={`stuck-row-${b.id}`}>
              <input type="checkbox" checked={!!selected[b.id]} onChange={() => toggle(b.id)} className="accent-shPrimary w-4 h-4 shrink-0"/>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-black text-shText truncate">{b.dog_name || "Dog"} <span className="text-shTextMuted font-normal">· {b.client_name || "—"}</span></span>
                <span className="block text-[12px] text-shTextMuted truncate">{b.service_type} · {b.date}{b.end_date && b.end_date !== b.date ? ` → ${b.end_date}` : ""}</span>
              </span>
              {b.payment_status !== "paid" && !b.actual_price && (
                <span className="shrink-0 text-[10px] font-black uppercase tracking-widest bg-shAccent/15 text-shAccent border border-shAccent/40 rounded px-1.5 py-0.5" title="No payment recorded — resolving will NOT charge them">Unpaid</span>
              )}
            </label>
          ))}
        </div>
        <div className="px-5 py-4 border-t border-shBorder shrink-0 space-y-3">
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300}
                 placeholder="Reason (required, e.g. test data cleanup / forgot to check out) — saved on every booking"
                 data-testid="stuck-resolve-reason"
                 className="w-full bg-black/20 border border-shBorder rounded-lg p-2.5 text-shText text-[13px]"/>
          <div className="flex justify-end gap-3">
            <button onClick={onClose} className="text-shTextMuted font-black uppercase text-[13px] tracking-widest">Cancel</button>
            <button onClick={resolve} disabled={busy || selectedIds.length === 0} data-testid="stuck-resolve-submit"
                    className="bg-shPrimary text-bgHeader px-5 py-2.5 rounded-lg font-black text-[13px] uppercase tracking-widest disabled:opacity-50">
              {busy ? <><i className="fas fa-spinner fa-spin mr-2"/>Resolving…</> : `Resolve ${selectedIds.length} (no charge)`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
