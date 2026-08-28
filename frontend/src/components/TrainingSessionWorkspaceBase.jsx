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
// version; only presentation changed, built from the shared components in
// components/training/. The 5-stage stepper is a presentation-only view
// derived from existing draft/actuals state (computeStage) — it is not a
// new backend status and never gates anything server-side.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, formatErr } from "../lib/api";
import { useAuth } from "../lib/auth";
import { toast } from "sonner";
import DogIdentityHeader from "./training/DogIdentityHeader";
import StatusChip from "./training/StatusChip";
import SessionStepper from "./training/SessionStepper";
import ExpandableSection from "./training/ExpandableSection";
import SkillLevelIndicator from "./training/SkillLevelIndicator";
import MeasurementChips from "./training/MeasurementChips";
import EquipmentChips from "./training/EquipmentChips";
import VideoDemoCard from "./training/VideoDemoCard";
import ActivityCard from "./training/ActivityCard";
import EmptyState from "./training/EmptyState";
import SegmentedOptions from "./training/SegmentedOptions";
import MetricCard from "./training/MetricCard";
import VisibilityBadge from "./training/VisibilityBadge";

const RESOLUTION_COPY = {
  no_active_enrollment: {
    title: "No active training program",
    body: "This dog isn't currently enrolled in a training program. Enroll them from their profile's Training tab first.",
  },
  no_current_module: {
    title: "No current module set",
    body: "This enrollment doesn't have a current module pointer. Open the dog's Training tab to set one.",
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
    title: "Enrollment not found",
    body: "The selected enrollment could not be found or is no longer active.",
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

const ADVANCEMENT_ACTIONS = [
  { key: "remain", label: "Needs more work — stay on this lesson", desc: "Record today's session and keep this exact lesson as the next training step." },
  { key: "advance_next", label: "Ready — move to the next step", desc: "Finish this lesson and continue sequentially to the next lesson/module. The final lesson completes the program." },
  { key: "advance_lesson", label: "Admin override · next lesson", desc: "Manually move to the next lesson within this module." },
  { key: "advance_module", label: "Admin override · next module", desc: "Jump to the next module and its first lesson." },
  { key: "assign_review", label: "Assign review work", desc: "No forward progress — next session should review this material." },
  { key: "reopen_previous_lesson", label: "Admin override · previous lesson", desc: "Step back to the prior lesson." },
  { key: "skip_lesson", label: "Admin override · skip lesson", desc: "Move past this lesson without completing the normal sequence. A reason is required." },
  { key: "mark_for_assessment", label: "Mark for formal assessment", desc: "Flag every skill recorded today for reassessment next visit." },
  { key: "complete_program", label: "Admin override · force complete program", desc: "End this enrollment without the normal sequential final-step flow." },
];

function uid() { return window.crypto?.randomUUID ? window.crypto.randomUUID() : `tmp-${Math.random().toString(36).slice(2)}`; }

// Presentation-only stage derived from existing draft/actuals/UI state —
// never a new backend status, never gates any action.
function computeStage({ actuals, expandedId, completionResult, hasLessonPractice = false }) {
  if (completionResult) return "complete";
  const list = Object.values(actuals || {});
  const hasRecording = list.some(a => a && (a.score != null || a.outcome));
  if (hasLessonPractice && hasRecording) return "homework";
  if (hasRecording) return "record";
  if (expandedId) return "train";
  return "review";
}

export default function TrainingSessionWorkspace({ bookingId, dogId, enrollmentId, onClose, onSaved }) {
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
  const [completing, setCompleting] = useState(false);
  const [completionResult, setCompletionResult] = useState(null);
  const [checkpointBlock, setCheckpointBlock] = useState("");
  const saveTimer = useRef(null);
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
        const res = await api.post(`/dogs/${dogId}/programs/${enrollmentId}/training-session/draft`);
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
  }, [bookingId, dogId, enrollmentId]);

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
        setTimeout(() => setSavingLabel(""), 1500);
      } catch (e) {
        setSavingLabel("");
        toast.error(formatErr(e?.response?.data?.detail) || "Autosave failed");
      }
    }, 800);
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

  const stage = computeStage({ actuals: draft.actuals, expandedId, completionResult, hasLessonPractice: !!overview?.current_lesson_practice?.configured });
  const breadcrumbParts = [
    overview?.program_name,
    overview?.current_module_name ? `Module: ${overview.current_module_name}` : null,
    overview?.current_lesson_name ? `Lesson: ${overview.current_lesson_name}` : null,
    overview?.current_week ? `Week ${overview.current_week} of ${overview.total_weeks}` : null,
  ].filter(Boolean);
  const plannedMinutes = activities.reduce((sum, a) => sum + (Number(a.estimated_minutes) || 0), 0);
  const videosWaiting = overview?.recent_media?.length || 0;
  const openQuestions = overview?.client_questions?.length || 0;
  const safetyFlags = overview?.behavior_safety_flags?.length || 0;

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-2 sm:p-4" data-testid="training-session-workspace">
      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-6xl max-h-[calc(var(--app-height)_-_1rem)] flex flex-col min-h-0 shadow-2xl">
        {/* Header */}
        <div className="px-4 sm:px-6 py-4 border-b border-shBorder shrink-0 space-y-3 bg-gradient-to-br from-shSecondary/[0.05] via-transparent to-transparent rounded-t-2xl">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-shPrimary"><i className="fas fa-clipboard-check mr-1.5"/>Skill Performance Log</p>
              <p className="text-[11.5px] text-shTextMuted mt-0.5">Record how the dog performed in this session.</p>
              <div className="mt-2">
                <DogIdentityHeader dogName={dog?.name} dogPhoto={dog?.photo} breadcrumb={breadcrumbParts.join(" · ")} testid="workspace-dog-header"/>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {savingLabel && <p className="text-[11px] text-shTextMuted">{savingLabel}</p>}
              <button onClick={onClose} data-testid="workspace-close" className="text-shTextMuted hover:text-shText text-xl px-2"><i className="fas fa-times"/></button>
            </div>
          </div>
          <SessionStepper activeKey={stage} testid="workspace-stepper"/>
          <div className="flex flex-wrap gap-2">
            {draft.created_by_name && <StatusChip icon="fa-user" label="Trainer" value={draft.created_by_name} tone="muted"/>}
            {plannedMinutes > 0 && <StatusChip icon="fa-clock" label="Planned Duration" value={`${plannedMinutes} min`} tone="muted"/>}
            {overview?.last_session?.at && <StatusChip icon="fa-calendar" label="Last Session" value={(overview.last_session.at || "").slice(0, 10)} tone="muted"/>}
            <StatusChip icon="fa-video" label="Videos Waiting" value={videosWaiting} tone={videosWaiting > 0 ? "accent" : "muted"}/>
            {openQuestions > 0 && <StatusChip icon="fa-comment-dots" label="Client Questions" value={openQuestions} tone="secondary"/>}
            {safetyFlags > 0 && <StatusChip icon="fa-triangle-exclamation" label="Safety Flags" value={safetyFlags} tone="danger"/>}
          </div>
        </div>

        <div className="overflow-y-auto flex-1 min-h-0 px-4 sm:px-6 py-4 space-y-4">
          {completionResult && (
            <div className="bg-shPrimary/10 border border-shPrimary/40 rounded-lg p-3" data-testid="workspace-completion-summary">
              <p className="text-[13px] font-black uppercase tracking-widest text-shPrimary"><i className="fas fa-circle-check mr-1.5"/>Session completed</p>
              <p className="text-[12px] text-shTextMuted mt-1">
                {completionResult.session_log?.goal_updates?.length || 0} skill(s) updated
                {(completionResult.homework_assigned?.length || completionResult.homework_created?.length) > 0 && ` · ${completionResult.homework_assigned?.length || completionResult.homework_created?.length} lesson Practice assignment(s) ready`}
                {completionResult.session_log?.advancement_action && completionResult.session_log.advancement_action !== "remain" && ` · ${ADVANCEMENT_ACTIONS.find(a => a.key === completionResult.session_log.advancement_action)?.label || completionResult.session_log.advancement_action}`}
              </p>
              {completionResult.homework_conflicts?.length > 0 && (
                <div className="mt-2 pt-2 border-t border-shPrimary/20" data-testid="workspace-homework-conflicts">
                  <p className="text-[11px] font-black uppercase tracking-widest text-shAccent">Practice not created — already assigned</p>
                  {completionResult.homework_conflicts.map((c, i) => (
                    <p key={i} className="text-[12px] text-shTextMuted">
                      &ldquo;{c.existing_title}&rdquo; is still {c.existing_status} — skipped to avoid a duplicate.
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
          {/* Pre-session overview */}
          <ExpandableSection title="Pre-Session Overview" icon="fa-circle-info" tone="secondary" defaultOpen={stage === "review"} testid="workspace-overview">
            {overview && (
              <div className="space-y-3 text-[13px]">
                {overview.last_session && (
                  <div className="rounded-xl border border-shSecondary/25 bg-shSecondary/[0.04] p-3" data-testid="workspace-last-lesson-handoff">
                    <p className="text-[11px] font-black uppercase tracking-widest text-shSecondary">
                      Last lesson{overview.last_session.lesson_name ? ` · ${overview.last_session.lesson_name}` : ""}
                      {overview.last_session.by ? ` · ${overview.last_session.by}` : ""}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 mt-2">
                      {overview.last_session.strongest_skills?.length > 0 && (
                        <p className="text-shText"><span className="text-shTextMuted">Strongest: </span>
                          {overview.last_session.strongest_skills.map(s => `${s.name} ${s.score}/5`).join(" · ")}</p>
                      )}
                      {overview.last_session.needs_work_skills?.length > 0 && (
                        <p className="text-shText"><span className="text-shTextMuted">Needs work: </span>
                          {overview.last_session.needs_work_skills.map(s => `${s.name} ${s.score}/5`).join(" · ")}</p>
                      )}
                      {overview.last_session.practice_assigned?.length > 0 && (
                        <p className="text-shText"><span className="text-shTextMuted">Practice assigned: </span>
                          {overview.last_session.practice_assigned.join(", ")}</p>
                      )}
                      {overview.last_session.next_lesson_focus && (
                        <p className="text-shText"><span className="text-shTextMuted">Next focus: </span>
                          {overview.last_session.next_lesson_focus}</p>
                      )}
                    </div>
                    {overview.last_session.note && (
                      <p className="text-shTextMuted mt-2 text-[12px]"><i className="fas fa-lock mr-1 text-shAccent"/>{overview.last_session.note}</p>
                    )}
                    {overview.last_session.skills_worked?.length > 0 && (
                      <p className="text-shTextMuted mt-1 text-[12px]">Worked on: {overview.last_session.skills_worked.map(s => s.name).filter(Boolean).join(", ")}</p>
                    )}
                  </div>
                )}
                {overview.homework_since_last_session?.length > 0 && (
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">Practice</p>
                    {overview.homework_since_last_session.slice(0, 3).map(hw => (
                      <p key={hw.id} className="text-shText">
                        {hw.title} {hw.daily_tracker && hw.total_days ? `· ${hw.days_completed}/${hw.total_days} days` : `· ${hw.status}`}
                        {hw.avg_difficulty != null && <span className="text-shTextMuted"> · avg difficulty {hw.avg_difficulty}/5</span>}
                      </p>
                    ))}
                  </div>
                )}
                {overview.client_questions?.length > 0 && (
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-widest text-shAccent">Unanswered client questions</p>
                    {overview.client_questions.map((q, i) => <p key={i} className="text-shText">&ldquo;{q.text}&rdquo;</p>)}
                  </div>
                )}
                {overview.behavior_safety_flags?.length > 0 && (
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-widest text-red-400">Safety flags</p>
                    <p className="text-red-300">{overview.behavior_safety_flags.join(", ")}</p>
                  </div>
                )}
                {overview.equipment_needed?.length > 0 && <EquipmentChips equipment={overview.equipment_needed.join(", ")} testid="workspace-overview-equipment"/>}
                {overview.internal_trainer_notes && (
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">Internal trainer notes (staff only)</p>
                    <p className="text-shText whitespace-pre-wrap">{overview.internal_trainer_notes}</p>
                  </div>
                )}
              </div>
            )}
          </ExpandableSection>

          {/* Plan */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">Current Lesson Plan ({activities.length})</p>
                <p className="text-[11px] text-shTextMuted mt-0.5">Required curriculum skills are locked in order. Add a custom activity only when the dog needs extra work beyond the lesson.</p>
              </div>
              <button onClick={addCustomActivity} data-testid="add-custom-activity" className="text-[11px] text-shPrimary font-black uppercase tracking-widest"><i className="fas fa-plus mr-1"/>Add Extra Activity</button>
            </div>
            <div className="space-y-2">
              {activities.length === 0 && (
                <EmptyState icon="fa-list-check" message="No activities planned. Add one above." testid="workspace-no-activities"/>
              )}
              {activities.map((a, i) => (
                <ActivityCard key={a.id} activity={a} index={i} total={activities.length}
                               expanded={expandedId === a.id}
                               onToggleExpand={() => setExpandedId(expandedId === a.id ? null : a.id)}
                               onMove={(dir) => moveActivity(a.id, dir)}
                               onRemove={() => removeActivity(a.id)}
                               onToggleSkip={() => toggleSkip(a.id)}
                               onSkipReason={(r) => setSkipReason(a.id, r)}
                               locked={!!a.required_curriculum && !isAdmin}
                               testid={`activity-${a.id}`}>
                  <ActivityDetail activity={a} actual={draft.actuals?.[a.id] || {}} onActualChange={(patch) => setActual(a.id, patch)}/>
                </ActivityCard>
              ))}
            </div>
          </div>

          {checkpointBlock && (
            <div className="rounded-xl border border-shAccent/50 bg-shAccent/[0.08] p-3 flex items-start gap-3"
                 data-testid="workspace-checkpoint-blocked">
              <i className="fas fa-flag-checkered text-shAccent mt-0.5"/>
              <div className="min-w-0">
                <p className="text-[13px] font-black text-shText">Advancement blocked</p>
                <p className="text-[12.5px] text-shTextMuted mt-0.5">{checkpointBlock}</p>
                <p className="text-[12px] text-shTextMuted mt-1">
                  Everything you recorded is saved. You can still complete this lesson without advancing.
                </p>
              </div>
              <button onClick={() => setCheckpointBlock("")} className="ml-auto text-shTextMuted text-xs font-black">✕</button>
            </div>
          )}

          {/* Lesson Practice — one curriculum-owned recipe, shared with Online School. */}
          <div className="rounded-xl border border-shSecondary/30 bg-shSecondary/[0.04] p-3" data-testid="workspace-lesson-practice">
            <div className="flex items-start gap-3">
              <i className="fas fa-house-chimney-user text-shSecondary mt-0.5"/>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-black uppercase tracking-widest text-shSecondary">Client Practice · follows this lesson</p>
                {overview?.current_lesson_practice?.configured ? (
                  overview.current_lesson_practice.available === false ? (
                    <p className="text-[12px] text-shAccent mt-1">This lesson points to a Practice recipe that no longer exists. Fix the lesson in Program Studio before assigning client Practice.</p>
                  ) : (
                    <>
                      <p className="text-[13px] font-black text-shText mt-1">{overview.current_lesson_practice.title || "Lesson Practice"}</p>
                      {overview.current_lesson_practice.description && <p className="text-[12px] text-shTextMuted mt-1">{overview.current_lesson_practice.description}</p>}
                      <textarea value={draft.practice_note || ""} onChange={(e) => updateDraft({ practice_note: e.target.value })}
                                rows={2} data-testid="workspace-practice-note" placeholder="Optional client-specific note for this lesson's Practice…"
                                className="w-full mt-2 bg-black/20 border border-shBorder rounded p-2 text-shText text-[13px]"/>
                    </>
                  )
                ) : (
                  <p className="text-[12px] text-shTextMuted mt-1">No separate client Practice recipe is configured for this lesson.</p>
                )}
              </div>
            </div>
          </div>

          {/* Lesson summary — the three structured fields the client recap and
              the next trainer's handoff are both built from. All client-safe. */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3" data-testid="workspace-lesson-summary">
            <div>
              <label className="text-[11px] font-black uppercase tracking-widest text-shTextMuted"><i className="fas fa-thumbs-up mr-1 text-shPrimary"/>What went well</label>
              <textarea value={draft.what_went_well || ""} onChange={(e) => updateDraft({ what_went_well: e.target.value })}
                        rows={3} data-testid="workspace-what-went-well" placeholder="Wins from this lesson…"
                        className="w-full mt-1 bg-black/20 border border-shBorder rounded p-2 text-shText text-sm"/>
            </div>
            <div>
              <label className="text-[11px] font-black uppercase tracking-widest text-shTextMuted"><i className="fas fa-triangle-exclamation mr-1 text-shAccent"/>Needs work</label>
              <textarea value={draft.needs_work || ""} onChange={(e) => updateDraft({ needs_work: e.target.value })}
                        rows={3} data-testid="workspace-needs-work" placeholder="Weak areas, extra reps…"
                        className="w-full mt-1 bg-black/20 border border-shBorder rounded p-2 text-shText text-sm"/>
            </div>
            <div>
              <label className="text-[11px] font-black uppercase tracking-widest text-shTextMuted"><i className="fas fa-forward mr-1 text-shSecondary"/>Next lesson focus</label>
              <textarea value={draft.next_lesson_focus || ""} onChange={(e) => updateDraft({ next_lesson_focus: e.target.value })}
                        rows={3} data-testid="workspace-next-lesson-focus" placeholder="What the next trainer should target…"
                        className="w-full mt-1 bg-black/20 border border-shBorder rounded p-2 text-shText text-sm"/>
            </div>
          </div>

          {/* Notes — staff-only and client-safe kept visibly separate. */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded border border-shAccent/30 bg-shAccent/[0.04] p-2">
              <label className="text-[11px] font-black uppercase tracking-widest text-shAccent"><i className="fas fa-lock mr-1"/>Private trainer note · never shown to the client</label>
              <textarea value={draft.session_note || ""} onChange={(e) => updateDraft({ session_note: e.target.value })}
                        rows={3} data-testid="workspace-session-note"
                        className="w-full mt-1 bg-black/20 border border-shBorder rounded p-2 text-shText text-sm"/>
            </div>
            <div className="rounded border border-shPrimary/30 bg-shPrimary/[0.04] p-2">
              <label className="text-[11px] font-black uppercase tracking-widest text-shPrimary"><i className="fas fa-comment-dots mr-1"/>Client recap note · the owner reads this</label>
              <textarea value={draft.client_recap_note || ""} onChange={(e) => updateDraft({ client_recap_note: e.target.value })}
                        rows={3} data-testid="workspace-recap-note"
                        className="w-full mt-1 bg-black/20 border border-shBorder rounded p-2 text-shText text-sm"/>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-6 py-3 border-t border-shBorder flex justify-end gap-2 shrink-0">
          {completionResult ? (
            <button onClick={() => { onSaved?.(draft); onClose(); }} data-testid="workspace-close-after-complete"
                    className="bg-shPrimary text-bgHeader px-4 py-2 rounded font-black text-[13px] uppercase tracking-widest shadow">
              Close
            </button>
          ) : (
            <>
              <button onClick={() => { onSaved?.(draft); onClose(); }} data-testid="workspace-done"
                      className="min-h-[46px] bg-transparent border border-shSecondary/45 text-shSecondary px-4 py-2 rounded-xl font-black text-[13px] uppercase tracking-widest hover:bg-shSecondary/10 transition">
                Save &amp; Close
                <span className="block text-[9px] font-semibold normal-case tracking-normal opacity-75">Draft keeps autosaving</span>
              </button>
              <button onClick={() => setCompleting(true)} data-testid="workspace-complete-session"
                      className="min-h-[46px] bg-shPrimary text-bgHeader px-5 py-2 rounded-xl font-black text-[13px] uppercase tracking-widest shadow-[0_10px_30px_-12px_rgba(140,198,63,0.7)] hover:brightness-110 transition">
                <i className="fas fa-flag-checkered mr-1.5"/>Complete Session
              </button>
            </>
          )}
        </div>
      </div>
      {completing && (
        <CompleteSessionModal
          lessonPractice={overview?.current_lesson_practice}
          isAdmin={isAdmin}
          onCancel={() => setCompleting(false)}
          onComplete={async (body) => {
            try {
              const { data } = await api.post(`/training-session-drafts/${draft.id}/complete`, body);
              setCompletionResult(data);
              setCompleting(false);
              toast.success("Session completed");
            } catch (e) {
              const detail = e?.response?.data?.detail;
              // The checkpoint gate is a curriculum rule, not a glitch — say
              // exactly what is blocking and what to do, and keep the
              // workspace open so nothing the trainer recorded is lost.
              if (detail?.error_code === "checkpoint_required_before_advancement") {
                setCheckpointBlock(detail.message);
                setCompleting(false);
                return;
              }
              if (detail?.error_code === "lesson_assessment_incomplete") {
                const missing = (detail.missing || []).join(" · ");
                setCheckpointBlock(`${detail.message}${missing ? ` ${missing}` : ""}`);
                setCompleting(false);
                return;
              }
              toast.error(formatErr(detail) || "Could not complete session");
            }
          }}
        />
      )}
    </div>
  );
}

// Expanded-card content: goal + demo video + equipment + target measurements
// stay always visible when expanded (short, essential); the full trainer
// directions/troubleshooting/safety text stays collapsed until opened.
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
    ["Why it matters", a.why_it_matters], ["Setup", a.setup], ["Trainer instructions", a.trainer_instructions],
    ["Starting difficulty", a.starting_difficulty], ["Progression", a.progression_instructions],
    ["Common mistakes", a.common_mistakes], ["Troubleshooting", a.troubleshooting],
    ["Pass criteria", a.pass_criteria], ["Reset criteria", a.reset_criteria],
    ["Client coaching points", a.client_coaching_points],
  ].filter(([, v]) => v);

  return (
    <div className="space-y-3">
      {a.objective && (
        <p className="text-[13px]"><span className="text-shTextMuted font-black uppercase text-[11px] tracking-widest">Goal: </span><span className="text-shText">{a.objective}</span></p>
      )}
      <VideoDemoCard videoUrl={a.demo_video_url} testid={`activity-${a.id}-video`}/>
      <EquipmentChips equipment={a.equipment} testid={`activity-${a.id}-equipment`}/>
      <MeasurementChips items={targetChips} testid={`activity-${a.id}-targets`}/>

      {directionRows.length > 0 && (
        <ExpandableSection title="Trainer Directions" icon="fa-book" testid={`activity-${a.id}-directions`}>
          <div className="space-y-1.5 text-[13px]">
            {directionRows.map(([label, val]) => (
              <p key={label}><span className="text-shTextMuted font-black uppercase text-[11px] tracking-widest">{label}: </span><span className="text-shText">{val}</span></p>
            ))}
          </div>
        </ExpandableSection>
      )}
      {a.safety_notes && (
        <ExpandableSection title="Safety Notes" icon="fa-triangle-exclamation" tone="danger" testid={`activity-${a.id}-safety`}>
          <p className="text-red-300 text-[13px]">{a.safety_notes}</p>
        </ExpandableSection>
      )}

      {!a.skipped && <RecordFields activity={a} actual={actual} onChange={onActualChange}/>}
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

function RecordFields({ activity: a, actual, onChange }) {
  const details = actual.metric_details || {};
  const notNeeded = actual.metrics_not_needed || {};

  // Update one metric's structured details and recompose its legacy display
  // value in the same patch so autosave writes both together. Functional
  // patches: composition must read the LATEST actual, never this render's
  // snapshot, or two quick edits in one frame would drop the first.
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
      // Marking N/A clears the display value; unchecking recomposes it from
      // whatever structured details were already entered.
      [legacyField]: flag ? "" : composeMetricValue(key, (prev.metric_details || {})[key] || {}),
    }));
  };
  // Direct free-text override — how legacy drafts (no structured details)
  // stay fully editable, and how a trainer can always type an exact value.
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

  const appendPrompt = (text) => {
    onChange(prev => {
      const cur = prev.client_observation || "";
      return { client_observation: cur ? `${cur.replace(/\s+$/, "")}\n${text} ` : `${text} ` };
    });
  };

  return (
    <div className="space-y-4 border-t border-shBorder pt-3">
      {!a.manual_only && (
        <div>
          <label className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">Skill level (0–5)</label>
          <div className="mt-1.5">
            <SkillLevelIndicator score={actual.score ?? -1} onChange={(n) => onChange({ score: n })} testid={`activity-${a.id}-score-picker`}/>
          </div>
        </div>
      )}
      <div>
        <label className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">Session outcome</label>
        {/* 3-up on phones, 6-up on desktop — one tap per assessment, and
            every target stays at least 38px tall for gloved/outdoor use. */}
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 mt-1.5" data-testid={`activity-${a.id}-assessment`}>
          {OUTCOME_OPTIONS.map(o => (
            <button key={o.key} onClick={() => onChange({ outcome: o.key })}
                    data-testid={`activity-${a.id}-assessment-${o.key}`}
                    className={`min-h-[38px] px-1 py-1.5 rounded text-[10px] sm:text-[11px] font-black uppercase tracking-widest border leading-tight ${actual.outcome === o.key ? o.color : "border-shBorder text-shTextMuted hover:border-shSecondary/40"}`}>
              {o.label}
              <span className="block text-[9px] font-semibold normal-case tracking-normal opacity-75 mt-0.5">{o.desc}</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-[11px] font-black uppercase tracking-[0.14em] text-shPrimary">Session performance details</p>
        <p className="text-[11.5px] text-shTextMuted mt-0.5 leading-relaxed">
          Capture what happened during today&apos;s session. Mark &ldquo;Not needed&rdquo; for anything that didn&apos;t apply to this lesson — leaving a card blank just means it wasn&apos;t entered, and a 0 is a real result.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mt-2.5">
          <MetricCard icon="fa-stopwatch" title="Duration" helper="How long the dog maintained or practiced the behavior."
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

          <MetricCard icon="fa-ruler" title="Distance" helper="How far the dog worked from the handler, target, or starting point."
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

          <MetricCard icon="fa-rotate" title="Repetitions" helper="How many complete attempts were made."
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

          <MetricCard icon="fa-volume-high" title="Distraction" helper="What distractions were present and how difficult they were."
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

          <MetricCard icon="fa-tree" title="Environment" helper="Where the training took place."
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

          <MetricCard icon="fa-hand" title="Handler Help" helper="How much assistance or guidance the dog needed."
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

          <MetricCard icon="fa-link" title="Leash" helper="How the leash was used and the dog's leash behavior."
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
          <p className="text-[11.5px] text-shTextMuted mt-1">What should the owner know about how their dog performed? They read this in their recap.</p>
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
            <label className="text-[11px] font-black uppercase tracking-widest text-shAccent"><i className="fas fa-lock mr-1.5"/>Private trainer note</label>
            <VisibilityBadge staffOnly/>
          </div>
          <p className="text-[11.5px] text-shTextMuted mt-1">Additional details, handling notes, or training-plan adjustments.</p>
          <textarea value={actual.notes || ""} onChange={(e) => onChange({ notes: e.target.value })} placeholder="Private trainer note for this skill (staff only — never sent to the client)"
                    data-testid={`activity-${a.id}-private-note`}
                    rows={3} className="w-full mt-2 bg-black/20 border border-shAccent/30 rounded-lg p-2.5 text-shText text-[13px] focus:outline-none focus:border-shAccent/50"/>
          <p className="text-[11px] font-bold text-shAccent mt-1.5">This note is never visible to the client.</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-1.5 text-[12px] text-shText"><input type="checkbox" checked={!!actual.needs_reassessment} onChange={(e) => onChange({ needs_reassessment: e.target.checked })}/>Needs reassessment next visit</label>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ Completion */
function CompleteSessionModal({ lessonPractice, isAdmin = false, onCancel, onComplete }) {
  const [action, setAction] = useState("remain");
  const [reason, setReason] = useState("");
  const canAssignLessonPractice = !!lessonPractice?.configured && lessonPractice?.available !== false;
  const [assignLessonPractice, setAssignLessonPractice] = useState(canAssignLessonPractice);
  const [sendRecap, setSendRecap] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const needsReason = action === "skip_lesson";
  const normalActions = ADVANCEMENT_ACTIONS.filter(o => ["remain", "advance_next"].includes(o.key));
  const adminActions = ADVANCEMENT_ACTIONS.filter(o => !["remain", "advance_next"].includes(o.key));

  const submit = async () => {
    setSubmitting(true);
    try {
      await onComplete({
        advancement_action: action,
        advancement_reason: reason.trim() || null,
        assign_lesson_practice: canAssignLessonPractice ? assignLessonPractice : false,
        send_recap: sendRecap,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-2 sm:p-4" data-testid="complete-session-modal">
      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-lg max-h-[calc(var(--app-height)_-_1rem)] flex flex-col min-h-0 shadow-2xl">
        <div className="px-4 sm:px-6 py-4 border-b border-shBorder shrink-0">
          <h4 className="text-base font-black text-shText uppercase italic">Complete Session</h4>
        </div>
        <div className="overflow-y-auto flex-1 min-h-0 px-4 sm:px-6 py-4 space-y-4">
          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted mb-2">Can this dog move on?</p>
            <div className="space-y-1.5">
              {normalActions.map(opt => (
                <button key={opt.key} onClick={() => setAction(opt.key)} data-testid={`advancement-${opt.key}`}
                        className={`w-full text-left px-3 py-2 rounded border ${action === opt.key ? "bg-shPrimary/15 border-shPrimary text-shText" : "border-shBorder text-shTextMuted"}`}>
                  <p className="text-[13px] font-bold">{opt.label}</p>
                  <p className="text-[11px] opacity-80">{opt.desc}</p>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-shTextMuted mt-2">Moving forward requires every required curriculum skill in this lesson to have today&apos;s outcome recorded, plus a skill level where applicable.</p>
          </div>
          {isAdmin && (
            <details className="rounded-lg border border-shAccent/30 bg-shAccent/[0.03] p-3" data-testid="admin-advancement-overrides">
              <summary className="cursor-pointer text-[11px] font-black uppercase tracking-widest text-shAccent">Admin overrides</summary>
              <p className="text-[11px] text-shTextMuted mt-1 mb-2">Use only when correcting or intentionally bypassing the normal curriculum sequence.</p>
              <div className="space-y-1.5">
                {adminActions.map(opt => (
                  <button key={opt.key} onClick={() => setAction(opt.key)} data-testid={`advancement-${opt.key}`}
                          className={`w-full text-left px-3 py-2 rounded border ${action === opt.key ? "bg-shAccent/15 border-shAccent text-shText" : "border-shBorder text-shTextMuted"}`}>
                    <p className="text-[13px] font-bold">{opt.label}</p>
                    <p className="text-[11px] opacity-80">{opt.desc}</p>
                  </button>
                ))}
              </div>
            </details>
          )}
          {(needsReason || action === "reopen_previous_lesson" || action === "assign_review") && (
            <div>
              <label className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">Reason {needsReason ? "(required)" : "(optional)"}</label>
              <input value={reason} onChange={(e) => setReason(e.target.value)} data-testid="advancement-reason"
                     className="w-full mt-1 bg-black/20 border border-shBorder rounded p-2 text-shText text-sm"/>
            </div>
          )}
          <div className="rounded-lg border border-shSecondary/30 bg-shSecondary/[0.04] p-3" data-testid="complete-session-lesson-practice">
            <p className="text-[11px] font-black uppercase tracking-widest text-shSecondary">Lesson Practice for the client</p>
            {lessonPractice?.configured ? (
              lessonPractice.available === false ? (
                <p className="text-[12px] text-shAccent mt-1">The lesson's configured Practice recipe is missing. The session can be recorded, but no unrelated homework will be substituted.</p>
              ) : (
                <>
                  <p className="text-[13px] font-black text-shText mt-1">{lessonPractice.title || "Lesson Practice"}</p>
                  {lessonPractice.description && <p className="text-[11px] text-shTextMuted mt-1">{lessonPractice.description}</p>}
                  <label className="flex items-start gap-2 text-[13px] text-shText mt-3">
                    <input type="checkbox" className="mt-0.5" checked={assignLessonPractice} onChange={(e) => setAssignLessonPractice(e.target.checked)}/>
                    <span><b>Send this lesson's Practice</b><br/><span className="text-[11px] text-shTextMuted">Default for normal in-person lessons. Turn it off only when the client should not practice this lesson yet.</span></span>
                  </label>
                  {!assignLessonPractice && (
                    <p className="mt-2 rounded-lg border border-shAccent/40 bg-shAccent/[0.07] px-2.5 py-1.5 text-[11px] font-black uppercase tracking-widest text-shAccent" data-testid="complete-session-practice-withheld">
                      <i className="fas fa-hand mr-1.5"/>Practice withheld for this visit
                    </p>
                  )}
                </>
              )
            ) : (
              <p className="text-[12px] text-shTextMuted mt-1">This lesson has no separate Practice recipe configured, so completing the session will not create generic homework.</p>
            )}
          </div>
          <label className="flex items-center gap-2 text-[13px] text-shText">
            <input type="checkbox" checked={sendRecap} onChange={(e) => setSendRecap(e.target.checked)}/>
            Queue client recap
          </label>
        </div>
        <div className="px-4 sm:px-6 py-3 border-t border-shBorder flex justify-end gap-2 shrink-0">
          <button onClick={onCancel} className="text-shTextMuted hover:text-shText font-black uppercase text-[13px] tracking-widest px-2">Cancel</button>
          <button onClick={submit} disabled={submitting || (needsReason && !reason.trim())} data-testid="confirm-complete-session"
                  className="bg-shPrimary text-bgHeader px-4 py-2 rounded font-black text-[13px] uppercase tracking-widest shadow disabled:opacity-50">
            {submitting ? "Completing…" : "Complete Session"}
          </button>
        </div>
      </div>
    </div>
  );
}
