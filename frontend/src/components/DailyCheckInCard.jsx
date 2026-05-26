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

const VIDEO_MAX_MB = 15;

/**
 * Client-portal Daily Check-In Card.
 *
 * Now supports: equipment checklist, video upload, rest-day toggle, threaded
 * questions to the trainer, and a "download certificate" CTA when the plan
 * is complete.
 */
export default function DailyCheckInCard({ homeworkId, onChanged, hideActionableForm = false }) {
  const [hw, setHw] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [openDay, setOpenDay] = useState(null);
  const [values, setValues] = useState({});
  const [mood, setMood] = useState(0);
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState("");
  const [videoId, setVideoId] = useState("");
  const [videoName, setVideoName] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [remindersOpen, setRemindersOpen] = useState(false);
  const photoRef = useRef(null);
  const videoRef = useRef(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/homework/${homeworkId}`);
      setHw(data);
      const next = (data.daily_progress || []).find(p => p.status === "available" || p.status === "needs_redo");
      // Sprint 109 — when Today's Plan card now hosts the actionable day's form,
      // don't auto-open it here too (would render the same form twice).
      if (next && openDay === null && !hideActionableForm) {
        setOpenDay(next.day_number);
        if (next.log) {
          const fv = { ...(next.log.field_values || {}) };
          setMood(Number(fv.__mood) || 0);
          setPhoto(fv.__photo || "");
          setVideoId(fv.__video_id || "");
          delete fv.__mood; delete fv.__photo; delete fv.__video_id;
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
      setVideoId(fv.__video_id || "");
      delete fv.__mood; delete fv.__photo; delete fv.__video_id;
      setValues(fv);
      setNote(day.log.note || "");
    } else {
      setValues({}); setMood(0); setPhoto(""); setVideoId(""); setVideoName(""); setNote("");
    }
  };

  const onPhotoPicked = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setPhoto(reader.result || "");
    reader.readAsDataURL(f);
  };

  const onVideoPicked = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > VIDEO_MAX_MB * 1024 * 1024) {
      setErr(`Video too large — keep it under ${VIDEO_MAX_MB} MB (≈ 10-15 seconds).`);
      return;
    }
    setUploadingVideo(true);
    setErr("");
    try {
      const reader = new FileReader();
      const dataUrl = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(f);
      });
      const { data } = await api.post(`/homework/${homeworkId}/day/${openDay}/video`, { photo: dataUrl, filename: f.name });
      setVideoId(data.media_id);
      setVideoName(f.name);
    } catch (ex) {
      setErr("Video upload failed: " + (ex.response?.data?.detail || ex.message));
    } finally { setUploadingVideo(false); }
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
        field_values, note,
        mood: mood || null,
        photo: photo || "",
        video_media_id: videoId || "",
      });
      setValues({}); setMood(0); setNote(""); setPhoto(""); setVideoId(""); setVideoName("");
      setOpenDay(null);
      await load();
      onChanged?.();
    } catch (e) { setErr(e.response?.data?.detail || "Submit failed"); }
    finally { setBusy(false); }
  };

  const markRestDay = async (dayNum) => {
    if (!window.confirm("Mark today as a rest day? It won't break your streak and the next day will unlock.")) return;
    setBusy(true); setErr("");
    try {
      await api.post(`/homework/${homeworkId}/day/${dayNum}/rest`, { note: "" });
      setOpenDay(null);
      await load();
      onChanged?.();
    } catch (e) { setErr(e.response?.data?.detail || "Failed"); }
    finally { setBusy(false); }
  };

  const askQuestion = async (dayNum, text) => {
    if (!text.trim()) return;
    try {
      await api.post(`/homework/${homeworkId}/day/${dayNum}/ask`, { text });
      await load();
    } catch (e) { setErr(e.response?.data?.detail || "Failed to ask"); }
  };

  const downloadCert = () => {
    if (!hw?.certificate) return;
    const a = document.createElement("a");
    a.href = hw.certificate;
    a.download = hw.certificate_filename || "certificate";
    document.body.appendChild(a); a.click(); a.remove();
  };

  if (loading) return <div className="text-[13px] text-gray-500 font-black uppercase tracking-widest py-3">Loading daily tracker…</div>;
  if (!hw || !hw.daily_progress) return null;

  const progress = hw.daily_progress;
  const streak = hw.streak || 0;
  const totalDays = hw.total_days || progress.length;
  const passedCount = progress.filter(p => p.status === "approved" || p.status === "rest").length;

  return (
    <div className="space-y-3" data-testid={`daily-checkin-${homeworkId}`}>
      {/* Streak header */}
      <div className="bg-gradient-to-r from-shGreen/15 to-shBlue/10 border border-shGreen/30 rounded-lg p-3 flex items-center justify-between flex-wrap gap-2">
        <div>
          <p className="text-[14px] font-black uppercase tracking-widest text-shGreen">
            <i className="fas fa-fire mr-1"/>{streak}-day streak
          </p>
          <p className="text-[13px] text-gray-300 mt-0.5">
            {passedCount} of {totalDays} done · {totalDays - passedCount} to go
          </p>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <button onClick={() => setRemindersOpen(true)} data-testid="reminders-open"
                  className="text-[12px] font-black uppercase tracking-widest text-gray-400 hover:text-shBlue border border-bgHover hover:border-shBlue rounded px-2.5 py-1.5">
            <i className="fas fa-bell mr-1"/>Reminders
          </button>
          <div className="flex-1 max-w-[160px]">
            <div className="bg-bgBase rounded-full h-2 overflow-hidden border border-bgHover">
              <div className="bg-shGreen h-full transition-all" style={{ width: `${(passedCount / Math.max(totalDays, 1)) * 100}%` }} />
            </div>
          </div>
        </div>
      </div>

      {remindersOpen && <ReminderSettingsModal onClose={() => setRemindersOpen(false)} />}

      {/* Certificate CTA — shown when plan is fully done AND admin uploaded a cert */}
      {hw.status === "completed" && hw.certificate && (
        <button onClick={downloadCert} data-testid="cert-download"
                className="w-full bg-gradient-to-r from-shOrange via-yellow-500 to-shGreen text-bgHeader rounded-lg p-4 font-black uppercase tracking-widest hover:opacity-90 transition shadow-xl flex items-center justify-center gap-3">
          <i className="fas fa-award text-2xl"/>
          <span className="text-[15px]">Download {hw.dog_name}'s Certificate</span>
          <i className="fas fa-download"/>
        </button>
      )}

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
            videoId={videoId} videoName={videoName} setVideoId={setVideoId} setVideoName={setVideoName}
            uploadingVideo={uploadingVideo}
            homeworkId={homeworkId}
            onPickPhoto={() => photoRef.current?.click()}
            onPickVideo={() => videoRef.current?.click()}
            onSubmit={submit}
            onMarkRest={() => markRestDay(day.day_number)}
            onAsk={(t) => askQuestion(day.day_number, t)}
            busy={busy}
            err={err}
            hideActionableForm={hideActionableForm}
          />
        ))}
      </div>
      <input ref={photoRef} type="file" accept="image/*" onChange={onPhotoPicked} className="hidden" data-testid="daily-photo-input" />
      <input ref={videoRef} type="file" accept="video/*" onChange={onVideoPicked} className="hidden" data-testid="daily-video-input" />
    </div>
  );
}

function DayRow({ day, isOpen, onOpen, onClose, values, setValues, mood, setMood, note, setNote, photo, setPhoto, videoId, videoName, setVideoId, setVideoName, uploadingVideo, homeworkId, onPickPhoto, onPickVideo, onSubmit, onMarkRest, onAsk, busy, err, hideActionableForm = false }) {
  const statusMeta = {
    locked:     { color: "border-bgHover bg-bgBase/40 text-gray-500", icon: "fa-lock",          label: "Locked",              actionable: false },
    available:  { color: "border-shGreen/50 bg-bgBase",               icon: "fa-circle-play",   label: "Ready to log",        actionable: true  },
    draft:      { color: "border-shGreen/50 bg-bgBase",               icon: "fa-circle-play",   label: "Ready to log",        actionable: true  },
    submitted:  { color: "border-shOrange/50 bg-shOrange/5",          icon: "fa-hourglass-half",label: "Waiting for trainer", actionable: false },
    approved:   { color: "border-shGreen/40 bg-shGreen/5",            icon: "fa-circle-check",  label: "Approved",            actionable: false },
    rest:       { color: "border-shBlue/40 bg-shBlue/5",              icon: "fa-bed",           label: "Rest day",            actionable: false },
    needs_redo: { color: "border-red-500/40 bg-red-500/5",            icon: "fa-rotate-left",   label: "Needs redo",          actionable: true  },
  }[day.status] || { color: "border-bgHover bg-bgBase", icon: "fa-circle", label: day.status };
  // Sprint 109 — when Today's Plan owns the actionable day form, this row
  // should NOT show the form. We still let it open to show review notes /
  // question thread, just not the inputs.
  if (hideActionableForm && statusMeta.actionable) {
    statusMeta.actionable = false;
  }
  const log = day.log;
  const reviewerNote = log?.review_note;
  const logMood = Number(log?.field_values?.__mood) || 0;
  const logPhoto = log?.field_values?.__photo;
  const questions = day.questions || [];

  return (
    <div className={`rounded-lg border ${statusMeta.color}`} data-testid={`day-row-${day.day_number}`}>
      <button onClick={statusMeta.actionable ? onOpen : (questions.length > 0 ? onOpen : null)}
              disabled={!statusMeta.actionable && questions.length === 0}
              className={`w-full text-left p-3 flex items-start gap-3 ${(statusMeta.actionable || questions.length > 0) ? "hover:bg-bgHover/30 cursor-pointer" : "cursor-default"}`}
              data-testid={`day-row-toggle-${day.day_number}`}>
        <div className="shrink-0 w-9 h-9 rounded-full bg-bgPanel border border-bgHover flex items-center justify-center font-black text-[14px] uppercase">
          {day.status === "approved" ? <i className="fas fa-check text-shGreen"/> :
           day.status === "rest"     ? <i className="fas fa-bed text-shBlue text-[12px]"/> :
           day.status === "locked"   ? <i className="fas fa-lock text-gray-600 text-[12px]"/> :
           <span className="text-white">{day.day_number}</span>}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white font-black text-[14px] uppercase tracking-tight">Day {day.day_number}</span>
            <span className={`text-[11px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${day.status==="approved" ? "bg-shGreen/15 text-shGreen" : day.status==="rest" ? "bg-shBlue/15 text-shBlue" : day.status==="needs_redo" ? "bg-red-500/15 text-red-300" : day.status==="submitted" ? "bg-shOrange/15 text-shOrange" : day.status==="locked" ? "bg-bgHover text-gray-500" : "bg-bgHover text-shGreen"}`}>
              <i className={`fas ${statusMeta.icon} mr-1`}/>{statusMeta.label}
            </span>
            {questions.filter(q => !q.answer).length > 0 && (
              <span className="text-[11px] font-black uppercase tracking-widest bg-shBlue/15 text-shBlue px-1.5 py-0.5 rounded animate-pulse" data-testid={`q-pending-${day.day_number}`}>
                <i className="fas fa-comment-dots mr-1"/>Q awaiting reply
              </span>
            )}
            {questions.filter(q => q.answer).length > 0 && (
              <span className="text-[11px] font-black uppercase tracking-widest bg-shGreen/15 text-shGreen px-1.5 py-0.5 rounded">
                <i className="fas fa-reply mr-1"/>Trainer replied
              </span>
            )}
          </div>
          <p className="text-gray-300 text-[14px] mt-0.5 line-clamp-2">{day.day_focus}</p>
          {log && day.status !== "available" && day.status !== "needs_redo" && day.status !== "draft" && (
            <div className="mt-2 flex items-center gap-2 text-[12px] text-gray-500 font-black uppercase tracking-widest">
              <span>{(log.date || "").slice(0, 10)}</span>
              {logMood > 0 && <span>· {MOOD_EMOJI[logMood]}</span>}
              {logPhoto && <span>· <i className="fas fa-camera"/></span>}
              {log.field_values?.__video_id && <span>· <i className="fas fa-video"/></span>}
              {day.status === "rest" && <span className="text-shBlue">· rest day</span>}
            </div>
          )}
          {reviewerNote && day.status === "needs_redo" && (
            <div className="mt-2 bg-red-500/10 border border-red-500/30 rounded p-2 text-[13px] text-red-200">
              <span className="font-black uppercase tracking-widest text-[11px] text-red-300">Trainer's note · </span>
              <span className="italic">"{reviewerNote}"</span>
            </div>
          )}
        </div>
        {(statusMeta.actionable || questions.length > 0) && !isOpen && (
          <i className="fas fa-chevron-down text-gray-400 mt-2"/>
        )}
      </button>

      {isOpen && (
        <div className="border-t border-bgHover p-3 space-y-3" data-testid={`day-form-${day.day_number}`}>
          {/* Equipment checklist */}
          {Array.isArray(day.equipment) && day.equipment.length > 0 && (
            <div className="bg-shOrange/5 border border-shOrange/30 rounded p-3" data-testid={`day-equipment-${day.day_number}`}>
              <p className="text-[12px] font-black uppercase tracking-widest text-shOrange mb-2">
                <i className="fas fa-toolbox mr-1"/>You'll need
              </p>
              <ul className="space-y-1">
                {day.equipment.map((item, idx) => (
                  <li key={idx} className="text-[14px] text-gray-200 flex items-center gap-2">
                    <i className="far fa-square text-shOrange/60 text-[12px]"/>{item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Instructions */}
          {day.instructions && (
            <p className="text-[14px] text-gray-300 whitespace-pre-wrap leading-snug">{day.instructions}</p>
          )}

          {/* Form for available / needs_redo */}
          {statusMeta.actionable && (
            <>
              {!day.fields.some(f => f.kind === "mood_5") && (
                <MoodRow value={mood} onChange={setMood} testid="day-mood" />
              )}

              {day.fields.map(f => (
                <FieldInput key={f.id} field={f}
                            value={f.kind === "mood_5" ? mood : values[f.id]}
                            onChange={(v) => { if (f.kind === "mood_5") setMood(v); else setValues({...values, [f.id]: v}); }} />
              ))}

              <div>
                <label className="text-[13px] font-black text-gray-500 uppercase tracking-widest">Note for your trainer (optional)</label>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} data-testid={`day-note-${day.day_number}`}
                          placeholder="Anything tricky? Wins? Questions?"
                          className="w-full mt-1 bg-bgPanel border border-bgHover rounded p-2 text-white text-sm" />
              </div>

              <div className="grid grid-cols-2 gap-2">
                {/* Photo */}
                <div>
                  <label className="text-[13px] font-black text-gray-500 uppercase tracking-widest block">Photo</label>
                  {photo ? (
                    <div className="mt-1 relative inline-block">
                      <img src={photo} alt="" className="max-h-24 rounded border border-bgHover" />
                      <button onClick={() => setPhoto("")} className="absolute top-1 right-1 bg-black/80 text-white rounded-full w-5 h-5 flex items-center justify-center text-[10px]" data-testid={`day-photo-clear-${day.day_number}`}>
                        <i className="fas fa-times"/>
                      </button>
                    </div>
                  ) : (
                    <button onClick={onPickPhoto} data-testid={`day-photo-pick-${day.day_number}`}
                            className="mt-1 w-full bg-bgPanel border border-bgHover rounded px-3 py-2 text-[13px] text-gray-300 font-black uppercase tracking-widest hover:border-shBlue">
                      <i className="fas fa-camera mr-1"/>Add photo
                    </button>
                  )}
                </div>
                {/* Video */}
                <div>
                  <label className="text-[13px] font-black text-gray-500 uppercase tracking-widest block">Video (10s)</label>
                  {videoId ? (
                    <div className="mt-1 bg-shGreen/10 border border-shGreen/30 rounded px-3 py-2 text-[13px] text-shGreen font-black uppercase tracking-widest flex items-center justify-between gap-2">
                      <span className="truncate"><i className="fas fa-check mr-1"/>{videoName || "Video attached"}</span>
                      <button onClick={() => { setVideoId(""); setVideoName(""); }} className="text-gray-400 hover:text-red-400 text-[12px]" data-testid={`day-video-clear-${day.day_number}`}>
                        <i className="fas fa-times"/>
                      </button>
                    </div>
                  ) : (
                    <button onClick={onPickVideo} disabled={uploadingVideo} data-testid={`day-video-pick-${day.day_number}`}
                            className="mt-1 w-full bg-bgPanel border border-bgHover rounded px-3 py-2 text-[13px] text-gray-300 font-black uppercase tracking-widest hover:border-shBlue disabled:opacity-50">
                      <i className={`fas ${uploadingVideo ? "fa-spinner fa-spin" : "fa-video"} mr-1`}/>{uploadingVideo ? "Uploading…" : "Add video"}
                    </button>
                  )}
                </div>
              </div>

              {err && <p className="text-red-400 text-[14px] uppercase font-black">{err}</p>}

              <div className="flex flex-wrap justify-between gap-2 pt-2 border-t border-bgHover/40">
                <button onClick={onMarkRest} disabled={busy} data-testid={`day-rest-${day.day_number}`}
                        className="bg-shBlue/15 text-shBlue border border-shBlue/40 px-3 py-2 rounded text-[13px] font-black uppercase tracking-widest hover:bg-shBlue/25">
                  <i className="fas fa-bed mr-1"/>Rest day
                </button>
                <div className="flex gap-2">
                  <button onClick={onClose} className="text-gray-500 font-black uppercase text-[14px] tracking-widest px-3">Cancel</button>
                  <button onClick={onSubmit} disabled={busy} data-testid={`day-submit-${day.day_number}`}
                          className="bg-shGreen text-bgHeader px-5 py-2 rounded text-[14px] font-black uppercase tracking-widest hover:bg-shGreen/80 disabled:opacity-50">
                    {busy ? "Sending…" : "Submit for review"}
                  </button>
                </div>
              </div>
            </>
          )}

          {/* Question thread (always shown when expanded if applicable) */}
          <QuestionThread questions={questions} onAsk={onAsk} dayNum={day.day_number}
                          allowAsk={day.status !== "locked"} />
        </div>
      )}
    </div>
  );
}

function QuestionThread({ questions, onAsk, dayNum, allowAsk }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(questions.length > 0);
  const send = async () => {
    if (!text.trim()) return;
    await onAsk(text);
    setText("");
  };
  if (questions.length === 0 && !allowAsk) return null;
  return (
    <div className="border-t border-bgHover/40 pt-3" data-testid={`day-thread-${dayNum}`}>
      <button onClick={() => setOpen(o => !o)}
              className="text-[13px] font-black uppercase tracking-widest text-shBlue hover:text-shBlue/80 mb-2 flex items-center gap-2"
              data-testid={`day-thread-toggle-${dayNum}`}>
        <i className="fas fa-comments"/>
        {questions.length > 0 ? `Questions (${questions.length})` : "Ask your trainer"}
        <i className={`fas fa-chevron-${open ? "up" : "down"} text-[11px]`}/>
      </button>
      {open && (
        <div className="space-y-2">
          {questions.map(q => (
            <div key={q.id} className="bg-bgPanel/60 border border-bgHover rounded p-2.5 text-[14px]">
              <p className="text-gray-200"><span className="text-shBlue font-black uppercase text-[11px] tracking-widest mr-1">You:</span>{q.text}</p>
              {q.answer ? (
                <p className="text-gray-100 mt-2 pl-2 border-l-2 border-shGreen/50">
                  <span className="text-shGreen font-black uppercase text-[11px] tracking-widest mr-1">Trainer:</span>{q.answer}
                </p>
              ) : (
                <p className="text-shOrange italic text-[12px] mt-1 font-black uppercase tracking-widest">
                  <i className="fas fa-hourglass-half mr-1"/>waiting for reply
                </p>
              )}
            </div>
          ))}
          {allowAsk && (
            <div className="flex gap-2">
              <input value={text} onChange={(e) => setText(e.target.value)}
                     onKeyDown={(e) => e.key === "Enter" && send()}
                     placeholder="Ask your trainer about today…"
                     data-testid={`day-ask-input-${dayNum}`}
                     className="flex-1 bg-bgPanel border border-bgHover rounded p-2 text-white text-sm" />
              <button onClick={send} data-testid={`day-ask-send-${dayNum}`}
                      className="bg-shBlue text-white px-3 py-2 rounded text-[13px] font-black uppercase tracking-widest hover:bg-shBlue/80">
                <i className="fas fa-paper-plane"/>
              </button>
            </div>
          )}
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
          <button key={n} onClick={() => onChange(value === n ? 0 : n)} data-testid={`${testid}-${n}`}
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
  if (km.type === "mood") return <MoodRow value={Number(value) || 0} onChange={onChange} testid={`field-${field.id}`} />;
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
                  placeholder={field.placeholder || ""} data-testid={`field-${field.id}`}
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
                 min={km.min} max={km.max} data-testid={`field-${field.id}`}
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
             placeholder={field.placeholder || ""} data-testid={`field-${field.id}`}
             className="w-full mt-1 bg-bgPanel border border-bgHover rounded p-2 text-white text-sm" />
    </div>
  );
}


const WEEKDAYS = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
];

function ReminderSettingsModal({ onClose }) {
  const [enabled, setEnabled] = useState(false);
  const [days, setDays] = useState([]);
  const [time, setTime] = useState("18:00");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/portal/reminder-settings");
        setEnabled(!!data.enabled);
        setDays(data.days || []);
        setTime(data.time || "18:00");
      } catch { /* ignore — default off */ }
      finally { setLoading(false); }
    })();
  }, []);

  const toggleDay = (k) => setDays(days.includes(k) ? days.filter(d => d !== k) : [...days, k]);

  const save = async () => {
    setBusy(true);
    try {
      await api.put("/portal/reminder-settings", { enabled, days, time });
      onClose?.();
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" onClick={onClose} data-testid="reminder-modal">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-md p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-lg font-black text-white uppercase italic tracking-tight">
            <i className="fas fa-bell text-shBlue mr-2"/>Practice reminders
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white" data-testid="reminder-close">
            <i className="fas fa-times"/>
          </button>
        </div>
        <p className="text-[14px] text-gray-300 leading-snug mb-4">
          We'll email you a quick "time to practice" nudge with today's focus.
          {" "}Even 5 minutes counts. 🐾
        </p>

        {loading ? <p className="text-gray-500 text-[14px]">Loading…</p> : (
          <>
            <label className="flex items-center gap-3 cursor-pointer bg-bgBase border border-bgHover rounded p-3 mb-3" data-testid="reminder-enable-row">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="w-5 h-5 accent-shGreen" data-testid="reminder-enable" />
              <span className="text-[14px] font-black uppercase tracking-widest text-white">Send me reminders</span>
            </label>

            {enabled && (
              <>
                <p className="text-[13px] font-black text-gray-500 uppercase tracking-widest mb-2">Which days?</p>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {WEEKDAYS.map(d => (
                    <button key={d.key} onClick={() => toggleDay(d.key)} data-testid={`reminder-day-${d.key}`}
                            className={`px-3 py-1.5 rounded text-[13px] font-black uppercase tracking-widest border transition
                              ${days.includes(d.key) ? "bg-shGreen text-bgHeader border-shGreen" : "bg-bgBase text-gray-300 border-bgHover hover:border-shGreen/50"}`}>
                      {d.label}
                    </button>
                  ))}
                </div>
                <label className="text-[13px] font-black text-gray-500 uppercase tracking-widest">Time (your local)</label>
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} data-testid="reminder-time"
                       style={{ colorScheme: "dark" }}
                       className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
                <p className="text-[12px] text-gray-500 mt-2">Reminders fire once per day on the days you pick.</p>
              </>
            )}
          </>
        )}

        <div className="flex justify-end gap-2 pt-3 mt-3 border-t border-bgHover">
          <button onClick={onClose} className="text-gray-500 font-black uppercase text-[14px] tracking-widest px-3">Cancel</button>
          <button onClick={save} disabled={busy || loading} data-testid="reminder-save"
                  className="bg-shGreen text-bgHeader px-5 py-2 rounded text-[14px] font-black uppercase tracking-widest hover:bg-shGreen/80 disabled:opacity-50">
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
