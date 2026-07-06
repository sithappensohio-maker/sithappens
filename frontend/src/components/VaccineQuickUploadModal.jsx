import { useState, useMemo } from "react";
import { api } from "../lib/api";
import { compressImage } from "../lib/imageCompress";

/**
 * Vaccine Quick Upload — surfaced from the portal "Upload Vaccine Records" tile.
 *
 * Differences from `VaccineUploadModal` (single-vax) and `VaccineUploadWizard`
 * (one-at-a-time queue):
 *   - Lets the client pick *which dog* they're uploading for (when they have
 *     more than one).
 *   - Shows ALL three required vaccines on one screen with their own expiry
 *     date input + their own multi-photo picker.
 *   - Submits one PUT per vaccine row the client filled out, in series.
 *
 * Backend contract: still posts to `/portal/dogs/{dog_id}/vaccine-update`
 * (one request per vaccine). Server supports `photos[]` for multi-photo.
 */
const REQ_VAX = [
  { key: "rabies",     label: "Rabies" },
  { key: "bordetella", label: "Bordetella" },
  { key: "dhpp",       label: "DHPP" },
];

const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (iso) => {
  if (!iso) return "—";
  try {
    const d = new Date(`${iso}T00:00:00`);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch { return iso; }
};

export default function VaccineQuickUploadModal({ dogs = [], initialDogId = "", onClose, onSaved }) {
  const [dogId, setDogId] = useState(initialDogId || dogs[0]?.id || "");
  // rows: { [vaccineKey]: { expires_on: "YYYY-MM-DD", photos: [dataUrl, ...] } }
  const [rows, setRows] = useState({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(0);

  const dog = useMemo(() => dogs.find(d => d.id === dogId) || null, [dogs, dogId]);

  const setField = (vk, patch) => setRows((r) => ({ ...r, [vk]: { ...(r[vk] || { expires_on: "", photos: [] }), ...patch } }));

  const onAddPhotos = async (vk, e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setErr("");
    try {
      const next = [...((rows[vk]?.photos) || [])];
      for (const f of files) {
        const url = await compressImage(f, { maxWidth: 1400, maxHeight: 1400, quality: 0.78 });
        next.push(url);
      }
      setField(vk, { photos: next });
    } catch {
      setErr("Couldn't read one of those photos. Try a different file.");
    }
    // Allow re-picking the same files later.
    e.target.value = "";
  };

  const removePhoto = (vk, idx) => {
    const next = [...((rows[vk]?.photos) || [])];
    next.splice(idx, 1);
    setField(vk, { photos: next });
  };

  const filledRows = Object.entries(rows).filter(([, v]) => v && v.expires_on);
  const rowsMissingPhotos = filledRows.filter(([, v]) => !v.photos || v.photos.length === 0);
  const canSubmit = !!dog && filledRows.length > 0 && rowsMissingPhotos.length === 0 && !saving;

  const submit = async () => {
    if (!dog || filledRows.length === 0) {
      setErr("Pick at least one vaccine to update and enter the expiry date.");
      return;
    }
    if (rowsMissingPhotos.length > 0) {
      setErr("Every vaccine you submit needs a clear certificate photo or PDF attached.");
      return;
    }
    setErr(""); setSaving(true); setDone(0);
    try {
      for (let i = 0; i < filledRows.length; i++) {
        const [vk, val] = filledRows[i];
        await api.post(`/portal/dogs/${dog.id}/vaccine-update`, {
          vaccine: vk,
          expires_on: val.expires_on,
          photos: val.photos || [],
        });
        setDone(i + 1);
      }
      onSaved?.();
    } catch (e) {
      const detail = e?.response?.data?.detail;
      setErr(typeof detail === "string" ? detail : "Upload failed. Try again.");
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex items-end sm:items-center justify-center p-0 sm:p-4"
         data-testid="vaccine-quick-upload-modal" onClick={onClose}>
      <div onClick={(e)=>e.stopPropagation()}
           className="bg-bgPanel border border-bgHover rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl shadow-2xl animate-slide-in max-h-[92vh] overflow-y-auto pb-safe">
        {/* Header */}
        <div className="sticky top-0 z-10 px-5 sm:px-6 py-4 bg-bgPanel/95 backdrop-blur border-b border-bgHover flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.35em] text-shGreen mb-1">
              <i className="fas fa-shield-virus mr-1.5"/>Vaccine Records
            </p>
            <h4 className="text-xl sm:text-2xl font-black text-white uppercase italic tracking-tight">Upload vaccine records</h4>
            <p className="text-[13px] text-gray-400 mt-1">Pick the dog, then complete each red missing/expired vaccine. Each vaccine needs an expiry date and a clear photo/PDF.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1" data-testid="vquick-close">
            <i className="fas fa-times text-xl"/>
          </button>
        </div>

        <div className="p-5 sm:p-6 space-y-5">
          <div className="bg-shOrange/10 border border-shOrange/35 rounded-lg p-3" data-testid="vquick-clear-instructions">
            <p className="text-[13px] text-white font-black uppercase tracking-widest leading-snug">
              Do every needed vaccine before submitting
            </p>
            <p className="text-[12px] text-gray-300 mt-1 leading-snug">
              Missing/expired vaccines are red. Enter the expiry date and attach the certificate for each one. Uploads go to Sit Happens for approval, so booking stays locked until we approve them.
            </p>
          </div>

          {/* Dog picker */}
          <div>
            <label className="text-[11px] font-black text-gray-400 uppercase tracking-widest block mb-2">
              Which dog? {dogs.length > 1 && <span className="text-shOrange">*</span>}
            </label>
            {dogs.length <= 1 ? (
              <div className="bg-bgBase border border-bgHover rounded p-3 flex items-center gap-3" data-testid="vquick-dog-locked">
                {dog?.photo
                  ? <img src={dog.photo} alt={dog.name} className="w-10 h-10 rounded-full object-cover border border-bgHover"/>
                  : <span className="w-10 h-10 rounded-full bg-shGreen/15 text-shGreen flex items-center justify-center"><i className="fas fa-paw"/></span>}
                <div className="min-w-0">
                  <p className="text-sm font-black text-white truncate">{dog?.name || "No dogs on file"}</p>
                  <p className="text-[11px] text-gray-500 uppercase tracking-widest">{dog?.breed || "—"}</p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" data-testid="vquick-dog-picker">
                {dogs.map((d) => {
                  const sel = d.id === dogId;
                  return (
                    <button key={d.id} onClick={()=>setDogId(d.id)} type="button"
                            data-testid={`vquick-dog-${d.id}`}
                            className={`text-left rounded-lg border p-3 transition flex items-center gap-2 ${sel ? "bg-shGreen/10 border-shGreen" : "bg-bgBase border-bgHover hover:border-shGreen/50"}`}>
                      {d.photo
                        ? <img src={d.photo} alt={d.name} className="w-9 h-9 rounded-full object-cover border border-bgHover shrink-0"/>
                        : <span className="w-9 h-9 rounded-full bg-shGreen/15 text-shGreen flex items-center justify-center shrink-0"><i className="fas fa-paw"/></span>}
                      <div className="min-w-0">
                        <p className={`text-sm font-black truncate ${sel ? "text-shGreen" : "text-white"}`}>{d.name}</p>
                        <p className="text-[10px] text-gray-500 uppercase tracking-widest truncate">{d.breed || "—"}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Vaccine rows */}
          {dog && (
            <div className="space-y-3" data-testid="vquick-vax-rows">
              <p className="text-[11px] font-black text-gray-400 uppercase tracking-widest">Required vaccines</p>
              {REQ_VAX.map((v) => {
                const current = dog.vaccines?.[v.key] || "";
                const expired = current && current < today();
                const missing = !current;
                const row = rows[v.key] || { expires_on: "", photos: [] };
                const status = missing ? "Missing" : expired ? "Expired" : "Current";
                const cls = missing || expired ? "text-red-400 border-red-500/40 bg-red-500/10"
                                               : "text-shGreen border-shGreen/40 bg-shGreen/10";
                return (
                  <div key={v.key} className="rounded-lg border border-bgHover bg-bgBase/60 p-4"
                       data-testid={`vquick-row-${v.key}`}>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div>
                        <p className="text-sm font-black text-white uppercase italic tracking-tight">{v.label}</p>
                        <p className="text-[12px] text-gray-400">On file: <span className="text-gray-200">{fmtDate(current)}</span></p>
                      </div>
                      <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border ${cls}`}>
                        <i className={`fas ${missing || expired ? "fa-triangle-exclamation" : "fa-circle-check"} mr-1`}/>{status}
                      </span>
                    </div>

                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-start">
                      <div>
                        <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-1">
                          New expiry date
                        </label>
                        <input type="date" value={row.expires_on}
                               onChange={(e)=>setField(v.key, { expires_on: e.target.value })}
                               data-testid={`vquick-date-${v.key}`}
                               className="w-full bg-bgBase border border-bgHover rounded px-3 py-2 text-sm text-white"
                               style={{ colorScheme: "dark" }}/>
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest block mb-1">
                          Certificate photo/PDF required
                        </label>
                        <label className="inline-flex items-center gap-2 cursor-pointer bg-shBlue/15 hover:bg-shBlue/25 text-shBlue text-[11px] font-black uppercase tracking-widest px-3 py-2 rounded border border-shBlue/30 transition">
                          <i className="fas fa-camera"/> Add photos
                          <input type="file" accept="image/*,application/pdf" multiple
                                 onChange={(e)=>onAddPhotos(v.key, e)}
                                 data-testid={`vquick-photos-${v.key}`}
                                 className="hidden"/>
                        </label>
                      </div>
                    </div>

                    {/* Photo thumbs */}
                    {row.photos && row.photos.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2" data-testid={`vquick-thumbs-${v.key}`}>
                        {row.photos.map((p, i) => (
                          <div key={i} className="relative">
                            <img src={p} alt={`${v.label} cert ${i+1}`}
                                 className="w-16 h-16 object-cover rounded border border-bgHover"/>
                            <button type="button" onClick={()=>removePhoto(v.key, i)}
                                    data-testid={`vquick-remove-${v.key}-${i}`}
                                    className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-black flex items-center justify-center hover:bg-red-600">
                              <i className="fas fa-xmark"/>
                            </button>
                          </div>
                        ))}
                        <p className="w-full text-[10px] text-shGreen"><i className="fas fa-circle-check mr-1"/>{row.photos.length} file{row.photos.length === 1 ? "" : "s"} attached.</p>
                      </div>
                    )}
                    {row.expires_on && (!row.photos || row.photos.length === 0) && (
                      <p className="mt-2 text-[11px] text-shOrange font-black uppercase tracking-widest" data-testid={`vquick-photo-needed-${v.key}`}>
                        <i className="fas fa-triangle-exclamation mr-1"/>Add the certificate photo/PDF for {v.label} before submitting.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {filledRows.length > 0 && rowsMissingPhotos.length > 0 && (
            <p className="text-[12px] text-shOrange font-black uppercase tracking-widest" data-testid="vquick-missing-photo-warning">
              <i className="fas fa-triangle-exclamation mr-1"/>Attach proof for every vaccine before submitting.
            </p>
          )}

          {err && (
            <p className="text-[12px] text-red-400" data-testid="vquick-error">
              <i className="fas fa-circle-exclamation mr-1"/>{err}
            </p>
          )}

          {saving && filledRows.length > 1 && (
            <p className="text-[12px] text-shGreen" data-testid="vquick-progress">
              <i className="fas fa-spinner fa-spin mr-1"/>Uploading {done} / {filledRows.length}…
            </p>
          )}

          {/* Footer */}
          <div className="flex gap-2 justify-end pt-2 border-t border-bgHover">
            <button onClick={onClose} disabled={saving}
                    className="text-[13px] font-black uppercase tracking-widest px-3 py-2 text-gray-400 hover:text-white disabled:opacity-40"
                    data-testid="vquick-cancel">
              Cancel
            </button>
            <button onClick={submit} disabled={!canSubmit}
                    data-testid="vquick-submit"
                    className="text-[13px] font-black uppercase tracking-widest px-5 py-2 rounded bg-shGreen text-bgHeader hover:bg-shGreen/90 disabled:opacity-40 transition">
              {saving ? <><i className="fas fa-spinner fa-spin mr-2"/>Saving…</>
                      : <><i className="fas fa-cloud-arrow-up mr-2"/>Submit for Review {filledRows.length > 0 ? `(${filledRows.length})` : ""}</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
