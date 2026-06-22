import { useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import { useConfirm } from "../lib/useConfirm";

/* ============================================================
 *  Admin: Settings → Programs tab. Manage the library of programs.
 * ============================================================ */
export function ProgramsPanel() {
  const confirm = useConfirm();
  const [programs, setPrograms] = useState([]);
  const [meta, setMeta] = useState(null);
  const [edit, setEdit] = useState(null);
  const [err, setErr] = useState("");

  const load = async () => {
    try {
      const [p, m] = await Promise.all([api.get("/programs"), api.get("/programs/meta")]);
      setPrograms(p.data); setMeta(m.data);
    } catch (e) { setErr(e.response?.data?.detail || e.message); }
  };
  useEffect(() => { load(); }, []);

  const startNew = (type = "private_lessons") => setEdit({
    name: "", slug: "", type, description: "", focus: "",
    format: { count: 1, unit: "sessions" }, min_age_months: 0,
    prereq_slugs: [], modules: [], price: 0, active: true,
  });

  const save = async () => {
    setErr("");
    try {
      const payload = { ...edit };
      if (edit.id) {
        // Editing existing program: ask whether to push changes to dogs already
        // enrolled. Cascading preserves goal scores for surviving goal IDs and
        // drops progress for any removed goals.
        let cascade = false;
        try {
          const { data } = await api.get(`/programs/${edit.id}/active-enrollments-count`);
          if ((data?.count || 0) > 0) {
            cascade = await confirm({
              title: `Apply changes to ${data.count} enrolled dog${data.count > 1 ? "s" : ""}?`,
              body: "Yes: every active enrollment updates to the new program. Trainer scores and notes for goals that still exist are preserved; progress on any removed goals is dropped.\n\nNo: only future enrollments use the new version. Currently-enrolled dogs keep their existing program snapshot.",
              confirmText: "Yes, update enrolled dogs",
              cancelText: "No, only future enrollments",
              tone: "warning",
            });
          }
        } catch { /* count endpoint failure isn't fatal — just skip cascade */ }
        const url = `/programs/${edit.id}${cascade ? "?cascade=true" : ""}`;
        await api.put(url, payload);
      } else {
        await api.post("/programs", payload);
      }
      setEdit(null); load();
    } catch (e) { setErr(formatErr(e.response?.data?.detail) || "Save failed"); }
  };

  const remove = async (id) => {
    if (!(await confirm({ title: "Archive this program?", body: "Existing dogs already enrolled in this program will keep their progress. New enrollments will no longer be possible.", confirmText: "Archive", tone: "warning" }))) return;
    try { await api.delete(`/programs/${id}`); load(); } catch (e) { setErr(e.response?.data?.detail); }
  };

  if (!meta) return <p className="text-gray-500 text-sm">Loading…</p>;
  const grouped = meta.types.map(t => ({ ...t, items: programs.filter(p => p.type === t.key && p.type !== "custom" || (t.key === "custom" && p.type === "custom")) }));

  return (
    <div className="space-y-5 max-w-4xl" data-testid="programs-panel">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-black text-shBlue uppercase tracking-widest"><i className="fas fa-list-check mr-2"/>Training Programs</h4>
          <p className="text-[14px] text-gray-300 mt-1">Tiers and curricula you offer. Seeded from your website&rsquo;s standard lineup.</p>
        </div>
        <button onClick={()=>startNew()} data-testid="prog-new"
                className="bg-shGreen text-bgHeader px-4 py-2 rounded font-black text-[15px] uppercase tracking-widest shadow"><i className="fas fa-plus mr-1"/>New Program</button>
      </div>

      {err && <div className="text-[15px] text-red-400 bg-red-500/10 rounded p-2 uppercase font-black">{err}</div>}

      {grouped.filter(g => g.items.length > 0 || g.key !== "custom").map(g => (
        <div key={g.key} className="bg-bgBase/40 border border-bgHover rounded">
          <div className="px-3 py-2 border-b border-bgHover flex items-center justify-between" style={{background: g.color + "12"}}>
            <p className="text-[15px] font-black uppercase tracking-widest" style={{color: g.color}}>{g.label} · {g.items.length}</p>
          </div>
          <div className="divide-y divide-bgHover">
            {g.items.length === 0 && <p className="px-3 py-3 text-[15px] text-gray-500 italic">No programs in this category.</p>}
            {g.items.map(p => (
              <div key={p.id} className="px-3 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black text-white">{p.name} {p.is_default && <span className="text-[13px] text-gray-500 font-black tracking-widest ml-2">DEFAULT</span>}</p>
                  <p className="text-[15px] text-gray-400">{p.modules.length} modules · {p.modules.reduce((a,m)=>a+m.goals.length,0)} goals · {p.format?.count} {p.format?.unit}</p>
                </div>
                <p className="text-shGreen font-black text-[16px] whitespace-nowrap">${Number(p.price || 0).toFixed(2)}</p>
                <button onClick={()=>setEdit({...p})} data-testid={`prog-edit-${p.id}`} className="text-shBlue hover:text-white text-sm px-2"><i className="fas fa-pen"/></button>
                <button onClick={()=>remove(p.id)} className="text-red-400 hover:text-red-300 text-sm px-2"><i className="fas fa-trash"/></button>
              </div>
            ))}
          </div>
        </div>
      ))}

      {edit && <ProgramEditor program={edit} setProgram={setEdit} meta={meta} allPrograms={programs} onSave={save} onClose={()=>setEdit(null)} />}
    </div>
  );
}

/* ============================================================
 *  Program editor modal — used for both standard and custom programs
 * ============================================================ */
export function ProgramEditor({ program, setProgram, meta, allPrograms = [], onSave, onClose, hideTypePicker = false, extraError = "" }) {
  // Sprint 110bx — load homework templates so we can pick which one auto-sends
  // on enrollment (welcome) and after a module is mastered.
  const [hwTemplates, setHwTemplates] = useState([]);
  // Sprint 110di-62 — load all email templates so the operator can bind a custom
  // welcome email that fires the moment the program is sold.
  const [emailTemplates, setEmailTemplates] = useState([]);
  useEffect(() => {
    api.get("/homework-templates")
      .then(r => setHwTemplates(r.data || []))
      .catch(() => setHwTemplates([]));
    api.get("/admin/email-templates")
      .then(r => setEmailTemplates((r.data || []).filter(t => t.audience === "client")))
      .catch(() => setEmailTemplates([]));
  }, []);

  const set = (patch) => setProgram(p => ({ ...p, ...patch }));
  const addModule = () => set({ modules: [...(program.modules||[]), { name: "New module", description: "", goals: [] }] });
  const removeModule = (i) => set({ modules: program.modules.filter((_, j) => j !== i) });
  const updateModule = (i, patch) => set({ modules: program.modules.map((m, j) => j === i ? { ...m, ...patch } : m) });
  const addGoal = (mi) => updateModule(mi, { goals: [...(program.modules[mi].goals||[]), { name: "New goal", description: "" }] });
  const removeGoal = (mi, gi) => updateModule(mi, { goals: program.modules[mi].goals.filter((_, j) => j !== gi) });
  const updateGoal = (mi, gi, patch) => updateModule(mi, { goals: program.modules[mi].goals.map((g, j) => j === gi ? { ...g, ...patch } : g) });

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" data-testid="program-editor">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-3xl max-h-[92vh] flex flex-col shadow-2xl">
        <div className="px-6 py-4 border-b border-bgHover flex items-center justify-between shrink-0">
          <h4 className="text-base font-black text-white uppercase italic">{program.id?"Edit Program":"New Program"}</h4>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><i className="fas fa-times text-xl"/></button>
        </div>

        <div className="px-6 py-4 space-y-3 overflow-y-auto flex-1">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Name *">
              <input value={program.name} onChange={(e)=>set({name:e.target.value})} data-testid="prog-name"
                     className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
            </Field>
            {!hideTypePicker && (
              <Field label="Type">
                <select value={program.type} onChange={(e)=>set({type:e.target.value})}
                        className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                  {meta.types.filter(t => t.key !== "custom").map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
              </Field>
            )}
          </div>
          <Field label="Description"><textarea value={program.description||""} onChange={(e)=>set({description:e.target.value})} rows={2} className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/></Field>
          <Field label="Focus (short summary)"><input value={program.focus||""} onChange={(e)=>set({focus:e.target.value})} className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/></Field>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Sessions / credits issued">
              <input type="number" min="1" value={program.format?.count||1} onChange={(e)=>set({format:{...program.format, count: parseInt(e.target.value)||1}})} data-testid="prog-format-count"
                     className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>
              <p className="text-[12px] text-gray-500 mt-1 normal-case font-normal tracking-normal">When a client buys this program they get this many credits.</p>
            </Field>
            <Field label="Unit">
              <select value={program.format?.unit||"sessions"} onChange={(e)=>set({format:{...program.format, unit: e.target.value}})}
                      className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                <option value="sessions">Sessions</option><option value="weeks">Weeks</option><option value="days">Days</option><option value="months">Months</option>
              </select>
            </Field>
            <Field label="Min age (months)"><input type="number" min="0" value={program.min_age_months||0} onChange={(e)=>set({min_age_months: parseInt(e.target.value)||0})} className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/></Field>
          </div>

          <Field label="Price (USD)">
            <input type="number" min="0" step="0.01" value={program.price ?? 0}
                   onChange={(e)=>set({price: parseFloat(e.target.value)||0})} data-testid="prog-price"
                   placeholder="e.g. 450.00"
                   className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>
            <p className="text-[13px] text-gray-500 mt-1 normal-case font-normal tracking-normal">Shown on the client portal so prospects can see what each program costs.</p>
          </Field>

          {/* Sprint 110bx — Welcome homework: auto-sent the moment the dog is enrolled */}
          <Field label="Welcome homework (auto-sent on enrollment)">
            <select value={program.welcome_homework_template_id||""}
                    onChange={(e)=>set({welcome_homework_template_id: e.target.value || null})}
                    data-testid="prog-welcome-hw"
                    className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
              <option value="">— None (no welcome homework) —</option>
              {hwTemplates.map(t => (
                <option key={t.id} value={t.id}>{t.name}{t.tier ? ` · ${t.tier}` : ""}</option>
              ))}
            </select>
            <p className="text-[13px] text-gray-500 mt-1 normal-case font-normal tracking-normal">
              <i className="fas fa-envelope mr-1 text-shGreen"/>Auto-creates a homework row + emails the client the moment a dog is enrolled in this program.
            </p>
          </Field>

          {/* Sprint 110di-62 — Welcome email: custom template that fires when the program is sold */}
          <Field label="Welcome email (auto-sent when program is sold)">
            <select value={program.welcome_email_template_slug||""}
                    onChange={(e)=>set({welcome_email_template_slug: e.target.value || null})}
                    data-testid="prog-welcome-email"
                    className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
              <option value="">— None (use default sale email) —</option>
              {emailTemplates.map(t => (
                <option key={t.slug} value={t.slug}>{t.name}{t.kind === "custom" ? " · Custom" : ""}</option>
              ))}
            </select>
            <p className="text-[13px] text-gray-500 mt-1 normal-case font-normal tracking-normal">
              <i className="fas fa-paper-plane mr-1 text-shBlue"/>Sends this template (e.g. &ldquo;Welcome to Puppy Basics&rdquo;) the moment a client buys this program. Create new templates from Settings → Email Designer.
            </p>
          </Field>

          {allPrograms.length > 0 && !hideTypePicker && (
            <Field label="Prerequisites (any of these)">
              <select multiple value={program.prereq_slugs||[]} onChange={(e)=>set({prereq_slugs: Array.from(e.target.selectedOptions, o => o.value)})}
                      className="w-full bg-bgBase border border-bgHover rounded p-2 text-white text-sm h-24">
                {allPrograms.filter(p => p.slug && p.id !== program.id).map(p => <option key={p.id} value={p.slug}>{p.name}</option>)}
              </select>
            </Field>
          )}

          {/* Completion rule */}
          <div className="bg-bgBase/40 border border-bgHover rounded p-3">
            <p className="text-[15px] font-black uppercase tracking-widest text-shBlue mb-2"><i className="fas fa-flag-checkered mr-2"/>Completion Rule</p>
            <p className="text-[15px] text-gray-400 mb-2">When is a dog ready to graduate from this program?</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {[
                { k: "percent", label: "% mastered", icon: "fa-percent" },
                { k: "all_mastered", label: "All goals", icon: "fa-list-check" },
                { k: "manual", label: "Manual sign-off", icon: "fa-hand-pointer" },
                { k: "sessions", label: "Session count", icon: "fa-calendar-check" },
              ].map(rt => (
                <button key={rt.k} type="button" onClick={()=>set({completion_rule:{...(program.completion_rule||{}), type: rt.k}})}
                        data-testid={`rule-${rt.k}`}
                        className={`py-2 rounded text-[15px] font-black uppercase tracking-widest border ${(program.completion_rule?.type||"percent")===rt.k?"bg-shBlue text-white border-shBlue":"bg-bgPanel border-bgHover text-gray-400"}`}>
                  <i className={`fas ${rt.icon} mr-1`}/>{rt.label}
                </button>
              ))}
            </div>
            {((program.completion_rule?.type||"percent")==="percent" || program.completion_rule?.type==="sessions") && (
              <div className="mt-2 flex items-center gap-2">
                <label className="text-[15px] font-black text-gray-500 uppercase tracking-widest">{program.completion_rule?.type==="sessions"?"Required sessions":"Threshold %"}:</label>
                <input type="number" min="1" max={program.completion_rule?.type==="sessions"?100:100}
                       value={program.completion_rule?.threshold ?? (program.completion_rule?.type==="sessions"?5:80)}
                       onChange={(e)=>set({completion_rule:{...(program.completion_rule||{type:"percent"}), threshold: parseInt(e.target.value)||0}})}
                       className="w-24 bg-bgPanel border border-bgHover rounded p-1.5 text-white text-sm" />
              </div>
            )}
          </div>

          {/* Module builder */}
          <div className="border-t border-bgHover pt-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[15px] font-black uppercase tracking-widest text-shBlue">Modules & Goals</p>
              <button onClick={addModule} data-testid="add-module"
                      className="bg-bgBase border border-shGreen/40 text-shGreen px-3 py-1 rounded text-[15px] font-black uppercase tracking-widest hover:bg-shGreen/15"><i className="fas fa-plus mr-1"/>Add Module</button>
            </div>
            {(program.modules||[]).length === 0 && <p className="text-[15px] text-gray-500 italic py-3">No modules yet. Add one to begin.</p>}
            <div className="space-y-3">
              {(program.modules||[]).map((m, mi) => (
                <div key={mi} className="bg-bgBase/50 border border-bgHover rounded p-3">
                  <div className="flex gap-2 mb-2">
                    <input value={m.name} onChange={(e)=>updateModule(mi, {name:e.target.value})}
                           className="flex-1 bg-transparent border-b border-bgHover text-sm font-black text-white outline-none focus:border-shBlue py-1" />
                    <button onClick={()=>removeModule(mi)} className="text-red-400 hover:text-red-300"><i className="fas fa-trash text-xs"/></button>
                  </div>
                  <input value={m.description||""} onChange={(e)=>updateModule(mi, {description:e.target.value})}
                         placeholder="Module description (optional)"
                         className="w-full bg-bgBase border border-bgHover rounded p-1.5 text-[15px] text-gray-300 mb-2" />
                  {/* Sprint 110bz — homework for THIS module: auto-sent the moment
                      the client begins this module (module 1 → at enrollment;
                      module 2..N → when the previous module's goals are mastered). */}
                  <div className="mb-2 bg-shGreen/5 border border-shGreen/30 rounded p-2">
                    <label className="block">
                      <span className="text-[11px] font-black uppercase tracking-widest text-shGreen">
                        <i className="fas fa-envelope-open-text mr-1"/>Homework for this module
                        {mi === 0 ? " · sent at enrollment" : ` · sent when module ${mi} is mastered`}
                      </span>
                      <select value={m.homework_template_id||""}
                              onChange={(e)=>updateModule(mi, {homework_template_id: e.target.value || null})}
                              data-testid={`prog-module-hw-${mi}`}
                              className="mt-1 w-full bg-bgPanel border border-bgHover rounded p-1.5 text-white text-[13px]">
                        <option value="">— None (no auto-homework for this module) —</option>
                        {hwTemplates.map(t => (
                          <option key={t.id} value={t.id}>{t.name}{t.tier ? ` · ${t.tier}` : ""}</option>
                        ))}
                      </select>
                      <p className="text-[11px] text-gray-500 mt-1 normal-case font-normal tracking-normal">
                        {mi === 0
                          ? "This is module 1 — its homework is sent the moment the dog is enrolled in the program."
                          : `Sent automatically when all goals in the previous module ("${(program.modules[mi-1]||{}).name || `Module ${mi}`}") are marked mastered.`}
                      </p>
                    </label>
                  </div>
                  <div className="space-y-1">
                    {(m.goals||[]).map((g, gi) => (
                      <div key={gi} className="bg-bgPanel rounded px-2 py-1.5">
                        <div className="flex gap-2 items-center">
                          <i className="fas fa-circle-dot text-shGreen text-[12px]"/>
                          <input value={g.name} onChange={(e)=>updateGoal(mi, gi, {name:e.target.value})}
                                 className="flex-1 bg-transparent text-[14px] text-white outline-none" />
                          <input value={g.description||""} onChange={(e)=>updateGoal(mi, gi, {description:e.target.value})}
                                 placeholder="description"
                                 className="flex-[2] bg-transparent text-[15px] text-gray-400 outline-none" />
                          <label className="flex items-center gap-1 text-[13px] text-pink-300 cursor-pointer" title="If on, this goal is a check-off (Done/Reset) instead of a 0-5 score">
                            <input type="checkbox" checked={!!g.manual_only} onChange={(e)=>updateGoal(mi, gi, {manual_only:e.target.checked})} className="accent-pink-400"/>
                            Manual
                          </label>
                          <button onClick={()=>removeGoal(mi, gi)} className="text-red-400 hover:text-red-300 text-xs"><i className="fas fa-times"/></button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <button onClick={()=>addGoal(mi)}
                          className="mt-2 text-[15px] text-shBlue hover:text-white font-black uppercase tracking-widest">
                    <i className="fas fa-plus mr-1"/>Add Goal
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="px-6 py-3 border-t border-bgHover flex justify-between items-center gap-3 shrink-0">
          {extraError ? <p className="text-red-400 text-[14px] font-bold truncate flex-1" data-testid="program-editor-err">{extraError}</p> : <span className="flex-1"/>}
          <div className="flex gap-3 shrink-0">
            <button onClick={onClose} className="text-gray-500 font-black uppercase text-[15px] tracking-widest">Cancel</button>
            <button onClick={onSave} data-testid="prog-save"
                    className="bg-shGreen text-bgHeader px-6 py-2 rounded font-black text-[15px] uppercase tracking-widest shadow">Save Program</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return <div><label className="text-[15px] font-black text-gray-500 uppercase tracking-widest">{label}</label><div className="mt-1">{children}</div></div>;
}
