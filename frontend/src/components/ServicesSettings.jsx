import { useEffect, useState } from "react";
import { api } from "../lib/api";

/**
 * Admin-managed catalog of services with prices.
 * Lives in Settings → Services tab.
 */
const SERVICE_TYPES = [
  { key: "daycare", label: "Daycare", color: "#00a9e0" },
  { key: "boarding", label: "Boarding", color: "#8cc63f" },
  { key: "training", label: "Training", color: "#a855f7" },
  { key: "grooming", label: "Grooming", color: "#06b6d4" },
  { key: "other", label: "Other", color: "#64748b" },
];

const emptyService = { name: "", base_price: 0, service_type: "other", color: "#64748b", icon: "fa-tag", active: true };

export default function ServicesSettings() {
  const [services, setServices] = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyService);
  const [err, setErr] = useState("");
  const [seeded, setSeeded] = useState(false);

  const load = async () => {
    const { data } = await api.get("/services", { params: { include_inactive: true } });
    setServices(data);
  };
  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing(null); setForm(emptyService); setErr(""); };
  const openEdit = (s) => { setEditing(s); setForm({ ...emptyService, ...s }); setErr(""); };

  const save = async () => {
    setErr("");
    try {
      if (editing) await api.put(`/services/${editing.id}`, form);
      else await api.post("/services", form);
      setEditing(null); setForm(emptyService);
      load();
    } catch (e) {
      setErr(e.response?.data?.detail || "Save failed");
    }
  };

  const remove = async (s) => {
    if (!window.confirm(`Remove "${s.name}"? Default services soft-delete (re-seed to restore).`)) return;
    await api.delete(`/services/${s.id}`);
    load();
  };

  const seedAll = async () => {
    await api.post("/services/seed-standard");
    setSeeded(true);
    load();
  };

  return (
    <div className="space-y-5" data-testid="services-settings">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-lg font-black text-white uppercase italic tracking-tight">Services Catalog</h4>
          <p className="text-[13px] text-gray-500 font-black uppercase tracking-widest mt-1">Define what you offer + the base price for each.</p>
        </div>
        <div className="flex gap-2">
          {services.length === 0 && (
            <button onClick={seedAll} data-testid="seed-services-btn"
                    className="bg-shBlue/15 text-shBlue px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest hover:bg-shBlue/25">
              <i className="fas fa-magic-wand-sparkles mr-1"/>Seed Standard 7
            </button>
          )}
          <button onClick={openNew} data-testid="new-service-btn"
                  className="bg-shGreen text-black px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest hover:bg-shGreen/80">
            + New Service
          </button>
        </div>
      </div>

      <div className="space-y-2" data-testid="services-list">
        {services.length === 0 && (
          <div className="bg-bgBase border border-bgHover rounded-lg p-8 text-center text-[13px] text-gray-500 uppercase font-black tracking-widest">
            No services yet — seed the standard 7 or add your own.
          </div>
        )}
        {services.map(s => (
          <div key={s.id} className={`bg-bgBase border rounded-lg p-3 flex items-center gap-3 ${s.active ? "border-bgHover" : "border-bgHover/30 opacity-50"}`} data-testid={`service-row-${s.id}`}>
            <div className="w-10 h-10 rounded flex items-center justify-center" style={{ backgroundColor: `${s.color}20`, color: s.color }}>
              <i className={`fas ${s.icon || "fa-tag"}`} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white font-black text-[14px] uppercase tracking-tight">{s.name}</p>
              <p className="text-[12px] text-gray-500 font-black uppercase tracking-widest">{s.service_type}{s.is_default ? " · default" : ""}{!s.active ? " · inactive" : ""}</p>
            </div>
            <p className="text-shGreen font-black text-[18px]">${s.base_price?.toFixed(2)}</p>
            <button onClick={()=>openEdit(s)} className="text-shBlue text-[12px] font-black uppercase tracking-widest hover:underline px-2" data-testid={`edit-service-${s.id}`}>Edit</button>
            <button onClick={()=>remove(s)} className="text-red-400 text-[12px] font-black uppercase tracking-widest hover:underline px-2">Remove</button>
          </div>
        ))}
      </div>

      {/* New / Edit form */}
      <div className="bg-bgBase border border-bgHover rounded-lg p-4">
        <h5 className="text-white font-black text-[14px] uppercase tracking-tight mb-3">{editing ? `Edit · ${editing.name}` : "New Service"}</h5>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Name</label>
            <input value={form.name} onChange={(e)=>setForm({...form, name:e.target.value})} placeholder="e.g., Private Behavioral Consultation" data-testid="service-name-input"
                   className="w-full mt-1 bg-bgPanel border border-bgHover rounded p-2 text-white text-sm" />
          </div>
          <div>
            <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Base price (USD)</label>
            <input type="number" step="0.01" value={form.base_price} onChange={(e)=>setForm({...form, base_price: parseFloat(e.target.value) || 0})} data-testid="service-price-input"
                   className="w-full mt-1 bg-bgPanel border border-bgHover rounded p-2 text-white text-sm" />
          </div>
          <div>
            <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Category</label>
            <select value={form.service_type} onChange={(e)=>{
                       const t = e.target.value;
                       const meta = SERVICE_TYPES.find(x=>x.key===t);
                       setForm({...form, service_type: t, color: meta?.color || form.color});
                     }}
                    className="w-full mt-1 bg-bgPanel border border-bgHover rounded p-2 text-white text-sm">
              {SERVICE_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Icon (font-awesome name)</label>
            <input value={form.icon} onChange={(e)=>setForm({...form, icon: e.target.value})} placeholder="fa-tag"
                   className="w-full mt-1 bg-bgPanel border border-bgHover rounded p-2 text-white text-sm" />
          </div>
        </div>
        {err && <p className="text-red-400 text-[13px] mt-2">{err}</p>}
        <div className="flex justify-end gap-2 mt-3">
          {editing && <button onClick={()=>{setEditing(null); setForm(emptyService);}} className="text-gray-400 text-[12px] uppercase font-black tracking-widest px-2">Cancel</button>}
          <button onClick={save} data-testid="save-service-btn"
                  className="bg-shGreen text-black px-5 py-2 rounded font-black text-[13px] uppercase tracking-widest hover:bg-shGreen/80">
            {editing ? "Save Changes" : "Add Service"}
          </button>
        </div>
        {seeded && <p className="text-shGreen text-[12px] mt-2 font-black uppercase tracking-widest"><i className="fas fa-check mr-1"/>Seeded</p>}
      </div>
    </div>
  );
}
