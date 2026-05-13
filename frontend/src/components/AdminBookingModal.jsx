import { useEffect, useMemo, useState } from "react";
import { api, formatErr } from "../lib/api";

function todayISO() { return new Date().toISOString().split("T")[0]; }

export default function AdminBookingModal({ defaultCheckIn = false, defaultDate = null, onClose, onCreated }) {
  const [clients, setClients] = useState([]);
  const [dogs, setDogs] = useState([]);
  const [kennels, setKennels] = useState([]);
  const [clientId, setClientId] = useState("");
  const [dogId, setDogId] = useState("");
  const [serviceType, setServiceType] = useState("daycare");
  const [date, setDate] = useState(defaultDate || todayISO());
  const [endDate, setEndDate] = useState("");
  const [kennel, setKennel] = useState("");
  const [notes, setNotes] = useState("");
  const [checkInNow, setCheckInNow] = useState(defaultCheckIn);
  const [overrideVaccines, setOverrideVaccines] = useState(false);
  const [overrideCapacity, setOverrideCapacity] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [cRes, dRes, sRes] = await Promise.all([
          api.get("/clients"), api.get("/dogs"), api.get("/settings"),
        ]);
        setClients(cRes.data);
        setDogs(dRes.data);
        setKennels(sRes.data.kennels || []);
        if (cRes.data[0]) setClientId(cRes.data[0].id);
      } catch (e) { setErr(formatErr(e.response?.data?.detail)); }
    })();
  }, []);

  const clientDogs = useMemo(() => dogs.filter(d => d.owner_id === clientId), [dogs, clientId]);
  useEffect(() => {
    if (clientDogs.length && !clientDogs.find(d => d.id === dogId)) setDogId(clientDogs[0].id);
  }, [clientDogs, dogId]);

  const selectedDog = dogs.find(d => d.id === dogId);
  const rabies = selectedDog?.vaccines?.rabies || "";
  const rabiesOk = rabies && rabies >= todayISO();

  const submit = async () => {
    setErr("");
    if (!dogId) { setErr("Pick a dog"); return; }
    if (serviceType === "boarding" && endDate && endDate < date) { setErr("End date must be after start date"); return; }
    setSaving(true);
    try {
      const body = {
        dog_id: dogId,
        date,
        end_date: serviceType === "boarding" ? (endDate || date) : null,
        service_type: serviceType,
        kennel: serviceType === "boarding" ? kennel : "",
        notes,
        override_vaccines: overrideVaccines,
        override_capacity: overrideCapacity,
        check_in_now: checkInNow,
      };
      const { data } = await api.post("/bookings", body);
      onCreated?.(data);
      onClose();
    } catch (e) { setErr(formatErr(e.response?.data?.detail) || "Save failed"); }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50" data-testid="admin-booking-modal">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-2xl p-6 md:p-8 shadow-2xl max-h-[95vh] overflow-y-auto animate-slide-in">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h4 className="text-xl font-black text-white uppercase italic tracking-tight">{defaultCheckIn ? "Quick Check-in" : "New Booking"}</h4>
            <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest mt-1">{defaultCheckIn ? "Walk-in or unscheduled drop-off" : "Schedule on behalf of a client"}</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><i className="fas fa-times text-xl" /></button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Client</label>
              <select value={clientId} onChange={(e)=>setClientId(e.target.value)} data-testid="ab-client"
                      className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                {clients.map(c => <option key={c.id} value={c.id}>{c.name} · {c.credits} credits</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Dog</label>
              <select value={dogId} onChange={(e)=>setDogId(e.target.value)} data-testid="ab-dog"
                      className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                {clientDogs.length === 0 && <option value="">No dogs on file</option>}
                {clientDogs.map(d => <option key={d.id} value={d.id}>{d.name} ({d.breed || "—"})</option>)}
              </select>
            </div>
          </div>

          {selectedDog && (
            <div className={`text-[10px] font-black uppercase tracking-widest rounded p-2 ${rabiesOk ? "bg-shGreen/10 text-shGreen" : "bg-red-500/15 text-red-400"}`}>
              <i className={`fas ${rabiesOk?"fa-shield-virus":"fa-exclamation-triangle"} mr-2`} />
              Rabies: {rabiesOk ? `Valid through ${rabies}` : (rabies ? `Expired ${rabies}` : "Missing")}
            </div>
          )}

          <div>
            <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Service</label>
            <div className="grid grid-cols-3 gap-2 mt-1">
              {["daycare","boarding","training"].map(t => (
                <button key={t} onClick={()=>setServiceType(t)} data-testid={`ab-service-${t}`}
                        className={`py-2 rounded text-[10px] font-black uppercase tracking-widest border ${serviceType===t?"bg-shBlue text-white border-shBlue":"bg-bgBase border-bgHover text-gray-400"}`}>{t}</button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">{serviceType==="boarding"?"Drop-off Date":"Date"}</label>
              <input type="date" value={date} onChange={(e)=>setDate(e.target.value)} data-testid="ab-date"
                     className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-xs" style={{colorScheme:"dark"}} />
            </div>
            {serviceType==="boarding" && (
              <div>
                <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Pickup Date</label>
                <input type="date" value={endDate} onChange={(e)=>setEndDate(e.target.value)} data-testid="ab-end-date"
                       className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-xs" style={{colorScheme:"dark"}} />
              </div>
            )}
          </div>

          {serviceType==="boarding" && kennels.length > 0 && (
            <div>
              <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Kennel / Room (optional)</label>
              <select value={kennel} onChange={(e)=>setKennel(e.target.value)} data-testid="ab-kennel"
                      className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                <option value="">— Unassigned —</option>
                {kennels.map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Notes (optional)</label>
            <textarea value={notes} onChange={(e)=>setNotes(e.target.value)} rows={2} placeholder="Special instructions, food, meds…"
                      className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm focus:border-shBlue outline-none" />
          </div>

          <div className="border-t border-bgHover pt-4 space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={checkInNow} onChange={(e)=>setCheckInNow(e.target.checked)} data-testid="ab-checkin-now" className="accent-shGreen w-4 h-4" />
              <span className="text-[11px] font-black uppercase tracking-widest text-gray-300"><i className="fas fa-clock-rotate-left mr-2 text-shGreen"/>Check in immediately (stamps arrival time)</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={overrideVaccines} onChange={(e)=>setOverrideVaccines(e.target.checked)} data-testid="ab-override-vax" className="accent-shOrange w-4 h-4" />
              <span className="text-[11px] font-black uppercase tracking-widest text-gray-300"><i className="fas fa-shield-virus mr-2 text-shOrange"/>Override vaccine requirements (admin override)</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" checked={overrideCapacity} onChange={(e)=>setOverrideCapacity(e.target.checked)} data-testid="ab-override-cap" className="accent-shOrange w-4 h-4" />
              <span className="text-[11px] font-black uppercase tracking-widest text-gray-300"><i className="fas fa-warehouse mr-2 text-shOrange"/>Override capacity limit</span>
            </label>
          </div>

          {err && <div className="text-[11px] text-red-400 bg-red-500/10 rounded p-3 uppercase font-black">{err}</div>}

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={onClose} className="text-gray-500 font-black uppercase text-[10px] tracking-widest">Cancel</button>
            <button onClick={submit} disabled={saving || !dogId} data-testid="ab-submit"
                    className="bg-shGreen text-bgHeader px-8 py-3 rounded font-black text-[10px] uppercase tracking-widest shadow-xl disabled:opacity-50">
              {saving ? "Saving…" : (checkInNow ? "Book & Check In" : "Create Booking")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
