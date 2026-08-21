import { useCallback, useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import { useConfirm, usePromptDialog } from "../lib/useConfirm";
import ProgressRing from "./ProgressRing";
import CollapsibleText from "./CollapsibleText";
import { ProgramEditor } from "./Programs";
import RecentTrainingSessionsPanel from "./RecentTrainingSessionsPanel";
import TrainingSessionWorkspace from "./TrainingSessionWorkspace";
import NeonEdge from "./premium/NeonEdge";
import HuskyDogImage from "./brand/HuskyDogImage";

/* ============================================================
 *  Replaces the old Training tab inside the dog edit modal.
 *  Shows active enrollment, history, and enroll/custom controls.
 * ============================================================ */
export default function DogTrainingTab({ dogId, dogName, dogAgeMonths = 0 }) {
  const confirm = useConfirm();
  const promptDialog = usePromptDialog();
  const [meta, setMeta] = useState(null);
  const [enrollments, setEnrollments] = useState([]);
  const [programs, setPrograms] = useState([]);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignErr, setAssignErr] = useState("");
  const [assignBusy, setAssignBusy] = useState(false);
  const [schoolEnrollments, setSchoolEnrollments] = useState([]);
  const [customOpen, setCustomOpen] = useState(false);
  const [activeGoalEdit, setActiveGoalEdit] = useState(null);
  const [err, setErr] = useState("");
  // Gap-closing pass — launch the SAME TrainingSessionWorkspace / server-backed
  // draft pipeline Pipeline/Dashboard use, so every session goes through the one
  // idempotent completion path (session log, progress, advancement, homework)
  // instead of the old score-only modal's direct goal_progress write.
  const [workspaceFor, setWorkspaceFor] = useState(null);

  // Distinguishes "still loading" from "loaded and genuinely empty" from
  // "failed to load" — the assign picker needs all three, and a single
  // `programs = []` cannot tell them apart.
  const [loadState, setLoadState] = useState("loading");   // loading | ready | error
  const load = useCallback(async () => {
    setLoadState("loading");
    try {
      const [m, e, p, se] = await Promise.all([
        api.get("/programs/meta"),
        api.get(`/dogs/${dogId}/programs`),
        api.get("/programs"),
        api.get(`/dogs/${dogId}/school-enrollments`).catch(() => ({ data: [] })),
      ]);
      setMeta(m.data); setEnrollments(e.data); setPrograms(p.data); setSchoolEnrollments(se.data);
      setLoadState("ready");
    } catch (er) {
      setErr(formatErr(er.response?.data?.detail) || "Load failed");
      setLoadState("error");
    }
  }, [dogId]);
  useEffect(() => { if (dogId) load(); }, [dogId, load]);

  if (!meta && loadState === "error") return (
    <div className="py-8 text-center space-y-3" data-testid="dog-training-load-error">
      <p className="text-shText text-sm font-black"><i className="fas fa-triangle-exclamation mr-2 text-shAccent"/>Couldn&apos;t load training programs.</p>
      <p className="text-shTextMuted text-[12px]">{err || "The server didn't respond."}</p>
      <button type="button" onClick={load} data-testid="dog-training-retry"
              className="px-4 py-2 rounded-xl border border-shSecondary/40 text-shSecondary text-[11px] font-black uppercase tracking-widest">
        <i className="fas fa-rotate-right mr-1.5"/>Try again</button>
    </div>
  );
  if (!meta) return <p className="text-shTextMuted text-sm py-6 text-center"><i className="fas fa-spinner fa-spin mr-2"/>Loading…</p>;

  const typeByKey = Object.fromEntries(meta.types.map(t => [t.key, t]));
  // Sit Happens Online School — list_dog_enrollments returns BOTH
  // trainer-led and online-delivered dog_programs rows (same collection,
  // additive delivery_channel field). Split them here so the trainer
  // toolset (Log Session/Complete/Set Current Week/manual goal edits)
  // never renders for a school-delivered row — those actions bypass the
  // school's own progression/practice gating and would confuse an admin.
  const activeAll = enrollments.filter(e => e.status === "active");
  // In-person and hybrid School enrollments still use the trainer-session
  // workspace; online-only rows use the self-guided School card below.
  const active = activeAll.filter(e => e.delivery_channel !== "online_school");
  const schoolActive = activeAll.filter(e => e.delivery_channel === "online_school");
  const history = enrollments.filter(e => e.status !== "active" && e.delivery_channel !== "online_school");
  // Phase 6 — completed/withdrawn Online School rows get their OWN section
  // (below), never the generic trainer-led History block: that block's
  // "Resume" button calls PUT /dogs/{id}/programs/{id} with status=
  // "active", which the server explicitly 409s for delivery_channel==
  // "online_school" (that endpoint has always meant "trainer-led enrollment
  // controls" — see update_enrollment's own guard).
  const schoolHistory = enrollments.filter(e => e.status !== "active" && e.delivery_channel === "online_school");
  const schoolEnrollmentsById = Object.fromEntries(schoolEnrollments.map(se => [se.enrollment_id, se]));
  const assignSchoolProgram = async ({ programId, deliveryMode, assignedTrainerId, startedAt, targetCompletionDate }) => {
    if (assignBusy) return;
    setAssignBusy(true); setAssignErr("");
    try {
      await api.post("/school/enroll", {
        dog_id: dogId, program_id: programId, delivery_mode: deliveryMode,
        assigned_trainer_id: assignedTrainerId || null,
        started_at: startedAt || null, target_completion_date: targetCompletionDate || null,
      });
      setAssignOpen(false);
      await load();
    } catch (e) {
      setAssignErr(formatErr(e.response?.data?.detail) || "Program assignment failed");
    } finally {
      setAssignBusy(false);
    }
  };

  // Case A only — a mistaken/test enrollment with zero checkpoint history.
  // The server itself refuses this once real checkpoint history exists
  // (409, pointing staff at Withdraw Student instead), so this stays safe
  // even if clicked on a history-bearing row by mistake.
  const schoolUnenroll = async (enrollment) => {
    const ok = await confirm({
      title: `Remove ${dogName} from Online School?`,
      body: `${(enrollment.program_snapshot || {}).name || "This program"} will be permanently removed. Only works for an enrollment with no checkpoint history yet — use Withdraw Student for one with real progress.`,
      confirmText: "Remove", tone: "danger",
    });
    if (!ok) return;
    try {
      const se = schoolEnrollmentsById[enrollment.id];
      if (se) await api.delete(`/school/enrollments/${se.id}`);
      load();
    } catch (e) { setErr(formatErr(e.response?.data?.detail) || "Failed to remove"); }
  };

  // Phase 6 — Withdraw Student: the history-preserving replacement for
  // hard-delete once a school enrollment has real checkpoint activity.
  const schoolWithdraw = async (enrollment) => {
    const courseName = (enrollment.program_snapshot || {}).name || "this course";
    const reason = await promptDialog({
      title: `Withdraw ${dogName} from ${courseName}?`,
      body: "A withdrawal reason is required and will be recorded on the enrollment history.",
      placeholder: "Reason for withdrawal",
      confirmText: "Continue",
      tone: "warning",
    });
    if (reason === null) return;
    if (!reason.trim()) { setErr("A withdrawal reason is required."); return; }
    const revokeAccess = await confirm({
      title: "Revoke course access too?",
      body: "Revoke Access blocks the student from course content. Keep Read-Only preserves historical course access without resuming training.",
      confirmText: "Revoke Access",
      cancelText: "Keep Read-Only",
      tone: "warning",
    });
    try {
      const se = schoolEnrollmentsById[enrollment.id];
      if (se) await api.post(`/school/enrollments/${se.id}/withdraw`, { reason: reason.trim(), revoke_access: revokeAccess });
      load();
    } catch (e) { setErr(formatErr(e.response?.data?.detail) || "Failed to withdraw"); }
  };

  // Phase 6 — independent access toggle, usable at any training status
  // (this is also the mechanism behind the refund/revocation policy: a
  // refund never deletes training history, it revokes access here).
  const schoolSetAccess = async (enrollment, accessState) => {
    let reason = "";
    if (accessState === "revoked") {
      const entered = await promptDialog({
        title: `Revoke ${dogName}'s course access?`,
        body: "The reason is optional and is kept with the access change for staff history.",
        placeholder: "Optional reason",
        confirmText: "Revoke Access",
        tone: "warning",
      });
      if (entered === null) return;
      reason = entered.trim();
    }
    try {
      const se = schoolEnrollmentsById[enrollment.id];
      if (se) await api.post(`/school/enrollments/${se.id}/access`, { access_state: accessState, reason });
      load();
    } catch (e) { setErr(formatErr(e.response?.data?.detail) || "Failed to update access"); }
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

      {/* One School assignment workflow for every delivery mode. */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[15px] font-black uppercase tracking-widest text-shTextMuted">{activeAll.length>0 ? `${activeAll.length} active School program${activeAll.length>1?"s":""}` : "No active School programs"}</p>
          <p className="text-[11px] text-shTextMuted mt-0.5">One curriculum system · in person, online, or hybrid</p>
        </div>
        <div className="flex gap-2">
          <button onClick={()=>{ setAssignErr(""); setAssignOpen(true); }} data-testid="school-assign-btn"
                  className="bg-shSecondary text-shText px-4 py-2 rounded font-black text-[15px] uppercase tracking-widest shadow">
            <i className="fas fa-graduation-cap mr-1"/>Assign Program
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
      ) : activeAll.length === 0 ? (
        // Gate on activeAll, not `active`: an online_school enrollment is filtered
        // out of `active` (it renders in the Online School block below), so keying
        // the empty state off `active` told a dog with a live online enrollment it
        // had "no active training program" right above its own active card.
        <div className="bg-[var(--sh-card-base)]/40 border border-dashed border-shBorder rounded p-6 text-center" data-testid="no-active">
          <i className="fas fa-graduation-cap text-shSecondary text-3xl mb-2"/>
          <p className="text-sm font-black text-shText uppercase tracking-tight">No active training program</p>
          <p className="text-[14px] text-shTextMuted mt-1">Enroll {dogName} in a standard program or build a custom plan.</p>
        </div>
      ) : null}

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

      {/* Sit Happens Online School — a school-delivered enrollment is a real
          dog_programs row (same collection, delivery_channel="online_school"),
          rendered here as its own card rather than through EnrollmentCard —
          the trainer session/goal tools there don't apply to a self-guided
          enrollment. Phase 6 adds lifecycle visibility (status/access/
          provenance), Withdraw Student, and the access revoke/restore toggle. */}
      {(schoolActive.length > 0 || schoolHistory.length > 0) && (
        <NeonEdge accentRgb="140,198,63" intensity="subtle" className="p-4 sm:p-5 space-y-4" data-testid="school-active-section">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-shPrimary/10 border border-shPrimary/30 grid place-items-center"><i className="fas fa-graduation-cap text-shPrimary"/></div>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.16em] text-shPrimary">Sit Happens Online School</p>
                <h3 className="text-[18px] font-black text-shText mt-0.5">{dogName}'s enrollments</h3>
              </div>
            </div>
            <div className="flex items-center gap-2 text-[10px] font-bold text-shTextMuted">
              {schoolActive.length > 0 && <span className="px-2 py-1 rounded-md bg-shPrimary/10 border border-shPrimary/20 text-shPrimary">{schoolActive.length} active</span>}
              {schoolHistory.length > 0 && <span className="px-2 py-1 rounded-md bg-white/[0.03] border border-shBorder/60">{schoolHistory.length} historical</span>}
            </div>
          </div>
          <div className="space-y-3">
            {schoolActive.map(e => (
              <SchoolEnrollmentAdminCard key={e.id} enrollment={e} dogName={dogName}
                                         schoolEnrollmentId={schoolEnrollmentsById[e.id]?.id}
                                         onWithdraw={()=>schoolWithdraw(e)} onRemove={()=>schoolUnenroll(e)}
                                         onSetAccess={(s)=>schoolSetAccess(e, s)} />
            ))}
          </div>
          {schoolHistory.length > 0 && (
            <details className="pt-1 border-t border-shBorder/50" data-testid="school-history-section">
              <summary className="cursor-pointer text-[11px] font-black uppercase tracking-[0.14em] text-shTextMuted py-2">Past Online School enrollments · {schoolHistory.length}</summary>
              <div className="mt-2 space-y-3">
                {schoolHistory.map(e => (
                  <SchoolEnrollmentAdminCard key={e.id} enrollment={e} dogName={dogName}
                                             schoolEnrollmentId={schoolEnrollmentsById[e.id]?.id}
                                             onRemove={()=>schoolUnenroll(e)} onSetAccess={(s)=>schoolSetAccess(e, s)} />
                ))}
              </div>
            </details>
          )}
        </NeonEdge>
      )}

      {assignOpen && (
        <SchoolProgramAssignModal
          programs={programs.filter(p => p.type !== "custom" || p.owner_dog_id === dogId)}
          dogAgeMonths={dogAgeMonths} typeMeta={typeByKey}
          loadState={loadState} loadError={err} onRetry={load}
          assignError={assignErr} assignBusy={assignBusy}
          onAssign={assignSchoolProgram} onClose={()=>{ setAssignErr(""); setAssignOpen(false); }}
        />
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

const SCHOOL_STATUS_LABEL = { active: "Active", completed: "Completed", withdrawn: "Withdrawn" };
const SCHOOL_STATUS_STYLE = {
  active: "bg-shPrimary/10 text-shPrimary border-shPrimary/25",
  completed: "bg-shSecondary/10 text-shSecondary border-shSecondary/25",
  withdrawn: "bg-amber-500/10 text-amber-300 border-amber-500/25",
};

// Phase 6 — staff-facing lifecycle card for a single Online School
// enrollment: status, access state, provenance (manual vs purchase), and
// the Withdraw Student / access revoke-restore actions. Reused for both
// the active section and the (collapsed) history section — history rows
// simply omit onWithdraw. No visual polish investment here on purpose
// (Phase 6 spec: structurally usable now, redesigned in the later UI pass).
function SchoolEnrollmentAdminCard({ enrollment: e, dogName, schoolEnrollmentId, onWithdraw, onRemove, onSetAccess }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [cpHistory, setCpHistory] = useState(null);
  const accessRevoked = (e.access_state || "active") === "revoked";
  const provenance = e.enrollment_source === "purchase" ? "Purchased" : "Manually enrolled";
  const pct = Math.max(0, Math.min(100, Number(e.mastered_pct || 0)));

  const loadHistory = async () => {
    if (cpHistory !== null) { setHistoryOpen(o => !o); return; }
    if (!schoolEnrollmentId) { setCpHistory([]); setHistoryOpen(true); return; }
    try {
      // The admin checkpoint-history endpoint is keyed by the
      // school_enrollments row's OWN id, not the dog_programs (enrollment)
      // id `e.id` — a real wiring bug caught by live browser verification:
      // this used to pass e.id here and always 404'd.
      const { data } = await api.get(`/admin/school-enrollments/${schoolEnrollmentId}/checkpoint-history`);
      setCpHistory(data);
      setHistoryOpen(true);
    } catch { setCpHistory([]); setHistoryOpen(true); }
  };

  return (
    <div className="rounded-2xl border border-shBorder/65 bg-black/20 overflow-hidden" data-testid={`school-enrollment-${e.id}`}>
      <div className="p-4 sm:p-5">
        <div className="flex items-start gap-3.5">
          <div className="w-14 h-14 rounded-2xl overflow-hidden border border-shPrimary/20 bg-black/30 shrink-0">
            <HuskyDogImage name={dogName} alt={dogName} className="w-full h-full object-cover object-top"/>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.14em] text-shTextMuted">{provenance}</p>
                <p className="text-[16px] font-black text-shText mt-0.5 truncate">{e.program_snapshot.name}</p>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={`text-[9px] font-black uppercase tracking-[0.12em] px-2 py-1 rounded-md border ${SCHOOL_STATUS_STYLE[e.status] || "border-shBorder text-shTextMuted"}`}>{SCHOOL_STATUS_LABEL[e.status] || e.status}</span>
                <span className={`text-[9px] font-black uppercase tracking-[0.12em] px-2 py-1 rounded-md border ${accessRevoked ? "bg-red-500/10 text-red-300 border-red-500/25" : "bg-white/[0.03] text-shTextMuted border-shBorder/60"}`}>
                  {accessRevoked ? "Access Revoked" : "Access Active"}
                </span>
              </div>
            </div>

            <div className="mt-3">
              <div className="flex items-center justify-between text-[10px] text-shTextMuted mb-1.5">
                <span>{e.mastered_goals}/{e.total_goals} skills mastered</span><span className="font-black text-shPrimary">{pct}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-shSecondary to-shPrimary" style={{ width: `${pct}%` }}/></div>
            </div>

            {e.status === "withdrawn" && (
              <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] px-3 py-2.5">
                <p className="text-[11px] text-amber-300"><i className="fas fa-user-slash mr-1.5"/>Withdrawn {e.withdrawn_at ? new Date(e.withdrawn_at).toLocaleDateString() : ""} by {e.withdrawn_by_name || "staff"}{e.withdrawal_reason ? ` — “${e.withdrawal_reason}”` : ""}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-shBorder/50 bg-black/15 px-4 sm:px-5 py-3 flex items-center justify-between gap-2 flex-wrap">
        <button onClick={loadHistory} data-testid={`school-cp-history-toggle-${e.id}`}
                className="inline-flex items-center gap-2 text-[11px] font-black text-shSecondary hover:text-shText transition">
          <i className={`fas fa-chevron-${historyOpen ? "up" : "down"} text-[9px]`}/>Checkpoint History
        </button>
        <div className="flex items-center gap-2 flex-wrap">
          {onSetAccess && (accessRevoked ? (
            <button onClick={()=>onSetAccess("active")} data-testid={`school-restore-access-${e.id}`}
                    className="px-3 py-2 rounded-lg border border-shSecondary/25 bg-shSecondary/[0.06] text-shSecondary hover:bg-shSecondary/10 text-[11px] font-black transition">
              <i className="fas fa-unlock mr-1.5"/>Restore Access
            </button>
          ) : (
            <button onClick={()=>onSetAccess("revoked")} data-testid={`school-revoke-access-${e.id}`}
                    className="px-3 py-2 rounded-lg border border-shBorder/60 bg-white/[0.02] text-shTextMuted hover:text-red-300 hover:border-red-500/25 text-[11px] font-black transition">
              <i className="fas fa-lock mr-1.5"/>Revoke Access
            </button>
          ))}
          {onWithdraw && e.status === "active" && (
            <button onClick={onWithdraw} data-testid={`school-withdraw-${e.id}`}
                    className="px-3 py-2 rounded-lg border border-amber-500/25 bg-amber-500/[0.05] text-amber-300 hover:bg-amber-500/10 text-[11px] font-black transition">
              <i className="fas fa-user-slash mr-1.5"/>Withdraw Student
            </button>
          )}
          {onRemove && (
            <button onClick={onRemove} data-testid={`school-unenroll-${e.id}`}
                    className="px-3 py-2 rounded-lg text-red-400/80 hover:text-red-300 text-[11px] font-black transition">
              <i className="fas fa-trash-can mr-1.5"/>Remove
            </button>
          )}
        </div>
      </div>

      {historyOpen && (
        <div className="space-y-2 p-4 sm:p-5 border-t border-shBorder/50 bg-black/20" data-testid={`school-cp-history-${e.id}`}>
          {(cpHistory || []).length === 0 ? (
            <p className="text-[12px] text-shTextMuted">No graded checkpoints yet.</p>
          ) : (cpHistory || []).map(cp => {
            const handlerAvg = cp.handler_scores && Object.keys(cp.handler_scores).length > 0
              ? (Object.values(cp.handler_scores).reduce((a,b)=>a+b,0) / Object.values(cp.handler_scores).length).toFixed(1)
              : null;
            const dogAvg = cp.dog_scores && Object.keys(cp.dog_scores).length > 0
              ? (Object.values(cp.dog_scores).reduce((a,b)=>a+b,0) / Object.values(cp.dog_scores).length).toFixed(1)
              : null;
            return (
              <div key={cp.id} className="rounded-xl border border-shBorder/55 bg-black/20 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><p className="text-[12px] text-shText font-black truncate">{cp.lesson_name}</p><p className="text-[10px] text-shTextMuted mt-0.5 capitalize">{cp.outcome?.replace(/_/g, " ")}{cp.graded_at ? ` · ${new Date(cp.graded_at).toLocaleDateString()}` : ""}</p></div>
                  <div className="flex gap-1.5 shrink-0">
                    {handlerAvg && <span className="px-2 py-1 rounded-md bg-shPrimary/10 border border-shPrimary/20 text-shPrimary text-[10px] font-black">Handler avg {handlerAvg}</span>}
                    {dogAvg && <span className="px-2 py-1 rounded-md bg-shSecondary/10 border border-shSecondary/20 text-shSecondary text-[10px] font-black">Dog avg {dogAvg}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
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
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-[13px] sm:text-[14px] font-black uppercase tracking-widest" style={{color}}>{typeMeta?.label || snap.type}</p>
              {enrollment.delivery_channel === "in_person_school" && <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-shSecondary/10 border border-shSecondary/25 text-shSecondary">School · In Person</span>}
              {enrollment.delivery_channel === "hybrid_school" && <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-shPrimary/10 border border-shPrimary/25 text-shPrimary">School · Hybrid</span>}
            </div>
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

function SchoolProgramAssignModal({ programs, dogAgeMonths, typeMeta, onAssign, onClose,
                                   loadState = "ready", loadError, onRetry,
                                   assignError = "", assignBusy = false }) {
  const [selectedId, setSelectedId] = useState("");
  const [deliveryMode, setDeliveryMode] = useState("in_person");
  const [trainerId, setTrainerId] = useState("");
  const [startedAt, setStartedAt] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [trainers, setTrainers] = useState([]);
  const selected = programs.find(p => p.id === selectedId) || null;

  /* Group by curriculum type, but NEVER lose a program to an unrecognised
     one. The picker used to render a group per known type and `null` for
     each empty one, so a program whose type was not in /programs/meta —
     or simply no programs at all — produced an entirely blank body with
     nothing to explain it. Anything unmatched now falls into "Other". */
  const known = Object.values(typeMeta || {});
  const groups = known
    .map(t => ({ key: t.key, label: t.label, color: t.color,
                 items: programs.filter(p => p.type === t.key) }))
    .filter(g => g.items.length > 0);
  const knownKeys = new Set(known.map(t => t.key));
  const orphans = programs.filter(p => !knownKeys.has(p.type));
  if (orphans.length) groups.push({ key: "__other", label: "Other programs",
                                    color: "#94a3b8", items: orphans });

  useEffect(() => {
    api.get("/admin/school/trainers").then(r => setTrainers(r.data || [])).catch(() => setTrainers([]));
  }, []);

  const modesFor = (p) => {
    const configured = p?.delivery_mode || "trainer_led";
    if (configured === "self_guided") return [{ key: "online", label: "Online", icon: "fa-laptop" }];
    if (configured === "both") return [
      { key: "in_person", label: "In Person", icon: "fa-people-arrows-left-right" },
      { key: "online", label: "Online", icon: "fa-laptop" },
      { key: "hybrid", label: "Hybrid", icon: "fa-shuffle" },
    ];
    return [{ key: "in_person", label: "In Person", icon: "fa-people-arrows-left-right" }];
  };

  const chooseProgram = (p) => {
    setSelectedId(p.id);
    const modes = modesFor(p);
    setDeliveryMode(modes[0].key);
  };

  const submit = () => {
    if (!selected || assignBusy) return;
    onAssign({
      programId: selected.id, deliveryMode,
      assignedTrainerId: trainerId || null,
      startedAt: startedAt || null, targetCompletionDate: targetDate || null,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" data-testid="school-program-assign-modal">
      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-3xl max-h-[calc(var(--app-height)_-_2rem)] flex flex-col min-h-0 shadow-2xl">
        <div className="px-6 py-4 border-b border-shBorder flex items-center justify-between shrink-0">
          <div>
            <h4 className="text-base font-black text-shText uppercase italic"><i className="fas fa-graduation-cap mr-1.5 text-shPrimary"/>Assign School Program</h4>
            <p className="text-[12px] text-shTextMuted">Pick the curriculum once, then choose how this client will take it.</p>
          </div>
          <button onClick={onClose} className="text-shTextMuted hover:text-shText"><i className="fas fa-times text-xl"/></button>
        </div>

        <div className="overflow-y-auto flex-1 min-h-0 p-4 sm:p-5">
          {loadState === "loading" ? (
            <div className="py-14 text-center" data-testid="school-assign-loading">
              <p className="text-shTextMuted text-sm"><i className="fas fa-spinner fa-spin mr-2"/>Loading programs…</p>
            </div>
          ) : loadState === "error" ? (
            <div className="py-12 text-center space-y-3" data-testid="school-assign-error">
              <p className="text-shText text-sm font-black"><i className="fas fa-triangle-exclamation mr-2 text-shAccent"/>Unable to load programs</p>
              <p className="text-shTextMuted text-[12px] max-w-md mx-auto">{loadError || "The server didn't respond. Nothing has been assigned."}</p>
              {onRetry && <button type="button" onClick={onRetry} data-testid="school-assign-retry"
                      className="px-4 py-2 rounded-xl border border-shSecondary/40 text-shSecondary text-[11px] font-black uppercase tracking-widest">
                <i className="fas fa-rotate-right mr-1.5"/>Try again</button>}
            </div>
          ) : !groups.length ? (
            <div className="py-12 text-center space-y-3" data-testid="school-assign-empty">
              <p className="text-shText text-sm font-black"><i className="fas fa-folder-open mr-2 text-shSecondary"/>No assignable programs</p>
              <p className="text-shTextMuted text-[12px] max-w-md mx-auto">
                Only <strong className="text-shText">active</strong> programs can be assigned. If a curriculum exists but is
                archived or still a draft, activate it in Program Studio and it will appear here.
              </p>
            </div>
          ) : !selected ? (
            <div className="space-y-4">
              {groups.map(t => {
                const items = t.items;
                return <div key={t.key}>
                  <p className="text-[11px] font-black uppercase tracking-widest mb-2" style={{color:t.color}}>{t.label}</p>
                  <div className="grid sm:grid-cols-2 gap-2">
                    {items.map(p => {
                      const tooYoung = dogAgeMonths > 0 && p.min_age_months > dogAgeMonths;
                      const delivery = p.delivery_mode || "trainer_led";
                      return <button key={p.id} type="button" onClick={()=>chooseProgram(p)} data-testid={`school-assign-pick-${p.id}`}
                        className="text-left bg-black/15 border border-shBorder hover:border-shSecondary rounded-xl p-3 transition">
                        <div className="flex justify-between gap-3"><div className="min-w-0"><p className="text-sm font-black text-shText">{p.name}</p><p className="text-[12px] text-shTextMuted mt-0.5">{p.focus}</p></div>{tooYoung&&<span className="text-[9px] font-black uppercase tracking-widest text-shAccent">Under {p.min_age_months}mo</span>}</div>
                        <div className="flex items-center gap-1.5 flex-wrap mt-2">
                          <span className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded bg-white/[0.04] border border-shBorder text-shTextMuted">{p.modules?.length || 0} modules</span>
                          <span className="text-[9px] font-black uppercase tracking-widest px-2 py-1 rounded bg-shPrimary/10 border border-shPrimary/20 text-shPrimary">{delivery === "both" ? "In Person + Online" : delivery === "self_guided" ? "Online" : "In Person"}</span>
                        </div>
                      </button>;
                    })}
                  </div>
                </div>;
              })}
            </div>
          ) : (
            <div className="space-y-5">
              <button type="button" onClick={()=>setSelectedId("")} className="text-[11px] font-black uppercase tracking-widest text-shSecondary"><i className="fas fa-arrow-left mr-1"/>Choose different program</button>
              <div className="rounded-2xl border border-shBorder bg-black/15 p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-shPrimary">Curriculum</p>
                <h3 className="text-xl font-black text-shText mt-1">{selected.name}</h3>
                {selected.focus&&<p className="text-[12px] text-shTextMuted mt-1">{selected.focus}</p>}
              </div>

              {assignError && (
                <div className="rounded-xl border border-red-400/35 bg-red-500/10 p-3 text-[13px] font-bold text-red-300"
                     role="alert" data-testid="school-assign-submit-error">
                  <i className="fas fa-triangle-exclamation mr-2" />{assignError}
                </div>
              )}

              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-shTextMuted mb-2">Delivery</p>
                <div className="grid sm:grid-cols-3 gap-2">
                  {modesFor(selected).map(m => <button type="button" key={m.key} onClick={()=>setDeliveryMode(m.key)} data-testid={`school-delivery-${m.key}`}
                    className={`rounded-xl border p-3 text-left transition ${deliveryMode===m.key?"border-shPrimary bg-shPrimary/10":"border-shBorder bg-black/10 hover:border-shSecondary/50"}`}>
                    <i className={`fas ${m.icon} ${deliveryMode===m.key?"text-shPrimary":"text-shSecondary"}`}/><p className="text-sm font-black text-shText mt-2">{m.label}</p>
                    <p className="text-[10px] text-shTextMuted mt-1">{m.key==="in_person"?"Trainer sessions + School Practice":m.key==="hybrid"?"Trainer sessions + full online lessons":"Self-guided online lessons + Practice"}</p>
                  </button>)}
                </div>
              </div>

              <div className="grid sm:grid-cols-3 gap-3">
                <label className="block"><span className="block text-[10px] uppercase tracking-widest font-black text-shTextMuted mb-1">Assigned trainer</span><select value={trainerId} onChange={e=>setTrainerId(e.target.value)} className="w-full bg-black/20 border border-shBorder rounded-xl px-3 py-2.5 text-sm text-shText"><option value="">Program default / unassigned</option>{trainers.map(t=><option key={t.id} value={t.id}>{t.name || t.email}</option>)}</select></label>
                <label className="block"><span className="block text-[10px] uppercase tracking-widest font-black text-shTextMuted mb-1">Start date</span><input type="date" value={startedAt} onChange={e=>setStartedAt(e.target.value)} className="w-full bg-black/20 border border-shBorder rounded-xl px-3 py-2.5 text-sm text-shText" style={{colorScheme:"dark"}}/></label>
                <label className="block"><span className="block text-[10px] uppercase tracking-widest font-black text-shTextMuted mb-1">Target date</span><input type="date" value={targetDate} onChange={e=>setTargetDate(e.target.value)} className="w-full bg-black/20 border border-shBorder rounded-xl px-3 py-2.5 text-sm text-shText" style={{colorScheme:"dark"}}/></label>
              </div>
            </div>
          )}
        </div>

        {selected && <div className="px-5 py-4 border-t border-shBorder flex justify-end gap-2 shrink-0"><button type="button" onClick={onClose} disabled={assignBusy} className="px-4 py-2 rounded-xl border border-shBorder text-shTextMuted text-xs font-black disabled:opacity-50">Cancel</button><button type="button" onClick={submit} disabled={assignBusy} data-testid="school-assign-confirm" className="px-5 py-2 rounded-xl bg-shPrimary text-bgHeader text-xs font-black uppercase tracking-widest disabled:opacity-50"><i className={`fas ${assignBusy ? "fa-spinner fa-spin" : "fa-check"} mr-1.5`}/>{assignBusy ? "Assigning…" : `Assign ${deliveryMode === "in_person" ? "In Person" : deliveryMode === "hybrid" ? "Hybrid" : "Online"}`}</button></div>}
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
