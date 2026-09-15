// Training-school expansion, Phases 3-4 — Training Session Workspace.
// Expands the check-in → Training Tracker flow into a full session-planning
// + directions + recording + completion surface, backed by a server-side
// session draft (never local-only browser state) so refresh/re-open always
// resumes the same draft and a resolution screen appears instead of
// guessing when a dog has no/multiple active programs or an empty current
// module. Completing a session is one controlled operation the trainer
// triggers explicitly, with an explicit advancement choice — never
// automatic. This is the ONLY session-recording surface — Pipeline's
// "Log Session" and DogTrainingTab's "Log Session" both open this same
// component (with dogId/enrollmentId instead of bookingId), not a
// second lighter editor. The old TrainingTrackerModal was retired.
//
// UI Phase 2 — visual redesign per CLAUDE_TRAINING_UI_BRIEF.md: the draft/
// autosave/completion pipeline below is UNCHANGED from the pre-redesign
// version; only presentation changed.
//
// Stage 7 (Training Experience Clarity Pass) — the workspace is organised as
// BEFORE (the Stage 6 briefing) → TRAIN (lesson → skills → notes) → WRAP UP
// (client handoff → Practice → next focus → progression → finish). The phase
// is presentation state over the SAME autosaved draft; the completion
// endpoint and its validation stay authoritative, and the readiness panel in
// Wrap Up only mirrors those rules so nothing is a surprise at Finish.

import { useCallback, useEffect, useRef, useState } from "react";
import HandoffPanel from "./HandoffPanel";
import { trainerSaveHandoff } from "../lib/handoff";
import { api, formatErr } from "../lib/api";
import { useAuth } from "../lib/auth";
import { toast } from "sonner";
import DogIdentityHeader from "./training/DogIdentityHeader";
import ExpandableSection from "./training/ExpandableSection";
import SkillLevelIndicator from "./training/SkillLevelIndicator";
import MeasurementChips from "./training/MeasurementChips";
import ActivityCard from "./training/ActivityCard";
import EmptyState from "./training/EmptyState";
import SegmentedOptions from "./training/SegmentedOptions";
import MetricCard from "./training/MetricCard";
import VisibilityBadge from "./training/VisibilityBadge";
import TrainerBriefing from "./training/TrainerBriefing";
import TrainerLessonGuide, { guideFromActivities } from "./training/TrainerLessonGuide";
import { PHASES, completionReadiness, clientHandoffPreview, resumePhase, sessionResultRows, skillRecordState, progressionChoices, advancedActions, confirmationFor, finishHandoff } from "../lib/sessionWrapUp";

const RESOLUTION_COPY = {
  no_active_enrollment: {
    title: "No active training program",
    body: "This dog isn't currently enrolled in a training program. Enroll them from their profile's Training tab first.",
  },
  no_current_module: {
    title: "No current module set",
    body: "This program has no current lesson set yet. Open the dog's Training tab to set one.",
  },
  no_lessons_in_module: {
    title: "Current module is empty",
    body: "The current module has no skills or lessons yet. Add some in Settings → Programs before running a session.",
  },
  no_dog_on_booking: {
    title: "No dog on this booking",
    body: "This booking isn't linked to a dog, so a training session can't be started from it.",
  },
  trainer_unassigned: {
    title: "Trainer not assigned",
    body: "An Admin needs to assign this dog to a trainer for today before the training session starts.",
  },
  assigned_to_other_trainer: {
    title: "Assigned to another trainer",
    body: "This dog is assigned to a different trainer today. Ask an Admin to reassign the dog if you are taking over.",
  },
  enrollment_not_found: {
    title: "Program record not found",
    body: "The selected program record could not be found or is no longer active.",
  },
  current_lesson_requires_resolution: {
    title: "Current lesson needs Admin resolution",
    body: "This School enrollment does not have one valid current lesson. Open the dog's Training tab and set the exact lesson before training continues.",
  },
  legacy_curriculum_requires_migration: {
    title: "Retired legacy curriculum",
    body: "This dog still has an old training-program record. Training is locked until an Admin opens the dog's Training tab and chooses Move into School. The old session history will be preserved.",
  },
};

// Today's assessment of a skill. The original four keys are unchanged so
// existing drafts/logs keep rendering; "introduced" and "reliable" complete
// the six-level scale on the same canonical field.
const OUTCOME_OPTIONS = [
  { key: "skipped", label: "Not Worked", desc: "Did not attempt", color: "bg-gray-500/20 text-shTextMuted border-gray-500/30" },
  { key: "introduced", label: "Introduced", desc: "New today", color: "bg-gray-400/20 text-shText border-gray-400/40" },
  { key: "needs_more_work", label: "Needs Work", desc: "Struggled today", color: "bg-shAccent/20 text-shAccent border-shAccent/40" },
  { key: "improving", label: "Improving", desc: "Better than last time", color: "bg-shSecondary/20 text-shSecondary border-shSecondary/40" },
  { key: "passed", label: "Good", desc: "Solid performance", color: "bg-shPrimary/20 text-shPrimary border-shPrimary/40" },
  { key: "reliable", label: "Reliable", desc: "Met expectations", color: "bg-shPrimary/30 text-shPrimary border-shPrimary/60" },
];


function uid() { return window.crypto?.randomUUID ? window.crypto.randomUUID() : `tmp-${Math.random().toString(36).slice(2)}`; }

export default function TrainingSessionWorkspace({ bookingId, dogId, enrollmentId, resumeDraftId = null, onClose, onSaved, onReviewCheckpoint, manualProgress = null }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [resolution, setResolution] = useState(null);
  const [choices, setChoices] = useState([]);
  const [draft, setDraft] = useState(null);
  const [overview, setOverview] = useState(null);
  const [dog, setDog] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [savingLabel, setSavingLabel] = useState("");
  const [completionResult, setCompletionResult] = useState(null);
  // Stage 10 — Save & Close ends on a handoff that says what it did NOT do
  // (nothing was sent to the client), instead of the modal just vanishing.
  const [savedHandoff, setSavedHandoff] = useState(null);
  const [checkpointBlock, setCheckpointBlock] = useState("");
  // Stage 6/7 — BEFORE (the 60-second briefing) → TRAIN → WRAP UP. Purely a
  // presentation phase over the SAME draft: every phase edits the same
  // autosaved draft, moving between them never loses work, and the backend
  // completion rules stay authoritative (readiness below only mirrors them).
  const [phase, setPhaseState] = useState("before");
  const [saveError, setSaveError] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [showGaps, setShowGaps] = useState(false);
  // Wrap Up choices (formerly the Complete Session modal) — same body sent
  // to the same canonical completion endpoint.
  // Stage 8 — no preselected progression: the trainer makes the choice.
  // (Not persisted on the draft — the backend has no such field and none is
  // added; the choice travels only in the completion body.)
  const [action, setAction] = useState(null);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [assignLessonPractice, setAssignLessonPractice] = useState(true);
  const [sendRecap, setSendRecap] = useState(true);
  const saveTimer = useRef(null);
  const bodyRef = useRef(null);
  const setPhase = useCallback((next) => {
    setPhaseState(next);
    requestAnimationFrame(() => { try { bodyRef.current?.scrollTo({ top: 0, behavior: "auto" }); } catch { /* ignore */ } });
  }, []);
  // A different draft (another dog / program picked from the resolution
  // screen, or a re-used component instance) always starts at the briefing.
  const draftId = draft?.id || null;
  useEffect(() => { if (draftId) setPhaseState("before"); }, [draftId]);
  const latestRef = useRef(null);

  const start = useCallback(async (chosenEnrollmentId) => {
    setLoading(true); setErr("");
    try {
      let data;
      if (bookingId) {
        const res = await api.post(`/bookings/${bookingId}/training-session/draft`, null, {
          params: { enrollment_id: chosenEnrollmentId || undefined },
        });
        data = res.data;
      } else {
        // Stage 11.5 — a specific unfinished draft (an earlier day's) resumes itself
        const res = await api.post(`/dogs/${dogId}/programs/${enrollmentId}/training-session/draft`, null,
          resumeDraftId ? { params: { draft_id: resumeDraftId } } : undefined);
        data = res.data;
      }
      if (data.resolution !== "ready") {
        setResolution(data.resolution);
        setChoices(data.choices || []);
        setLoading(false);
        return;
      }
      setResolution("ready");
      setDraft(data.draft);
      setOverview(data.overview);
      setDog(data.dog);
    } catch (e) {
      setErr(formatErr(e?.response?.data?.detail) || "Failed to start training session");
    }
    setLoading(false);
  }, [bookingId, dogId, enrollmentId, resumeDraftId]);

  useEffect(() => { start(); }, [start]);

  // Debounced autosave — the draft on the server is the source of truth;
  // this never relies on the browser tab staying open.
  const scheduleSave = useCallback((nextDraft) => {
    latestRef.current = nextDraft;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const d = latestRef.current;
      if (!d) return;
      setSavingLabel("Saving…");
      try {
        await api.put(`/training-session-drafts/${d.id}`, {
          plan: d.plan.activities,
          actuals: d.actuals,
          session_note: d.session_note,
          client_recap_note: d.client_recap_note,
          what_went_well: d.what_went_well,
          needs_work: d.needs_work,
          next_lesson_focus: d.next_lesson_focus,
          practice_note: d.practice_note,
        });
        setSavingLabel("Saved");
        setSaveError(false);
        setTimeout(() => setSavingLabel(""), 1500);
      } catch (e) {
        setSavingLabel("");
        setSaveError(true);
        toast.error(formatErr(e?.response?.data?.detail) || "Autosave failed");
      }
    }, 800);
  }, []);
  // A failed autosave stays visible until a retry succeeds — the trainer must
  // never assume work is saved when it is not.
  const retrySave = useCallback(() => { if (latestRef.current) scheduleSave(latestRef.current); }, [scheduleSave]);
  // Finish must never race the debounce: write whatever is pending first.
  const flushSave = useCallback(async () => {
    if (!saveTimer.current || !latestRef.current) return true;
    clearTimeout(saveTimer.current); saveTimer.current = null;
    const d = latestRef.current;
    try {
      await api.put(`/training-session-drafts/${d.id}`, {
        plan: d.plan.activities, actuals: d.actuals, session_note: d.session_note, client_recap_note: d.client_recap_note,
        what_went_well: d.what_went_well, needs_work: d.needs_work, next_lesson_focus: d.next_lesson_focus, practice_note: d.practice_note,
      });
      setSavingLabel("Saved"); setSaveError(false);
      return true;
    } catch (e) {
      setSaveError(true);
      toast.error(formatErr(e?.response?.data?.detail) || "Could not save the session before finishing");
      return false;
    }
  }, []);

  const updateDraft = (patch) => {
    setDraft(d => {
      const next = typeof patch === "function" ? patch(d) : { ...d, ...patch };
      scheduleSave(next);
      return next;
    });
  };

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const activities = draft?.plan?.activities || [];
  const setActivities = (next) => updateDraft(d => ({ ...d, plan: { ...d.plan, activities: next } }));

  const moveActivity = (id, dir) => {
    const i = activities.findIndex(a => a.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= activities.length) return;
    const next = [...activities];
    [next[i], next[j]] = [next[j], next[i]];
    setActivities(next.map((a, idx) => ({ ...a, order: idx })));
  };
  const removeActivity = (id) => setActivities(activities.filter(a => a.id !== id));
  const toggleSkip = (id) => setActivities(activities.map(a => a.id === id ? { ...a, skipped: !a.skipped, skip_reason: a.skipped ? "" : a.skip_reason } : a));
  const setSkipReason = (id, reason) => setActivities(activities.map(a => a.id === id ? { ...a, skip_reason: reason } : a));
  const addCustomActivity = () => {
    const a = { id: uid(), source: "custom", name: "New activity", order: activities.length, skipped: false, skip_reason: "" };
    setActivities([...activities, a]);
    setExpandedId(a.id);
  };

  // `patch` may be a plain object or a function of the previous actual —
  // the metric cards compose display values from prior state, so they must
  // patch against the LATEST actual, not a render-scope snapshot (two
  // quick edits inside one render frame would otherwise drop the first).
  const setActual = (activityId, patch) => {
    updateDraft(d => {
      const prev = d.actuals[activityId] || {};
      const resolved = typeof patch === "function" ? patch(prev) : patch;
      return { ...d, actuals: { ...d.actuals, [activityId]: { ...prev, ...resolved } } };
    });
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" data-testid="training-session-workspace">
        <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl p-8 text-shTextMuted text-sm">
          <i className="fas fa-spinner fa-spin mr-2"/>Preparing session workspace…
        </div>
      </div>
    );
  }

  if (err) {
    return (
      <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" data-testid="training-session-workspace">
        <div className="bg-[var(--sh-card-base)] border border-red-500/40 rounded-2xl p-6 max-w-md text-red-300">
          <p className="font-black uppercase tracking-widest text-[12px] mb-2">Couldn&apos;t open workspace</p>
          <p className="text-sm">{err}</p>
          <button onClick={onClose} className="mt-4 text-shSecondary font-black uppercase text-[12px] tracking-widest">Close</button>
        </div>
      </div>
    );
  }

  if (resolution === "multiple_active_enrollments") {
    return (
      <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" data-testid="training-session-workspace-resolution">
        <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl p-6 max-w-md w-full">
          <p className="text-[11px] font-black uppercase tracking-widest text-shAccent mb-2">Multiple active programs</p>
          <p className="text-sm text-shTextMuted mb-4">This dog is enrolled in more than one active program. Pick which one for today&apos;s session:</p>
          <div className="space-y-2">
            {choices.map(ch => (
              <button key={ch.enrollment_id} onClick={() => start(ch.enrollment_id)}
                      data-testid={`resolve-enrollment-${ch.enrollment_id}`}
                      className="w-full text-left bg-black/20 border border-shBorder hover:border-shPrimary rounded p-3 transition">
                <p className="text-sm font-black text-shText">{ch.program_name}</p>
                {ch.current_week && <p className="text-[12px] text-shTextMuted">Week {ch.current_week}</p>}
              </button>
            ))}
          </div>
          <button onClick={onClose} className="mt-4 text-shTextMuted hover:text-shText font-black uppercase text-[12px] tracking-widest">Cancel</button>
        </div>
      </div>
    );
  }

  if (resolution && resolution !== "ready") {
    const copy = RESOLUTION_COPY[resolution] || { title: "Can't start session", body: "This dog isn't ready for a training session right now." };
    return (
      <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" data-testid="training-session-workspace-resolution">
        <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl p-6 max-w-md">
          <p className="text-[11px] font-black uppercase tracking-widest text-shAccent mb-2">{copy.title}</p>
          <p className="text-sm text-shTextMuted">{copy.body}</p>
          <button onClick={onClose} data-testid="workspace-resolution-close" className="mt-4 text-shSecondary font-black uppercase text-[12px] tracking-widest">Close</button>
        </div>
      </div>
    );
  }

  if (!draft) return null;

  const briefing = overview?.briefing || null;
  const canAssignLessonPractice = !!overview?.current_lesson_practice?.configured && overview?.current_lesson_practice?.available !== false;
  const isFinalLesson = !!overview?.is_final_lesson;
  const readiness = completionReadiness(draft, { sendRecap, action, reason,
    practice: { configured: !!overview?.current_lesson_practice?.configured, assigned: canAssignLessonPractice && assignLessonPractice } });
  const preview = clientHandoffPreview(draft, overview, { assignPractice: canAssignLessonPractice && assignLessonPractice, sendRecap });
  const resultRows = sessionResultRows(draft);
  const trainDone = !readiness.missing.some((m) => m.phase === "train");
  const checkpoint = briefing?.checkpoint || null;
  const lessonName = overview?.current_lesson_name || briefing?.today?.lesson_name || "";
  const lessonMeta = [overview?.program_name, briefing?.today?.training_mode === "hybrid" ? "Hybrid" : briefing?.today?.training_mode === "in_person" ? "Trainer-Led" : null,
    briefing?.today?.lesson_number && briefing?.today?.lesson_count ? `Lesson ${briefing.today.lesson_number} of ${briefing.today.lesson_count}` : null].filter(Boolean).join(" · ");
  const completed = draft.status === "completed" || draft.status === "completing" || !!completionResult;

  const goTo = (item) => {
    if (!item) return;
    setPhase(item.phase);
    const m = /^activity-(.+)$/.exec(item.target || "");
    if (m) setExpandedId(m[1]);
    setTimeout(() => {
      const el = bodyRef.current?.querySelector(`[data-testid="${item.target}"]`);
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "auto" });
        const input = el.matches("textarea,input,select") ? el : el.querySelector("textarea,input,select");
        input?.focus?.({ preventScroll: true });
      }
    }, 120);
  };

  const startLesson = () => setPhase(resumePhase(draft));

  const confirmation = action ? confirmationFor(action, { dogName: dog?.name || "the dog", lessonName: lessonName || "this lesson" }) : null;
  const saveAndClose = async () => {
    const ok = await flushSave();
    if (!ok) return; // the red retry chip stays; nothing is lost
    setSavedHandoff(trainerSaveHandoff({ dogName: dog?.name || null }));
  };

  const finish = async ({ confirmed = false } = {}) => {
    if (!readiness.ready) { setShowGaps(true); goTo(readiness.missing[0]); return; }
    if (confirmation && !confirmed) { setConfirming(true); return; }
    setConfirming(false);
    setFinishing(true);
    try {
      if (!(await flushSave())) return;
      const { data } = await api.post(`/training-session-drafts/${draft.id}/complete`, {
        advancement_action: action,
        advancement_reason: reason.trim() || null,
        assign_lesson_practice: canAssignLessonPractice ? assignLessonPractice : false,
        send_recap: sendRecap,
      });
      setCompletionResult(data);
      setCheckpointBlock("");
      // Stage 10 — the result is the handoff panel below; no success toast on top of it.
    } catch (e) {
      // lib/api.js flattens object details to a string and keeps the object
      // on detail_object — read the structured one first.
      const detail = e?.response?.data?.detail_object || e?.response?.data?.detail;
      // The checkpoint gate is a curriculum rule, not a glitch — say exactly
      // what is blocking and what to do, and keep the workspace open so
      // nothing the trainer recorded is lost.
      if (detail?.error_code === "checkpoint_required_before_advancement") {
        setCheckpointBlock(detail.message);
        return;
      }
      if (detail?.error_code === "lesson_assessment_incomplete") {
        const missing = (detail.missing || []).join(" · ");
        setCheckpointBlock(`${detail.message}${missing ? ` ${missing}` : ""}`);
        return;
      }
      if (detail?.code === "session_completion_incomplete") {
        setCheckpointBlock(detail.msg || detail.message || "Finish the required trainer record before completing this session.");
        return;
      }
      toast.error(formatErr(detail) || "Could not finish the session");
    } finally {
      setFinishing(false);
    }
  };

  const nextChoices = progressionChoices({ isFinalLesson, isAdmin, checkpoint, dogName: dog?.name || "the dog", trainingMode: briefing?.today?.training_mode || null });
  const advanced = advancedActions({ isAdmin, isFinalLesson });
  const needsReason = action === "skip_lesson";

  const saveState = saveError
    ? <button type="button" onClick={retrySave} data-testid="workspace-save-error" className="text-[11px] font-black uppercase tracking-widest text-red-300 border border-red-400/50 rounded-lg px-2 min-h-[36px]"><i className="fas fa-triangle-exclamation mr-1" aria-hidden="true" />Not saved · Retry</button>
    : savingLabel ? <span className="text-[11px] text-shTextMuted" data-testid="workspace-save-state" aria-live="polite">{savingLabel}</span> : null;

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-2 sm:p-4" data-testid="training-session-workspace" data-phase={phase}>
      <div className={`bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full ${phase === "train" ? "max-w-5xl" : "max-w-3xl"} max-h-[calc(var(--app-height)_-_1rem)] flex flex-col min-h-0 shadow-2xl`}>
        {/* Shell header — dog, where we are, save state, close. */}
        <div className="sh-school-splash overflow-hidden px-4 sm:px-6 pt-3 pb-2 border-b border-shPrimary/30 shrink-0 bg-gradient-to-r from-shPrimary/[0.16] via-shSecondary/[0.10] to-transparent rounded-t-2xl">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <DogIdentityHeader dogName={dog?.name} dogPhoto={dog?.photo} breadcrumb={lessonMeta} testid="workspace-dog-header"/>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {saveState}
              <button onClick={onClose} data-testid="workspace-close" aria-label="Close" className="text-shTextMuted hover:text-shText text-xl px-2 min-h-[44px]"><i className="fas fa-times" aria-hidden="true" /></button>
            </div>
          </div>
          <nav className="mt-2 grid grid-cols-3 gap-1" aria-label="Session phase" data-testid="phase-nav">
            {PHASES.map((p, i) => {
              const current = phase === p.key;
              const done = (p.key === "before" && phase !== "before") || (p.key === "train" && trainDone && phase === "wrap") || (p.key === "wrap" && completed);
              return (
                <button key={p.key} type="button" onClick={() => setPhase(p.key)} aria-current={current ? "step" : undefined}
                        data-testid={`phase-nav-${p.key}`} data-done={done ? "1" : undefined}
                        className={`min-h-[48px] rounded-xl border px-1.5 sm:px-2 text-left transition ${current ? "border-shPrimary bg-shPrimary/15 text-shText" : done ? "border-shPrimary/40 text-shPrimary" : "border-shBorder/60 text-shTextMuted hover:text-shText"}`}>
                  <span className="block text-[10px] font-black uppercase tracking-[0.1em] sm:tracking-[0.14em] whitespace-nowrap"><i className={`fas ${done && !current ? "fa-check" : p.icon} mr-1`} aria-hidden="true" /><span className="hidden sm:inline">{i + 1}. </span>{p.label}</span>
                  <span className="hidden sm:block text-[11px] leading-tight opacity-80">{p.hint}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div ref={bodyRef} className="overflow-y-auto flex-1 min-h-0 flex flex-col">
          {savedHandoff && (
            <div className="px-4 sm:px-6 py-4" data-testid="workspace-saved-wrap">
              <HandoffPanel handoff={savedHandoff} testid="workspace-saved"
                            onAction={() => { onSaved?.(draft); onClose(); }} onSecondary={() => setSavedHandoff(null)} />
            </div>
          )}
          {/* ============================ BEFORE ============================ */}
          {!savedHandoff && phase === "before" && (
            briefing ? (
              <TrainerBriefing embedded briefing={briefing} dog={dog} draft={draft} onStart={startLesson} onReviewCheckpoint={onReviewCheckpoint} onClose={onClose}/>
            ) : (
              <div className="p-6 text-shTextMuted text-sm">No briefing is available for this session.
                <button type="button" onClick={() => setPhase("train")} className="ml-2 text-shPrimary font-black uppercase text-[12px] tracking-widest">Go to Train</button>
              </div>
            )
          )}

          {/* ============================ TRAIN ============================= */}
          {!savedHandoff && phase === "train" && (
            <div className="px-4 sm:px-6 py-4 space-y-4 lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-5 lg:space-y-0" data-testid="workspace-train">
              <div className="space-y-4 min-w-0">
                <section className="rounded-2xl border border-shPrimary/35 bg-shPrimary/[0.06] px-4 py-3.5" data-testid="train-lesson">
                  <p className="text-[11px] font-black uppercase tracking-[0.16em] text-shPrimary"><i className="fas fa-calendar-day mr-1.5" aria-hidden="true" />{checkpoint ? "Today's checkpoint lesson" : "Today's lesson"}</p>
                  <h2 className="text-[22px] sm:text-[24px] font-black text-shText leading-tight mt-0.5">{lessonName || "Lesson"}</h2>
                  {briefing?.today?.objective && <p className="text-[15px] text-shText mt-1"><span className="text-shTextMuted">Objective · </span>{briefing.today.objective}</p>}
                  {briefing?.focus?.text && <p className="text-[14px] text-shTextMuted mt-1"><span className="font-black text-shSecondary">Focus · </span>{briefing.focus.text}</p>}
                  {checkpoint && (
                    <p className="mt-2 rounded-lg border border-shAccent/40 bg-shAccent/[0.08] px-3 py-2 text-[13px] text-shText" data-testid="train-checkpoint" data-state={checkpoint.state}>
                      <i className="fas fa-flag-checkered mr-1.5 text-shAccent" aria-hidden="true" /><b>{checkpoint.label}.</b> {checkpoint.detail}
                    </p>
                  )}
                </section>

                <section data-testid="train-skills">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-[0.16em] text-shTextMuted"><i className="fas fa-bullseye mr-1.5" aria-hidden="true" />Skills · {activities.length}</p>
                      <p className="text-[12px] text-shTextMuted mt-0.5">Tap a skill to record how it went. <span className="text-shAccent font-bold">Required before finishing</span> marks what the session needs.</p>
                    </div>
                    <button onClick={addCustomActivity} data-testid="add-custom-activity" className="text-[11px] text-shPrimary font-black uppercase tracking-widest min-h-[40px] px-2"><i className="fas fa-plus mr-1" aria-hidden="true" />Extra activity</button>
                  </div>
                  <div className="space-y-2">
                    {activities.length === 0 && (
                      <EmptyState icon="fa-list-check" message="No activities planned. Add one above." testid="workspace-no-activities"/>
                    )}
                    {activities.map((a, i) => {
                      const st = skillRecordState(a, draft.actuals?.[a.id] || {});
                      const badge = st.skipped ? null
                        : st.required && !st.complete ? <span className="text-[10px] font-black uppercase tracking-widest text-shAccent border border-shAccent/40 rounded px-1.5 py-0.5 shrink-0" data-testid={`activity-${a.id}-required`}>Required before finishing</span>
                        : st.recorded ? <span className="text-[10px] font-black uppercase tracking-widest text-shPrimary border border-shPrimary/40 rounded px-1.5 py-0.5 shrink-0" data-testid={`activity-${a.id}-recorded`}><i className="fas fa-check mr-1" aria-hidden="true" />Recorded</span>
                        : null;
                      return (
                        <ActivityCard key={a.id} activity={a} index={i} total={activities.length}
                                       expanded={expandedId === a.id}
                                       onToggleExpand={() => setExpandedId(expandedId === a.id ? null : a.id)}
                                       onMove={(dir) => moveActivity(a.id, dir)}
                                       onRemove={() => removeActivity(a.id)}
                                       onToggleSkip={() => toggleSkip(a.id)}
                                       onSkipReason={(r) => setSkipReason(a.id, r)}
                                       locked={!!a.required_curriculum && !isAdmin}
                                       badge={badge}
                                       testid={`activity-${a.id}`}>
                          <ActivityDetail activity={a} actual={draft.actuals?.[a.id] || {}} onActualChange={(patch) => setActual(a.id, patch)}/>
                        </ActivityCard>
                      );
                    })}
                  </div>
                </section>

                <section className="rounded-2xl border border-shAccent/30 bg-shAccent/[0.04] p-3.5" data-testid="train-session-notes">
                  <label htmlFor="workspace-session-note" className="text-[11px] font-black uppercase tracking-widest text-shAccent"><i className="fas fa-lock mr-1" aria-hidden="true" />Trainer notes</label>
                  <p className="text-[12px] text-shTextMuted mt-0.5">Staff only — clients will not see this. Handling notes, what to try next time, anything private.</p>
                  <textarea id="workspace-session-note" value={draft.session_note || ""} onChange={(e) => updateDraft({ session_note: e.target.value })}
                            rows={3} data-testid="workspace-session-note" placeholder="Private trainer note · never shown to the client"
                            className="w-full mt-2 bg-black/20 border border-shBorder rounded-lg p-2.5 text-shText text-[14px]"/>
                </section>
              </div>

              {/* Not an <aside>: index.css styles every <aside> as the admin
                  sidebar (decorative ::before/::after) which widened this
                  column past the phone viewport. */}
              <div role="complementary" aria-label="Lesson guide" className="min-w-0 lg:sticky lg:top-0 lg:self-start">
                <TrainerLessonGuide guide={overview?.current_lesson_guide || guideFromActivities(activities, briefing, overview)} checkpointState={checkpoint}/>
              </div>
            </div>
          )}

          {/* ============================ WRAP UP =========================== */}
          {!savedHandoff && phase === "wrap" && (
            <div className="px-4 sm:px-6 py-4 space-y-4" data-testid="workspace-wrap">
              {completionResult && (
                <div className="space-y-2" data-testid="workspace-completion-summary">
                  {/* Stage 10 — RESULT · NEXT TRAINING STEP · Return to Training, all from
                      the completion response (finishHandoff). `workspace-next-training-step`
                      is the NEXT block and still carries data-status. */}
                  <HandoffPanel handoff={finishHandoff(completionResult, { previousLessonName: lessonName, dogName: dog?.name || null, sendRecap })}
                                testid="workspace-finished" ids={{ next: "workspace-next-training-step", action: "workspace-close-after-complete" }}
                                status={completionResult.enrollment?.status || ""}
                                onAction={() => { onSaved?.(draft); onClose(); }} />
                  {completionResult.homework_conflicts?.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-shPrimary/20" data-testid="workspace-homework-conflicts">
                      <p className="text-[11px] font-black uppercase tracking-widest text-shAccent">Practice not created — the client already has this Practice open</p>
                      {completionResult.homework_conflicts.map((c, i) => (
                        <p key={i} className="text-[12px] text-shTextMuted">&ldquo;{c.existing_title}&rdquo; is still {c.existing_status} — skipped to avoid a duplicate.</p>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {!completionResult && (
                <>
                  <section className="rounded-2xl border border-shPrimary/30 bg-shPrimary/[0.04] p-3.5 space-y-3" data-testid="wrap-client-handoff">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className="text-[11px] font-black uppercase tracking-[0.16em] text-shPrimary"><i className="fas fa-comment-dots mr-1.5" aria-hidden="true" />What happened — the client reads this</p>
                      <VisibilityBadge/>
                    </div>
                    <div>
                      <label htmlFor="workspace-what-went-well" className="text-[12px] font-black text-shText">What went well <RequiredTag/></label>
                      <textarea id="workspace-what-went-well" value={draft.what_went_well || ""} onChange={(e) => updateDraft({ what_went_well: e.target.value })}
                                rows={2} data-testid="workspace-what-went-well" placeholder="Wins from this lesson…" aria-invalid={showGaps && !String(draft.what_went_well || "").trim() ? "true" : undefined}
                                className="w-full mt-1 bg-black/20 border border-shBorder rounded-lg p-2.5 text-shText text-[14px]"/>
                    </div>
                    <div>
                      <label htmlFor="workspace-needs-work" className="text-[12px] font-black text-shText">Needs work <RequiredTag/></label>
                      <textarea id="workspace-needs-work" value={draft.needs_work || ""} onChange={(e) => updateDraft({ needs_work: e.target.value })}
                                rows={2} data-testid="workspace-needs-work" placeholder="Weak areas, extra reps…" aria-invalid={showGaps && !String(draft.needs_work || "").trim() ? "true" : undefined}
                                className="w-full mt-1 bg-black/20 border border-shBorder rounded-lg p-2.5 text-shText text-[14px]"/>
                    </div>
                    <div>
                      <label htmlFor="workspace-recap-note" className="text-[12px] font-black text-shText">Client recap {sendRecap ? <RequiredTag/> : <span className="text-[10px] font-bold text-shTextMuted uppercase tracking-widest">optional</span>}</label>
                      <p className="text-[12px] text-shTextMuted">Client recap note · the owner reads this on their Today screen and in Coach.</p>
                      <textarea id="workspace-recap-note" value={draft.client_recap_note || ""} onChange={(e) => updateDraft({ client_recap_note: e.target.value })}
                                rows={3} data-testid="workspace-recap-note" placeholder="A few friendly lines for the owner…" aria-invalid={showGaps && sendRecap && !String(draft.client_recap_note || "").trim() ? "true" : undefined}
                                className="w-full mt-1 bg-black/20 border border-shPrimary/30 rounded-lg p-2.5 text-shText text-[14px]"/>
                      <label className="flex items-center gap-2 text-[13px] text-shText mt-2 min-h-[32px]">
                        <input type="checkbox" checked={sendRecap} onChange={(e) => setSendRecap(e.target.checked)} data-testid="wrap-send-recap"/>
                        Send the recap to the client
                      </label>
                    </div>
                  </section>

                  <section className="rounded-2xl border border-shSecondary/30 bg-shSecondary/[0.04] p-3.5" data-testid="wrap-practice">
                    <p className="text-[11px] font-black uppercase tracking-[0.16em] text-shSecondary"><i className="fas fa-house-chimney-user mr-1.5" aria-hidden="true" />Practice at home</p>
                    {overview?.current_lesson_practice?.configured ? (
                      overview.current_lesson_practice.available === false ? (
                        <p className="text-[13px] text-shAccent mt-1">This lesson points to a Practice recipe that no longer exists. Fix the lesson in Program Studio; the session can still be finished without Practice.</p>
                      ) : (
                        <>
                          <p className="text-[15px] font-black text-shText mt-1">{overview.current_lesson_practice.title || "Lesson Practice"}</p>
                          {overview.current_lesson_practice.description && <p className="text-[13px] text-shTextMuted mt-0.5">{overview.current_lesson_practice.description}</p>}
                          <p className="text-[12px] text-shTextMuted mt-1">
                            {briefing?.today?.training_mode === "hybrid"
                              ? "Hybrid: the client already has this lesson's Practice online — finishing links this session to it instead of creating a second copy."
                              : "Comes from the lesson itself — finishing the session sends it to the client."}
                          </p>
                          <label className="flex items-start gap-2 text-[14px] text-shText mt-2 min-h-[32px]">
                            <input type="checkbox" className="mt-1" checked={assignLessonPractice} onChange={(e) => setAssignLessonPractice(e.target.checked)} data-testid="wrap-assign-practice"/>
                            <span>Send this lesson's Practice<span className="block text-[12px] text-shTextMuted">Turn it off only when the client should not practise this lesson yet.</span></span>
                          </label>
                          {!assignLessonPractice && (
                            <p className="mt-2 rounded-lg border border-shAccent/40 bg-shAccent/[0.07] px-2.5 py-1.5 text-[11px] font-black uppercase tracking-widest text-shAccent" data-testid="complete-session-practice-withheld">
                              <i className="fas fa-hand mr-1.5" aria-hidden="true" />Practice withheld for this visit
                            </p>
                          )}
                          {assignLessonPractice && (
                            <>
                              <label htmlFor="workspace-practice-note" className="block text-[12px] font-black text-shText mt-3">Note for the client's Practice <span className="text-[10px] font-bold text-shTextMuted uppercase tracking-widest">optional</span></label>
                              <textarea id="workspace-practice-note" value={draft.practice_note || ""} onChange={(e) => updateDraft({ practice_note: e.target.value })}
                                        rows={2} data-testid="workspace-practice-note" placeholder="e.g. Keep the leash loose and reset calmly if the dog gets up."
                                        className="w-full mt-1 bg-black/20 border border-shBorder rounded-lg p-2.5 text-shText text-[14px]"/>
                            </>
                          )}
                        </>
                      )
                    ) : (
                      <p className="text-[13px] text-shTextMuted mt-1">No home Practice is configured for this lesson, so finishing will not send any.</p>
                    )}
                  </section>

                  <section className="rounded-2xl border border-shSecondary/40 bg-shSecondary/[0.06] p-3.5" data-testid="wrap-next-focus">
                    <label htmlFor="workspace-next-lesson-focus" className="text-[11px] font-black uppercase tracking-[0.16em] text-shSecondary"><i className="fas fa-crosshairs mr-1.5" aria-hidden="true" />Next lesson focus <RequiredTag/></label>
                    <p className="text-[13px] text-shText mt-0.5">What should the next trainer focus on? This opens the next briefing and the client sees it as their next focus.</p>
                    <textarea id="workspace-next-lesson-focus" value={draft.next_lesson_focus || ""} onChange={(e) => updateDraft({ next_lesson_focus: e.target.value })}
                              rows={2} data-testid="workspace-next-lesson-focus" placeholder="e.g. Door distractions — hold Place while the door opens." aria-invalid={showGaps && !String(draft.next_lesson_focus || "").trim() ? "true" : undefined}
                              className="w-full mt-2 bg-black/20 border border-shSecondary/40 rounded-lg p-2.5 text-shText text-[15px] font-semibold"/>
                  </section>

                  <section className="rounded-2xl border border-shBorder/60 bg-black/15 p-3.5" data-testid="wrap-session-result">
                    <p className="text-[11px] font-black uppercase tracking-[0.16em] text-shTextMuted"><i className="fas fa-clipboard-check mr-1.5" aria-hidden="true" />Session result</p>
                    <ul className="mt-2 space-y-1">
                      {resultRows.map((r) => (
                        <li key={r.id} className="flex items-center justify-between gap-3 text-[14px]" data-testid={`result-${r.id}`}>
                          <span className="text-shText font-bold min-w-0 truncate">{r.name}</span>
                          <span className="text-[13px] text-shTextMuted shrink-0">
                            {r.skipped ? "Skipped" : [r.score != null ? `${r.score}/5` : null, r.outcome, r.mastery].filter(Boolean).join(" · ") || (r.required ? "Not recorded" : "—")}
                            {r.required && !r.complete && <button type="button" onClick={() => goTo({ phase: "train", target: `activity-${r.id}` })} className="ml-2 text-shAccent font-black uppercase text-[10px] tracking-widest">Record</button>}
                          </span>
                        </li>
                      ))}
                      {resultRows.length === 0 && <li className="text-[13px] text-shTextMuted">No skills on this session.</li>}
                    </ul>
                  </section>

                  <section className="rounded-2xl border border-shPrimary/35 bg-shPrimary/[0.04] p-3.5" data-testid="wrap-next-step">
                    <p className="text-[11px] font-black uppercase tracking-[0.16em] text-shPrimary"><i className="fas fa-route mr-1.5" aria-hidden="true" />What should happen next?</p>
                    <p className="text-[13px] text-shTextMuted mt-0.5">Finishing always saves today&apos;s session. This only decides {dog?.name || "the dog"}&apos;s next lesson.</p>
                    <div className="mt-2 grid grid-cols-1 lg:grid-cols-3 gap-2" role="radiogroup" aria-label="What should happen next" data-testid="progression-choices">
                      {nextChoices.map((c) => {
                        const selected = action === c.key;
                        return (
                          <button key={c.key} type="button" role="radio" aria-checked={selected} aria-disabled={!c.enabled || undefined}
                                  onClick={() => { if (c.enabled) setAction(c.key); }} data-testid={`advancement-${c.key}`} data-locked={c.enabled ? undefined : "1"}
                                  className={`text-left rounded-xl border px-3 py-3 min-h-[64px] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-shSecondary ${!c.enabled ? "border-shBorder/50 bg-black/10 text-shTextMuted cursor-not-allowed" : selected ? "border-shPrimary bg-shPrimary/15 text-shText" : "border-shBorder text-shText hover:border-shPrimary/60"}`}>
                            <span className="flex items-center gap-2">
                              <i className={`fas ${selected ? "fa-circle-check text-shPrimary" : c.enabled ? "fa-circle text-shTextMuted" : "fa-lock text-shTextMuted"} text-[14px]`} aria-hidden="true" />
                              <span className="text-[15px] font-black uppercase tracking-wide">{c.enabled ? c.title : (c.lockedTitle || c.title)}</span>
                              {selected && <span className="ml-auto text-[10px] font-black uppercase tracking-widest text-shPrimary">Selected</span>}
                            </span>
                            <span className="block text-[13px] mt-1 leading-snug opacity-90">{c.enabled ? c.body : c.lockedBody}</span>
                          </button>
                        );
                      })}
                    </div>
                    {(action === "assign_review") && (
                      <div className="mt-3">
                        <label htmlFor="advancement-reason" className="text-[12px] font-black text-shText">What needs reviewing? <span className="text-[10px] font-bold text-shTextMuted uppercase tracking-widest">optional</span></label>
                        <input id="advancement-reason" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="advancement-reason" placeholder="e.g. Unsure whether the stay is solid enough to move on."
                               className="w-full mt-1 bg-black/20 border border-shBorder rounded-lg p-2.5 text-shText text-[14px]"/>
                      </div>
                    )}
                    {(isAdmin || manualProgress || advanced.length > 0) && (
                      <details className="mt-3 rounded-xl border border-shBorder/60 bg-black/10 p-3" data-testid="advanced-progression">
                        <summary className="cursor-pointer text-[11px] font-black uppercase tracking-widest text-shTextMuted min-h-[32px] flex items-center">Advanced progression actions</summary>
                        <p className="text-[12px] text-shTextMuted mt-1 mb-2">Exceptional moves only. These are not part of an ordinary lesson.</p>
                        <div className="space-y-1.5" role="radiogroup" aria-label="Advanced progression actions" data-testid="admin-advancement-overrides">
                          {advanced.map((opt) => (
                            <button key={opt.key} type="button" role="radio" aria-checked={action === opt.key} onClick={() => setAction(opt.key)} data-testid={`advancement-${opt.key}`} data-admin={opt.admin ? "1" : undefined}
                                    className={`w-full text-left px-3 py-2 rounded-xl border min-h-[44px] focus:outline-none focus-visible:ring-2 focus-visible:ring-shSecondary ${action === opt.key ? "bg-shAccent/15 border-shAccent text-shText" : "border-shBorder text-shTextMuted"}`}>
                              <p className="text-[13px] font-bold">{opt.label}{opt.admin && <span className="ml-2 text-[10px] font-black uppercase tracking-widest text-shAccent">Admin</span>}</p>
                              <p className="text-[11px] opacity-80">{opt.meaning}</p>
                            </button>
                          ))}
                        </div>
                        {manualProgress && (
                          <button type="button" onClick={manualProgress.open} data-testid="in-person-manual-progress-open"
                                  className="mt-2 w-full text-left px-3 py-2 rounded-xl border border-shSecondary/50 min-h-[44px] text-shText">
                            <p className="text-[13px] font-bold"><i className="fas fa-forward-step mr-1.5 text-shSecondary" aria-hidden="true" />Move dog to a later lesson</p>
                            <p className="text-[11px] text-shTextMuted">Trainer-Led only — changes the School position outside this session.</p>
                          </button>
                        )}
                        {(needsReason || action === "reopen_previous_lesson") && (
                          <div className="mt-3">
                            <label htmlFor="advancement-reason" className="text-[12px] font-black text-shText">Reason {needsReason ? <RequiredTag/> : <span className="text-[10px] font-bold text-shTextMuted uppercase tracking-widest">optional</span>}</label>
                            <input id="advancement-reason" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="advancement-reason" aria-invalid={showGaps && needsReason && !reason.trim() ? "true" : undefined}
                                   className="w-full mt-1 bg-black/20 border border-shBorder rounded-lg p-2.5 text-shText text-[14px]"/>
                          </div>
                        )}
                      </details>
                    )}
                  </section>

                  <section className="rounded-2xl border border-shPrimary/35 bg-black/15 p-3.5" data-testid="wrap-client-preview">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className="text-[11px] font-black uppercase tracking-[0.16em] text-shPrimary"><i className="fas fa-eye mr-1.5" aria-hidden="true" />Client will see</p>
                      <span className="text-[11px] text-shTextMuted">Trainer notes stay private.</span>
                    </div>
                    <dl className="mt-2 space-y-1.5 text-[14px]">
                      <PreviewRow label="What went well" value={preview.wentWell}/>
                      <PreviewRow label="Keep working on" value={preview.needsWork}/>
                      <PreviewRow label="From your trainer" value={preview.recap}/>
                      <PreviewRow label="Practice" value={preview.practice ? `${preview.practice.title}${preview.practice.note ? ` — ${preview.practice.note}` : ""}` : "No Practice this visit"}/>
                      <PreviewRow label="Next focus" value={preview.nextFocus}/>
                      {preview.observations.map((o) => <PreviewRow key={o.name} label={o.name} value={o.text}/>)}
                    </dl>
                  </section>

                  <section className={`rounded-2xl border p-3.5 ${readiness.ready ? "border-shPrimary/50 bg-shPrimary/[0.06]" : "border-shAccent/50 bg-shAccent/[0.05]"}`} data-testid="wrap-readiness" data-ready={readiness.ready ? "1" : "0"} aria-live="polite">
                    <p className={`text-[12px] font-black uppercase tracking-[0.16em] ${readiness.ready ? "text-shPrimary" : "text-shAccent"}`}>
                      <i className={`fas ${readiness.ready ? "fa-circle-check" : "fa-list-check"} mr-1.5`} aria-hidden="true" />
                      {readiness.ready ? "Ready to finish" : `${readiness.missing.length} thing${readiness.missing.length === 1 ? "" : "s"} left`}
                    </p>
                    <ul className="mt-2 space-y-1 text-[14px]">
                      {readiness.done.map((d) => (
                        <li key={d.key} className={d.ok ? "text-shText" : "text-shTextMuted"}><i className={`fas ${d.ok ? "fa-check text-shPrimary" : "fa-circle text-[7px] align-middle text-shAccent"} mr-2`} aria-hidden="true" />{d.label}</li>
                      ))}
                    </ul>
                    {readiness.missing.length > 0 && (
                      <ul className="mt-2 space-y-1" data-testid="wrap-readiness-missing">
                        {readiness.missing.map((m) => (
                          <li key={m.key}>
                            <button type="button" onClick={() => goTo(m)} className="text-left text-[14px] text-shText underline decoration-shAccent/60 underline-offset-2 min-h-[32px]" data-testid={`readiness-goto-${m.key.replace(/[^a-z0-9_]/gi, "_")}`}>
                              <i className="fas fa-circle text-[7px] align-middle text-shAccent mr-2" aria-hidden="true" />{m.label} <span className="text-[11px] text-shTextMuted">· go there</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {readiness.recommended.length > 0 && (
                      <ul className="mt-2 space-y-1 text-[13px] text-shTextMuted" data-testid="wrap-readiness-recommended">
                        {readiness.recommended.map((m) => (
                          <li key={m.key}><button type="button" onClick={() => goTo(m)} className="text-left underline underline-offset-2">Recommended · {m.label}</button></li>
                        ))}
                      </ul>
                    )}
                  </section>
                </>
              )}

              {confirming && confirmation && !completionResult && (
                <div className="rounded-2xl border border-shAccent/60 bg-shAccent/[0.08] p-4" role="alertdialog" aria-labelledby="progression-confirm-title" data-testid="progression-confirm">
                  <p id="progression-confirm-title" className="text-[16px] font-black text-shText">{confirmation.title}?</p>
                  <p className="text-[14px] text-shText mt-1 leading-relaxed">{confirmation.text}</p>
                  <div className="flex flex-wrap gap-2 mt-3">
                    <button type="button" onClick={() => setConfirming(false)} data-testid="progression-confirm-cancel" className="min-h-[44px] px-4 rounded-xl border border-shBorder text-shText text-[13px] font-black uppercase tracking-widest">Cancel</button>
                    <button type="button" onClick={() => finish({ confirmed: true })} data-testid="progression-confirm-accept" className="min-h-[44px] px-4 rounded-xl bg-shAccent text-[#071018] text-[13px] font-black uppercase tracking-widest">{confirmation.title} and finish</button>
                  </div>
                </div>
              )}
              {checkpointBlock && (
                <div className="rounded-xl border border-shAccent/50 bg-shAccent/[0.08] p-3 flex items-start gap-3" data-testid="workspace-checkpoint-blocked">
                  <i className="fas fa-flag-checkered text-shAccent mt-0.5" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-[13px] font-black text-shText">Can&apos;t finish yet</p>
                    <p className="text-[12.5px] text-shTextMuted mt-0.5">{checkpointBlock}</p>
                    <p className="text-[12px] text-shTextMuted mt-1">Everything you recorded is saved. You can still complete this lesson without advancing.</p>
                  </div>
                  <button onClick={() => setCheckpointBlock("")} aria-label="Dismiss" className="ml-auto text-shTextMuted text-xs font-black">✕</button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer — one obvious action per phase. Save & Close always means
            "keep this session open for later"; Finish Session finalizes. */}
        {/* After Finish the handoff panel carries the one way out (Return to Training);
            a second identical footer button was noise. */}
        {phase !== "before" && !savedHandoff && !completionResult && (
          <div className="px-4 sm:px-6 py-3 border-t border-shBorder flex flex-wrap items-center justify-end gap-2 shrink-0" data-testid="workspace-footer">
            {(
              <>
                <button onClick={saveAndClose} data-testid="workspace-done"
                        className="min-h-[48px] bg-transparent border border-shSecondary/45 text-shSecondary px-4 rounded-xl font-black text-[12px] uppercase tracking-widest hover:bg-shSecondary/10 transition text-left">
                  Save &amp; Close
                  <span className="block text-[9px] font-semibold normal-case tracking-normal opacity-75">Keep this session open for later</span>
                </button>
                {phase === "train" && (
                  <button onClick={() => setPhase("wrap")} data-testid="workspace-to-wrap"
                          className="min-h-[48px] bg-gradient-to-r from-shPrimary to-[#b7e35c] text-bgHeader px-5 rounded-xl font-black text-[13px] uppercase tracking-widest shadow hover:brightness-110 transition">
                    Wrap Up <i className="fas fa-arrow-right ml-1.5" aria-hidden="true" />
                  </button>
                )}
                {phase === "wrap" && (
                  <button onClick={() => finish()} disabled={finishing} data-testid="workspace-complete-session" data-ready={readiness.ready ? "1" : "0"}
                          className={`min-h-[48px] px-5 rounded-xl font-black text-[13px] uppercase tracking-widest shadow transition text-left ${readiness.ready ? "bg-gradient-to-r from-shPrimary to-[#b7e35c] text-bgHeader hover:brightness-110" : "border border-shAccent/60 text-shAccent bg-shAccent/10"} disabled:opacity-60`}>
                    <i className={`fas ${readiness.ready ? "fa-flag-checkered" : "fa-list-check"} mr-1.5`} aria-hidden="true" />
                    {finishing ? "Finishing…" : readiness.ready ? "Finish Session" : `${readiness.missing.length} thing${readiness.missing.length === 1 ? "" : "s"} left`}
                    <span className="block text-[9px] font-semibold normal-case tracking-normal opacity-75">{readiness.ready ? "Finalize and send the client handoff" : "Tap to go to the first missing item"}</span>
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function RequiredTag() {
  return <span className="ml-1 text-[10px] font-black uppercase tracking-widest text-shAccent">Required</span>;
}

function PreviewRow({ label, value }) {
  return (
    <div className="flex flex-col sm:flex-row sm:gap-2">
      <dt className="text-shTextMuted shrink-0 sm:w-32 text-[12px] sm:text-[14px]">{label}</dt>
      <dd className={`min-w-0 ${value ? "text-shText" : "text-shTextMuted italic"}`}>{value || "Not written yet"}</dd>
    </div>
  );
}

// Expanded skill row — Stage 7: what the trainer records first (level,
// outcome, mastery, the two notes) sits at the top; the seven performance
// metric cards and the skill-specific directions are one tap away. Nothing
// was removed, only ordered by how often it is needed mid-session.
function ActivityDetail({ activity: a, actual, onActualChange }) {
  const targetChips = [
    { key: "duration", icon: "fa-stopwatch", label: "Duration", value: a.target_duration },
    { key: "distance", icon: "fa-ruler", label: "Distance", value: a.target_distance },
    { key: "reps", icon: "fa-rotate", label: "Reps", value: a.target_repetitions },
    { key: "distraction", icon: "fa-volume-high", label: "Distraction", value: a.target_distraction_level },
    { key: "environment", icon: "fa-tree", label: "Environment", value: a.target_environment },
    { key: "handler", icon: "fa-hand", label: "Handler Help", value: a.handler_assistance },
    { key: "leash", icon: "fa-link", label: "Leash", value: a.leash_requirement },
  ];
  const directionRows = [
    ["Starting difficulty", a.starting_difficulty], ["Pass criteria", a.pass_criteria], ["Reset criteria", a.reset_criteria],
    ["Client coaching points", a.client_coaching_points],
  ].filter(([, v]) => v);
  const target = a.pass_criteria || a.objective || null;

  return (
    <div className="space-y-3">
      {target && (
        <p className="text-[14px]"><span className="text-shTextMuted font-black uppercase text-[11px] tracking-widest">Target: </span><span className="text-shText">{target}</span></p>
      )}
      <MeasurementChips items={targetChips} testid={`activity-${a.id}-targets`}/>
      {!a.skipped && <RecordFields activity={a} actual={actual} onChange={onActualChange}/>}
      {!a.skipped && (
        <ExpandableSection title="Performance details (duration, reps, distractions…)" icon="fa-chart-simple" testid={`activity-${a.id}-metrics`}>
          <MetricFields activity={a} actual={actual} onChange={onActualChange}/>
        </ExpandableSection>
      )}
      {directionRows.length > 0 && (
        <ExpandableSection title="Skill notes from the curriculum" icon="fa-book" testid={`activity-${a.id}-directions`}>
          <div className="space-y-1.5 text-[13px]">
            {directionRows.map(([label, val]) => (
              <p key={label}><span className="text-shTextMuted font-black uppercase text-[11px] tracking-widest">{label}: </span><span className="text-shText">{val}</span></p>
            ))}
          </div>
        </ExpandableSection>
      )}
    </div>
  );
}

/* ------------------------------------------------- Session performance --
 * Skill Performance Log redesign. Seven metric cards replace the old
 * free-text "Today's numbers" chips. Semantics, not just styling:
 *   blank = not entered yet · 0 = a real zero · Not needed = deliberate N/A
 * Structured inputs COMPOSE the legacy display string (duration_achieved,
 * distance_achieved, …) so every recap/log/history reader is untouched;
 * the structured values themselves persist in actual.metric_details and the
 * applicability flags in actual.metrics_not_needed (both additive fields on
 * SessionActivityActualIn). A legacy draft with only the free-text value
 * still renders and stays editable through each card's Recorded value box.
 */
const DURATION_UNITS = ["minutes", "seconds"];
const DISTANCE_UNITS = ["feet", "yards", "meters"];
const DISTRACTION_LEVELS = ["None", "Low", "Moderate", "High", "Extreme"]
  .map(v => ({ value: v, label: v }));
const ENVIRONMENT_CHOICES = ["Training Room", "Play Area", "Lobby", "Outside", "Parking Lot", "Public", "Home", "Other"]
  .map(v => ({ value: v, label: v }));
const HANDLER_LEVELS = ["None", "Light", "Moderate", "Heavy", "Full"]
  .map(v => ({ value: v, label: v }));
const HANDLER_METHODS = ["Verbal Cue", "Hand Signal", "Lure / Food", "Body Positioning", "Leash Guidance", "Correction", "Other"];
const LEASH_USES = ["Off Leash", "Loose", "Light Guidance", "Moderate Guidance", "Heavy Guidance", "Long Line"]
  .map(v => ({ value: v, label: v }));

// Compose the legacy free-text display value from a metric's structured
// details — "" when nothing meaningful is entered (blank stays blank).
function composeMetricValue(key, d = {}) {
  const has = (v) => v !== undefined && v !== null && String(v).trim() !== "";
  switch (key) {
    case "duration":
    case "distance":
      return has(d.value) ? `${d.value} ${d.unit || (key === "duration" ? "minutes" : "feet")}` : "";
    case "repetitions":
      if (!has(d.attempts)) return has(d.successful) ? `${d.successful} successful` : "";
      return has(d.successful) ? `${d.successful}/${d.attempts} successful` : `${d.attempts} attempts`;
    case "distraction":
      if (!d.difficulty) return has(d.note) ? String(d.note) : "";
      return d.difficulty + (has(d.note) ? ` — ${d.note}` : "");
    case "environment":
      if (d.choice === "Other") return has(d.other) ? String(d.other) : "Other";
      return d.choice || "";
    case "handler_help": {
      if (!d.level) return "";
      const methods = (d.methods || []).filter(Boolean);
      return d.level
        + (methods.length ? ` · ${methods.join(", ")}` : "")
        + (has(d.other) ? ` · ${d.other}` : "");
    }
    case "leash":
      if (!d.use) return has(d.note) ? String(d.note) : "";
      return d.use + (has(d.note) ? ` — ${d.note}` : "");
    default:
      return "";
  }
}

const NUM_INPUT_CLS = "w-full min-h-[38px] bg-black/20 border border-shBorder/60 rounded-lg px-2.5 text-shText text-[14px] font-black focus:outline-none focus:border-shSecondary/50";
const UNIT_SELECT_CLS = "min-h-[38px] bg-black/20 border border-shBorder/60 rounded-lg px-2 text-shTextMuted text-[12px] font-black focus:outline-none";
const SMALL_LABEL_CLS = "block text-[10px] font-black uppercase tracking-[0.12em] text-shTextMuted mb-1";

// Core recording controls — level, outcome, mastery and the two notes.
// (The metric cards live in MetricFields; structured inputs there COMPOSE
// the legacy display strings so every recap/log/history reader is untouched.)
function RecordFields({ activity: a, actual, onChange }) {
  const appendPrompt = (text) => {
    onChange(prev => {
      const cur = prev.client_observation || "";
      return { client_observation: cur ? `${cur.replace(/\s+$/, "")}\n${text} ` : `${text} ` };
    });
  };

  const required = !!a.required_curriculum && a.source === "skill";
  const Req = () => (required ? <span className="ml-1 text-[10px] font-black uppercase tracking-widest text-shAccent">Required before finishing</span> : null);
  return (
    <div className="space-y-4 border-t border-shBorder pt-3">
      {!a.manual_only && (
        <div>
          <label className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">How did it go? Skill level (0–5){actual.score == null && <Req/>}</label>
          <div className="mt-1.5">
            <SkillLevelIndicator score={actual.score ?? -1} onChange={(n) => onChange({ score: n })} testid={`activity-${a.id}-score-picker`}/>
          </div>
        </div>
      )}
      <div>
        <label className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">Outcome{!actual.outcome && <Req/>}</label>
        {/* 3-up on phones, 6-up on desktop — one tap per assessment, and
            every target stays at least 38px tall for gloved/outdoor use. */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 mt-1.5" data-testid={`activity-${a.id}-assessment`}>
          {OUTCOME_OPTIONS.map(o => (
            <button key={o.key} type="button" onClick={() => onChange({ outcome: o.key })} aria-pressed={actual.outcome === o.key}
                    data-testid={`activity-${a.id}-assessment-${o.key}`}
                    className={`min-h-[38px] px-1 py-1.5 rounded text-[10px] sm:text-[11px] font-black uppercase tracking-widest border leading-tight ${actual.outcome === o.key ? o.color : "border-shBorder text-shTextMuted hover:border-shSecondary/40"}`}>
              {o.label}
              <span className="block text-[9px] font-semibold normal-case tracking-normal opacity-75 mt-0.5">{o.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Mastery is its OWN decision — a high score never grants it. Both
          buttons toggle off, so "no decision today" stays the default. */}
      <div className="rounded-2xl border border-shBorder/60 bg-black/15 p-3.5">
        <label className="text-[11px] font-black uppercase tracking-widest text-shTextMuted"><i className="fas fa-trophy mr-1.5 text-shPrimary"/>Mastery decision <span className="text-shTextMuted/70 normal-case font-bold">· optional, never automatic</span></label>
        <p className="text-[11.5px] text-shTextMuted mt-1">Never automatic. Only mark mastered if the dog has met the lesson standard{a.pass_criteria ? ":" : "."}</p>
        {a.pass_criteria && <p className="text-[12px] text-shText mt-1 rounded-lg border border-shPrimary/25 bg-shPrimary/[0.05] px-2.5 py-1.5" data-testid={`activity-${a.id}-mastery-standard`}>{a.pass_criteria}</p>}
        <div className="grid grid-cols-2 gap-1.5 mt-2.5" data-testid={`activity-${a.id}-mastery`}>
          <button onClick={() => onChange({ mastery_decision: actual.mastery_decision === "not_yet" ? null : "not_yet" })}
                  data-testid={`activity-${a.id}-mastery-not-yet`}
                  className={`min-h-[44px] rounded-lg text-[11px] font-black uppercase tracking-widest border leading-tight ${actual.mastery_decision === "not_yet" ? "bg-shAccent/25 text-shAccent border-shAccent/60" : "border-shBorder text-shTextMuted hover:border-shAccent/40"}`}>
            Not yet
            <span className="block text-[9px] font-semibold normal-case tracking-normal opacity-75 mt-0.5">Keep working on this skill</span>
          </button>
          <button onClick={() => onChange({ mastery_decision: actual.mastery_decision === "mastered" ? null : "mastered" })}
                  data-testid={`activity-${a.id}-mastery-mastered`}
                  className={`min-h-[44px] rounded-lg text-[11px] font-black uppercase tracking-widest border leading-tight ${actual.mastery_decision === "mastered" ? "bg-shPrimary/25 text-shPrimary border-shPrimary/60" : "border-shBorder text-shTextMuted hover:border-shPrimary/40"}`}>
            <i className="fas fa-award mr-1"/>Mark mastered
            <span className="block text-[9px] font-semibold normal-case tracking-normal opacity-75 mt-0.5">Dog has met the standard</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-2xl border border-shPrimary/30 bg-shPrimary/[0.045] p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="text-[11px] font-black uppercase tracking-widest text-shPrimary"><i className="fas fa-user mr-1.5"/>Client observation</label>
            <VisibilityBadge/>
          </div>
          <p className="text-[11.5px] text-shTextMuted mt-1">Client can see this. What should the owner know about how their dog performed? They read this in their recap.</p>
          <textarea value={actual.client_observation || ""} onChange={(e) => onChange({ client_observation: e.target.value })}
                    placeholder="Client-safe observation — the owner reads this in their recap"
                    data-testid={`activity-${a.id}-client-observation`}
                    rows={3} className="w-full mt-2 bg-black/20 border border-shPrimary/30 rounded-lg p-2.5 text-shText text-[13px] focus:outline-none focus:border-shPrimary/50"/>
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-shTextMuted">Consider including:</span>
            {["What went well?", "What needs more work?", "What should the owner watch for?"].map(p => (
              <button key={p} type="button" onClick={() => appendPrompt(p)}
                      className="rounded-full border border-shSecondary/35 bg-shSecondary/[0.07] px-2.5 py-0.5 text-[10.5px] font-bold text-shSecondary hover:bg-shSecondary/15 transition">
                {p}
              </button>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-shAccent/30 bg-shAccent/[0.045] p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="text-[11px] font-black uppercase tracking-widest text-shAccent"><i className="fas fa-lock mr-1.5"/>Trainer note</label>
            <VisibilityBadge staffOnly/>
          </div>
          <p className="text-[11.5px] text-shTextMuted mt-1">Staff only. Additional details, handling notes, or training-plan adjustments.</p>
          <textarea value={actual.notes || ""} onChange={(e) => onChange({ notes: e.target.value })} placeholder="Private trainer note for this skill (staff only — never sent to the client)"
                    data-testid={`activity-${a.id}-private-note`}
                    rows={3} className="w-full mt-2 bg-black/20 border border-shAccent/30 rounded-lg p-2.5 text-shText text-[13px] focus:outline-none focus:border-shAccent/50"/>
          <p className="text-[11px] font-bold text-shAccent mt-1.5">This note is never visible to the client.</p>
        </div>
      </div>
    </div>
  );
}

function MetricFields({ activity: a, actual, onChange }) {
  const details = actual.metric_details || {};
  const notNeeded = actual.metrics_not_needed || {};
  const patchMetric = (key, legacyField) => (detailPatch) => {
    onChange(prev => {
      const prevDetails = prev.metric_details || {};
      const nextDetail = { ...(prevDetails[key] || {}), ...detailPatch };
      return {
        metric_details: { ...prevDetails, [key]: nextDetail },
        [legacyField]: composeMetricValue(key, nextDetail),
      };
    });
  };
  const setNotNeeded = (key, legacyField) => (flag) => {
    onChange(prev => ({
      metrics_not_needed: { ...(prev.metrics_not_needed || {}), [key]: flag },
      [legacyField]: flag ? "" : composeMetricValue(key, (prev.metric_details || {})[key] || {}),
    }));
  };
  const setLegacy = (legacyField) => (v) => onChange({ [legacyField]: v });
  const reps = details.repetitions || {};
  const attempts = Number(reps.attempts);
  const successful = Number(reps.successful);
  const successRate = Number.isFinite(attempts) && attempts > 0 && Number.isFinite(successful) && String(reps.successful ?? "").trim() !== ""
    ? Math.max(0, Math.min(100, Math.round((successful / attempts) * 100)))
    : null;
  const recordedValueBox = (legacyField, testidKey) => (
    <div className="mt-2.5">
      <label className={SMALL_LABEL_CLS}>Recorded value <span className="normal-case tracking-normal font-semibold">(auto-filled — editable)</span></label>
      <input value={actual[legacyField] || ""} onChange={(e) => setLegacy(legacyField)(e.target.value)}
             data-testid={`activity-${a.id}-metric-${testidKey}-value`}
             className="w-full min-h-[34px] bg-black/15 border border-shBorder/50 rounded-lg px-2.5 text-shText text-[12.5px] focus:outline-none focus:border-shSecondary/45"/>
    </div>
  );
  return (
    <div className="space-y-3">
      <div>
        <p className="text-[11px] font-black uppercase tracking-[0.14em] text-shPrimary">Session performance details</p>
        <p className="text-[11.5px] text-shTextMuted mt-0.5 leading-relaxed">
          Capture what happened during today&apos;s session. Mark &ldquo;Not needed&rdquo; for anything that didn&apos;t apply to this lesson — leaving a card blank just means it wasn&apos;t entered, and a 0 is a real result.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mt-2.5">
          <MetricCard icon="fa-stopwatch" title="Duration" tone="cyan" helper="How long the dog maintained or practiced the behavior."
                      notNeeded={!!notNeeded.duration} onNotNeededChange={setNotNeeded("duration", "duration_achieved")}
                      testid={`activity-${a.id}-metric-duration`}>
            {a.target_duration && <p className="text-[10.5px] text-shTextMuted mb-1.5"><span className="font-black uppercase tracking-widest text-[9.5px]">Target · </span>{a.target_duration}</p>}
            <div className="flex gap-1.5">
              <div className="flex-1 min-w-0">
                <label className={SMALL_LABEL_CLS}>Actual</label>
                <input type="number" min="0" step="any" value={details.duration?.value ?? ""}
                       onChange={(e) => patchMetric("duration", "duration_achieved")({ value: e.target.value })}
                       data-testid={`activity-${a.id}-metric-duration-input`} className={NUM_INPUT_CLS}/>
              </div>
              <div className="self-end">
                <select value={details.duration?.unit || "minutes"}
                        onChange={(e) => patchMetric("duration", "duration_achieved")({ unit: e.target.value })}
                        className={UNIT_SELECT_CLS}>
                  {DURATION_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>
            {recordedValueBox("duration_achieved", "duration")}
          </MetricCard>

          <MetricCard icon="fa-ruler" title="Distance" tone="teal" helper="How far the dog worked from the handler, target, or starting point."
                      notNeeded={!!notNeeded.distance} onNotNeededChange={setNotNeeded("distance", "distance_achieved")}
                      testid={`activity-${a.id}-metric-distance`}>
            {a.target_distance && <p className="text-[10.5px] text-shTextMuted mb-1.5"><span className="font-black uppercase tracking-widest text-[9.5px]">Target · </span>{a.target_distance}</p>}
            <div className="flex gap-1.5">
              <div className="flex-1 min-w-0">
                <label className={SMALL_LABEL_CLS}>Actual</label>
                <input type="number" min="0" step="any" value={details.distance?.value ?? ""}
                       onChange={(e) => patchMetric("distance", "distance_achieved")({ value: e.target.value })}
                       data-testid={`activity-${a.id}-metric-distance-input`} className={NUM_INPUT_CLS}/>
              </div>
              <div className="self-end">
                <select value={details.distance?.unit || "feet"}
                        onChange={(e) => patchMetric("distance", "distance_achieved")({ unit: e.target.value })}
                        className={UNIT_SELECT_CLS}>
                  {DISTANCE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>
            {recordedValueBox("distance_achieved", "distance")}
          </MetricCard>

          <MetricCard icon="fa-rotate" title="Repetitions" tone="lime" helper="How many complete attempts were made."
                      notNeeded={!!notNeeded.repetitions} onNotNeededChange={setNotNeeded("repetitions", "repetitions_achieved")}
                      testid={`activity-${a.id}-metric-repetitions`}>
            <div className="flex gap-1.5 items-end">
              <div className="flex-1 min-w-0">
                <label className={SMALL_LABEL_CLS}>Attempts</label>
                <input type="number" min="0" value={reps.attempts ?? ""}
                       onChange={(e) => patchMetric("repetitions", "repetitions_achieved")({ attempts: e.target.value })}
                       data-testid={`activity-${a.id}-metric-repetitions-attempts`} className={NUM_INPUT_CLS}/>
              </div>
              <div className="flex-1 min-w-0">
                <label className={SMALL_LABEL_CLS}>Successful</label>
                <input type="number" min="0" value={reps.successful ?? ""}
                       onChange={(e) => patchMetric("repetitions", "repetitions_achieved")({ successful: e.target.value })}
                       data-testid={`activity-${a.id}-metric-repetitions-successful`} className={NUM_INPUT_CLS}/>
              </div>
              {successRate != null && (
                <div className="shrink-0 text-center px-1.5" data-testid={`activity-${a.id}-metric-repetitions-rate`}>
                  <span className="block text-[16px] font-black text-shPrimary leading-none">{successRate}%</span>
                  <span className="block text-[8.5px] font-black uppercase tracking-widest text-shTextMuted mt-1">Success</span>
                </div>
              )}
            </div>
            {recordedValueBox("repetitions_achieved", "repetitions")}
          </MetricCard>

          <MetricCard icon="fa-volume-high" title="Distraction" tone="orange" helper="What distractions were present and how difficult they were."
                      notNeeded={!!notNeeded.distraction} onNotNeededChange={setNotNeeded("distraction", "distraction_level")}
                      testid={`activity-${a.id}-metric-distraction`}>
            <label className={SMALL_LABEL_CLS}>Difficulty</label>
            <SegmentedOptions options={DISTRACTION_LEVELS} value={details.distraction?.difficulty || null}
                              onChange={(v) => patchMetric("distraction", "distraction_level")({ difficulty: v })}
                              columns="grid-cols-3" testid={`activity-${a.id}-metric-distraction-difficulty`}/>
            <label className={`${SMALL_LABEL_CLS} mt-2`}>Details <span className="normal-case tracking-normal font-semibold">(optional)</span></label>
            <input value={details.distraction?.note || ""} placeholder="e.g. Dog walking nearby"
                   onChange={(e) => patchMetric("distraction", "distraction_level")({ note: e.target.value })}
                   data-testid={`activity-${a.id}-metric-distraction-note`}
                   className="w-full min-h-[34px] bg-black/20 border border-shBorder/60 rounded-lg px-2.5 text-shText text-[12.5px] focus:outline-none focus:border-shSecondary/50"/>
            {recordedValueBox("distraction_level", "distraction")}
          </MetricCard>

          <MetricCard icon="fa-tree" title="Environment" tone="green" helper="Where the training took place."
                      notNeeded={!!notNeeded.environment} onNotNeededChange={setNotNeeded("environment", "environment")}
                      testid={`activity-${a.id}-metric-environment`}>
            <SegmentedOptions options={ENVIRONMENT_CHOICES} value={details.environment?.choice || null}
                              onChange={(v) => patchMetric("environment", "environment")({ choice: v })}
                              columns="grid-cols-2 sm:grid-cols-3" testid={`activity-${a.id}-metric-environment-choice`}/>
            {details.environment?.choice === "Other" && (
              <input value={details.environment?.other || ""} placeholder="Describe the location"
                     onChange={(e) => patchMetric("environment", "environment")({ other: e.target.value })}
                     data-testid={`activity-${a.id}-metric-environment-other`}
                     className="w-full mt-2 min-h-[34px] bg-black/20 border border-shBorder/60 rounded-lg px-2.5 text-shText text-[12.5px] focus:outline-none focus:border-shSecondary/50"/>
            )}
            {recordedValueBox("environment", "environment")}
          </MetricCard>

          <MetricCard icon="fa-hand" title="Handler Help" tone="purple" helper="How much assistance or guidance the dog needed."
                      notNeeded={!!notNeeded.handler_help} onNotNeededChange={setNotNeeded("handler_help", "handler_assistance")}
                      testid={`activity-${a.id}-metric-handler`}>
            <label className={SMALL_LABEL_CLS}>Level</label>
            <SegmentedOptions options={HANDLER_LEVELS} value={details.handler_help?.level || null}
                              onChange={(v) => patchMetric("handler_help", "handler_assistance")({ level: v })}
                              columns="grid-cols-3 sm:grid-cols-5" testid={`activity-${a.id}-metric-handler-level`}/>
            <label className={`${SMALL_LABEL_CLS} mt-2`}>Methods used <span className="normal-case tracking-normal font-semibold">(check all that apply)</span></label>
            <div className="grid grid-cols-2 gap-x-2 gap-y-1">
              {HANDLER_METHODS.map(m => {
                const selected = (details.handler_help?.methods || []).includes(m);
                return (
                  <label key={m} className="flex items-center gap-1.5 text-[11.5px] text-shText cursor-pointer min-h-[24px]">
                    <input type="checkbox" checked={selected} className="w-3.5 h-3.5 accent-[var(--sh-secondary)]"
                           onChange={() => {
                             const cur = details.handler_help?.methods || [];
                             patchMetric("handler_help", "handler_assistance")({
                               methods: selected ? cur.filter(x => x !== m) : [...cur, m],
                             });
                           }}/>
                    {m}
                  </label>
                );
              })}
            </div>
            {(details.handler_help?.methods || []).includes("Other") && (
              <input value={details.handler_help?.other || ""} placeholder="Other method (explain)"
                     onChange={(e) => patchMetric("handler_help", "handler_assistance")({ other: e.target.value })}
                     data-testid={`activity-${a.id}-metric-handler-other`}
                     className="w-full mt-2 min-h-[34px] bg-black/20 border border-shBorder/60 rounded-lg px-2.5 text-shText text-[12.5px] focus:outline-none focus:border-shSecondary/50"/>
            )}
            {recordedValueBox("handler_assistance", "handler")}
          </MetricCard>

          <MetricCard icon="fa-link" title="Leash" tone="pink" helper="How the leash was used and the dog's leash behavior."
                      notNeeded={!!notNeeded.leash} onNotNeededChange={setNotNeeded("leash", "leash_off_leash")}
                      testid={`activity-${a.id}-metric-leash`}>
            <label className={SMALL_LABEL_CLS}>Leash use</label>
            <SegmentedOptions options={LEASH_USES} value={details.leash?.use || null}
                              onChange={(v) => patchMetric("leash", "leash_off_leash")({ use: v })}
                              columns="grid-cols-2 sm:grid-cols-3" testid={`activity-${a.id}-metric-leash-use`}/>
            <label className={`${SMALL_LABEL_CLS} mt-2`}>Notes <span className="normal-case tracking-normal font-semibold">(optional)</span></label>
            <input value={details.leash?.note || ""} placeholder="e.g. Loose most of the session"
                   onChange={(e) => patchMetric("leash", "leash_off_leash")({ note: e.target.value })}
                   data-testid={`activity-${a.id}-metric-leash-note`}
                   className="w-full min-h-[34px] bg-black/20 border border-shBorder/60 rounded-lg px-2.5 text-shText text-[12.5px] focus:outline-none focus:border-shSecondary/50"/>
            {recordedValueBox("leash_off_leash", "leash")}
          </MetricCard>
        </div>
      </div>

      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-1.5 text-[12px] text-shText"><input type="checkbox" checked={!!actual.needs_reassessment} onChange={(e) => onChange({ needs_reassessment: e.target.checked })}/>Needs reassessment next visit</label>
      </div>
    </div>
  );
}
