import { useEffect, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import { api } from "../lib/api";

export default function Schedule() {
  const [events, setEvents] = useState([]);
  const calRef = useRef(null);

  const load = async () => {
    try { const { data } = await api.get("/events"); setEvents(data); } catch {}
  };
  useEffect(() => { load(); }, []);

  return (
    <div className="h-full bg-bgPanel p-4 rounded-xl border border-bgHover animate-slide-in" data-testid="schedule-calendar">
      <FullCalendar
        ref={calRef}
        plugins={[dayGridPlugin, interactionPlugin]}
        initialView="dayGridMonth"
        height="100%"
        events={events}
        headerToolbar={{ left: "prev,next today", center: "title", right: "" }}
      />
    </div>
  );
}
