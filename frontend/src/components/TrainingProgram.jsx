import { useEffect, useMemo, useState } from "react";
import { api, formatErr } from "../lib/api";
import ProgressRing from "./ProgressRing";

const ENVIRONMENTS = [
  { k: "home", label: "Home" },
  { k: "store", label: "Store" },
  { k: "park", label: "Park" },
  { k: "vet", label: "Vet" },
  { k: "training_facility", label: "Training Facility" },
  { k: "other", label: "Other" },
];

function todayISO() { return new Date().toISOString().split("T")[0]; }

/** Admin-side training curriculum panel. Lives inside the Dog edit modal. */
export default function TrainingProgram({ dogId, dogName }) {
  const [meta, setMeta] = useState(null);
  const [training, setTraining] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [sessionModal, setSessionModal] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editEntry, setEditEntry] = useState(null);
  const [err, setErr] = useState("");

  const load = async () => {
    setErr("");
    try {
      const [m, t, s] = await Promise.all([
        api.get("/training/meta"),
        api.get(`/dogs/${dogId}/training`),
        api.get(`/dogs/${dogId}/training-sessions`),
      ]);
      setMeta(m.data); setTraining(t.data); setSessions(s.data);
    } catch (e) { setErr(formatErr(e.response?.data?.detail) || "Load failed"); }
  };
  useEffect(() => { if (dogId) load(); }, [dogId]);

  if (!training || !meta) return <div className="text-gray-500 text-sm py-8 text-center"><i className="fas fa-spinner fa-spin mr-2"/>Loading curriculum…</div>;

  const scaleByValue = Object.fromEntries(meta.scale.map(s => [s.value, s]));
  const categoriesByKey = Object.fromEntries(meta.categories.map(c => [c.key, c]));
  const groupedItems = meta.categories.map(c => ({
    ...c,
    items: training.items.filter(it => it.command.category === c.key),
  }));

  const saveEntry = async () => {
    if (!editEntry) return;
    try {
      await api.put(`/dogs/${dogId}/training/${editEntry.command.id}`, {
        command_id: editEntry.command.id,
        level: editEntry.level,
        notes: editEntry.notes || "",
        in_homework: !!editEntry.in_homework,
      });
      setEditEntry(null);
      load();
    } catch (e) { setErr(formatErr(e.response?.data?.detail) || "Save failed"); }
  };

  return (
    <div className="space-y-5" data-testid="training-program">
      {err && <div className="text-[13px] text-red-400 bg-red-500/10 rounded p-3 uppercase font-black">{err}</div>}

      {/* Top bar: progress + badges + actions */}
      <div className="bg-bgBase/50 border border-bgHover rounded-lg p-4 flex flex-wrap items-center gap-5">
        <ProgressRing percent={training.progress.overall.mastered_pct}
                      size={120} stroke={10} color="#8cc63f"
                      label={`${training.progress.overall.mastered}/${training.progress.overall.total}`} />
        <div className="flex-1 min-w-[200px]">
          <p className="text-[13px] text-gray-500 font-black uppercase tracking-widest">Service-Dog Curriculum</p>
          <p className="text-base font-black text-white">{dogName}</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2">
            {training.progress.by_category.map(c => (
              <div key={c.key} className="flex items-center justify-between text-[13px]">
                <span className="font-black uppercase tracking-widest text-gray-400" style={{color: c.color}}>{c.label}</span>
                <span className="text-white font-black">{c.mastered}/{c.total}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <button onClick={()=>setSessionModal(true)} data-testid="log-session-btn"
                  className="bg-shGreen text-bgHeader px-4 py-2 rounded font-black text-[13px] uppercase tracking-widest shadow">
            <i className="fas fa-clipboard-check mr-1"/>Log Session
          </button>
          <button onClick={()=>setHistoryOpen(true)} data-testid="view-history-btn"
                  className="bg-bgPanel border border-bgHover text-gray-300 px-4 py-2 rounded font-black text-[13px] uppercase tracking-widest hover:border-shBlue hover:text-shBlue">
            <i className="fas fa-clock-rotate-left mr-1"/>History ({sessions.length})
          </button>
        </div>
      </div>

      {/* Badges */}
      {training.badges.length > 0 && (
        <div className="flex flex-wrap gap-2" data-testid="badges">
          {training.badges.map(b => (
            <div key={b.key} className="rounded-lg px-3 py-2 border flex items-center gap-2" style={{borderColor: b.color + "80", background: b.color + "15"}}>
              <i className="fas fa-medal text-base" style={{color: b.color}}/>
              <div>
                <p className="text-[13px] font-black uppercase tracking-widest" style={{color: b.color}}>{b.title}</p>
                <p className="text-[12px] text-gray-400">{b.description}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Curriculum grouped by category */}
      {groupedItems.map(group => (
        <div key={group.key} className="bg-bgBase/40 border border-bgHover rounded-lg overflow-hidden">
          <div className="px-4 py-2 border-b border-bgHover flex items-center justify-between" style={{background: group.color + "12"}}>
            <p className="text-[13px] font-black uppercase tracking-widest" style={{color: group.color}}>
              <i className="fas fa-graduation-cap mr-2"/>{group.label}
            </p>
            <p className="text-[12px] text-gray-500 font-black">{group.items.filter(i=>i.level>=4).length}/{group.items.length} mastered</p>
          </div>
          <div className="divide-y divide-bgHover">
            {group.items.map(item => {
              const sc = scaleByValue[item.level] || scaleByValue[0];
              return (
                <button key={item.command.id} onClick={()=>setEditEntry({...item})}
                        data-testid={`cmd-${item.command.id}`}
                        className="w-full px-4 py-3 flex items-start justify-between gap-3 hover:bg-bgHover/30 text-left transition">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-black text-white">{item.command.name}</p>
                      {item.in_homework && <span className="text-[11px] bg-shOrange/20 text-shOrange font-black uppercase tracking-widest px-2 py-0.5 rounded"><i className="fas fa-house mr-1"/>Homework</span>}
                      {item.command.video_url && <i className="fab fa-youtube text-red-500" title="Has video demo"/>}
                    </div>
                    <p className="text-[13px] text-gray-400 mt-0.5 line-clamp-1">{item.command.description}</p>
                    {item.last_session_at && <p className="text-[12px] text-gray-600 font-black uppercase tracking-widest mt-1">Last: {item.last_session_at}</p>}
                  </div>
                  <span className="shrink-0 px-3 py-1 rounded text-[12px] font-black uppercase tracking-widest border"
                        style={{color: sc.color, borderColor: sc.color + "80", background: sc.color + "15"}}>
                    {item.level}/5 · {sc.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {editEntry && (
        <EditEntryModal entry={editEntry} setEntry={setEditEntry} scale={meta.scale} onSave={saveEntry} onClose={()=>setEditEntry(null)} />
      )}

      {sessionModal && (
        <SessionLogModal dogId={dogId} dogName={dogName} meta={meta}
                         existingCurric={training.items}
                         onClose={()=>setSessionModal(false)}
                         onSaved={()=>{ setSessionModal(false); load(); }} />
      )}

      {historyOpen && (
        <HistoryModal sessions={sessions} meta={meta} commandsById={Object.fromEntries(training.items.map(i=>[i.command.id, i.command]))}
                      onClose={()=>setHistoryOpen(false)} />
      )}
    </div>
  );
}

function EditEntryModal({ entry, setEntry, scale, onSave, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" data-testid="edit-cmd-modal">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-lg p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h4 className="text-base font-black text-white uppercase italic">{entry.command.name}</h4>
            <p className="text-[13px] text-gray-500 font-black uppercase tracking-widest">{entry.command.category.replace("_"," ")}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><i className="fas fa-times text-xl"/></button>
        </div>
        <p className="text-[14px] text-gray-300 mb-3">{entry.command.description}</p>
        {entry.command.video_url && (
          <a href={entry.command.video_url} target="_blank" rel="noopener noreferrer"
             className="inline-block text-[13px] font-black uppercase tracking-widest text-red-400 mb-3"><i className="fab fa-youtube mr-2"/>Watch demo video</a>
        )}
        <label className="text-[13px] font-black text-gray-500 uppercase tracking-widest">Level</label>
        <div className="grid grid-cols-6 gap-1 mt-1 mb-3">
          {scale.map(s => (
            <button key={s.value} onClick={()=>setEntry({...entry, level: s.value})} data-testid={`level-${s.value}`}
                    title={s.description}
                    className={`py-2 rounded text-[13px] font-black tracking-widest border transition ${entry.level===s.value?"text-white":"text-gray-400 hover:text-white"}`}
                    style={entry.level===s.value ? {background: s.color, borderColor: s.color} : {borderColor:"#334155"}}>
              {s.value}
            </button>
          ))}
        </div>
        <p className="text-[12px] text-gray-400 mb-3">{scale.find(s=>s.value===entry.level)?.description}</p>
        <label className="text-[13px] font-black text-gray-500 uppercase tracking-widest">Trainer Notes</label>
        <textarea value={entry.notes||""} onChange={(e)=>setEntry({...entry, notes:e.target.value})} rows={3}
                  data-testid="entry-notes"
                  className="w-full mt-1 mb-3 bg-bgBase border border-bgHover rounded p-2 text-white text-sm focus:border-shBlue outline-none" />
        <label className="flex items-center gap-2 cursor-pointer text-[14px] text-gray-300 mb-4">
          <input type="checkbox" checked={!!entry.in_homework} onChange={(e)=>setEntry({...entry, in_homework: e.target.checked})}
                 data-testid="entry-homework" className="accent-shOrange" />
          <span><i className="fas fa-house text-shOrange mr-1"/>Flag for homework — show on client portal</span>
        </label>
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="text-gray-500 font-black uppercase text-[13px] tracking-widest">Cancel</button>
          <button onClick={onSave} data-testid="save-entry"
                  className="bg-shGreen text-bgHeader px-6 py-2 rounded font-black text-[13px] uppercase tracking-widest shadow">Save</button>
        </div>
      </div>
    </div>
  );
}

function SessionLogModal({ dogId, dogName, meta, existingCurric, onClose, onSaved }) {
  const [date, setDate] = useState(todayISO());
  const [env, setEnv] = useState("training_facility");
  const [distraction, setDistraction] = useState(3);
  const [notes, setNotes] = useState("");
  const [cgcPass, setCgcPass] = useState(false);
  const [scores, setScores] = useState({}); // {command_id: score}
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const grouped = useMemo(() => meta.categories.map(c => ({
    ...c,
    items: existingCurric.filter(i => i.command.category === c.key),
  })), [meta, existingCurric]);

  const save = async () => {
    const scoreList = Object.entries(scores).filter(([,v]) => v != null).map(([command_id, score]) => ({ command_id, score: Number(score) }));
    if (scoreList.length === 0) { setErr("Score at least one command — or close and just update the curriculum directly."); return; }
    setSaving(true); setErr("");
    try {
      await api.post(`/dogs/${dogId}/training-sessions`, {
        date, environment: env, distraction, notes, scores: scoreList, cgc_mock_pass: cgcPass,
      });
      onSaved?.();
    } catch (e) { setErr(formatErr(e.response?.data?.detail) || "Save failed"); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" data-testid="session-modal">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-3xl max-h-[92vh] flex flex-col shadow-2xl">
        <div className="px-6 py-4 border-b border-bgHover flex items-center justify-between shrink-0">
          <div>
            <h4 className="text-lg font-black text-white uppercase italic">Log Training Session</h4>
            <p className="text-[13px] text-gray-500 font-black uppercase tracking-widest">{dogName} · {date}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><i className="fas fa-times text-xl"/></button>
        </div>

        <div className="px-6 py-4 space-y-3 overflow-y-auto flex-1">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-[13px] font-black text-gray-500 uppercase tracking-widest">Date</label>
              <input type="date" value={date} onChange={(e)=>setDate(e.target.value)} data-testid="sess-date"
                     className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" style={{colorScheme:"dark"}} />
            </div>
            <div>
              <label className="text-[13px] font-black text-gray-500 uppercase tracking-widest">Environment</label>
              <select value={env} onChange={(e)=>setEnv(e.target.value)} data-testid="sess-env"
                      className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                {ENVIRONMENTS.map(e => <option key={e.k} value={e.k}>{e.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[13px] font-black text-gray-500 uppercase tracking-widest">Distraction · {distraction}/10</label>
              <input type="range" min="1" max="10" value={distraction} onChange={(e)=>setDistraction(Number(e.target.value))} data-testid="sess-distraction"
                     className="w-full mt-3 accent-shBlue" />
            </div>
          </div>

          <div>
            <label className="text-[13px] font-black text-gray-500 uppercase tracking-widest">Session Notes</label>
            <textarea value={notes} onChange={(e)=>setNotes(e.target.value)} rows={2} data-testid="sess-notes"
                      placeholder="What went well, what to work on next time…"
                      className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm focus:border-shBlue outline-none" />
          </div>

          <label className="flex items-center gap-2 cursor-pointer text-[14px] text-gray-300">
            <input type="checkbox" checked={cgcPass} onChange={(e)=>setCgcPass(e.target.checked)} data-testid="sess-cgc" className="accent-shGreen"/>
            <span><i className="fas fa-award text-shGreen mr-1"/>Dog passed a mock <strong>CGC (Canine Good Citizen)</strong> test in this session</span>
          </label>

          <div className="border-t border-bgHover pt-3">
            <p className="text-[13px] font-black uppercase tracking-widest text-shBlue mb-2">Score commands tested today</p>
            <p className="text-[13px] text-gray-400 mb-3">Skip any you didn't work on. Highest score wins — the curriculum auto-updates.</p>
            {grouped.map(g => (
              <div key={g.key} className="mb-4">
                <p className="text-[13px] font-black uppercase tracking-widest mb-2" style={{color: g.color}}>{g.label}</p>
                <div className="grid grid-cols-1 gap-2">
                  {g.items.map(it => (
                    <div key={it.command.id} className="bg-bgBase/60 border border-bgHover rounded p-2 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-black text-white truncate">{it.command.name}</p>
                        <p className="text-[12px] text-gray-500">Current: {it.level}/5</p>
                      </div>
                      <div className="flex gap-1">
                        {[1,2,3,4,5].map(n => (
                          <button key={n} onClick={()=>setScores(s => ({...s, [it.command.id]: scores[it.command.id]===n ? null : n}))}
                                  data-testid={`score-${it.command.id}-${n}`}
                                  className={`w-7 h-7 text-[13px] font-black rounded border ${scores[it.command.id]===n ? "bg-shGreen text-bgHeader border-shGreen" : "text-gray-400 border-bgHover hover:text-white"}`}>{n}</button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {err && <div className="text-[13px] text-red-400 bg-red-500/10 rounded p-2 uppercase font-black">{err}</div>}
        </div>

        <div className="px-6 py-3 border-t border-bgHover flex justify-end gap-3 shrink-0">
          <button onClick={onClose} className="text-gray-500 font-black uppercase text-[13px] tracking-widest">Cancel</button>
          <button onClick={save} disabled={saving} data-testid="save-session"
                  className="bg-shGreen text-bgHeader px-8 py-3 rounded font-black text-[13px] uppercase tracking-widest shadow disabled:opacity-50">
            {saving ? "Saving…" : "Save Session"}
          </button>
        </div>
      </div>
    </div>
  );
}

function HistoryModal({ sessions, meta, commandsById, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" data-testid="history-modal">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-2xl max-h-[88vh] flex flex-col shadow-2xl">
        <div className="px-6 py-4 border-b border-bgHover flex items-center justify-between shrink-0">
          <h4 className="text-base font-black text-white uppercase italic">Session History · {sessions.length}</h4>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><i className="fas fa-times text-xl"/></button>
        </div>
        <div className="overflow-y-auto flex-1 divide-y divide-bgHover">
          {sessions.length === 0 && <p className="px-6 py-8 text-center text-gray-500 text-sm">No sessions logged yet.</p>}
          {sessions.map(s => (
            <div key={s.id} className="px-6 py-3">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-black text-white">{s.date}</p>
                <p className="text-[13px] text-gray-400 font-black uppercase tracking-widest">{ENVIRONMENTS.find(e=>e.k===s.environment)?.label || s.environment} · Distraction {s.distraction}/10</p>
              </div>
              {s.cgc_mock_pass && <p className="text-[13px] text-shGreen font-black uppercase tracking-widest mb-1"><i className="fas fa-award mr-1"/>CGC Mock Pass</p>}
              {s.notes && <p className="text-[14px] text-gray-300 mb-1 italic">"{s.notes}"</p>}
              <div className="flex flex-wrap gap-1 mt-2">
                {s.scores.map((sc, i) => {
                  const c = commandsById[sc.command_id];
                  const def = (meta.scale.find(x=>x.value===sc.score)) || {};
                  return (
                    <span key={i} className="text-[12px] font-black uppercase tracking-widest px-2 py-0.5 rounded border"
                          style={{color: def.color, borderColor: (def.color||"#334155")+"80"}}>
                      {c?.name || "?"}: {sc.score}/5
                    </span>
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
