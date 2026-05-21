import { useEffect, useMemo, useState } from "react";
import { api, formatErr } from "../lib/api";

function todayISO() { return new Date().toISOString().split("T")[0]; }

export default function AdminBookingModal({ defaultCheckIn = false, defaultDate = null, existing = null, onClose, onCreated }) {
  const [clients, setClients] = useState([]);
  const [dogs, setDogs] = useState([]);
  const [kennels, setKennels] = useState([]);
  const [clientId, setClientId] = useState(existing?.client_id || "");
  const [dogId, setDogId] = useState(existing?.dog_id || "");
  // Quick Check-in mode: dog-first selection (the common drop-off flow).
  // Normal booking creation stays client-first.
  const isQuickCheckin = defaultCheckIn && !existing;
  const [serviceType, setServiceType] = useState(existing?.service_type || "daycare");
  const [date, setDate] = useState(existing?.date || defaultDate || todayISO());
  const [endDate, setEndDate] = useState(existing?.end_date || "");
  const [kennel, setKennel] = useState(existing?.kennel || "");
  const [dropoffTime, setDropoffTime] = useState(existing?.dropoff_time || "");
  const [pickupTime, setPickupTime] = useState(existing?.pickup_time || "");
  // Distinct appointment time for training/grooming/photography — these are
  // scheduled SLOTS, not drop-off windows. Persisted on the booking as `time`.
  const [appointmentTime, setAppointmentTime] = useState(existing?.time || "");
  const [groomingType, setGroomingType] = useState(existing?.grooming_type || "bath");
  const [notes, setNotes] = useState(existing?.notes || "");
  const [checkInNow, setCheckInNow] = useState(defaultCheckIn);
  const [overrideVaccines, setOverrideVaccines] = useState(false);
  const [overrideCapacity, setOverrideCapacity] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [conflicts, setConflicts] = useState([]);
  const isEdit = !!existing;

  useEffect(() => {
    (async () => {
      try {
        const [cRes, dRes, sRes] = await Promise.all([
          api.get("/clients"), api.get("/dogs"), api.get("/settings"),
        ]);
        setClients(cRes.data);
        setDogs(dRes.data);
        setKennels(sRes.data.kennels || []);
        if (!existing) {
          if (isQuickCheckin) {
            // Pre-select the first dog and its owner so the form is ready to submit.
            const firstDog = (dRes.data || []).find(d => d.owner_id);
            if (firstDog) {
              setDogId(firstDog.id);
              setClientId(firstDog.owner_id);
            }
          } else if (cRes.data[0]) {
            setClientId(cRes.data[0].id);
          }
        }
      } catch (e) { setErr(formatErr(e.response?.data?.detail)); }
    })();
  }, [existing, isQuickCheckin]);

  // Auto-detect conflicts when dog/date/client change. Keyed on clientId so
  // when the user switches clients (which auto-resets dogId via clientDogs),
  // the effect reliably re-fires once dogId stabilises.
  useEffect(() => {
    if (!dogId || !date) { setConflicts([]); return; }
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get("/bookings/conflicts", { params: { dog_id: dogId, date_str: date } });
        setConflicts((data.conflicts || []).filter(c => c.id !== existing?.id));
      } catch { setConflicts([]); }
    }, 250);
    return () => clearTimeout(t);
  }, [clientId, dogId, date, existing]);

  const clientDogs = useMemo(() => dogs.filter(d => d.owner_id === clientId), [dogs, clientId]);
  useEffect(() => {
    // In normal mode, auto-pick the first dog when client changes.
    // In quick-checkin mode, the dog dropdown drives clientId so we skip this.
    if (!isQuickCheckin && clientDogs.length && !clientDogs.find(d => d.id === dogId)) {
      setDogId(clientDogs[0].id);
    }
  }, [clientDogs, dogId, isQuickCheckin]);

  // Quick check-in: sorted "all dogs" list with owner name embedded so the
  // admin can find dogs faster (most relevant to drop-off workflows).
  const allDogsSorted = useMemo(() => {
    const byName = [...dogs].filter(d => d.owner_id).sort((a, b) =>
      (a.name || "").localeCompare(b.name || "", undefined, { sensitivity: "base" })
    );
    const clientMap = Object.fromEntries(clients.map(c => [c.id, c]));
    return byName.map(d => ({
      ...d,
      ownerLabel: clientMap[d.owner_id]?.name || "—",
    }));
  }, [dogs, clients]);

  const selectedDog = dogs.find(d => d.id === dogId);
  const rabies = selectedDog?.vaccines?.rabies || "";
  const rabiesOk = rabies && rabies >= todayISO();

  const submit = async () => {
    setErr("");
    if (!dogId) { setErr("Pick a dog"); return; }
    if (serviceType === "boarding" && endDate && endDate < date) { setErr("End date must be after start date"); return; }
    setSaving(true);
    try {
      if (isEdit) {
        await api.patch(`/bookings/${existing.id}`, {
          notes,
          kennel: serviceType === "boarding" ? kennel : "",
          dropoff_time: dropoffTime || "",
          pickup_time: pickupTime || "",
          time: ["training", "grooming", "photography"].includes(serviceType) ? (appointmentTime || "") : "",
        });
      } else {
        const body = {
          dog_id: dogId,
          date,
          end_date: serviceType === "boarding" ? (endDate || date) : null,
          service_type: serviceType,
          grooming_type: serviceType === "grooming" ? groomingType : null,
          kennel: serviceType === "boarding" ? kennel : "",
          dropoff_time: dropoffTime || "",
          pickup_time: pickupTime || "",
          time: ["training", "grooming", "photography"].includes(serviceType) ? (appointmentTime || "") : "",
          notes,
          override_vaccines: overrideVaccines,
          override_capacity: overrideCapacity,
          check_in_now: checkInNow,
        };
        await api.post("/bookings", body);
      }
      onCreated?.();
      onClose();
    } catch (e) { setErr(formatErr(e.response?.data?.detail) || "Save failed"); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" data-testid="admin-booking-modal">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-2xl p-6 md:p-8 shadow-2xl max-h-[95vh] overflow-y-auto animate-slide-in">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h4 className="text-xl font-black text-white uppercase italic tracking-tight">{isEdit ? "Edit Booking" : (defaultCheckIn ? "Quick Check-in" : "New Booking")}</h4>
            <p className="text-[14px] font-black text-gray-500 uppercase tracking-widest mt-1">{isEdit ? "Update notes, kennel & times" : (defaultCheckIn ? "Walk-in or unscheduled drop-off" : "Schedule on behalf of a client")}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><i className="fas fa-times text-xl" /></button>
        </div>

        <div className="space-y-4">
          {isQuickCheckin ? (
            // Quick Check-in: dog-first selection. Searching/finding a dog is
            // faster than narrowing by client at drop-off time.
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Dog</label>
                <select value={dogId}
                        onChange={(e)=>{
                          const id = e.target.value;
                          setDogId(id);
                          const dog = allDogsSorted.find(d => d.id === id);
                          if (dog) setClientId(dog.owner_id);
                        }}
                        data-testid="ab-dog"
                        className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                  {allDogsSorted.length === 0 && <option value="">No dogs on file</option>}
                  {allDogsSorted.map(d => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.breed || "—"}) — {d.ownerLabel}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Client</label>
                <div className="w-full mt-1 bg-bgBase/60 border border-bgHover rounded p-2 text-white text-sm flex items-center justify-between" data-testid="ab-client-readout">
                  <span>{clients.find(c => c.id === clientId)?.name || "—"}</span>
                  <span className="text-[13px] text-shGreen font-black uppercase tracking-widest">
                    {clients.find(c => c.id === clientId)?.credits ?? 0} credits
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Client</label>
                <select value={clientId} onChange={(e)=>setClientId(e.target.value)} data-testid="ab-client"
                        className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name} · {c.credits} credits</option>)}
                </select>
              </div>
              <div>
                <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Dog</label>
                <select value={dogId} onChange={(e)=>setDogId(e.target.value)} data-testid="ab-dog"
                        className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                  {clientDogs.length === 0 && <option value="">No dogs on file</option>}
                  {clientDogs.map(d => <option key={d.id} value={d.id}>{d.name} ({d.breed || "—"})</option>)}
                </select>
              </div>
            </div>
          )}

          {selectedDog && (
            <div className={`text-[14px] font-black uppercase tracking-widest rounded p-2 ${rabiesOk ? "bg-shGreen/10 text-shGreen" : "bg-red-500/15 text-red-400"}`}>
              <i className={`fas ${rabiesOk?"fa-shield-virus":"fa-exclamation-triangle"} mr-2`} />
              Rabies: {rabiesOk ? `Valid through ${rabies}` : (rabies ? `Expired ${rabies}` : "Missing")}
            </div>
          )}

          {conflicts.length > 0 && (
            <div className="text-[14px] font-black uppercase tracking-widest rounded p-3 bg-shOrange/15 text-shOrange border border-shOrange/40" data-testid="booking-conflicts">
              <p><i className="fas fa-triangle-exclamation mr-2"/>Heads up — this dog already has {conflicts.length} booking{conflicts.length===1?"":"s"} that day:</p>
              <ul className="mt-2 ml-5 list-disc space-y-1">
                {conflicts.map(c => <li key={c.id}>{c.service_type} ({c.status}) — {c.date}{c.end_date && c.end_date!==c.date?` → ${c.end_date}`:""}</li>)}
              </ul>
            </div>
          )}

          <div>
            <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Service</label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-1">
              {["daycare","boarding","training","grooming","photography"].map(t => (
                <button key={t} onClick={()=>setServiceType(t)} data-testid={`ab-service-${t}`}
                        className={`py-2 rounded text-[14px] font-black uppercase tracking-widest border ${serviceType===t?"bg-shBlue text-white border-shBlue":"bg-bgBase border-bgHover text-gray-400"}`}>{t}</button>
              ))}
            </div>
          </div>

          {serviceType === "grooming" && !isEdit && (
            <div data-testid="ab-grooming-types">
              <label className="text-[15px] font-black text-gray-500 uppercase tracking-widest">Grooming Service</label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                {[
                  { k: "bath", label: "Bath", icon: "fa-bath" },
                  { k: "nail_trim", label: "Nail Trim", icon: "fa-scissors" },
                ].map(g => (
                  <button key={g.k} onClick={()=>setGroomingType(g.k)} data-testid={`ab-grooming-${g.k}`}
                          className={`py-3 rounded text-[14px] font-black uppercase tracking-widest border flex items-center justify-center gap-2 ${groomingType===g.k?"bg-pink-500/15 text-pink-300 border-pink-500/60":"bg-bgBase border-bgHover text-gray-400"}`}>
                    <i className={`fas ${g.icon}`}/>{g.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">{serviceType==="boarding"?"Drop-off Date":"Date"}</label>
              <input type="date" value={date} onChange={(e)=>setDate(e.target.value)} data-testid="ab-date"
                     className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-xs" style={{colorScheme:"dark"}} />
            </div>
            {serviceType==="boarding" && (
              <div>
                <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Pickup Date</label>
                <input type="date" value={endDate} onChange={(e)=>setEndDate(e.target.value)} data-testid="ab-end-date"
                       className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-xs" style={{colorScheme:"dark"}} />
              </div>
            )}
          </div>

          {serviceType==="boarding" && kennels.length > 0 && (
            <div>
              <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Kennel / Room (optional)</label>
              <select value={kennel} onChange={(e)=>setKennel(e.target.value)} data-testid="ab-kennel"
                      className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                <option value="">— Unassigned —</option>
                {kennels.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
          )}

          {["training", "grooming", "photography"].includes(serviceType) ? (
            <div>
              <label className="text-[14px] font-black text-shOrange uppercase tracking-widest">
                <i className="fas fa-clock mr-2"/>Appointment Time
              </label>
              <input type="time" value={appointmentTime}
                     onChange={(e)=>setAppointmentTime(e.target.value)}
                     data-testid="ab-appointment-time"
                     className="w-full mt-1 bg-bgBase border border-shOrange/40 rounded p-2 text-white text-xs focus:border-shOrange outline-none"
                     style={{colorScheme:"dark"}} />
              <p className="text-[13px] text-gray-500 normal-case mt-1">This appears on the calendar at this exact time slot (not a drop-off window).</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Drop-off Time (optional)</label>
                <input type="time" value={dropoffTime} onChange={(e)=>setDropoffTime(e.target.value)} data-testid="ab-dropoff-time"
                       className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-xs" style={{colorScheme:"dark"}} />
              </div>
              <div>
                <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Pickup Time (optional)</label>
                <input type="time" value={pickupTime} onChange={(e)=>setPickupTime(e.target.value)} data-testid="ab-pickup-time"
                       className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-xs" style={{colorScheme:"dark"}} />
              </div>
            </div>
          )}

          <div>
            <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Notes (optional)</label>
            <textarea value={notes} onChange={(e)=>setNotes(e.target.value)} rows={2} placeholder="Special instructions, food, meds…"
                      className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm focus:border-shBlue outline-none" />
          </div>

          <div className="border-t border-bgHover pt-4 space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={checkInNow} onChange={(e)=>setCheckInNow(e.target.checked)} data-testid="ab-checkin-now" className="accent-shGreen w-4 h-4" />
              <span className="text-[15px] font-black uppercase tracking-widest text-gray-300"><i className="fas fa-clock-rotate-left mr-2 text-shGreen"/>Check in immediately (stamps arrival time)</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={overrideVaccines} onChange={(e)=>setOverrideVaccines(e.target.checked)} data-testid="ab-override-vax" className="accent-shOrange w-4 h-4" />
              <span className="text-[15px] font-black uppercase tracking-widest text-gray-300"><i className="fas fa-shield-virus mr-2 text-shOrange"/>Override vaccine requirements (admin override)</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={overrideCapacity} onChange={(e)=>setOverrideCapacity(e.target.checked)} data-testid="ab-override-cap" className="accent-shOrange w-4 h-4" />
              <span className="text-[15px] font-black uppercase tracking-widest text-gray-300"><i className="fas fa-warehouse mr-2 text-shOrange"/>Override capacity limit</span>
            </label>
          </div>

          {err && <div className="text-[15px] text-red-400 bg-red-500/10 rounded p-3 uppercase font-black">{err}</div>}

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={onClose} className="text-gray-500 font-black uppercase text-[14px] tracking-widest">Cancel</button>
            <button onClick={submit} disabled={saving || !dogId} data-testid="ab-submit"
                    className="bg-shGreen text-bgHeader px-8 py-3 rounded font-black text-[14px] uppercase tracking-widest shadow-xl disabled:opacity-50">
              {saving ? "Saving…" : (isEdit ? "Save Changes" : (checkInNow ? "Book & Check In" : "Create Booking"))}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
