import { useEffect, useState } from "react";
import { api } from "../lib/api";

const MOOD_EMOJI = ["", "😞", "😅", "😐", "💪", "😄"];
const TREND_META = {
  up:   { color: "text-shGreen",  icon: "fa-arrow-trend-up",   label: "trending up" },
  down: { color: "text-red-300",  icon: "fa-arrow-trend-down", label: "trending down" },
  flat: { color: "text-gray-300", icon: "fa-equals",           label: "holding steady" },
};

/**
 * Compact behavior-trend sparkline driven by daily-tracker mood ratings.
 * Used on the Dog Hub (admin) and the Client Portal dog switcher.
 *
 * Props:
 *   dogId: required
 *   days: window in days (default 60)
 *   compact: smaller layout for embedded portal usage
 */
export default function BehaviorTrendChart({ dogId, days = 60, compact = false }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!dogId) return;
    (async () => {
      setLoading(true);
      try {
        const { data } = await api.get(`/dogs/${dogId}/behavior-trend`, { params: { days } });
        setData(data);
      } catch { setData(null); }
      finally { setLoading(false); }
    })();
  }, [dogId, days]);

  if (loading) return <div className="text-[13px] text-gray-500 font-black uppercase tracking-widest py-2">Loading trend…</div>;
  if (!data || data.count === 0) {
    return (
      <div className="bg-bgPanel/40 border border-bgHover rounded-lg p-3 text-center" data-testid="behavior-trend-empty">
        <p className="text-[13px] text-gray-500 font-black uppercase tracking-widest">
          <i className="fas fa-chart-line mr-1"/>No mood data yet
        </p>
        <p className="text-[12px] text-gray-500 mt-0.5">Complete a few daily-tracker check-ins to start seeing trends.</p>
      </div>
    );
  }

  const points = data.points || [];
  const tm = TREND_META[data.trend] || TREND_META.flat;

  // SVG sparkline rendering — values 1..5 mapped to y range
  const w = compact ? 220 : 320;
  const h = compact ? 50 : 70;
  const pad = 4;
  const cells = points.length;
  const xStep = cells > 1 ? (w - pad * 2) / (cells - 1) : 0;
  const yFor = (m) => h - pad - ((m - 1) / 4) * (h - pad * 2);
  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${(pad + i * xStep).toFixed(1)},${yFor(p.mood).toFixed(1)}`)
    .join(" ");
  const areaD = `${pathD} L${(pad + (cells - 1) * xStep).toFixed(1)},${(h - pad).toFixed(1)} L${pad.toFixed(1)},${(h - pad).toFixed(1)} Z`;

  return (
    <div className="bg-bgPanel/40 border border-bgHover rounded-lg p-3" data-testid="behavior-trend-chart">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[13px] font-black uppercase tracking-widest text-gray-300">
          <i className="fas fa-chart-line mr-1 text-shBlue"/>Mood trend · last {days}d
        </p>
        <span className={`text-[12px] font-black uppercase tracking-widest ${tm.color}`}>
          <i className={`fas ${tm.icon} mr-1`}/>{tm.label}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <svg width={w} height={h} className="block">
          <path d={areaD} fill="rgba(34,197,94,0.10)" />
          <path d={pathD} fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          {points.map((p, i) => (
            <circle key={i} cx={pad + i * xStep} cy={yFor(p.mood)} r="3" fill="#22c55e">
              <title>{p.date}: {MOOD_EMOJI[p.mood]} ({p.mood}/5){p.plan ? ` · ${p.plan}` : ""}</title>
            </circle>
          ))}
        </svg>
        <div className="text-[14px]">
          <div className="text-shGreen font-black text-2xl">{data.avg ?? "—"}</div>
          <div className="text-[11px] text-gray-500 font-black uppercase tracking-widest">avg · {data.count} log{data.count === 1 ? "" : "s"}</div>
        </div>
      </div>
    </div>
  );
}
