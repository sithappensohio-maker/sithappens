import { useEffect, useState } from "react";
import { api } from "../lib/api";
import BehaviorTrendChart from "./BehaviorTrendChart";

const KIND_META = {
  booking:            { color: "bg-shSecondary/15 text-shSecondary",    icon: "fa-calendar",        label: "Visit" },
  homework_assigned:  { color: "bg-shAccent/15 text-shAccent",icon: "fa-clipboard-list",  label: "Practice assigned" },
  homework_completed: { color: "bg-shPrimary/15 text-shPrimary",  icon: "fa-flag-checkered",  label: "Practice done" },
  day_approved:       { color: "bg-shPrimary/15 text-shPrimary",  icon: "fa-circle-check",    label: "Day approved" },
  practice_session:   { color: "bg-purple-500/15 text-purple-300", icon: "fa-dumbbell",      label: "Practiced" },
  photos_added:       { color: "bg-purple-500/15 text-purple-300", icon: "fa-camera",     label: "Photos" },
  incident:           { color: "bg-red-500/15 text-red-300",  icon: "fa-triangle-exclamation", label: "Incident" },
};

/**
 * Unified per-dog activity stream + behavior trend sparkline.
 * Lives in the Dogs detail modal under a new "Timeline" tab.
 */
export default function DogTimeline({ dogId, dogName }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!dogId) return;
    (async () => {
      setLoading(true);
      try {
        const { data } = await api.get(`/dogs/${dogId}/timeline`, { params: { limit: 60 } });
        setEvents(Array.isArray(data) ? data : []);
      } catch { setEvents([]); }
      finally { setLoading(false); }
    })();
  }, [dogId]);

  return (
    <div className="space-y-4" data-testid={`dog-timeline-${dogId}`}>
      <BehaviorTrendChart dogId={dogId} days={60} />

      <div className="flex items-center justify-between">
        <p className="text-[14px] font-black uppercase tracking-widest text-shTextMuted">
          <i className="fas fa-clock-rotate-left mr-1 text-shSecondary"/>{dogName}'s timeline
        </p>
        <span className="text-[12px] text-shTextMuted font-black uppercase tracking-widest">{events.length} event{events.length === 1 ? "" : "s"}</span>
      </div>

      {loading ? (
        <p className="text-[14px] text-shTextMuted">Loading timeline…</p>
      ) : events.length === 0 ? (
        <p className="text-[14px] text-shTextMuted italic">No activity yet — first booking or Practice will land here.</p>
      ) : (
        <div className="space-y-1.5">
          {events.map(e => {
            const km = KIND_META[e.kind] || { color: "bg-shSurfaceRaised text-shTextMuted", icon: "fa-circle", label: e.kind };
            const ts = e.ts || "";
            const dateLabel = ts.length >= 10 ? ts.slice(0, 10) : ts;
            return (
              <div key={e.id} className="bg-[var(--sh-card-base)] border border-shBorder rounded-lg p-2.5 flex items-start gap-2.5" data-testid={`tl-event-${e.id}`}>
                <span className={`shrink-0 rounded px-2 py-1 text-[11px] font-black uppercase tracking-widest ${km.color}`}>
                  <i className={`fas ${km.icon} mr-1`}/>{km.label}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] text-shText truncate">{e.title}</p>
                  <div className="flex items-center gap-2 flex-wrap mt-0.5">
                    <span className="text-[12px] text-shTextMuted font-black uppercase tracking-widest">{dateLabel}</span>
                    {e.mood && <span className="text-base">{["", "😞", "😅", "😐", "💪", "😄"][Number(e.mood)]}</span>}
                    {e.severity && <span className="text-[11px] font-black uppercase tracking-widest text-red-400">· {e.severity}</span>}
                    {e.actual_price != null && <span className="text-[12px] text-shPrimary font-black">${e.actual_price}</span>}
                    {e.has_cert && <span className="text-[11px] text-shAccent font-black uppercase tracking-widest">🎓 cert ready</span>}
                  </div>
                  {e.report_card?.notes && (
                    <p className="text-[13px] text-shTextMuted italic mt-1 line-clamp-2">"{e.report_card.notes}"</p>
                  )}
                  {e.notes && e.kind === "incident" && (
                    <p className="text-[13px] text-red-200 mt-1 line-clamp-2">"{e.notes}"</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
