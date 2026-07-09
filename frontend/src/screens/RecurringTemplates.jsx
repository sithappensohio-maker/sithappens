import { useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import { useConfirm } from "../lib/useConfirm";
import PageHero from "../components/PageHero";

/**
 * Admin tool: saved per-dog "recurring schedule" templates (e.g. Daisy · M/W/F
 * daycare). Each template has weekdays + service + a default horizon; clicking
 * "Extend" rolls the schedule forward by that many weeks using the existing
 * /bookings/recurring engine. `last_booked_through` is tracked so subsequent
 * extends start the day AFTER the previously booked window.
 */
const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const emptyForm = { dog_id: "", service_type: "daycare", service_id: "", time: "", dropoff_time: "", weekdays: [0, 2, 4], notes: "", default_horizon_weeks: 12, active: true, label: "", start_date: "" };

export default function RecurringTemplates() {
  const confirm = useConfirm();
  const [rows, setRows] = useState([]);
  const [dogs, setDogs] = useState([]);
  const [services, setServices] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(null);  // template_id currently extending
  const [err, setErr] = useState("");
  const [toast, setToast] = useState(null); // {ok, msg}

  const load = async () => {
    const [{ data: tpls }, { data: ds }, { data: svcs }] = await Promise.all([
      api.get("/recurring-templates"),
      api.get("/dogs"),
      api.get("/services"),
    ]);
    setRows(tpls);
    setDogs(ds);
    setServices((svcs || []).filter(s => s.active !== false && !s.is_addon && ["daycare", "training"].includes(s.service_type)));
  };
  useEffect(() => { load(); }, []);

  const openNew = () => {
    const first = services.find(s => s.service_type === "daycare") || services[0];
    setEditing(null);
    setForm({ ...emptyForm, dog_id: dogs[0]?.id || "", service_id: first?.id || "", service_type: first?.service_type || "daycare" });
    setErr(""); setOpen(true);
  };
  const openEdit = (r) => {
    setEditing(r);
    setForm({
      dog_id: r.dog_id, service_type: r.service_type, service_id: r.service_id || "",
      time: r.time || "", dropoff_time: r.dropoff_time || "", weekdays: r.weekdays || [],
      notes: r.notes || "", default_horizon_weeks: r.default_horizon_weeks || 12,
      active: r.active !== false, label: r.label || "", start_date: r.start_date || "",
    });
    setErr(""); setOpen(true);
  };

  const save = async () => {
    setErr("");
    if (!form.dog_id) { setErr("Pick a dog."); return; }
    if (!form.service_id) { setErr("Pick the exact service."); return; }
    if (form.service_type === "training" && !form.time) { setErr("Pick the training appointment time."); return; }
    if (!form.weekdays.length) { setErr("Pick at least one weekday."); return; }
    try {
      if (editing) await api.put(`/recurring-templates/${editing.id}`, form);
      else await api.post("/recurring-templates", form);
      setOpen(false); load();
    } catch (e) {
      setErr(formatErr(e.response?.data?.detail) || "Save failed");
    }
  };

  const remove = async (r) => {
    if (!(await confirm({ title: `Delete "${r.label}"?`, body: "Already-created bookings remain. The template just stops appearing here.", confirmText: "Delete template", tone: "danger" }))) return;
    await api.delete(`/recurring-templates/${r.id}`);
    load();
  };

  const extend = async (r) => {
    setBusy(r.id); setToast(null);
    try {
      const { data } = await api.post(`/recurring-templates/${r.id}/extend`, {});
      const skipped = (data.skipped || []).length;
      const msg = `${r.dog_name}: booked ${data.created} sessions through ${data.window?.to}.` + (skipped ? ` ${skipped} skipped (already booked / capacity).` : "");
      setToast({ ok: true, msg });
      load();
    } catch (e) {
      setToast({ ok: false, msg: formatErr(e.response?.data?.detail) || "Extend failed" });
    } finally {
      setBusy(null);
    }
  };

  const toggleDay = (d) => {
    setForm(f => ({ ...f, weekdays: f.weekdays.includes(d) ? f.weekdays.filter(x => x !== d) : [...f.weekdays, d].sort() }));
  };

  return (
    <div className="space-y-6" data-testid="recurring-screen">
      <PageHero
        eyebrow={{ icon: "fa-rotate", text: "Weekly schedules", color: "text-shBlue" }}
        title="Recurring."
        highlight="Set it. Forget it."
        subtitle="Per-dog weekly schedules · roll forward N weeks with one click."
        right={(
          <button onClick={openNew} data-testid="new-template-btn"
                  className="bg-shGreen text-bgHeader px-5 py-2.5 rounded-lg text-[13px] font-black uppercase tracking-widest shadow-lg hover:bg-shGreen/90 transition">
            <i className="fas fa-plus mr-2"/>New Schedule
          </button>
        )}
        testid="recurring-hero"
      />

      {toast && (
        <div data-testid="recurring-toast"
             className={`rounded-lg p-3 text-[14px] font-black uppercase tracking-widest ${toast.ok ? "bg-shGreen/15 text-shGreen border border-shGreen/40" : "bg-red-500/15 text-red-400 border border-red-500/40"}`}>
          <i className={`fas ${toast.ok ? "fa-check-circle" : "fa-triangle-exclamation"} mr-2`}/>{toast.msg}
          <button onClick={()=>setToast(null)} className="ml-3 opacity-60 hover:opacity-100"><i className="fas fa-xmark"/></button>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="bg-bgPanel border border-bgHover rounded-xl p-12 text-center" data-testid="recurring-empty">
          <i className="fas fa-calendar-week text-gray-600 text-4xl mb-3"/>
          <p className="text-white font-black text-[16px] uppercase tracking-widest">No saved schedules yet</p>
          <p className="text-[15px] text-gray-500 normal-case mt-2 max-w-md mx-auto">Set up a template once for your M/W/F regulars, then extend the next 12 weeks of bookings with a single click.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map(r => (
            <div key={r.id} data-testid={`recurring-row-${r.id}`}
                 className={`bg-bgPanel border border-bgHover rounded-lg p-4 grid grid-cols-12 gap-3 items-center ${!r.active ? "opacity-50" : ""}`}>
              <div className="col-span-12 md:col-span-4 min-w-0">
                <p className="text-white font-black text-[15px] truncate">{r.label}</p>
                <p className="text-[13px] text-gray-500 font-black uppercase tracking-widest mt-0.5">{r.client_name || "—"}</p>
              </div>
              <div className="col-span-6 md:col-span-3">
                <div className="flex flex-wrap gap-1">
                  {WD.map((d, i) => (
                    <span key={i} className={`text-[12px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded ${r.weekdays?.includes(i) ? (r.service_type === "training" ? "bg-purple-500/25 text-purple-300" : "bg-shBlue/25 text-shBlue") : "bg-bgHover text-gray-600"}`}>{d}</span>
                  ))}
                </div>
                <p className="text-[12px] text-gray-500 font-black uppercase tracking-widest mt-1">{r.service_name || r.service_type} · {r.default_horizon_weeks}w default</p>
              </div>
              <div className="col-span-6 md:col-span-3 text-[14px] text-gray-400 font-black uppercase tracking-widest">
                {r.last_booked_through ? (
                  <span>Booked through <span className="text-white">{r.last_booked_through}</span></span>
                ) : (
                  <span className="text-gray-600">Never extended</span>
                )}
              </div>
              <div className="col-span-12 md:col-span-2 flex md:justify-end gap-2">
                <button onClick={()=>extend(r)} disabled={busy===r.id || !r.active} data-testid={`extend-btn-${r.id}`}
                        className="bg-shGreen text-bgHeader px-3 py-1.5 rounded text-[13px] font-black uppercase tracking-widest hover:bg-shGreen/80 disabled:opacity-40">
                  {busy === r.id ? <><i className="fas fa-circle-notch fa-spin mr-1"/>Booking…</> : <><i className="fas fa-forward mr-1"/>Extend</>}
                </button>
                <button onClick={()=>openEdit(r)} className="text-shBlue text-[13px] font-black uppercase tracking-widest hover:underline px-1">Edit</button>
                <button onClick={()=>remove(r)} className="text-red-400 text-[13px] font-black uppercase tracking-widest hover:underline px-1">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={()=>setOpen(false)}>
          <div className="bg-bgPanel rounded-xl shadow-2xl border border-bgHover max-w-md w-full p-6" onClick={e=>e.stopPropagation()} data-testid="recurring-modal">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-2xl font-black uppercase italic text-white tracking-tight">{editing ? "Edit Schedule" : "New Recurring Schedule"}</h2>
              <button onClick={()=>setOpen(false)} className="text-gray-500 hover:text-white"><i className="fas fa-xmark text-xl"/></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Dog</label>
                <select value={form.dog_id} onChange={(e)=>setForm({...form, dog_id: e.target.value})}
                        data-testid="template-dog-select"
                        className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                  <option value="">— pick a dog —</option>
                  {dogs.map(d => <option key={d.id} value={d.id}>{d.name}{d.breed ? ` · ${d.breed}` : ""}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Exact service</label>
                <select value={form.service_id} onChange={(e)=>{
                          const svc = services.find(s => s.id === e.target.value);
                          setForm({...form, service_id: e.target.value, service_type: svc?.service_type || "daycare", time: svc?.service_type === "training" ? form.time : ""});
                        }}
                        data-testid="template-service-select"
                        className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                  <option value="">— pick a service —</option>
                  {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              {form.service_type === "training" ? (
                <div>
                  <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Appointment time</label>
                  <input type="time" value={form.time} onChange={(e)=>setForm({...form, time: e.target.value})}
                         data-testid="template-time" style={{colorScheme:"dark"}}
                         className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>
                </div>
              ) : (
                <div>
                  <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Usual drop-off time (optional)</label>
                  <input type="time" value={form.dropoff_time} onChange={(e)=>setForm({...form, dropoff_time: e.target.value})}
                         data-testid="template-dropoff-time" style={{colorScheme:"dark"}}
                         className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>
                </div>
              )}
              <div>
                <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Weekdays</label>
                <div className="flex gap-1 mt-1.5">
                  {WD.map((d, i) => (
                    <button key={i} type="button" onClick={()=>toggleDay(i)}
                            data-testid={`weekday-${i}`}
                            className={`flex-1 py-2 rounded text-[13px] font-black uppercase tracking-widest transition ${form.weekdays.includes(i) ? "bg-shBlue text-white" : "bg-bgBase text-gray-500 hover:bg-bgHover"}`}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Start on</label>
                <input type="date" value={form.start_date}
                       onChange={(e)=>setForm({...form, start_date: e.target.value})}
                       data-testid="template-start-date"
                       style={{colorScheme:"dark"}}
                       className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>
                <p className="text-[13px] text-gray-500 normal-case mt-1">Leave blank to start today. Useful for "starts next month" patterns. After the first extend, future ones pick up where the last one left off automatically.</p>
              </div>
              <div>
                <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Default extend horizon (weeks)</label>
                <input type="number" min="1" max="52" value={form.default_horizon_weeks}
                       onChange={(e)=>setForm({...form, default_horizon_weeks: parseInt(e.target.value) || 12})}
                       className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
              </div>
              <div>
                <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Notes (optional)</label>
                <input value={form.notes} onChange={(e)=>setForm({...form, notes: e.target.value})}
                       placeholder="e.g. half-day, picked up by grandma"
                       className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
              </div>
              {err && <p className="text-red-400 text-[15px]">{err}</p>}
              <div className="flex justify-end gap-3 pt-2">
                <button onClick={()=>setOpen(false)} className="text-gray-500 font-black uppercase text-[15px] tracking-widest">Cancel</button>
                <button onClick={save} data-testid="save-template-btn"
                        className="bg-shBlue text-white px-6 py-2 rounded font-black text-[15px] uppercase tracking-widest hover:bg-shBlue/90">
                  {editing ? "Save Changes" : "Create Schedule"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
