// Shared formatting helpers + chart building blocks for the Analytics page
// and its 5 drill-down tabs. Kept in one place so a fix (like the service-mix
// "Retail must not include refunds" bug the backend review caught) only ever
// needs visual reuse, not copy-pasted JSX across 6 files.
import { Fragment } from "react";

export function fmt(n) { return `$${(Number(n) || 0).toFixed(2)}`; }
export function compactFmt(n) { return `$${Math.round(Number(n) || 0).toLocaleString()}`; }
export const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
export function prettyDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[(m || 1) - 1]} ${d}, ${y}`;
}

export const SERVICE_COLORS = {
  Daycare: "bg-shPrimary", Boarding: "bg-shSecondary", Training: "bg-purple-400",
  Grooming: "bg-red-400", Retail: "bg-shTextMuted", Other: "bg-shAccent",
};
export const SERVICE_TEXT_COLORS = {
  Daycare: "text-shPrimary", Boarding: "text-shSecondary", Training: "text-purple-400",
  Grooming: "text-red-400", Retail: "text-shTextMuted", Other: "text-shAccent",
};

export function StatTile({ label, value, valueColor = "text-shText", sub, subColor = "text-shTextMuted" }) {
  return (
    <div className="bg-[#10151f] border border-shBorder rounded-xl p-4">
      <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">{label}</p>
      <p className={`text-[24px] font-black mt-1 ${valueColor}`}>{value}</p>
      {sub && <p className={`text-[12px] mt-1 ${subColor}`}>{sub}</p>}
    </div>
  );
}

// One bar per month, integer counts (visits), highlighting the peak month.
export function CountBarChart({ points, formatValue = (n) => String(n), title = "visits" }) {
  if (!points || points.length === 0) return null;
  const max = Math.max(...points.map(p => p.total), 1);
  const peakIdx = points.reduce((best, p, i) => p.total > points[best].total ? i : best, 0);
  return (
    <div data-testid="count-bar-chart">
      <div className="flex items-end justify-center gap-3 h-44 pt-7">
        {points.map((p, i) => {
          const h = Math.max((p.total / max) * 100, 2);
          const isPeak = i === peakIdx && p.total > 0;
          return (
            <div key={p.month} className="flex-1 max-w-[64px] h-full flex flex-col justify-end items-center relative" title={`${p.label} · ${p.total} ${title}`}>
              <span className={`absolute -top-5 text-[10px] font-black whitespace-nowrap ${isPeak ? "text-shPrimary" : "text-shTextMuted"}`}>{formatValue(p.total)}</span>
              <div className={`w-full transition rounded-t-md ${isPeak ? "bg-shPrimary" : "bg-[#1c2430]"}`} style={{ height: `${h}%` }} />
            </div>
          );
        })}
      </div>
      <div className="flex justify-center gap-3 mt-3 pt-3 border-t border-shBorder/60">
        {points.map(p => (
          <span key={p.month} className="flex-1 max-w-[64px] text-center text-[12px] font-black uppercase tracking-widest text-shTextMuted">{p.label}</span>
        ))}
      </div>
    </div>
  );
}

// Two-color stacked bar per month — used for New/Returning and can be reused
// for any "two quantities per period" split.
export function TwoColorStackedChart({ points, aKey, bKey, aLabel, bLabel, aColor = "bg-shPrimary", bColor = "bg-shSecondary" }) {
  if (!points || points.length === 0) return <p className="text-[13px] text-shTextMuted italic">No activity yet</p>;
  const max = Math.max(...points.map(p => p[aKey] + p[bKey]), 1);
  return (
    <div data-testid="two-color-stacked-chart">
      <div className="flex items-end justify-center gap-3 h-36">
        {points.map(p => {
          const total = p[aKey] + p[bKey];
          const hTotal = Math.max((total / max) * 100, total > 0 ? 3 : 0);
          const aShare = total > 0 ? (p[aKey] / total) * 100 : 0;
          const bShare = total > 0 ? (p[bKey] / total) * 100 : 0;
          return (
            <div key={p.month} className="flex-1 max-w-[48px] h-full flex flex-col justify-end items-center" title={`${p.label}: ${p[aKey]} ${aLabel}, ${p[bKey]} ${bLabel}`}>
              <div className="w-full flex flex-col-reverse rounded-t-md overflow-hidden" style={{ height: `${hTotal}%` }}>
                <div className={`w-full ${aColor}`} style={{ height: `${aShare}%` }} />
                <div className={`w-full ${bColor}`} style={{ height: `${bShare}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-center gap-3 mt-3 pt-3 border-t border-shBorder/60">
        {points.map(p => (
          <span key={p.month} className="flex-1 max-w-[48px] text-center text-[11px] font-black uppercase tracking-widest text-shTextMuted">{p.label}</span>
        ))}
      </div>
    </div>
  );
}

// Day-of-week × time-of-day grid, shaded by relative visit volume.
export function OccupancyHeatmap({ heatmap }) {
  if (!heatmap || !heatmap.grid?.length) return <p className="text-[13px] text-shTextMuted italic">No check-in data yet</p>;
  const { weekdays, bands, grid, max_count } = heatmap;
  const short = weekdays.map(w => w.slice(0, 3));
  return (
    <div data-testid="occupancy-heatmap-grid">
      <div className="grid gap-1.5" style={{ gridTemplateColumns: "70px repeat(7, minmax(0,1fr))" }}>
        <span />
        {short.map(w => <span key={w} className="text-[11px] text-shTextMuted text-center">{w}</span>)}
        {bands.map((band, b) => (
          <Fragment key={band}>
            <span className="text-[11px] text-shTextMuted self-center">{band}</span>
            {grid.map((row, wd) => (
              <div key={`${wd}-${b}`} className="h-7 rounded bg-shPrimary"
                   style={{ opacity: row[b].count > 0 ? Math.max(row[b].intensity, 0.18) : 0.06 }}
                   title={`${weekdays[wd]} ${band}: ${row[b].count}`} />
            ))}
          </Fragment>
        ))}
      </div>
      <p className="text-[12px] text-shTextMuted mt-3">
        {max_count > 0 ? "Darker = busier, based on check-in times." : "No check-ins recorded yet."}
      </p>
    </div>
  );
}

// Horizontal proportional bars — top sellers, top clients, staff hours,
// anything that's "a ranked list with a magnitude".
export function RankedBars({ items, labelOf, valueOf, valueLabelOf, barColor = "bg-purple-400", emptyText = "No activity yet" }) {
  if (!items || items.length === 0) return <p className="text-[13px] text-shTextMuted italic">{emptyText}</p>;
  const max = Math.max(...items.map(valueOf), 1);
  return (
    <div className="space-y-3">
      {items.map((it, i) => (
        <div key={i}>
          <div className="flex justify-between items-baseline text-[13px] mb-1">
            <span className="text-shText truncate pr-2">{labelOf(it)}</span>
            <span className="font-black text-shText whitespace-nowrap">{valueLabelOf(it)}</span>
          </div>
          <div className="h-2 rounded-full bg-[#1a2130]">
            <div className={`h-full rounded-full ${barColor}`} style={{ width: `${(valueOf(it) / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ServiceMixBars({ mix }) {
  if (!mix || mix.length === 0) return <p className="text-[13px] text-shTextMuted italic">No revenue yet this year</p>;
  return (
    <div className="space-y-3">
      {mix.map(s => (
        <div key={s.label}>
          <div className="flex justify-between text-[13px] mb-1">
            <span className="text-shText">{s.label}</span>
            <span className={`font-black ${SERVICE_TEXT_COLORS[s.label] || "text-shText"}`}>{s.pct}%</span>
          </div>
          <div className="h-2.5 rounded-full bg-[#1a2130]">
            <div className={`h-full rounded-full ${SERVICE_COLORS[s.label] || "bg-shTextMuted"}`} style={{ width: `${s.pct}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Card({ title, testid, children, className = "" }) {
  return (
    <div className={`bg-[#10151f] border border-shBorder rounded-xl p-5 ${className}`} data-testid={testid}>
      {title && <p className="text-[13px] font-black uppercase tracking-widest text-shTextMuted mb-4">{title}</p>}
      {children}
    </div>
  );
}
