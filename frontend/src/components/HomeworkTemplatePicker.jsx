import { useEffect, useState } from "react";
import { api } from "../lib/api";

const TIER_META = {
  foundation:   { label: "Tier 1 · Foundation",     color: "text-shGreen",   bg: "bg-shGreen/10",   ring: "border-shGreen/30" },
  intermediate: { label: "Tier 2 · Intermediate",   color: "text-shBlue",    bg: "bg-shBlue/10",    ring: "border-shBlue/30" },
  advanced:     { label: "Tier 3 · Advanced",       color: "text-purple-400",bg: "bg-purple-500/10",ring: "border-purple-400/30" },
  specialty:    { label: "Specialty",                color: "text-pink-400",  bg: "bg-pink-500/10",  ring: "border-pink-400/30" },
  master:       { label: "Customizable",             color: "text-gray-300",  bg: "bg-bgHover",      ring: "border-bgHover" },
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
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl" onClick={(e)=>e.stopPropagation()}>
        <div className="sticky top-0 bg-bgPanel border-b border-bgHover p-5 flex items-center justify-between z-10">
          <div>
            <h3 className="text-xl font-black text-white uppercase italic tracking-tight">{selected ? "Customize & Assign" : "Pick a Homework Template"}</h3>
            <p className="text-[14px] text-gray-500 font-black uppercase tracking-widest mt-1">{selected ? selected.name : `${templates.length} ready-to-assign forms`}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl"><i className="fas fa-times" /></button>
        </div>

        {!selected ? (
          <div className="p-5 space-y-6">
            {loading && <div className="text-center text-gray-500 py-12 text-sm uppercase font-black tracking-widest">Loading templates…</div>}
            {tierOrder.map(tier => byTier[tier] && (
              <div key={tier}>
                <p className={`text-[14px] font-black uppercase tracking-widest mb-3 ${tierMeta(tier).color}`}>{tierMeta(tier).label}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {byTier[tier].map(t => (
                    <button key={t.id} onClick={()=>{ setSelected(t); setTitleOverride(""); setInstructionsOverride(""); setDueDate(""); }}
                            data-testid={`template-card-${t.slug}`}
                            className={`text-left p-4 rounded-xl border ${tierMeta(tier).ring} bg-bgBase hover:bg-bgHover transition relative`}>
                      <div className={`absolute top-3 right-3 ${tierMeta(tier).bg} ${tierMeta(tier).color} rounded p-2`}>
                        <i className={`fas ${t.icon || "fa-paw"}`} />
                      </div>
                      <h4 className="text-white font-black text-[15px] uppercase tracking-tight pr-10">{t.name}</h4>
                      <p className="text-gray-400 text-[15px] mt-2 leading-snug line-clamp-3">{t.description}</p>
                      <p className="text-[14px] font-black uppercase tracking-widest text-gray-500 mt-3"><i className="fas fa-list mr-1"/>{(t.sections || []).length} sections · {t.default_duration_days}d</p>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-5 grid grid-cols-1 lg:grid-cols-5 gap-5">
            <div className="lg:col-span-3 space-y-4">
              <div className={`rounded-xl border ${tierMeta(selected.tier).ring} ${tierMeta(selected.tier).bg} p-4`}>
                <div className="flex items-center gap-3 mb-3">
                  <i className={`fas ${selected.icon} text-2xl ${tierMeta(selected.tier).color}`} />
                  <div>
                    <p className={`text-[13px] font-black uppercase tracking-widest ${tierMeta(selected.tier).color}`}>{tierMeta(selected.tier).label}</p>
                    <h4 className="text-white font-black uppercase tracking-tight">{selected.name}</h4>
                  </div>
                </div>
                <p className="text-[14px] text-gray-300">{selected.description}</p>
              </div>

              {(selected.global_rules_this_week || []).length > 0 && (
                <div>
                  <p className="text-[14px] font-black uppercase tracking-widest text-shOrange mb-2"><i className="fas fa-triangle-exclamation mr-1"/>House Rules This Week</p>
                  <ul className="space-y-1.5 text-[15px] text-gray-300">
                    {selected.global_rules_this_week.map((r,i) => <li key={i} className="flex gap-2"><span className="text-shOrange">▸</span><span>{r}</span></li>)}
                  </ul>
                </div>
              )}

              <div>
                <p className="text-[14px] font-black uppercase tracking-widest text-shBlue mb-2"><i className="fas fa-list mr-1"/>What the client will log ({(selected.sections || []).length} sections)</p>
                <div className="space-y-2">
                  {(selected.sections || []).map(s => (
                    <details key={s.id} className="bg-bgBase border border-bgHover rounded p-3">
                      <summary className="cursor-pointer text-white font-black text-[14px] uppercase tracking-tight">{s.title}</summary>
                      <p className="text-[15px] text-gray-300 mt-2 whitespace-pre-wrap">{s.instructions}</p>
                      <ul className="mt-2 grid grid-cols-2 gap-1 text-[14px] text-gray-400">
                        {(s.fields || []).map(f => (
                          <li key={f.id} className="flex items-center gap-1.5"><i className="fas fa-circle text-[6px] text-shGreen" /><span>{f.label}{f.target ? ` (goal ${f.target})` : ""}</span></li>
                        ))}
                      </ul>
                    </details>
                  ))}
                </div>
              </div>
            </div>

            <div className="lg:col-span-2 space-y-3">
              <div>
                <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Dog</label>
                <select value={dogId} onChange={(e)=>setDogId(e.target.value)} data-testid="template-dog-select"
                        className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                  {dogs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Title (optional override)</label>
                <input value={titleOverride} onChange={(e)=>setTitleOverride(e.target.value)} placeholder={selected.name}
                       className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
              </div>
              <div>
                <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Personal note for client (optional)</label>
                <textarea value={instructionsOverride} onChange={(e)=>setInstructionsOverride(e.target.value)} rows={3}
                          placeholder="e.g., Focus on the door manners section this week — that's where Rocky struggles most."
                          className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
              </div>
              <div>
                <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Demo video (optional)</label>
                <input value={videoUrl} onChange={(e)=>setVideoUrl(e.target.value)} placeholder="https://youtu.be/..."
                       className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
              </div>
              <div>
                <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Due date (optional)</label>
                <input type="date" value={dueDate} onChange={(e)=>setDueDate(e.target.value)} data-testid="template-due-date"
                       className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" style={{colorScheme:"dark"}} />
                <p className="text-[13px] text-gray-500 mt-1">Defaults to today + {selected.default_duration_days} days.</p>
              </div>
              {err && <div className="text-[15px] text-red-400 bg-red-500/10 rounded p-3 uppercase font-black">{err}</div>}
              <div className="flex gap-2">
                <button onClick={()=>setSelected(null)} className="text-gray-400 px-4 py-3 font-black uppercase text-[15px] tracking-widest">← Back</button>
                <button onClick={assign} disabled={busy} data-testid="template-assign-button"
                        className="flex-1 bg-shGreen text-black px-5 py-3 rounded font-black text-[14px] uppercase tracking-widest hover:bg-shGreen/80 disabled:opacity-50">
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
