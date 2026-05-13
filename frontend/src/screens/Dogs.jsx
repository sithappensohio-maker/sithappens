import { useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import { Modal, Input } from "./Clients";

const empty = {
  owner_id: "", name: "", breed: "", age_y: 0, age_m: 0, birthday: "",
  sex: "Male", fixed: "No", vaccines: { rabies: "", bordetella: "", dhpp: "" }, notes: "", photo: ""
};

function todayISO() { return new Date().toISOString().split("T")[0]; }

function vaccineStatus(dateStr) {
  if (!dateStr) return { label: "Missing", color: "text-red-400", bg: "bg-red-500/15" };
  const t = todayISO();
  if (dateStr < t) return { label: "Expired", color: "text-red-400", bg: "bg-red-500/15" };
  const in30 = new Date(); in30.setDate(in30.getDate()+30);
  if (dateStr < in30.toISOString().split("T")[0]) return { label: "Expiring soon", color: "text-shOrange", bg: "bg-shOrange/15" };
  return { label: "Valid", color: "text-shGreen", bg: "bg-shGreen/15" };
}

export default function Dogs() {
  const [dogs, setDogs] = useState([]);
  const [clients, setClients] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [err, setErr] = useState("");
  const [trainOpen, setTrainOpen] = useState(null); // dog
  const [trainForm, setTrainForm] = useState({ date: todayISO(), note: "", tags: [] });

  const load = async () => {
    const [d, c] = await Promise.all([api.get("/dogs"), api.get("/clients")]);
    setDogs(d.data); setClients(c.data);
  };
  useEffect(() => { load(); }, []);

  const openNew = () => {
    if (clients.length === 0) { alert("Add a client first."); return; }
    setEditing(null);
    setForm({ ...empty, owner_id: clients[0].id });
    setOpen(true); setErr("");
  };
  const openEdit = (d) => {
    setEditing(d);
    setForm({ ...empty, ...d, vaccines: { ...empty.vaccines, ...(d.vaccines||{}) } });
    setOpen(true); setErr("");
  };

  const onFile = (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setForm((f) => ({ ...f, photo: reader.result }));
    reader.readAsDataURL(file);
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

  const remove = async (id) => {
    if (!window.confirm("Delete this dog?")) return;
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

  return (
    <div className="space-y-6 animate-slide-in" data-testid="dogs-screen">
      <div className="flex justify-between items-center">
        <h3 className="text-xl font-black text-white uppercase italic tracking-tight">Dog Records</h3>
        <button onClick={openNew} data-testid="add-dog-button"
                className="bg-shGreen text-bgHeader px-5 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest shadow-lg hover:bg-shGreen/90">+ Add Dog</button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" data-testid="dog-grid">
        {dogs.length === 0 && <div className="col-span-full text-center text-gray-500 text-xs font-black uppercase py-16">No dog records yet.</div>}
        {dogs.map(d => {
          const v = vaccineStatus(d.vaccines?.rabies);
          return (
            <div key={d.id} className="bg-bgPanel rounded-xl border border-bgHover relative group shadow-2xl overflow-hidden" data-testid={`dog-card-${d.id}`}>
              {d.photo
                ? <img src={d.photo} alt={d.name} className="h-40 w-full object-cover" />
                : <div className="h-40 w-full bg-gradient-to-br from-bgHover to-bgPanel flex items-center justify-center text-shGreen text-5xl"><i className="fas fa-paw" /></div>}
              <div className="p-5">
                <div className="absolute top-3 right-3 flex gap-2 opacity-0 group-hover:opacity-100 transition">
                  <button onClick={()=>openEdit(d)} className="bg-black/60 text-white p-2 rounded" data-testid={`edit-dog-${d.id}`}><i className="fas fa-edit text-xs" /></button>
                  <button onClick={()=>remove(d.id)} className="bg-black/60 text-red-400 p-2 rounded"><i className="fas fa-trash text-xs" /></button>
                </div>
                <h4 className="text-lg font-black text-white uppercase tracking-tight">{d.name}</h4>
                <p className="text-[9px] text-shBlue font-black uppercase tracking-widest">{d.breed || "Unknown breed"}</p>
                <p className="text-[11px] text-gray-400 mt-2">Owner: <span className="text-gray-200 font-bold">{ownerName(d.owner_id)}</span></p>
                <div className="mt-3 flex items-center justify-between text-[10px] uppercase font-black tracking-widest">
                  <span className="text-gray-500">{d.sex} • {d.fixed==="Yes"?"Fixed":"Intact"} • {d.age_y}y {d.age_m}m</span>
                </div>
                <div className={`mt-3 ${v.bg} ${v.color} rounded p-2 text-[10px] font-black uppercase tracking-widest flex items-center justify-between`}>
                  <span><i className="fas fa-shield-virus mr-2"/>Rabies: {v.label}</span>
                  <span>{d.vaccines?.rabies || "—"}</span>
                </div>
                <button onClick={()=>openTrain(d)} data-testid={`add-training-${d.id}`}
                        className="mt-4 w-full bg-shGreen/10 text-shGreen py-2 rounded text-[10px] font-black uppercase tracking-widest hover:bg-shGreen/20">
                  + Training Log ({d.training_logs?.length || 0})
                </button>
                {d.training_logs?.length > 0 && (
                  <div className="mt-3 space-y-1 max-h-24 overflow-y-auto">
                    {d.training_logs.slice(-3).reverse().map(l => (
                      <div key={l.id} className="text-[11px] text-gray-300 bg-bgBase rounded p-2">
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
        <Modal title={editing?"Edit Dog":"New Dog"} onClose={()=>setOpen(false)}>
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-2">
            <div>
              <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Owner</label>
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
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Sex</label>
                <select value={form.sex} onChange={(e)=>setForm({...form, sex:e.target.value})} className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                  <option>Male</option><option>Female</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Fixed</label>
                <select value={form.fixed} onChange={(e)=>setForm({...form, fixed:e.target.value})} className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                  <option>Yes</option><option>No</option>
                </select>
              </div>
            </div>
            <div className="border-t border-bgHover pt-3 grid grid-cols-1 gap-3">
              <Input label="Rabies Expiration (Required for booking)" type="date" color="text-shOrange"
                     value={form.vaccines.rabies} onChange={(v)=>setForm({...form, vaccines:{...form.vaccines, rabies:v}})} testId="dog-rabies-input" />
              <div className="grid grid-cols-2 gap-3">
                <Input label="Bordetella" type="date" value={form.vaccines.bordetella} onChange={(v)=>setForm({...form, vaccines:{...form.vaccines, bordetella:v}})} />
                <Input label="DHPP" type="date" value={form.vaccines.dhpp} onChange={(v)=>setForm({...form, vaccines:{...form.vaccines, dhpp:v}})} />
              </div>
            </div>
            <div>
              <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Photo</label>
              <div className="mt-2 flex items-center gap-3">
                {form.photo && <img src={form.photo} alt="" className="h-16 w-16 rounded object-cover border border-bgHover" />}
                <label className="bg-bgBase border border-bgHover rounded px-4 py-2 cursor-pointer text-xs font-black uppercase tracking-widest text-gray-300 hover:bg-bgHover">
                  Upload <input type="file" accept="image/*" onChange={onFile} className="hidden" data-testid="dog-photo-input" />
                </label>
                {form.photo && <button onClick={()=>setForm({...form, photo:""})} className="text-red-400 text-xs font-black uppercase">Remove</button>}
              </div>
            </div>
            <div>
              <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Notes</label>
              <textarea value={form.notes} onChange={(e)=>setForm({...form, notes:e.target.value})} rows={2}
                        className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm focus:border-shBlue outline-none" />
            </div>
            {err && <div className="text-[11px] text-red-400 bg-red-500/10 rounded p-3 uppercase font-black">{err}</div>}
            <div className="flex justify-end gap-3 pt-4">
              <button onClick={()=>setOpen(false)} className="text-gray-500 font-black uppercase text-[10px] tracking-widest">Cancel</button>
              <button onClick={save} data-testid="save-dog-button" className="bg-shGreen text-bgHeader px-8 py-2 rounded font-black text-[10px] uppercase tracking-widest shadow-lg">Save Dog</button>
            </div>
          </div>
        </Modal>
      )}

      {trainOpen && (
        <Modal title={`Training Log · ${trainOpen.name}`} onClose={()=>setTrainOpen(null)}>
          <div className="space-y-4">
            <Input label="Date" type="date" value={trainForm.date} onChange={(v)=>setTrainForm({...trainForm, date:v})} />
            <div>
              <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Note</label>
              <textarea value={trainForm.note} onChange={(e)=>setTrainForm({...trainForm, note:e.target.value})} rows={3} data-testid="training-note-input"
                        className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm focus:border-shBlue outline-none" />
            </div>
            <div>
              <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Tags (comma separated)</label>
              <input value={trainForm.tags.join(", ")} onChange={(e)=>setTrainForm({...trainForm, tags: e.target.value.split(",").map(s=>s.trim()).filter(Boolean)})}
                     className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm focus:border-shBlue outline-none" />
            </div>
            {err && <div className="text-[11px] text-red-400 bg-red-500/10 rounded p-3 uppercase font-black">{err}</div>}
            <div className="flex justify-end gap-3 pt-4">
              <button onClick={()=>setTrainOpen(null)} className="text-gray-500 font-black uppercase text-[10px] tracking-widest">Cancel</button>
              <button onClick={saveTrain} data-testid="save-training-button" className="bg-shGreen text-bgHeader px-8 py-2 rounded font-black text-[10px] uppercase tracking-widest shadow-lg">Save Log</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
