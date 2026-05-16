import { useEffect, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import { api, formatErr } from "../lib/api";

function isoOnly(d) { return d.toISOString().split("T")[0]; }

function isMobile() {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
}

export default function Schedule() {
  const [events, setEvents] = useState([]);
  const [msg, setMsg] = useState("");
  const [mobile, setMobile] = useState(isMobile());
  const calRef = useRef(null);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const handler = (e) => setMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const load = async () => {
    try { const { data } = await api.get("/events"); setEvents(data); } catch {}
  };
  useEffect(() => { load(); }, []);

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

  return (
    <div className="h-full flex flex-col gap-3 animate-slide-in" data-testid="schedule-calendar">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] sm:text-[14px] text-gray-500 font-black uppercase tracking-widest min-w-0 truncate">
          <i className="fas fa-arrows-up-down-left-right mr-2 text-shBlue"/>
          <span className="hidden sm:inline">Drag any event to reschedule it</span>
          <span className="sm:hidden">Drag to reschedule</span>
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
          headerToolbar={mobile
            ? { left: "prev,next", center: "title", right: "today" }
            : { left: "prev,next today", center: "title", right: "" }}
          titleFormat={mobile ? { month: "short", year: "2-digit" } : undefined}
        />
      </div>
    </div>
  );
}
