import { useEffect, useState, useRef } from "react";
import { api } from "../lib/api";

const MOOD_EMOJI = ["", "😞", "😅", "😐", "💪", "😄"];
const MOOD_LABEL = ["", "Rough", "Tricky", "OK", "Strong", "Awesome"];

const KIND_META = {
  reps:         { unit: "reps",   type: "number" },
  sets:         { unit: "sets",   type: "number" },
  duration_sec: { unit: "sec",    type: "number" },
  duration_min: { unit: "min",    type: "number" },
  distance_ft:  { unit: "ft",     type: "number" },
  success_rate: { unit: "%",      type: "number", min: 0, max: 100 },
  rating_5:     { unit: "/ 5",    type: "number", min: 1, max: 5 },
  mood_5:       { type: "mood" },
  checkbox:     { type: "checkbox" },
  text:         { type: "text" },
  longtext:     { type: "longtext" },
};

/**
 * Client-portal Daily Check-In Card.
 * Renders ONE day at a time (the next "available" or "needs_redo" day),
 * collapses past days with a green-check summary, and shows future days
 * as locked. Supports optional mood + photo upload per day.
 *
 * Props:
 *   - homework: full homework doc INCLUDING enriched daily_progress + streak
 *               (fetched from GET /homework/{id})
 *   - onChanged: called after a successful submit so parent can refresh
 */
export default function DailyCheckInCard({ homeworkId, onChanged }) {
  const [hw, setHw] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  // per-day local form state
  const [openDay, setOpenDay] = useState(null);
  const [values, setValues] = useState({});
  const [mood, setMood] = useState(0);
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/homework/${homeworkId}`);
      setHw(data);
      // auto-open the first day that needs the client's attention
      const next = (data.daily_progress || []).find(p => p.status === "available" || p.status === "needs_redo");
      if (next && openDay === null) {
        setOpenDay(next.day_number);
        // pre-fill from existing log if needs_redo
        if (next.log) {
          const fv = { ...(next.log.field_values || {}) };
          setMood(Number(fv.__mood) || 0);
          setPhoto(fv.__photo || "");
          delete fv.__mood; delete fv.__photo;
          setValues(fv);
          setNote(next.log.note || "");
        }
      }
    } catch (e) { setErr(e.response?.data?.detail || "Failed to load"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [homeworkId]);

  const openDayCard = (day) => {
    setOpenDay(day.day_number);
    setErr("");
    if (day.log) {
      const fv = { ...(day.log.field_values || {}) };
      setMood(Number(fv.__mood) || 0);
      setPhoto(fv.__photo || "");
      delete fv.__mood; delete fv.__photo;
      setValues(fv);
      setNote(day.log.note || "");
    } else {
      setValues({}); setMood(0); setPhoto(""); setNote("");
    }
  };

  const onFilePicked = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setPhoto(reader.result || "");
    reader.readAsDataURL(f);
  };

  const submit = async () => {
    if (!openDay) return;
    setBusy(true); setErr("");
    try {
      const field_values = {};
      const dayObj = hw.daily_progress.find(p => p.day_number === openDay);
      for (const f of dayObj?.fields || []) {
        const v = values[f.id];
        if (v === undefined || v === "" || v === null) continue;
        const km = KIND_META[f.kind] || {};
        if (km.type === "number") field_values[f.id] = Number(v);
        else if (km.type === "checkbox") field_values[f.id] = !!v;
        else field_values[f.id] = v;
      }
      await api.post(`/homework/${homeworkId}/day/${openDay}/submit`, {
        field_values,
        note,
        mood: mood || null,
        photo: photo || "",
      });
      setValues({}); setMood(0); setNote(""); setPhoto("");
      setOpenDay(null);
      await load();
      onChanged?.();
    } catch (e) { setErr(e.response?.data?.detail || "Submit failed"); }
    finally { setBusy(false); }
  };

  if (loading) return <div className="text-[13px] text-gray-500 font-black uppercase tracking-widest py-3">Loading daily tracker…</div>;
  if (!hw || !hw.daily_progress) return null;

  const progress = hw.daily_progress;
  const streak = hw.streak || 0;
  const totalDays = hw.total_days || progress.length;
  const approvedCount = progress.filter(p => p.status === "approved").length;

  return (
    <div className="space-y-3" data-testid={`daily-checkin-${homeworkId}`}>
      {/* Streak header */}
      <div className="bg-gradient-to-r from-shGreen/15 to-shBlue/10 border border-shGreen/30 rounded-lg p-3 flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-[14px] font-black uppercase tracking-widest text-shGreen">
            <i className="fas fa-fire mr-1"/>{streak}-day streak
          </p>
          <p className="text-[13px] text-gray-300 mt-0.5">
            {approvedCount} of {totalDays} approved · {totalDays - approvedCount} to go
          </p>
        </div>
        <div className="flex-1 max-w-xs ml-auto">
          <div className="bg-bgBase rounded-full h-2 overflow-hidden border border-bgHover">
            <div className="bg-shGreen h-full transition-all" style={{ width: `${(approvedCount / Math.max(totalDays, 1)) * 100}%` }} />
          </div>
        </div>
      </div>

      {/* Day list */}
      <div className="space-y-2" data-testid="daily-days-list">
        {progress.map(day => (
          <DayRow
            key={day.day_number}
            day={day}
            isOpen={openDay === day.day_number}
            onOpen={() => openDayCard(day)}
            onClose={() => setOpenDay(null)}
            values={values} setValues={setValues}
            mood={mood} setMood={setMood}
            note={note} setNote={setNote}
            photo={photo} setPhoto={setPhoto}
            onPickFile={() => fileRef.current?.click()}
            onSubmit={submit}
            busy={busy}
            err={err}
          />
        ))}
      </div>
      <input ref={fileRef} type="file" accept="image/*" onChange={onFilePicked} className="hidden" data-testid="daily-photo-input" />
    </div>
  );
}

function DayRow({ day, isOpen, onOpen, onClose, values, setValues, mood, setMood, note, setNote, photo, setPhoto, onPickFile, onSubmit, busy, err }) {
  const statusMeta = {
    locked:     { color: "border-bgHover bg-bgBase/40 text-gray-500", icon: "fa-lock", label: "Locked", actionable: false },
    available:  { color: "border-shGreen/50 bg-bgBase",               icon: "fa-circle-play", label: "Ready to log", actionable: true },
    submitted:  { color: "border-shOrange/50 bg-shOrange/5",          icon: "fa-hourglass-half", label: "Waiting for trainer", actionable: false },
    approved:   { color: "border-shGreen/40 bg-shGreen/5",            icon: "fa-circle-check", label: "Approved", actionable: false },
    needs_redo: { color: "border-red-500/40 bg-red-500/5",            icon: "fa-rotate-left", label: "Needs redo", actionable: true },
  }[day.status] || { color: "border-bgHover bg-bgBase", icon: "fa-circle", label: day.status };
  const log = day.log;
  const reviewerNote = log?.review_note;
  const logMood = Number(log?.field_values?.__mood) || 0;
  const logPhoto = log?.field_values?.__photo;

  return (
    <div className={`rounded-lg border ${statusMeta.color}`} data-testid={`day-row-${day.day_number}`}>
      <button onClick={statusMeta.actionable ? onOpen : null} disabled={!statusMeta.actionable && !log}
              className={`w-full text-left p-3 flex items-start gap-3 ${statusMeta.actionable ? "hover:bg-bgHover/30 cursor-pointer" : "cursor-default"}`}
              data-testid={`day-row-toggle-${day.day_number}`}>
        <div className="shrink-0 w-9 h-9 rounded-full bg-bgPanel border border-bgHover flex items-center justify-center font-black text-[14px] uppercase">
          {day.status === "approved" ? <i className="fas fa-check text-shGreen"/> :
           day.status === "locked"   ? <i className="fas fa-lock text-gray-600 text-[12px]"/> :
           <span className="text-white">{day.day_number}</span>}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white font-black text-[14px] uppercase tracking-tight">Day {day.day_number}</span>
            <span className={`text-[11px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${day.status==="approved" ? "bg-shGreen/15 text-shGreen" : day.status==="needs_redo" ? "bg-red-500/15 text-red-300" : day.status==="submitted" ? "bg-shOrange/15 text-shOrange" : day.status==="locked" ? "bg-bgHover text-gray-500" : "bg-bgHover text-shGreen"}`}>
              <i className={`fas ${statusMeta.icon} mr-1`}/>{statusMeta.label}
            </span>
          </div>
          <p className="text-gray-300 text-[14px] mt-0.5 line-clamp-2">{day.day_focus}</p>
          {/* Approved/submitted summary */}
          {log && day.status !== "available" && day.status !== "needs_redo" && (
            <div className="mt-2 flex items-center gap-2 text-[12px] text-gray-500 font-black uppercase tracking-widest">
              <span>{(log.date || "").slice(0, 10)}</span>
              {logMood > 0 && <span>· {MOOD_EMOJI[logMood]}</span>}
              {logPhoto && <span>· <i className="fas fa-camera"/></span>}
              {log.review_note && day.status === "approved" && <span className="text-shGreen">· trainer noted</span>}
            </div>
          )}
          {reviewerNote && day.status === "needs_redo" && (
            <div className="mt-2 bg-red-500/10 border border-red-500/30 rounded p-2 text-[13px] text-red-200">
              <span className="font-black uppercase tracking-widest text-[11px] text-red-300">Trainer's note · </span>
              <span className="italic">"{reviewerNote}"</span>
            </div>
          )}
        </div>
        {statusMeta.actionable && !isOpen && (
          <i className="fas fa-chevron-down text-gray-400 mt-2"/>
        )}
      </button>

      {/* Inline editor when actionable + open */}
      {isOpen && statusMeta.actionable && (
        <div className="border-t border-bgHover p-3 space-y-3" data-testid={`day-form-${day.day_number}`}>
          {day.instructions && (
            <p className="text-[14px] text-gray-300 whitespace-pre-wrap leading-snug">{day.instructions}</p>
          )}

          {/* Mood picker — always shown unless explicit field set */}
          {!day.fields.some(f => f.kind === "mood_5") && (
            <MoodRow value={mood} onChange={setMood} testid="day-mood" />
          )}

          {/* Per-step fields */}
          {day.fields.map(f => (
            <FieldInput key={f.id} field={f}
                        value={f.kind === "mood_5" ? mood : values[f.id]}
                        onChange={(v) => { if (f.kind === "mood_5") setMood(v); else setValues({...values, [f.id]: v}); }} />
          ))}

          {/* Note */}
          <div>
            <label className="text-[13px] font-black text-gray-500 uppercase tracking-widest">Note for your trainer (optional)</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} data-testid={`day-note-${day.day_number}`}
                      placeholder="Anything tricky? Wins? Questions?"
                      className="w-full mt-1 bg-bgPanel border border-bgHover rounded p-2 text-white text-sm" />
          </div>

          {/* Photo */}
          <div>
            <label className="text-[13px] font-black text-gray-500 uppercase tracking-widest">Photo / video frame (optional)</label>
            {photo ? (
              <div className="mt-1 relative inline-block">
                <img src={photo} alt="Your upload" className="max-h-40 rounded border border-bgHover" />
                <button onClick={() => setPhoto("")} className="absolute top-1 right-1 bg-black/80 text-white rounded-full w-6 h-6 flex items-center justify-center text-[12px]" data-testid={`day-photo-clear-${day.day_number}`}>
                  <i className="fas fa-times"/>
                </button>
              </div>
            ) : (
              <button onClick={onPickFile} data-testid={`day-photo-pick-${day.day_number}`}
                      className="mt-1 bg-bgPanel border border-bgHover rounded px-3 py-2 text-[14px] text-gray-300 font-black uppercase tracking-widest hover:border-shBlue">
                <i className="fas fa-camera mr-1.5"/>Add photo
              </button>
            )}
          </div>

          {err && <p className="text-red-400 text-[14px] uppercase font-black">{err}</p>}
          <div className="flex justify-end gap-2 pt-2 border-t border-bgHover/40">
            <button onClick={onClose} className="text-gray-500 font-black uppercase text-[14px] tracking-widest px-3">Cancel</button>
            <button onClick={onSubmit} disabled={busy} data-testid={`day-submit-${day.day_number}`}
                    className="bg-shGreen text-bgHeader px-5 py-2 rounded text-[14px] font-black uppercase tracking-widest hover:bg-shGreen/80 disabled:opacity-50">
              {busy ? "Sending…" : "Submit for review"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MoodRow({ value, onChange, testid }) {
  return (
    <div>
      <label className="text-[13px] font-black text-gray-500 uppercase tracking-widest">How'd it go?</label>
      <div className="flex items-center gap-1 mt-1">
        {[1, 2, 3, 4, 5].map(n => (
          <button key={n} onClick={() => onChange(value === n ? 0 : n)}
                  data-testid={`${testid}-${n}`}
                  className={`text-2xl rounded transition-transform ${value === n ? "scale-125" : "opacity-50 hover:opacity-100"}`}>
            {MOOD_EMOJI[n]}
          </button>
        ))}
        <span className="text-[13px] text-gray-400 ml-2 font-black uppercase tracking-widest">
          {value ? MOOD_LABEL[value] : "tap an emoji"}
        </span>
      </div>
    </div>
  );
}

function FieldInput({ field, value, onChange }) {
  const km = KIND_META[field.kind] || { type: "text" };

  if (km.type === "mood") {
    return <MoodRow value={Number(value) || 0} onChange={onChange} testid={`field-${field.id}`} />;
  }
  if (km.type === "checkbox") {
    return (
      <label className="flex items-center gap-2 cursor-pointer bg-bgPanel border border-bgHover rounded p-2.5" data-testid={`field-${field.id}`}>
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} className="w-5 h-5 accent-shGreen" />
        <span className="text-[14px] text-gray-200 font-black">{field.label}</span>
      </label>
    );
  }
  if (km.type === "longtext") {
    return (
      <div>
        <label className="text-[13px] font-black text-gray-500 uppercase tracking-widest">{field.label}</label>
        <textarea value={value || ""} onChange={(e) => onChange(e.target.value)} rows={2}
                  placeholder={field.placeholder || ""}
                  data-testid={`field-${field.id}`}
                  className="w-full mt-1 bg-bgPanel border border-bgHover rounded p-2 text-white text-sm" />
      </div>
    );
  }
  if (km.type === "number") {
    const current = Number(value) || 0;
    return (
      <div>
        <label className="text-[13px] font-black text-gray-500 uppercase tracking-widest">{field.label}</label>
        <div className="flex items-center gap-2 mt-1">
          <button onClick={() => onChange(Math.max(km.min ?? 0, current - 1))} data-testid={`field-${field.id}-dec`}
                  className="w-9 h-9 bg-bgPanel border border-bgHover rounded text-white font-black hover:border-shBlue">−</button>
          <input type="number" value={value ?? ""} onChange={(e) => onChange(e.target.value)}
                 min={km.min} max={km.max}
                 data-testid={`field-${field.id}`}
                 className="w-full bg-bgPanel border border-bgHover rounded p-2 text-white text-sm text-center" />
          <button onClick={() => onChange((km.max != null ? Math.min(km.max, current + 1) : current + 1))} data-testid={`field-${field.id}-inc`}
                  className="w-9 h-9 bg-bgPanel border border-bgHover rounded text-white font-black hover:border-shBlue">+</button>
          {km.unit && <span className="text-[13px] text-gray-500 font-black uppercase tracking-widest">{km.unit}</span>}
        </div>
      </div>
    );
  }
  return (
    <div>
      <label className="text-[13px] font-black text-gray-500 uppercase tracking-widest">{field.label}</label>
      <input value={value || ""} onChange={(e) => onChange(e.target.value)}
             placeholder={field.placeholder || ""}
             data-testid={`field-${field.id}`}
             className="w-full mt-1 bg-bgPanel border border-bgHover rounded p-2 text-white text-sm" />
    </div>
  );
}
