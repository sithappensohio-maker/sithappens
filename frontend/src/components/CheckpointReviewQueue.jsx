// Online School Phase 2 — Trainer Checkpoints & Grading. Mirrors
// DailyReviewQueue.jsx's list -> detail -> action structure and its
// ReviewVideo pattern (fetching from the existing homework media
// endpoint) — same visual language, same conventions.
import { useEffect, useState } from "react";
import { api } from "../lib/api";

const QUEUE_BADGES = {
  state_conflict: { label: "Needs attention", cls: "bg-red-500/15 text-red-300 border-red-500/40" },
  grading_resume_needed: { label: "Resume needed", cls: "bg-amber-500/15 text-amber-300 border-amber-500/40" },
  trainer_assist_hold: { label: "Trainer assist hold", cls: "bg-shBlue/15 text-shBlue border-shBlue/40" },
  pending_review: { label: "Awaiting review", cls: "bg-shAccent/15 text-shAccent border-shAccent/40" },
};

export default function CheckpointReviewQueue({ onClose, onGraded }) {
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
    setHandlerScores(Object.fromEntries((it.rubric_snapshot?.handler_criteria || []).map(c => [c.id, 3])));
    setDogScores(Object.fromEntries((it.rubric_snapshot?.dog_criteria || []).map(c => [c.id, 3])));
    setFeedback(""); setErr(""); setMode("grade");
    setPrescriptionAction("repeat_current_recipe"); setTemplateId(""); setRefresherLessonId(""); setMinSessions("");
  };

  const back = () => { setActive(null); setErr(""); };

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
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" onClick={onClose} data-testid="checkpoint-review-queue-modal">
      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-3xl max-h-[calc(var(--app-height)_-_2rem)] overflow-y-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-[var(--sh-card-base)] border-b border-shBorder p-5 flex items-center justify-between z-10">
          <div>
            <h3 className="text-xl font-black text-shText uppercase italic tracking-tight">
              <i className="fas fa-video text-shAccent mr-2"/>Checkpoint Reviews
            </h3>
            <p className="text-[14px] text-shTextMuted font-black uppercase tracking-widest mt-1">
              {loading ? "Loading…" : items.length === 0 ? "Inbox zero — nothing pending" : `${items.length} checkpoint${items.length === 1 ? "" : "s"} awaiting your attention`}
            </p>
          </div>
          <button onClick={onClose} className="text-shTextMuted hover:text-shText text-xl" data-testid="checkpoint-review-queue-close">
            <i className="fas fa-times"/>
          </button>
        </div>

        {!active ? (
          <div className="p-5 space-y-3" data-testid="checkpoint-review-queue-list">
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
                        className="w-full text-left bg-[var(--sh-card-base)] border border-shBorder rounded-lg p-4 hover:border-shAccent/40 transition">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className={`text-[12px] font-black uppercase tracking-widest px-2 py-0.5 rounded border ${badge.cls}`} data-testid={`checkpoint-review-item-${idx}-state`}>
                          {badge.label}
                        </span>
                        <span className="text-shTextMuted text-[12px] font-black uppercase tracking-widest">
                          {(it.submitted_at || "").slice(0, 10)} · {(it.submitted_at || "").slice(11, 16)}
                        </span>
                      </div>
                      <p className="text-shText font-black text-[15px] truncate">{it.dog_name} · {it.client_name}</p>
                      <p className="text-shTextMuted text-[13px] truncate mt-0.5">{it.lesson_name}</p>
                      {it.client_note && <p className="text-shTextMuted text-[13px] italic mt-1 truncate">"{it.client_note}"</p>}
                    </div>
                    <i className="fas fa-chevron-right text-shTextMuted"/>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="p-5 space-y-4" data-testid="checkpoint-review-detail-pane">
            <button onClick={back} className="text-[14px] text-shTextMuted hover:text-shSecondary font-black uppercase tracking-widest" data-testid="checkpoint-review-back">
              <i className="fas fa-chevron-left mr-1"/>Back to queue
            </button>

            <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-4">
              <h4 className="text-shText text-lg font-black tracking-tight">{active.dog_name} · {active.client_name}</h4>
              <p className="text-shTextMuted text-[14px] mt-1">{active.lesson_name}</p>
              {active.client_note && (
                <div className="bg-[var(--sh-card-base)]/60 rounded p-3 mt-2 border-l-2 border-shAccent/40">
                  <p className="text-gray-200 text-[14px] italic whitespace-pre-wrap">"{active.client_note}"</p>
                </div>
              )}
            </div>

            {active.homework_id && active.video_media_id && (
              <ReviewVideo homeworkId={active.homework_id} mediaId={active.video_media_id}/>
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
                <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-4 space-y-3">
                  <p className="text-[13px] font-black uppercase tracking-widest text-shSecondary"><i className="fas fa-user mr-1"/>Handler</p>
                  {(active.rubric_snapshot?.handler_criteria || []).map(c => (
                    <ScoreRow key={c.id} criterion={c} value={handlerScores[c.id]} onChange={(v) => setHandlerScores(s => ({ ...s, [c.id]: v }))}/>
                  ))}
                  <p className="text-[13px] font-black uppercase tracking-widest text-shSecondary pt-2"><i className="fas fa-paw mr-1"/>Dog</p>
                  {(active.rubric_snapshot?.dog_criteria || []).map(c => (
                    <ScoreRow key={c.id} criterion={c} value={dogScores[c.id]} onChange={(v) => setDogScores(s => ({ ...s, [c.id]: v }))}/>
                  ))}
                </div>

                <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-4 space-y-3">
                  <p className="text-[13px] font-black uppercase tracking-widest text-shSecondary"><i className="fas fa-comment mr-1"/>Feedback (emailed to the client)</p>
                  <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={3} data-testid="checkpoint-review-feedback"
                            className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm"/>

                  {mode === "prescribe" ? (
                    <div className="space-y-2 border-t border-shBorder/50 pt-3" data-testid="checkpoint-review-prescription-form">
                      <select value={prescriptionAction} onChange={(e) => setPrescriptionAction(e.target.value)} data-testid="checkpoint-review-prescription-action"
                              className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm">
                        <option value="repeat_current_recipe">Repeat current Practice Recipe</option>
                        <option value="assign_recipe">Assign a different Practice Recipe</option>
                        <option value="assign_refresher_lesson">Assign a refresher lesson</option>
                      </select>
                      {prescriptionAction === "assign_recipe" && (
                        <input value={templateId} onChange={(e) => setTemplateId(e.target.value)} placeholder="Homework template id" data-testid="checkpoint-review-template-id"
                               className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm"/>
                      )}
                      {prescriptionAction === "assign_refresher_lesson" && (
                        <input value={refresherLessonId} onChange={(e) => setRefresherLessonId(e.target.value)} placeholder="Refresher lesson id" data-testid="checkpoint-review-refresher-lesson-id"
                               className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm"/>
                      )}
                      <input value={minSessions} onChange={(e) => setMinSessions(e.target.value)} type="number" min="0"
                             placeholder="Minimum practice sessions before resubmit (optional)" data-testid="checkpoint-review-min-sessions"
                             className="w-full bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm"/>
                      <div className="flex gap-2 justify-end pt-2">
                        <button onClick={() => setMode("grade")} className="text-[12px] text-shTextMuted hover:text-shText font-black uppercase tracking-widest px-3 py-2">
                          Back
                        </button>
                        <button onClick={() => grade("prescribe_practice")} disabled={busy} data-testid="checkpoint-review-confirm-prescribe"
                                className="bg-shSecondary text-bgHeader px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest disabled:opacity-50">
                          Confirm Prescription
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2 justify-end pt-2 border-t border-shBorder/50 flex-wrap">
                      <button onClick={() => grade("trainer_assist_recommended")} disabled={busy} data-testid="checkpoint-review-trainer-assist"
                              className="bg-shBlue/15 text-shBlue border border-shBlue/40 px-4 py-2 rounded text-[14px] font-black uppercase tracking-widest hover:bg-shBlue/25 disabled:opacity-50">
                        <i className="fas fa-handshake mr-1"/>Recommend Trainer Assist
                      </button>
                      <button onClick={() => setMode("prescribe")} disabled={busy} data-testid="checkpoint-review-prescribe-practice"
                              className="bg-red-500/15 text-red-300 border border-red-500/40 px-4 py-2 rounded text-[14px] font-black uppercase tracking-widest hover:bg-red-500/25 disabled:opacity-50">
                        <i className="fas fa-rotate-left mr-1"/>Prescribe Practice
                      </button>
                      <button onClick={() => grade("advance")} disabled={busy} data-testid="checkpoint-review-advance"
                              className="bg-shPrimary text-bgHeader px-5 py-2 rounded text-[14px] font-black uppercase tracking-widest hover:bg-shPrimary/80 disabled:opacity-50">
                        <i className="fas fa-check mr-1"/>Advance to Next Lesson
                      </button>
                    </div>
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

function ScoreRow({ criterion, value, onChange }) {
  return (
    <div className="flex items-center justify-between gap-3" data-testid={`checkpoint-review-score-${criterion.id}`}>
      <span className="text-[13px] text-shText">{criterion.name}</span>
      <select value={value ?? 3} onChange={(e) => onChange(parseInt(e.target.value, 10))}
              className="bg-[var(--sh-card-base)] border border-shBorder rounded p-1.5 text-shText text-sm w-16">
        {[0, 1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
      </select>
    </div>
  );
}

function ReviewVideo({ homeworkId, mediaId }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get(`/homework/${homeworkId}/media/${mediaId}`);
        setSrc(data.data || "");
      } catch { /* ignore */ }
    })();
  }, [homeworkId, mediaId]);
  if (!src) return <p className="text-[13px] text-shTextMuted mt-2 font-black uppercase tracking-widest"><i className="fas fa-spinner fa-spin mr-1"/>Loading video…</p>;
  return (
    <div data-testid="checkpoint-review-video">
      <video src={src} controls playsInline className="max-h-72 rounded border border-shBorder w-full"/>
    </div>
  );
}
