// Online School Phase 2 — Trainer Checkpoints & Grading. Mirrors
// DailyReviewQueue.jsx's list -> detail -> action structure and its
// ReviewVideo pattern (fetching from the existing homework media
// endpoint) — same visual language, same conventions.
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { loadSchoolMediaUrl } from "../lib/schoolMedia";
import NeonEdge from "./premium/NeonEdge";
import HuskyDogImage from "./brand/HuskyDogImage";

const QUEUE_BADGES = {
  state_conflict: { label: "Needs attention", cls: "bg-red-500/15 text-red-300 border-red-500/40" },
  grading_resume_needed: { label: "Resume needed", cls: "bg-amber-500/15 text-amber-300 border-amber-500/40" },
  trainer_assist_hold: { label: "Trainer assist hold", cls: "bg-shBlue/15 text-shBlue border-shBlue/40" },
  pending_review: { label: "Awaiting review", cls: "bg-shAccent/15 text-shAccent border-shAccent/40" },
};

export default function CheckpointReviewQueue({ onClose, onGraded, initialSubmissionId = null }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(null);
  const [handlerScores, setHandlerScores] = useState({});
  const [dogScores, setDogScores] = useState({});
  const [feedback, setFeedback] = useState("");
  const [mode, setMode] = useState("grade"); // grade | prescribe
  const [prescriptionAction, setPrescriptionAction] = useState("repeat_current_recipe");
  const [templateId, setTemplateId] = useState("");
  const [refresherLessonId, setRefresherLessonId] = useState("");
  const [minSessions, setMinSessions] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [videoTime, setVideoTime] = useState(0);
  const [annotationNote, setAnnotationNote] = useState("");
  const [seekTo, setSeekTo] = useState(null);
  const initialHandled = useRef(false);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/admin/school/checkpoints/pending");
      setItems(data || []);
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const open = (it) => {
    setActive(it);
    // Every criterion must be scored DELIBERATELY — nothing is pre-filled,
    // and the grade actions stay disabled until every criterion has a value.
    setHandlerScores({});
    setDogScores({});
    setFeedback(""); setErr(""); setMode("grade"); setVideoTime(0); setAnnotationNote(""); setSeekTo(null);
    setPrescriptionAction("repeat_current_recipe"); setTemplateId(""); setRefresherLessonId(""); setMinSessions("");
  };

  useEffect(() => {
    if (initialHandled.current || !initialSubmissionId || !items.length) return;
    const target = items.find((it) => it.id === initialSubmissionId);
    if (target) { open(target); initialHandled.current = true; }
  }, [items, initialSubmissionId]);

  const back = () => { setActive(null); setErr(""); };

  // Grading requires a deliberate 1-5 score on EVERY criterion — the action
  // buttons stay disabled (with a visible message) until then.
  const allScored = !!active
    && (active.rubric_snapshot?.handler_criteria || []).every(c => Number.isFinite(handlerScores[c.id]))
    && (active.rubric_snapshot?.dog_criteria || []).every(c => Number.isFinite(dogScores[c.id]));

  const grade = async (outcome) => {
    if (!active) return;
    setBusy(true); setErr("");
    try {
      const body = { handler_scores: handlerScores, dog_scores: dogScores, feedback, outcome };
      if (outcome === "prescribe_practice") {
        body.prescription = {
          action: prescriptionAction,
          homework_template_id: prescriptionAction === "assign_recipe" ? templateId : undefined,
          refresher_lesson_id: prescriptionAction === "assign_refresher_lesson" ? refresherLessonId : undefined,
          min_practice_sessions_required: minSessions ? parseInt(minSessions, 10) : undefined,
        };
      }
      await api.post(`/admin/school/checkpoints/${active.id}/grade`, body);
      setActive(null);
      await load();
      onGraded?.();
    } catch (e) {
      const d = e.response?.data?.detail;
      setErr((d && d.message) || d || "Failed to grade.");
    } finally { setBusy(false); }
  };

  const addAnnotation = async () => {
    if (!active || !annotationNote.trim()) return;
    setBusy(true); setErr("");
    try {
      const { data } = await api.post(`/admin/school/checkpoints/${active.id}/annotations`, { timestamp_seconds: videoTime || 0, note: annotationNote.trim() });
      setActive((a) => ({ ...a, video_annotations: data.annotations || [] })); setAnnotationNote("");
    } catch (e) { setErr(e.response?.data?.detail || "Could not add video note."); }
    finally { setBusy(false); }
  };

  const clearHold = async () => {
    if (!active) return;
    setBusy(true); setErr("");
    try {
      await api.post(`/admin/school/checkpoints/${active.id}/clear-trainer-assist-hold`);
      setActive(null);
      await load();
      onGraded?.();
    } catch (e) {
      setErr(e.response?.data?.detail || "Failed to clear hold.");
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4 lg:p-6 z-50" onClick={onClose} data-testid="checkpoint-review-queue-modal">
      <div className="bg-bgPanel border border-shBorder/70 rounded-t-3xl sm:rounded-3xl w-full sm:max-w-5xl h-[100dvh] sm:h-auto sm:max-h-[calc(var(--app-height)_-_2rem)] overflow-y-auto shadow-[0_30px_100px_rgba(0,0,0,0.72)]" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-bgHeader/95 backdrop-blur-xl border-b border-shBorder/60 px-3 sm:px-5 py-3.5 sm:py-4 flex items-center justify-between gap-3 z-10">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-xl bg-shAccent/10 border border-shAccent/30 grid place-items-center"><i className="fas fa-video text-shAccent"/></div>
            <div className="min-w-0">
              <p className="text-[9px] sm:text-[10px] font-black uppercase tracking-[0.16em] text-shAccent truncate">Online School · Trainer desk</p>
              <h3 className="sh-display text-xl sm:text-2xl text-shText leading-none mt-1 truncate">Checkpoint Reviews</h3>
              <p className="text-[12px] text-shTextMuted mt-1">{loading ? "Loading…" : items.length === 0 ? "Inbox zero — nothing pending" : `${items.length} checkpoint${items.length === 1 ? "" : "s"} need your attention`}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-10 h-10 rounded-xl border border-shBorder/60 bg-black/20 grid place-items-center text-shTextMuted hover:text-shText" data-testid="checkpoint-review-queue-close"><i className="fas fa-times"/></button>
        </div>

        {!active ? (
          <div className="p-3 sm:p-5 space-y-3 pb-[max(1rem,env(safe-area-inset-bottom))]" data-testid="checkpoint-review-queue-list">
            {items.length === 0 && !loading && (
              <div className="text-center py-12 text-shTextMuted">
                <i className="fas fa-mug-hot text-3xl mb-3 opacity-40 block"/>
                <p className="text-[14px] font-black uppercase tracking-widest">All caught up.</p>
              </div>
            )}
            {items.map((it, idx) => {
              const badge = QUEUE_BADGES[it.queue_state] || QUEUE_BADGES.pending_review;
              return (
                <button key={it.id} onClick={() => open(it)} data-testid={`checkpoint-review-item-${idx}`}
                        className="w-full text-left border border-shBorder/60 bg-black/20 rounded-2xl p-3.5 sm:p-4 hover:border-shAccent/40 hover:bg-white/[0.025] transition">
                  <div className="flex items-start sm:items-center gap-3">
                    <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl overflow-hidden border border-shBorder/70 shrink-0 bg-black/30">
                      <HuskyDogImage src={it.dog_photo} name={it.dog_name} alt={it.dog_name} className="w-full h-full object-cover object-top"/>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`text-[12px] font-black uppercase tracking-widest px-2 py-0.5 rounded border ${badge.cls}`} data-testid={`checkpoint-review-item-${idx}-state`}>
                          {badge.label}
                        </span>
                        <span className="text-shTextMuted text-[10px] sm:text-[11px] font-bold">
                          {(it.submitted_at || "").slice(0, 10)} · {(it.submitted_at || "").slice(11, 16)}
                        </span>
                      </div>
                      <p className="text-shText font-black text-[14px] sm:text-[15px] truncate">{it.dog_name} · {it.client_name}</p>
                      <p className="text-shTextMuted text-[13px] truncate mt-0.5">{it.lesson_name}</p>
                      {it.client_note && <p className="text-shTextMuted text-[13px] italic mt-1 truncate">"{it.client_note}"</p>}
                    </div>
                    <div className="hidden sm:grid w-9 h-9 rounded-xl border border-shBorder/60 place-items-center shrink-0"><i className="fas fa-chevron-right text-shTextMuted text-[11px]"/></div>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="p-3 sm:p-5 space-y-4 pb-[max(1rem,env(safe-area-inset-bottom))]" data-testid="checkpoint-review-detail-pane">
            <button onClick={back} className="inline-flex items-center min-h-[42px] text-[12px] sm:text-[13px] text-shTextMuted hover:text-shSecondary font-black" data-testid="checkpoint-review-back">
              <i className="fas fa-chevron-left mr-1"/>Back to queue
            </button>

            <NeonEdge accentRgb="242,101,34" intensity="subtle" className="p-4 sm:p-5">
              <div className="flex items-center gap-3.5">
                <div className="w-14 h-14 rounded-2xl overflow-hidden border border-shAccent/25 shrink-0"><HuskyDogImage src={active.dog_photo} name={active.dog_name} alt={active.dog_name} className="w-full h-full object-cover object-top"/></div>
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-[0.15em] text-shAccent">Checkpoint review</p>
                  <h4 className="text-shText text-lg font-black tracking-tight mt-1">{active.dog_name} <span className="text-shTextMuted font-medium">· {active.client_name}</span></h4>
                  <p className="text-shTextMuted text-[13px] mt-0.5">{active.lesson_name}</p>
                </div>
              </div>
              {active.client_note && <div className="bg-black/25 rounded-xl p-3 mt-3 border border-shAccent/15"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-shAccent/80 mb-1">Client note</p><p className="text-gray-200 text-[13px] italic whitespace-pre-wrap">“{active.client_note}”</p></div>}
            </NeonEdge>

            {active.homework_id && active.video_media_id && (
              <div className="space-y-3">
                <ReviewVideo homeworkId={active.homework_id} mediaId={active.video_media_id} onTime={setVideoTime} seekTo={seekTo}/>
                <div className="rounded-2xl border border-shBorder/55 bg-black/15 p-4" data-testid="checkpoint-video-annotations">
                  <div className="flex items-center justify-between gap-2"><p className="text-[12px] font-black uppercase tracking-widest text-shSecondary"><i className="fas fa-comment-medical mr-1.5"/>Video notes</p><span className="text-[11px] text-shTextMuted">Current time {formatVideoTime(videoTime)}</span></div>
                  <div className="flex flex-col sm:flex-row gap-2 mt-3"><input value={annotationNote} onChange={(e)=>setAnnotationNote(e.target.value)} placeholder="Add a trainer note at this moment…" className="flex-1 min-h-[42px] rounded-xl border border-shBorder/55 bg-black/20 px-3 text-sm text-shText"/><button onClick={addAnnotation} disabled={busy || !annotationNote.trim()} className="min-h-[42px] px-4 rounded-xl bg-shSecondary text-bgHeader text-[11px] font-black uppercase tracking-widest disabled:opacity-40">Add at {formatVideoTime(videoTime)}</button></div>
                  {(active.video_annotations || []).length > 0 && <div className="space-y-2 mt-3">{active.video_annotations.map((a)=><button key={a.id} onClick={()=>setSeekTo({ seconds:a.timestamp_seconds, token:Date.now() })} className="w-full text-left rounded-xl border border-shBorder/40 p-2.5 hover:border-shSecondary/30"><span className="text-[10px] font-black text-shSecondary mr-2">{formatVideoTime(a.timestamp_seconds)}</span><span className="text-[12px] text-shText">{a.note}</span></button>)}</div>}
                </div>
              </div>
            )}

            {err && <p className="text-red-400 text-[14px] uppercase font-black">{err}</p>}

            {active.queue_state === "trainer_assist_hold" ? (
              <div className="bg-shBlue/10 border border-shBlue/40 rounded-xl p-4 space-y-3">
                <p className="text-shBlue font-black uppercase tracking-widest text-[13px]">
                  <i className="fas fa-handshake mr-1.5"/>Trainer Assist recommended
                </p>
                {active.trainer_feedback && <p className="text-shText text-[13px]">{active.trainer_feedback}</p>}
                <p className="text-shTextMuted text-[12px]">The client cannot resubmit a checkpoint for this lesson until you clear this hold.</p>
                <button onClick={clearHold} disabled={busy} data-testid="checkpoint-review-clear-hold"
                        className="w-full bg-shSecondary text-bgHeader py-2.5 rounded-xl font-black text-[13px] uppercase tracking-widest disabled:opacity-50">
                  <i className="fas fa-unlock mr-2"/>Trainer Assist Complete · Allow Resubmission
                </button>
              </div>
            ) : active.queue_state === "state_conflict" ? (
              <div className="bg-red-500/10 border border-red-500/40 rounded-xl p-4">
                <p className="text-red-300 font-black uppercase tracking-widest text-[13px] mb-1">
                  <i className="fas fa-triangle-exclamation mr-1.5"/>This enrollment moved since submission
                </p>
                <p className="text-shTextMuted text-[13px]">Grading was interrupted and this dog's enrollment changed position before it could finish. Confirm the dog's real position, then retry.</p>
                <button onClick={() => grade("advance")} disabled={busy} data-testid="checkpoint-review-retry-conflict"
                        className="mt-3 bg-shSecondary text-bgHeader px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest disabled:opacity-50">
                  Retry
                </button>
              </div>
            ) : (
              <>
                <div className="bg-black/15 border border-shBorder/55 rounded-2xl p-4 sm:p-5 space-y-3">
                  {active.rubric_snapshot?.pass_readiness_guidance && (
                    <div className="rounded-xl border border-shAccent/30 bg-shAccent/[0.06] p-3" data-testid="checkpoint-pass-readiness-guidance">
                      <p className="text-[10px] font-black uppercase tracking-widest text-shAccent mb-1"><i className="fas fa-compass mr-1.5"/>Pass / readiness guidance <span className="normal-case tracking-normal font-bold">(trainer-only)</span></p>
                      <p className="text-[13px] text-shText leading-relaxed whitespace-pre-wrap">{active.rubric_snapshot.pass_readiness_guidance}</p>
                    </div>
                  )}
                  <ScoreScaleLegend />
                  <p className="text-[13px] font-black uppercase tracking-widest text-shSecondary"><i className="fas fa-user mr-1"/>Handler</p>
                  {(active.rubric_snapshot?.handler_criteria || []).map(c => (
                    <ScoreRow key={c.id} criterion={c} value={handlerScores[c.id]} onChange={(v) => setHandlerScores(s => ({ ...s, [c.id]: v }))}/>
                  ))}
                  <p className="text-[13px] font-black uppercase tracking-widest text-shSecondary pt-2"><i className="fas fa-paw mr-1"/>Dog</p>
                  {(active.rubric_snapshot?.dog_criteria || []).map(c => (
                    <ScoreRow key={c.id} criterion={c} value={dogScores[c.id]} onChange={(v) => setDogScores(s => ({ ...s, [c.id]: v }))}/>
                  ))}
                  <div className="pt-2 border-t border-shBorder/40 space-y-1">
                    <ScoreSummary label="Handler Skills" criteria={active.rubric_snapshot?.handler_criteria} scores={handlerScores} />
                    <ScoreSummary label="Dog Performance" criteria={active.rubric_snapshot?.dog_criteria} scores={dogScores} />
                  </div>
                </div>

                <div className="bg-black/15 border border-shBorder/55 rounded-2xl p-4 sm:p-5 space-y-3">
                  <p className="text-[13px] font-black uppercase tracking-widest text-shSecondary"><i className="fas fa-comment mr-1"/>Feedback (emailed to the client)</p>
                  <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={3} data-testid="checkpoint-review-feedback"
                            className="w-full min-h-[96px] bg-black/20 border border-shBorder/55 rounded-xl p-3 text-shText text-sm focus:outline-none focus:border-shSecondary/40"/>

                  {mode === "prescribe" ? (
                    <div className="space-y-2 border-t border-shBorder/50 pt-3" data-testid="checkpoint-review-prescription-form">
                      <select value={prescriptionAction} onChange={(e) => setPrescriptionAction(e.target.value)} data-testid="checkpoint-review-prescription-action"
                              className="w-full min-h-[96px] bg-black/20 border border-shBorder/55 rounded-xl p-3 text-shText text-sm focus:outline-none focus:border-shSecondary/40">
                        <option value="repeat_current_recipe">Repeat current Practice Recipe</option>
                        <option value="assign_recipe">Assign a different Practice Recipe</option>
                        <option value="assign_refresher_lesson">Assign a refresher lesson</option>
                      </select>
                      {prescriptionAction === "assign_recipe" && (
                        <input value={templateId} onChange={(e) => setTemplateId(e.target.value)} placeholder="Homework template id" data-testid="checkpoint-review-template-id"
                               className="w-full min-h-[96px] bg-black/20 border border-shBorder/55 rounded-xl p-3 text-shText text-sm focus:outline-none focus:border-shSecondary/40"/>
                      )}
                      {prescriptionAction === "assign_refresher_lesson" && (
                        <input value={refresherLessonId} onChange={(e) => setRefresherLessonId(e.target.value)} placeholder="Refresher lesson id" data-testid="checkpoint-review-refresher-lesson-id"
                               className="w-full min-h-[96px] bg-black/20 border border-shBorder/55 rounded-xl p-3 text-shText text-sm focus:outline-none focus:border-shSecondary/40"/>
                      )}
                      <input value={minSessions} onChange={(e) => setMinSessions(e.target.value)} type="number" min="0"
                             placeholder="Minimum practice sessions before resubmit (optional)" data-testid="checkpoint-review-min-sessions"
                             className="w-full min-h-[96px] bg-black/20 border border-shBorder/55 rounded-xl p-3 text-shText text-sm focus:outline-none focus:border-shSecondary/40"/>
                      <div className="flex gap-2 justify-end pt-2">
                        <button onClick={() => setMode("grade")} className="text-[12px] text-shTextMuted hover:text-shText font-black uppercase tracking-widest px-3 py-2">
                          Back
                        </button>
                        <button onClick={() => grade("prescribe_practice")} disabled={busy || !allScored} data-testid="checkpoint-review-confirm-prescribe"
                                className="bg-shSecondary text-bgHeader px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest disabled:opacity-50">
                          Confirm Prescription
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {!allScored && (
                        <p className="text-[12px] font-bold text-shAccent pt-3 border-t border-shBorder/50" data-testid="checkpoint-review-incomplete-scores">
                          <i className="fas fa-circle-info mr-1.5"/>Score every Handler and Dog criterion (1-5) before choosing an outcome — no score is ever assumed.
                        </p>
                      )}
                      <div className={`grid grid-cols-1 sm:flex gap-2 sm:justify-end pt-3 ${allScored ? "border-t border-shBorder/50" : ""}`}>
                        <button onClick={() => grade("trainer_assist_recommended")} disabled={busy || !allScored} data-testid="checkpoint-review-trainer-assist"
                                className="min-h-[46px] bg-purple-500/10 text-purple-300 border border-purple-400/30 px-4 py-2.5 rounded-xl text-[11px] sm:text-[12px] font-black hover:bg-purple-500/15 disabled:opacity-50">
                          <i className="fas fa-handshake mr-1"/>Recommend Trainer Assist
                        </button>
                        <button onClick={() => setMode("prescribe")} disabled={busy || !allScored} data-testid="checkpoint-review-prescribe-practice"
                                className="min-h-[46px] bg-shAccent/10 text-shAccent border border-shAccent/30 px-4 py-2.5 rounded-xl text-[11px] sm:text-[12px] font-black hover:bg-shAccent/15 disabled:opacity-50">
                          <i className="fas fa-rotate-left mr-1"/>Practice &amp; Resubmit
                        </button>
                        <button onClick={() => grade("advance")} disabled={busy || !allScored} data-testid="checkpoint-review-advance"
                                className="min-h-[46px] bg-shPrimary text-bgHeader px-5 py-2.5 rounded-xl text-[11px] sm:text-[12px] font-black hover:bg-shPrimary/85 disabled:opacity-50">
                          <i className="fas fa-check mr-1"/>Pass Checkpoint
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// 1-5 scale meaning (also shown as a legend while grading). New grades are
// 1-5 only; a historical 0 stored before this scale remains display-only data.
export const SCORE_SCALE = [
  [1, "Needs significant work"],
  [2, "Developing"],
  [3, "Functional"],
  [4, "Strong"],
  [5, "Excellent / ready"],
];

function ScoreScaleLegend() {
  return (
    <div className="rounded-xl border border-shBorder/40 bg-black/10 px-3 py-2.5" data-testid="checkpoint-score-legend">
      <p className="text-[10px] font-black uppercase tracking-widest text-shTextMuted mb-1.5"><i className="fas fa-ruler mr-1.5" />Score scale</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {SCORE_SCALE.map(([n, label]) => (
          <span key={n} className="text-[11px] text-shTextMuted"><span className="font-black text-shText">{n}</span> — {label}</span>
        ))}
      </div>
    </div>
  );
}

function ScoreRow({ criterion, value, onChange }) {
  return (
    <div className="rounded-xl border border-shBorder/40 bg-black/10 px-3 py-2.5" data-testid={`checkpoint-review-score-${criterion.id}`}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <span className="text-[13px] text-shText">{criterion.name}</span>
        {/* 1-5 segmented buttons — nothing preselected; a grade must be a
            deliberate choice, never a silent default. */}
        <div className="flex gap-1" role="radiogroup" aria-label={`${criterion.name} score`}>
          {[1, 2, 3, 4, 5].map(n => (
            <button key={n} type="button" role="radio" aria-checked={value === n}
                    onClick={() => onChange(n)}
                    title={SCORE_SCALE[n - 1][1]}
                    data-testid={`checkpoint-review-score-${criterion.id}-${n}`}
                    className={`w-11 h-11 rounded-lg border text-[13px] font-black transition ${
                      value === n
                        ? "bg-shPrimary text-bgHeader border-shPrimary"
                        : "bg-black/20 border-shBorder/55 text-shTextMuted hover:text-shText hover:border-shSecondary/40"
                    }`}>
              {n}
            </button>
          ))}
        </div>
      </div>
      {criterion.guidance && (
        <p className="text-[11px] text-shTextMuted mt-2 leading-relaxed border-l-2 border-shSecondary/30 pl-2" data-testid={`checkpoint-criterion-guidance-${criterion.id}`}>
          <span className="font-black uppercase tracking-widest text-[9px] text-shSecondary block mb-0.5">Trainer guidance</span>
          {criterion.guidance}
        </p>
      )}
    </div>
  );
}

function ScoreSummary({ label, criteria, scores }) {
  const total = (criteria || []).length;
  const values = (criteria || []).map(c => scores[c.id]).filter(v => Number.isFinite(v));
  if (!total || values.length === 0) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const partial = values.length < total;
  return (
    <p className="text-[12px] font-black text-shText" data-testid={`checkpoint-score-summary-${label.toLowerCase().replace(/\s+/g, "-")}`}>
      {label} — {mean.toFixed(1)} / 5{partial && <span className="text-shTextMuted font-bold"> (partial · {values.length}/{total} scored)</span>}
    </p>
  );
}

function formatVideoTime(value) {
  const n = Math.max(0, Number(value || 0)); const m = Math.floor(n / 60); const sec = Math.floor(n % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function ReviewVideo({ homeworkId, mediaId, onTime, seekTo }) {
  const [src, setSrc] = useState("");
  const videoRef = useRef(null);
  useEffect(() => {
    let live = true; let cleanup = () => {};
    loadSchoolMediaUrl(mediaId).then((media) => { if (!live) { media.revoke(); return; } cleanup = media.revoke; setSrc(media.url); }).catch(() => {});
    return () => { live = false; cleanup(); };
  }, [mediaId]);
  useEffect(() => { if (seekTo && videoRef.current) { videoRef.current.currentTime = Math.max(0, Number(seekTo.seconds || 0)); videoRef.current.play().catch(()=>{}); } }, [seekTo]);
  if (!src) return <p className="text-[13px] text-shTextMuted mt-2 font-black uppercase tracking-widest"><i className="fas fa-spinner fa-spin mr-1"/>Loading video…</p>;
  return <div data-testid="checkpoint-review-video"><video ref={videoRef} src={src} controls playsInline onTimeUpdate={(e)=>onTime?.(e.currentTarget.currentTime)} className="max-h-[420px] rounded-2xl border border-shBorder/55 bg-black/40 w-full"/></div>;
}

