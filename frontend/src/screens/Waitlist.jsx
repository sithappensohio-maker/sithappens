/* Sprint 110et — Phase 3: Waitlist + capacity-aware UX
   Admin screen for managing waitlist entries.
   Includes a capacity-aware "Add to waitlist" flow. */
import { useEffect, useMemo, useState, useCallback } from "react";
import { api, formatErr } from "../lib/api";
import { useConfirm } from "../lib/useConfirm";
import { toast } from "sonner";
import PageHero from "../components/PageHero";

const SERVICE_TYPES = ["daycare", "boarding", "training", "grooming"];

const STATUS_META = {
  waiting:  { label: "Waiting",  cls: "bg-shBlue/15 text-shBlue",  icon: "fa-hourglass-half" },
  offered:  { label: "Offered",  cls: "bg-shOrange/15 text-shOrange ring-1 ring-shOrange/40", icon: "fa-hand-holding" },
  booked:   { label: "Booked",   cls: "bg-shGreen/15 text-shGreen",   icon: "fa-check" },
  declined: { label: "Declined", cls: "bg-bgHover text-gray-400",     icon: "fa-xmark" },
  expired:  { label: "Expired",  cls: "bg-bgHover text-gray-500",     icon: "fa-clock" },
  removed:  { label: "Removed",  cls: "bg-bgHover text-gray-500",     icon: "fa-trash" },
};

const PRIORITY_META = {
  high:   { label: "High",   cls: "bg-red-500/15 text-red-300 ring-1 ring-red-400/40" },
  normal: { label: "Normal", cls: "bg-bgHover text-gray-300" },
  low:    { label: "Low",    cls: "bg-bgHover text-gray-500" },
};

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

const emptyForm = {
  dog_id: "", service_type: "daycare",
  requested_date: todayISO(), requested_end_date: "",
  priority: "normal", notes: "",
};

export default function Waitlist() {
  const confirm = useConfirm();
  const [entries, setEntries] = useState([]);
  const [dogs, setDogs] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [filter, setFilter] = useState("waiting");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [availability, setAvailability] = useState(null);   // for the form

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [w, d] = await Promise.all([
        api.get("/waitlist"),
        api.get("/dogs"),
      ]);
      setEntries(w.data.entries || []);
      setStatuses(w.data.statuses || []);
      setDogs(d.data || []);
    } catch (e) {
      setErr(formatErr(e.response?.data?.detail));
    }
    setLoading(false);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  // Check availability whenever date or service_type changes in the form.
  useEffect(() => {
    if (!open) return;
    if (!form.requested_date || !["daycare", "boarding"].includes(form.service_type)) {
      setAvailability(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get(`/availability?date=${form.requested_date}&service_type=${form.service_type}`);
        if (!cancelled) setAvailability(data);
      } catch {
        if (!cancelled) setAvailability(null);
      }
    })();
    return () => { cancelled = true; };
  }, [open, form.requested_date, form.service_type]);

  const visible = useMemo(() => {
    if (filter === "all") return entries;
    return entries.filter(e => e.status === filter);
  }, [entries, filter]);

  const counts = useMemo(() => {
    const c = { all: entries.length };
    for (const s of statuses) c[s] = entries.filter(e => e.status === s).length;
    return c;
  }, [entries, statuses]);

  const save = async () => {
    if (!form.dog_id) { toast.error("Pick a dog"); return; }
    if (!form.requested_date) { toast.error("Pick a date"); return; }
    try {
      await api.post("/waitlist", {
        dog_id: form.dog_id,
        service_type: form.service_type,
        requested_date: form.requested_date,
        requested_end_date: form.requested_end_date || form.requested_date,
        priority: form.priority,
        notes: form.notes || "",
      });
      setOpen(false);
      setForm(emptyForm);
      toast.success("Added to waitlist");
      load();
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  const updateStatus = async (entry, newStatus) => {
    try {
      await api.put(`/waitlist/${entry.id}`, { status: newStatus });
      load();
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  const updatePriority = async (entry, newPriority) => {
    try {
      await api.put(`/waitlist/${entry.id}`, { priority: newPriority });
      load();
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  const remove = async (entry) => {
    const ok = await confirm({
      title: `Remove ${entry.dog_name} from waitlist?`,
      body: "This is permanent. Use Status → Removed if you want to keep the history.",
      confirmText: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.delete(`/waitlist/${entry.id}`);
      toast.success("Removed");
      load();
    } catch (e) { toast.error(formatErr(e.response?.data?.detail)); }
  };

  const convertToBooking = async (entry) => {
    const ok = await confirm({
      title: `Book ${entry.dog_name} for ${entry.requested_date}?`,
      body: "This bypasses the daily capacity limit (admin override) and runs the rest of the booking pipeline (vaccines, waiver, conflicts).",
      confirmText: "Create booking",
    });
    if (!ok) return;
    try {
      await api.post(`/waitlist/${entry.id}/convert-to-booking`);
      toast.success("Booking created");
      load();
    } catch (e) { toast.error(formatErr(e.response?.data?.detail) || "Couldn't convert"); }
  };

  return (
    <div className="space-y-6 animate-slide-in" data-testid="waitlist-screen">
      <PageHero
        eyebrow={{ icon: "fa-hourglass-half", text: `${counts.waiting || 0} waiting · ${counts.offered || 0} offered`, color: "text-shBlue" }}
        title="Waitlist."
        highlight="When the day is full."
        subtitle="Capture demand even when capacity is hit. Convert any entry to a real booking when space opens up."
        right={(
          <button onClick={()=>{ setForm(emptyForm); setOpen(true); }} data-testid="add-waitlist-btn"
                  className="bg-shGreen text-bgBase px-5 py-2.5 rounded-lg text-[13px] font-black uppercase tracking-widest shadow-lg hover:bg-shGreen/90">
            <i className="fas fa-plus mr-2"/>Add to Waitlist
          </button>
        )}
        testid="waitlist-hero"
      />

      <div className="flex flex-wrap gap-2">
        <FilterPill active={filter==="all"} onClick={()=>setFilter("all")} label={`All · ${counts.all || 0}`}/>
        {statuses.map(s => (
          <FilterPill key={s} active={filter===s} onClick={()=>setFilter(s)}
                      label={`${STATUS_META[s]?.label || s} · ${counts[s] || 0}`}/>
        ))}
      </div>

      {err && <div className="text-[14px] text-red-300 bg-red-500/10 rounded p-3 uppercase font-black">{err}</div>}

      {loading ? <p className="text-gray-500 text-sm">Loading…</p> : visible.length === 0 ? (
        <div className="card-waitlist rounded-xl p-10 text-center" data-testid="waitlist-empty">
          <p className="text-shGreen font-black uppercase text-xs tracking-widest">
            <i className="fas fa-shield-heart mr-2"/>No entries match this filter.
          </p>
        </div>
      ) : (
        <div className="grid gap-2" data-testid="waitlist-list">
          {visible.map(e => {
            const meta = STATUS_META[e.status] || STATUS_META.waiting;
            const pmeta = PRIORITY_META[e.priority] || PRIORITY_META.normal;
            return (
              <div key={e.id} className="card-waitlist rounded-xl p-4 shadow-lg"
                   data-testid={`waitlist-row-${e.id}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-base text-white font-black uppercase tracking-tight">{e.dog_name}</span>
                      <span className="text-[11px] font-black uppercase tracking-widest bg-shBlue/15 text-shBlue px-2 py-0.5 rounded">
                        {e.service_type}
                      </span>
                      <span className={`text-[11px] font-black uppercase tracking-widest px-2 py-0.5 rounded ${meta.cls}`}>
                        <i className={`fas ${meta.icon} mr-1`}/>{meta.label}
                      </span>
                      <span className={`text-[11px] font-black uppercase tracking-widest px-2 py-0.5 rounded ${pmeta.cls}`}>
                        {pmeta.label} priority
                      </span>
                    </div>
                    <p className="text-[13px] text-gray-300">
                      <span className="text-gray-400">For </span>{e.requested_date}
                      {e.requested_end_date && e.requested_end_date !== e.requested_date && <> → {e.requested_end_date}</>}
                      <span className="text-gray-500"> · {e.client_name}</span>
                      <span className="text-gray-600"> · added {e.created_at?.slice(0,10)}</span>
                    </p>
                    {e.notes && (
                      <p className="text-[13px] text-gray-400 mt-1">
                        <i className="fas fa-quote-left text-gray-600 mr-1 text-[10px]"/>{e.notes}
                      </p>
                    )}
                    {e.booking_id && (
                      <p className="text-[11px] text-shGreen font-black uppercase tracking-widest mt-2">
                        <i className="fas fa-link mr-1"/>Linked booking · {e.booked_at?.slice(0,10)}
                      </p>
                    )}
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    {e.status === "waiting" && (
                      <>
                        <button onClick={()=>convertToBooking(e)} data-testid={`convert-${e.id}`}
                                className="text-[12px] font-black uppercase tracking-widest bg-shGreen text-bgBase px-3 py-1.5 rounded">
                          <i className="fas fa-calendar-check mr-1"/>Convert
                        </button>
                        <button onClick={()=>updateStatus(e, "offered")} data-testid={`offer-${e.id}`}
                                className="text-[12px] font-black uppercase tracking-widest bg-shOrange/20 text-shOrange border border-shOrange/40 px-3 py-1.5 rounded">
                          <i className="fas fa-hand-holding mr-1"/>Offer
                        </button>
                      </>
                    )}
                    {e.status === "offered" && (
                      <>
                        <button onClick={()=>convertToBooking(e)} data-testid={`convert-${e.id}`}
                                className="text-[12px] font-black uppercase tracking-widest bg-shGreen text-bgBase px-3 py-1.5 rounded">
                          <i className="fas fa-calendar-check mr-1"/>They accepted — book
                        </button>
                        <button onClick={()=>updateStatus(e, "declined")} data-testid={`decline-${e.id}`}
                                className="text-[12px] font-black uppercase tracking-widest bg-bgHover text-gray-300 px-3 py-1.5 rounded">
                          <i className="fas fa-xmark mr-1"/>Declined
                        </button>
                      </>
                    )}
                    <PrioritySelector entry={e} onPick={(p)=>updatePriority(e, p)} />
                    <StatusSelector entry={e} statuses={statuses} onPick={(s)=>updateStatus(e, s)} />
                    <button onClick={()=>remove(e)} data-testid={`delete-${e.id}`}
                            className="text-[12px] font-black uppercase tracking-widest text-red-300 hover:text-red-200 px-2 py-1.5">
                      <i className="fas fa-trash"/>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {open && (
        <AddModal form={form} setForm={setForm} dogs={dogs} availability={availability}
                  onSave={save} onClose={()=>setOpen(false)} />
      )}
    </div>
  );
}

function FilterPill({ active, onClick, label }) {
  return (
    <button onClick={onClick}
            className={`px-3 py-1.5 rounded text-[12px] font-black uppercase tracking-widest border transition
                       ${active ? "bg-shGreen text-bgBase border-shGreen" : "bg-bgPanel text-gray-400 border-bgHover hover:text-white"}`}>
      {label}
    </button>
  );
}

function PrioritySelector({ entry, onPick }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={()=>setOpen(o=>!o)}
              className="text-[12px] font-black uppercase tracking-widest bg-bgHover text-gray-300 px-2 py-1.5 rounded">
        <i className="fas fa-flag mr-1"/>{entry.priority}
      </button>
      {open && (
        <div className="absolute right-0 mt-1 bg-bgPanel border border-bgHover rounded shadow-2xl z-10">
          {Object.entries(PRIORITY_META).map(([k, m]) => (
            <button key={k} onClick={()=>{ onPick(k); setOpen(false); }} data-testid={`set-priority-${entry.id}-${k}`}
                    className={`block w-full text-left text-[12px] font-black uppercase tracking-widest px-3 py-2 hover:bg-bgHover ${entry.priority===k?"text-shGreen":"text-gray-300"}`}>
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusSelector({ entry, statuses, onPick }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={()=>setOpen(o=>!o)} data-testid={`status-${entry.id}`}
              className="text-[12px] font-black uppercase tracking-widest bg-bgHover text-gray-300 px-2 py-1.5 rounded">
        <i className="fas fa-tag mr-1"/>Status
      </button>
      {open && (
        <div className="absolute right-0 mt-1 bg-bgPanel border border-bgHover rounded shadow-2xl z-10">
          {statuses.map(s => (
            <button key={s} onClick={()=>{ onPick(s); setOpen(false); }} data-testid={`set-status-${entry.id}-${s}`}
                    className={`block w-full text-left text-[12px] font-black uppercase tracking-widest px-3 py-2 hover:bg-bgHover ${entry.status===s?"text-shGreen":"text-gray-300"}`}>
              {STATUS_META[s]?.label || s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AddModal({ form, setForm, dogs, availability, onSave, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-md p-6 shadow-2xl animate-slide-in" data-testid="waitlist-modal">
        <div className="flex items-center justify-between mb-4">
          <h4 className="text-lg font-black text-white uppercase italic tracking-tight">Add to Waitlist</h4>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><i className="fas fa-times"/></button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Dog</label>
            <select value={form.dog_id} onChange={(e)=>setForm({ ...form, dog_id: e.target.value })} data-testid="waitlist-dog"
                    className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
              <option value="">— Pick a dog —</option>
              {dogs.map(d => <option key={d.id} value={d.id}>{d.name} · {d.client_name || ""}</option>)}
            </select>
          </div>

          <div>
            <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Service</label>
            <div className="mt-1 grid grid-cols-4 gap-2">
              {SERVICE_TYPES.map(s => (
                <button key={s} type="button" onClick={()=>setForm({ ...form, service_type: s })}
                        data-testid={`waitlist-service-${s}`}
                        className={`text-[11px] font-black uppercase tracking-widest px-2 py-2 rounded border ${form.service_type===s?"bg-shGreen text-bgBase border-shGreen":"bg-bgBase border-bgHover text-gray-300"}`}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Date</label>
              <input type="date" value={form.requested_date} onChange={(e)=>setForm({ ...form, requested_date: e.target.value })}
                     style={{ colorScheme: "dark" }} data-testid="waitlist-date"
                     className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
            </div>
            <div>
              <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">End date (boarding)</label>
              <input type="date" value={form.requested_end_date} onChange={(e)=>setForm({ ...form, requested_end_date: e.target.value })}
                     style={{ colorScheme: "dark" }}
                     className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
            </div>
          </div>

          {availability?.has_limit && (
            <div className={`rounded p-3 text-[12px] font-black uppercase tracking-widest border ${
              availability.is_full ? "bg-red-500/10 text-red-300 border-red-500/40"
                                   : "bg-shGreen/10 text-shGreen border-shGreen/40"
            }`} data-testid="waitlist-availability">
              <i className={`fas ${availability.is_full ? "fa-triangle-exclamation":"fa-circle-check"} mr-2`}/>
              {availability.is_full
                ? `Full — ${availability.count}/${availability.capacity} ${availability.service_type}. Waitlist is the right call.`
                : `${availability.available} of ${availability.capacity} ${availability.service_type} slots still open today.`}
            </div>
          )}

          <div>
            <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Priority</label>
            <div className="mt-1 grid grid-cols-3 gap-2">
              {Object.entries(PRIORITY_META).map(([k, m]) => (
                <button key={k} type="button" onClick={()=>setForm({ ...form, priority: k })}
                        data-testid={`waitlist-priority-${k}`}
                        className={`text-[11px] font-black uppercase tracking-widest px-2 py-2 rounded border ${form.priority===k?"bg-shGreen text-bgBase border-shGreen":"bg-bgBase border-bgHover text-gray-300"}`}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Notes</label>
            <textarea value={form.notes} onChange={(e)=>setForm({ ...form, notes: e.target.value })} rows={2}
                      placeholder="e.g. owner is flexible on day, prefers AM" data-testid="waitlist-notes"
                      className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t border-bgHover">
            <button onClick={onClose} className="text-gray-500 font-black uppercase text-[12px] tracking-widest">Cancel</button>
            <button onClick={onSave} data-testid="waitlist-save"
                    className="bg-shGreen text-bgBase px-5 py-2 rounded font-black text-[12px] uppercase tracking-widest shadow-xl">
              <i className="fas fa-plus mr-1"/>Add
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
