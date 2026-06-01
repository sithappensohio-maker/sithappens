import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useConfirm } from "../lib/useConfirm";
import { ProgramsPanel } from "./Programs";
import IconPicker from "./IconPicker";
import ColorSwatchRow from "./ColorSwatchRow";

/**
 * Admin-managed catalog of services with prices.
 * Lives in Settings → Services tab. Includes Training Programs as a final category.
 */
const SERVICE_TYPES = [
  { key: "daycare", label: "Daycare", color: "#00a9e0", icon: "fa-sun" },
  { key: "boarding", label: "Boarding", color: "#8cc63f", icon: "fa-moon" },
  { key: "training", label: "Training", color: "#a855f7", icon: "fa-graduation-cap" },
  { key: "grooming", label: "Grooming", color: "#06b6d4", icon: "fa-bath" },
  { key: "photography", label: "Photography", color: "#f97316", icon: "fa-camera-retro" },
  { key: "other", label: "Other", color: "#64748b", icon: "fa-tag" },
];

const emptyService = { name: "", description: "", base_price: 0, service_type: "other", color: "#64748b", icon: "fa-tag", duration_minutes: 60, active: true, is_addon: false, addon_for: [], package_program_id: "" };

// Sprint 110an — add-ons can be eligible for multiple base service types
// (e.g. nail trim makes sense as a daycare + grooming + boarding add-on).
const BASE_TYPES_FOR_ADDON = [
  { key: "daycare", label: "Daycare" },
  { key: "boarding", label: "Boarding" },
  { key: "training", label: "Training" },
  { key: "grooming", label: "Grooming" },
  { key: "photography", label: "Photography" },
];


export default function ServicesSettings() {
  const confirm = useConfirm();
  const [services, setServices] = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyService);
  const [err, setErr] = useState("");
  const [seeded, setSeeded] = useState(false);
  const [open, setOpen] = useState(false); // controls the New/Edit modal

  const load = async () => {
    const { data } = await api.get("/services", { params: { include_inactive: true } });
    setServices(data);
  };
  useEffect(() => { load(); }, []);

  const openNew = () => { setEditing(null); setForm(emptyService); setErr(""); setOpen(true); };
  const openEdit = (s) => { setEditing(s); setForm({ ...emptyService, ...s }); setErr(""); setOpen(true); };
  const closeModal = () => { setOpen(false); setEditing(null); setForm(emptyService); setErr(""); };

  const save = async () => {
    setErr("");
    try {
      if (editing) await api.put(`/services/${editing.id}`, form);
      else await api.post("/services", form);
      closeModal();
      load();
    } catch (e) {
      setErr(e.response?.data?.detail || "Save failed");
    }
  };

  const remove = async (s) => {
    if (!(await confirm({ title: `Remove "${s.name}"?`, body: "Default services are soft-deleted; re-seed from Settings to restore. Custom services are permanently removed.", confirmText: "Remove", tone: "danger" }))) return;
    await api.delete(`/services/${s.id}`);
    load();
  };

  const seedAll = async () => {
    await api.post("/services/seed-standard");
    setSeeded(true);
    load();
  };

  return (
    <div className="space-y-6" data-testid="services-settings">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h4 className="text-lg font-black text-white uppercase italic tracking-tight">Services & Programs Catalog</h4>
          <p className="text-[15px] text-gray-500 font-black uppercase tracking-widest mt-1">All services + training programs you offer — grouped by category.</p>
        </div>
        <div className="flex gap-2">
          {services.length === 0 && (
            <button onClick={seedAll} data-testid="seed-services-btn"
                    className="bg-shBlue/15 text-shBlue px-4 py-2 rounded text-[15px] font-black uppercase tracking-widest hover:bg-shBlue/25">
              <i className="fas fa-magic-wand-sparkles mr-1"/>Seed Standard 7
            </button>
          )}
          <button onClick={openNew} data-testid="new-service-btn"
                  className="bg-shGreen text-black px-4 py-2 rounded text-[15px] font-black uppercase tracking-widest hover:bg-shGreen/80">
            + New Service
          </button>
        </div>
      </div>

      {services.length === 0 && (
        <div className="bg-bgBase border border-bgHover rounded-lg p-8 text-center text-[15px] text-gray-500 uppercase font-black tracking-widest">
          No services yet — seed the standard 7 or add your own.
        </div>
      )}

      {SERVICE_TYPES.map(cat => {
        const list = services.filter(s => s.service_type === cat.key);
        if (list.length === 0) return null;
        return (
          <div key={cat.key} className="bg-bgBase border border-bgHover rounded-lg overflow-hidden" data-testid={`services-category-${cat.key}`}>
            <div className="flex items-center gap-3 px-4 py-3 border-b border-bgHover" style={{ background: `linear-gradient(90deg, ${cat.color}1f, transparent 60%)` }}>
              <i className={`fas ${cat.icon}`} style={{ color: cat.color }}/>
              <h5 className="text-white font-black text-[14px] uppercase italic tracking-tight">{cat.label}</h5>
              <span className="text-[13px] font-black uppercase tracking-widest text-gray-500">· {list.length}</span>
            </div>
            <div className="divide-y divide-bgHover/40">
              {list.map(s => (
                <div key={s.id} className={`p-3 flex items-center gap-3 ${s.active ? "" : "opacity-50"}`} data-testid={`service-row-${s.id}`}>
                  <div className="w-10 h-10 rounded flex items-center justify-center shrink-0" style={{ backgroundColor: `${s.color}20`, color: s.color }}>
                    <i className={`fas ${s.icon || "fa-tag"}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-black text-[14px] tracking-tight truncate">
                      {s.name}
                      {s.is_addon && (
                        <span className="ml-2 inline-block bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded text-[10px] uppercase tracking-widest align-middle">
                          <i className="fas fa-plus-circle mr-1"/>Add-on
                        </span>
                      )}
                    </p>
                    <p className="text-[14px] text-gray-500 font-black uppercase tracking-widest">
                      {s.is_default ? "default" : "custom"}
                      {!s.active ? " · inactive" : ""}
                      {s.is_addon && (s.addon_for || []).length > 0 && (
                        <span className="ml-2 text-amber-400/80 normal-case tracking-normal">→ shows under: {(s.addon_for || []).join(", ")}</span>
                      )}
                    </p>
                  </div>
                  <p className="text-shGreen font-black text-[18px] whitespace-nowrap">${s.base_price?.toFixed(2)}</p>
                  <button onClick={()=>openEdit(s)} className="text-shBlue text-[14px] font-black uppercase tracking-widest hover:underline px-2" data-testid={`edit-service-${s.id}`}>Edit</button>
                  <button onClick={()=>remove(s)} className="text-red-400 text-[14px] font-black uppercase tracking-widest hover:underline px-2">Remove</button>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {/* New / Edit modal */}
      {open && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm grid place-items-center p-3 sm:p-6 animate-fade-in"
             onClick={closeModal}
             data-testid="service-form-modal">
          <div onClick={(e)=>e.stopPropagation()}
               className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-xl shadow-2xl max-h-[92vh] overflow-y-auto">
            <div className="sticky top-0 bg-bgPanel border-b border-bgHover px-5 py-4 flex items-center justify-between gap-3 z-10">
              <h5 className="text-white font-black text-[16px] uppercase italic tracking-tight">{editing ? `Edit · ${editing.name}` : "New Service"}</h5>
              <button onClick={closeModal} className="text-gray-500 hover:text-white" data-testid="service-form-close">
                <i className="fas fa-xmark text-xl"/>
              </button>
            </div>
            <div className="p-5" data-testid="service-form-panel">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Name</label>
                  <input value={form.name} onChange={(e)=>setForm({...form, name:e.target.value})} placeholder="e.g., Private Behavioral Consultation" data-testid="service-name-input"
                         className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
                </div>
                <div>
                  <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Base price (USD)</label>
                  <input type="number" step="0.01" value={form.base_price} onChange={(e)=>setForm({...form, base_price: parseFloat(e.target.value) || 0})} data-testid="service-price-input"
                         className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
                </div>
                <div>
                  <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Category</label>
                  <select value={form.service_type} onChange={(e)=>{
                             const t = e.target.value;
                             const meta = SERVICE_TYPES.find(x=>x.key===t);
                             setForm({...form, service_type: t, color: meta?.color || form.color});
                           }}
                          className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                    {SERVICE_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </select>
                </div>
                {["training","grooming","photography"].includes(form.service_type) && (
                  <div>
                    <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Duration (minutes)</label>
                    <input type="number" min="15" step="15" value={form.duration_minutes ?? 60}
                           onChange={(e)=>setForm({...form, duration_minutes: parseInt(e.target.value) || 60})}
                           data-testid="service-duration-input"
                           className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
                    <p className="text-[13px] text-gray-500 mt-1.5 normal-case">Blocks this much time on the schedule when booked. Other time-slotted services can't book overlapping times.</p>
                  </div>
                )}
                <div>
                  <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Icon (font-awesome name)</label>
                  <IconPicker value={form.icon} onChange={(v)=>setForm({...form, icon: v})} />
                </div>
                <div className="md:col-span-2">
                  <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Color</label>
                  <div className="mt-2">
                    <ColorSwatchRow value={form.color} onChange={(hex)=>setForm({...form, color: hex})} testid="service-color-row" />
                  </div>
                </div>
                <div className="md:col-span-2">
                  <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">
                    Description <span className="text-gray-600 normal-case tracking-normal font-normal">— shown to clients</span>
                  </label>
                  <textarea
                    value={form.description || ""}
                    onChange={(e)=>setForm({...form, description: e.target.value.slice(0, 500)})}
                    rows={3}
                    maxLength={500}
                    data-testid="service-description-input"
                    placeholder="One or two sentences clients see on the portal. e.g., 'Group socialization in our 4,000 sq ft indoor play space. Half-day or full-day.'"
                    className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm focus:border-shGreen outline-none resize-none"
                  />
                  <p className="text-[13px] text-gray-500 mt-1 normal-case">{(form.description || "").length}/500 — appears on client portal under the service name.</p>
                </div>
                {/* Sprint 110an — flag this service as an add-on the client/admin
                    can tack on to another base booking. When checked, the catalog
                    hides the row from the main service list and instead surfaces
                    it on the chosen base service's booking + check-in flows. */}
                <div className="md:col-span-2">
                  <label className="flex items-start gap-2 cursor-pointer" data-testid="service-is-addon-toggle">
                    <input
                      type="checkbox"
                      checked={!!form.is_addon}
                      onChange={(e)=>setForm({...form, is_addon: e.target.checked, addon_for: e.target.checked ? form.addon_for : []})}
                      className="mt-1"
                    />
                    <div>
                      <span className="text-[14px] font-black text-amber-400 uppercase tracking-widest">
                        <i className="fas fa-plus-circle mr-1"/>Show as add-on
                      </span>
                      <p className="text-[13px] text-gray-500 mt-0.5 normal-case">
                        When checked, this service is hidden from the main bookable list and offered as an upsell under the base services you pick below (booking, quick check-in, and check-out).
                      </p>
                    </div>
                  </label>
                </div>
                {form.is_addon && (
                  <div className="md:col-span-2" data-testid="service-addon-for-picker">
                    <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">
                      Show under these base services
                    </label>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {BASE_TYPES_FOR_ADDON.map(t => {
                        const picked = (form.addon_for || []).includes(t.key);
                        return (
                          <button
                            key={t.key}
                            type="button"
                            data-testid={`addon-for-chip-${t.key}`}
                            onClick={()=>{
                              const next = picked
                                ? (form.addon_for || []).filter(x => x !== t.key)
                                : [...(form.addon_for || []), t.key];
                              setForm({...form, addon_for: next});
                            }}
                            className={`px-3 py-1.5 rounded-full text-[13px] font-black uppercase tracking-widest border transition ${
                              picked
                                ? "bg-amber-500/20 border-amber-500/60 text-amber-300"
                                : "bg-bgBase border-bgHover text-gray-500 hover:border-amber-500/40 hover:text-amber-400"
                            }`}
                          >
                            {picked && <i className="fas fa-check mr-1"/>}
                            {t.label}
                          </button>
                        );
                      })}
                    </div>
                    {(form.addon_for || []).length === 0 && (
                      <p className="text-[12px] text-red-400 italic mt-2">
                        Pick at least one base service or this add-on won't appear anywhere.
                      </p>
                    )}
                  </div>
                )}
                {/* Sprint 110aw — Board-and-Train: wire a service to a
                    training program so booking this service auto-enrolls the
                    dog. Hidden when this row is an add-on. */}
                {!form.is_addon && (
                  <BoardAndTrainPicker value={form.package_program_id || ""}
                                        onChange={(v)=>setForm({...form, package_program_id: v})}/>
                )}
              </div>
              {/* Live preview — exactly how this row will render in the catalog. */}
              <div className="mt-4">
                <p className="text-[13px] font-black text-gray-500 uppercase tracking-widest mb-1.5">Preview</p>
                <div className="bg-bgBase border border-bgHover rounded-lg p-3 flex items-start gap-3" data-testid="service-preview">
                  <div className="w-10 h-10 rounded grid place-items-center shrink-0"
                       style={{ backgroundColor: `${form.color || "#64748b"}20`, color: form.color || "#64748b" }}>
                    <i className={`fas ${form.icon || "fa-tag"}`}/>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-black text-[14px] tracking-tight truncate">{form.name || "Untitled service"}</p>
                    <p className="text-[13px] text-gray-500 font-black uppercase tracking-widest">{form.service_type}</p>
                    {form.description && (
                      <p className="text-[13px] text-gray-300 leading-relaxed mt-1.5" data-testid="service-preview-description">{form.description}</p>
                    )}
                  </div>
                  <p className="text-shGreen font-black text-[18px] whitespace-nowrap">${(form.base_price || 0).toFixed(2)}</p>
                </div>
              </div>
              {err && <p className="text-red-400 text-[15px] mt-2">{err}</p>}
              <div className="flex justify-end gap-2 mt-4">
                <button onClick={closeModal} className="text-gray-400 text-[14px] uppercase font-black tracking-widest px-3 py-2 hover:text-white">Cancel</button>
                <button onClick={save} data-testid="save-service-btn"
                        className="bg-shGreen text-black px-5 py-2 rounded font-black text-[15px] uppercase tracking-widest hover:bg-shGreen/80">
                  {editing ? "Save Changes" : "Add Service"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {seeded && <p className="text-shGreen text-[14px] mt-2 font-black uppercase tracking-widest"><i className="fas fa-check mr-1"/>Seeded</p>}

      {/* Training Programs — surfaced as a sixth category inside the unified catalog. */}
      <div className="bg-bgBase border border-bgHover rounded-lg overflow-hidden" data-testid="services-category-programs">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-bgHover" style={{ background: "linear-gradient(90deg, #a855f71f, transparent 60%)" }}>
          <i className="fas fa-list-check" style={{ color: "#a855f7" }}/>
          <h5 className="text-white font-black text-[14px] uppercase italic tracking-tight">Training Programs</h5>
          <span className="text-[13px] font-black uppercase tracking-widest text-gray-500">multi-week curricula with goals & sessions</span>
        </div>
        <div className="p-4">
          <ProgramsPanel />
        </div>
      </div>
    </div>
  );
}

// Sprint 110aw — Board-and-Train picker. Lists active programs so the admin
// can wire any non-addon service to one. When the dog is booked under this
// service, the system auto-enrolls them in the picked program.
function BoardAndTrainPicker({ value, onChange }) {
  const [programs, setPrograms] = useState(null);
  useEffect(() => {
    api.get("/programs").then(r => {
      const items = Array.isArray(r.data) ? r.data : (r.data?.items || []);
      setPrograms(items.filter(p => p.active !== false));
    }).catch(() => setPrograms([]));
  }, []);
  return (
    <div className="md:col-span-2" data-testid="board-and-train-picker">
      <label className="text-[14px] font-black text-purple-400 uppercase tracking-widest">
        <i className="fas fa-graduation-cap mr-1"/>Board-and-Train · auto-enroll program
      </label>
      <p className="text-[13px] text-gray-500 mt-0.5 normal-case mb-2">
        Booking this service auto-enrolls the dog in the chosen training program (with curriculum + homework ready by drop-off). Leave blank for a normal service.
      </p>
      <select value={value || ""} onChange={(e)=>onChange(e.target.value)}
              data-testid="board-and-train-program-select"
              className="bg-bgBase border border-bgHover rounded p-2 text-white text-sm w-full">
        <option value="">— none (regular service) —</option>
        {(programs || []).map(p => (
          <option key={p.id} value={p.id}>{p.name}{p.type ? ` · ${p.type}` : ""}</option>
        ))}
      </select>
    </div>
  );
}

