import { useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import { api, formatErr } from "../lib/api";

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
  useEffect(() => { load(); loadDogs(); }, []);
  // Auto-refresh on tab focus so bookings created elsewhere appear right away.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") load(); };
    const onFocus = () => load();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

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
    <div className="h-full flex flex-col gap-3 animate-slide-in" data-testid="schedule-calendar">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] sm:text-[14px] text-gray-500 font-black uppercase tracking-widest min-w-0 truncate">
          <i className="fas fa-mouse-pointer mr-2 text-shBlue"/>
          <span className="hidden sm:inline">Drag any event to reschedule · click a day to see the roster</span>
          <span className="sm:hidden">Drag to reschedule · tap a day</span>
        </p>
        {msg && <span className="shrink-0 text-[12px] sm:text-[14px] font-black uppercase tracking-widest text-shGreen bg-shGreen/10 px-2 sm:px-3 py-1 rounded">{msg}</span>}
      </div>
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
          // Training/grooming events have specific times — display them
          displayEventTime={true}
          eventTimeFormat={{ hour: "numeric", minute: "2-digit", meridiem: "short" }}
          headerToolbar={mobile
            ? { left: "prev,next", center: "title", right: "today" }
            : { left: "prev,next today", center: "title", right: "" }}
          titleFormat={mobile ? { month: "short", year: "2-digit" } : undefined}
        />
      </div>

      {dayOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm grid place-items-center p-3 sm:p-6 animate-fade-in"
             onClick={()=>{ setDayOpen(null); setNewBooking(null); }}
             data-testid="day-roster-modal">
          <div onClick={(e)=>e.stopPropagation()}
               className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-xl shadow-2xl max-h-[92vh] overflow-y-auto">
            <div className="sticky top-0 bg-bgPanel border-b border-bgHover px-5 py-4 flex items-center justify-between gap-3 z-10">
              <div className="min-w-0">
                <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Day Roster</p>
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
                      <p className="text-[12px] text-gray-500 normal-case mt-1">Use the button below to add the first appointment.</p>
                    </div>
                  ) : (
                    <div className="space-y-2" data-testid="day-roster-list">
                      <p className="text-[11px] font-black text-gray-500 uppercase tracking-widest">{dayBookings.length} appointment{dayBookings.length !== 1 ? "s" : ""}</p>
                      {dayBookings.map((e) => {
                        const meta = SVC_META[e.extendedProps?.service_type] || { color: "bg-gray-500/20 text-gray-300 border-gray-500/40", label: e.extendedProps?.service_type };
                        const t = e.extendedProps?.time;
                        return (
                          <div key={e.id} className="bg-bgBase border border-bgHover rounded-lg px-3 py-2.5 flex items-start gap-3" data-testid={`day-roster-row-${e.id}`}>
                            <span className={`shrink-0 text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded border ${meta.color}`}>{meta.label}</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-white font-black text-[14px] truncate">{e.title.replace(/^\d+:\d+\s·\s/, "")}</p>
                              <p className="text-[11px] text-gray-500 normal-case truncate">{e.extendedProps?.client_name || "—"}</p>
                            </div>
                            {t && <span className="shrink-0 text-[12px] font-black text-shOrange tracking-widest">{t}</span>}
                            {e.extendedProps?.status === "pending" && (
                              <span className="shrink-0 text-[10px] font-black uppercase tracking-widest bg-shOrange/20 text-shOrange px-1.5 py-0.5 rounded">Pending</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <button onClick={startNewBooking} data-testid="day-roster-new-btn"
                          className="w-full bg-shBlue text-white px-5 py-3 rounded font-black text-[13px] uppercase tracking-widest hover:bg-shBlue/90">
                    <i className="fas fa-plus mr-2"/>New Appointment for this day
                  </button>
                </>
              )}

              {newBooking && (
                <div className="space-y-3" data-testid="day-roster-new-form">
                  <p className="text-[11px] font-black text-gray-500 uppercase tracking-widest">Quick-add for {pretty(dayOpen)}</p>
                  <div>
                    <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest">Dog</label>
                    <select value={newBooking.dog_id}
                            onChange={(e)=>setNewBooking({...newBooking, dog_id: e.target.value})}
                            data-testid="day-roster-dog-select"
                            className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                      <option value="">— pick a dog —</option>
                      {dogs.map(d => <option key={d.id} value={d.id}>{d.name}{d.breed ? ` · ${d.breed}` : ""}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest">Service</label>
                    <select value={newBooking.service_type}
                            onChange={(e)=>setNewBooking({...newBooking, service_type: e.target.value})}
                            data-testid="day-roster-service-select"
                            className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                      <option value="daycare">Daycare</option>
                      <option value="boarding">Boarding</option>
                      <option value="training">Training</option>
                      <option value="grooming">Grooming</option>
                    </select>
                  </div>
                  {newBooking.service_type === "boarding" && (
                    <div>
                      <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest">Check-out date</label>
                      <input type="date" value={newBooking.end_date}
                             onChange={(e)=>setNewBooking({...newBooking, end_date: e.target.value})}
                             style={{colorScheme:"dark"}}
                             className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>
                    </div>
                  )}
                  {(newBooking.service_type === "training" || newBooking.service_type === "grooming") && (
                    <div>
                      <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest">Appointment time</label>
                      <input type="time" value={newBooking.time}
                             onChange={(e)=>setNewBooking({...newBooking, time: e.target.value})}
                             data-testid="day-roster-time-input"
                             style={{colorScheme:"dark"}}
                             className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>
                    </div>
                  )}
                  {newBooking.service_type === "grooming" && (
                    <div>
                      <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest">Grooming type</label>
                      <select value={newBooking.grooming_type}
                              onChange={(e)=>setNewBooking({...newBooking, grooming_type: e.target.value})}
                              className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                        <option value="bath">Bath</option>
                        <option value="nail_trim">Nail trim</option>
                      </select>
                    </div>
                  )}
                  <div>
                    <label className="text-[11px] font-black text-gray-500 uppercase tracking-widest">Notes (optional)</label>
                    <input value={newBooking.notes}
                           onChange={(e)=>setNewBooking({...newBooking, notes: e.target.value})}
                           className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm"/>
                  </div>
                  {bookErr && <p className="text-red-400 text-[12px] normal-case">{bookErr}</p>}
                  <div className="flex justify-end gap-3 pt-1">
                    <button onClick={()=>setNewBooking(null)} className="text-gray-500 font-black uppercase text-[12px] tracking-widest">Back</button>
                    <button onClick={saveBooking} disabled={bookSaving} data-testid="day-roster-save-btn"
                            className="bg-shBlue text-white px-5 py-2 rounded font-black text-[12px] uppercase tracking-widest hover:bg-shBlue/90 disabled:opacity-50">
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
