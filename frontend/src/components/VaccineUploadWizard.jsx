import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { compressImage } from "../lib/imageCompress";
import PremiumButton from "./premium/PremiumButton";

/**
 * Multi-step wizard that walks a client through uploading every missing /
 * expired required vaccine in one continuous flow. Reuses the per-vaccine
 * upload contract (POST /portal/dogs/{dog_id}/vaccine-update) instead of
 * inventing a new endpoint.
 *
 * This version is intentionally very explicit for clients: after each save it
 * says what was uploaded, what vaccine is next, and that uploads still need
 * admin approval before booking unlocks.
 */
export default function VaccineUploadWizard({ queue = [], onClose = () => {}, onAllDone = () => {}, onProgress = () => {} }) {
  const [idx, setIdx] = useState(0);
  const [expiresOn, setExpiresOn] = useState("");
  const [photo, setPhoto] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");
  const [done, setDone] = useState(false);

  const current = queue[idx];
  const total = queue.length;
  const isLast = idx >= total - 1;

  const vaxLabel = (key) => ({ rabies: "Rabies", bordetella: "Bordetella", dhpp: "DHPP" }[key] || key);
  const label = current ? vaxLabel(current.vaccine) : "Vaccine";
  const progressPct = total ? Math.round(((idx + 1) / total) * 100) : 0;

  const stepSummary = useMemo(() => queue.map((item, i) => ({
    key: `${item.dog?.id || "dog"}-${item.vaccine}-${i}`,
    label: vaxLabel(item.vaccine),
    dogName: item.dog?.name || "Dog",
    state: i < idx ? "done" : i === idx ? "current" : "upcoming",
  })), [queue, idx]);

  // Reset the per-step inputs whenever idx changes. Keep the green notice so
  // the client sees exactly why the screen changed to the next vaccine.
  useEffect(() => {
    setExpiresOn(""); setPhoto(""); setErr("");
  }, [idx]);

  if (done) {
    return (
      <div className="fixed inset-0 z-50 bg-black/80 p-3 sm:p-6 overflow-y-auto flex items-center"
           data-testid="vaccine-wizard-done">
        <div className="rounded-xl border border-shPrimary/40 max-w-md mx-auto overflow-hidden shadow-sh" style={{ background: "var(--sh-card-base)" }}>
          <div className="p-6 space-y-4">
            <div className="text-center">
              <span className="inline-flex w-14 h-14 rounded-full bg-shPrimary/15 text-shPrimary items-center justify-center text-2xl mb-2">
                <i className="fas fa-circle-check"/>
              </span>
              <p className="text-lg font-bold text-shText leading-tight">
                Upload Received!
              </p>
              <p className="text-[13px] text-shAccent font-black uppercase tracking-widest mt-1">
                This is NOT approved yet
              </p>
            </div>
            <div className="space-y-2.5">
              <div className="flex items-start gap-3 border border-shBorder rounded-lg p-3" style={{ background: "var(--sh-card-base)" }}>
                <span className="shrink-0 w-6 h-6 rounded-full bg-shPrimary/20 text-shPrimary font-black text-[12px] flex items-center justify-center">1</span>
                <p className="text-[13px] text-shTextMuted leading-snug">We got {savedCount} of {total} vaccine record{total === 1 ? "" : "s"} you uploaded.</p>
              </div>
              <div className="flex items-start gap-3 border border-shBorder rounded-lg p-3" style={{ background: "var(--sh-card-base)" }}>
                <span className="shrink-0 w-6 h-6 rounded-full bg-shPrimary/20 text-shPrimary font-black text-[12px] flex items-center justify-center">2</span>
                <p className="text-[13px] text-shTextMuted leading-snug">Our staff will look at each certificate you sent.</p>
              </div>
              <div className="flex items-start gap-3 border border-shBorder rounded-lg p-3" style={{ background: "var(--sh-card-base)" }}>
                <span className="shrink-0 w-6 h-6 rounded-full bg-shPrimary/20 text-shPrimary font-black text-[12px] flex items-center justify-center">3</span>
                <p className="text-[13px] text-shTextMuted leading-snug">We will either <span className="text-shPrimary font-black">APPROVE</span> it or <span className="text-shDanger font-black">DECLINE</span> it — this takes a little time, it is not instant.</p>
              </div>
              <div className="flex items-start gap-3 border border-shBorder rounded-lg p-3" style={{ background: "var(--sh-card-base)" }}>
                <span className="shrink-0 w-6 h-6 rounded-full bg-shPrimary/20 text-shPrimary font-black text-[12px] flex items-center justify-center">4</span>
                <p className="text-[13px] text-shTextMuted leading-snug">Booking stays <span className="font-black">locked</span> until this is approved.</p>
              </div>
              <div className="flex items-start gap-3 border border-shBorder rounded-lg p-3" style={{ background: "var(--sh-card-base)" }}>
                <span className="shrink-0 w-6 h-6 rounded-full bg-shPrimary/20 text-shPrimary font-black text-[12px] flex items-center justify-center">5</span>
                <p className="text-[13px] text-shTextMuted leading-snug">Come back and check this page later to see if it was approved.</p>
              </div>
            </div>
            <PremiumButton variant="primary" onClick={onClose} data-testid="vaccine-wizard-done-close" className="w-full justify-center py-3">
              Got it
            </PremiumButton>
          </div>
        </div>
      </div>
    );
  }

  if (!current) return null;

  const handleFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const value = await compressImage(f, { maxWidth: 1400, maxHeight: 1400, quality: 0.78 });
      setPhoto(value);
      setErr("");
    } catch {
      setErr("Couldn't read that file. Try a clear photo instead.");
    }
  };

  const save = async () => {
    if (!expiresOn) { setErr(`Pick the ${label} expiry date before continuing.`); return; }
    if (!photo) { setErr(`Attach a clear photo or PDF of the ${label} certificate before continuing.`); return; }
    setErr(""); setSaving(true);
    try {
      await api.post(`/portal/dogs/${current.dog.id}/vaccine-update`, {
        vaccine: current.vaccine, expires_on: expiresOn, photo,
      });
      const next = savedCount + 1;
      setSavedCount(next);
      onProgress(next);
      if (isLast) {
        setDone(true);
        onAllDone();
      } else {
        const nextItem = queue[idx + 1];
        setNotice(`${label} uploaded for ${current.dog.name}. Next: upload ${vaxLabel(nextItem.vaccine)} for ${nextItem.dog.name}. You are not done yet.`);
        setIdx(idx + 1);
      }
    } catch (e) {
      const detail = e?.response?.data?.detail;
      setErr(typeof detail === "string" ? detail : "Upload failed.");
    } finally { setSaving(false); }
  };

  const skipStep = () => {
    if (!window.confirm(`Skip ${label} for ${current.dog.name}? This vaccine will still block booking until it is uploaded and approved.`)) return;
    setNotice(`${label} skipped. This still needs to be uploaded before booking unlocks.`);
    if (isLast) {
      if (savedCount > 0) onAllDone();
      onClose();
    } else {
      setIdx(idx + 1);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 p-3 sm:p-6 overflow-y-auto"
         data-testid="vaccine-wizard-modal" onClick={onClose}>
      <div className="rounded-xl border border-shBorder max-w-md mx-auto overflow-hidden shadow-sh" style={{ background: "var(--sh-card-base)" }}
           onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-shBorder flex items-start justify-between gap-2">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.35em] text-shPrimary mb-1">
              <i className="fas fa-shield-virus mr-1.5"/>Vaccine upload step {idx + 1} of {total}
            </p>
            <p className="text-lg font-bold text-shText leading-tight">
              Upload {label} now
            </p>
            <p className="text-[13px] text-shTextMuted mt-1">
              {current.dog.name} needs {total} vaccine record{total === 1 ? "" : "s"}. This wizard moves one vaccine at a time.
            </p>
          </div>
          <button onClick={onClose} className="text-shTextMuted hover:text-shText text-xl shrink-0"
                  data-testid="vaccine-wizard-close" aria-label="Close vaccine upload wizard">
            <i className="fas fa-xmark"/>
          </button>
        </div>

        <div className="h-2" style={{ background: "var(--sh-card-base)" }} aria-label={`Step ${idx + 1} of ${total}`}>
          <div className="h-full bg-shPrimary transition-all" style={{ width: `${progressPct}%` }}/>
        </div>

        <div className="p-5 space-y-4">
          {notice && (
            <div className="rounded-lg border border-shPrimary/40 bg-shPrimary/10 p-3" data-testid="vaccine-wizard-next-notice">
              <p className="text-[13px] text-shPrimary font-black uppercase tracking-widest leading-snug">
                <i className="fas fa-circle-check mr-1.5"/>{notice}
              </p>
            </div>
          )}

          <div className="rounded-lg border border-shAccent/35 bg-shAccent/10 p-3" data-testid="vaccine-wizard-instructions">
            <p className="text-[13px] text-shText font-black uppercase tracking-widest leading-snug">
              Right now: {label} for {current.dog.name}
            </p>
            <p className="text-[12px] text-shTextMuted mt-1 leading-snug">
              Enter the expiry date, attach a clear photo/PDF, then tap the green button. The next vaccine will appear automatically.
            </p>
          </div>

          {stepSummary.length > 1 && (
            <div className="space-y-1.5" data-testid="vaccine-wizard-step-list">
              {stepSummary.map((s, i) => {
                const cls = s.state === "done" ? "border-shPrimary/40 bg-shPrimary/10 text-shPrimary"
                          : s.state === "current" ? "border-shAccent/50 bg-shAccent/10 text-shText"
                          : "border-shBorder text-shTextMuted";
                const icon = s.state === "done" ? "fa-check" : s.state === "current" ? "fa-arrow-right" : "fa-clock";
                return (
                  <div key={s.key} className={`flex items-center gap-2 rounded border px-3 py-2 ${cls}`} style={s.state === "upcoming" ? { background: "var(--sh-card-base)" } : undefined}>
                    <span className="w-5 h-5 rounded-full bg-black/20 flex items-center justify-center text-[10px]"><i className={`fas ${icon}`}/></span>
                    <p className="text-[11px] font-black uppercase tracking-widest truncate">
                      {i + 1}. {s.label} · {s.dogName} {s.state === "current" ? "— do this one now" : s.state === "done" ? "— submitted" : "— next"}
                    </p>
                  </div>
                );
              })}
            </div>
          )}

          <div>
            <label className="text-[11px] font-black text-shTextMuted uppercase tracking-widest block mb-1">
              {label} expiration date <span className="text-shAccent">*</span>
            </label>
            <input type="date" value={expiresOn} onChange={e => setExpiresOn(e.target.value)}
                   data-testid="vaccine-wizard-date"
                   className="w-full border border-shBorder rounded px-3 py-2 text-sm text-shText focus:outline-none focus:border-shPrimary/60"
                   style={{ colorScheme: "dark", background: "var(--sh-card-base)" }}/>
          </div>

          <div>
            <label className="text-[11px] font-black text-shTextMuted uppercase tracking-widest block mb-1">
              Photo/PDF of {label} certificate <span className="text-shAccent">*</span>
            </label>
            {/* Sprint 110ff — a generic file picker made most phones show a
                "browse files" screen instead of just opening the camera,
                which is extra friction for the common case (snap the vet
                paperwork right now). A dedicated camera-capture button is
                the primary action; picking an existing photo/PDF is still
                available as a secondary option. */}
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-2 bg-shSecondary text-bgHeader px-4 py-2.5 rounded-lg text-[12px] font-black uppercase tracking-widest cursor-pointer hover:bg-shSecondary/90 transition">
                <i className="fas fa-camera"/>Take Photo
                <input type="file" accept="image/*" capture="environment" onChange={handleFile}
                       data-testid="vaccine-wizard-camera" className="hidden"/>
              </label>
              <label className="inline-flex items-center gap-2 border border-shBorder text-shTextMuted px-4 py-2.5 rounded-lg text-[12px] font-black uppercase tracking-widest cursor-pointer hover:text-shText hover:border-shSecondary/40 transition" style={{ background: "var(--sh-card-base)" }}>
                <i className="fas fa-paperclip"/>Choose File / PDF
                <input type="file" accept="image/*,application/pdf" onChange={handleFile}
                       data-testid="vaccine-wizard-photo" className="hidden"/>
              </label>
            </div>
            <p className="text-[11px] text-shTextMuted mt-1.5"><i className="fas fa-circle-info mr-1"/>Use a clear photo of the vet paperwork, or attach a PDF.</p>
            {photo && <p className="text-[11px] text-shPrimary mt-1"><i className="fas fa-check mr-1"/>File attached for {label}</p>}
          </div>

          {err && (
            <p className="text-[12px] text-shDanger font-black" data-testid="vaccine-wizard-error">
              <i className="fas fa-circle-exclamation mr-1"/>{err}
            </p>
          )}

          <div className="flex gap-2 justify-end pt-2 border-t border-shBorder">
            {!isLast && (
              <PremiumButton variant="ghost" onClick={skipStep} disabled={saving} data-testid="vaccine-wizard-skip">
                Skip this one
              </PremiumButton>
            )}
            <PremiumButton variant="primary" onClick={save} disabled={saving || !expiresOn || !photo} data-testid="vaccine-wizard-save">
              {saving ? <><i className="fas fa-spinner fa-spin mr-2"/>Uploading…</>
                      : isLast ? <><i className="fas fa-check mr-1"/>Submit final vaccine</>
                               : <><i className="fas fa-arrow-right mr-1"/>Submit {label} & continue</>}
            </PremiumButton>
          </div>

          <div className="rounded-lg border border-shBorder p-3" style={{ background: "var(--sh-card-base)" }}>
            <p className="text-[11px] text-shPrimary text-center font-black uppercase tracking-widest">
              <i className="fas fa-circle-check mr-1"/>{savedCount} of {total} submitted for approval
            </p>
            <p className="text-[11px] text-shTextMuted text-center mt-1 leading-snug">
              Booking stays locked until Sit Happens reviews and approves the uploaded vaccine records.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
