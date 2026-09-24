import { useCallback, useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import { useConfirm } from "../lib/useConfirm";
import { toast } from "sonner";

/**
 * A dog's client-uploaded vaccine certificates that are waiting for approval,
 * with the photo and Approve / Reject — shown on the dog's own page.
 *
 * Opening a dog from a "vaccine uploads awaiting approval" alert used to land
 * on a page with no way to approve anything; the only buttons lived in the
 * Today screen's review box.
 *
 * `onApproved(vaccine, expiresOn)` lets the host update its own form, so a
 * later Save of the dog doesn't write the old date back over the approval.
 */
export default function PendingVaccineUploads({ dogId, onApproved, onChanged }) {
  const confirm = useConfirm();
  const [rows, setRows] = useState([]);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState("");
  const [photo, setPhoto] = useState(null);

  const load = useCallback(async () => {
    if (!dogId) return;
    try {
      const { data } = await api.get("/admin/vaccine-cert-uploads");
      setRows((Array.isArray(data) ? data : []).filter(r => r.dog_id === dogId));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [dogId]);
  useEffect(() => { load(); }, [load]);

  const approve = async (r) => {
    setBusy(r.vaccine);
    try {
      const { data } = await api.post(`/admin/dogs/${r.dog_id}/vaccine-cert/${r.vaccine}/review`);
      setRows(prev => prev.filter(x => x.vaccine !== r.vaccine));
      onApproved?.(r.vaccine, data?.expires_on || r.expires_on);
      onChanged?.(r.vaccine);
      toast.success(`${String(r.vaccine).toUpperCase()} approved — good until ${data?.expires_on || r.expires_on}.`);
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail) || "Couldn't approve this vaccine upload.");
    } finally { setBusy(""); }
  };

  const reject = async (r) => {
    const ok = await confirm({
      title: `Reject ${String(r.vaccine).toUpperCase()} upload?`,
      body: `This removes the pending upload. ${r.dog_name || "The dog"}'s previously approved date is kept unless it exactly matches this upload. The client will need to upload again.`,
      confirmText: "Reject",
      destructive: true,
    });
    if (!ok) return;
    setBusy(r.vaccine);
    try {
      await api.delete(`/admin/dogs/${r.dog_id}/vaccine-cert/${r.vaccine}`);
      setRows(prev => prev.filter(x => x.vaccine !== r.vaccine));
      onChanged?.(r.vaccine);
    } catch (e) {
      toast.error(formatErr(e.response?.data?.detail) || "Couldn't reject this vaccine upload.");
    } finally { setBusy(""); }
  };

  if (failed) {
    return (
      <div className="rounded-xl border border-shOrange/40 bg-shOrange/10 p-3 text-[13px] text-shOrange" data-testid="dog-pending-vax-failed">
        <i className="fas fa-triangle-exclamation mr-1.5"/>Couldn't check for vaccine uploads waiting for approval.
        <button type="button" onClick={load} className="ml-2 underline font-black">Try again</button>
      </div>
    );
  }
  if (rows.length === 0) return null;
  return (
    <div className="rounded-xl border border-shSecondary/40 bg-shSecondary/5 p-3 space-y-2" data-testid="dog-pending-vax">
      <p className="text-[13px] font-black uppercase tracking-widest text-shSecondary">
        <i className="fas fa-file-medical mr-1.5"/>Waiting for your approval · {rows.length}
      </p>
      {rows.map(r => (
        <div key={r.vaccine} className="rounded-lg border border-shBorder bg-[var(--sh-card-base)] p-2.5 flex items-center gap-3 flex-wrap" data-testid={`dog-pending-vax-${r.vaccine}`}>
          {r.photo ? (
            <button type="button" onClick={() => setPhoto(r)} title="View certificate"
                    className="w-12 h-12 rounded-lg overflow-hidden border border-shSecondary/30 shrink-0">
              <img src={r.photo} alt="Vaccine certificate" className="w-full h-full object-cover"/>
            </button>
          ) : (
            <div className="w-12 h-12 rounded-lg bg-black/20 grid place-items-center text-shTextMuted shrink-0"><i className="fas fa-image"/></div>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-black text-shText uppercase">{r.vaccine}</p>
            <p className="text-[12px] text-shTextMuted">
              {r.expires_on ? `Client entered expiry ${r.expires_on}` : "No expiry date entered"}
              {r.photo ? " · tap the photo to check it" : ""}
            </p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => reject(r)} disabled={!!busy} data-testid={`dog-pending-vax-reject-${r.vaccine}`}
                    className="px-3 py-2 rounded-lg bg-shDanger/15 text-red-300 text-[11px] font-black uppercase tracking-wider disabled:opacity-50">Reject</button>
            <button type="button" onClick={() => approve(r)} disabled={!!busy} data-testid={`dog-pending-vax-approve-${r.vaccine}`}
                    className="px-3 py-2 rounded-lg bg-shPrimary/15 text-shPrimary text-[11px] font-black uppercase tracking-wider disabled:opacity-50">
              {busy === r.vaccine ? "…" : "Approve"}
            </button>
          </div>
        </div>
      ))}
      {photo && (
        <div className="fixed inset-0 z-[90] bg-black/80 grid place-items-center p-6" onClick={() => setPhoto(null)} data-testid="dog-pending-vax-photo">
          <img src={photo.photo} alt="Vaccine certificate" className="max-h-[80vh] max-w-full object-contain rounded-lg"/>
        </div>
      )}
    </div>
  );
}
