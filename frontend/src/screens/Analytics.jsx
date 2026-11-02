import { Fragment, useEffect, useState } from "react";
import { api } from "../lib/api";
import PageHero from "../components/PageHero";

function fmt(n) { return `$${(Number(n) || 0).toFixed(2)}`; }
function compactFmt(n) { return `$${Math.round(Number(n) || 0).toLocaleString()}`; }
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function prettyDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[(m || 1) - 1]} ${d}, ${y}`;
}

const SERVICE_COLORS = {
  Daycare: "bg-shPrimary", Boarding: "bg-shSecondary", Training: "bg-purple-400",
  Grooming: "bg-red-400", Retail: "bg-shTextMuted", Other: "bg-shAccent",
};
const SERVICE_TEXT_COLORS = {
  Daycare: "text-shPrimary", Boarding: "text-shSecondary", Training: "text-purple-400",
  Grooming: "text-red-400", Retail: "text-shTextMuted", Other: "text-shAccent",
};

export default function Analytics() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get("/analytics/overview").then(r => setData(r.data)).catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow={{ icon: "fa-chart-pie", text: "What's going on", color: "text-shPrimary" }}
        title="Analytics."
        highlight="The whole picture."
        subtitle="Visits, occupancy, clients, and what's selling — all in one place."
        testid="analytics-hero"
      />

      {!data && (
        <div className="bg-[#10151f] border border-shBorder rounded-xl p-8 text-center text-shTextMuted" data-testid="analytics-loading">
          Loading analytics…
        </div>
      )}

      {data && (
        <>
          {/* Stat strip */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4" data-testid="analytics-stat-strip">
            <div className="bg-[#10151f] border border-shBorder rounded-xl p-4">
              <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">Total Visits · YTD</p>
              <p className="text-[24px] font-black text-shText mt-1">{data.total_visits.toLocaleString()}</p>
              {data.visits_yoy_pct != null && (
                <p className={`text-[12px] font-black mt-1 ${data.visits_yoy_pct >= 0 ? "text-green-400" : "text-red-400"}`}>
                  <i className={`fas fa-arrow-${data.visits_yoy_pct >= 0 ? "up" : "down"} mr-1`}/>{Math.abs(data.visits_yoy_pct)}% vs last year
                </p>
              )}
            </div>
            <div className="bg-[#10151f] border border-shBorder rounded-xl p-4">
              <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">Occupancy Rate</p>
              <p className="text-[24px] font-black text-shSecondary mt-1">{data.occupancy_rate != null ? `${data.occupancy_rate}%` : "—"}</p>
              <p className="text-[12px] text-shTextMuted mt-1">this month</p>
            </div>
            <div className="bg-[#10151f] border border-shBorder rounded-xl p-4">
              <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">New Clients</p>
              <p className="text-[24px] font-black text-shText mt-1">{data.new_clients_total.toLocaleString()}</p>
              <p className="text-[12px] text-shTextMuted mt-1">this year</p>
            </div>
            <div className="bg-[#10151f] border border-shBorder rounded-xl p-4">
              <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">Avg Client Spend</p>
              <p className="text-[24px] font-black text-shPrimary mt-1">{fmt(data.avg_client_spend)}</p>
              <p className="text-[12px] text-shTextMuted mt-1">lifetime</p>
            </div>
            <div className="bg-[#10151f] border border-shBorder rounded-xl p-4">
              <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">Busiest Day</p>
              {data.busiest_weekday ? (
                <>
                  <p className="text-[24px] font-black text-shText mt-1">{data.busiest_weekday.name}</p>
                  <p className="text-[12px] text-shTextMuted mt-1">avg {data.busiest_weekday.avg_visits} visits</p>
                </>
              ) : <p className="text-[14px] text-shTextMuted italic mt-1">No activity yet</p>}
            </div>
          </div>

          {/* Visits trend — hero chart */}
          <div className="bg-[#10151f] border border-shAccent/20 rounded-xl p-5" data-testid="visits-trend">
            <p className="text-[15px] font-black uppercase tracking-widest text-shTextMuted mb-4">Visits Trend — {data.year}</p>
            <VisitsBarChart points={data.by_month} />
          </div>

          {/* 2x2 chart grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-[#10151f] border border-shBorder rounded-xl p-5" data-testid="occupancy-heatmap">
              <p className="text-[13px] font-black uppercase tracking-widest text-shTextMuted mb-4">Occupancy Heatmap — Day × Time</p>
              <OccupancyHeatmap heatmap={data.occupancy_heatmap} />
            </div>

            <div className="bg-[#10151f] border border-shBorder rounded-xl p-5" data-testid="new-vs-returning">
              <div className="flex items-center justify-between mb-4">
                <p className="text-[13px] font-black uppercase tracking-widest text-shTextMuted">New vs Returning Clients</p>
                <div className="flex gap-3 text-[11px] font-black">
                  <span className="text-shPrimary">● New</span><span className="text-shSecondary">● Returning</span>
                </div>
              </div>
              <NewVsReturningChart points={data.clients_by_month} />
            </div>

            <div className="bg-[#10151f] border border-shBorder rounded-xl p-5" data-testid="service-mix">
              <p className="text-[13px] font-black uppercase tracking-widest text-shTextMuted mb-4">Service Mix — Revenue Share</p>
              {data.service_mix.length === 0 ? (
                <p className="text-[13px] text-shTextMuted italic">No revenue yet this year</p>
              ) : (
                <div className="space-y-3">
                  {data.service_mix.map(s => (
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
              )}
            </div>

            <div className="bg-[#10151f] border border-shBorder rounded-xl p-5" data-testid="top-sellers">
              <p className="text-[13px] font-black uppercase tracking-widest text-shTextMuted mb-4">Top Sellers — Retail</p>
              {data.top_sellers.length === 0 ? (
                <p className="text-[13px] text-shTextMuted italic">No retail sales yet this year</p>
              ) : (
                <div className="space-y-3">
                  {data.top_sellers.map((p, i) => {
                    const max = Math.max(...data.top_sellers.map(x => x.units), 1);
                    return (
                      <div key={p.product_id || i}>
                        <div className="flex justify-between items-baseline text-[13px] mb-1">
                          <span className="text-shText truncate pr-2">{p.name}</span>
                          <span className="font-black text-shText whitespace-nowrap">{p.units} sold</span>
                        </div>
                        <div className="h-2 rounded-full bg-[#1a2130]">
                          <div className="h-full rounded-full bg-purple-400" style={{ width: `${(p.units / max) * 100}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Fun stats footer */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" data-testid="fun-stats">
            <div className="bg-[#10151f] border border-shPrimary/20 rounded-xl p-4 flex items-center gap-4">
              <div className="w-11 h-11 rounded-full bg-shPrimary/15 flex items-center justify-center text-[18px]">🐾</div>
              <div>
                <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">Dogs Served All-Time</p>
                <p className="text-[17px] font-black text-shText">{data.fun_stats.dogs_served_all_time.toLocaleString()}</p>
              </div>
            </div>
            <div className="bg-[#10151f] border border-shSecondary/20 rounded-xl p-4 flex items-center gap-4">
              <div className="w-11 h-11 rounded-full bg-shSecondary/15 flex items-center justify-center text-[18px]">📅</div>
              <div>
                <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">Busiest Day Ever</p>
                <p className="text-[17px] font-black text-shText">
                  {data.fun_stats.busiest_day_ever ? `${prettyDate(data.fun_stats.busiest_day_ever.date)} — ${data.fun_stats.busiest_day_ever.count} visits` : "—"}
                </p>
              </div>
            </div>
            <div className="bg-[#10151f] border border-purple-400/20 rounded-xl p-4 flex items-center gap-4">
              <div className="w-11 h-11 rounded-full bg-purple-400/15 flex items-center justify-center text-[18px]">💰</div>
              <div>
                <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">Biggest Single Sale</p>
                <p className="text-[17px] font-black text-shText">
                  {data.fun_stats.biggest_single_sale ? fmt(data.fun_stats.biggest_single_sale.amount) : "—"}
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// One bar per month, visit counts (quiet months included as 0, never dropped).
function VisitsBarChart({ points }) {
  if (!points || points.length === 0) return null;
  const max = Math.max(...points.map(p => p.total), 1);
  const peakIdx = points.reduce((best, p, i) => p.total > points[best].total ? i : best, 0);
  return (
    <div data-testid="visits-bar-chart">
      <div className="flex items-end justify-center gap-3 h-44 pt-7">
        {points.map((p, i) => {
          const h = Math.max((p.total / max) * 100, 2);
          const isPeak = i === peakIdx && p.total > 0;
          return (
            <div key={p.month} className="flex-1 max-w-[64px] h-full flex flex-col justify-end items-center relative" title={`${p.label} · ${p.total} visits`}>
              <span className={`absolute -top-5 text-[10px] font-black whitespace-nowrap ${isPeak ? "text-shPrimary" : "text-shTextMuted"}`}>{p.total}</span>
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

// New (bottom) + returning (top) clients stacked per month.
function NewVsReturningChart({ points }) {
  if (!points || points.length === 0) return <p className="text-[13px] text-shTextMuted italic">No activity yet</p>;
  const max = Math.max(...points.map(p => p.new + p.returning), 1);
  return (
    <div data-testid="new-vs-returning-chart">
      <div className="flex items-end justify-center gap-3 h-36">
        {points.map(p => {
          const total = p.new + p.returning;
          const hTotal = Math.max((total / max) * 100, total > 0 ? 3 : 0);
          const newShare = total > 0 ? (p.new / total) * 100 : 0;
          const returningShare = total > 0 ? (p.returning / total) * 100 : 0;
          return (
            <div key={p.month} className="flex-1 max-w-[48px] h-full flex flex-col justify-end items-center" title={`${p.label}: ${p.new} new, ${p.returning} returning`}>
              <div className="w-full flex flex-col-reverse rounded-t-md overflow-hidden" style={{ height: `${hTotal}%` }}>
                <div className="w-full bg-shPrimary" style={{ height: `${newShare}%` }} />
                <div className="w-full bg-shSecondary" style={{ height: `${returningShare}%` }} />
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
function OccupancyHeatmap({ heatmap }) {
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
