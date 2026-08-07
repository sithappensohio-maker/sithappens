import { useCallback, useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import { useConfirm } from "../lib/useConfirm";
import ProgressRing from "./ProgressRing";
import CollapsibleText from "./CollapsibleText";
import { ProgramEditor } from "./Programs";
import RecentTrainingSessionsPanel from "./RecentTrainingSessionsPanel";
import TrainingSessionWorkspace from "./TrainingSessionWorkspace";

/* ============================================================
 *  Replaces the old Training tab inside the dog edit modal.
 *  Shows active enrollment, history, and enroll/custom controls.
 * ============================================================ */
export default function DogTrainingTab({ dogId, dogName, dogAgeMonths = 0 }) {
  const confirm = useConfirm();
  const [meta, setMeta] = useState(null);
  const [enrollments, setEnrollments] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [schoolEnrollOpen, setSchoolEnrollOpen] = useState(false);
  const [schoolEnrollments, setSchoolEnrollments] = useState([]);
  const [customOpen, setCustomOpen] = useState(false);
  const [activeGoalEdit, setActiveGoalEdit] = useState(null);
  const [err, setErr] = useState("");
  // Gap-closing pass — launch the SAME TrainingSessionWorkspace / server-backed
  // draft pipeline Pipeline/Dashboard use, so every session goes through the one
  // idempotent completion path (session log, progress, advancement, homework)
  // instead of the old score-only modal's direct goal_progress write.
  const [workspaceFor, setWorkspaceFor] = useState(null);

  const load = useCallback(async () => {
    try {
      const [m, e, p, se] = await Promise.all([
        api.get("/programs/meta"),
        api.get(`/dogs/${dogId}/programs`),
        api.get("/programs"),
        api.get(`/dogs/${dogId}/school-enrollments`).catch(() => ({ data: [] })),
      ]);
      setMeta(m.data); setEnrollments(e.data); setPrograms(p.data); setSchoolEnrollments(se.data);
    } catch (er) { setErr(formatErr(er.response?.data?.detail) || "Load failed"); }
  }, [dogId]);
  useEffect(() => { if (dogId) load(); }, [dogId, load]);

  if (!meta) return <p className="text-shTextMuted text-sm py-6 text-center"><i className="fas fa-spinner fa-spin mr-2"/>Loading…</p>;

  const typeByKey = Object.fromEntries(meta.types.map(t => [t.key, t]));
  // Sit Happens Online School — list_dog_enrollments returns BOTH
  // trainer-led and online-delivered dog_programs rows (same collection,
  // additive delivery_channel field). Split them here so the trainer
  // toolset (Log Session/Complete/Set Current Week/manual goal edits)
  // never renders for a school-delivered row — those actions bypass the
  // school's own progression/practice gating and would confuse an admin.
  const activeAll = enrollments.filter(e => e.status === "active");
  const active = activeAll.filter(e => e.delivery_channel !== "online_school");
  const schoolActive = activeAll.filter(e => e.delivery_channel === "online_school");
  const history = enrollments.filter(e => e.status !== "active");
  const schoolEnrollmentsById = Object.fromEntries(schoolEnrollments.map(se => [se.enrollment_id, se]));
  const schoolCapablePrograms = programs.filter(p => (p.delivery_mode || "trainer_led") !== "trainer_led");

  const enrollIn = async (programId) => {
    try {
      await api.post(`/dogs/${dogId}/programs`, { program_id: programId });
      setEnrollOpen(false); load();
    } catch (e) { setErr(formatErr(e.response?.data?.detail) || "Enroll failed"); }
  };

  const schoolEnrollIn = async (programId) => {
    try {
      await api.post("/school/enroll", { dog_id: dogId, program_id: programId });
      setSchoolEnrollOpen(false); load();
    } catch (e) { setErr(formatErr(e.response?.data?.detail) || "Online School enroll failed"); }
  };

  const schoolUnenroll = async (enrollment) => {
    const ok = await confirm({
      title: `Remove ${dogName} from Online School?`,
      body: `${(enrollment.program_snapshot || {}).name || "This program"} will be removed from Online School. This clean-removes the enrollment (Phase 1 has no withdraw/history for school enrollments yet).`,
      confirmText: "Remove", tone: "danger",
    });
    if (!ok) return;
    try {
      const se = schoolEnrollmentsById[enrollment.id];
      if (se) await api.delete(`/school/enrollments/${se.id}`);
      load();
    } catch (e) { setErr(formatErr(e.response?.data?.detail) || "Failed to remove"); }
  };

  const updateStatus = async (eid, status) => {
    try { await api.put(`/dogs/${dogId}/programs/${eid}`, { status }); load(); }
    catch (e) { setErr(formatErr(e.response?.data?.detail)); }
  };

  // Soft-withdraw an active enrollment. Confirms first because this clears
  // the dog's run-sheet pointer; the record stays in History and can be
  // resumed later with the existing "Resume" button.
  const unenroll = async (enrollment) => {
    const snap = enrollment.program_snapshot || {};
    const ok = await confirm({
      title: `Unenroll ${dogName} from ${snap.name || "this program"}?`,
      body: `Progress (${enrollment.mastered_goals}/${enrollment.total_goals} mastered) and trainer notes are preserved in History. You can resume this enrollment any time.`,
      confirmText: "Unenroll",
      tone: "danger",
    });
    if (!ok) return;
    await updateStatus(enrollment.id, "withdrawn");
  };

  const updateTarget = async (eid, target_completion_date) => {
    try { await api.put(`/dogs/${dogId}/programs/${eid}`, { target_completion_date }); load(); }
    catch (e) { setErr(formatErr(e.response?.data?.detail)); }
  };

  const setGoal = async (eid, gid, patch) => {
    try { await api.put(`/dogs/${dogId}/programs/${eid}/goals/${gid}`, patch); load(); }
    catch (e) { setErr(formatErr(e.response?.data?.detail)); }
  };

  // Sprint 110di-64 — trainer bumps "this week" pointer (uses existing modules as weeks)
  const setCurrentModule = async (eid, moduleId) => {
    try { await api.put(`/dogs/${dogId}/programs/${eid}/current-module`, { module_id: moduleId }); load(); }
    catch (e) { setErr(formatErr(e.response?.data?.detail) || "Failed to set current week"); }
  };

  return (
    <div className="space-y-4" data-testid="dog-training-tab">
      {err && <div className="text-[15px] text-red-400 bg-red-500/10 rounded p-2 uppercase font-black">{err}</div>}

      {/* Enroll dropdown */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[15px] font-black uppercase tracking-widest text-shTextMuted">{active.length>0 ? `${active.length} active enrollment${active.length>1?"s":""}` : "No active programs"}</p>
        <div className="flex gap-2">
          <button onClick={()=>setEnrollOpen(true)} data-testid="enroll-btn"
                  className="bg-shSecondary text-shText px-4 py-2 rounded font-black text-[15px] uppercase tracking-widest shadow">
            <i className="fas fa-graduation-cap mr-1"/>Enroll
          </button>
          <button onClick={()=>setSchoolEnrollOpen(true)} data-testid="school-enroll-btn"
                  className="bg-shPrimary/15 text-shPrimary border border-shPrimary/40 px-4 py-2 rounded font-black text-[15px] uppercase tracking-widest">
            <i className="fas fa-graduation-cap mr-1"/>Online School
          </button>
          <button onClick={()=>setCustomOpen(true)} data-testid="custom-btn"
                  className="bg-pink-500/15 text-pink-300 border border-pink-500/50 px-4 py-2 rounded font-black text-[15px] uppercase tracking-widest">
            <i className="fas fa-wand-magic-sparkles mr-1"/>Custom
          </button>
        </div>
      </div>

      {/* Active enrollments (multi) */}
      {active.length > 0 ? (
        active.map(e => (
          <EnrollmentCard key={e.id} enrollment={e} typeMeta={typeByKey[e.program_snapshot.type]} dogId={dogId}
                          onStatus={(s)=>updateStatus(e.id, s)}
                          onUnenroll={()=>unenroll(e)}
                          onTargetDate={(d)=>updateTarget(e.id, d)}
                          onCurrentModule={(mid)=>setCurrentModule(e.id, mid)}
                          onGoal={(gid, patch)=>setGoal(e.id, gid, patch)}
                          onOpenWorkspace={()=>setWorkspaceFor({ dog_id: dogId, enrollment_id: e.id })} />
        ))
      ) : (
        <div className="bg-[var(--sh-card-base)]/40 border border-dashed border-shBorder rounded p-6 text-center" data-testid="no-active">
          <i className="fas fa-graduation-cap text-shSecondary text-3xl mb-2"/>
          <p className="text-sm font-black text-shText uppercase tracking-tight">No active training program</p>
          <p className="text-[14px] text-shTextMuted mt-1">Enroll {dogName} in a standard program or build a custom plan.</p>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <details className="bg-[var(--sh-card-base)]/40 border border-shBorder rounded p-3" data-testid="enrollment-history">
          <summary className="cursor-pointer text-[15px] font-black uppercase tracking-widest text-shSecondary">History · {history.length}</summary>
          <div className="mt-3 space-y-2">
            {history.map(h => (
              <div key={h.id} className="bg-[var(--sh-card-base)] rounded p-3 border border-shBorder">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-black text-shText">{h.program_snapshot.name}</p>
                    <p className="text-[15px] text-shTextMuted">{h.status.toUpperCase()} · {h.mastered_goals}/{h.total_goals} mastered ({h.mastered_pct}%)</p>
                  </div>
                  {h.status !== "active" && (
                    <button onClick={()=>updateStatus(h.id, "active")} data-testid={`resume-${h.id}`}
                            className="text-[14px] font-black uppercase tracking-widest text-shSecondary hover:text-shText">Resume</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Sit Happens Online School (Phase 1) — a school-delivered enrollment
          is a real dog_programs row (same collection, delivery_channel=
          "online_school"), rendered here as its own compact read-only card
          rather than through EnrollmentCard — the trainer session/goal
          tools there don't apply to a self-guided enrollment. */}
      {schoolActive.length > 0 && (
        <div className="bg-shPrimary/5 border border-shPrimary/30 rounded-lg p-3 space-y-2" data-testid="school-active-section">
          <p className="text-[13px] font-black uppercase tracking-widest text-shPrimary"><i className="fas fa-graduation-cap mr-1.5"/>Online School</p>
          {schoolActive.map(e => (
            <div key={e.id} className="bg-[var(--sh-card-base)] rounded p-3 border border-shBorder flex items-center justify-between gap-3"
                 data-testid={`school-enrollment-${e.id}`}>
              <div className="min-w-0">
                <p className="text-sm font-black text-shText truncate">{e.program_snapshot.name}</p>
                <p className="text-[13px] text-shTextMuted">{e.mastered_goals}/{e.total_goals} skills mastered ({e.mastered_pct}%) · Started {e.started_at}</p>
              </div>
              <button onClick={()=>schoolUnenroll(e)} data-testid={`school-unenroll-${e.id}`}
                      className="shrink-0 text-red-400 hover:text-red-300 text-[13px] font-black uppercase tracking-widest whitespace-nowrap">
                <i className="fas fa-user-minus mr-1"/>Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Enroll modal */}
      {enrollOpen && (
        <EnrollModal programs={programs.filter(p => p.type !== "custom" || p.owner_dog_id === dogId)}
                     dogAgeMonths={dogAgeMonths} typeMeta={typeByKey}
                     onPick={enrollIn} onClose={()=>setEnrollOpen(false)} />
      )}

      {/* Online School enroll modal */}
      {schoolEnrollOpen && (
        <SchoolEnrollModal programs={schoolCapablePrograms} typeMeta={typeByKey}
                            onPick={schoolEnrollIn} onClose={()=>setSchoolEnrollOpen(false)} />
      )}

      {/* Custom program builder */}
      {customOpen && (
        <CustomProgramBuilder dogId={dogId} dogName={dogName} meta={meta}
                              onClose={()=>setCustomOpen(false)}
                              onCreated={()=>{ setCustomOpen(false); load(); }} />
      )}

      {/* Gap-closing pass — same TrainingSessionWorkspace instance Pipeline/Dashboard use */}
      {workspaceFor && (
        <TrainingSessionWorkspace
          dogId={workspaceFor.dog_id}
          enrollmentId={workspaceFor.enrollment_id}
          onClose={()=>setWorkspaceFor(null)}
          onSaved={()=>{ setWorkspaceFor(null); load(); }}
        />
      )}
    </div>
  );
}

function EnrollmentCard({ enrollment, typeMeta, dogId, onStatus, onUnenroll, onTargetDate, onCurrentModule, onGoal, onOpenWorkspace }) {
  const color = typeMeta?.color || "#00a9e0";
  const snap = enrollment.program_snapshot;
  const [editTarget, setEditTarget] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const overdue = enrollment.target_completion_date && enrollment.target_completion_date < new Date().toISOString().slice(0,10);
  // Sprint 110di-64 — Use the existing modules array as weekly lessons.
  const totalWeeks = enrollment.total_weeks || (snap.modules || []).length;
  const currentWeek = enrollment.current_week || 1;
  return (
    <div className="bg-[var(--sh-card-base)]/60 border border-shBorder rounded-lg overflow-hidden" data-testid={`enrollment-${enrollment.id}`}>
      <div className="px-3 sm:px-4 py-3 border-b border-shBorder" style={{background: color + "10"}}>
        <div className="flex items-center gap-3 sm:gap-4">
          <ProgressRing percent={enrollment.mastered_pct} size={64} stroke={6} color={color}
                        label={`${enrollment.mastered_goals}/${enrollment.total_goals}`} />
          <div className="flex-1 min-w-0">
            <p className="text-[13px] sm:text-[14px] font-black uppercase tracking-widest" style={{color}}>{typeMeta?.label || snap.type}</p>
            <p className="text-sm sm:text-base font-black text-shText truncate">{snap.name}</p>
          </div>
          <div className="flex flex-col gap-1 shrink-0">
            <button onClick={onOpenWorkspace} data-testid={`open-session-${enrollment.id}`}
                    className="bg-shPrimary/20 text-shPrimary border border-shPrimary/40 px-3 py-1.5 rounded font-black text-[13px] sm:text-[14px] uppercase tracking-widest hover:bg-shPrimary/30 transition whitespace-nowrap shadow">
              <i className="fas fa-paw mr-1"/>Log Session
            </button>
            <button onClick={()=>onStatus("completed")} data-testid={`complete-${enrollment.id}`}
                    className="bg-shPrimary text-bgHeader px-3 py-1.5 rounded font-black text-[13px] sm:text-[14px] uppercase tracking-widest shadow whitespace-nowrap"><i className="fas fa-flag-checkered mr-1"/>Complete</button>
            <button onClick={()=>onStatus("on_hold")} data-testid={`hold-${enrollment.id}`}
                    className="text-shTextMuted hover:text-shText text-[13px] sm:text-[14px] font-black uppercase tracking-widest whitespace-nowrap"><i className="fas fa-pause mr-1"/>On Hold</button>
            <button onClick={onUnenroll} data-testid={`unenroll-${enrollment.id}`}
                    className="text-red-400 hover:text-red-300 text-[13px] sm:text-[14px] font-black uppercase tracking-widest whitespace-nowrap"><i className="fas fa-user-minus mr-1"/>Unenroll</button>
          </div>
        </div>
        {snap.focus && (
          <CollapsibleText text={snap.focus} maxChars={70} className="mt-2"
                           testid={`enrollment-focus-${enrollment.id}`} />
        )}
        <div className="flex items-center gap-2 flex-wrap mt-2">
          <p className="text-[13px] sm:text-[14px] text-shTextMuted font-black uppercase tracking-widest">Started {enrollment.started_at}</p>
          {editTarget ? (
            <input type="date" defaultValue={enrollment.target_completion_date||""}
                   onBlur={(e)=>{ if (e.target.value !== enrollment.target_completion_date) onTargetDate(e.target.value); setEditTarget(false); }}
                   data-testid={`target-date-input-${enrollment.id}`}
                   className="bg-[var(--sh-card-base)] border border-shBorder rounded px-1 text-[14px] text-shText" style={{colorScheme:"dark"}} autoFocus />
          ) : (
            <button onClick={()=>setEditTarget(true)} data-testid={`target-date-${enrollment.id}`}
                    className={`text-[13px] sm:text-[14px] font-black uppercase tracking-widest hover:text-shText ${overdue?"text-red-400":"text-shTextMuted"}`}>
              <i className="fas fa-calendar-day mr-1"/>Target: {enrollment.target_completion_date || "—"}{overdue && " (overdue)"}
            </button>
          )}
          {/* Sprint 110di-64 — Trainer's "what week am I focused on" pill */}
          {totalWeeks > 0 && (
            <button onClick={()=>setPlanOpen(true)} data-testid={`week-pill-${enrollment.id}`}
                    className="bg-shPrimary/15 text-shPrimary border border-shPrimary/40 px-3 py-0.5 rounded-full font-black text-[12px] uppercase tracking-widest hover:bg-shPrimary/25 transition">
              <i className="fas fa-calendar-week mr-1.5"/>Week {currentWeek} of {totalWeeks}
              <span className="ml-1.5 text-[11px] opacity-70">· Plan</span>
            </button>
          )}
        </div>
      </div>

      <div className="px-2 sm:px-3 py-2 space-y-4">
        <p className="px-2 text-[12px] text-shTextMuted italic">
          Quick corrections only — use <span className="text-shPrimary font-black not-italic">Log Session</span> above to record an actual training appointment.
        </p>
        {snap.modules.map((m, idx) => (
          <div key={m.id} className={`px-2 py-2 ${idx === 0 ? "" : "mt-1"}`}>
            <p className="text-[15px] font-black uppercase tracking-widest text-shSecondary mb-2">{m.name}</p>
            <div className="space-y-1">
              {m.goals.map(g => {
                const p = enrollment.goal_progress?.[g.id] || { score: 0, status: "not_started", notes: "" };
                return <GoalRow key={g.id} goal={g} progress={p} onChange={(patch)=>onGoal(g.id, patch)} />;
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Sprint 110di-70 — Recent training sessions timeline */}
      <RecentTrainingSessionsPanel
        dogId={dogId}
        enrollmentId={enrollment.id}
        modules={snap.modules || []}
      />

      {/* Sprint 110di-64 — Weekly lesson plan timeline (trainer-only) */}
      {planOpen && (
        <LessonPlanTimelineModal enrollment={enrollment} color={color}
                                 onPickModule={(mid)=>{ onCurrentModule(mid); }}
                                 onClose={()=>setPlanOpen(false)} />
      )}
    </div>
  );
}


function LessonPlanTimelineModal({ enrollment, color, onPickModule, onClose }) {
  const snap = enrollment.program_snapshot || {};
  const modules = (snap.modules || []).slice().sort((a,b)=>(a.order??0)-(b.order??0));
  const currentId = enrollment.current_module?.id || enrollment.current_module_id;
  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
         onMouseDown={(e)=>{ if (e.target===e.currentTarget) onClose(); }}
         data-testid={`lesson-plan-modal-${enrollment.id}`}>
      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-2xl shadow-2xl max-h-[calc(var(--app-height)_-_2rem)] overflow-hidden flex flex-col min-h-0">
        <div className="px-5 py-4 border-b border-shBorder flex items-center justify-between" style={{background: color + "10"}}>
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.3em]" style={{color}}>Lesson Plan · Trainer view</p>
            <h3 className="text-lg font-black text-shText uppercase tracking-tight">{snap.name}</h3>
          </div>
          <button onClick={onClose} className="text-shTextMuted hover:text-shText text-xl"><i className="fas fa-times"/></button>
        </div>
        <div className="overflow-y-auto p-5 space-y-3">
          {modules.length === 0 && (
            <p className="text-shTextMuted text-center py-8 text-sm">No weeks defined yet — add modules to this program in Settings → Programs to build out your weekly plan.</p>
          )}
          {modules.map((m, idx) => {
            const isCurrent = m.id === currentId;
            const isPast = currentId && modules.findIndex(x=>x.id===currentId) > idx;
            const goalCount = (m.goals || []).length;
            const mastered = (m.goals || []).filter(g => {
              const p = enrollment.goal_progress?.[g.id] || {};
              return p.status === "mastered" || (p.score || 0) >= 4;
            }).length;
            return (
              <div key={m.id} data-testid={`lesson-week-${enrollment.id}-${idx+1}`}
                   className={`border rounded-lg p-3 transition ${isCurrent ? "bg-[var(--sh-card-base)] border-shPrimary shadow-lg shadow-shPrimary/10" : isPast ? "bg-[var(--sh-card-base)]/30 border-shBorder opacity-60" : "bg-[var(--sh-card-base)]/60 border-shBorder"}`}>
                <div className="flex items-start gap-3">
                  <div className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center font-black text-sm border-2 ${isCurrent ? "bg-shPrimary text-bgHeader border-shPrimary" : isPast ? "bg-shSurfaceRaised text-shTextMuted border-shBorder" : "text-shSecondary border-shSecondary/60"}`}>
                    {isPast ? <i className="fas fa-check"/> : idx + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className="text-[12px] font-black uppercase tracking-widest text-shTextMuted">Week {idx + 1}</p>
                      {isCurrent ? (
                        <span className="text-[11px] font-black uppercase tracking-widest text-shPrimary bg-shPrimary/15 px-2 py-0.5 rounded-full"><i className="fas fa-bullseye mr-1"/>Focus this week</span>
                      ) : (
                        <button onClick={()=>onPickModule(m.id)} data-testid={`lesson-week-set-${enrollment.id}-${idx+1}`}
                                className="text-[11px] font-black uppercase tracking-widest text-shSecondary hover:text-shText">
                          Set as current
                        </button>
                      )}
                    </div>
                    <p className="text-sm font-black text-shText mt-0.5">{m.name}</p>
                    {m.description && <p className="text-[14px] text-shTextMuted mt-1 leading-snug">{m.description}</p>}
                    {goalCount > 0 && (
                      <div className="mt-2 space-y-1">
                        <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">Skills · {mastered}/{goalCount} mastered</p>
                        <ul className="text-[13px] text-shTextMuted space-y-0.5">
                          {(m.goals || []).map(g => {
                            const p = enrollment.goal_progress?.[g.id] || {};
                            const done = p.status === "mastered" || (p.score || 0) >= 4;
                            return (
                              <li key={g.id} className={`flex items-center gap-2 ${done ? "line-through text-shTextMuted" : ""}`}>
                                <i className={`fas ${done ? "fa-circle-check text-shPrimary" : "fa-circle text-gray-600"} text-[11px]`}/>
                                <span>{g.name}</span>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="px-5 py-3 border-t border-shBorder bg-[var(--sh-card-base)]/40 text-[12px] text-shTextMuted">
          <i className="fas fa-circle-info mr-1"/>Tap <span className="text-shSecondary font-black">Set as current</span> to bump the week pointer. Skills check off automatically when you mark a goal mastered on the main training tab.
        </div>
      </div>
    </div>
  );
}

// Quick single-skill correction grid (e.g. fixing a data-entry mistake) —
// NOT a session-recording tool. Writes goal_progress directly via
// update_goal, with no session log, advancement, or homework side effects.
// Use "Log Session" (TrainingSessionWorkspace) to record an actual
// training appointment.
const STATUS_PRESETS = [
  { key: "not_started", label: "Not Started", score: 0, cls: "bg-gray-500/20 text-shTextMuted border-gray-500/30" },
  { key: "in_progress", label: "Learning",    score: 2, cls: "bg-shSecondary/20 text-shSecondary border-shSecondary/30" },
  { key: "in_progress", label: "Proficient",  score: 3, cls: "bg-shAccent/20 text-shAccent border-shAccent/30" },
  { key: "mastered",    label: "Mastered",    score: 5, cls: "bg-shPrimary/20 text-shPrimary border-shPrimary/40" },
];

function presetIndex(progress) {
  const sc = progress.score || 0;
  if (progress.status === "mastered" || sc >= 4) return 3;
  if (sc >= 3) return 2;
  if (progress.status === "in_progress" || sc >= 1) return 1;
  return 0;
}

function GoalRow({ goal, progress, onChange }) {
  const [openNote, setOpenNote] = useState(false);
  const [note, setNote] = useState(progress.notes || "");
  useEffect(() => { setNote(progress.notes || ""); }, [progress.notes]);
  const isManual = !!goal.manual_only;
  const isDone = progress.status === "mastered" || progress.score >= 4;
  const activeIdx = presetIndex(progress);
  return (
    <div className="bg-[var(--sh-card-base)] rounded px-3 py-2" data-testid={`goal-${goal.id}`}>
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-black text-shText">{goal.name} {isManual && <span className="text-[12px] text-pink-300 ml-2 tracking-widest">[MANUAL]</span>}</p>
          {goal.description && <p className="text-[14px] text-shTextMuted">{goal.description}</p>}
        </div>
        <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
          {isManual ? (
            <button onClick={()=>onChange({ score: isDone ? 0 : 5, status: isDone ? "not_started" : "mastered" })}
                    data-testid={`goal-toggle-${goal.id}`}
                    className={`px-3 py-1 rounded text-[14px] font-black uppercase tracking-widest border ${isDone?"bg-shPrimary text-bgHeader border-shPrimary":"text-shTextMuted border-shBorder hover:text-shText"}`}>
              <i className={`fas ${isDone?"fa-check":"fa-square"} mr-1`}/>{isDone?"Done":"Mark Done"}
            </button>
          ) : (
            <div className="flex gap-1 flex-wrap">
              {STATUS_PRESETS.map((btn, i) => (
                <button key={btn.label}
                        onClick={()=>onChange({ status: btn.key, score: btn.score })}
                        data-testid={`goal-status-${goal.id}-${btn.label.toLowerCase().replace(/\s+/g,'-')}`}
                        title={btn.label}
                        className={`px-2 py-1 rounded text-[11px] font-black uppercase tracking-widest border transition ${
                          activeIdx === i ? `${btn.cls} ring-2 ring-white/10` : "bg-[var(--sh-card-base)] text-shTextMuted border-shBorder hover:text-shText"
                        }`}>
                  {btn.label}
                </button>
              ))}
            </div>
          )}
          <button onClick={()=>setOpenNote(o=>!o)} className="text-shTextMuted hover:text-shText text-xs px-2 py-1"><i className="fas fa-note-sticky"/></button>
        </div>
      </div>
      {openNote && (
        <div className="mt-2 flex gap-2">
          <input value={note} onChange={(e)=>setNote(e.target.value)}
                 onBlur={()=>{ if (note !== progress.notes) onChange({ notes: note }); setOpenNote(false); }}
                 onKeyDown={(e)=>{ if (e.key === "Enter") { onChange({ notes: note }); setOpenNote(false); } }}
                 placeholder="Internal trainer note (staff only, not sent to the client)"
                 className="flex-1 bg-[var(--sh-card-base)] border border-shBorder rounded p-1.5 text-[15px] text-shText" autoFocus />
        </div>
      )}
      {!openNote && progress.notes && <p className="text-[14px] text-shTextMuted italic mt-1 pl-1">&quot;{progress.notes}&quot;</p>}
    </div>
  );
}

function EnrollModal({ programs, dogAgeMonths, typeMeta, onPick, onClose }) {
  const grouped = Object.values(typeMeta).map(t => ({ ...t, items: programs.filter(p => p.type === t.key) }));
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" data-testid="enroll-modal">
      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-2xl max-h-[calc(var(--app-height)_-_2rem)] flex flex-col min-h-0 shadow-2xl">
        <div className="px-6 py-4 border-b border-shBorder flex items-center justify-between shrink-0">
          <h4 className="text-base font-black text-shText uppercase italic">Enroll in Program</h4>
          <button onClick={onClose} className="text-shTextMuted hover:text-shText"><i className="fas fa-times text-xl"/></button>
        </div>
        <div className="overflow-y-auto flex-1 min-h-0 p-4 space-y-4">
          {grouped.filter(g => g.items.length > 0).map(g => (
            <div key={g.key}>
              <p className="text-[15px] font-black uppercase tracking-widest mb-2" style={{color: g.color}}>{g.label}</p>
              <div className="space-y-2">
                {g.items.map(p => {
                  const tooYoung = dogAgeMonths > 0 && p.min_age_months > dogAgeMonths;
                  return (
                    <button key={p.id} onClick={()=>onPick(p.id)} data-testid={`enroll-pick-${p.id}`}
                            className="w-full text-left bg-[var(--sh-card-base)]/60 border border-shBorder hover:border-shSecondary rounded p-3 transition">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-black text-shText">{p.name}</p>
                          <p className="text-[15px] text-shTextMuted mt-0.5">{p.focus}</p>
                          <p className="text-[14px] text-shTextMuted font-black uppercase tracking-widest mt-1">
                            {p.modules.length} modules · {p.modules.reduce((a,m)=>a+m.goals.length,0)} goals · {p.format?.count} {p.format?.unit}
                          </p>
                        </div>
                        {tooYoung && (
                          <span className="shrink-0 text-[14px] font-black uppercase tracking-widest text-shAccent px-2 py-1 bg-shAccent/15 rounded">
                            <i className="fas fa-triangle-exclamation mr-1"/>Under {p.min_age_months}mo
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Sit Happens Online School (Phase 1) — same picker shell as EnrollModal,
// filtered upstream to only delivery_mode in (self_guided, both) programs
// (schoolCapablePrograms). Deliberately simpler than EnrollModal — no
// age-gate/module-count chrome yet, just name + focus, since Phase 1 is
// manual-enrollment-only and the picker exists for a trainer who already
// knows which curriculum they're placing the client into.
function SchoolEnrollModal({ programs, typeMeta, onPick, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" data-testid="school-enroll-modal">
      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-2xl max-h-[calc(var(--app-height)_-_2rem)] flex flex-col min-h-0 shadow-2xl">
        <div className="px-6 py-4 border-b border-shBorder flex items-center justify-between shrink-0">
          <div>
            <h4 className="text-base font-black text-shText uppercase italic"><i className="fas fa-graduation-cap mr-1.5 text-shPrimary"/>Enroll in Online School</h4>
            <p className="text-[12px] text-shTextMuted">Only programs configured for Self-Guided or Both delivery are shown.</p>
          </div>
          <button onClick={onClose} className="text-shTextMuted hover:text-shText"><i className="fas fa-times text-xl"/></button>
        </div>
        <div className="overflow-y-auto flex-1 min-h-0 p-4 space-y-2">
          {programs.length === 0 && (
            <p className="text-[13px] text-shTextMuted text-center py-8">No programs are configured for Online School yet — set a program's Delivery Mode to Self-Guided or Both in Program Studio.</p>
          )}
          {programs.map(p => (
            <button key={p.id} onClick={()=>onPick(p.id)} data-testid={`school-enroll-pick-${p.id}`}
                    className="w-full text-left bg-[var(--sh-card-base)]/60 border border-shBorder hover:border-shPrimary rounded p-3 transition">
              <p className="text-sm font-black text-shText">{p.name}</p>
              <p className="text-[15px] text-shTextMuted mt-0.5">{p.focus}</p>
              <p className="text-[14px] text-shTextMuted font-black uppercase tracking-widest mt-1">
                {p.modules.length} modules · {typeMeta[p.type]?.label || p.type}
              </p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function CustomProgramBuilder({ dogId, dogName, meta, onClose, onCreated }) {
  const [program, setProgram] = useState({
    name: `${dogName} — Custom Plan`,
    description: "", focus: "",
    format: { count: 4, unit: "sessions" },
    modules: [{ name: "Phase 1", description: "", goals: [{ name: "First goal", description: "" }] }],
  });
  const [saveErr, setSaveErr] = useState("");
  const save = async () => {
    setSaveErr("");
    try {
      await api.post(`/dogs/${dogId}/programs/custom`, program);
      onCreated?.();
    } catch (e) { setSaveErr(formatErr(e.response?.data?.detail) || "Save failed"); }
  };
  return <ProgramEditor program={program} setProgram={setProgram} meta={meta} hideTypePicker={true} onSave={save} onClose={onClose} extraError={saveErr} />;
}
