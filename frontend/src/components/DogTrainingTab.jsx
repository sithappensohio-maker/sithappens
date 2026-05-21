import { useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import { useConfirm } from "../lib/useConfirm";
import ProgressRing from "./ProgressRing";
import CollapsibleText from "./CollapsibleText";
import { ProgramEditor } from "./Programs";

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
  const [customOpen, setCustomOpen] = useState(false);
  const [activeGoalEdit, setActiveGoalEdit] = useState(null);
  const [err, setErr] = useState("");

  const load = async () => {
    try {
      const [m, e, p] = await Promise.all([
        api.get("/programs/meta"),
        api.get(`/dogs/${dogId}/programs`),
        api.get("/programs"),
      ]);
      setMeta(m.data); setEnrollments(e.data); setPrograms(p.data);
    } catch (er) { setErr(formatErr(er.response?.data?.detail) || "Load failed"); }
  };
  useEffect(() => { if (dogId) load(); }, [dogId]);

  if (!meta) return <p className="text-gray-500 text-sm py-6 text-center"><i className="fas fa-spinner fa-spin mr-2"/>Loading…</p>;

  const typeByKey = Object.fromEntries(meta.types.map(t => [t.key, t]));
  const active = enrollments.filter(e => e.status === "active");
  const history = enrollments.filter(e => e.status !== "active");

  const enrollIn = async (programId) => {
    try {
      await api.post(`/dogs/${dogId}/programs`, { program_id: programId });
      setEnrollOpen(false); load();
    } catch (e) { setErr(formatErr(e.response?.data?.detail) || "Enroll failed"); }
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

  return (
    <div className="space-y-4" data-testid="dog-training-tab">
      {err && <div className="text-[15px] text-red-400 bg-red-500/10 rounded p-2 uppercase font-black">{err}</div>}

      {/* Enroll dropdown */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[15px] font-black uppercase tracking-widest text-gray-500">{active.length>0 ? `${active.length} active enrollment${active.length>1?"s":""}` : "No active programs"}</p>
        <div className="flex gap-2">
          <button onClick={()=>setEnrollOpen(true)} data-testid="enroll-btn"
                  className="bg-shBlue text-white px-4 py-2 rounded font-black text-[15px] uppercase tracking-widest shadow">
            <i className="fas fa-graduation-cap mr-1"/>Enroll
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
                          onGoal={(gid, patch)=>setGoal(e.id, gid, patch)} />
        ))
      ) : (
        <div className="bg-bgBase/40 border border-dashed border-bgHover rounded p-6 text-center" data-testid="no-active">
          <i className="fas fa-graduation-cap text-shBlue text-3xl mb-2"/>
          <p className="text-sm font-black text-white uppercase tracking-tight">No active training program</p>
          <p className="text-[14px] text-gray-400 mt-1">Enroll {dogName} in a standard program or build a custom plan.</p>
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <details className="bg-bgBase/40 border border-bgHover rounded p-3" data-testid="enrollment-history">
          <summary className="cursor-pointer text-[15px] font-black uppercase tracking-widest text-shBlue">History · {history.length}</summary>
          <div className="mt-3 space-y-2">
            {history.map(h => (
              <div key={h.id} className="bg-bgPanel rounded p-3 border border-bgHover">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-black text-white">{h.program_snapshot.name}</p>
                    <p className="text-[15px] text-gray-500">{h.status.toUpperCase()} · {h.mastered_goals}/{h.total_goals} mastered ({h.mastered_pct}%)</p>
                  </div>
                  {h.status !== "active" && (
                    <button onClick={()=>updateStatus(h.id, "active")} data-testid={`resume-${h.id}`}
                            className="text-[14px] font-black uppercase tracking-widest text-shBlue hover:text-white">Resume</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Enroll modal */}
      {enrollOpen && (
        <EnrollModal programs={programs.filter(p => p.type !== "custom" || p.owner_dog_id === dogId)}
                     dogAgeMonths={dogAgeMonths} typeMeta={typeByKey}
                     onPick={enrollIn} onClose={()=>setEnrollOpen(false)} />
      )}

      {/* Custom program builder */}
      {customOpen && (
        <CustomProgramBuilder dogId={dogId} dogName={dogName} meta={meta}
                              onClose={()=>setCustomOpen(false)}
                              onCreated={()=>{ setCustomOpen(false); load(); }} />
      )}
    </div>
  );
}

function EnrollmentCard({ enrollment, typeMeta, dogId, onStatus, onUnenroll, onTargetDate, onGoal }) {
  const color = typeMeta?.color || "#00a9e0";
  const snap = enrollment.program_snapshot;
  const [editTarget, setEditTarget] = useState(false);
  const overdue = enrollment.target_completion_date && enrollment.target_completion_date < new Date().toISOString().slice(0,10);
  return (
    <div className="bg-bgBase/60 border border-bgHover rounded-lg overflow-hidden" data-testid={`enrollment-${enrollment.id}`}>
      <div className="px-3 sm:px-4 py-3 border-b border-bgHover" style={{background: color + "10"}}>
        <div className="flex items-center gap-3 sm:gap-4">
          <ProgressRing percent={enrollment.mastered_pct} size={64} stroke={6} color={color}
                        label={`${enrollment.mastered_goals}/${enrollment.total_goals}`} />
          <div className="flex-1 min-w-0">
            <p className="text-[13px] sm:text-[14px] font-black uppercase tracking-widest" style={{color}}>{typeMeta?.label || snap.type}</p>
            <p className="text-sm sm:text-base font-black text-white truncate">{snap.name}</p>
          </div>
          <div className="flex flex-col gap-1 shrink-0">
            <button onClick={()=>onStatus("completed")} data-testid={`complete-${enrollment.id}`}
                    className="bg-shGreen text-bgHeader px-3 py-1.5 rounded font-black text-[13px] sm:text-[14px] uppercase tracking-widest shadow whitespace-nowrap"><i className="fas fa-flag-checkered mr-1"/>Complete</button>
            <button onClick={()=>onStatus("on_hold")} data-testid={`hold-${enrollment.id}`}
                    className="text-gray-400 hover:text-white text-[13px] sm:text-[14px] font-black uppercase tracking-widest whitespace-nowrap"><i className="fas fa-pause mr-1"/>On Hold</button>
            <button onClick={onUnenroll} data-testid={`unenroll-${enrollment.id}`}
                    className="text-red-400 hover:text-red-300 text-[13px] sm:text-[14px] font-black uppercase tracking-widest whitespace-nowrap"><i className="fas fa-user-minus mr-1"/>Unenroll</button>
          </div>
        </div>
        {snap.focus && (
          <CollapsibleText text={snap.focus} maxChars={70} className="mt-2"
                           testid={`enrollment-focus-${enrollment.id}`} />
        )}
        <div className="flex items-center gap-2 flex-wrap mt-2">
          <p className="text-[13px] sm:text-[14px] text-gray-500 font-black uppercase tracking-widest">Started {enrollment.started_at}</p>
          {editTarget ? (
            <input type="date" defaultValue={enrollment.target_completion_date||""}
                   onBlur={(e)=>{ if (e.target.value !== enrollment.target_completion_date) onTargetDate(e.target.value); setEditTarget(false); }}
                   data-testid={`target-date-input-${enrollment.id}`}
                   className="bg-bgPanel border border-bgHover rounded px-1 text-[14px] text-white" style={{colorScheme:"dark"}} autoFocus />
          ) : (
            <button onClick={()=>setEditTarget(true)} data-testid={`target-date-${enrollment.id}`}
                    className={`text-[13px] sm:text-[14px] font-black uppercase tracking-widest hover:text-white ${overdue?"text-red-400":"text-gray-500"}`}>
              <i className="fas fa-calendar-day mr-1"/>Target: {enrollment.target_completion_date || "—"}{overdue && " (overdue)"}
            </button>
          )}
        </div>
      </div>

      <div className="divide-y divide-bgHover">
        {snap.modules.map(m => (
          <div key={m.id} className="px-4 py-3">
            <p className="text-[15px] font-black uppercase tracking-widest text-shBlue mb-2">{m.name}</p>
            <div className="space-y-1">
              {m.goals.map(g => {
                const p = enrollment.goal_progress?.[g.id] || { score: 0, status: "not_started", notes: "" };
                return <GoalRow key={g.id} goal={g} progress={p} onChange={(patch)=>onGoal(g.id, patch)} />;
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function GoalRow({ goal, progress, onChange }) {
  const [openNote, setOpenNote] = useState(false);
  const [note, setNote] = useState(progress.notes || "");
  useEffect(() => { setNote(progress.notes || ""); }, [progress.notes]);
  const colors = ["#475569","#f59e0b","#f97316","#eab308","#84cc16","#22c55e"];
  const labels = ["Not Started","Introductory","Learning","Emerging","Proficient","Mastered"];
  const isManual = !!goal.manual_only;
  const isDone = progress.status === "mastered" || progress.score >= 4;
  return (
    <div className="bg-bgPanel rounded px-3 py-2" data-testid={`goal-${goal.id}`}>
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-black text-white">{goal.name} {isManual && <span className="text-[12px] text-pink-300 ml-2 tracking-widest">[MANUAL]</span>}</p>
          {goal.description && <p className="text-[14px] text-gray-500">{goal.description}</p>}
        </div>
        <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
          {isManual ? (
            <button onClick={()=>onChange({ score: isDone ? 0 : 5, status: isDone ? "not_started" : "mastered" })}
                    data-testid={`goal-toggle-${goal.id}`}
                    className={`px-3 py-1 rounded text-[14px] font-black uppercase tracking-widest border ${isDone?"bg-shGreen text-bgHeader border-shGreen":"text-gray-400 border-bgHover hover:text-white"}`}>
              <i className={`fas ${isDone?"fa-check":"fa-square"} mr-1`}/>{isDone?"Done":"Mark Done"}
            </button>
          ) : (
            <div className="flex gap-1">
              {[0,1,2,3,4,5].map(n => (
                <button key={n} onClick={()=>onChange({ score: n })} data-testid={`goal-score-${goal.id}-${n}`}
                        title={labels[n]}
                        className={`w-8 h-8 sm:w-6 sm:h-6 text-[15px] sm:text-[14px] font-black rounded border ${progress.score===n?"text-white":"text-gray-500 border-bgHover hover:text-white"}`}
                        style={progress.score===n ? {background: colors[n], borderColor: colors[n]} : {}}>{n}</button>
              ))}
            </div>
          )}
          <button onClick={()=>setOpenNote(o=>!o)} className="text-gray-400 hover:text-white text-xs px-2 py-1"><i className="fas fa-note-sticky"/></button>
        </div>
      </div>
      {openNote && (
        <div className="mt-2 flex gap-2">
          <input value={note} onChange={(e)=>setNote(e.target.value)}
                 onBlur={()=>{ if (note !== progress.notes) onChange({ notes: note }); setOpenNote(false); }}
                 onKeyDown={(e)=>{ if (e.key === "Enter") { onChange({ notes: note }); setOpenNote(false); } }}
                 placeholder="Trainer note for this goal"
                 className="flex-1 bg-bgBase border border-bgHover rounded p-1.5 text-[15px] text-white" autoFocus />
        </div>
      )}
      {!openNote && progress.notes && <p className="text-[14px] text-gray-400 italic mt-1 pl-1">"{progress.notes}"</p>}
    </div>
  );
}

function EnrollModal({ programs, dogAgeMonths, typeMeta, onPick, onClose }) {
  const grouped = Object.values(typeMeta).map(t => ({ ...t, items: programs.filter(p => p.type === t.key) }));
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" data-testid="enroll-modal">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-2xl max-h-[88vh] flex flex-col shadow-2xl">
        <div className="px-6 py-4 border-b border-bgHover flex items-center justify-between shrink-0">
          <h4 className="text-base font-black text-white uppercase italic">Enroll in Program</h4>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><i className="fas fa-times text-xl"/></button>
        </div>
        <div className="overflow-y-auto flex-1 p-4 space-y-4">
          {grouped.filter(g => g.items.length > 0).map(g => (
            <div key={g.key}>
              <p className="text-[15px] font-black uppercase tracking-widest mb-2" style={{color: g.color}}>{g.label}</p>
              <div className="space-y-2">
                {g.items.map(p => {
                  const tooYoung = dogAgeMonths > 0 && p.min_age_months > dogAgeMonths;
                  return (
                    <button key={p.id} onClick={()=>onPick(p.id)} data-testid={`enroll-pick-${p.id}`}
                            className="w-full text-left bg-bgBase/60 border border-bgHover hover:border-shBlue rounded p-3 transition">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-black text-white">{p.name}</p>
                          <p className="text-[15px] text-gray-400 mt-0.5">{p.focus}</p>
                          <p className="text-[14px] text-gray-500 font-black uppercase tracking-widest mt-1">
                            {p.modules.length} modules · {p.modules.reduce((a,m)=>a+m.goals.length,0)} goals · {p.format?.count} {p.format?.unit}
                          </p>
                        </div>
                        {tooYoung && (
                          <span className="shrink-0 text-[14px] font-black uppercase tracking-widest text-shOrange px-2 py-1 bg-shOrange/15 rounded">
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
