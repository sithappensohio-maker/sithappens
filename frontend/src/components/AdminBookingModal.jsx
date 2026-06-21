import { useEffect, useMemo, useState } from "react";
import { api, formatErr } from "../lib/api";
import MultiDatePicker from "./MultiDatePicker";
import { useEditLock } from "../lib/useLiveRefresh";
import { todayISO } from "../lib/date";

export default function AdminBookingModal({ defaultCheckIn = false, defaultDate = null, existing = null, onClose, onCreated }) {
  useEditLock(true);
  const [clients, setClients] = useState([]);
  const [dogs, setDogs] = useState([]);
  const [kennels, setKennels] = useState([]);
  const [closedDates, setClosedDates] = useState([]);
  const [clientId, setClientId] = useState(existing?.client_id || "");
  const [dogId, setDogId] = useState(existing?.dog_id || "");
  // Quick Check-in mode: dog-first selection (the common drop-off flow).
  // Normal booking creation stays client-first.
  const isQuickCheckin = defaultCheckIn && !existing;
  const [serviceType, setServiceType] = useState(existing?.service_type || "daycare");
  const [date, setDate] = useState(existing?.date || defaultDate || todayISO());
  const [endDate, setEndDate] = useState(existing?.end_date || "");
  // Multi-date mode: book several non-consecutive days at once (daycare /
  // training / grooming / photography). Not allowed for boarding (spans dates)
  // and not allowed when editing an existing booking.
  const [isMultiDate, setIsMultiDate] = useState(false);
  const [multiDates, setMultiDates] = useState([]);
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
  // Sprint 110an — add-ons eligible for the chosen base service type.
  // Re-fetched whenever serviceType changes so the picker stays in sync
  // with the catalog (e.g. admin flips an add-on's "for: boarding" toggle
  // and immediately sees it appear / disappear from the booking modal).
  const [eligibleAddons, setEligibleAddons] = useState([]);
  const [selectedAddonIds, setSelectedAddonIds] = useState([]);

  // Sprint 110di-38 — Multi-dog group booking (admin variant).
  // Mirrors the portal wizard pattern: primary dog + extras share the same
  // date / service / dropoff window; per-dog add-ons & notes. Disabled in
  // edit and multi-date modes.
  const [extraDogs, setExtraDogs] = useState([]);
  const clientDogsForGroup = useMemo(
    () => (dogs || []).filter(d => d.owner_id === clientId),
    [dogs, clientId]
  );
  // Reset extras whenever client changes — selecting a new owner means the
  // dog list changes and any previously-picked extras may not belong to
  // them anymore.
  useEffect(() => { setExtraDogs([]); }, [clientId]);
  const addExtraDog = () => {
    const used = new Set([dogId, ...extraDogs.map(e => e.dog_id)]);
    const next = clientDogsForGroup.find(d => !used.has(d.id));
    if (!next) return;
    setExtraDogs([...extraDogs, { dog_id: next.id, addon_service_ids: [], notes: "" }]);
  };
  const removeExtraDog = (idx) => setExtraDogs(extraDogs.filter((_, i) => i !== idx));
  const updateExtraDog = (idx, patch) =>
    setExtraDogs(extraDogs.map((e, i) => i === idx ? { ...e, ...patch } : e));
  const toggleExtraAddon = (idx, addonId) => {
    const cur = extraDogs[idx].addon_service_ids || [];
    const next = cur.includes(addonId) ? cur.filter(x => x !== addonId) : [...cur, addonId];
    updateExtraDog(idx, { addon_service_ids: next });
  };

  useEffect(() => {
    (async () => {
      try {
        const [cRes, dRes, sRes] = await Promise.all([
          api.get("/clients"), api.get("/dogs"), api.get("/settings"),
        ]);
        setClients(cRes.data);
        setDogs(dRes.data);
        setKennels(sRes.data.kennels || []);
        setClosedDates(Array.isArray(sRes.data?.closed_dates) ? sRes.data.closed_dates : []);
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

  // Force-off multi-date when service becomes boarding (multi-date isn't valid
  // for spanning stays) or when editing (you edit a single booking at a time).
  useEffect(() => {
    if (serviceType === "boarding" || isEdit) {
      setIsMultiDate(false);
    }
  }, [serviceType, isEdit]);

  // Re-load eligible add-ons whenever the base service type changes.
  useEffect(() => {
    if (isEdit) return; // editing doesn't re-attach add-ons (do it via the booking detail)
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get("/services/addons", { params: { for: serviceType } });
        if (!cancelled) {
          setEligibleAddons(data || []);
          // Drop selections that no longer apply (e.g. switched daycare → boarding)
          setSelectedAddonIds(prev => prev.filter(id => (data || []).some(a => a.id === id)));
        }
      } catch {
        if (!cancelled) setEligibleAddons([]);
      }
    })();
    return () => { cancelled = true; };
  }, [serviceType, isEdit]);

  const submit = async () => {
    setErr("");
    if (!dogId) { setErr("Pick a dog"); return; }
    if (isMultiDate && !isEdit) {
      if (multiDates.length === 0) { setErr("Pick at least one date"); return; }
      setSaving(true);
      try {
        const { data } = await api.post("/bookings/multi-dates", {
          dog_id: dogId,
          dates: multiDates,
          service_type: serviceType,
          grooming_type: serviceType === "grooming" ? groomingType : null,
          time: ["training", "grooming", "photography"].includes(serviceType) ? (appointmentTime || "") : "",
          notes,
          override_capacity: overrideCapacity,
          override_vaccines: overrideVaccines,
          addon_service_ids: selectedAddonIds,
        });
        const c = data.created?.length || 0;
        const s = data.skipped?.length || 0;
        if (c === 0) {
          setErr(`No bookings created — all ${s} day(s) were skipped (${(data.skipped || []).map(x => `${x.date}: ${x.reason}`).join("; ")})`);
          setSaving(false);
          return;
        }
        onCreated?.({
          summary: `${c} booking${c===1?"":"s"} created${s ? `, ${s} skipped` : ""}`,
          skipped: data.skipped,
        });
        onClose();
      } catch (e) { setErr(formatErr(e.response?.data?.detail) || "Save failed"); }
      setSaving(false);
      return;
    }
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
          addon_service_ids: selectedAddonIds,
        };
        // Sprint 110di-38 — Group booking branch. When admin has added extra
        // dogs to this transaction, hit /bookings/group so all rows share a
        // group_id and any per-dog failure rolls back atomically. The legacy
        // single-dog path below stays untouched for the common case.
        if (extraDogs.length > 0) {
          const groupBody = {
            dogs: [
              { dog_id: dogId, addon_service_ids: selectedAddonIds, notes },
              ...extraDogs.map(e => ({
                dog_id: e.dog_id,
                addon_service_ids: e.addon_service_ids || [],
                notes: e.notes || "",
              })),
            ],
            date,
            end_date: serviceType === "boarding" ? (endDate || date) : null,
            service_type: serviceType,
            grooming_type: serviceType === "grooming" ? groomingType : null,
            dropoff_time: dropoffTime || "",
            pickup_time: pickupTime || "",
            time: ["training", "grooming", "photography"].includes(serviceType) ? (appointmentTime || "") : "",
            notes,
            override_vaccines: overrideVaccines,
            override_capacity: overrideCapacity,
            check_in_now: checkInNow,
          };
          await api.post("/bookings/group", groupBody);
        } else {
          await api.post("/bookings", body);
        }
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

          {/* Multi-date toggle (admin only, non-boarding, not when editing) */}
          {!isEdit && serviceType !== "boarding" && (
            <label className="flex items-center gap-3 cursor-pointer bg-shGreen/5 border border-shGreen/30 rounded p-2.5" data-testid="ab-multidate-toggle-row">
              <input type="checkbox" checked={isMultiDate} onChange={(e)=>setIsMultiDate(e.target.checked)}
                     data-testid="ab-multidate-toggle"
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

          {isMultiDate && !isEdit ? (
            <div data-testid="ab-multidate-section">
              <MultiDatePicker
                value={multiDates}
                onChange={setMultiDates}
                closedDates={closedDates}
                testid="ab-multidate"
              />
            </div>
          ) : (
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
          )}

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

          {/* Sprint 110di-38 — Multi-dog group booking (admin). Shown only
              when not editing, not in multi-date mode, and the selected
              client has >1 dog on file. Primary dog is `dogId`; extras are
              tracked in `extraDogs` and share the booking's date/service. */}
          {!isEdit && !isMultiDate && clientDogsForGroup.length > 1 && (
            <div className="bg-bgBase/40 border border-shGreen/30 rounded-lg p-3 space-y-3" data-testid="ab-multidog">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-shGreen font-black uppercase tracking-widest text-[13px]"><i className="fas fa-paw mr-1.5"/>More dogs on this booking?</p>
                  <p className="text-gray-400 text-[14px] mt-0.5">Same date and service. Per-dog add-ons.</p>
                </div>
                {extraDogs.length + 1 < clientDogsForGroup.length && (
                  <button type="button" onClick={addExtraDog} data-testid="ab-add-dog"
                          className="bg-shGreen/20 border border-shGreen/40 text-shGreen px-3 py-1.5 rounded text-[13px] font-black uppercase tracking-widest hover:bg-shGreen/30 transition whitespace-nowrap">
                    <i className="fas fa-plus mr-1"/>Add dog
                  </button>
                )}
              </div>
              {extraDogs.map((extra, idx) => {
                const usedIds = new Set([dogId, ...extraDogs.map((e, i) => i !== idx ? e.dog_id : null).filter(Boolean)]);
                const available = clientDogsForGroup.filter(d => !usedIds.has(d.id));
                return (
                  <div key={idx} className="border-t border-bgHover pt-3 space-y-2" data-testid={`ab-extra-dog-${idx}`}>
                    <div className="flex gap-2 items-center">
                      <select value={extra.dog_id}
                              onChange={(e)=>updateExtraDog(idx, { dog_id: e.target.value, addon_service_ids: [] })}
                              data-testid={`ab-extra-dog-select-${idx}`}
                              className="flex-1 bg-bgPanel border border-bgHover rounded p-2 text-white text-[13px]">
                        {available.map(d => (
                          <option key={d.id} value={d.id}>{d.name} ({d.breed || "—"})</option>
                        ))}
                      </select>
                      <button type="button" onClick={()=>removeExtraDog(idx)} data-testid={`ab-remove-dog-${idx}`}
                              className="bg-red-500/15 border border-red-500/40 text-red-300 px-2 py-2 rounded text-[13px] font-black hover:bg-red-500/25 transition"
                              title="Remove this dog">
                        <i className="fas fa-times"/>
                      </button>
                    </div>
                    {eligibleAddons.length > 0 && (
                      <div className="pt-1">
                        <p className="text-[12px] font-black uppercase tracking-widest text-amber-400 mb-2">
                          <i className="fas fa-plus-circle mr-1"/>Add-ons for {(dogs.find(d=>d.id===extra.dog_id) || {}).name || "this dog"} (optional)
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                          {eligibleAddons.map(a => {
                            const on = (extra.addon_service_ids || []).includes(a.id);
                            return (
                              <button key={a.id} type="button"
                                      onClick={()=>toggleExtraAddon(idx, a.id)}
                                      data-testid={`ab-extra-addon-${idx}-${a.id}`}
                                      className={`flex items-center gap-3 p-3 rounded-lg border transition text-left ${
                                        on
                                          ? "bg-amber-500/15 border-amber-500/60 shadow"
                                          : "bg-bgBase/40 border-bgHover hover:border-amber-500/40"
                                      }`}>
                                <div className="w-9 h-9 rounded grid place-items-center shrink-0"
                                     style={{ background: `${a.color || "#f59e0b"}25`, color: a.color || "#f59e0b" }}>
                                  <i className={`fas ${a.icon || "fa-plus"}`}/>
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-[14px] font-black text-white truncate">{a.name}</div>
                                  {a.description && (
                                    <div className="text-[12px] text-gray-400 truncate">{a.description}</div>
                                  )}
                                </div>
                                <div className="text-shGreen font-black text-[14px] whitespace-nowrap">
                                  +${(a.base_price || 0).toFixed(2)}
                                </div>
                                {on && <i className="fas fa-check-circle text-amber-400"/>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {extraDogs.length > 0 && (
                <p className="text-shGreen text-[13px] font-black uppercase tracking-widest pt-1 border-t border-bgHover" data-testid="ab-group-count">
                  <i className="fas fa-link mr-1"/>Group booking · {extraDogs.length + 1} dogs share this booking
                </p>
              )}
            </div>
          )}

          {/* Sprint 110an — add-ons picker. Only shown for new bookings (editing
              bookings should attach add-ons via the booking detail view).
              Tile-style multi-select so admins can quickly tack on a nail
              trim, bath, etc. at booking time. */}
          {!isEdit && eligibleAddons.length > 0 && (
            <div data-testid="booking-addons-picker">
              <div className="flex items-center justify-between mb-2">
                <label className="text-[14px] font-black text-amber-400 uppercase tracking-widest">
                  <i className="fas fa-plus-circle mr-1"/>
                  {extraDogs.length > 0
                    ? `Add-ons for ${(dogs.find(d=>d.id===dogId) || {}).name || "primary dog"} (optional)`
                    : "Add-ons (optional)"}
                </label>
                {selectedAddonIds.length > 0 && (
                  <span className="text-[12px] text-amber-300 font-black uppercase tracking-widest">
                    {selectedAddonIds.length} selected · +${eligibleAddons
                      .filter(a => selectedAddonIds.includes(a.id))
                      .reduce((s, a) => s + (a.base_price || 0), 0)
                      .toFixed(2)}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {eligibleAddons.map(a => {
                  const picked = selectedAddonIds.includes(a.id);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      data-testid={`booking-addon-${a.id}`}
                      onClick={() => setSelectedAddonIds(prev =>
                        picked ? prev.filter(x => x !== a.id) : [...prev, a.id]
                      )}
                      className={`flex items-center gap-3 p-3 rounded-lg border transition text-left ${
                        picked
                          ? "bg-amber-500/15 border-amber-500/60 shadow"
                          : "bg-bgBase/40 border-bgHover hover:border-amber-500/40"
                      }`}
                    >
                      <div className="w-9 h-9 rounded grid place-items-center shrink-0"
                           style={{ background: `${a.color || "#f59e0b"}25`, color: a.color || "#f59e0b" }}>
                        <i className={`fas ${a.icon || "fa-plus"}`}/>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[14px] font-black text-white truncate">{a.name}</div>
                        {a.description && (
                          <div className="text-[12px] text-gray-400 truncate">{a.description}</div>
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

          <div className="border-t border-bgHover pt-4 space-y-3">
            {!isMultiDate && (
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" checked={checkInNow} onChange={(e)=>setCheckInNow(e.target.checked)} data-testid="ab-checkin-now" className="accent-shGreen w-4 h-4" />
                <span className="text-[15px] font-black uppercase tracking-widest text-gray-300"><i className="fas fa-clock-rotate-left mr-2 text-shGreen"/>Check in immediately (stamps arrival time)</span>
              </label>
            )}
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
            <button onClick={submit} disabled={saving || !dogId || (isMultiDate && multiDates.length === 0)} data-testid="ab-submit"
                    className="bg-shGreen text-bgHeader px-8 py-3 rounded font-black text-[14px] uppercase tracking-widest shadow-xl disabled:opacity-50">
              {saving ? "Saving…" : (isEdit
                ? "Save Changes"
                : (isMultiDate
                    ? `Book ${multiDates.length || ""} day${multiDates.length===1?"":"s"}`
                    : extraDogs.length > 0
                      ? `Create ${1 + extraDogs.length} bookings`
                      : (checkInNow ? "Book & Check In" : "Create Booking")))}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
