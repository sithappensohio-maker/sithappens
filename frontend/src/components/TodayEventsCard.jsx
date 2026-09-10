// Admin Today — the upcoming public events at a glance (how many households
// have preregistered, how many dogs, how many are checked in on the day) with
// one tap into the Events dashboard. Renders nothing when there is nothing on
// the calendar or the account cannot run events.
import { useEffect, useState } from "react";
import { api } from "../lib/api";

function fmt(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) + " · " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  } catch { return iso; }
}
export function upcomingEvents(list, now = Date.now()) {
  return (list || []).filter((e) => {
    const end = new Date(e.end_at || e.start_at).getTime();
    return Number.isNaN(end) ? true : end >= now;
  }).sort((a, b) => String(a.start_at).localeCompare(String(b.start_at)));
}
export function isEventDay(e, now = new Date()) {
  const s = new Date(e.start_at);
  return !Number.isNaN(s.getTime()) && s.toDateString() === now.toDateString();
}

export default function TodayEventsCard({ can = () => false, onNavigate = () => {}, refreshSignal = 0 }) {
  const allowed = can("manage_events");
  const [events, setEvents] = useState(null);
  useEffect(() => {
    if (!allowed) return undefined;
    let alive = true;
    api.get("/admin/events").then((r) => { if (alive) setEvents(upcomingEvents(r.data?.events)); }).catch(() => { if (alive) setEvents([]); });
    return () => { alive = false; };
  }, [allowed, refreshSignal]);
  if (!allowed || !events || events.length === 0) return null;
  return (
    <div className="rounded-2xl border border-shOrange/40 bg-[var(--sh-card-base)] p-4 sm:p-5" data-testid="today-events">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-[15px] font-black uppercase italic tracking-tight text-white"><i className="fas fa-calendar-day text-shOrange mr-2" />Upcoming events</h2>
        <button type="button" onClick={() => onNavigate("events")} data-testid="today-open-events"
                className="min-h-[40px] px-3 rounded-lg bg-shSurfaceRaised text-shText font-black text-[11px] uppercase tracking-widest border border-bgHover">
          Open Events <i className="fas fa-arrow-right ml-1" />
        </button>
      </div>
      <div className="space-y-2">
        {events.map((e) => {
          const s = e.summary || {};
          const today = isEventDay(e);
          return (
            <button key={e.id} type="button" onClick={() => onNavigate("events")} data-testid={`today-event-${e.slug}`}
                    className={`w-full text-left rounded-xl border px-3 py-3 flex flex-col sm:flex-row sm:items-center gap-2 ${today ? "border-shGreen/60 bg-shGreen/5" : "border-bgHover bg-bgBase"}`}>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-black text-white leading-tight truncate">{e.name}</p>
                <p className="text-[12px] text-shTextMuted mt-0.5">{fmt(e.start_at)}{today ? <span className="ml-2 text-shGreen font-black uppercase tracking-widest text-[10px]">Today</span> : null}{!e.published ? <span className="ml-2 text-shOrange font-black uppercase tracking-widest text-[10px]">Unpublished</span> : null}</p>
              </div>
              <div className="flex flex-wrap gap-1.5 text-[11px] font-black uppercase tracking-wide">
                <span className="px-2 py-0.5 rounded-full bg-shSurfaceRaised text-shText" data-testid={`today-event-${e.slug}-households`}>{s.households ?? 0} household{s.households === 1 ? "" : "s"}</span>
                <span className="px-2 py-0.5 rounded-full bg-shSurfaceRaised text-shText">{s.people ?? 0} people</span>
                <span className="px-2 py-0.5 rounded-full bg-shSurfaceRaised text-shText">{s.dogs ?? 0} dog{s.dogs === 1 ? "" : "s"}</span>
                {today && <span className="px-2 py-0.5 rounded-full bg-shGreen/15 text-shGreen ring-1 ring-shGreen/40">{s.checked_in ?? 0} checked in</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
