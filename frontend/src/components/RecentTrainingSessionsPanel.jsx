// Sprint 110di-70 — "Recent training sessions" timeline.
// Reads from /dogs/{id}/programs/{eid}/session-log (Sprint 110di-69 endpoint).
// Renders newest-first with date + trainer + session note + the skills that
// moved. Skill-id → name resolution is done locally from the enrollment's
// snapshotted modules so the panel stays a single API call.

import { useEffect, useState } from "react";
import { api } from "../lib/api";

const STATUS_LABEL = {
  not_started: "Not started",
  in_progress: "Learning",
  mastered: "Mastered",
};

function fmtWhen(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    const sameYesterday = d.toDateString() === yesterday.toDateString();
    const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    if (sameDay) return `Today · ${time}`;
    if (sameYesterday) return `Yesterday · ${time}`;
    return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} · ${time}`;
  } catch {
    return iso;
  }
}

export default function RecentTrainingSessionsPanel({ dogId, enrollmentId, modules }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(false);

  // Build goal-id → name map from the enrollment's snapshotted modules
  const goalNameById = {};
  (modules || []).forEach(m => (m.goals || []).forEach(g => { goalNameById[g.id] = g.name; }));

  useEffect(() => {
    let alive = true;
    api.get(`/dogs/${dogId}/programs/${enrollmentId}/session-log?limit=10`)
      .then(r => { if (alive) setRows(r.data || []); })
      .catch(e => { if (alive) setErr(e?.response?.data?.detail || "Failed to load"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [dogId, enrollmentId]);

  if (loading) return null;
  if (err || rows.length === 0) return null; // hide if nothing yet — no empty-state clutter

  const visible = open ? rows : rows.slice(0, 3);

  return (
    <div className="border-t border-bgHover bg-bgBase/40 px-4 py-3" data-testid={`recent-sessions-${enrollmentId}`}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[12px] font-black uppercase tracking-[0.3em] text-shGreen">
          <i className="fas fa-clock-rotate-left mr-1.5"/>Recent training sessions
          <span className="ml-2 text-gray-500">({rows.length})</span>
        </p>
        {rows.length > 3 && (
          <button onClick={() => setOpen(o => !o)}
                  data-testid={`recent-sessions-toggle-${enrollmentId}`}
                  className="text-[11px] font-black uppercase tracking-widest text-shBlue hover:text-white">
            {open ? "Show less" : `Show all ${rows.length}`}
          </button>
        )}
      </div>
      <ul className="space-y-2">
        {visible.map(r => {
          const diffs = (r.goal_updates || []).filter(d => d.prior_status !== d.new_status || d.prior_score !== d.new_score);
          const advanced = r.advanced_module;
          return (
            <li key={r.id} data-testid={`recent-session-${r.id}`}
                className="bg-bgPanel/60 border border-bgHover rounded p-2.5 text-[13px]">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-white font-bold text-[13px]">
                  <i className="fas fa-user-tie text-shBlue mr-1.5 text-[11px]"/>
                  {r.by_user || "Trainer"}
                </p>
                <p className="text-[12px] text-gray-500 font-black uppercase tracking-widest">{fmtWhen(r.at)}</p>
              </div>
              {r.session_note && (
                <p className="text-gray-300 text-[13px] mt-1 leading-snug border-l-2 border-shBlue/40 pl-2 whitespace-pre-wrap">
                  {r.session_note}
                </p>
              )}
              {diffs.length > 0 && (
                <ul className="mt-1.5 space-y-0.5 text-[12px] text-gray-400">
                  {diffs.map((d, i) => {
                    const name = goalNameById[d.goal_id] || "Skill";
                    const mastered = d.new_status === "mastered";
                    return (
                      <li key={i} className="flex items-center gap-1.5">
                        <i className={`fas ${mastered ? "fa-star text-shGreen" : "fa-arrow-right text-shBlue"} text-[10px]`}/>
                        <span className="text-white font-bold">{name}</span>
                        <span className="text-gray-500">·</span>
                        <span>{STATUS_LABEL[d.prior_status] || "—"} → {STATUS_LABEL[d.new_status] || "—"}</span>
                        {(d.new_score ?? 0) !== (d.prior_score ?? 0) && (
                          <span className="text-gray-500">(score {d.prior_score ?? 0} → {d.new_score ?? 0})</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {advanced && (
                <p className="text-[12px] text-shOrange font-black uppercase tracking-widest mt-1.5">
                  <i className="fas fa-forward mr-1"/>Advanced to next week
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
