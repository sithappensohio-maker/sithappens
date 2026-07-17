import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { compressImage } from "../lib/imageCompress";

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
        <div className="bg-bgPanel rounded-xl border border-shGreen/40 max-w-md mx-auto overflow-hidden">
          <div className="p-6 space-y-4 text-center">
            <span className="inline-flex w-14 h-14 rounded-full bg-shGreen/15 text-shGreen items-center justify-center text-2xl">
              <i className="fas fa-circle-check"/>
            </span>
            <p className="text-lg font-black text-white uppercase italic leading-tight">
              {savedCount} of {total} submitted for review
            </p>
            <p className="text-[13px] text-gray-300 leading-snug">
              Thanks! We'll check the new records and approve them shortly. Booking stays locked until Sit Happens reviews and approves the uploaded vaccine records — you'll see the status update here once that's done.
            </p>
            <button onClick={onClose} data-testid="vaccine-wizard-done-close"
                    className="w-full text-[13px] font-black uppercase tracking-widest px-4 py-3 rounded bg-shGreen text-bgHeader hover:bg-shGreen/90 transition">
              Got it
            </button>
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
      <div className="bg-bgPanel rounded-xl border border-bgHover max-w-md mx-auto overflow-hidden"
           onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-bgHover flex items-start justify-between gap-2">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.35em] text-shGreen mb-1">
              <i className="fas fa-shield-virus mr-1.5"/>Vaccine upload step {idx + 1} of {total}
            </p>
            <p className="text-lg font-black text-white uppercase italic leading-tight">
              Upload {label} now
            </p>
            <p className="text-[13px] text-gray-400 mt-1">
              {current.dog.name} needs {total} vaccine record{total === 1 ? "" : "s"}. This wizard moves one vaccine at a time.
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl shrink-0"
                  data-testid="vaccine-wizard-close" aria-label="Close vaccine upload wizard">
            <i className="fas fa-xmark"/>
          </button>
        </div>

        <div className="h-2 bg-bgBase" aria-label={`Step ${idx + 1} of ${total}`}>
          <div className="h-full bg-shGreen transition-all" style={{ width: `${progressPct}%` }}/>
        </div>

        <div className="p-5 space-y-4">
          {notice && (
            <div className="rounded-lg border border-shGreen/40 bg-shGreen/10 p-3" data-testid="vaccine-wizard-next-notice">
              <p className="text-[13px] text-shGreen font-black uppercase tracking-widest leading-snug">
                <i className="fas fa-circle-check mr-1.5"/>{notice}
              </p>
            </div>
          )}

          <div className="rounded-lg border border-shOrange/35 bg-shOrange/10 p-3" data-testid="vaccine-wizard-instructions">
            <p className="text-[13px] text-white font-black uppercase tracking-widest leading-snug">
              Right now: {label} for {current.dog.name}
            </p>
            <p className="text-[12px] text-gray-300 mt-1 leading-snug">
              Enter the expiry date, attach a clear photo/PDF, then tap the green button. The next vaccine will appear automatically.
            </p>
          </div>

          {stepSummary.length > 1 && (
            <div className="space-y-1.5" data-testid="vaccine-wizard-step-list">
              {stepSummary.map((s, i) => {
                const cls = s.state === "done" ? "border-shGreen/40 bg-shGreen/10 text-shGreen"
                          : s.state === "current" ? "border-shOrange/50 bg-shOrange/10 text-white"
                          : "border-bgHover bg-bgBase text-gray-400";
                const icon = s.state === "done" ? "fa-check" : s.state === "current" ? "fa-arrow-right" : "fa-clock";
                return (
                  <div key={s.key} className={`flex items-center gap-2 rounded border px-3 py-2 ${cls}`}>
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
            <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest block mb-1">
              {label} expiration date <span className="text-shOrange">*</span>
            </label>
            <input type="date" value={expiresOn} onChange={e => setExpiresOn(e.target.value)}
                   data-testid="vaccine-wizard-date"
                   className="w-full bg-bgBase border border-bgHover rounded px-3 py-2 text-sm text-white"
                   style={{ colorScheme: "dark" }}/>
          </div>

          <div>
            <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest block mb-1">
              Photo/PDF of {label} certificate <span className="text-shOrange">*</span>
            </label>
            <input type="file" accept="image/*,application/pdf" onChange={handleFile}
                   data-testid="vaccine-wizard-photo"
                   className="block w-full text-[12px] text-gray-300 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-[11px] file:font-black file:uppercase file:tracking-widest file:bg-shBlue/15 file:text-shBlue hover:file:bg-shBlue/25"/>
            <p className="text-[11px] text-gray-500 mt-1"><i className="fas fa-circle-info mr-1"/>Use a clear photo of the vet paperwork. PDFs are okay.</p>
            {photo && <p className="text-[11px] text-shGreen mt-1"><i className="fas fa-check mr-1"/>File attached for {label}</p>}
          </div>

          {err && (
            <p className="text-[12px] text-red-400 font-black" data-testid="vaccine-wizard-error">
              <i className="fas fa-circle-exclamation mr-1"/>{err}
            </p>
          )}

          <div className="flex gap-2 justify-end pt-2 border-t border-bgHover">
            {!isLast && (
              <button onClick={skipStep} disabled={saving} data-testid="vaccine-wizard-skip"
                      className="text-[12px] font-black uppercase tracking-widest px-3 py-2 text-gray-400 hover:text-white disabled:opacity-40">
                Skip this one
              </button>
            )}
            <button onClick={save} disabled={saving || !expiresOn || !photo}
                    data-testid="vaccine-wizard-save"
                    className="text-[12px] sm:text-[13px] font-black uppercase tracking-widest px-4 py-2 rounded bg-shGreen text-bgHeader hover:bg-shGreen/90 disabled:opacity-40 transition">
              {saving ? <><i className="fas fa-spinner fa-spin mr-2"/>Uploading…</>
                      : isLast ? <><i className="fas fa-check mr-1"/>Submit final vaccine</>
                               : <><i className="fas fa-arrow-right mr-1"/>Submit {label} & continue</>}
            </button>
          </div>

          <div className="rounded-lg bg-bgBase border border-bgHover p-3">
            <p className="text-[11px] text-shGreen text-center font-black uppercase tracking-widest">
              <i className="fas fa-circle-check mr-1"/>{savedCount} of {total} submitted for approval
            </p>
            <p className="text-[11px] text-gray-400 text-center mt-1 leading-snug">
              Booking stays locked until Sit Happens reviews and approves the uploaded vaccine records.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
