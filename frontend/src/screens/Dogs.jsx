import { useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import { compressImage } from "../lib/imageCompress";
import { useConfirm } from "../lib/useConfirm";
import { Modal, Input } from "./Clients";
import Lightbox from "../components/Lightbox";
import DogTrainingTab from "../components/DogTrainingTab";

const empty = {
  owner_id: "", name: "", breed: "", age_y: 0, age_m: 0, birthday: "",
  sex: "Male", fixed: "No",
  vaccines: { rabies: "", bordetella: "", dhpp: "" },
  notes: "", photo: "",
  feeding_schedule: [], medications: [], training_skills: [],
  vet_name: "", vet_phone: "",
  photos: [], tags: [],
};

const STANDARD_SKILLS = ["Sit", "Stay", "Down", "Place", "Recall", "Heel", "Leave It", "Wait", "Loose Leash", "Crate", "Watch Me", "Drop It"];
const LEVELS = [
  { key: "intro", label: "Intro", color: "bg-gray-500/20 text-gray-300" },
  { key: "practicing", label: "Practicing", color: "bg-shOrange/20 text-shOrange" },
  { key: "reliable", label: "Reliable", color: "bg-shBlue/20 text-shBlue" },
  { key: "proofed", label: "Proofed", color: "bg-shGreen/20 text-shGreen" },
];

function todayISO() { return new Date().toISOString().split("T")[0]; }
function vaccineStatus(d) {
  if (!d) return { label: "Missing", color: "text-red-400", bg: "bg-red-500/15" };
  const t = todayISO();
  if (d < t) return { label: "Expired", color: "text-red-400", bg: "bg-red-500/15" };
  const in30 = new Date(); in30.setDate(in30.getDate()+30);
  if (d < in30.toISOString().split("T")[0]) return { label: "Expiring soon", color: "text-shOrange", bg: "bg-shOrange/15" };
  return { label: "Valid", color: "text-shGreen", bg: "bg-shGreen/15" };
}
function uid() { return Math.random().toString(36).slice(2, 10); }

function TagEditor({ tags = [], onChange }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim();
    if (!t) return;
    if (tags.includes(t)) { setDraft(""); return; }
    onChange([...tags, t]);
    setDraft("");
  };
  const remove = (t) => onChange(tags.filter((x) => x !== t));
  return (
    <div className="mt-1 bg-bgBase border border-bgHover rounded p-2" data-testid="tag-editor">
      <div className="flex flex-wrap gap-2 mb-2">
        {tags.length === 0 && <span className="text-[12px] text-gray-500 italic">No tags yet — type below and hit Enter.</span>}
        {tags.map((t) => (
          <span key={t} className="bg-shBlue/15 text-shBlue px-2 py-1 rounded text-[12px] font-black uppercase tracking-widest flex items-center gap-1.5">
            {t}
            <button type="button" onClick={() => remove(t)} className="hover:text-red-400" data-testid={`remove-tag-${t}`}>
              <i className="fas fa-times text-[10px]" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          placeholder="Add a tag (Enter to save)"
          data-testid="tag-editor-input"
          className="flex-1 bg-bgPanel border border-bgHover rounded p-2 text-white text-sm focus:border-shBlue outline-none"
        />
        <button type="button" onClick={add} data-testid="tag-editor-add"
                className="bg-shBlue/15 text-shBlue px-3 py-2 rounded text-[12px] font-black uppercase tracking-widest hover:bg-shBlue/25">
          Add
        </button>
      </div>
    </div>
  );
}

const PROGRAM_TYPE_COLORS = {
  private_lessons: { bg: "bg-shBlue/15", text: "text-shBlue", bar: "bg-shBlue" },
  board_train: { bg: "bg-shGreen/15", text: "text-shGreen", bar: "bg-shGreen" },
  service_dog: { bg: "bg-purple-500/15", text: "text-purple-400", bar: "bg-purple-400" },
  custom: { bg: "bg-pink-500/15", text: "text-pink-400", bar: "bg-pink-400" },
};

export default function Dogs({ focusId = null, onConsumed = () => {} }) {
  const [dogs, setDogs] = useState([]);
  const [clients, setClients] = useState([]);
  const [enrollmentsByDog, setEnrollmentsByDog] = useState({});
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [tab, setTab] = useState("basics");
  const [err, setErr] = useState("");
  const [trainOpen, setTrainOpen] = useState(null);
  const [trainForm, setTrainForm] = useState({ date: todayISO(), note: "", tags: [] });
  const [stats, setStats] = useState(null);
  const [lightbox, setLightbox] = useState({ open: false, photos: [], index: 0 });

  const load = async () => {
    const [d, c, p] = await Promise.all([
      api.get("/dogs"),
      api.get("/clients"),
      api.get("/programs/pipeline").catch(() => ({ data: [] })),
    ]);
    setDogs(d.data); setClients(c.data);
    // Group enrollments by dog_id, keep only active + on_hold (skip completed/withdrawn on cards)
    const map = {};
    (p.data || []).forEach(e => {
      if (e.status !== "active" && e.status !== "on_hold") return;
      (map[e.dog_id] = map[e.dog_id] || []).push(e);
    });
    setEnrollmentsByDog(map);
  };
  useEffect(() => { load(); }, []);

  // Auto-open dog when navigated from global search
  useEffect(() => {
    if (!focusId || dogs.length === 0) return;
    const dog = dogs.find(d => d.id === focusId);
    if (dog) { openEdit(dog); onConsumed(); }
  }, [focusId, dogs]);

  const openNew = () => {
    if (clients.length === 0) { alert("Add a client first."); return; }
    setEditing(null);
    setForm({ ...empty, owner_id: clients[0].id });
    setTab("basics"); setOpen(true); setErr("");
  };
  const openEdit = async (d, initialTab = "basics") => {
    setEditing(d);
    // Hydrate the form with the list-view subset immediately so the modal
    // opens snappy, then fetch the full record (with gallery photos) and
    // patch it in once it lands.
    setForm({
      ...empty, ...d,
      vaccines: { ...empty.vaccines, ...(d.vaccines || {}) },
      feeding_schedule: d.feeding_schedule || [],
      medications: d.medications || [],
      training_skills: d.training_skills || [],
      photos: d.photos || [],
      tags: d.tags || [],
    });
    setTab(initialTab); setOpen(true); setErr("");
    setStats(null);
    // Fire both in parallel — stats + full record (the list view strips
    // gallery photos for payload size; we re-fetch them here for editing).
    try {
      const [{ data: full }, statsRes] = await Promise.all([
        api.get(`/dogs/${d.id}`),
        api.get(`/dogs/${d.id}/stats`).catch(() => null),
      ]);
      setForm(prev => ({
        ...prev,
        ...full,
        vaccines: { ...empty.vaccines, ...(full.vaccines || {}) },
        feeding_schedule: full.feeding_schedule || [],
        medications: full.medications || [],
        training_skills: full.training_skills || [],
        photos: full.photos || [],
        tags: full.tags || [],
      }));
      if (statsRes) setStats(statsRes.data);
    } catch { /* keep list-view fallback */ }
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const dataUrl = await compressImage(file);
    setForm((f) => ({ ...f, photo: dataUrl }));
  };

  const save = async () => {
    setErr("");
    try {
      const body = { ...form, age_y: parseInt(form.age_y)||0, age_m: parseInt(form.age_m)||0 };
      if (editing) await api.put(`/dogs/${editing.id}`, body);
      else await api.post("/dogs", body);
      setOpen(false); load();
    } catch (e) { setErr(formatErr(e.response?.data?.detail)); }
  };

  const confirm = useConfirm();
  const remove = async (id) => {
    if (!(await confirm({ title: "Delete this dog?", body: "All training logs, photos, and historical bookings for this dog will be removed. This cannot be undone.", confirmText: "Delete dog", tone: "danger" }))) return;
    await api.delete(`/dogs/${id}`); load();
  };

  const openTrain = (d) => { setTrainOpen(d); setTrainForm({ date: todayISO(), note: "", tags: [] }); setErr(""); };
  const saveTrain = async () => {
    setErr("");
    try {
      await api.post(`/dogs/${trainOpen.id}/training-logs`, trainForm);
      setTrainOpen(null); load();
    } catch (e) { setErr(formatErr(e.response?.data?.detail)); }
  };

  const ownerName = (id) => clients.find(c => c.id === id)?.name || "—";
  const tabs = [
    { id: "basics", label: "Basics", icon: "fa-paw" },
    { id: "vaccines", label: "Vaccines", icon: "fa-shield-virus" },
    { id: "care", label: "Feeding & Meds", icon: "fa-bowl-food" },
    { id: "training", label: "Training", icon: "fa-graduation-cap" },
    { id: "gallery", label: "Gallery", icon: "fa-images" },
    { id: "notes", label: "Notes & Vet", icon: "fa-clipboard" },
  ];

  const onGalleryFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    // Compress all files in parallel — at typical browser concurrency this
    // is fast even for 5+ photos at once.
    const compressed = await Promise.all(files.map(f => compressImage(f)));
    setForm((prev) => ({ ...prev, photos: [...(prev.photos || []), ...compressed.filter(Boolean)] }));
    e.target.value = "";
  };

  return (
    <div className="space-y-6 animate-slide-in" data-testid="dogs-screen">
      <div className="flex justify-between items-center">
        <h3 className="text-xl font-black text-white uppercase italic tracking-tight">Dog Records</h3>
        <button onClick={openNew} data-testid="add-dog-button"
                className="bg-shGreen text-bgHeader px-5 py-2 rounded-lg text-[14px] font-black uppercase tracking-widest shadow-lg hover:bg-shGreen/90">+ Add Dog</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" data-testid="dog-grid">
        {dogs.length === 0 && <div className="col-span-full text-center text-gray-500 text-xs font-black uppercase py-16">No dog records yet.</div>}
        {dogs.map(d => {
          const v = vaccineStatus(d.vaccines?.rabies);
          const careCount = (d.feeding_schedule?.length || 0) + (d.medications?.length || 0);
          return (
            <div key={d.id} className="bg-bgPanel rounded-xl border border-bgHover relative group shadow-2xl overflow-hidden" data-testid={`dog-card-${d.id}`}>
              {d.photo
                ? <div className="h-40 w-full bg-bgBase flex items-center justify-center overflow-hidden">
                    <img src={d.photo} alt={d.name} loading="lazy" decoding="async" className="max-h-40 max-w-full object-contain" />
                  </div>
                : <div className="h-40 w-full bg-gradient-to-br from-bgHover to-bgPanel flex items-center justify-center text-shGreen text-5xl"><i className="fas fa-paw" /></div>}
              <div className="p-5">
                <div className="absolute top-3 right-3 flex gap-2 opacity-0 group-hover:opacity-100 transition">
                  <button onClick={()=>openEdit(d)} className="bg-black/60 text-white p-2 rounded" data-testid={`edit-dog-${d.id}`}><i className="fas fa-edit text-xs" /></button>
                  <button onClick={()=>remove(d.id)} className="bg-black/60 text-red-400 p-2 rounded"><i className="fas fa-trash text-xs" /></button>
                </div>
                <h4 className="text-lg font-black text-white uppercase tracking-tight">{d.name}</h4>
                <p className="text-[15px] text-shBlue font-black uppercase tracking-widest">{d.breed || "Unknown breed"}</p>
                <p className="text-[15px] text-gray-400 mt-2">Owner: <span className="text-gray-200 font-bold">{ownerName(d.owner_id)}</span></p>
                <div className="mt-3 flex items-center justify-between text-[14px] uppercase font-black tracking-widest">
                  <span className="text-gray-500">{d.sex} • {d.fixed==="Yes"?"Fixed":"Intact"} • {d.age_y}y {d.age_m}m</span>
                </div>
                <div className={`mt-3 ${v.bg} ${v.color} rounded p-2 text-[14px] font-black uppercase tracking-widest flex items-center justify-between`}>
                  <span><i className="fas fa-shield-virus mr-2"/>Rabies: {v.label}</span>
                  <span>{d.vaccines?.rabies || "—"}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[15px] font-black uppercase tracking-widest">
                  {(d.feeding_schedule?.length > 0) && <span className="bg-shGreen/10 text-shGreen px-2 py-1 rounded"><i className="fas fa-bowl-food mr-1"/>{d.feeding_schedule.length} feedings</span>}
                  {(d.medications?.length > 0) && <span className="bg-purple-500/15 text-purple-400 px-2 py-1 rounded"><i className="fas fa-pills mr-1"/>{d.medications.length} meds</span>}
                  {(d.training_skills?.length > 0) && <span className="bg-shBlue/15 text-shBlue px-2 py-1 rounded"><i className="fas fa-graduation-cap mr-1"/>{d.training_skills.length} skills</span>}
                  {careCount === 0 && (!d.training_skills?.length) && <span className="text-gray-500 italic">No care profile set</span>}
                </div>
                <button onClick={()=>openTrain(d)} data-testid={`add-training-${d.id}`}
                        className="mt-4 w-full bg-shGreen/10 text-shGreen py-2 rounded text-[14px] font-black uppercase tracking-widest hover:bg-shGreen/20">
                  + Training Log ({d.training_logs?.length || 0})
                </button>
                {(enrollmentsByDog[d.id] || []).length > 0 && (
                  <div className="mt-3 space-y-2" data-testid={`dog-programs-${d.id}`}>
                    {enrollmentsByDog[d.id].map(e => {
                      const ptype = (e.program_snapshot || {}).type || "custom";
                      const c = PROGRAM_TYPE_COLORS[ptype] || PROGRAM_TYPE_COLORS.custom;
                      const pct = e.mastered_pct || 0;
                      const pname = (e.program_snapshot || {}).name || "Program";
                      const onHold = e.status === "on_hold";
                      return (
                        <button key={e.id}
                                onClick={(ev)=>{ ev.stopPropagation(); openEdit(d, "training"); }}
                                className={`${c.bg} rounded p-2 w-full text-left hover:ring-1 hover:ring-white/20 transition`}
                                data-testid={`dog-program-${d.id}-${e.id}`}
                                title="Open Training tab">
                          <div className="flex items-center justify-between text-[13px] font-black uppercase tracking-widest">
                            <span className={`${c.text} truncate flex items-center gap-2`}>
                              <i className="fas fa-graduation-cap" />
                              <span className="truncate">{pname}</span>
                              {onHold && <span className="text-shOrange normal-case tracking-normal">· on hold</span>}
                            </span>
                            <span className={`${c.text} flex-shrink-0 ml-2`}>{pct}%</span>
                          </div>
                          <div className="mt-1.5 h-1.5 w-full bg-black/30 rounded overflow-hidden">
                            <div className={`${c.bar} h-full transition-all`} style={{ width: `${pct}%` }} />
                          </div>
                          <div className="mt-1 text-[11px] text-gray-400 flex justify-between">
                            <span>{e.mastered_goals}/{e.total_goals} goals</span>
                            {e.days_to_target !== null && e.days_to_target !== undefined && (
                              <span className={e.days_to_target < 0 ? "text-red-400" : "text-gray-400"}>
                                {e.days_to_target < 0 ? `${Math.abs(e.days_to_target)}d overdue` : `${e.days_to_target}d left`}
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
                {d.training_logs?.length > 0 && (
                  <div className="mt-3 space-y-1 max-h-24 overflow-y-auto">
                    {d.training_logs.slice(-3).reverse().map(l => (
                      <div key={l.id} className="text-[15px] text-gray-300 bg-bgBase rounded p-2">
                        <span className="text-shGreen font-black">{l.date}</span> · {l.note}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {open && (
        <Modal title={editing?`Edit · ${form.name||"Dog"}`:"New Dog"} onClose={()=>setOpen(false)}>
          <div className="max-h-[75vh] flex flex-col">
            {editing && stats && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3" data-testid="dog-stats">
                <StatPill label="Daycare days" value={stats.daycare_days} color="text-shBlue" icon="fa-sun" />
                <StatPill label="Boarding nights" value={stats.boarding_nights} color="text-shGreen" icon="fa-moon" />
                <StatPill label="Training" value={stats.training_sessions} color="text-purple-400" icon="fa-graduation-cap" />
                <StatPill label="Last visit" value={stats.last_visit || "—"} color="text-shOrange" icon="fa-clock-rotate-left" small />
              </div>
            )}
            <nav className="flex gap-1 mb-4 overflow-x-auto pb-2 border-b border-bgHover">
              {tabs.map(t => (
                <button key={t.id} onClick={()=>setTab(t.id)} data-testid={`dog-tab-${t.id}`}
                        className={`shrink-0 px-3 py-2 rounded text-[14px] font-black uppercase tracking-widest ${tab===t.id?"bg-shBlue text-white":"text-gray-400 hover:bg-bgHover"}`}>
                  <i className={`fas ${t.icon} mr-1.5`} />{t.label}
                </button>
              ))}
            </nav>
            <div className="overflow-y-auto pr-1 flex-1 space-y-4">
              {tab === "basics" && (
                <>
                  <div>
                    <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Owner</label>
                    <select value={form.owner_id} onChange={(e)=>setForm({...form, owner_id: e.target.value})} data-testid="dog-owner-select"
                            className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                      {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  <Input label="Name" value={form.name} onChange={(v)=>setForm({...form, name:v})} testId="dog-name-input" />
                  <Input label="Breed" value={form.breed} onChange={(v)=>setForm({...form, breed:v})} />
                  <div className="grid grid-cols-3 gap-3">
                    <Input label="Yrs" type="number" value={form.age_y} onChange={(v)=>setForm({...form, age_y:v})} />
                    <Input label="Mos" type="number" value={form.age_m} onChange={(v)=>setForm({...form, age_m:v})} />
                    <Input label="Birthday" type="date" value={form.birthday} onChange={(v)=>setForm({...form, birthday:v})} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Sex</label>
                      <select value={form.sex} onChange={(e)=>setForm({...form, sex:e.target.value})} className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                        <option>Male</option><option>Female</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Fixed</label>
                      <select value={form.fixed} onChange={(e)=>setForm({...form, fixed:e.target.value})} className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                        <option>Yes</option><option>No</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Photo</label>
                    <div className="mt-2 flex items-center gap-3">
                      {form.photo && <img src={form.photo} alt="" loading="lazy" decoding="async" className="h-16 w-16 rounded object-cover border border-bgHover" />}
                      <label className="bg-bgBase border border-bgHover rounded px-4 py-2 cursor-pointer text-xs font-black uppercase tracking-widest text-gray-300 hover:bg-bgHover">
                        Upload <input type="file" accept="image/*" onChange={onFile} className="hidden" data-testid="dog-photo-input" />
                      </label>
                      {form.photo && <button onClick={()=>setForm({...form, photo:""})} className="text-red-400 text-xs font-black uppercase">Remove</button>}
                    </div>
                  </div>
                </>
              )}

              {tab === "vaccines" && (
                <div className="space-y-3">
                  <Input label="Rabies Expiration (required by default)" type="date" color="text-shOrange"
                         value={form.vaccines.rabies} onChange={(v)=>setForm({...form, vaccines:{...form.vaccines, rabies:v}})} testId="dog-rabies-input" />
                  <Input label="Bordetella" type="date" value={form.vaccines.bordetella} onChange={(v)=>setForm({...form, vaccines:{...form.vaccines, bordetella:v}})} />
                  <Input label="DHPP" type="date" value={form.vaccines.dhpp} onChange={(v)=>setForm({...form, vaccines:{...form.vaccines, dhpp:v}})} />
                </div>
              )}

              {tab === "care" && (
                <>
                  <div data-testid="feeding-section">
                    <div className="flex justify-between items-center mb-2">
                      <h5 className="text-[15px] font-black text-shGreen uppercase tracking-widest"><i className="fas fa-bowl-food mr-2"/>Feeding Schedule</h5>
                      <button onClick={()=>setForm({...form, feeding_schedule:[...form.feeding_schedule, {id:uid(), time:"08:00", amount:"", food_type:"", notes:""}]})}
                              data-testid="add-feeding" className="text-[14px] font-black uppercase text-shGreen hover:underline tracking-widest">+ Add Feeding</button>
                    </div>
                    {form.feeding_schedule.length === 0 && <p className="text-[15px] text-gray-500 italic">No feedings configured. Adds up on the daily run sheet & check-in board.</p>}
                    <div className="space-y-2">
                      {form.feeding_schedule.map((f, i) => (
                        <div key={f.id} className="bg-bgBase rounded p-3 grid grid-cols-12 gap-2 items-center" data-testid={`feeding-${i}`}>
                          <input type="time" value={f.time} onChange={(e)=>{const c=[...form.feeding_schedule]; c[i]={...f, time:e.target.value}; setForm({...form, feeding_schedule:c});}} className="col-span-3 bg-bgPanel border border-bgHover rounded p-2 text-xs text-white" style={{colorScheme:"dark"}} />
                          <input placeholder="2 cups" value={f.amount} onChange={(e)=>{const c=[...form.feeding_schedule]; c[i]={...f, amount:e.target.value}; setForm({...form, feeding_schedule:c});}} className="col-span-3 bg-bgPanel border border-bgHover rounded p-2 text-xs text-white" />
                          <input placeholder="Food brand / type" value={f.food_type} onChange={(e)=>{const c=[...form.feeding_schedule]; c[i]={...f, food_type:e.target.value}; setForm({...form, feeding_schedule:c});}} className="col-span-5 bg-bgPanel border border-bgHover rounded p-2 text-xs text-white" />
                          <button onClick={()=>setForm({...form, feeding_schedule: form.feeding_schedule.filter((_,j)=>j!==i)})} className="col-span-1 text-red-400 hover:text-red-300"><i className="fas fa-trash text-xs"/></button>
                          <input placeholder="Notes (e.g. mix with warm water)" value={f.notes} onChange={(e)=>{const c=[...form.feeding_schedule]; c[i]={...f, notes:e.target.value}; setForm({...form, feeding_schedule:c});}} className="col-span-12 bg-bgPanel border border-bgHover rounded p-2 text-xs text-white" />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div data-testid="meds-section" className="border-t border-bgHover pt-4 mt-4">
                    <div className="flex justify-between items-center mb-2">
                      <h5 className="text-[15px] font-black text-purple-400 uppercase tracking-widest"><i className="fas fa-pills mr-2"/>Medications</h5>
                      <button onClick={()=>setForm({...form, medications:[...form.medications, {id:uid(), name:"", dosage:"", times:["08:00"], with_food:false, notes:""}]})}
                              data-testid="add-med" className="text-[14px] font-black uppercase text-purple-400 hover:underline tracking-widest">+ Add Medication</button>
                    </div>
                    {form.medications.length === 0 && <p className="text-[15px] text-gray-500 italic">No medications. Pills, drops, supplements — surface on the run sheet.</p>}
                    <div className="space-y-2">
                      {form.medications.map((m, i) => (
                        <div key={m.id} className="bg-bgBase rounded p-3 space-y-2" data-testid={`med-${i}`}>
                          <div className="grid grid-cols-12 gap-2">
                            <input placeholder="Med name (Apoquel)" value={m.name} onChange={(e)=>{const c=[...form.medications]; c[i]={...m, name:e.target.value}; setForm({...form, medications:c});}} className="col-span-5 bg-bgPanel border border-bgHover rounded p-2 text-xs text-white" />
                            <input placeholder="Dosage (16mg, 1/2 tab)" value={m.dosage} onChange={(e)=>{const c=[...form.medications]; c[i]={...m, dosage:e.target.value}; setForm({...form, medications:c});}} className="col-span-3 bg-bgPanel border border-bgHover rounded p-2 text-xs text-white" />
                            <input placeholder="Times (08:00,20:00)" value={m.times.join(",")} onChange={(e)=>{const c=[...form.medications]; c[i]={...m, times: e.target.value.split(",").map(s=>s.trim()).filter(Boolean)}; setForm({...form, medications:c});}} className="col-span-3 bg-bgPanel border border-bgHover rounded p-2 text-xs text-white" />
                            <button onClick={()=>setForm({...form, medications: form.medications.filter((_,j)=>j!==i)})} className="col-span-1 text-red-400 hover:text-red-300"><i className="fas fa-trash text-xs"/></button>
                          </div>
                          <div className="flex items-center gap-4">
                            <label className="flex items-center gap-2 cursor-pointer">
                              <input type="checkbox" checked={!!m.with_food} onChange={(e)=>{const c=[...form.medications]; c[i]={...m, with_food:e.target.checked}; setForm({...form, medications:c});}} className="accent-shGreen w-4 h-4" />
                              <span className="text-[14px] font-black uppercase tracking-widest text-gray-300">With food</span>
                            </label>
                            <input placeholder="Notes (refrigerate, etc.)" value={m.notes} onChange={(e)=>{const c=[...form.medications]; c[i]={...m, notes:e.target.value}; setForm({...form, medications:c});}} className="flex-1 bg-bgPanel border border-bgHover rounded p-2 text-xs text-white" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {tab === "training" && (
                editing ? (
                  <DogTrainingTab dogId={editing.id} dogName={form.name}
                                  dogAgeMonths={(parseInt(form.age_y)||0)*12 + (parseInt(form.age_m)||0)} />
                ) : (
                  <p className="text-[14px] text-gray-500 italic py-8 text-center">Save the dog first, then come back to enroll in a training program.</p>
                )
              )}

              {tab === "gallery" && (
                <div data-testid="gallery-section">
                  <div className="flex justify-between items-center mb-3">
                    <h5 className="text-[15px] font-black text-shBlue uppercase tracking-widest"><i className="fas fa-images mr-2"/>Photo Gallery ({form.photos?.length || 0})</h5>
                    <label className="bg-shBlue/10 text-shBlue border border-shBlue/40 px-3 py-2 rounded cursor-pointer text-[14px] font-black uppercase tracking-widest hover:bg-shBlue/20" data-testid="add-gallery-photo">
                      <i className="fas fa-plus mr-1"/>Add Photos
                      <input type="file" accept="image/*" multiple onChange={onGalleryFiles} className="hidden" />
                    </label>
                  </div>
                  {(!form.photos || form.photos.length === 0) && <p className="text-[15px] text-gray-500 italic">No gallery photos yet. Add memories from playtime, training, or boarding stays.</p>}
                  <div className="grid grid-cols-3 gap-2">
                    {(form.photos || []).map((p, i) => (
                      <div key={i} className="relative group" data-testid={`gallery-photo-${i}`}>
                        <div className="aspect-square w-full bg-bgBase rounded border border-bgHover hover:border-shBlue overflow-hidden flex items-center justify-center cursor-pointer"
                             onClick={()=>setLightbox({ open: true, photos: form.photos, index: i })}>
                          <img src={p} alt="" loading="lazy" decoding="async" className="max-h-full max-w-full object-contain" />
                        </div>
                        <button onClick={()=>setForm({...form, photos: form.photos.filter((_,j)=>j!==i)})}
                                className="absolute top-1 right-1 bg-red-500/90 text-white rounded-full w-6 h-6 text-xs opacity-0 group-hover:opacity-100 transition"><i className="fas fa-times"/></button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {tab === "notes" && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <Input label="Vet Name" value={form.vet_name} onChange={(v)=>setForm({...form, vet_name:v})} />
                    <Input label="Vet Phone" value={form.vet_phone} onChange={(v)=>setForm({...form, vet_phone:v})} />
                  </div>
                  <div>
                    <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Tags (e.g. reactive, VIP, needs harness)</label>
                    <TagEditor tags={form.tags||[]} onChange={(t)=>setForm({...form, tags: t})} />
                  </div>
                  <div>
                    <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Notes — allergies, behaviors, fears, key codes</label>
                    <textarea value={form.notes} onChange={(e)=>setForm({...form, notes:e.target.value})} rows={6}
                              className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm focus:border-shBlue outline-none" />
                  </div>
                </>
              )}
            </div>

            {err && <div className="text-[15px] text-red-400 bg-red-500/10 rounded p-3 uppercase font-black mt-3">{err}</div>}
            <div className="flex justify-end gap-3 pt-3 border-t border-bgHover mt-3">
              <button onClick={()=>setOpen(false)} className="text-gray-500 font-black uppercase text-[14px] tracking-widest">Cancel</button>
              <button onClick={save} data-testid="save-dog-button" className="bg-shGreen text-bgHeader px-8 py-2 rounded font-black text-[14px] uppercase tracking-widest shadow-lg">Save Dog</button>
            </div>
          </div>
        </Modal>
      )}

      {trainOpen && (
        <Modal title={`Training Log · ${trainOpen.name}`} onClose={()=>setTrainOpen(null)}>
          <div className="space-y-4">
            <Input label="Date" type="date" value={trainForm.date} onChange={(v)=>setTrainForm({...trainForm, date:v})} />
            <div>
              <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Note</label>
              <textarea value={trainForm.note} onChange={(e)=>setTrainForm({...trainForm, note:e.target.value})} rows={3} data-testid="training-note-input"
                        className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm focus:border-shBlue outline-none" />
            </div>
            <div>
              <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Tags (comma separated)</label>
              <input value={trainForm.tags.join(", ")} onChange={(e)=>setTrainForm({...trainForm, tags: e.target.value.split(",").map(s=>s.trim()).filter(Boolean)})}
                     className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm focus:border-shBlue outline-none" />
            </div>
            {err && <div className="text-[15px] text-red-400 bg-red-500/10 rounded p-3 uppercase font-black">{err}</div>}
            <div className="flex justify-end gap-3 pt-4">
              <button onClick={()=>setTrainOpen(null)} className="text-gray-500 font-black uppercase text-[14px] tracking-widest">Cancel</button>
              <button onClick={saveTrain} data-testid="save-training-button" className="bg-shGreen text-bgHeader px-8 py-2 rounded font-black text-[14px] uppercase tracking-widest shadow-lg">Save Log</button>
            </div>
          </div>
        </Modal>
      )}

      {lightbox.open && (
        <Lightbox photos={lightbox.photos} index={lightbox.index}
                  onClose={()=>setLightbox({ open: false, photos: [], index: 0 })}
                  onIndex={(i)=>setLightbox(l => ({ ...l, index: i }))} />
      )}
    </div>
  );
}

function StatPill({ label, value, color, icon, small = false }) {
  return (
    <div className="bg-bgBase rounded p-3 border border-bgHover">
      <p className="text-[15px] text-gray-500 font-black uppercase tracking-widest"><i className={`fas ${icon} mr-1 ${color}`} />{label}</p>
      <p className={`font-black mt-1 ${color} ${small ? "text-xs" : "text-xl"}`}>{value}</p>
    </div>
  );
}
