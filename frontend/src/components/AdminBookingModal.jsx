import { useEffect, useMemo, useState } from "react";
import { api, formatErr } from "../lib/api";
import MultiDatePicker from "./MultiDatePicker";
import { useEditLock } from "../lib/useLiveRefresh";
import { todayISO } from "../lib/date";


const fmtUSD = (n) => `$${(Math.max(0, Number(n) || 0)).toFixed(2)}`;
const fmtCredits = (n) => {
  const val = Math.round((Number(n) || 0) * 10) / 10;
  return Number.isInteger(val) ? String(val) : val.toFixed(1);
};

const creditPoolForService = (serviceType) => {
  if (serviceType === "daycare") return { key: "credits", label: "daycare credits" };
  if (serviceType === "training") return { key: "training_credits", label: "training credits" };
  if (serviceType === "boarding") return { key: "boarding_credits", label: "boarding credits" };
  return null;
};

const pluralUnit = (count, label) => {
  const clean = String(label || "units").replace(/s$/, "");
  return `${count} ${Number(count) === 1 ? clean : `${clean}s`}`;
};

const getMultiDogDiscountConfig = (settings, serviceType) => {
  // Sit Happens fixed business rule: daycare and boarding additional dogs are
  // always 50% off the same base service price as the first dog. Do not trust
  // older saved settings like flat $12.50 or service.additional_dog_rate here;
  // those were the source of weird daycare totals like $47.50.
  if (serviceType === "daycare" || serviceType === "boarding") {
    return { mode: "percent", value: 50, label: "Additional dog discount", source: "fixed_daycare_boarding_rule" };
  }
  if (!settings) return null;
  const per = settings.multi_dog_discount_by_service || {};
  const svcCfg = per[serviceType];
  if (svcCfg && Object.keys(svcCfg).length > 0) {
    if (!svcCfg.enabled) return null;
    return {
      mode: svcCfg.mode || "percent",
      value: Number(svcCfg.value || 0),
      label: svcCfg.label || "Additional dog discount",
    };
  }
  return null;
};


const calcDiscountAmount = (rawAdditionalDogBase, cfg, additionalDogs) => {
  const raw = Math.max(0, Number(rawAdditionalDogBase) || 0);
  const dogs = Math.max(0, Number(additionalDogs) || 0);
  if (!cfg || raw <= 0 || dogs <= 0) return 0;
  const value = Number(cfg.value || 0);
  if (value <= 0) return 0;
  if ((cfg.mode || "percent") === "flat") return Math.min(raw, value * dogs);
  return raw * (Math.min(100, Math.max(0, value)) / 100);
};

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
  const [serviceId, setServiceId] = useState(existing?.service_id || "");
  const [catalogServices, setCatalogServices] = useState([]);
  const [date, setDate] = useState(existing?.date || defaultDate || todayISO());
  const [endDate, setEndDate] = useState(existing?.end_date || "");
  // Multi-date mode: book several non-consecutive days at once (daycare /
  // training / grooming / photography). Not allowed for boarding (spans dates)
  // and not allowed when editing an existing booking.
  const [isMultiDate, setIsMultiDate] = useState(false);
  const [multiDates, setMultiDates] = useState([]);
  const [kennel, setKennel] = useState(existing?.kennel || "");
  const [dropoffTime, setDropoffTime] = useState(existing?.dropoff_time || "09:00");
  const [pickupTime, setPickupTime] = useState(existing?.pickup_time || "17:00");
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

  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState("");
  const [quoteLines, setQuoteLines] = useState([]);
  const [multiDogDiscountSettings, setMultiDogDiscountSettings] = useState({});

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

  // Keep group booking selections impossible to double-count. When the primary
  // dog changes, or an older browser state contains the same dog twice, remove
  // duplicates so estimate math stays obvious and correct.
  useEffect(() => {
    setExtraDogs(prev => {
      const seen = new Set([dogId].filter(Boolean));
      const cleaned = [];
      for (const row of prev || []) {
        if (!row?.dog_id || seen.has(row.dog_id)) continue;
        seen.add(row.dog_id);
        cleaned.push(row);
      }
      return cleaned.length === (prev || []).length ? prev : cleaned;
    });
  }, [dogId]);

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
        const [cRes, dRes, sRes, svcRes] = await Promise.all([
          api.get("/clients"), api.get("/dogs"), api.get("/settings"), api.get("/services"),
        ]);
        setClients(cRes.data);
        setDogs(dRes.data);
        const activeBaseServices = (Array.isArray(svcRes.data) ? svcRes.data : []).filter(s => s.active !== false && !s.is_addon);
        setCatalogServices(activeBaseServices);
        if (existing?.service_id) {
          const chosen = activeBaseServices.find(s => s.id === existing.service_id);
          if (chosen) { setServiceId(chosen.id); setServiceType(chosen.service_type); }
        } else if (!serviceId) {
          const chosen = activeBaseServices.find(s => s.service_type === (existing?.service_type || "daycare") && s.is_default)
            || activeBaseServices.find(s => s.service_type === (existing?.service_type || "daycare"));
          if (chosen) { setServiceId(chosen.id); setServiceType(chosen.service_type); }
        }
        setKennels(sRes.data.kennels || []);
        setClosedDates(Array.isArray(sRes.data?.closed_dates) ? sRes.data.closed_dates : []);
        if (!existing) {
          const cutoff = sRes.data?.booking_rules?.boarding_full_day_pickup_cutoff;
          if (/^\d{2}:\d{2}$/.test(cutoff || "")) setPickupTime(cutoff);
        }
        setMultiDogDiscountSettings({
          multi_dog_discount_enabled: sRes.data?.multi_dog_discount_enabled,
          multi_dog_discount_mode: sRes.data?.multi_dog_discount_mode || "percent",
          multi_dog_discount_value: Number(sRes.data?.multi_dog_discount_value ?? 50),
          multi_dog_discount_label: sRes.data?.multi_dog_discount_label || "Additional dog discount",
          multi_dog_discount_by_service: sRes.data?.multi_dog_discount_by_service || {},
        });
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

  const selectedClient = useMemo(() => clients.find(c => c.id === clientId) || null, [clients, clientId]);
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

  // Admin-facing live estimate. Uses the same backend /pricing/quote
  // endpoint that powers the client portal so admin-created bookings do not
  // silently use different math. Read-only: does not create bookings or spend credits.
  useEffect(() => {
    if (isEdit) {
      setQuoteLines([]);
      setQuoteError("");
      setQuoteLoading(false);
      return;
    }

    const primaryDog = dogs.find(d => d.id === dogId);
    const hasOneDate = !!date;
    const datesToQuote = isMultiDate ? [...multiDates].sort() : (hasOneDate ? [date] : []);

    if (!dogId || !serviceType || datesToQuote.length === 0) {
      setQuoteLines([]);
      setQuoteError("");
      setQuoteLoading(false);
      return;
    }

    if (serviceType === "boarding") {
      if (!endDate) {
        setQuoteLines([]);
        setQuoteError("Pick a pickup date to see the boarding estimate.");
        setQuoteLoading(false);
        return;
      }
      if (endDate <= date) {
        setQuoteLines([]);
        setQuoteError("Pickup date must be after the drop-off date to calculate boarding nights.");
        setQuoteLoading(false);
        return;
      }
    }

    const dogRows = [
      {
        dog_id: dogId,
        dog_name: primaryDog?.name || "Selected dog",
        addon_service_ids: selectedAddonIds,
      },
      ...extraDogs
        .filter(e => e?.dog_id)
        .map(e => ({
          dog_id: e.dog_id,
          dog_name: dogs.find(d => d.id === e.dog_id)?.name || "Extra dog",
          addon_service_ids: e.addon_service_ids || [],
        })),
    ];

    let cancelled = false;
    setQuoteLoading(true);
    setQuoteError("");

    Promise.all(
      dogRows.flatMap(row =>
        datesToQuote.map(d =>
          api.post("/pricing/quote", {
            service_type: serviceType,
            service_id: serviceId || undefined,
            date: d,
            end_date: serviceType === "boarding" ? endDate : null,
            dog_id: row.dog_id,
            dropoff_time: serviceType === "boarding" ? (dropoffTime || undefined) : undefined,
            pickup_time: serviceType === "boarding" ? (pickupTime || undefined) : undefined,
            addon_service_ids: row.addon_service_ids || [],
          }).then(({ data }) => ({
            dog_id: row.dog_id,
            dog_name: row.dog_name,
            date: d,
            quote: data || {},
          }))
        )
      )
    )
      .then(lines => {
        if (!cancelled) setQuoteLines(lines || []);
      })
      .catch(e => {
        if (!cancelled) {
          setQuoteLines([]);
          setQuoteError(formatErr(e.response?.data?.detail) || "Estimate unavailable. Check service pricing setup.");
        }
      })
      .finally(() => {
        if (!cancelled) setQuoteLoading(false);
      });

    return () => { cancelled = true; };
  }, [
    isEdit,
    dogId,
    serviceType,
    serviceId,
    date,
    endDate,
    dropoffTime,
    pickupTime,
    isMultiDate,
    JSON.stringify(multiDates),
    JSON.stringify(selectedAddonIds),
    JSON.stringify(extraDogs),
    dogs,
  ]);

  const quoteSummary = useMemo(() => {
    if (!quoteLines.length) return null;
    const rawTotal = quoteLines.reduce((sum, l) => sum + Number(l.quote?.estimated_price || 0), 0);
    const baseTotal = quoteLines.reduce((sum, l) => sum + Number(l.quote?.base_estimated_price || 0), 0);
    const addonTotal = quoteLines.reduce((sum, l) => sum + Number(l.quote?.add_on_total || 0), 0);
    const units = quoteLines.reduce((sum, l) => sum + Number(l.quote?.billable_units || 0), 0);
    const unitLabel = quoteLines[0]?.quote?.unit_label || (serviceType === "boarding" ? "nights" : "visits");
    const serviceName = quoteLines[0]?.quote?.service_name || serviceType;
    const pool = creditPoolForService(serviceType);
    const creditsAvailable = pool && selectedClient ? Number(selectedClient[pool.key] || 0) : 0;
    const preferredRateApplied = quoteLines.some(l => !!l.quote?.preferred_rate_applied);
    const unitPrice = Number(quoteLines[0]?.quote?.unit_price || 0);
    const listUnitPrice = Number(quoteLines[0]?.quote?.list_unit_price || unitPrice);

    // Admin creates grouped bookings as one row per dog. For daycare/boarding,
    // the display must ignore any stale per-dog quote rows or old service
    // `additional_dog_rate` values. Use the highest normal per-dog base as the
    // reference rate, then apply 50% off that reference to each additional dog.
    // Example: two daycare dogs at $30/day => base $60, discount $15, total $45.
    const coreMultiDogService = serviceType === "daycare" || serviceType === "boarding";
    const uniqueDogIds = [...new Set(quoteLines.map(l => l.dog_id).filter(Boolean))];
    const additionalDogCount = coreMultiDogService ? Math.max(0, uniqueDogIds.length - 1) : 0;
    let standardBaseTotal = baseTotal;
    let additionalDogBase = 0;
    if (coreMultiDogService && uniqueDogIds.length > 1) {
      const baseByDog = uniqueDogIds.map(id =>
        quoteLines
          .filter(l => l.dog_id === id)
          .reduce((sum, l) => sum + Number(l.quote?.base_estimated_price || 0), 0)
      );
      const referenceDogBase = Math.max(...baseByDog, 0);
      if (referenceDogBase > 0) {
        standardBaseTotal = referenceDogBase * uniqueDogIds.length;
        additionalDogBase = referenceDogBase * additionalDogCount;
      }
    }
    const mdCfg = getMultiDogDiscountConfig(multiDogDiscountSettings, serviceType);
    const multiDogDiscountAmount = calcDiscountAmount(additionalDogBase, mdCfg, additionalDogCount);
    const total = Math.max(0, standardBaseTotal + addonTotal - multiDogDiscountAmount);
    const unitsForFirstDog = coreMultiDogService
      ? quoteLines
          .filter(l => l.dog_id === uniqueDogIds[0])
          .reduce((sum, l) => sum + Number(l.quote?.billable_units || 0), 0)
      : 0;
    const creditUnitsRequired = pool
      ? (coreMultiDogService
          ? unitsForFirstDog * (1 + 0.5 * additionalDogCount)
          : quoteLines.reduce((sum, l) => sum + Number(l.quote?.credit_units_required || 0), 0))
      : 0;
    const creditsApplied = Math.min(creditsAvailable, creditUnitsRequired);
    const creditsRemainingAfter = Math.max(0, creditsAvailable - creditsApplied);
    const creditShortfall = Math.max(0, creditUnitsRequired - creditsApplied);
    const cashDue = Math.max(0, total - (creditsApplied * unitPrice));
    const coveredByCredits = !!pool && creditUnitsRequired > 0 && creditShortfall <= 0.0001 && addonTotal <= 0.0001;

    return {
      total, rawTotal, baseTotal: standardBaseTotal, addonTotal, units, unitLabel, creditUnitsRequired, serviceName, pool, creditsAvailable,
      creditsApplied, creditsRemainingAfter, creditShortfall, cashDue, coveredByCredits,
      preferredRateApplied, unitPrice, listUnitPrice,
      additionalDogBase, additionalDogCount,
      multiDogDiscountAmount,
      multiDogDiscountLabel: mdCfg?.label || "Additional dog discount",
    };
  }, [quoteLines, serviceType, selectedClient, dogId, multiDogDiscountSettings]);

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
          service_id: serviceId || undefined,
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
          service_id: serviceId || undefined,
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
            service_id: serviceId || undefined,
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
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-2 sm:p-4 z-50" data-testid="admin-booking-modal">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-2xl p-4 sm:p-6 md:p-8 shadow-2xl max-h-[calc(var(--app-height)_-_1rem)] overflow-y-auto overflow-x-hidden animate-slide-in">
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
            <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Exact Service</label>
            <select value={serviceId} onChange={(e) => {
                      const id = e.target.value;
                      const svc = catalogServices.find(s => s.id === id);
                      setServiceId(id);
                      if (svc) {
                        setServiceType(svc.service_type);
                        if (svc.service_type === "grooming") {
                          const marker = `${svc.slug || ""} ${svc.name || ""}`.toLowerCase();
                          setGroomingType(marker.includes("nail") ? "nail_trim" : "bath");
                        }
                      }
                    }}
                    disabled={isEdit}
                    data-testid="ab-service-id"
                    className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
              {!serviceId && <option value="">Choose a service</option>}
              {catalogServices
                .slice()
                .sort((a,b) => String(a.service_type).localeCompare(String(b.service_type)) || String(a.name).localeCompare(String(b.name)))
                .map(s => <option key={s.id} value={s.id}>{s.name} · {s.service_type} · ${Number(s.base_price || 0).toFixed(2)}</option>)}
            </select>
            <p className="text-[11px] text-gray-500 mt-1">Selecting the exact catalog service applies its own price, duration, and booking rules.</p>
          </div>

          {serviceType === "grooming" && !serviceId && !isEdit && (
            <div data-testid="ab-grooming-types">
              <label className="text-[15px] font-black text-gray-500 uppercase tracking-widest">Grooming Service</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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

          {!isEdit && (
            <div className="bg-bgBase border border-shGreen/30 rounded-lg p-4 space-y-3" data-testid="admin-booking-estimate">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] font-black text-shGreen uppercase tracking-widest">
                  <i className="fas fa-receipt mr-2"/>Estimated Price
                </span>
                {quoteSummary?.serviceName && (
                  <span className="text-[11px] text-gray-500 font-black uppercase tracking-widest text-right">
                    {quoteSummary.serviceName}
                  </span>
                )}
              </div>

              {quoteSummary?.preferredRateApplied && (
                <div className="bg-shGreen/10 border border-shGreen/30 rounded px-3 py-2 text-[12px] text-shGreen font-black uppercase tracking-widest" data-testid="admin-booking-estimate-preferred-rate">
                  <i className="fas fa-star mr-1.5"/>Preferred client rate applied
                  {quoteSummary.listUnitPrice && quoteSummary.listUnitPrice !== quoteSummary.unitPrice && (
                    <span className="text-gray-400 ml-1">({fmtUSD(quoteSummary.unitPrice)} instead of {fmtUSD(quoteSummary.listUnitPrice)})</span>
                  )}
                </div>
              )}

              {quoteLoading ? (
                <div className="text-[13px] text-gray-400 font-black uppercase tracking-widest">
                  <i className="fas fa-circle-notch fa-spin mr-2"/>Calculating estimate…
                </div>
              ) : quoteError ? (
                <div className="bg-shOrange/10 border border-shOrange/40 rounded px-3 py-2 text-[13px] text-shOrange font-black uppercase tracking-widest" data-testid="admin-booking-estimate-error">
                  <i className="fas fa-triangle-exclamation mr-2"/>{quoteError}
                </div>
              ) : quoteSummary ? (
                <div className="space-y-2 text-[14px]">
                  <div className="flex justify-between" data-testid="admin-booking-estimate-base">
                    <span className="text-gray-400">
                      Base price
                      {quoteSummary.units > 0 && (
                        <span className="text-gray-500 ml-1">({pluralUnit(quoteSummary.units, quoteSummary.unitLabel)})</span>
                      )}
                    </span>
                    <span className="text-white font-black">{fmtUSD(quoteSummary.baseTotal)}</span>
                  </div>

                  {quoteSummary.addonTotal > 0 && (
                    <div className="flex justify-between" data-testid="admin-booking-estimate-addons">
                      <span className="text-gray-400"><i className="fas fa-plus-circle text-shGreen mr-1.5 opacity-60"/>Add-ons</span>
                      <span className="text-white font-black">{fmtUSD(quoteSummary.addonTotal)}</span>
                    </div>
                  )}

                  {quoteSummary.multiDogDiscountAmount > 0 && (
                    <div className="flex justify-between text-shGreen" data-testid="admin-booking-estimate-multi-dog-discount">
                      <span>
                        <i className="fas fa-tag mr-1.5"/>{quoteSummary.multiDogDiscountLabel}
                        <span className="text-gray-500 ml-1">({quoteSummary.additionalDogCount} additional dog{quoteSummary.additionalDogCount === 1 ? "" : "s"})</span>
                      </span>
                      <span className="font-black">−{fmtUSD(quoteSummary.multiDogDiscountAmount)}</span>
                    </div>
                  )}

                  <div className="flex justify-between border-t border-bgHover pt-2" data-testid="admin-booking-estimate-total">
                    <span className="text-white font-black uppercase tracking-widest text-[13px]">Estimated total</span>
                    <span className="text-white font-black text-[20px]">{fmtUSD(quoteSummary.total)}</span>
                  </div>

                  {quoteSummary.pool && (
                    <div className="bg-shBlue/10 border border-shBlue/30 rounded px-3 py-2 text-[12px] text-shBlue font-black uppercase tracking-widest space-y-1" data-testid="admin-booking-estimate-credits">
                      <div><i className="fas fa-ticket mr-2"/>Credit coverage</div>
                      <div className="text-gray-300">Needs {fmtCredits(quoteSummary.creditUnitsRequired)} {quoteSummary.pool.label}</div>
                      <div className="text-gray-300">Available now: {fmtCredits(quoteSummary.creditsAvailable)} credits</div>
                      {quoteSummary.creditsApplied > 0 && (
                        <div className="text-shGreen">Uses {fmtCredits(quoteSummary.creditsApplied)} credits · after booking: {fmtCredits(quoteSummary.creditsRemainingAfter)} credits</div>
                      )}
                      {quoteSummary.coveredByCredits ? (
                        <div className="text-shGreen">Covered by credits · amount due today $0.00</div>
                      ) : quoteSummary.creditsApplied > 0 ? (
                        <div className="text-shOrange">Partial credits · estimated cash balance {fmtUSD(quoteSummary.cashDue)}</div>
                      ) : null}
                    </div>
                  )}

                  {quoteLines.length > 1 && (
                    <div className="text-[12px] text-gray-500 font-black uppercase tracking-widest" data-testid="admin-booking-estimate-line-count">
                      <i className="fas fa-calculator mr-1.5"/>{quoteLines.length} quoted line item{quoteLines.length === 1 ? "" : "s"} across selected dog/date entries.
                    </div>
                  )}

                  <p className="text-[11px] text-gray-500 leading-relaxed" data-testid="admin-booking-estimate-disclaimer">
                    Estimate only. Checkout can still adjust for credits, discounts, extra services, or manual admin changes.
                  </p>
                </div>
              ) : (
                <div className="text-[13px] text-gray-500 font-black uppercase tracking-widest" data-testid="admin-booking-estimate-empty">
                  Pick the client, dog, service, and date to see the estimate before creating the booking.
                </div>
              )}
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
