import { useEffect, useMemo, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import { api, formatErr } from "../lib/api";
import PageHero from "../components/PageHero";
import { useLiveRefresh } from "../lib/useLiveRefresh";
import BookingDetailModal from "../components/BookingDetailModal";

function isoOnly(d) { return d.toISOString().split("T")[0]; }
function isMobile() {
  // Sprint 110di-43 — widened to (max-width: 1023px) so iPad portrait,
  // landscape phones, and small tablets all get the mobile-friendly list
  // view instead of the cramped month grid.
  return typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches;
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
    const mq = window.matchMedia("(max-width: 1023px)");
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
    <div className={`${mobile ? "flex flex-col gap-3" : "h-full flex flex-col gap-4"} animate-slide-in`} data-testid="schedule-calendar">
      <PageHero
        eyebrow={{ icon: "fa-mouse-pointer", text: "Schedule · drag to reschedule", color: "text-shBlue" }}
        title="The Calendar."
        highlight="Every pup. Every day."
        subtitle="Drag any event to reschedule. Click a day to see the full roster."
        right={msg ? (<span className="bg-shGreen/15 text-shGreen border border-shGreen/30 text-[12px] font-black uppercase tracking-widest px-3 py-2 rounded">{msg}</span>) : null}
        compact={mobile}
        testid="schedule-hero"
      />
      <div className={`bg-bgPanel p-2 sm:p-4 rounded-xl border border-bgHover ${mobile ? "" : "flex-1 overflow-hidden"}`}
           data-testid="schedule-grid-wrap">
        {/* Sprint 110di-43 — on mobile/tablet (<1024px) we swap the cramped
            month grid for a clean LIST view: dates flow vertically with one
            booking per row, each row tappable. Tap "Month" to flip back to
            the grid mode when needed (kept as an option for power users). */}
        <div className={mobile ? "" : "h-full"}>
          <div className={mobile ? "" : "h-full"} style={mobile ? undefined : { height: "100%" }}>
            <FullCalendar
              ref={calRef}
              plugins={[dayGridPlugin, listPlugin, interactionPlugin]}
              initialView={mobile ? "listMonth" : "dayGridMonth"}
              height={mobile ? "auto" : "100%"}
              events={events}
              editable={!mobile}
              eventStartEditable={!mobile}
              eventDurationEditable={!mobile}
              eventDrop={onDrop}
              eventResize={onDrop}
              dateClick={onDateClick}
              eventClick={(info) => { info.jsEvent?.preventDefault(); setDetailId(info.event.id); }}
              displayEventTime={true}
              eventTimeFormat={{ hour: "numeric", minute: "2-digit", meridiem: "short" }}
              eventDisplay="block"
              noEventsContent={mobile ? "No bookings in this month — tap › to look ahead." : undefined}
              headerToolbar={mobile
                ? { left: "prev,next", center: "title", right: "today" }
                : { left: "prev,next today", center: "title", right: "" }}
              buttonText={mobile ? { today: "Today" } : undefined}
              titleFormat={mobile ? { month: "short", year: "2-digit" } : undefined}
            />
          </div>
        </div>
        {mobile && (
          <p className="text-[11px] text-gray-500 mt-2 px-2 italic" data-testid="schedule-mobile-hint">
            <i className="fas fa-list-ul mr-1"/>Tap any booking to open it · use prev / next arrows to jump months
          </p>
        )}
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

