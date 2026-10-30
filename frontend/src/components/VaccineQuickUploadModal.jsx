import { useState, useMemo, useRef } from "react";
import { todayISO } from "../lib/date";
import { compressImage } from "../lib/imageCompress";
import { vaccineState, VACCINE_STATES } from "../lib/vaccineStatus";
import { newUploadId, postVaccineUpload, uploadErrorMessage } from "../lib/vaccineUpload";
import PremiumButton from "./premium/PremiumButton";

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

const fmtDate = (iso) => {
  if (!iso) return "—";
  try {
    const d = new Date(`${iso}T00:00:00`);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch { return iso; }
};

const LABEL = Object.fromEntries(REQ_VAX.map((v) => [v.key, v.label]));
const listOf = (keys) => keys.map((k) => LABEL[k] || k).join(", ").replace(/, ([^,]*)$/, " and $1");

export default function VaccineQuickUploadModal({ dogs = [], initialDogId = "", onClose, onSaved, onSomeSaved }) {
  const [dogId, setDogId] = useState(initialDogId || dogs[0]?.id || "");
  // rows: { [vaccineKey]: { expires_on: "YYYY-MM-DD", photos: [dataUrl, ...] } }
  const [rows, setRows] = useState({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(0);
  // "dogId:vaccine" rows this window already sent: a retry after a later row
  // failed skips them, and each keeps its upload id so it is never stored twice.
  const [sent, setSent] = useState(() => new Set());
  // "dogId:vaccine" → { id, row }: the id belongs to the exact date + photos it
  // was sent with, so an edit made while Submit runs is never sent under it.
  const uploadIds = useRef({});
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const dog = useMemo(() => dogs.find(d => d.id === dogId) || null, [dogs, dogId]);

  const setField = (vk, patch) => {
    // A changed date or photo is a new upload: new id, and send it again.
    const key = `${dogId}:${vk}`;
    delete uploadIds.current[key];
    setSent((s) => { if (!s.has(key)) return s; const n = new Set(s); n.delete(key); return n; });
    setRows((r) => ({ ...r, [vk]: { ...(r[vk] || { expires_on: "", photos: [] }), ...patch } }));
  };

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
  const isSent = (vk) => sent.has(`${dogId}:${vk}`);
  const unsentCount = filledRows.filter(([vk]) => !isSent(vk)).length;

  const submit = async () => {
    if (!dog || filledRows.length === 0) {
      setErr("Pick at least one vaccine to update and enter the expiry date.");
      return;
    }
    if (rowsMissingPhotos.length > 0) {
      setErr("Every vaccine you submit needs a clear certificate photo or PDF attached.");
      return;
    }
    const todo = filledRows.filter(([vk]) => !isSent(vk));
    const received = filledRows.filter(([vk]) => isSent(vk)).map(([vk]) => vk);
    setErr(""); setSaving(true); setDone(0);
    let current = null;
    try {
      for (let i = 0; i < todo.length; i++) {
        const [vk, val] = todo[i];
        current = vk;
        const key = `${dog.id}:${vk}`;
        const prev = uploadIds.current[key];
        const id = prev && prev.row === val ? prev.id : newUploadId();
        uploadIds.current[key] = { id, row: val };
        await postVaccineUpload(dog.id, { vaccine: vk, expires_on: val.expires_on, photos: val.photos || [] }, id);
        received.push(vk);
        // Changed while it was sending? Then what's on screen wasn't sent: leave it to send.
        if (rowsRef.current[vk] === val) setSent((s) => new Set(s).add(key));
        setDone(i + 1);
      }
      onSaved?.({ dogId: dog.id, vaccines: filledRows.map(([vk]) => vk) });
    } catch (e) {
      const reason = uploadErrorMessage(e);
      if (received.length) {
        // Never just "failed" when some of them arrived: say which did.
        setErr(`${listOf(received)} received. ${LABEL[current] || "The next one"} didn't go through: ${reason}`);
        onSomeSaved?.();
      } else {
        setErr(reason);
      }
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex items-end sm:items-center justify-center p-0 sm:p-4"
         data-testid="vaccine-quick-upload-modal" onClick={onClose}>
      <div onClick={(e)=>e.stopPropagation()}
           className="border border-shBorder rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl shadow-sh animate-slide-in max-h-[calc(var(--app-height)_-_1.5rem)] overflow-y-auto pb-safe" style={{ background: "var(--sh-card-base)" }}>
        {/* Header */}
        <div className="sticky top-0 z-10 px-5 sm:px-6 py-4 backdrop-blur border-b border-shBorder flex items-start justify-between gap-3" style={{ background: "var(--sh-card-base)" }}>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.35em] text-shPrimary mb-1">
              <i className="fas fa-shield-virus mr-1.5"/>Vaccine Records
            </p>
            <h4 className="text-xl sm:text-2xl font-bold text-shText tracking-tight">Upload vaccine records</h4>
            <p className="text-[13px] text-shTextMuted mt-1">Pick the dog, then complete each red missing/expired vaccine. Each vaccine needs an expiry date and a clear photo/PDF.</p>
          </div>
          <button onClick={onClose} className="text-shTextMuted hover:text-shText p-1" data-testid="vquick-close">
            <i className="fas fa-times text-xl"/>
          </button>
        </div>

        <div className="p-5 sm:p-6 space-y-5">
          <div className="bg-shAccent/10 border border-shAccent/35 rounded-lg p-3" data-testid="vquick-clear-instructions">
            <p className="text-[13px] text-shText font-black uppercase tracking-widest leading-snug">
              Do every needed vaccine before submitting
            </p>
            <p className="text-[12px] text-shTextMuted mt-1 leading-snug">
              Missing/expired vaccines are red. Enter the expiry date and attach the certificate for each one. Uploads go to Sit Happens for approval: a missing or expired vaccine stays locked until we approve it. If we've already approved a current certificate, booking stays open while we review the new one.
            </p>
          </div>

          {/* Dog picker */}
          <div>
            <label className="text-[11px] font-black text-shTextMuted uppercase tracking-widest block mb-2">
              Which dog? {dogs.length > 1 && <span className="text-shAccent">*</span>}
            </label>
            {dogs.length <= 1 ? (
              <div className="border border-shBorder rounded p-3 flex items-center gap-3" style={{ background: "var(--sh-card-base)" }} data-testid="vquick-dog-locked">
                {dog?.photo
                  ? <img src={dog.photo} alt={dog.name} className="w-10 h-10 rounded-full object-cover border border-shBorder"/>
                  : <span className="w-10 h-10 rounded-full bg-shPrimary/15 text-shPrimary flex items-center justify-center"><i className="fas fa-paw"/></span>}
                <div className="min-w-0">
                  <p className="text-sm font-black text-shText truncate">{dog?.name || "No dogs on file"}</p>
                  <p className="text-[11px] text-shTextMuted uppercase tracking-widest">{dog?.breed || "—"}</p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" data-testid="vquick-dog-picker">
                {dogs.map((d) => {
                  const sel = d.id === dogId;
                  return (
                    <button key={d.id} onClick={()=>setDogId(d.id)} type="button" disabled={saving}
                            data-testid={`vquick-dog-${d.id}`}
                            style={sel ? undefined : { background: "var(--sh-card-base)" }}
                            className={`text-left rounded-lg border p-3 transition flex items-center gap-2 ${sel ? "bg-shPrimary/10 border-shPrimary" : "border-shBorder hover:border-shPrimary/50"}`}>
                      {d.photo
                        ? <img src={d.photo} alt={d.name} className="w-9 h-9 rounded-full object-cover border border-shBorder shrink-0"/>
                        : <span className="w-9 h-9 rounded-full bg-shPrimary/15 text-shPrimary flex items-center justify-center shrink-0"><i className="fas fa-paw"/></span>}
                      <div className="min-w-0">
                        <p className={`text-sm font-black truncate ${sel ? "text-shPrimary" : "text-shText"}`}>{d.name}</p>
                        <p className="text-[10px] text-shTextMuted uppercase tracking-widest truncate">{d.breed || "—"}</p>
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
              <p className="text-[11px] font-black text-shTextMuted uppercase tracking-widest">Required vaccines</p>
              {REQ_VAX.map((v) => {
                // The shared rule: a certificate already sent is "Received", never "Missing".
                const { state, expiry, renewal } = vaccineState(dog, v.key, todayISO());
                const waiting = isSent(v.key) || state === VACCINE_STATES.PENDING || renewal;
                const bad = !waiting && (state === VACCINE_STATES.MISSING || state === VACCINE_STATES.EXPIRED);
                const row = rows[v.key] || { expires_on: "", photos: [] };
                const status = state === VACCINE_STATES.APPROVED ? (waiting ? "Current · new one received" : "Current")
                  : waiting ? "Received" : state === VACCINE_STATES.EXPIRED ? "Expired" : "Missing";
                const cls = bad ? "text-shDanger border-shDanger/40 bg-shDanger/10"
                  : waiting && state !== VACCINE_STATES.APPROVED ? "text-shBlue border-shBlue/40 bg-shBlue/10"
                  : "text-shPrimary border-shPrimary/40 bg-shPrimary/10";
                return (
                  <div key={v.key} className="rounded-lg border border-shBorder p-4" style={{ background: "var(--sh-card-base)" }}
                       data-testid={`vquick-row-${v.key}`}>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div>
                        <p className="text-sm font-bold text-shText tracking-tight">{v.label}</p>
                        <p className="text-[12px] text-shTextMuted">On file: <span className="text-shTextMuted">{fmtDate(expiry)}</span></p>
                      </div>
                      <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border ${cls}`} data-testid={`vquick-status-${v.key}`}>
                        <i className={`fas ${bad ? "fa-triangle-exclamation" : waiting && state !== VACCINE_STATES.APPROVED ? "fa-hourglass-half" : "fa-circle-check"} mr-1`}/>{status}
                      </span>
                    </div>
                    {waiting && (
                      <p className="mt-1 text-[12px] text-shBlue" data-testid={`vquick-received-${v.key}`}>
                        <i className="fas fa-circle-check mr-1"/>We have this one and will review it. Uploading again replaces it.
                      </p>
                    )}

                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-start">
                      <div>
                        <label className="text-[10px] font-black text-shTextMuted uppercase tracking-widest block mb-1">
                          New expiry date
                        </label>
                        <input type="date" value={row.expires_on} disabled={saving}
                               onChange={(e)=>setField(v.key, { expires_on: e.target.value })}
                               data-testid={`vquick-date-${v.key}`}
                               className="w-full border border-shBorder rounded px-3 py-2 text-sm text-shText focus:outline-none focus:border-shPrimary/60"
                               style={{ colorScheme: "dark", background: "var(--sh-card-base)" }}/>
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-shTextMuted uppercase tracking-widest block mb-1">
                          Certificate photo/PDF required
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {/* Sprint 110ff — camera-first: tap to snap the vet
                              paperwork directly instead of browsing files first. */}
                          <label className={`${saving ? "pointer-events-none opacity-50 " : ""}inline-flex items-center gap-2 cursor-pointer bg-shSecondary/15 hover:bg-shSecondary/25 text-shSecondary text-[11px] font-black uppercase tracking-widest px-3 py-2 rounded border border-shSecondary/30 transition`}>
                            <i className="fas fa-camera"/> Take Photo
                            <input type="file" accept="image/*" capture="environment" disabled={saving}
                                   onChange={(e)=>onAddPhotos(v.key, e)}
                                   data-testid={`vquick-camera-${v.key}`}
                                   className="hidden"/>
                          </label>
                          <label className={`${saving ? "pointer-events-none opacity-50 " : ""}inline-flex items-center gap-2 cursor-pointer border border-shBorder text-shTextMuted hover:text-shText hover:border-shSecondary/40 text-[11px] font-black uppercase tracking-widest px-3 py-2 rounded transition`} style={{ background: "var(--sh-card-base)" }}>
                            <i className="fas fa-paperclip"/> Choose Files
                            <input type="file" accept="image/*,application/pdf" multiple disabled={saving}
                                   onChange={(e)=>onAddPhotos(v.key, e)}
                                   data-testid={`vquick-photos-${v.key}`}
                                   className="hidden"/>
                          </label>
                        </div>
                      </div>
                    </div>

                    {/* Photo thumbs */}
                    {row.photos && row.photos.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2" data-testid={`vquick-thumbs-${v.key}`}>
                        {row.photos.map((p, i) => (
                          <div key={i} className="relative">
                            <img src={p} alt={`${v.label} cert ${i+1}`}
                                 className="w-16 h-16 object-cover rounded border border-shBorder"/>
                            <button type="button" onClick={()=>removePhoto(v.key, i)} disabled={saving}
                                    data-testid={`vquick-remove-${v.key}-${i}`}
                                    className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-shDanger text-shText text-[10px] font-black flex items-center justify-center hover:bg-red-600">
                              <i className="fas fa-xmark"/>
                            </button>
                          </div>
                        ))}
                        <p className="w-full text-[10px] text-shPrimary"><i className="fas fa-circle-check mr-1"/>{row.photos.length} file{row.photos.length === 1 ? "" : "s"} attached.</p>
                      </div>
                    )}
                    {row.expires_on && (!row.photos || row.photos.length === 0) && (
                      <p className="mt-2 text-[11px] text-shAccent font-black uppercase tracking-widest" data-testid={`vquick-photo-needed-${v.key}`}>
                        <i className="fas fa-triangle-exclamation mr-1"/>Add the certificate photo/PDF for {v.label} before submitting.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {filledRows.length > 0 && rowsMissingPhotos.length > 0 && (
            <p className="text-[12px] text-shAccent font-black uppercase tracking-widest" data-testid="vquick-missing-photo-warning">
              <i className="fas fa-triangle-exclamation mr-1"/>Attach proof for every vaccine before submitting.
            </p>
          )}

          {err && (
            <p className="text-[12px] text-shDanger" data-testid="vquick-error">
              <i className="fas fa-circle-exclamation mr-1"/>{err}
            </p>
          )}

          {saving && unsentCount > 1 && (
            <p className="text-[12px] text-shPrimary" data-testid="vquick-progress">
              <i className="fas fa-spinner fa-spin mr-1"/>Uploading {done} / {unsentCount}…
            </p>
          )}

          {/* Footer */}
          <div className="flex gap-2 justify-end pt-2 border-t border-shBorder">
            <PremiumButton variant="ghost" onClick={onClose} disabled={saving} data-testid="vquick-cancel">
              Cancel
            </PremiumButton>
            <PremiumButton variant="primary" onClick={submit} disabled={!canSubmit} data-testid="vquick-submit">
              {saving ? <><i className="fas fa-spinner fa-spin mr-2"/>Saving…</>
                      : <><i className="fas fa-cloud-arrow-up mr-2"/>Submit for Review {unsentCount > 0 ? `(${unsentCount})` : ""}</>}
            </PremiumButton>
          </div>
        </div>
      </div>
    </div>
  );
}
