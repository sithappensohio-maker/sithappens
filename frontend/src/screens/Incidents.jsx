import { useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";

const TYPES = [
  { key: "bite", label: "Bite", color: "bg-red-500/15 text-red-400" },
  { key: "injury", label: "Injury", color: "bg-shOrange/15 text-shOrange" },
  { key: "escape", label: "Escape", color: "bg-yellow-500/15 text-yellow-400" },
  { key: "illness", label: "Illness", color: "bg-purple-500/15 text-purple-400" },
  { key: "property_damage", label: "Property", color: "bg-gray-500/15 text-gray-300" },
  { key: "behavior", label: "Behavior", color: "bg-shBlue/15 text-shBlue" },
  { key: "other", label: "Other", color: "bg-bgHover text-gray-300" },
];
const SEVERITIES = [
  { key: "minor", label: "Minor", color: "bg-shGreen/15 text-shGreen" },
  { key: "moderate", label: "Moderate", color: "bg-shOrange/15 text-shOrange" },
  { key: "severe", label: "Severe", color: "bg-red-500/15 text-red-400" },
];

function todayISO() { return new Date().toISOString().split("T")[0]; }
function nowHHMM() { const d=new Date(); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }

const emptyForm = {
  dog_id: "", date: todayISO(), time: nowHHMM(), type: "behavior", severity: "minor",
  description: "", witnesses: "", action_taken: "", photos: [], vet_required: false, follow_up_required: false,
};

export default function Incidents() {
  const [incidents, setIncidents] = useState([]);
  const [dogs, setDogs] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState("all");

  const load = async () => {
    const [iRes, dRes] = await Promise.all([api.get("/incidents"), api.get("/dogs")]);
    setIncidents(iRes.data); setDogs(dRes.data);
  };
  useEffect(() => { load(); }, []);

  const openNew = () => {
    if (dogs.length === 0) { alert("Add a dog first"); return; }
    setEditing(null);
    setForm({ ...emptyForm, dog_id: dogs[0].id });
    setOpen(true); setErr("");
  };
  const openEdit = (inc) => { setEditing(inc); setForm({ ...emptyForm, ...inc }); setOpen(true); setErr(""); };

  const onFiles = (e) => {
    const files = Array.from(e.target.files || []).slice(0, 4 - form.photos.length);
    files.forEach(f => {
      const r = new FileReader();
      r.onload = () => setForm((cur)=>({ ...cur, photos: [...cur.photos, r.result].slice(0,4) }));
      r.readAsDataURL(f);
    });
  };

  const save = async () => {
    setErr("");
    try {
      if (editing) await api.put(`/incidents/${editing.id}`, form);
      else await api.post("/incidents", form);
      setOpen(false); load();
    } catch (e) { setErr(formatErr(e.response?.data?.detail)); }
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this incident? This is a permanent legal record.")) return;
    await api.delete(`/incidents/${id}`); load();
  };

  const filtered = filter==="all" ? incidents : incidents.filter(i => i.type === filter);
  const typeStyle = (k) => TYPES.find(t=>t.key===k)?.color || "bg-bgHover text-gray-300";
  const sevStyle = (k) => SEVERITIES.find(s=>s.key===k)?.color || "bg-bgHover text-gray-300";

  return (
    <div className="space-y-6 animate-slide-in" data-testid="incidents-screen">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h3 className="text-xl font-black text-white uppercase italic tracking-tight">Incident Reports</h3>
          <p className="text-[14px] text-gray-500 font-black uppercase tracking-widest mt-1">Permanent legal record · all bite/injury/escape events</p>
        </div>
        <button onClick={openNew} data-testid="add-incident-button"
                className="bg-red-500 text-white px-5 py-2 rounded-lg text-[14px] font-black uppercase tracking-widest shadow-lg hover:bg-red-500/90">+ Log Incident</button>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={()=>setFilter("all")} className={`px-3 py-1.5 rounded text-[14px] font-black uppercase tracking-widest ${filter==="all"?"bg-shBlue text-white":"bg-bgPanel text-gray-400 border border-bgHover"}`}>All · {incidents.length}</button>
        {TYPES.map(t => {
          const n = incidents.filter(i=>i.type===t.key).length;
          return <button key={t.key} onClick={()=>setFilter(t.key)} className={`px-3 py-1.5 rounded text-[14px] font-black uppercase tracking-widest ${filter===t.key?"bg-shBlue text-white":t.color}`}>{t.label} · {n}</button>;
        })}
      </div>

      <div className="space-y-3" data-testid="incidents-list">
        {filtered.length === 0 && <div className="bg-bgPanel border border-bgHover rounded-xl p-10 text-center"><p className="text-shGreen font-black uppercase text-xs tracking-widest"><i className="fas fa-shield-heart mr-2"/>No incidents on record. Keep up the great work.</p></div>}
        {filtered.map(i => (
          <div key={i.id} className="bg-bgPanel border border-bgHover rounded-xl p-5 shadow-lg" data-testid={`incident-${i.id}`}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className={`text-[14px] font-black uppercase px-2 py-1 rounded tracking-widest ${typeStyle(i.type)}`}>{TYPES.find(t=>t.key===i.type)?.label || i.type}</span>
                  <span className={`text-[14px] font-black uppercase px-2 py-1 rounded tracking-widest ${sevStyle(i.severity)}`}>{i.severity}</span>
                  {i.vet_required && <span className="text-[14px] font-black uppercase px-2 py-1 rounded tracking-widest bg-purple-500/15 text-purple-400"><i className="fas fa-stethoscope mr-1"/>Vet</span>}
                  {i.follow_up_required && <span className="text-[14px] font-black uppercase px-2 py-1 rounded tracking-widest bg-shOrange/15 text-shOrange"><i className="fas fa-flag mr-1"/>Follow-up</span>}
                </div>
                <p className="text-sm text-white font-black uppercase tracking-tight">{i.dog_name} <span className="text-gray-400 font-normal"> · {i.client_name}</span></p>
                <p className="text-[14px] text-gray-500 font-black uppercase tracking-widest mt-1">{i.date}{i.time?` · ${i.time}`:""} · reported by {i.reported_by}</p>
                <p className="text-sm text-gray-300 mt-3 whitespace-pre-wrap">{i.description}</p>
                {i.action_taken && <p className="text-xs text-gray-400 mt-2"><span className="text-shBlue font-black uppercase tracking-widest text-[14px]">Action: </span>{i.action_taken}</p>}
                {i.witnesses && <p className="text-xs text-gray-400 mt-1"><span className="text-shBlue font-black uppercase tracking-widest text-[14px]">Witnesses: </span>{i.witnesses}</p>}
                {i.photos?.length > 0 && (
                  <div className="flex gap-2 mt-3 flex-wrap">
                    {i.photos.map((p,idx)=><img key={idx} src={p} alt="" className="h-20 w-20 rounded object-cover border border-bgHover" />)}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-2 shrink-0">
                <button onClick={()=>openEdit(i)} className="text-gray-400 hover:text-white p-2" data-testid={`edit-incident-${i.id}`}><i className="fas fa-edit text-sm" /></button>
                <button onClick={()=>remove(i.id)} className="text-gray-400 hover:text-red-400 p-2"><i className="fas fa-trash text-sm" /></button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {open && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
          <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-2xl p-6 md:p-8 shadow-2xl max-h-[95vh] overflow-y-auto animate-slide-in">
            <div className="flex items-center justify-between mb-5">
              <h4 className="text-xl font-black text-white uppercase italic tracking-tight">{editing?"Edit Incident":"Log Incident"}</h4>
              <button onClick={()=>setOpen(false)} className="text-gray-500 hover:text-white"><i className="fas fa-times" /></button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Dog</label>
                <select value={form.dog_id} onChange={(e)=>setForm({...form, dog_id: e.target.value})} data-testid="incident-dog-select"
                        className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                  {dogs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Date</label>
                  <input type="date" value={form.date} onChange={(e)=>setForm({...form, date:e.target.value})} className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" style={{colorScheme:"dark"}} />
                </div>
                <div>
                  <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Time</label>
                  <input type="time" value={form.time} onChange={(e)=>setForm({...form, time:e.target.value})} className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" style={{colorScheme:"dark"}} />
                </div>
              </div>

              <div>
                <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Type</label>
                <div className="grid grid-cols-3 gap-2 mt-1">
                  {TYPES.map(t => (
                    <button key={t.key} onClick={()=>setForm({...form, type:t.key})} data-testid={`incident-type-${t.key}`}
                            className={`py-2 px-2 rounded text-[14px] font-black uppercase tracking-widest border ${form.type===t.key?"bg-shBlue text-white border-shBlue":"bg-bgBase border-bgHover text-gray-400"}`}>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Severity</label>
                <div className="grid grid-cols-3 gap-2 mt-1">
                  {SEVERITIES.map(s => (
                    <button key={s.key} onClick={()=>setForm({...form, severity:s.key})} data-testid={`incident-severity-${s.key}`}
                            className={`py-2 rounded text-[14px] font-black uppercase tracking-widest border ${form.severity===s.key?"bg-shBlue text-white border-shBlue":"bg-bgBase border-bgHover text-gray-400"}`}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">What happened? (required)</label>
                <textarea value={form.description} onChange={(e)=>setForm({...form, description:e.target.value})} rows={4} placeholder="Detailed account of the incident…" data-testid="incident-description"
                          className="w-full mt-1 bg-bgBase border border-bgHover rounded p-3 text-white text-sm focus:border-shBlue outline-none" />
              </div>

              <div>
                <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Action Taken</label>
                <textarea value={form.action_taken} onChange={(e)=>setForm({...form, action_taken:e.target.value})} rows={2} placeholder="What did you do? Notified owner? Vet?"
                          className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm focus:border-shBlue outline-none" />
              </div>

              <div>
                <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Witnesses</label>
                <input value={form.witnesses} onChange={(e)=>setForm({...form, witnesses:e.target.value})} placeholder="Names of anyone who saw it"
                       className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
              </div>

              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={!!form.vet_required} onChange={(e)=>setForm({...form, vet_required:e.target.checked})} data-testid="incident-vet" className="accent-purple-500 w-4 h-4" />
                  <span className="text-[14px] font-black uppercase tracking-widest text-gray-300">Vet required</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={!!form.follow_up_required} onChange={(e)=>setForm({...form, follow_up_required:e.target.checked})} data-testid="incident-followup" className="accent-shOrange w-4 h-4" />
                  <span className="text-[14px] font-black uppercase tracking-widest text-gray-300">Needs follow-up</span>
                </label>
              </div>

              <div>
                <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Photos (up to 4)</label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {form.photos.map((p, i) => (
                    <div key={i} className="relative">
                      <img src={p} alt="" className="h-20 w-20 rounded object-cover border border-bgHover" />
                      <button onClick={()=>setForm({...form, photos: form.photos.filter((_,j)=>j!==i)})} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 text-xs">×</button>
                    </div>
                  ))}
                  {form.photos.length < 4 && (
                    <label className="h-20 w-20 rounded border-2 border-dashed border-bgHover flex items-center justify-center cursor-pointer hover:border-shBlue text-gray-500 hover:text-shBlue">
                      <i className="fas fa-camera" />
                      <input type="file" accept="image/*" multiple onChange={onFiles} className="hidden" data-testid="incident-photo-input" />
                    </label>
                  )}
                </div>
              </div>

              {err && <div className="text-[15px] text-red-400 bg-red-500/10 rounded p-3 uppercase font-black">{err}</div>}

              <div className="flex justify-end gap-3 pt-2">
                <button onClick={()=>setOpen(false)} className="text-gray-500 font-black uppercase text-[14px] tracking-widest">Cancel</button>
                <button onClick={save} data-testid="save-incident-button"
                        className="bg-red-500 text-white px-8 py-3 rounded font-black text-[14px] uppercase tracking-widest shadow-xl">Save Incident Report</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
