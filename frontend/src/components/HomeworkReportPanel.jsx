import { useEffect, useState } from "react";
import { api } from "../lib/api";

const TREND_META = {
  up:   { icon: "fa-arrow-trend-up",   color: "text-shGreen", label: "improving" },
  down: { icon: "fa-arrow-trend-down", color: "text-red-400", label: "declining" },
  flat: { icon: "fa-equals",           color: "text-gray-400", label: "steady" },
};

const KIND_UNIT = {
  reps: "reps", sets: "sets",
  duration_sec: "sec", duration_min: "min",
  distance_ft: "ft", success_rate: "%", rating_5: "/5",
};

/**
 * Admin-facing weekly report for a templated homework assignment.
 * Pulls /api/homework/{id}/report and renders per-section summary tiles:
 *  - Numeric fields: avg + total + trend arrow (vs target)
 *  - Text fields: latest entry + count
 *  - Checkbox: yes-count fraction
 */
export default function HomeworkReportPanel({ homeworkId }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    api.get(`/homework/${homeworkId}/report`)
      .then((r) => mounted && setReport(r.data))
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [homeworkId]);

  if (loading) return <div className="text-[15px] text-gray-500 uppercase font-black tracking-widest">Loading report…</div>;
  if (!report) return null;

  if (report.total_logs === 0) {
    return (
      <div className="bg-bgBase border border-bgHover rounded p-4 text-center text-[15px] text-gray-400 uppercase font-black tracking-widest">
        No client logs yet.
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid={`hw-report-${homeworkId}`}>
      <div className="flex flex-wrap gap-3 text-[14px] font-black uppercase tracking-widest">
        <span className="bg-shGreen/15 text-shGreen px-3 py-1.5 rounded"><i className="fas fa-list-check mr-1"/>{report.total_logs} entries</span>
        <span className="bg-shBlue/15 text-shBlue px-3 py-1.5 rounded"><i className="fas fa-calendar mr-1"/>{report.days_logged} days logged</span>
      </div>

      {report.sections.map(section => section.log_count === 0 ? null : (
        <div key={section.section_id} className="bg-bgBase border border-bgHover rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h6 className="text-white font-black text-[14px] uppercase tracking-tight">{section.title}</h6>
            <span className="text-[13px] font-black uppercase tracking-widest text-gray-500">{section.log_count} log{section.log_count===1?"":"s"} · last {section.last_logged}</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {section.fields.map(f => <FieldTile key={f.field_id} field={f} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

function FieldTile({ field }) {
  // Text fields → latest entry
  if (field.kind === "text" || field.kind === "longtext") {
    if (!field.latest) return null;
    return (
      <div className="bg-bgPanel/60 border border-bgHover rounded p-2.5 col-span-2 md:col-span-3">
        <p className="text-[13px] font-black uppercase tracking-widest text-gray-500">{field.label}</p>
        <p className="text-[15px] text-gray-200 mt-1 italic line-clamp-3">"{field.latest}"</p>
        {field.entries && field.entries.length > 1 && (
          <p className="text-[13px] text-gray-500 mt-1">{field.entries.length} total entries</p>
        )}
      </div>
    );
  }
  // Checkbox tile
  if (field.kind === "checkbox") {
    const yes = field.yes_count || 0;
    const tot = field.entry_count || 0;
    return (
      <div className="bg-bgPanel/60 border border-bgHover rounded p-2.5">
        <p className="text-[13px] font-black uppercase tracking-widest text-gray-500">{field.label}</p>
        <p className="text-[16px] font-black text-white mt-1">{yes} / {tot}</p>
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
    <div className="bg-bgPanel/60 border border-bgHover rounded p-2.5">
      <p className="text-[13px] font-black uppercase tracking-widest text-gray-500 line-clamp-2 leading-tight min-h-[28px]">{field.label}</p>
      <div className="flex items-baseline gap-2 mt-1.5">
        <span className="text-[18px] font-black text-white">{field.avg}</span>
        <span className="text-[13px] text-gray-500">avg{unit ? " " + unit : ""}</span>
        <i className={`fas ${trendEffective.icon} ${trendEffective.color} text-[14px] ml-auto`} title={`${trendEffective.label} over time`} />
      </div>
      <div className="flex items-center justify-between mt-1 text-[13px] text-gray-500">
        <span>total {field.total}</span>
        {target !== undefined && target !== null && (
          <span className={hitTarget ? "text-shGreen" : "text-shOrange"}>
            {hitTarget ? "✓" : "•"} goal {target}{field.reverse ? " or less" : ""}
          </span>
        )}
      </div>
    </div>
  );
}
