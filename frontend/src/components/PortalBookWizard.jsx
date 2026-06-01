import { useEffect, useMemo, useState } from "react";
import { api, formatErr } from "../lib/api";
import MultiDatePicker from "./MultiDatePicker";
import { useEditLock } from "../lib/useLiveRefresh";
import { todayISO } from "../lib/date";

/**
 * Client-portal Book Service wizard.
 *
 * Three steps:
 *   1) Pick service (Daycare / Boarding / Training / Grooming / Photography)
 *   2) Pick the right thing for that service:
 *      - daycare → one date (multi-date supported)
 *      - boarding → start + end
 *      - training/grooming/photography → date + time slot (loaded from backend
 *        so conflicts are filtered out)
 *   3) Review + Book
 *
 * Calls onBooked() after success so the parent can refresh.
 */
function fmt(d) { return d ? new Date(d + "T12:00:00").toLocaleDateString(undefined, { weekday:"short", month:"short", day:"numeric" }) : ""; }

const SERVICE_OPTIONS = [
  { key: "daycare",     label: "Daycare",     icon: "fa-paw",          color: "bg-shGreen/15 text-shGreen border-shGreen/40", desc: "Drop-in day care" },
  { key: "boarding",    label: "Boarding",    icon: "fa-bed",          color: "bg-purple-500/15 text-purple-300 border-purple-500/40", desc: "Overnight stays" },
  { key: "training",    label: "Training",    icon: "fa-graduation-cap", color: "bg-shBlue/15 text-shBlue border-shBlue/40", desc: "1-on-1 session" },
  { key: "grooming",    label: "Grooming",    icon: "fa-bath",         color: "bg-pink-500/15 text-pink-300 border-pink-500/40", desc: "Bath, nail trim" },
  { key: "photography", label: "Photography", icon: "fa-camera",       color: "bg-amber-500/15 text-amber-300 border-amber-500/40", desc: "Portrait sessions" },
];

const TIME_SLOTTED = new Set(["training", "grooming", "photography"]);

export default function PortalBookWizard({ dogs, seed, onClose, onBooked }) {
  useEditLock(true);
  const [step, setStep] = useState(1);
  const [dogId, setDogId] = useState(seed?.dog_id || dogs?.[0]?.id || "");
  const [serviceType, setServiceType] = useState(seed?.service_type || "");
  // Sprint 110an — add-ons eligible for the chosen base service.
  const [eligibleAddons, setEligibleAddons] = useState([]);
  const [selectedAddonIds, setSelectedAddonIds] = useState([]);
  const [date, setDate] = useState(todayISO());
  const [endDate, setEndDate] = useState("");
  const [time, setTime] = useState("");
  const [groomingType, setGroomingType] = useState("bath");
  const [notes, setNotes] = useState("");
  const [slots, setSlots] = useState(null);
  const [slotLoading, setSlotLoading] = useState(false);
  const [avail, setAvail] = useState(null);
  const [closedDates, setClosedDates] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");
  // Multi-date mode — book several non-consecutive days at once (non-boarding only)
  const [isMultiDate, setIsMultiDate] = useState(false);
  const [multiDates, setMultiDates] = useState([]);

  // Date guard rails
  const minDate = todayISO();

  // Load closed-dates list once so we can flag picks the business is closed.
  useEffect(() => {
    api.get("/settings/public")
       .then(r => setClosedDates(Array.isArray(r.data?.closed_dates) ? r.data.closed_dates : []))
       .catch(() => setClosedDates([]));
  }, []);

  // Is the currently-picked date a closed day?
  const dateIsClosed = useMemo(() => closedDates.includes(date), [closedDates, date]);
  const endDateIsClosed = useMemo(
    () => serviceType === "boarding" && endDate && closedDates.includes(endDate),
    [serviceType, endDate, closedDates]
  );

  // Fetch slot availability when needed
  useEffect(() => {
    if (step !== 2) return;
    if (!TIME_SLOTTED.has(serviceType) || !date) { setSlots(null); return; }
    let cancelled = false;
    setSlotLoading(true);
    api.get("/bookings/time-slots", { params: { date_str: date, service_type: serviceType } })
       .then(r => { if (!cancelled) setSlots(r.data); })
       .catch(() => { if (!cancelled) setSlots(null); })
       .finally(() => { if (!cancelled) setSlotLoading(false); });
    return () => { cancelled = true; };
  }, [step, serviceType, date]);

  // Sprint 110an — load add-ons whenever a service type is picked.
  useEffect(() => {
    if (!serviceType) { setEligibleAddons([]); setSelectedAddonIds([]); return; }
    let cancelled = false;
    api.get("/services/addons", { params: { for: serviceType } })
       .then(r => {
         if (cancelled) return;
         const list = r.data || [];
         setEligibleAddons(list);
         setSelectedAddonIds(prev => prev.filter(id => list.some(a => a.id === id)));
       })
       .catch(() => { if (!cancelled) setEligibleAddons([]); });
    return () => { cancelled = true; };
  }, [serviceType]);

  // Daycare availability check
  useEffect(() => {
    if (step !== 2) return;
    if (serviceType !== "daycare" || !date || !dogId) { setAvail(null); return; }
    let cancelled = false;
    api.get("/bookings/availability", { params: { date_str: date, dog_id: dogId } })
       .then(r => { if (!cancelled) setAvail(r.data); })
       .catch(() => { if (!cancelled) setAvail(null); });
    return () => { cancelled = true; };
  }, [step, serviceType, date, dogId]);

  const selectedDog = useMemo(() => dogs.find(d => d.id === dogId) || null, [dogs, dogId]);
  const svcMeta = SERVICE_OPTIONS.find(s => s.key === serviceType);

  // Reset multi-date when service is not daycare (only daycare supports multi-date in portal).
  useEffect(() => {
    if (serviceType !== "daycare") {
      setIsMultiDate(false);
      setMultiDates([]);
    }
  }, [serviceType]);

  const canProceedFromStep2 = useMemo(() => {
    if (isMultiDate && serviceType === "daycare") {
      return multiDates.length > 0;
    }
    if (!date) return false;
    if (dateIsClosed) return false;
    if (serviceType === "boarding") {
      if (!endDate || endDate < date) return false;
      if (endDateIsClosed) return false;
      return true;
    }
    if (TIME_SLOTTED.has(serviceType)) return !!time;
    if (serviceType === "daycare") return !!avail && avail.vaccine_ok && avail.open_slots > 0;
    return true;
  }, [serviceType, date, endDate, time, avail, dateIsClosed, endDateIsClosed, isMultiDate, multiDates]);

  const book = async () => {
    setErr(""); setSubmitting(true);
    try {
      if (isMultiDate && serviceType === "daycare") {
        const { data } = await api.post("/bookings/multi-dates", {
          dog_id: dogId,
          dates: multiDates,
          service_type: "daycare",
          notes,
          addon_service_ids: selectedAddonIds,
        });
        const c = data.created?.length || 0;
        const s = data.skipped?.length || 0;
        if (c === 0) {
          setErr(`No bookings created — all ${s} day(s) were skipped: ${(data.skipped || []).slice(0,3).map(x=>`${x.date} (${x.reason})`).join("; ")}${s>3?"…":""}`);
          setSubmitting(false);
          return;
        }
        onBooked && onBooked({ summary: `${c} booking${c===1?"":"s"} submitted${s?`, ${s} skipped`:""}`, skipped: data.skipped });
        return;
      }
      const body = {
        dog_id: dogId,
        date,
        service_type: serviceType,
        notes,
        addon_service_ids: selectedAddonIds,
      };
      if (serviceType === "boarding") body.end_date = endDate;
      if (TIME_SLOTTED.has(serviceType)) body.time = time;
      if (serviceType === "grooming") body.grooming_type = groomingType;
      await api.post("/bookings", body);
      onBooked && onBooked();
    } catch (e) {
      setErr(formatErr(e.response?.data?.detail) || "Booking failed");
    } finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/80 flex items-center justify-center p-4" onClick={onClose} data-testid="portal-book-wizard">
      <div className="bg-bgPanel border border-bgHover rounded-xl max-w-2xl w-full max-h-[92vh] overflow-y-auto p-6 space-y-5" onClick={(e)=>e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-xl font-black text-white uppercase italic tracking-tight">
              <i className="fas fa-calendar-plus text-shBlue mr-2"/>Book a Service
            </h3>
            <p className="text-[14px] font-black text-gray-500 uppercase tracking-widest mt-1">
              Step {step} of 3 · {step===1?"Pick service":step===2?"Pick date & time":"Review & confirm"}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl"><i className="fas fa-times"/></button>
        </div>

        {/* Progress bar */}
        <div className="grid grid-cols-3 gap-2">
          {[1,2,3].map(i => (
            <div key={i} className={`h-1 rounded-full ${i<=step?"bg-shBlue":"bg-bgHover"}`}/>
          ))}
        </div>

        {/* STEP 1 */}
        {step === 1 && (
          <div className="space-y-4">
            {dogs.length > 1 && (
              <div>
                <label className="text-[13px] uppercase tracking-widest text-gray-500 font-black">For which dog?</label>
                <select value={dogId} onChange={(e)=>setDogId(e.target.value)} data-testid="wiz-dog"
                        className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                  {dogs.map(d => <option key={d.id} value={d.id}>{d.name} ({d.breed || "—"})</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="text-[13px] uppercase tracking-widest text-gray-500 font-black">Choose a service</label>
              <div className="grid grid-cols-2 gap-3 mt-2">
                {SERVICE_OPTIONS.map(s => (
                  <button key={s.key} onClick={()=>setServiceType(s.key)} data-testid={`wiz-svc-${s.key}`}
                          className={`text-left p-4 rounded-lg border transition ${serviceType===s.key ? s.color + " ring-2 ring-shBlue/60" : "bg-bgBase border-bgHover text-gray-300 hover:border-shBlue/40"}`}>
                    <p className="font-black uppercase tracking-widest text-[15px]"><i className={`fas ${s.icon} mr-2`}/>{s.label}</p>
                    <p className="text-[13px] mt-1 opacity-80 normal-case">{s.desc}</p>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-3">
              <button onClick={onClose} className="bg-bgBase border border-bgHover text-gray-300 px-4 py-2 rounded text-[14px] font-black uppercase tracking-widest hover:border-shBlue">Cancel</button>
              <button onClick={()=>setStep(2)} disabled={!serviceType || !dogId} data-testid="wiz-step1-next"
                      className="bg-shBlue text-white px-5 py-2 rounded text-[14px] font-black uppercase tracking-widest hover:bg-shBlue/90 disabled:opacity-50">
                Next <i className="fas fa-arrow-right ml-1.5"/>
              </button>
            </div>
          </div>
        )}

        {/* STEP 2 */}
        {step === 2 && (
          <div className="space-y-4">
            <div className={`rounded p-3 border text-[14px] font-black uppercase tracking-widest ${svcMeta?.color}`}>
              <i className={`fas ${svcMeta?.icon} mr-2`}/>{svcMeta?.label} · {selectedDog?.name}
            </div>

            {/* Multi-date toggle — daycare only (time-slotted services have per-date slots) */}
            {serviceType === "daycare" && (
              <label className="flex items-center gap-3 cursor-pointer bg-shGreen/5 border border-shGreen/30 rounded p-2.5" data-testid="wiz-multidate-toggle-row">
                <input type="checkbox" checked={isMultiDate} onChange={(e)=>setIsMultiDate(e.target.checked)}
                       data-testid="wiz-multidate-toggle"
                       className="accent-shGreen w-4 h-4" />
                <span className="text-[14px] font-black uppercase tracking-widest text-shGreen">
                  <i className="fas fa-calendar-days mr-2"/>Book multiple specific days
                </span>
                {isMultiDate && multiDates.length > 0 && (
                  <span className="ml-auto text-[13px] font-black uppercase tracking-widest text-white bg-shGreen/20 px-2 py-0.5 rounded">
                    {multiDates.length} picked
                  </span>
                )}
              </label>
            )}

            {/* MULTI-DATE PICKER */}
            {isMultiDate && serviceType === "daycare" ? (
              <MultiDatePicker
                value={multiDates}
                onChange={setMultiDates}
                closedDates={closedDates}
                testid="wiz-multidate"
              />
            ) : (
              <>
                {serviceType === "boarding" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[13px] uppercase tracking-widest text-gray-500 font-black">Drop-off date</label>
                      <input type="date" value={date} min={minDate} onChange={(e)=>setDate(e.target.value)} style={{colorScheme:"dark"}}
                             className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" data-testid="wiz-date" />
                    </div>
                    <div>
                      <label className="text-[13px] uppercase tracking-widest text-gray-500 font-black">Pickup date</label>
                      <input type="date" value={endDate} min={date} onChange={(e)=>setEndDate(e.target.value)} style={{colorScheme:"dark"}}
                             className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" data-testid="wiz-end" />
                    </div>
                  </div>
                )}

                {/* Daycare or time-slotted: single date */}
                {serviceType !== "boarding" && (
                  <div>
                    <label className="text-[13px] uppercase tracking-widest text-gray-500 font-black">Date</label>
                    <input type="date" value={date} min={minDate} onChange={(e)=>setDate(e.target.value)} style={{colorScheme:"dark"}}
                           className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" data-testid="wiz-date" />
                  </div>
                )}
              </>
            )}

            {/* Closed-day warnings — Settings → Closed Days is the source */}
            {dateIsClosed && (
              <div className="bg-red-500/15 text-red-300 border border-red-500/30 rounded p-3 text-[14px] font-black uppercase tracking-widest text-center" data-testid="wiz-closed-date">
                <i className="fas fa-calendar-xmark mr-1.5"/>We're closed on this day — please pick another date
              </div>
            )}
            {endDateIsClosed && !dateIsClosed && (
              <div className="bg-red-500/15 text-red-300 border border-red-500/30 rounded p-3 text-[14px] font-black uppercase tracking-widest text-center" data-testid="wiz-closed-end-date">
                <i className="fas fa-calendar-xmark mr-1.5"/>We're closed on the pickup day — please choose another
              </div>
            )}

            {/* Daycare availability */}
            {serviceType === "daycare" && avail && (
              <div className={`text-[14px] font-black uppercase tracking-widest p-3 rounded text-center ${!avail.vaccine_ok?"bg-red-500/15 text-red-400":avail.open_slots<=0?"bg-shOrange/15 text-shOrange":"bg-shGreen/10 text-shGreen"}`}>
                {!avail.vaccine_ok ? "Rabies missing/expired"
                  : avail.open_slots <= 0 ? "Fully booked"
                  : `${avail.open_slots} of ${avail.capacity} daycare spots open`}
              </div>
            )}

            {/* Grooming type */}
            {serviceType === "grooming" && (
              <div>
                <label className="text-[13px] uppercase tracking-widest text-gray-500 font-black">Grooming type</label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  {[{k:"bath",l:"Bath",i:"fa-bath"},{k:"nail_trim",l:"Nail trim",i:"fa-scissors"}].map(g => (
                    <button key={g.k} onClick={()=>setGroomingType(g.k)} data-testid={`wiz-grooming-${g.k}`}
                            className={`py-2 rounded text-[14px] font-black uppercase tracking-widest border ${groomingType===g.k?"bg-pink-500/15 text-pink-300 border-pink-500/60":"bg-bgBase border-bgHover text-gray-400"}`}>
                      <i className={`fas ${g.i} mr-1.5`}/>{g.l}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Time slots for time-slotted services */}
            {TIME_SLOTTED.has(serviceType) && (
              <div>
                <label className="text-[13px] uppercase tracking-widest text-gray-500 font-black">Available time slots</label>
                {slotLoading && <p className="text-[14px] text-gray-500 mt-2"><i className="fas fa-spinner fa-spin mr-1"/>Checking openings…</p>}
                {!slotLoading && slots && slots.closed && (
                  <div className="mt-2 bg-shOrange/10 text-shOrange p-3 rounded text-[14px] font-black uppercase tracking-widest text-center">
                    <i className="fas fa-door-closed mr-1.5"/>Closed for {serviceType} on this date — pick another day
                  </div>
                )}
                {!slotLoading && slots && !slots.closed && (
                  <>
                    <p className="text-[13px] text-gray-500 mt-1">{slots.duration_minutes || 60}-minute session</p>
                    <div className="grid grid-cols-4 gap-2 mt-2 max-h-56 overflow-y-auto p-1">
                      {slots.slots.length === 0 && <p className="col-span-4 text-[14px] text-gray-500 text-center py-3">No slots configured for this date.</p>}
                      {slots.slots.map(s => {
                        const selected = time === s.time;
                        return (
                          <button key={s.time} onClick={()=>s.available && setTime(s.time)}
                                  disabled={!s.available} data-testid={`wiz-slot-${s.time}`}
                                  className={`py-2 rounded text-[14px] font-black tracking-widest border ${
                                    selected ? "bg-shBlue text-white border-shBlue" :
                                    s.available ? "bg-bgBase border-bgHover text-gray-300 hover:border-shBlue" :
                                    "bg-bgBase/40 border-bgHover/30 text-gray-600 line-through cursor-not-allowed"
                                  }`}>
                            {s.time}
                          </button>
                        );
                      })}
                    </div>
                    {slots.slots.every(s => !s.available) && slots.slots.length > 0 && (
                      <p className="text-[14px] text-shOrange mt-2 text-center"><i className="fas fa-info-circle mr-1"/>All slots booked for this date — try another day.</p>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Sprint 110an — eligible add-ons for the chosen base service.
                Hidden when the base service has no add-ons configured. */}
            {eligibleAddons.length > 0 && (
              <div data-testid="portal-addons-picker">
                <label className="text-[13px] uppercase tracking-widest text-amber-400 font-black">
                  <i className="fas fa-plus-circle mr-1"/>Add a little extra (optional)
                </label>
                <div className="mt-2 space-y-2">
                  {eligibleAddons.map(a => {
                    const picked = selectedAddonIds.includes(a.id);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        data-testid={`portal-addon-${a.id}`}
                        onClick={() => setSelectedAddonIds(prev =>
                          picked ? prev.filter(x => x !== a.id) : [...prev, a.id]
                        )}
                        className={`w-full flex items-center gap-3 p-3 rounded-lg border transition text-left ${
                          picked
                            ? "bg-amber-500/15 border-amber-500/60"
                            : "bg-bgBase/40 border-bgHover hover:border-amber-500/40"
                        }`}
                      >
                        <div className="w-10 h-10 rounded grid place-items-center shrink-0"
                             style={{ background: `${a.color || "#f59e0b"}25`, color: a.color || "#f59e0b" }}>
                          <i className={`fas ${a.icon || "fa-plus"}`}/>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[14px] font-black text-white truncate">{a.name}</div>
                          {a.description && (
                            <div className="text-[12px] text-gray-400 line-clamp-2">{a.description}</div>
                          )}
                        </div>
                        <div className="text-shGreen font-black text-[14px] whitespace-nowrap">
                          +${(a.base_price || 0).toFixed(2)}
                        </div>
                        {picked && <i className="fas fa-check-circle text-amber-400"/>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <label className="text-[13px] uppercase tracking-widest text-gray-500 font-black">Notes (optional)</label>
              <textarea value={notes} onChange={(e)=>setNotes(e.target.value)} rows={2}
                        placeholder="Anything we should know? Allergies, meds, behavior notes…"
                        className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm resize-none" />
            </div>

            <div className="flex justify-between gap-2 pt-3">
              <button onClick={()=>setStep(1)} className="bg-bgBase border border-bgHover text-gray-300 px-4 py-2 rounded text-[14px] font-black uppercase tracking-widest hover:border-shBlue">
                <i className="fas fa-arrow-left mr-1.5"/>Back
              </button>
              <button onClick={()=>setStep(3)} disabled={!canProceedFromStep2} data-testid="wiz-step2-next"
                      className="bg-shBlue text-white px-5 py-2 rounded text-[14px] font-black uppercase tracking-widest hover:bg-shBlue/90 disabled:opacity-50">
                Review <i className="fas fa-arrow-right ml-1.5"/>
              </button>
            </div>
          </div>
        )}

        {/* STEP 3 */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="bg-bgBase border border-bgHover rounded-lg p-4 space-y-2 text-[15px]">
              <div className="flex justify-between"><span className="text-gray-500 font-black uppercase tracking-widest text-[13px]">Dog</span><span className="text-white font-black">{selectedDog?.name}</span></div>
              <div className="flex justify-between"><span className="text-gray-500 font-black uppercase tracking-widest text-[13px]">Service</span><span className="text-white font-black">{svcMeta?.label}</span></div>
              {serviceType === "boarding" ? (
                <>
                  <div className="flex justify-between"><span className="text-gray-500 font-black uppercase tracking-widest text-[13px]">Drop-off</span><span className="text-white font-black">{fmt(date)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500 font-black uppercase tracking-widest text-[13px]">Pickup</span><span className="text-white font-black">{fmt(endDate)}</span></div>
                </>
              ) : isMultiDate && serviceType === "daycare" ? (
                <div data-testid="wiz-review-multidate">
                  <div className="flex justify-between">
                    <span className="text-gray-500 font-black uppercase tracking-widest text-[13px]">Days</span>
                    <span className="text-shGreen font-black">{multiDates.length} day{multiDates.length===1?"":"s"}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {multiDates.map(d => (
                      <span key={d} className="bg-shGreen/15 border border-shGreen/40 text-shGreen rounded px-2 py-0.5 text-[12px] font-black">{fmt(d)}</span>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex justify-between"><span className="text-gray-500 font-black uppercase tracking-widest text-[13px]">Date</span><span className="text-white font-black">{fmt(date)}</span></div>
              )}
              {TIME_SLOTTED.has(serviceType) && (
                <div className="flex justify-between"><span className="text-gray-500 font-black uppercase tracking-widest text-[13px]">Time</span><span className="text-white font-black">{time}</span></div>
              )}
              {serviceType === "grooming" && (
                <div className="flex justify-between"><span className="text-gray-500 font-black uppercase tracking-widest text-[13px]">Type</span><span className="text-white font-black capitalize">{groomingType.replace("_"," ")}</span></div>
              )}
              {notes && (
                <div className="pt-2 border-t border-bgHover"><span className="text-gray-500 font-black uppercase tracking-widest text-[13px] block mb-1">Notes</span><span className="text-gray-300 text-[15px]">{notes}</span></div>
              )}
            </div>

            {err && <div className="text-[15px] font-black p-3 rounded uppercase tracking-widest bg-red-500/15 text-red-400 text-center">{err}</div>}

            <p className="text-[14px] text-gray-500 text-center">Your booking will be reviewed and approved by Sit Happens.</p>

            <div className="flex justify-between gap-2 pt-3">
              <button onClick={()=>setStep(2)} className="bg-bgBase border border-bgHover text-gray-300 px-4 py-2 rounded text-[14px] font-black uppercase tracking-widest hover:border-shBlue">
                <i className="fas fa-arrow-left mr-1.5"/>Back
              </button>
              <button onClick={book} disabled={submitting} data-testid="wiz-confirm"
                      className="bg-shGreen text-bgHeader px-6 py-2 rounded text-[14px] font-black uppercase tracking-widest hover:bg-shGreen/90 disabled:opacity-50">
                {submitting ? "Booking…" : (isMultiDate && serviceType==="daycare" ? `Submit ${multiDates.length} booking${multiDates.length===1?"":"s"}` : "Confirm booking")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
