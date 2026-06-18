import { useEffect, useState } from "react";
import { api } from "../lib/api";

/**
 * Multi-step wizard that walks a client through uploading every missing /
 * expired required vaccine in one continuous flow. Reuses the per-vaccine
 * upload contract (POST /portal/dogs/{dog_id}/vaccine-update) instead of
 * inventing a new endpoint.
 *
 * Props:
 *   queue: [{ dog, vaccine }, ...]  — pairs to walk through, in order.
 *   onClose():   called when client cancels OR when the queue finishes.
 *   onAllDone(): called once the last entry uploads successfully.
 *   onProgress(savedCount): optional — fires after each successful step.
 */
export default function VaccineUploadWizard({ queue = [], onClose = () => {}, onAllDone = () => {}, onProgress = () => {} }) {
  const [idx, setIdx] = useState(0);
  const [expiresOn, setExpiresOn] = useState("");
  const [photo, setPhoto] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [err, setErr] = useState("");

  const current = queue[idx];
  const total = queue.length;
  const isLast = idx >= total - 1;

  // Reset the per-step inputs whenever idx changes.
  useEffect(() => {
    setExpiresOn(""); setPhoto(""); setErr("");
  }, [idx]);

  if (!current) return null;

  const handleFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const mod = await import("../lib/imageCompress").catch(() => null);
      let value;
      if (mod && mod.compressImage) {
        value = await mod.compressImage(f, { maxWidth: 1400, maxHeight: 1400, quality: 0.78 });
      } else {
        value = await new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(r.result);
          r.onerror = rej;
          r.readAsDataURL(f);
        });
      }
      setPhoto(value);
    } catch {
      setErr("Couldn't read that photo. Try a different one.");
    }
  };

  const save = async () => {
    if (!expiresOn) { setErr("Pick the new expiry date."); return; }
    setErr(""); setSaving(true);
    try {
      await api.post(`/portal/dogs/${current.dog.id}/vaccine-update`, {
        vaccine: current.vaccine, expires_on: expiresOn, photo,
      });
      const next = savedCount + 1;
      setSavedCount(next);
      onProgress(next);
      if (isLast) {
        onAllDone();
        onClose();
      } else {
        setIdx(idx + 1);
      }
    } catch (e) {
      const detail = e?.response?.data?.detail;
      setErr(typeof detail === "string" ? detail : "Upload failed.");
    } finally { setSaving(false); }
  };

  const skipStep = () => {
    if (isLast) {
      if (savedCount > 0) onAllDone();
      onClose();
    } else {
      setIdx(idx + 1);
    }
  };

  const label = { rabies: "Rabies", bordetella: "Bordetella", dhpp: "DHPP" }[current.vaccine] || current.vaccine;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 p-3 sm:p-6 overflow-y-auto"
         data-testid="vaccine-wizard-modal" onClick={onClose}>
      <div className="bg-bgPanel rounded-xl border border-bgHover max-w-md mx-auto overflow-hidden"
           onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-bgHover flex items-start justify-between gap-2">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.35em] text-shGreen mb-1">
              <i className="fas fa-shield-virus mr-1.5"/>Vaccine wizard
            </p>
            <p className="text-sm font-black text-white">
              {label} <span className="text-gray-500">·</span> {current.dog.name}
            </p>
            <p className="text-[12px] text-gray-400 mt-0.5">Step {idx + 1} of {total}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl shrink-0"
                  data-testid="vaccine-wizard-close">
            <i className="fas fa-xmark"/>
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 bg-bgBase">
          <div className="h-full bg-shGreen transition-all"
               style={{ width: `${Math.round(((idx) / total) * 100)}%` }}/>
        </div>

        <div className="p-5 space-y-3">
          <p className="text-[12px] text-gray-300">
            Upload proof of <span className="text-shGreen font-black">{label.toUpperCase()}</span> for {current.dog.name}.
            Enter the expiration date from the vaccine certificate and (optionally) attach a photo of the cert.
          </p>

          <div>
            <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest block mb-1">
              Expiration date <span className="text-shOrange">*</span>
            </label>
            <input type="date" value={expiresOn} onChange={e => setExpiresOn(e.target.value)}
                   data-testid="vaccine-wizard-date"
                   className="w-full bg-bgBase border border-bgHover rounded px-3 py-2 text-sm text-white"/>
          </div>

          <div>
            <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest block mb-1">
              Photo of certificate (optional)
            </label>
            <input type="file" accept="image/*" onChange={handleFile}
                   data-testid="vaccine-wizard-photo"
                   className="block w-full text-[12px] text-gray-300 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-[11px] file:font-black file:uppercase file:tracking-widest file:bg-shBlue/15 file:text-shBlue hover:file:bg-shBlue/25"/>
            {photo && <p className="text-[11px] text-shGreen mt-1"><i className="fas fa-check mr-1"/>Photo attached</p>}
          </div>

          {err && (
            <p className="text-[12px] text-red-400" data-testid="vaccine-wizard-error">
              <i className="fas fa-circle-exclamation mr-1"/>{err}
            </p>
          )}

          <div className="flex gap-2 justify-end pt-2 border-t border-bgHover">
            {!isLast && (
              <button onClick={skipStep} disabled={saving} data-testid="vaccine-wizard-skip"
                      className="text-[12px] font-black uppercase tracking-widest px-3 py-2 text-gray-400 hover:text-white disabled:opacity-40">
                Skip <i className="fas fa-arrow-right ml-1"/>
              </button>
            )}
            <button onClick={save} disabled={saving || !expiresOn}
                    data-testid="vaccine-wizard-save"
                    className="text-[13px] font-black uppercase tracking-widest px-4 py-2 rounded bg-shGreen text-bgHeader hover:bg-shGreen/90 disabled:opacity-40 transition">
              {saving ? <><i className="fas fa-spinner fa-spin mr-2"/>Saving…</>
                      : isLast ? <><i className="fas fa-check mr-1"/>Save & finish</>
                               : <><i className="fas fa-arrow-right mr-1"/>Save & next</>}
            </button>
          </div>
          {savedCount > 0 && (
            <p className="text-[11px] text-shGreen text-center">
              <i className="fas fa-circle-check mr-1"/>{savedCount} of {total} uploaded
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
