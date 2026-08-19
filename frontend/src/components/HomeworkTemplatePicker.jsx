import { useEffect, useState } from "react";
import { api } from "../lib/api";
import HomeworkTemplateEditor from "./HomeworkTemplateEditor";

const TIER_META = {
  foundation:   { label: "Tier 1 · Foundation",     color: "text-shPrimary",   bg: "bg-shPrimary/10",   ring: "border-shPrimary/30" },
  intermediate: { label: "Tier 2 · Intermediate",   color: "text-shSecondary",    bg: "bg-shSecondary/10",    ring: "border-shSecondary/30" },
  advanced:     { label: "Tier 3 · Advanced",       color: "text-purple-400",bg: "bg-purple-500/10",ring: "border-purple-400/30" },
  specialty:    { label: "Specialty",                color: "text-pink-400",  bg: "bg-pink-500/10",  ring: "border-pink-400/30" },
  master:       { label: "Customizable",             color: "text-shTextMuted",  bg: "bg-shSurfaceRaised",      ring: "border-shBorder" },
};

export function tierMeta(tier) { return TIER_META[tier] || TIER_META.master; }

/**
 * Template-picker modal — admin selects a homework template, optionally
 * tweaks title/instructions/due-date, picks a dog, and assigns it.
 *
 * Props:
 *   - dogs: full list of dogs
 *   - onClose, onAssigned
 *   - defaultDogId (optional, pre-selects a dog)
 */
export default function TemplatePicker({ dogs, defaultDogId = "", onClose, onAssigned }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [dogId, setDogId] = useState(defaultDogId || (dogs[0]?.id || ""));
  const [titleOverride, setTitleOverride] = useState("");
  const [instructionsOverride, setInstructionsOverride] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // Client Practice Coach upgrade — the template CRUD editor, reached from
  // here rather than a second disconnected tool. null = closed, "new" = a
  // fresh template, an id = editing that template.
  const [editingTemplateId, setEditingTemplateId] = useState(null);

  useEffect(() => { loadTemplates(); }, []);

  const loadTemplates = async () => {
    setLoading(true);
    try {
      let { data } = await api.get("/homework-templates");
      if (data.length === 0) {
        await api.post("/homework-templates/seed-standard");
        const r = await api.get("/homework-templates");
        data = r.data;
      }
      setTemplates(data);
    } finally { setLoading(false); }
  };

  const assign = async () => {
    if (!selected || !dogId) return;
    setBusy(true); setErr("");
    try {
      const body = {
        dog_id: dogId,
        template_id: selected.id,
        title_override: titleOverride || undefined,
        instructions_override: instructionsOverride || undefined,
        due_date: dueDate || undefined,
        video_url: videoUrl || undefined,
      };
      const { data } = await api.post("/homework/from-template", body);
      onAssigned?.(data);
      onClose?.();
    } catch (e) {
      setErr(e.response?.data?.detail || "Failed to assign");
    } finally { setBusy(false); }
  };

  // Group by tier
  const byTier = templates.reduce((acc, t) => {
    (acc[t.tier] = acc[t.tier] || []).push(t);
    return acc;
  }, {});
  const tierOrder = ["foundation", "intermediate", "advanced", "specialty", "master"];

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" onClick={onClose} data-testid="template-picker">
      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-4xl max-h-[calc(var(--app-height)_-_2rem)] overflow-y-auto shadow-2xl" onClick={(e)=>e.stopPropagation()}>
        <div className="sticky top-0 bg-[var(--sh-card-base)] border-b border-shBorder p-5 flex items-center justify-between z-10">
          <div>
            <h3 className="text-xl font-black text-shText uppercase italic tracking-tight">{selected ? "Customize & Assign" : "Pick a Practice Template"}</h3>
            <p className="text-[14px] text-shTextMuted font-black uppercase tracking-widest mt-1">{selected ? selected.name : `${templates.length} ready-to-assign forms`}</p>
          </div>
          <button onClick={onClose} className="text-shTextMuted hover:text-shText text-xl"><i className="fas fa-times" /></button>
        </div>

        {!selected ? (
          <div className="p-5 space-y-6">
            <div className="flex justify-end">
              <button onClick={() => setEditingTemplateId("new")} data-testid="template-new-button"
                      className="bg-shPrimary/15 text-shPrimary border border-shPrimary/40 rounded-lg px-3 py-2 text-[12px] font-black uppercase tracking-widest">
                <i className="fas fa-plus mr-1.5"/>New Template
              </button>
            </div>
            {loading && <div className="text-center text-shTextMuted py-12 text-sm uppercase font-black tracking-widest">Loading templates…</div>}
            {tierOrder.map(tier => byTier[tier] && (
              <div key={tier}>
                <p className={`text-[14px] font-black uppercase tracking-widest mb-3 ${tierMeta(tier).color}`}>{tierMeta(tier).label}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {byTier[tier].map(t => (
                    <div key={t.id} role="button" tabIndex={0}
                            onClick={()=>{ setSelected(t); setTitleOverride(""); setInstructionsOverride(""); setDueDate(""); }}
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelected(t); setTitleOverride(""); setInstructionsOverride(""); setDueDate(""); } }}
                            data-testid={`template-card-${t.slug}`}
                            className={`text-left p-4 rounded-xl border ${t.daily_tracker ? "border-purple-500/50 ring-1 ring-purple-500/20" : tierMeta(tier).ring} bg-[var(--sh-card-base)] hover:bg-shSurfaceRaised transition relative cursor-pointer`}>
                      <div className={`absolute top-3 right-3 ${tierMeta(tier).bg} ${tierMeta(tier).color} rounded p-2`}>
                        <i className={`fas ${t.icon || "fa-paw"}`} />
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); setEditingTemplateId(t.id); }} data-testid={`template-edit-${t.slug}`}
                              className="absolute top-3 right-14 text-shTextMuted hover:text-shPrimary p-1.5">
                        <i className="fas fa-pen text-[13px]"/>
                      </button>
                      {/* Sprint 110ae — Daily-Tracker badge so admins instantly
                          know which templates produce the day-by-day Tracker
                          UX (purple) vs. the session-log style (no badge). */}
                      {t.daily_tracker && (
                        <span className="inline-flex items-center gap-1 bg-purple-500/15 text-purple-300 border border-purple-500/40 text-[10px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded mb-2 mr-1.5"
                              data-testid={`template-tracker-badge-${t.slug}`}>
                          <i className="fas fa-calendar-check text-[9px]"/>Daily Tracker
                        </span>
                      )}
                      {t.practice_coach?.enabled && (
                        <span className="inline-flex items-center gap-1 bg-shPrimary/15 text-shPrimary border border-shPrimary/40 text-[10px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded mb-2"
                              data-testid={`template-coach-badge-${t.slug}`}>
                          <i className="fas fa-baseball-bat-ball text-[9px]"/>Coach Mode
                        </span>
                      )}
                      <h4 className="text-shText font-black text-[15px] uppercase tracking-tight pr-10">{t.name}</h4>
                      <p className="text-shTextMuted text-[15px] mt-2 leading-snug line-clamp-3">{t.description}</p>
                      <p className="text-[14px] font-black uppercase tracking-widest text-shTextMuted mt-3"><i className="fas fa-list mr-1"/>{(t.sections || []).length} sections · {t.default_duration_days}d</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {editingTemplateId !== null && (
              <HomeworkTemplateEditor
                templateId={editingTemplateId === "new" ? null : editingTemplateId}
                onClose={() => setEditingTemplateId(null)}
                onSaved={() => { setEditingTemplateId(null); loadTemplates(); }}
              />
            )}
          </div>
        ) : (
          <div className="p-5 grid grid-cols-1 lg:grid-cols-5 gap-5">
            <div className="lg:col-span-3 space-y-4">
              <div className={`rounded-xl border ${selected.daily_tracker ? "border-purple-500/50 ring-1 ring-purple-500/20" : tierMeta(selected.tier).ring} ${tierMeta(selected.tier).bg} p-4`}>
                <div className="flex items-center gap-3 mb-3">
                  <i className={`fas ${selected.icon} text-2xl ${tierMeta(selected.tier).color}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={`text-[13px] font-black uppercase tracking-widest ${tierMeta(selected.tier).color}`}>{tierMeta(selected.tier).label}</p>
                      {selected.daily_tracker && (
                        <span className="inline-flex items-center gap-1 bg-purple-500/15 text-purple-300 border border-purple-500/40 text-[10px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded">
                          <i className="fas fa-calendar-check text-[9px]"/>Daily Tracker
                        </span>
                      )}
                    </div>
                    <h4 className="text-shText font-black uppercase tracking-tight">{selected.name}</h4>
                  </div>
                </div>
                <p className="text-[14px] text-shTextMuted">{selected.description}</p>
              </div>

              {(selected.global_rules_this_week || []).length > 0 && (
                <div>
                  <p className="text-[14px] font-black uppercase tracking-widest text-shAccent mb-2"><i className="fas fa-triangle-exclamation mr-1"/>House Rules This Week</p>
                  <ul className="space-y-1.5 text-[15px] text-shTextMuted">
                    {selected.global_rules_this_week.map((r,i) => <li key={i} className="flex gap-2"><span className="text-shAccent">▸</span><span>{r}</span></li>)}
                  </ul>
                </div>
              )}

              <div>
                <p className="text-[14px] font-black uppercase tracking-widest text-shSecondary mb-2"><i className="fas fa-list mr-1"/>What the client will log ({(selected.sections || []).length} sections)</p>
                <div className="space-y-2">
                  {(selected.sections || []).map(s => (
                    <details key={s.id} className="bg-[var(--sh-card-base)] border border-shBorder rounded p-3">
                      <summary className="cursor-pointer text-shText font-black text-[14px] uppercase tracking-tight">{s.title}</summary>
                      <p className="text-[15px] text-shTextMuted mt-2 whitespace-pre-wrap">{s.instructions}</p>
                      <ul className="mt-2 grid grid-cols-2 gap-1 text-[14px] text-shTextMuted">
                        {(s.fields || []).map(f => (
                          <li key={f.id} className="flex items-center gap-1.5"><i className="fas fa-circle text-[6px] text-shPrimary" /><span>{f.label}{f.target ? ` (goal ${f.target})` : ""}</span></li>
                        ))}
                      </ul>
                    </details>
                  ))}
                </div>
              </div>
            </div>

            <div className="lg:col-span-2 space-y-3">
              <div>
                <label className="text-[14px] font-black text-shTextMuted uppercase tracking-widest">Dog</label>
                <select value={dogId} onChange={(e)=>setDogId(e.target.value)} data-testid="template-dog-select"
                        className="w-full mt-1 bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm">
                  {dogs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[14px] font-black text-shTextMuted uppercase tracking-widest">Title (optional override)</label>
                <input value={titleOverride} onChange={(e)=>setTitleOverride(e.target.value)} placeholder={selected.name}
                       className="w-full mt-1 bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
              </div>
              <div>
                <label className="text-[14px] font-black text-shTextMuted uppercase tracking-widest">Personal note for client (optional)</label>
                <textarea value={instructionsOverride} onChange={(e)=>setInstructionsOverride(e.target.value)} rows={3}
                          placeholder="e.g., Focus on the door manners section this week — that's where Rocky struggles most."
                          className="w-full mt-1 bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
              </div>
              <div>
                <label className="text-[14px] font-black text-shTextMuted uppercase tracking-widest">Demo video (optional)</label>
                <input value={videoUrl} onChange={(e)=>setVideoUrl(e.target.value)} placeholder="https://youtu.be/..."
                       className="w-full mt-1 bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" />
              </div>
              <div>
                <label className="text-[14px] font-black text-shTextMuted uppercase tracking-widest">Due date (optional)</label>
                <input type="date" value={dueDate} onChange={(e)=>setDueDate(e.target.value)} data-testid="template-due-date"
                       className="w-full mt-1 bg-[var(--sh-card-base)] border border-shBorder rounded p-2 text-shText text-sm" style={{colorScheme:"dark"}} />
                <p className="text-[13px] text-shTextMuted mt-1">Defaults to today + {selected.default_duration_days} days.</p>
              </div>
              {err && <div className="text-[15px] text-red-400 bg-red-500/10 rounded p-3 uppercase font-black">{err}</div>}
              <div className="flex gap-2">
                <button onClick={()=>setSelected(null)} className="text-shTextMuted px-4 py-3 font-black uppercase text-[15px] tracking-widest">← Back</button>
                <button onClick={assign} disabled={busy} data-testid="template-assign-button"
                        className="flex-1 bg-shPrimary text-black px-5 py-3 rounded font-black text-[14px] uppercase tracking-widest hover:bg-shPrimary/80 disabled:opacity-50">
                  {busy ? "Assigning…" : "Assign to dog"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
