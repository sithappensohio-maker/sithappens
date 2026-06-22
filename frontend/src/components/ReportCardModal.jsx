// Shared Report Card modal — used by both admin Dashboard and the Employee Portal
// so staff can leave notes/photos/mood tags on any booking at check-out time.
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { compressImage } from "../lib/imageCompress";
import { useEditLock } from "../lib/useLiveRefresh";
import ReviewRequestButton from "./ReviewRequestButton";

export default function ReportCardModal({ booking, onClose, moodTags: moodTagsProp }) {
  useEditLock(true);
  const existing = booking.report_card || { photos: [], mood_tags: [], note: "" };
  const [photos, setPhotos] = useState(existing.photos || []);
  const [moods, setMoods] = useState(existing.mood_tags || []);
  const [note, setNote] = useState(existing.note || "");
  const [saving, setSaving] = useState(false);
  const [tags, setTags] = useState(moodTagsProp || []);

  // If not provided (e.g. employee portal), fetch from settings
  useEffect(() => {
    if (moodTagsProp) return;
    (async () => {
      try {
        const r = await api.get("/settings");
        if (Array.isArray(r.data?.mood_tags) && r.data.mood_tags.length) {
          setTags(r.data.mood_tags);
        }
      } catch { /* silent */ }
    })();
  }, [moodTagsProp]);

  const tagDefs = (tags || []).map(t => (typeof t === "string"
    ? { label: t, icon: "", color: "" }
    : { label: t?.label || "", icon: t?.icon || "", color: t?.color || "" })).filter(t => t.label);

  const onFiles = async (e) => {
    const files = Array.from(e.target.files || []).slice(0, 3 - photos.length);
    const compressed = await Promise.all(files.map(f => compressImage(f)));
    setPhotos((p) => [...p, ...compressed.filter(Boolean)].slice(0, 3));
  };

  const toggleMood = (m) => setMoods((cur) => cur.includes(m) ? cur.filter(x => x !== m) : [...cur, m]);

  const save = async () => {
    setSaving(true);
    try {
      await api.post(`/bookings/${booking.id}/report-card`, { photos, mood_tags: moods, note });
      onClose();
    } catch (e) { alert("Failed to save"); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-3 sm:p-4 z-50">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-2xl p-5 sm:p-8 shadow-2xl animate-slide-in max-h-[90vh] overflow-y-auto card-report" data-testid="report-card-modal">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xl font-black text-white uppercase italic tracking-tight">Pup Report Card</h4>
          <button onClick={onClose} className="text-gray-500 hover:text-white" data-testid="report-card-close"><i className="fas fa-times" /></button>
        </div>
        <p className="text-[15px] text-shGreen font-black uppercase tracking-widest mb-6">{booking.dog_name} · {booking.client_name} · {booking.date}</p>

        {/* Sprint 110ez polish — review request affordance on a completed report card */}
        {booking.client_id && (booking.report_card?.sent_at || booking.report_card?.photos?.length) && (
          <div className="mb-5 p-3 bg-shOrange/10 border border-shOrange/30 rounded flex items-center justify-between flex-wrap gap-2">
            <span className="text-[12px] font-black uppercase tracking-widest text-shOrange">
              <i className="fas fa-star mr-1"/>Happy with the card? Now's a great moment to ask for a review.
            </span>
            <ReviewRequestButton clientId={booking.client_id} dogId={booking.dog_id}
                                 clientName={booking.client_name || ""} dogName={booking.dog_name || ""}
                                 source="report_card" />
          </div>
        )}

        <div className="space-y-5">
          <div>
            <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Photos (up to 3)</label>
            <div className="mt-2 flex gap-2 flex-wrap">
              {photos.map((p, i) => (
                <div key={i} className="relative">
                  <img src={p} alt="" loading="lazy" decoding="async" className="h-24 w-24 rounded object-cover border border-bgHover" />
                  <button onClick={()=>setPhotos(photos.filter((_,j)=>j!==i))} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 text-xs">×</button>
                </div>
              ))}
              {photos.length < 3 && (
                <label className="h-24 w-24 rounded border-2 border-dashed border-bgHover flex items-center justify-center cursor-pointer hover:border-shGreen text-gray-500 hover:text-shGreen">
                  <i className="fas fa-camera text-xl" />
                  <input type="file" accept="image/*" multiple onChange={onFiles} className="hidden" data-testid="report-photo-input" />
                </label>
              )}
            </div>
          </div>

          <div>
            <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Mood / Highlights</label>
            <div className="mt-2 flex flex-wrap gap-2">
              {tagDefs.map(({ label, icon, color }) => {
                const hex = color || "#8cc63f";
                const selected = moods.includes(label);
                return (
                  <button key={label} onClick={()=>toggleMood(label)} data-testid={`mood-${label.replace(/\s/g,'-')}`}
                          className="px-3 py-2 rounded-full text-[14px] font-black uppercase tracking-widest border transition flex items-center gap-2"
                          style={selected
                            ? { backgroundColor: hex, color: "#0f172a", borderColor: hex }
                            : { backgroundColor: "transparent", color: hex, borderColor: `${hex}55` }}>
                    {icon && <i className={`fas ${icon}`}/>}
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Note for owner</label>
            <textarea value={note} onChange={(e)=>setNote(e.target.value)} rows={3} placeholder="e.g., Biscuit absolutely crushed recall today!"
                      data-testid="report-note-input"
                      className="w-full mt-1 bg-bgBase border border-bgHover rounded p-3 text-white text-sm focus:border-shGreen outline-none" />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={onClose} className="text-gray-500 font-black uppercase text-[14px] tracking-widest">Close</button>
            <button onClick={save} disabled={saving} data-testid="save-report-button"
                    className="bg-shGreen text-bgHeader px-8 py-3 rounded font-black text-[14px] uppercase tracking-widest shadow-xl disabled:opacity-50">
              {saving?"Saving…":"Save Report Card"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
