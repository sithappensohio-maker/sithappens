import { useEffect, useState } from "react";
import { api } from "../lib/api";

const TREND_META = {
  up:   { icon: "fa-arrow-trend-up",   color: "text-shPrimary", label: "improving" },
  down: { icon: "fa-arrow-trend-down", color: "text-red-400", label: "declining" },
  flat: { icon: "fa-equals",           color: "text-shTextMuted", label: "steady" },
};

const KIND_UNIT = {
  reps: "reps", sets: "sets",
  duration_sec: "sec", duration_min: "min",
  distance_ft: "ft", success_rate: "%", rating_5: "/5",
};

/**
 * Admin-facing weekly report for a templated homework assignment.
 *
 * Sprint 110af — For daily-tracker plans, we now ALSO render a per-day
 * timeline showing every submission the client made: mood, steps ticked,
 * metrics, note, photo. The aggregate section tiles (used for session-log
 * templates) still render below for backwards-compatible reporting.
 */
export default function HomeworkReportPanel({ homeworkId }) {
  const [report, setReport] = useState(null);
  const [hw, setHw] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    Promise.all([
      api.get(`/homework/${homeworkId}/report`),
      api.get(`/homework/${homeworkId}`),
    ]).then(([rRep, rHw]) => {
      if (!mounted) return;
      setReport(rRep.data);
      setHw(rHw.data);
    }).finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [homeworkId]);

  if (loading) return <div className="text-[15px] text-shTextMuted uppercase font-black tracking-widest">Loading report…</div>;
  if (!report) return null;

  const isTracker = !!hw?.daily_tracker;
  const daysWithLogs = (hw?.daily_progress || []).filter(d => d.log);

  if (report.total_logs === 0 && !daysWithLogs.length) {
    return (
      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded p-4 text-center text-[15px] text-shTextMuted uppercase font-black tracking-widest">
        No client logs yet.
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid={`hw-report-${homeworkId}`}>
      <div className="flex flex-wrap gap-3 text-[14px] font-black uppercase tracking-widest">
        <span className="bg-shPrimary/15 text-shPrimary px-3 py-1.5 rounded"><i className="fas fa-list-check mr-1"/>{report.total_logs || daysWithLogs.length} entries</span>
        <span className="bg-shSecondary/15 text-shSecondary px-3 py-1.5 rounded"><i className="fas fa-calendar mr-1"/>{report.days_logged || daysWithLogs.length} days logged</span>
        {isTracker && (
          <span className="bg-purple-500/15 text-purple-300 px-3 py-1.5 rounded"><i className="fas fa-calendar-check mr-1"/>Daily Tracker</span>
        )}
      </div>

      {/* Sprint 110af — Per-day timeline for daily trackers. */}
      {isTracker && daysWithLogs.length > 0 && (
        <div className="space-y-3" data-testid="hw-report-day-timeline">
          <p className="text-[11px] font-black uppercase tracking-[0.3em] text-purple-300"><i className="fas fa-stream mr-1"/>Day-by-day timeline</p>
          {daysWithLogs.map((d) => (
            <DayDetail key={d.day_number} day={d} hwId={homeworkId} />
          ))}
        </div>
      )}

      {report.sections.map(section => section.log_count === 0 ? null : (
        <div key={section.section_id} className="bg-[var(--sh-card-base)] border border-shBorder rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h6 className="text-shText font-black text-[14px] uppercase tracking-tight">{section.title}</h6>
            <span className="text-[13px] font-black uppercase tracking-widest text-shTextMuted">{section.log_count} log{section.log_count===1?"":"s"} · last {section.last_logged}</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {section.fields.map(f => <FieldTile key={f.field_id} field={f} />)}
          </div>
        </div>
      ))}
    </div>
  );
}


function DayDetail({ day, hwId }) {
  const [open, setOpen] = useState(false);
  const log = day.log || {};
  const status = day.status;
  const mood = log.field_values?.__mood;
  const photo = log.field_values?.__photo;
  const stepStates = day.step_states || {};
  const stepsDone = (day.steps || []).filter((s) => stepStates[s.id || s.label]).length;
  const stepsTotal = (day.steps || []).length;
  const statusMeta = {
    approved:  { bg: "bg-shPrimary/15", text: "text-shPrimary", border: "border-shPrimary/40", icon: "fa-check-circle", label: "Approved" },
    submitted: { bg: "bg-shAccent/15", text: "text-shAccent", border: "border-shAccent/40", icon: "fa-hourglass-half", label: "Awaiting review" },
    needs_redo:{ bg: "bg-red-500/15", text: "text-red-300", border: "border-red-500/40", icon: "fa-rotate-left", label: "Needs redo" },
    rest:      { bg: "bg-shSecondary/15", text: "text-shSecondary", border: "border-shSecondary/40", icon: "fa-mug-hot", label: "Rest day" },
    skipped:   { bg: "bg-gray-500/15", text: "text-shTextMuted", border: "border-shBorder", icon: "fa-forward", label: "Skipped" },
  }[status] || { bg: "bg-[var(--sh-card-base)]", text: "text-shTextMuted", border: "border-shBorder", icon: "fa-circle", label: status };

  const filledFields = (day.fields || []).filter((f) => {
    const v = log.field_values?.[f.id];
    return v !== undefined && v !== "" && v !== null;
  });

  return (
    <div className={`bg-[var(--sh-card-base)] border ${statusMeta.border} rounded-lg overflow-hidden`} data-testid={`hw-report-day-${day.day_number}`}>
      <button onClick={() => setOpen((o) => !o)} className="w-full px-4 py-3 flex items-center justify-between gap-3 hover:bg-[var(--sh-card-base)]/40 transition text-left">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span className={`shrink-0 ${statusMeta.bg} ${statusMeta.text} px-2 py-0.5 rounded text-[11px] font-black uppercase tracking-widest border ${statusMeta.border}`}>
            <i className={`fas ${statusMeta.icon} mr-1`}/>Day {day.day_number}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-shText text-[14px] font-black tracking-tight truncate">{day.day_focus || day.title || `Day ${day.day_number}`}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] uppercase tracking-widest text-shTextMuted mt-0.5">
              <span><i className="fas fa-clock mr-1"/>{(log.logged_at || "").slice(0,16).replace("T"," ")}</span>
              {stepsTotal > 0 && <span><i className="fas fa-list-check mr-1"/>{stepsDone}/{stepsTotal} steps</span>}
              {mood && <span><i className="fas fa-face-smile mr-1"/>Mood {mood}/5</span>}
              {photo && <span className="text-purple-300"><i className="fas fa-camera mr-1"/>photo</span>}
              {log.field_values?.__video_id && <span className="text-purple-300"><i className="fas fa-video mr-1"/>video</span>}
            </div>
          </div>
        </div>
        <i className={`fas ${open ? "fa-chevron-up" : "fa-chevron-down"} text-shTextMuted text-xs shrink-0`}/>
      </button>

      {open && (
        <div className="border-t border-shBorder px-4 py-3 space-y-3 bg-[var(--sh-card-base)]/40">
          {/* Day instructions */}
          {day.instructions && (
            <div className="bg-[var(--sh-card-base)] rounded p-2.5 border-l-2 border-shSecondary/40">
              <p className="text-[10px] font-black uppercase tracking-widest text-shTextMuted mb-1"><i className="fas fa-circle-info mr-1"/>What they were asked to do</p>
              <p className="text-shTextMuted text-[12px] whitespace-pre-wrap">{day.instructions}</p>
            </div>
          )}
          {/* Steps */}
          {stepsTotal > 0 && (
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-shTextMuted mb-1.5"><i className="fas fa-list-check mr-1"/>Steps</p>
              <div className="space-y-1">
                {day.steps.map((step) => {
                  const sid = step.id || step.label;
                  const checked = !!stepStates[sid];
                  return (
                    <div key={sid} className={`flex items-start gap-2 text-[12px] px-2 py-1 rounded ${checked ? "bg-shPrimary/10" : "bg-[var(--sh-card-base)] opacity-60"}`}>
                      <i className={`fas ${checked ? "fa-square-check text-shPrimary" : "fa-square text-shTextMuted"} mt-0.5`}/>
                      <span className={checked ? "text-shText" : "text-shTextMuted line-through decoration-gray-500/40"}>{step.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {/* Numeric metrics */}
          {filledFields.length > 0 && (
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-shTextMuted mb-1.5"><i className="fas fa-chart-simple mr-1"/>Metrics</p>
              <div className="space-y-1">
                {filledFields.map((f) => {
                  const v = log.field_values[f.id];
                  let display = v;
                  if (typeof v === "boolean") display = v ? "✓ yes" : "✗ no";
                  return (
                    <div key={f.id} className="flex justify-between items-start gap-3 border-b border-shBorder/30 pb-1 last:border-0">
                      <span className="text-[12px] font-black uppercase tracking-widest text-shTextMuted">{f.label}</span>
                      <span className="text-shText text-[13px] font-black text-right whitespace-pre-wrap">{String(display)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {/* Note */}
          {log.note && (
            <div className="bg-[var(--sh-card-base)] rounded p-2.5 border-l-2 border-shAccent/40">
              <p className="text-[10px] font-black uppercase tracking-widest text-shTextMuted mb-1"><i className="fas fa-comment mr-1"/>Client's note</p>
              <p className="text-gray-200 text-[12px] italic whitespace-pre-wrap">"{log.note}"</p>
            </div>
          )}
          {/* Photo */}
          {photo && (
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-shTextMuted mb-1"><i className="fas fa-camera mr-1"/>Photo</p>
              <img src={photo} alt={`Day ${day.day_number} submission`} loading="lazy" className="max-h-60 rounded border border-shBorder"/>
            </div>
          )}
          {/* Questions */}
          {(day.questions || []).length > 0 && (
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-shTextMuted mb-1.5"><i className="fas fa-circle-question mr-1"/>Questions ({day.questions.length})</p>
              <div className="space-y-1.5">
                {day.questions.map((q, i) => (
                  <div key={i} className="text-[12px] bg-[var(--sh-card-base)] rounded p-2">
                    <p className="text-shTextMuted italic">"{q.question || q.text}"</p>
                    {q.answer && <p className="text-shPrimary mt-1"><i className="fas fa-reply mr-1"/>{q.answer}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {/* Trainer's review note (if approved/redo) */}
          {log.review_note && (
            <div className="bg-[var(--sh-card-base)] rounded p-2.5 border-l-2 border-shPrimary/40">
              <p className="text-[10px] font-black uppercase tracking-widest text-shTextMuted mb-1"><i className="fas fa-user-tie mr-1"/>Trainer's note ({statusMeta.label})</p>
              <p className="text-gray-200 text-[12px] whitespace-pre-wrap">{log.review_note}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FieldTile({ field }) {
  // Text fields → latest entry
  if (field.kind === "text" || field.kind === "longtext") {
    if (!field.latest) return null;
    return (
      <div className="bg-[var(--sh-card-base)]/60 border border-shBorder rounded p-2.5 col-span-2 md:col-span-3">
        <p className="text-[13px] font-black uppercase tracking-widest text-shTextMuted">{field.label}</p>
        <p className="text-[15px] text-gray-200 mt-1 italic line-clamp-3">"{field.latest}"</p>
        {field.entries && field.entries.length > 1 && (
          <p className="text-[13px] text-shTextMuted mt-1">{field.entries.length} total entries</p>
        )}
      </div>
    );
  }
  // Checkbox tile
  if (field.kind === "checkbox") {
    const yes = field.yes_count || 0;
    const tot = field.entry_count || 0;
    return (
      <div className="bg-[var(--sh-card-base)]/60 border border-shBorder rounded p-2.5">
        <p className="text-[13px] font-black uppercase tracking-widest text-shTextMuted">{field.label}</p>
        <p className="text-[16px] font-black text-shText mt-1">{yes} / {tot}</p>
      </div>
    );
  }
  // Numeric tile
  if (field.count === undefined || field.count === 0) return null;
  const unit = KIND_UNIT[field.kind] || "";
  const target = field.target;
  // reverse=true means LOWER is better (e.g., "times the dog broke Place")
  let hitTarget = null;
  if (target !== null && target !== undefined) {
    hitTarget = field.reverse ? (field.avg <= target) : (field.avg >= target);
  }
  const trend = TREND_META[field.trend] || TREND_META.flat;
  // For reverse-direction fields, flip the trend semantics
  const trendKey = field.reverse
    ? (field.trend === "up" ? "down" : field.trend === "down" ? "up" : "flat")
    : field.trend;
  const trendEffective = TREND_META[trendKey] || trend;

  return (
    <div className="bg-[var(--sh-card-base)]/60 border border-shBorder rounded p-2.5">
      <p className="text-[13px] font-black uppercase tracking-widest text-shTextMuted line-clamp-2 leading-tight min-h-[28px]">{field.label}</p>
      <div className="flex items-baseline gap-2 mt-1.5">
        <span className="text-[18px] font-black text-shText">{field.avg}</span>
        <span className="text-[13px] text-shTextMuted">avg{unit ? " " + unit : ""}</span>
        <i className={`fas ${trendEffective.icon} ${trendEffective.color} text-[14px] ml-auto`} title={`${trendEffective.label} over time`} />
      </div>
      <div className="flex items-center justify-between mt-1 text-[13px] text-shTextMuted">
        <span>total {field.total}</span>
        {target !== undefined && target !== null && (
          <span className={hitTarget ? "text-shPrimary" : "text-shAccent"}>
            {hitTarget ? "✓" : "•"} goal {target}{field.reverse ? " or less" : ""}
          </span>
        )}
      </div>
    </div>
  );
}
