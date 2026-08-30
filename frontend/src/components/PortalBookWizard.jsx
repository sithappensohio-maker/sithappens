import { useEffect, useMemo, useState } from "react";
import { api, formatErr } from "../lib/api";
import MultiDatePicker from "./MultiDatePicker";
import { useEditLock } from "../lib/useLiveRefresh";
import { todayISO } from "../lib/date";
import BookingPriceEstimate from "./BookingPriceEstimate";
import StayPolicyNote from "./StayPolicyNote";
import PaymentOptionsCard from "./PaymentOptionsCard";
import PremiumButton from "./premium/PremiumButton";
import { accentRgb } from "./premium/tokens";
import { categorizeService, groupServicesByCategory, summarizeDescription } from "../lib/serviceCategories";

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

import { useFeature, useTheme } from "../lib/theme";

const SERVICE_OPTIONS = [
  { key: "daycare",     label: "Daycare",     icon: "fa-paw",          color: "bg-shGreen/15 text-shGreen border-shGreen/40", desc: "Drop-in day care" },
  { key: "boarding",    label: "Boarding",    icon: "fa-bed",          color: "bg-purple-500/15 text-purple-300 border-purple-500/40", desc: "Overnight stays" },
  { key: "training",    label: "Training",    icon: "fa-graduation-cap", color: "bg-shBlue/15 text-shBlue border-shBlue/40", desc: "1-on-1 session" },
  { key: "grooming",    label: "Grooming",    icon: "fa-bath",         color: "bg-pink-500/15 text-pink-300 border-pink-500/40", desc: "Bath, nail trim" },
  { key: "photography", label: "Photography", icon: "fa-camera",       color: "bg-amber-500/15 text-amber-300 border-amber-500/40", desc: "Portrait sessions" },
];

const TIME_SLOTTED = new Set(["training", "grooming", "photography"]);

// Simplified Step-1 service card, used inside a category's service list.
// Shows only a one-line summary by default; the full description (which for
// training services especially can run long) is opt-in via "View details" so
// it never turns the list into a wall of text.
function ServiceCard({ testId, selected, icon, label, summary, fullDesc, price, onSelect, accentR }) {
  const [expanded, setExpanded] = useState(false);
  const hasMore = fullDesc && fullDesc !== summary;
  return (
    <div data-testid={testId} onClick={onSelect} role="button" tabIndex={0}
         onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(); } }}
         className="text-left p-4 rounded-lg border transition min-w-0 cursor-pointer"
         style={{
           background: "var(--sh-card-base)",
           borderColor: selected ? `rgba(${accentR},0.8)` : "var(--sh-border)",
           boxShadow: selected ? `0 0 2px rgba(${accentR},0.7), 0 0 16px -6px rgba(${accentR},0.5)` : undefined,
         }}>
      <div className="flex items-start justify-between gap-2">
        <p className="font-bold text-[15px] break-words text-shText min-w-0">
          <i className={`fas ${icon} mr-2`} style={{ color: `rgb(${accentR})` }}/>{label}
        </p>
        {price != null && <span className="text-[13px] font-black text-shPrimary whitespace-nowrap shrink-0">${price.toFixed(2)}</span>}
      </div>
      {summary && <p className="text-[13px] mt-1.5 break-words text-shTextMuted">{summary}</p>}
      <div className="flex items-center justify-between mt-3 gap-2">
        {hasMore ? (
          <button type="button" data-testid={`${testId}-toggle`}
                  onClick={(e) => { e.stopPropagation(); setExpanded(v => !v); }}
                  className="text-[12px] font-black uppercase tracking-widest text-shSecondary hover:opacity-80">
            {expanded ? "Hide details" : "View details"}
          </button>
        ) : <span/>}
        <button type="button" data-testid={`${testId}-select`}
                onClick={(e) => { e.stopPropagation(); onSelect(); }}
                className="px-3 py-1.5 rounded text-[12px] font-black uppercase tracking-widest transition"
                style={{
                  background: selected ? `rgba(${accentR},0.2)` : "var(--sh-border)",
                  color: selected ? `rgb(${accentR})` : "var(--sh-text-muted)",
                }}>
          {selected ? <><i className="fas fa-check mr-1"/>Selected</> : "Select"}
        </button>
      </div>
      {expanded && hasMore && (
        <p className="text-[13px] mt-2 pt-2 border-t break-words text-shTextMuted" style={{ borderColor: "var(--sh-border)" }}>{fullDesc}</p>
      )}
    </div>
  );
}

export default function PortalBookWizard({ dogs, seed, onClose, onBooked }) {
  useEditLock(true);
  // Sprint 110di-17 — Feature Visibility. Service options the admin has
  // disabled are filtered out of the picker entirely so clients can't even
  // attempt to book them.
  const { branding } = useTheme();
  const featDaycare      = useFeature("daycare");
  const featBoarding     = useFeature("boarding");
  const featTraining     = useFeature("training");
  const featGrooming     = useFeature("grooming");
  const featPhotography  = useFeature("photography");
  const FEATURE_BY_SERVICE = useMemo(() => (
    { daycare: featDaycare, boarding: featBoarding, training: featTraining, grooming: featGrooming, photography: featPhotography }
  ), [featDaycare, featBoarding, featTraining, featGrooming, featPhotography]);
  const VISIBLE_SERVICES = useMemo(
    () => SERVICE_OPTIONS.filter(o => FEATURE_BY_SERVICE[o.key] !== false),
    [FEATURE_BY_SERVICE]
  );
  const [step, setStep] = useState(1);
  const [dogId, setDogId] = useState(seed?.dog_id || dogs?.[0]?.id || "");
  const [serviceType, setServiceType] = useState(seed?.service_type || "");
  const [serviceId, setServiceId] = useState(seed?.service_id || "");
  const [catalogServices, setCatalogServices] = useState([]);
  // Sprint 110an — add-ons eligible for the chosen base service.
  const [eligibleAddons, setEligibleAddons] = useState([]);
  const [selectedAddonIds, setSelectedAddonIds] = useState([]);
  const [date, setDate] = useState(todayISO());
  const [endDate, setEndDate] = useState("");
  const [time, setTime] = useState("");
  // Boarding drop-off / pickup TIMES. The estimate uses the configured
  // cutoff: before it is a half day; at/after it is a full day.
  // Sensible defaults match typical kennel hours so a
  // client who skips the picker still gets a reasonable estimate.
  const [dropoffTime, setDropoffTime] = useState("09:00");
  const [pickupTime, setPickupTime]  = useState("17:00");
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

  // Sprint 110di-38 — Multi-dog booking. The primary dog (`dogId`) is the
  // first member of the group; this state holds ADDITIONAL dogs the client
  // wants to add to the same booking. Same date + same service for all
  // (per product decision), but each dog can pick its own add-ons.
  // Shape: [{ dog_id: string, addon_service_ids: string[], notes?: string }]
  const [extraDogs, setExtraDogs] = useState([]);
  const addExtraDog = () => {
    const used = new Set([dogId, ...extraDogs.map(e => e.dog_id)]);
    const next = (dogs || []).find(d => !used.has(d.id));
    if (!next) return;  // No more dogs available
    setExtraDogs([...extraDogs, { dog_id: next.id, addon_service_ids: [], notes: "" }]);
  };
  const removeExtraDog = (idx) => {
    setExtraDogs(extraDogs.filter((_, i) => i !== idx));
  };
  const updateExtraDog = (idx, patch) => {
    setExtraDogs(extraDogs.map((e, i) => i === idx ? { ...e, ...patch } : e));
  };
  const toggleExtraAddon = (idx, addonId) => {
    const cur = extraDogs[idx].addon_service_ids || [];
    const next = cur.includes(addonId) ? cur.filter(x => x !== addonId) : [...cur, addonId];
    updateExtraDog(idx, { addon_service_ids: next });
  };

  // Date guard rails
  const minDate = todayISO();

  // Load the actual active service catalog. Booking rules are keyed to these
  // exact rows, so two services in the same category can behave differently.
  useEffect(() => {
    let cancelled = false;
    api.get("/services")
      .then(({ data }) => {
        if (cancelled) return;
        const rows = (Array.isArray(data) ? data : []).filter(s => s.active !== false && !s.is_addon);
        setCatalogServices(rows);
        // Runs once at mount (deps: []) — decide the initial selection purely
        // from the seed props, mirroring the state's own initial values
        // (serviceId/serviceType are seeded from `seed` and nothing else sets
        // them before this effect fires).
        if (seed?.service_id) {
          const selected = rows.find(s => s.id === seed.service_id);
          if (selected) setServiceType(selected.service_type);
        } else if (seed?.service_type) {
          const selected = rows.find(s => s.service_type === seed.service_type && s.is_default)
            || rows.find(s => s.service_type === seed.service_type);
          if (selected) setServiceId(selected.id);
        }
      })
      .catch(() => { if (!cancelled) setCatalogServices([]); });
    return () => { cancelled = true; };
  }, [seed]);

  const exactRuleMap = branding?.booking_flow_controls?.per_catalog_service || {};
  const bookableCatalogServices = catalogServices.filter(s => {
    if (FEATURE_BY_SERVICE[s.service_type] === false) return false;
    return exactRuleMap?.[s.id]?.client_booking_enabled !== false;
  });
  // Category-first Step 1 redesign — bucket the bookable catalog into
  // Daycare / Boarding / Group Classes / Private Training / Evaluations /
  // Board & Train / Grooming & Add-ons / Photography / Other Services
  // (see lib/serviceCategories.js for the pure categorization logic). A
  // category can be enabled (feature flag on) without having any catalog
  // row at all — e.g. Photography sold as one flat-rate service rather than
  // several named packages — so it falls back to its single coarse
  // VISIBLE_SERVICES tile instead of silently disappearing, same as before.
  const groupedByCategory = useMemo(() => (
    groupServicesByCategory(bookableCatalogServices, {
      featureByType: FEATURE_BY_SERVICE,
      fallbackTiles: catalogServices.length === 0 ? VISIBLE_SERVICES : [],
    })
  ), [bookableCatalogServices, FEATURE_BY_SERVICE, catalogServices.length, VISIBLE_SERVICES]);

  // Category-grid navigation. null = show the category cards; a key = show
  // only that category's services (with a back-to-categories control).
  const [activeCategoryKey, setActiveCategoryKey] = useState(null);
  const activeCategory = groupedByCategory.find(g => g.key === activeCategoryKey) || null;

  // If the wizard was opened pre-seeded with a service (a deep link from
  // elsewhere in the app), jump straight to that service's category once the
  // catalog has loaded, so the pre-selected service is visible instead of
  // landing on the blank category grid. Deliberately keyed on
  // `catalogServices` (not `activeCategoryKey`) so it only fires the one
  // time the catalog transitions from empty to loaded — manually going
  // "back" to the category grid afterward is never overridden by this.
  useEffect(() => {
    if (activeCategoryKey || !serviceType) return;
    const svc = serviceId ? catalogServices.find(s => s.id === serviceId) : null;
    setActiveCategoryKey(categorizeService(svc || { service_type: serviceType }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogServices]);

  // Load closed-dates list once so we can flag picks the business is closed.
  useEffect(() => {
    api.get("/settings/public")
       .then(r => {
         setClosedDates(Array.isArray(r.data?.closed_dates) ? r.data.closed_dates : []);
         const cutoff = r.data?.booking_rules?.boarding_full_day_pickup_cutoff;
         if (/^\d{2}:\d{2}$/.test(cutoff || "")) setPickupTime(cutoff);
       })
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
    api.get("/bookings/time-slots", { params: { date_str: date, service_type: serviceType, service_id: serviceId || undefined } })
       .then(r => { if (!cancelled) setSlots(r.data); })
       .catch(() => { if (!cancelled) setSlots(null); })
       .finally(() => { if (!cancelled) setSlotLoading(false); });
    return () => { cancelled = true; };
  }, [step, serviceType, serviceId, date]);

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
  const selectedCatalogService = useMemo(() => catalogServices.find(s => s.id === serviceId) || null, [catalogServices, serviceId]);
  const fallbackMeta = SERVICE_OPTIONS.find(s => s.key === serviceType);
  const svcMeta = selectedCatalogService ? {
    label: selectedCatalogService.name,
    icon: selectedCatalogService.icon || fallbackMeta?.icon || "fa-paw",
    color: fallbackMeta?.color || "bg-shBlue/15 text-shBlue border-shBlue/40",
    desc: selectedCatalogService.description || fallbackMeta?.desc || "",
  } : fallbackMeta;

  // Reset multi-date when service is not daycare (only daycare supports multi-date in portal).
  useEffect(() => {
    if (serviceType !== "daycare") {
      setIsMultiDate(false);
      setMultiDates([]);
    }
  }, [serviceType]);

  // Sprint 110di-26 — gate the estimate on Booking Flow Controls toggle.
  // Default ON; admin can disable via Settings → Booking Flow Controls.
  const showEstimate = branding?.booking_flow_controls?.show_price_estimate !== false;
  const featWaitlist = useFeature("waitlist");
  const waitlistEnabled =
    featWaitlist && (branding?.booking_flow_controls?.waitlist_on_capacity !== false);

  // Whether the chosen service will land on a waitlist (capacity issues etc).
  // Sprint 110di-28 — daycare ONLY: vaccine_ok && open_slots===0 && waitlist
  // feature enabled && bfc.waitlist_on_capacity. Drives both the proceed-gate
  // and the orange "this is full, you can waitlist" copy.
  const willWaitlist =
    serviceType === "daycare" &&
    avail && avail.vaccine_ok && avail.open_slots === 0 &&
    waitlistEnabled;

  const canProceedFromStep2 = useMemo(() => {
    if (isMultiDate && serviceType === "daycare") {
      return multiDates.length > 0;
    }
    if (!date) return false;
    if (dateIsClosed) return false;
    if (serviceType === "boarding") {
      // Sprint 110di-28 — zero-night bookings are not bookings. Pickup must
      // be STRICTLY AFTER drop-off. (Same-day "boarding" is really daycare
      // and should be booked through that flow.)
      if (!endDate || endDate <= date) return false;
      if (endDateIsClosed) return false;
      return true;
    }
    if (TIME_SLOTTED.has(serviceType)) return !!time;
    if (serviceType === "daycare") {
      if (!avail || !avail.vaccine_ok) return false;
      // Sprint 110di-28 — allow the client to advance when capacity is full
      // ONLY if the admin has turned waitlist on. Without that, this guard
      // matches the old behaviour (need an open slot).
      if (avail.open_slots > 0) return true;
      return waitlistEnabled;
    }
    return true;
  }, [serviceType, date, endDate, time, avail, dateIsClosed, endDateIsClosed, isMultiDate, multiDates, waitlistEnabled]);

  // Sprint 110di-29 — Acknowledgement step. Holds the just-submitted
  // summary so step 4 can render payment options without re-fetching.
  const [acknowledgement, setAcknowledgement] = useState(null);

  const submitWaitlist = async (dogIds) => {
    const uniqueDogIds = [...new Set((dogIds || []).filter(Boolean))];
    const rows = await Promise.all(uniqueDogIds.map(id => api.post("/waitlist", {
      dog_id: id,
      service_type: serviceType,
      service_id: serviceId || undefined,
      requested_date: date,
      requested_end_date: serviceType === "boarding" ? endDate : date,
      time: TIME_SLOTTED.has(serviceType) ? time : "",
      dropoff_time: serviceType === "boarding" ? dropoffTime : "",
      pickup_time: serviceType === "boarding" ? pickupTime : "",
      addon_service_ids: selectedAddonIds,
      notes,
    })));
    return rows.map(r => r.data);
  };

  const book = async () => {
    setErr(""); setSubmitting(true);
    try {
      if (isMultiDate && serviceType === "daycare") {
        const { data } = await api.post("/bookings/multi-dates", {
          dog_id: dogId,
          dates: multiDates,
          service_type: "daycare",
          service_id: serviceId || undefined,
          notes,
          addon_service_ids: selectedAddonIds,
          waitlist_on_capacity: waitlistEnabled,
        });
        const c = data.created?.length || 0;
        const s = data.skipped?.length || 0;
        const w = (data.skipped || []).filter(x => x.waitlisted).length;
        if (c === 0 && w === 0) {
          const reasonText = (data.skipped || []).slice(0,3).map(x => {
            const r = typeof x.reason === "object" ? (x.reason.display_message || x.reason.message || "Unavailable") : x.reason;
            return `${x.date} (${r})`;
          }).join("; ");
          setErr(`No bookings created — all ${s} day(s) were skipped: ${reasonText}${s>3?"…":""}`);
          setSubmitting(false);
          return;
        }
        // Refresh parent in background but keep wizard open on step 4.
        onBooked && onBooked({ summary: `${c} booking${c===1?"":"s"} submitted${s?`, ${s} skipped`:""}`, skipped: data.skipped, keepOpen: true });
        setAcknowledgement({
          kind: "multi",
          count: c, skipped: s, waitlist_count: w,
          waitlisted: w > 0 && c === 0,
        });
        setStep(4);
        setSubmitting(false);
        return;
      }
      const body = {
        dog_id: dogId,
        date,
        service_type: serviceType,
        service_id: serviceId || undefined,
        notes,
        addon_service_ids: selectedAddonIds,
      };
      if (serviceType === "boarding") {
        body.end_date = endDate;
        body.dropoff_time = dropoffTime;
        body.pickup_time  = pickupTime;
      }
      if (TIME_SLOTTED.has(serviceType)) body.time = time;
      if (serviceType === "grooming") body.grooming_type = groomingType;

      // Availability is advisory; save real waitlist rows when already full.
      if (willWaitlist) {
        const waitRows = await submitWaitlist([dogId, ...extraDogs.map(e => e.dog_id)]);
        onBooked && onBooked({ keepOpen: true });
        setAcknowledgement({ kind: "waitlist", count: waitRows.length, waitlisted: true, waitlist_rows: waitRows });
        setStep(4);
        return;
      }

      // Sprint 110di-38 — Multi-dog branch. When the user has added one or
      // more extra dogs to the same booking, ship the group endpoint so all
      // rows share one group_id (and so partial-failure rolls back atomically
      // on the server). The single-dog branch below stays untouched.
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
          service_type: serviceType,
          service_id: serviceId || undefined,
          notes,
        };
        if (serviceType === "boarding") {
          groupBody.end_date = endDate;
          groupBody.dropoff_time = dropoffTime;
          groupBody.pickup_time  = pickupTime;
        }
        if (TIME_SLOTTED.has(serviceType)) groupBody.time = time;
        if (serviceType === "grooming") groupBody.grooming_type = groomingType;
        const { data: groupResp } = await api.post("/bookings/group", groupBody);
        onBooked && onBooked({ keepOpen: true });
        setAcknowledgement({
          kind: "group",
          group_id: groupResp.group_id,
          count: (groupResp.bookings || []).length,
          bookings: groupResp.bookings || [],
          booking: (groupResp.bookings || [])[0] || null,
          waitlisted: !!willWaitlist,
        });
        setStep(4);
        return;
      }

      const { data: created } = await api.post("/bookings", body);
      onBooked && onBooked({ keepOpen: true });
      setAcknowledgement({
        kind: "single",
        booking: created || null,
        waitlisted: !!willWaitlist,
      });
      setStep(4);
    } catch (e) {
      const detail = e.response?.data?.detail;
      const capacity = e.response?.data?.capacity;
      if (capacity?.code === "capacity_full" && capacity?.waitlist_allowed && waitlistEnabled) {
        try {
          const waitRows = await submitWaitlist([dogId, ...extraDogs.map(x => x.dog_id)]);
          onBooked && onBooked({ keepOpen: true });
          setAcknowledgement({ kind: "waitlist", count: waitRows.length, waitlisted: true, waitlist_rows: waitRows });
          setStep(4);
          return;
        } catch (waitErr) {
          setErr(formatErr(waitErr.response?.data?.detail) || "The opening was taken and the waitlist request could not be saved.");
          return;
        }
      }
      setErr(formatErr(detail) || "Booking failed");
    } finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 z-[80] bg-black/80 flex items-center justify-center p-2 sm:p-4" onClick={onClose} data-testid="portal-book-wizard">
      <div className="border border-shBorder shadow-sh rounded-xl max-w-2xl w-full max-h-[calc(var(--app-height)_-_1.5rem)] overflow-y-auto overflow-x-hidden p-4 sm:p-6 space-y-5"
           style={{ background: "var(--sh-card-base)" }} onClick={(e)=>e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-xl font-bold text-shText tracking-tight">
              <i className="fas fa-calendar-plus text-shSecondary mr-2"/>Book a Service
            </h3>
            <p className="text-[13px] font-semibold text-shTextMuted uppercase tracking-widest mt-1">
              Step {step} of 3 · {step===1?"Pick service":step===2?"Pick date & time":"Review & confirm"}
            </p>
          </div>
          <button onClick={onClose} className="text-shTextMuted hover:text-shText text-xl"><i className="fas fa-times"/></button>
        </div>

        {/* Progress bar */}
        <div className="grid grid-cols-3 gap-2">
          {[1,2,3].map(i => (
            <div key={i} className={`h-1 rounded-full ${i<=step?"bg-shSecondary":"bg-shBorder"}`}/>
          ))}
        </div>

        {/* STEP 1 */}
        {step === 1 && (
          <div className="space-y-4">
            {dogs.length > 1 && (
              <div>
                <label className="text-[13px] uppercase tracking-widest text-gray-500 font-black">For which dog?</label>
                <select value={dogId} onChange={(e)=>setDogId(e.target.value)} data-testid="wiz-dog"
                        style={{ background: "var(--sh-card-base)" }}
                        className="w-full mt-1 border border-shBorder rounded p-2 text-shText text-sm focus:outline-none focus:border-shSecondary/60">
                  {dogs.map(d => <option key={d.id} value={d.id}>{d.name} ({d.breed || "—"})</option>)}
                </select>
              </div>
            )}
            <div>
              {!activeCategory ? (
                <>
                  <label className="text-[13px] uppercase tracking-widest text-gray-500 font-black">Choose a category</label>
                  {groupedByCategory.length === 0 ? (
                    <div className="mt-2 bg-shAccent/10 border border-shAccent/30 rounded-lg p-4 text-shAccent text-[13px] font-bold uppercase tracking-widest text-center">
                      No services are currently open for client booking.
                    </div>
                  ) : (
                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-3" data-testid="wiz-category-grid">
                      {groupedByCategory.map(g => (
                        <button key={g.key} type="button" onClick={() => setActiveCategoryKey(g.key)}
                                data-testid={`wiz-cat-${g.key}`}
                                className="text-left p-4 rounded-lg border transition flex items-center gap-3 hover:border-shSecondary/60 min-w-0"
                                style={{ background: "var(--sh-card-base)", borderColor: "var(--sh-border)" }}>
                          <div className={`w-11 h-11 rounded-lg grid place-items-center shrink-0 border ${g.meta.color}`}>
                            <i className={`fas ${g.meta.icon} text-lg`}/>
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="font-bold text-[15px] text-shText leading-snug">{g.meta.label}</p>
                            <p className="text-[12px] text-shTextMuted">{g.items.length} option{g.items.length === 1 ? "" : "s"}</p>
                          </div>
                          <i className="fas fa-chevron-right text-shTextMuted shrink-0"/>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div data-testid="wiz-category-services">
                  <div className="flex items-center justify-between mb-2">
                    <button type="button" onClick={() => setActiveCategoryKey(null)} data-testid="wiz-back-to-categories"
                            className="text-[13px] font-black uppercase tracking-widest text-shSecondary hover:opacity-80">
                      <i className="fas fa-arrow-left mr-1.5"/>All Categories
                    </button>
                    <span className="text-[13px] font-black uppercase tracking-widest text-shTextMuted">
                      <i className={`fas ${activeCategory.meta.icon} mr-1.5`}/>{activeCategory.meta.label}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {activeCategory.items.map(s => {
                      const isCatalog = !!s.id;
                      const type = isCatalog ? s.service_type : s.key;
                      const fallback = SERVICE_OPTIONS.find(o => o.key === type);
                      const selected = isCatalog ? serviceId === s.id : (!serviceId && serviceType === type);
                      const label = isCatalog ? s.name : s.label;
                      const fullDesc = isCatalog ? (s.description || fallback?.desc || "") : (s.desc || "");
                      const summary = summarizeDescription(fullDesc);
                      const icon = isCatalog ? (s.icon || fallback?.icon || "fa-paw") : s.icon;
                      const accentR = accentRgb("cyan");
                      const testId = `wiz-svc-${isCatalog ? s.id : s.key}`;
                      const pick = () => {
                        setServiceId(isCatalog ? s.id : "");
                        setServiceType(type);
                        if (isCatalog && type === "grooming") {
                          const marker = `${s.slug || ""} ${s.name || ""}`.toLowerCase();
                          setGroomingType(marker.includes("nail") ? "nail_trim" : "bath");
                        }
                      };
                      return (
                        <ServiceCard key={isCatalog ? s.id : s.key} testId={testId} selected={selected}
                                     icon={icon} label={label} summary={summary} fullDesc={fullDesc}
                                     price={isCatalog ? Number(s.base_price || 0) : null} onSelect={pick}
                                     accentR={accentR} />
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-3">
              <PremiumButton variant="secondary" onClick={onClose}>Cancel</PremiumButton>
              <PremiumButton variant="cyan" onClick={()=>setStep(2)} disabled={!serviceType || !dogId} data-testid="wiz-step1-next">
                Next <i className="fas fa-arrow-right"/>
              </PremiumButton>
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
                  <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[13px] uppercase tracking-widest text-gray-500 font-black">Drop-off date</label>
                      <input type="date" value={date} min={minDate} onChange={(e)=>{
                          const newDate = e.target.value;
                          setDate(newDate);
                          // Sprint 110di-30 — when drop-off changes, auto-bump
                          // pickup forward if it's no longer a valid (strictly
                          // after) value. Same-day drop-off is fine; the
                          // zero-night case is what we guard against.
                          if (newDate && endDate && endDate <= newDate) setEndDate("");
                        }} style={{colorScheme:"dark", background:"var(--sh-card-base)"}}
                             className="w-full mt-1 border border-shBorder rounded p-2 text-shText text-sm focus:outline-none focus:border-shSecondary/60" data-testid="wiz-date" />
                      <p className="text-[11px] text-gray-500 mt-1">Same-day drop-off is fine.</p>
                    </div>
                    <div>
                      {/* Sprint 110di-30 — pickup picker `min` is drop-off+1
                          so the OS-level date control already prevents the
                          zero-night selection that used to fall through to
                          a confusing client-side validation error. */}
                      <label className="text-[13px] uppercase tracking-widest text-gray-500 font-black">Pickup date</label>
                      <input type="date" value={endDate}
                             min={date ? (new Date(date + "T12:00:00").getTime() + 86400000 > 0
                                  ? new Date(new Date(date + "T12:00:00").getTime() + 86400000).toISOString().slice(0,10)
                                  : date) : minDate}
                             onChange={(e)=>setEndDate(e.target.value)} style={{colorScheme:"dark", background:"var(--sh-card-base)"}}
                             className="w-full mt-1 border border-shBorder rounded p-2 text-shText text-sm focus:outline-none focus:border-shSecondary/60" data-testid="wiz-end" />
                      <p className="text-[11px] text-gray-500 mt-1">Must be after drop-off (at least 1 night).</p>
                    </div>
                  </div>
                  {/* Sprint 110di-31 — Drop-off and pickup TIMES. Feed the
                      existing half-day pricing rule so an early pickup
                      doesn't get charged a full extra day. The estimate
                      panel computes units from these + booking_rules. */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-1">
                    <div>
                      <label className="text-[13px] uppercase tracking-widest text-gray-500 font-black">Drop-off time</label>
                      <input type="time" value={dropoffTime} onChange={(e)=>setDropoffTime(e.target.value)}
                             style={{colorScheme:"dark", background:"var(--sh-card-base)"}}
                             className="w-full mt-1 border border-shBorder rounded p-2 text-shText text-sm focus:outline-none focus:border-shSecondary/60"
                             data-testid="wiz-dropoff-time" />
                    </div>
                    <div>
                      <label className="text-[13px] uppercase tracking-widest text-gray-500 font-black">Pickup time</label>
                      <input type="time" value={pickupTime} onChange={(e)=>setPickupTime(e.target.value)}
                             style={{colorScheme:"dark", background:"var(--sh-card-base)"}}
                             className="w-full mt-1 border border-shBorder rounded p-2 text-shText text-sm focus:outline-none focus:border-shSecondary/60"
                             data-testid="wiz-pickup-time" />
                    </div>
                  </div>
                  {/* Policy block + live late-pickup warning, generated from the
                      same settings the pricing engine charges with — the client
                      sees any late-pickup cost BEFORE confirming. */}
                  <div className="mt-2">
                    <StayPolicyNote serviceType="boarding" pickupTime={pickupTime} testid="wiz-boarding-policy" />
                  </div>
                  </>
                )}

                {/* Daycare or time-slotted: single date */}
                {serviceType !== "boarding" && (
                  <div>
                    <label className="text-[13px] uppercase tracking-widest text-gray-500 font-black">Date</label>
                    <input type="date" value={date} min={minDate} onChange={(e)=>setDate(e.target.value)} style={{colorScheme:"dark", background:"var(--sh-card-base)"}}
                           className="w-full mt-1 border border-shBorder rounded p-2 text-shText text-sm focus:outline-none focus:border-shSecondary/60" data-testid="wiz-date" />
                    {serviceType === "daycare" && (
                      <div className="mt-2">
                        <StayPolicyNote serviceType="daycare" compact testid="wiz-daycare-policy" />
                      </div>
                    )}
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
              <div className={`text-[14px] font-black uppercase tracking-widest p-3 rounded text-center ${!avail.vaccine_ok?"bg-red-500/15 text-red-400":avail.open_slots<=0?"bg-shOrange/15 text-shOrange":"bg-shGreen/10 text-shGreen"}`}
                   data-testid="wiz-daycare-availability">
                {!avail.vaccine_ok ? "Rabies missing/expired"
                  : avail.open_slots <= 0
                    ? (waitlistEnabled
                        ? "This date is full, but you can request the waitlist."
                        : "Fully booked")
                  : `${avail.open_slots} of ${avail.capacity} daycare spots open`}
              </div>
            )}

            {/* Grooming type */}
            {serviceType === "grooming" && !serviceId && (
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
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 max-h-56 overflow-y-auto p-1">
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
                            {s.available && Number(s.capacity || 1) > 1 && (
                              <span className="block text-[10px] opacity-70 mt-0.5">{s.seats_left} spot{s.seats_left===1?"":"s"} left</span>
                            )}
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
                Hidden when the base service has no add-ons configured.
                Sprint 110di-39 — When extra dogs are added, the header
                explicitly names which dog this picker is for so customers
                don't think the addons apply to everyone. */}
            {eligibleAddons.length > 0 && (
              <div data-testid="portal-addons-picker">
                <label className="text-[13px] uppercase tracking-widest text-amber-400 font-black">
                  <i className="fas fa-plus-circle mr-1"/>
                  {extraDogs.length > 0
                    ? `Add-ons for ${(dogs || []).find(d=>d.id===dogId)?.name || "this dog"} (optional)`
                    : "Add a little extra (optional)"}
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
                        style={{ background: "var(--sh-card-base)" }}
                        className="w-full mt-1 border border-shBorder rounded p-2 text-shText text-sm focus:outline-none focus:border-shSecondary/60 resize-none" />
            </div>

            <div className="flex justify-between gap-2 pt-3">
              <PremiumButton variant="secondary" onClick={()=>setStep(1)}>
                <i className="fas fa-arrow-left"/>Back
              </PremiumButton>
              <PremiumButton variant="cyan" onClick={()=>setStep(3)} disabled={!canProceedFromStep2} data-testid="wiz-step2-next">
                Review <i className="fas fa-arrow-right"/>
              </PremiumButton>
            </div>
          </div>
        )}

        {/* STEP 3 */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="border border-shBorder rounded-lg p-4 space-y-2 text-[15px]" style={{ background: "var(--sh-card-base)" }}>
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

            {/* Sprint 110di-38 — Multi-dog group booking. Same date + same
                service for every dog; per-dog add-ons. Hidden when the user
                only has one dog on their profile, or when multi-date daycare
                mode is active (that branch already books N days × 1 dog and
                we don't want to combine the two complexities). */}
            {(dogs || []).length > 1 && !(isMultiDate && serviceType === "daycare") && (
              <div className="border border-shBorder rounded-lg p-4 space-y-3" style={{ background: "var(--sh-card-base)" }} data-testid="wiz-multidog">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-shGreen font-black uppercase tracking-widest text-[13px]"><i className="fas fa-paw mr-1.5"/>More dogs on this booking?</p>
                    <p className="text-gray-400 text-[15px] mt-0.5">Add another dog to share the same date and service. Each dog can pick their own add-ons.</p>
                  </div>
                  {extraDogs.length + 1 < (dogs || []).length && (
                    <button onClick={addExtraDog} data-testid="wiz-add-dog"
                            className="bg-shGreen/20 border border-shGreen/40 text-shGreen px-3 py-1.5 rounded text-[13px] font-black uppercase tracking-widest hover:bg-shGreen/30 transition whitespace-nowrap">
                      <i className="fas fa-plus mr-1"/>Add dog
                    </button>
                  )}
                </div>

                {extraDogs.map((extra, idx) => {
                  const xDog = (dogs || []).find(d => d.id === extra.dog_id);
                  // Other dogs already in this group (so we don't show duplicates in the dropdown)
                  const usedIds = new Set([dogId, ...extraDogs.map((e, i) => i !== idx ? e.dog_id : null).filter(Boolean)]);
                  const available = (dogs || []).filter(d => !usedIds.has(d.id));
                  return (
                    <div key={idx} className="border-t border-bgHover pt-3 space-y-2" data-testid={`wiz-extra-dog-${idx}`}>
                      <div className="flex gap-2 items-center">
                        <select value={extra.dog_id}
                                onChange={(e)=>updateExtraDog(idx, { dog_id: e.target.value, addon_service_ids: [] })}
                                data-testid={`wiz-extra-dog-select-${idx}`}
                                className="flex-1 bg-bgPanel border border-bgHover rounded p-2 text-white text-[13px]">
                          {available.map(d => (
                            <option key={d.id} value={d.id}>{d.name}</option>
                          ))}
                        </select>
                        <button onClick={()=>removeExtraDog(idx)} data-testid={`wiz-remove-dog-${idx}`}
                                className="bg-red-500/15 border border-red-500/40 text-red-300 px-2 py-2 rounded text-[13px] font-black hover:bg-red-500/25 transition"
                                title="Remove this dog">
                          <i className="fas fa-times"/>
                        </button>
                      </div>
                      {eligibleAddons.length > 0 && (
                        <div className="pt-1">
                          <p className="text-[12px] font-black uppercase tracking-widest text-amber-400 mb-2">
                            <i className="fas fa-plus-circle mr-1"/>Add-ons for {xDog?.name || "this dog"} (optional)
                          </p>
                          <div className="space-y-2">
                            {eligibleAddons.map(a => {
                              const on = (extra.addon_service_ids || []).includes(a.id);
                              return (
                                <button key={a.id} type="button"
                                        onClick={()=>toggleExtraAddon(idx, a.id)}
                                        data-testid={`wiz-extra-addon-${idx}-${a.id}`}
                                        className={`w-full flex items-center gap-3 p-3 rounded-lg border transition text-left ${
                                          on
                                            ? "bg-amber-500/15 border-amber-500/60"
                                            : "bg-bgBase/40 border-bgHover hover:border-amber-500/40"
                                        }`}>
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

                {extraDogs.length === 0 && (
                  <p className="text-gray-500 text-[14px] italic">No additional dogs yet.</p>
                )}
                {extraDogs.length > 0 && (
                  <p className="text-shGreen text-[13px] font-black uppercase tracking-widest pt-1" data-testid="wiz-group-count">
                    <i className="fas fa-link mr-1"/>This booking will cover {extraDogs.length + 1} dogs.
                  </p>
                )}
              </div>
            )}

            {err && <div className="text-[15px] font-black p-3 rounded uppercase tracking-widest bg-red-500/15 text-red-400 text-center">{err}</div>}

            {/* Sprint 110di-26 — Live booking estimate. Gated on the admin
                toggle in Booking Flow Controls (default ON). Uses the
                existing services catalog + client's credit balance —
                does NOT auto-consume credits, does NOT process payment. */}
            {showEstimate && (
              <BookingPriceEstimate
                serviceType={serviceType}
                serviceId={serviceId}
                dogCount={1 + extraDogs.length}
                date={date}
                endDate={endDate}
                primaryDogId={dogId}
                multiDates={multiDates}
                isMultiDate={isMultiDate}
                isWaitlist={!!willWaitlist}
                addons={(() => {
                  // Aggregate add-ons across all dogs so the combined estimate
                  // reflects what every dog has selected (per-dog add-ons,
                  // single combined total — per product decision).
                  const allIds = [
                    ...selectedAddonIds,
                    ...extraDogs.flatMap(e => e.addon_service_ids || []),
                  ];
                  // Each entry in addonsForEstimate represents one dog's pick.
                  // Don't dedupe — the same addon picked by 2 dogs costs 2×.
                  const addonsForEstimate = [];
                  selectedAddonIds.forEach(id => {
                    const a = eligibleAddons.find(x => x.id === id);
                    if (a) addonsForEstimate.push(a);
                  });
                  extraDogs.forEach(ed => {
                    (ed.addon_service_ids || []).forEach(id => {
                      const a = eligibleAddons.find(x => x.id === id);
                      if (a) addonsForEstimate.push(a);
                    });
                  });
                  return addonsForEstimate.length > 0 ? addonsForEstimate
                    : eligibleAddons.filter(a => allIds.includes(a.id));
                })()}
                addonsPerDog={extraDogs.length > 0}
                dropoffTime={dropoffTime}
                pickupTime={pickupTime}
              />
            )}

            <p className="text-[14px] text-gray-500 text-center">Your booking will be reviewed and approved by Sit Happens.</p>

            <div className="flex justify-between gap-2 pt-3">
              <PremiumButton variant="secondary" onClick={()=>setStep(2)}>
                <i className="fas fa-arrow-left"/>Back
              </PremiumButton>
              <PremiumButton variant="primary" onClick={book} disabled={submitting} data-testid="wiz-confirm">
                {submitting ? "Booking…"
                  : (isMultiDate && serviceType==="daycare"
                      ? `Submit ${multiDates.length} booking${multiDates.length===1?"":"s"}`
                      : extraDogs.length > 0
                        ? `Confirm booking · ${1 + extraDogs.length} dogs`
                        : "Confirm booking")}
              </PremiumButton>
            </div>
          </div>
        )}

        {/* Sprint 110di-29 — Step 4 / Acknowledgement. Shows the booking
            confirmation + any payment options the operator has enabled.
            Payment is optional; booking is already submitted. */}
        {step === 4 && acknowledgement && (
          <div className="space-y-4" data-testid="wiz-step4-ack">
            <div className="text-center">
              <div className={`mx-auto w-14 h-14 rounded-full flex items-center justify-center ${acknowledgement.waitlisted ? "bg-shOrange/20" : "bg-shGreen/20"}`}>
                <i className={`fas ${acknowledgement.waitlisted ? "fa-hourglass-half text-shOrange" : "fa-circle-check text-shGreen"} text-2xl`}/>
              </div>
              <h2 className="text-xl font-black uppercase tracking-tight text-white mt-3">
                {acknowledgement.waitlisted ? "Waitlist request submitted" : "Booking submitted!"}
              </h2>
              <p className="text-[13px] text-gray-400 mt-1">
                {acknowledgement.kind === "multi"
                  ? `${acknowledgement.count} booking${acknowledgement.count===1?"":"s"} sent for review${acknowledgement.waitlist_count?`, ${acknowledgement.waitlist_count} added to waitlist`:""}${acknowledgement.skipped && acknowledgement.skipped !== acknowledgement.waitlist_count?`, ${acknowledgement.skipped - (acknowledgement.waitlist_count || 0)} skipped`:""}.`
                  : acknowledgement.kind === "group"
                    ? `${acknowledgement.count} dog${acknowledgement.count===1?"":"s"} booked together · we'll review and confirm shortly.`
                    : (acknowledgement.waitlisted
                        ? "We'll let you know when a spot opens up."
                        : "We'll review and confirm your spot shortly.")}
              </p>
            </div>

            <PaymentOptionsCard compact />

            <div className="flex justify-end">
              <PremiumButton variant="primary" onClick={onClose} data-testid="wiz-done">
                Done
              </PremiumButton>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
