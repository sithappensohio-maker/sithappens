import { useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import { api, formatErr } from "../lib/api";
import PageHero from "../components/PageHero";
import { useLiveRefresh } from "../lib/useLiveRefresh";
import BookingDetailModal from "../components/BookingDetailModal";

function isoOnly(d) { return d.toISOString().split("T")[0]; }
function isMobile() {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
}

/** Cute service color chips, kept in sync with the calendar palette. */
const SVC_META = {
  daycare: { color: "bg-shGreen/25 text-shGreen border-shGreen/50", label: "Daycare" },
  boarding: { color: "bg-shBlue/25 text-shBlue border-shBlue/50", label: "Boarding" },
  training: { color: "bg-purple-500/25 text-purple-300 border-purple-500/50", label: "Training" },
  grooming: { color: "bg-pink-500/25 text-pink-300 border-pink-500/50", label: "Grooming" },
  photography: { color: "bg-amber-500/25 text-amber-300 border-amber-500/50", label: "Photography" },
};

function pretty(iso) {
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  } catch { return iso; }
}

export default function Schedule() {
  const [events, setEvents] = useState([]);
  const [msg, setMsg] = useState("");
  const [mobile, setMobile] = useState(isMobile());
  // Selected date → opens a Day Roster modal listing every booking that day
  // and a "New appointment" CTA. This is the headline reason for the click.
  const [dayOpen, setDayOpen] = useState(null);
  // New-booking flow — basic admin form (more options live on the Bookings
  // screen for advanced needs).
  const [newBooking, setNewBooking] = useState(null); // {date} or null
  const [bookErr, setBookErr] = useState("");
  const [bookSaving, setBookSaving] = useState(false);
  const [dogs, setDogs] = useState([]);
  // Map of client_id → { credits, training_credits, boarding_credits } so the
  // day roster can show a "credits available" chip next to each dog.
  const [clientBalById, setClientBalById] = useState({});
  const calRef = useRef(null);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const handler = (e) => setMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const load = async () => {
    try { const { data } = await api.get("/events"); setEvents(data); } catch (e) { console.warn("events load failed", e); }
  };
  const loadDogs = async () => {
    try { const { data } = await api.get("/dogs"); setDogs(data); } catch (e) { console.warn("dogs load failed", e); }
  };
  const loadClients = async () => {
    try {
      const { data } = await api.get("/clients");
      const map = {};
      (data || []).forEach(c => {
        map[c.id] = {
          credits: c.credits || 0,
          training_credits: c.training_credits || 0,
          boarding_credits: c.boarding_credits || 0,
        };
      });
      setClientBalById(map);
    } catch (e) { console.warn("clients load failed", e); }
  };
  useEffect(() => { load(); loadDogs(); loadClients(); }, []);
  // Sprint 110ao — replaced bespoke focus-refresh with the shared
  // useLiveRefresh hook (30s polling + focus refresh + edit-lock aware).
  useLiveRefresh(load, { intervalMs: 30_000 });

  const onDrop = async (info) => {
    const newStart = isoOnly(info.event.start);
    const endEx = info.event.end ? new Date(info.event.end.getTime() - 86400000) : null;
    const endIncl = endEx ? isoOnly(endEx) : null;
    try {
      await api.put(`/bookings/${info.event.id}/reschedule`, { date: newStart, end_date: endIncl });
      setMsg(`Rescheduled to ${newStart}`);
      setTimeout(()=>setMsg(""), 2500);
      load();
    } catch (e) {
      info.revert();
      setMsg(formatErr(e.response?.data?.detail) || "Reschedule failed");
      setTimeout(()=>setMsg(""), 3000);
    }
  };

  // Day-cell click handler. FullCalendar gives us a Date — we want ISO.
  const onDateClick = (info) => {
    setDayOpen(info.dateStr); // e.g. "2026-05-25"
  };

  // Bookings that fall on the selected day — boarding spans need range-check.
  const [detailId, setDetailId] = useState(null); // booking-detail modal target
  const dayBookings = useMemo(() => {
    if (!dayOpen) return [];
    const rows = events.filter((e) => {
      const start = (e.start || "").slice(0, 10);
      // FullCalendar end is exclusive — convert back.
      let endIncl = start;
      if (e.end) {
        try {
          const end = new Date(e.end);
          end.setDate(end.getDate() - 1);
          endIncl = end.toISOString().slice(0, 10);
        } catch {}
      }
      return dayOpen >= start && dayOpen <= endIncl;
    });
    // Order: timed first (training/grooming), then all-day.
    return rows.sort((a, b) => {
      const at = a.extendedProps?.time || "";
      const bt = b.extendedProps?.time || "";
      if (at && bt) return at.localeCompare(bt);
      if (at) return -1;
      if (bt) return 1;
      return (a.title || "").localeCompare(b.title || "");
    });
  }, [events, dayOpen]);

  const startNewBooking = () => {
    setBookErr("");
    setNewBooking({
      date: dayOpen,
      dog_id: dogs[0]?.id || "",
      service_type: "daycare",
      end_date: dayOpen,
      time: "",
      grooming_type: "bath",
      notes: "",
    });
  };

  const saveBooking = async () => {
    setBookErr(""); setBookSaving(true);
    try {
      const payload = { ...newBooking };
      // Only boarding uses end_date; everything else is a single day.
      if (payload.service_type !== "boarding") delete payload.end_date;
      // Only grooming uses grooming_type.
      if (payload.service_type !== "grooming") delete payload.grooming_type;
      // Only training/grooming use time.
      if (!["training", "grooming"].includes(payload.service_type)) delete payload.time;
      await api.post("/bookings", payload);
      setNewBooking(null);
      await load();
    } catch (e) {
      setBookErr(formatErr(e.response?.data?.detail) || "Save failed");
    } finally {
      setBookSaving(false);
    }
  };

  return (
    <div className="h-full flex flex-col gap-4 animate-slide-in" data-testid="schedule-calendar">
      <PageHero
        eyebrow={{ icon: "fa-mouse-pointer", text: "Schedule · drag to reschedule", color: "text-shBlue" }}
        title="The Calendar."
        highlight="Every pup. Every day."
        subtitle="Drag any event to reschedule. Click a day to see the full roster."
        right={msg ? (<span className="bg-shGreen/15 text-shGreen border border-shGreen/30 text-[12px] font-black uppercase tracking-widest px-3 py-2 rounded">{msg}</span>) : null}
        testid="schedule-hero"
      />
      <div className="flex-1 bg-bgPanel p-2 sm:p-4 rounded-xl border border-bgHover overflow-hidden">
        <FullCalendar
          ref={calRef}
          plugins={[dayGridPlugin, interactionPlugin]}
          initialView={mobile ? "dayGridWeek" : "dayGridMonth"}
          height="100%"
          events={events}
          editable={true}
          eventStartEditable={true}
          eventDurationEditable={true}
          eventDrop={onDrop}
          eventResize={onDrop}
          dateClick={onDateClick}
          // Clicking an event chip opens the detail modal (notes, payment, etc.).
          // Stop FullCalendar from also bubbling up to dateClick.
          eventClick={(info) => { info.jsEvent?.preventDefault(); setDetailId(info.event.id); }}
          // Training/grooming/photography events have specific times — display them
          displayEventTime={true}
          eventTimeFormat={{ hour: "numeric", minute: "2-digit", meridiem: "short" }}
          // Force timed events (training/grooming/photography) to render as
          // solid colored blocks like daycare/boarding, instead of FullCalendar's
          // default "dot + time text" list-item style which made them look like
          // plain text rows on the calendar grid.
          eventDisplay="block"
          headerToolbar={mobile
            ? { left: "prev,next", center: "title", right: "today" }
            : { left: "prev,next today", center: "title", right: "" }}
          titleFormat={mobile ? { month: "short", year: "2-digit" } : undefined}
        />
      </div>

      {detailId && (
        <BookingDetailModal booking={{ id: detailId }}
                            onClose={()=>setDetailId(null)}
                            onJumpToDog={(dogId)=>{ window.location.hash = `#/dogs?dogId=${dogId}`; setDetailId(null); }} />
      )}

      {dayOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm grid place-items-center p-3 sm:p-6 animate-fade-in"
             onClick={()=>{ setDayOpen(null); setNewBooking(null); }}
             data-testid="day-roster-modal">
          <div onClick={(e)=>e.stopPropagation()}
               className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-xl shadow-2xl max-h-[92vh] overflow-y-auto">
            <div className="sticky top-0 bg-bgPanel border-b border-bgHover px-5 py-4 flex items-center justify-between gap-3 z-10">
              <div className="min-w-0">
                <p className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Day Roster</p>
                <h2 className="text-lg font-black uppercase italic text-white tracking-tight truncate">{pretty(dayOpen)}</h2>
              </div>
              <button onClick={()=>{ setDayOpen(null); setNewBooking(null); }}
                      data-testid="day-roster-close" className="text-gray-500 hover:text-white">
                <i className="fas fa-xmark text-xl"/>
              </button>
            </div>

            <div className="p-5 space-y-4">
              {!newBooking && (
                <>
                  {dayBookings.length === 0 ? (
                    <div className="bg-bgBase border border-dashed border-bgHover rounded-lg p-8 text-center" data-testid="day-roster-empty">
                      <i className="fas fa-calendar-day text-gray-600 text-3xl mb-2"/>
                      <p className="text-white font-black text-[14px] uppercase tracking-widest">Nothing booked yet</p>
                      <p className="text-[14px] text-gray-500 normal-case mt-1">Use the button below to add the first appointment.</p>
                    </div>
                  ) : (
                    <div className="space-y-2" data-testid="day-roster-list">
                      <p className="text-[13px] font-black text-gray-500 uppercase tracking-widest">{dayBookings.length} appointment{dayBookings.length !== 1 ? "s" : ""}</p>
                      {dayBookings.map((e) => {
                        const meta = SVC_META[e.extendedProps?.service_type] || { color: "bg-gray-500/20 text-gray-300 border-gray-500/40", label: e.extendedProps?.service_type };
                        const t = e.extendedProps?.time;
                        const svc = e.extendedProps?.service_type;
                        const balField = svc === "training" ? "training_credits"
                                        : svc === "boarding" ? "boarding_credits"
                                        : svc === "daycare" ? "credits"
                                        : null;
                        const cid = e.extendedProps?.client_id;
                        const credits = balField && cid ? (clientBalById[cid]?.[balField] ?? null) : null;
                        const creditChipColor = credits == null ? ""
                          : credits > 0 ? "bg-shGreen/15 text-shGreen border-shGreen/40"
                          : "bg-gray-700/50 text-gray-400 border-gray-600";
                        return (
                          <button key={e.id} onClick={()=>setDetailId(e.id)}
                                  className="w-full text-left bg-bgBase border border-bgHover rounded-lg px-3 py-2.5 flex items-start gap-3 hover:border-shBlue/60 transition" data-testid={`day-roster-row-${e.id}`}>
                            <span className={`shrink-0 text-[12px] font-black uppercase tracking-widest px-2 py-1 rounded border ${meta.color}`}>{meta.label}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-white font-black text-[14px] truncate">{e.title.replace(/^\d+:\d+\s·\s/, "")}</p>
                              <p className="text-[13px] text-gray-500 normal-case truncate">{e.extendedProps?.client_name || "—"}</p>
                            </div>
                            {credits != null && (
                              <span className={`shrink-0 text-[12px] font-black uppercase tracking-widest px-1.5 py-1 rounded border ${creditChipColor}`}
                                    data-testid={`day-roster-credits-${e.id}`}
                                    title={`Available ${svc} credits`}>
                                <i className="fas fa-coins mr-1"/>{credits}
                              </span>
                            )}
                            {t && <span className="shrink-0 text-[14px] font-black text-shOrange tracking-widest">{t}</span>}
                            {e.extendedProps?.status === "pending" && (
                              <span className="shrink-0 text-[12px] font-black uppercase tracking-widest bg-shOrange/20 text-shOrange px-1.5 py-0.5 rounded">Pending</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <button onClick={startNewBooking} data-testid="day-roster-new-btn"
                          className="w-full bg-shBlue text-white px-5 py-3 rounded font-black text-[15px] uppercase tracking-widest hover:bg-shBlue/90">
                    <i className="fas fa-plus mr-2"/>New Appointment for this day
                  </button>
                </>
              )}

              {newBooking && (
                <div className="space-y-3" data-testid="day-roster-new-form">
                  <p className="text-[13px] font-black text-gray-500 uppercase tracking-widest">Quick-add for {pretty(dayOpen)}</p>
                  <div>
                    <label className="text-[13px] font-black text-gray-500 uppercase tracking-widest">Dog</label>
                    <select value={newBooking.dog_id}
                            onChange={(e)=>setNewBooking({...newBooking, dog_id: e.target.value})}
                            data-testid="day-roster-dog-select"
                            className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                      <option value="">— pick a dog —</option>
                      {dogs.map(d => <option key={d.id} value={d.id}>{d.name}{d.breed ? ` · ${d.breed}` : ""}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[13px] font-black text-gray-500 uppercase tracking-widest">Service</label>
                    <select value={newBooking.service_type}
                            onChange={(e)=>setNewBooking({...newBooking, service_type: e.target.value})}
                            data-testid="day-roster-service-select"
                            className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                      <option value="daycare">Daycare</option>
                      <option value="boarding">Boarding</option>
                      <option value="training">Training</option>
                      <option value="grooming">Grooming</option>
                      <option value="photography">Photography</option>
                    </select>
                  </div>
                  {newBooking.service_type === "boarding" && (
                    <div>
                      <label className="text-[13px] font-black text-gray-500 uppercase tracking-widest">Check-out date</label>
                      <input type="date" value={newBooking.end_date}
                             onChange={(e)=>setNewBooking({...newBooking, end_date: e.target.value})}
                             style={{colorScheme:"dark"}}
                             className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>
                    </div>
                  )}
                  {(newBooking.service_type === "training" || newBooking.service_type === "grooming") && (
                    <div>
                      <label className="text-[13px] font-black text-gray-500 uppercase tracking-widest">Appointment time</label>
                      <input type="time" value={newBooking.time}
                             onChange={(e)=>setNewBooking({...newBooking, time: e.target.value})}
                             data-testid="day-roster-time-input"
                             style={{colorScheme:"dark"}}
                             className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>
                    </div>
                  )}
                  {newBooking.service_type === "grooming" && (
                    <div>
                      <label className="text-[13px] font-black text-gray-500 uppercase tracking-widest">Grooming type</label>
                      <select value={newBooking.grooming_type}
                              onChange={(e)=>setNewBooking({...newBooking, grooming_type: e.target.value})}
                              className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                        <option value="bath">Bath</option>
                        <option value="nail_trim">Nail trim</option>
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="text-[13px] font-black text-gray-500 uppercase tracking-widest">Notes (optional)</label>
                    <input value={newBooking.notes}
                           onChange={(e)=>setNewBooking({...newBooking, notes: e.target.value})}
                           className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>
                  </div>
                  {bookErr && <p className="text-red-400 text-[14px] normal-case">{bookErr}</p>}
                  <div className="flex justify-end gap-3 pt-1">
                    <button onClick={()=>setNewBooking(null)} className="text-gray-500 font-black uppercase text-[14px] tracking-widest">Back</button>
                    <button onClick={saveBooking} disabled={bookSaving} data-testid="day-roster-save-btn"
                            className="bg-shBlue text-white px-5 py-2 rounded font-black text-[14px] uppercase tracking-widest hover:bg-shBlue/90 disabled:opacity-50">
                      {bookSaving ? <><i className="fas fa-circle-notch fa-spin mr-2"/>Saving…</> : "Add appointment"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Booking detail modal — opens from the calendar event click or the day-roster
 * row click. Shows everything the operator typically wants at a glance:
 * dog/client, service, date(s), time, status, payment, notes, kennel.
 * Lightweight quick actions: Cancel booking (admin only — refunds credit
 * automatically via the existing cancel_booking flow).
 */
function BookingDetailModal({ id, onClose, onChanged }) {
  const [b, setB] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [draftNotes, setDraftNotes] = useState("");
  const [savedFlash, setSavedFlash] = useState("");
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await api.get(`/bookings/${id}`);
        if (alive) { setB(data); setDraftNotes(data.notes || ""); }
      } catch (e) {
        if (alive) setErr(formatErr(e.response?.data?.detail) || "Couldn't load booking");
      }
    })();
    return () => { alive = false; };
  }, [id]);
  const cancel = async () => {
    if (!window.confirm("Cancel this booking?")) return;
    setBusy(true);
    try {
      await api.delete(`/bookings/${id}`);
      onChanged?.();
    } catch (e) {
      setErr(formatErr(e.response?.data?.detail) || "Cancel failed");
      setBusy(false);
    }
  };
  // Inline-save notes. We don't auto-close on save so the operator can keep
  // reading and tweak more.
  const saveNotes = async () => {
    setBusy(true); setErr("");
    try {
      const { data } = await api.patch(`/bookings/${id}`, { notes: draftNotes });
      setB(data); setEditingNotes(false);
      setSavedFlash("Notes saved");
      setTimeout(() => setSavedFlash(""), 1800);
    } catch (e) {
      setErr(formatErr(e.response?.data?.detail) || "Save failed");
    } finally { setBusy(false); }
  };
  // Walk-in shortcut: create a NEW daycare booking for this dog dated today,
  // marked checked-in. Closes the modal and tells the parent to refresh.
  const quickBookToday = async () => {
    if (!b) return;
    const today = new Date().toISOString().slice(0,10);
    if (!window.confirm(`Add ${b.dog_name} to today's roster as a checked-in ${b.service_type}?`)) return;
    setBusy(true); setErr("");
    try {
      await api.post("/bookings", {
        dog_id: b.dog_id,
        date: today,
        service_type: b.service_type,
        notes: "",
        check_in_now: true,
      });
      onChanged?.();
    } catch (e) {
      setErr(formatErr(e.response?.data?.detail) || "Quick-book failed");
      setBusy(false);
    }
  };
  const meta = b && (SVC_META[b.service_type] || { color: "bg-gray-500/20 text-gray-300 border-gray-500/40", label: b.service_type });
  const todayIso = new Date().toISOString().slice(0,10);
  const isPast = b && (["completed","cancelled","rejected"].includes(b.status) || ((b.end_date || b.date) < todayIso));
  return (
    <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm grid place-items-center p-3 sm:p-6 animate-fade-in"
         onClick={onClose} data-testid="booking-detail-modal">
      <div onClick={(e)=>e.stopPropagation()}
           className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-md shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-bgPanel border-b border-bgHover px-5 py-4 flex items-center justify-between gap-3 z-10">
          <div className="min-w-0">
            <p className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Booking detail</p>
            <h2 className="text-lg font-black uppercase italic text-white tracking-tight truncate">{b?.dog_name || "…"}</h2>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white" data-testid="booking-detail-close">
            <i className="fas fa-xmark text-xl"/>
          </button>
        </div>
        <div className="p-5">
          {err && <p className="text-red-400 text-[15px] mb-3" data-testid="booking-detail-error">{err}</p>}
          {savedFlash && <p className="text-shGreen text-[14px] font-black uppercase tracking-widest mb-3" data-testid="booking-detail-flash"><i className="fas fa-check mr-1"/>{savedFlash}</p>}
          {!b && !err && <p className="text-gray-500 text-[14px] uppercase tracking-widest"><i className="fas fa-circle-notch fa-spin mr-2"/>Loading…</p>}
          {b && (
            <div className="space-y-3 text-[14px]">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[12px] font-black uppercase tracking-widest px-2 py-1 rounded border ${meta.color}`}>{meta.label}</span>
                <span className={`text-[12px] font-black uppercase tracking-widest px-2 py-1 rounded ${b.status==="approved"?"bg-shGreen/15 text-shGreen":b.status==="pending"?"bg-shOrange/15 text-shOrange":b.status==="rejected"?"bg-red-500/15 text-red-400":b.status==="completed"?"bg-shBlue/15 text-shBlue":"bg-gray-500/15 text-gray-400"}`}>{b.status}</span>
                {b.payment_status === "paid" && <span className="text-[12px] font-black uppercase tracking-widest px-2 py-1 rounded bg-shGreen/15 text-shGreen">Paid · {b.payment_method || "—"}</span>}
              </div>
              <Row label="Client" value={b.client_name}/>
              <Row label="Date" value={`${b.date}${b.end_date && b.end_date!==b.date ? ` → ${b.end_date}` : ""}`}/>
              {b.time && <Row label="Time" value={b.time}/>}
              {b.grooming_type && <Row label="Type" value={b.grooming_type === "bath" ? "Bath" : "Nail Trim"}/>}
              {b.kennel && <Row label="Kennel" value={b.kennel}/>}
              {b.actual_price ? <Row label="Charged" value={`$${Number(b.actual_price).toFixed(2)}`}/> : null}
              {b.credit_value ? <Row label="Credit value" value={`$${Number(b.credit_value).toFixed(2)} (${b.credits_deducted || 1} ${b.credit_service_type || "daycare"})`}/> : null}
              {/* Editable notes block — always shown so admin can ADD a note even when none exists. */}
              <div className="bg-bgBase border border-bgHover rounded-lg p-3" data-testid="booking-detail-notes">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Notes</p>
                  {!editingNotes && <button onClick={()=>{ setDraftNotes(b.notes || ""); setEditingNotes(true); }}
                                            data-testid="booking-detail-edit-notes"
                                            className="text-[12px] font-black uppercase tracking-widest text-shBlue hover:underline">
                    <i className="fas fa-pen mr-1"/>{b.notes ? "Edit" : "Add"}
                  </button>}
                </div>
                {!editingNotes ? (
                  b.notes
                    ? <p className="text-[15px] text-gray-200 whitespace-pre-wrap normal-case">{b.notes}</p>
                    : <p className="text-[14px] text-gray-500 italic normal-case">No notes on this booking.</p>
                ) : (
                  <div>
                    <textarea value={draftNotes}
                              onChange={(e)=>setDraftNotes(e.target.value)}
                              data-testid="booking-detail-notes-input"
                              rows={3}
                              className="w-full bg-bgPanel border border-bgHover rounded p-2 text-white text-[15px] normal-case"/>
                    <div className="flex justify-end gap-2 mt-2">
                      <button onClick={()=>{ setEditingNotes(false); setDraftNotes(b.notes || ""); }}
                              className="text-gray-400 hover:text-white text-[13px] font-black uppercase tracking-widest">Cancel</button>
                      <button onClick={saveNotes} disabled={busy} data-testid="booking-detail-save-notes"
                              className="bg-shGreen text-black px-3 py-1 rounded text-[13px] font-black uppercase tracking-widest hover:bg-shGreen/80 disabled:opacity-50">
                        {busy ? "Saving…" : "Save"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
              {b.report_card?.note && (
                <div className="bg-shGreen/5 border border-shGreen/30 rounded-lg p-3">
                  <p className="text-[12px] font-black text-shGreen uppercase tracking-widest mb-1"><i className="fas fa-paw mr-1"/>Report card</p>
                  <p className="text-[15px] text-gray-200 italic normal-case">"{b.report_card.note}"</p>
                </div>
              )}
              <div className="pt-2 flex flex-wrap justify-end gap-3">
                {/* Walk-in shortcut: re-book this dog/service for today. Useful when
                    a regular calls last-minute and you're already looking at their
                    most recent booking. */}
                {isPast && (
                  <button onClick={quickBookToday} disabled={busy} data-testid="booking-detail-quick-book"
                          className="text-shGreen hover:text-shGreen/80 text-[14px] font-black uppercase tracking-widest disabled:opacity-50">
                    <i className="fas fa-bolt mr-1.5"/>Add to today's roster
                  </button>
                )}
                {(b.status === "approved" || b.status === "pending") && (
                  <button onClick={cancel} disabled={busy} data-testid="booking-detail-cancel"
                          className="text-red-400 hover:text-red-300 text-[14px] font-black uppercase tracking-widest disabled:opacity-50">
                    {busy ? "Cancelling…" : <><i className="fas fa-trash mr-1.5"/>Cancel booking</>}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[13px] font-black uppercase tracking-widest text-gray-500">{label}</span>
      <span className="text-white text-[14px] font-bold text-right break-words">{value || "—"}</span>
    </div>
  );
}

