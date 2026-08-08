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
  enrollment_not_found: {
    title: "Enrollment not found",
    body: "The selected enrollment could not be found or is no longer active.",
  },
};

const OUTCOME_OPTIONS = [
  { key: "passed", label: "Passed", color: "bg-shPrimary/20 text-shPrimary border-shPrimary/40" },
  { key: "improving", label: "Improving", color: "bg-shSecondary/20 text-shSecondary border-shSecondary/40" },
  { key: "needs_more_work", label: "Needs More Work", color: "bg-shAccent/20 text-shAccent border-shAccent/40" },
  { key: "skipped", label: "Skipped", color: "bg-gray-500/20 text-shTextMuted border-gray-500/30" },
];

const ADVANCEMENT_ACTIONS = [
  { key: "remain", label: "Remain on current lesson", desc: "No advancement — keep working the same material next time." },
  { key: "advance_lesson", label: "Advance to next lesson", desc: "Move to the next lesson within this module." },
  { key: "advance_module", label: "Advance to next module", desc: "Graduate to the next module (resets to its first lesson)." },
  { key: "assign_review", label: "Assign review work", desc: "No forward progress — next session should review this material." },
  { key: "reopen_previous_lesson", label: "Reopen previous lesson", desc: "Step back to the prior lesson." },
  { key: "skip_lesson", label: "Skip this lesson", desc: "Move past this lesson without mastering it (reason required)." },
  { key: "mark_for_assessment", label: "Mark for formal assessment", desc: "Flag every skill recorded today for reassessment next visit." },
  { key: "complete_program", label: "Complete the program", desc: "Graduate the dog — ends this enrollment." },
];

function uid() { return window.crypto?.randomUUID ? window.crypto.randomUUID() : `tmp-${Math.random().toString(36).slice(2)}`; }

// Presentation-only stage derived from existing draft/actuals/UI state —
// never a new backend status, never gates any action.
function computeStage({ actuals, expandedId, completionResult }) {
  if (completionResult) return "complete";
  const list = Object.values(actuals || {});
  if (list.some(a => a?.homework_eligible)) return "homework";
  if (list.some(a => a && (a.score != null || a.outcome))) return "record";
  if (expandedId) return "train";
  return "review";
}

export default function TrainingSessionWorkspace({ bookingId, dogId, enrollmentId, onClose, onSaved }) {
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

  const setActual = (activityId, patch) => {
    updateDraft(d => ({
      ...d,
      actuals: { ...d.actuals, [activityId]: { ...(d.actuals[activityId] || {}), ...patch } },
    }));
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

  const stage = computeStage({ actuals: draft.actuals, expandedId, completionResult });
  const breadcrumbParts = [
    overview?.program_name,
    overview?.current_module_name ? `Module: ${overview.current_module_name}` : null,
    overview?.current_week ? `Week ${overview.current_week} of ${overview.total_weeks}` : null,
  ].filter(Boolean);
  const plannedMinutes = activities.reduce((sum, a) => sum + (Number(a.estimated_minutes) || 0), 0);
  const videosWaiting = overview?.recent_media?.length || 0;
  const openQuestions = overview?.client_questions?.length || 0;
  const safetyFlags = overview?.behavior_safety_flags?.length || 0;

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-2 sm:p-4" data-testid="training-session-workspace">
      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-4xl max-h-[calc(var(--app-height)_-_1rem)] flex flex-col min-h-0 shadow-2xl">
        {/* Header */}
        <div className="px-4 sm:px-6 py-4 border-b border-shBorder shrink-0 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <DogIdentityHeader dogName={dog?.name} dogPhoto={dog?.photo} breadcrumb={breadcrumbParts.join(" · ")} testid="workspace-dog-header"/>
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
                {completionResult.homework_created?.length > 0 && ` · ${completionResult.homework_created.length} homework assignment(s) created`}
                {completionResult.session_log?.advancement_action && completionResult.session_log.advancement_action !== "remain" && ` · ${ADVANCEMENT_ACTIONS.find(a => a.key === completionResult.session_log.advancement_action)?.label || completionResult.session_log.advancement_action}`}
              </p>
              {completionResult.homework_conflicts?.length > 0 && (
                <div className="mt-2 pt-2 border-t border-shPrimary/20" data-testid="workspace-homework-conflicts">
                  <p className="text-[11px] font-black uppercase tracking-widest text-shAccent">Homework not created — already assigned</p>
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
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">Last session</p>
                    <p className="text-shText">{overview.last_session.note || "(no note)"}</p>
                    {overview.last_session.skills_worked?.length > 0 && (
                      <p className="text-shTextMuted mt-0.5">Worked on: {overview.last_session.skills_worked.map(s => s.name).filter(Boolean).join(", ")}</p>
                    )}
                  </div>
                )}
                {overview.homework_since_last_session?.length > 0 && (
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">Homework</p>
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
              <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">Today&apos;s Plan ({activities.length})</p>
              <button onClick={addCustomActivity} data-testid="add-custom-activity" className="text-[11px] text-shPrimary font-black uppercase tracking-widest"><i className="fas fa-plus mr-1"/>Custom Activity</button>
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
                               testid={`activity-${a.id}`}>
                  <ActivityDetail activity={a} actual={draft.actuals?.[a.id] || {}} onActualChange={(patch) => setActual(a.id, patch)}/>
                </ActivityCard>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-black uppercase tracking-widest text-shTextMuted"><i className="fas fa-note-sticky mr-1 text-shSecondary"/>Internal session note (staff only)</label>
              <textarea value={draft.session_note || ""} onChange={(e) => updateDraft({ session_note: e.target.value })}
                        rows={3} data-testid="workspace-session-note"
                        className="w-full mt-1 bg-black/20 border border-shBorder rounded p-2 text-shText text-sm"/>
            </div>
            <div>
              <label className="text-[11px] font-black uppercase tracking-widest text-shTextMuted"><i className="fas fa-comment-dots mr-1 text-shPrimary"/>Client recap note (sent after session)</label>
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
                      className="bg-transparent border border-shBorder text-shTextMuted px-4 py-2 rounded font-black text-[13px] uppercase tracking-widest">
                Save &amp; Close
              </button>
              <button onClick={() => setCompleting(true)} data-testid="workspace-complete-session"
                      className="bg-shPrimary text-bgHeader px-4 py-2 rounded font-black text-[13px] uppercase tracking-widest shadow">
                <i className="fas fa-flag-checkered mr-1.5"/>Complete Session
              </button>
            </>
          )}
        </div>
      </div>
      {completing && (
        <CompleteSessionModal
          activities={activities}
          actuals={draft.actuals || {}}
          onCancel={() => setCompleting(false)}
          onComplete={async (body) => {
            try {
              const { data } = await api.post(`/training-session-drafts/${draft.id}/complete`, body);
              setCompletionResult(data);
              setCompleting(false);
              toast.success("Session completed");
            } catch (e) {
              toast.error(formatErr(e?.response?.data?.detail) || "Could not complete session");
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

function RecordFields({ activity: a, actual, onChange }) {
  const actualChips = [
    { key: "duration_achieved", icon: "fa-stopwatch", label: "Duration", value: actual.duration_achieved, onChange: (v) => onChange({ duration_achieved: v }) },
    { key: "distance_achieved", icon: "fa-ruler", label: "Distance", value: actual.distance_achieved, onChange: (v) => onChange({ distance_achieved: v }) },
    { key: "repetitions_achieved", icon: "fa-rotate", label: "Reps", value: actual.repetitions_achieved, onChange: (v) => onChange({ repetitions_achieved: v }) },
    { key: "distraction_level", icon: "fa-volume-high", label: "Distraction", value: actual.distraction_level, onChange: (v) => onChange({ distraction_level: v }) },
    { key: "environment", icon: "fa-tree", label: "Environment", value: actual.environment, onChange: (v) => onChange({ environment: v }) },
    { key: "handler_assistance", icon: "fa-hand", label: "Handler Help", value: actual.handler_assistance, onChange: (v) => onChange({ handler_assistance: v }) },
    { key: "leash_off_leash", icon: "fa-link", label: "Leash", value: actual.leash_off_leash, onChange: (v) => onChange({ leash_off_leash: v }) },
  ];
  return (
    <div className="space-y-2 border-t border-shBorder pt-3">
      {!a.manual_only && (
        <div>
          <label className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">Skill level (0–5)</label>
          <div className="mt-1">
            <SkillLevelIndicator score={actual.score ?? -1} onChange={(n) => onChange({ score: n })} testid={`activity-${a.id}-score-picker`}/>
          </div>
        </div>
      )}
      <div>
        <label className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">Outcome</label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 mt-1">
          {OUTCOME_OPTIONS.map(o => (
            <button key={o.key} onClick={() => onChange({ outcome: o.key })}
                    className={`py-1.5 rounded text-[11px] font-black uppercase tracking-widest border ${actual.outcome === o.key ? o.color : "border-shBorder text-shTextMuted"}`}>
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">Today&apos;s numbers</label>
        <div className="mt-1">
          <MeasurementChips items={actualChips} testid={`activity-${a.id}-actuals`}/>
        </div>
      </div>
      <textarea value={actual.notes || ""} onChange={(e) => onChange({ notes: e.target.value })} placeholder="Internal notes for this activity (staff only — not sent to the client)"
                rows={2} className="w-full bg-black/20 border border-shBorder rounded p-2 text-shText text-[13px]"/>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-1.5 text-[12px] text-shText"><input type="checkbox" checked={!!actual.homework_eligible} onChange={(e) => onChange({ homework_eligible: e.target.checked })}/>Assign as homework</label>
        <label className="flex items-center gap-1.5 text-[12px] text-shText"><input type="checkbox" checked={!!actual.needs_reassessment} onChange={(e) => onChange({ needs_reassessment: e.target.checked })}/>Needs reassessment next visit</label>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ Completion */
function CompleteSessionModal({ activities, actuals, onCancel, onComplete }) {
  const [action, setAction] = useState("remain");
  const [reason, setReason] = useState("");
  const eligibleActivities = activities.filter(a => !a.skipped && (actuals[a.id] || {}).homework_eligible);
  const [homeworkIds, setHomeworkIds] = useState(() => new Set(eligibleActivities.map(a => a.id)));
  const [sendRecap, setSendRecap] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const needsReason = action === "skip_lesson";

  const toggleHomework = (id) => setHomeworkIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const submit = async () => {
    setSubmitting(true);
    try {
      await onComplete({
        advancement_action: action,
        advancement_reason: reason.trim() || null,
        homework_activity_ids: Array.from(homeworkIds),
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
            <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted mb-2">Advancement — you decide, not the system</p>
            <div className="space-y-1.5">
              {ADVANCEMENT_ACTIONS.map(opt => (
                <button key={opt.key} onClick={() => setAction(opt.key)} data-testid={`advancement-${opt.key}`}
                        className={`w-full text-left px-3 py-2 rounded border ${action === opt.key ? "bg-shPrimary/15 border-shPrimary text-shText" : "border-shBorder text-shTextMuted"}`}>
                  <p className="text-[13px] font-bold">{opt.label}</p>
                  <p className="text-[11px] opacity-80">{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>
          {(needsReason || action === "reopen_previous_lesson" || action === "assign_review") && (
            <div>
              <label className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">Reason {needsReason ? "(required)" : "(optional)"}</label>
              <input value={reason} onChange={(e) => setReason(e.target.value)} data-testid="advancement-reason"
                     className="w-full mt-1 bg-black/20 border border-shBorder rounded p-2 text-shText text-sm"/>
            </div>
          )}
          {eligibleActivities.length > 0 && (
            <div>
              <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted mb-2">Homework to assign</p>
              <div className="space-y-1.5">
                {eligibleActivities.map(a => (
                  <label key={a.id} className="flex items-center gap-2 text-[13px] text-shText">
                    <input type="checkbox" checked={homeworkIds.has(a.id)} onChange={() => toggleHomework(a.id)}/>
                    {a.name}
                  </label>
                ))}
              </div>
            </div>
          )}
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
