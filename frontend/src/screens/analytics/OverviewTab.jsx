import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { fmt, prettyDate, StatTile, CountBarChart, TwoColorStackedChart, OccupancyHeatmap, ServiceMixBars, RankedBars, Card } from "./shared";

export default function OverviewTab() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get("/analytics/overview").then(r => setData(r.data)).catch(() => {});
  }, []);

  if (!data) {
    return (
      <div className="bg-[#10151f] border border-shBorder rounded-xl p-8 text-center text-shTextMuted" data-testid="analytics-loading">
        Loading analytics…
      </div>
    );
  }

  return (
    <>
      {/* Stat strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4" data-testid="analytics-stat-strip">
        <StatTile label="Total Visits · YTD" value={data.total_visits.toLocaleString()}
          sub={data.visits_yoy_pct != null ? `${data.visits_yoy_pct >= 0 ? "↑" : "↓"} ${Math.abs(data.visits_yoy_pct)}% vs last year` : null}
          subColor={data.visits_yoy_pct >= 0 ? "text-green-400 font-black" : "text-red-400 font-black"} />
        <StatTile label="Occupancy Rate" value={data.occupancy_rate != null ? `${data.occupancy_rate}%` : "—"} valueColor="text-shSecondary" sub="this month" />
        <StatTile label="New Clients" value={data.new_clients_total.toLocaleString()} sub="this year" />
        <StatTile label="Avg Client Spend" value={fmt(data.avg_client_spend)} valueColor="text-shPrimary" sub="lifetime" />
        <StatTile label="Busiest Day" value={data.busiest_weekday ? data.busiest_weekday.name : "—"}
          sub={data.busiest_weekday ? `avg ${data.busiest_weekday.avg_visits} visits` : "No activity yet"} />
      </div>

      {/* Visits trend — hero chart */}
      <Card title={`Visits Trend — ${data.year}`} testid="visits-trend">
        <CountBarChart points={data.by_month} />
      </Card>

      {/* 2x2 chart grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Occupancy Heatmap — Day × Time" testid="occupancy-heatmap">
          <OccupancyHeatmap heatmap={data.occupancy_heatmap} />
        </Card>

        <Card testid="new-vs-returning">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[13px] font-black uppercase tracking-widest text-shTextMuted">New vs Returning Clients</p>
            <div className="flex gap-3 text-[11px] font-black">
              <span className="text-shPrimary">● New</span><span className="text-shSecondary">● Returning</span>
            </div>
          </div>
          <TwoColorStackedChart points={data.clients_by_month} aKey="new" bKey="returning" aLabel="new" bLabel="returning" />
        </Card>

        <Card title="Service Mix — Revenue Share" testid="service-mix">
          <ServiceMixBars mix={data.service_mix} />
        </Card>

        <Card title="Top Sellers — Retail" testid="top-sellers">
          <RankedBars items={data.top_sellers} labelOf={p => p.name} valueOf={p => p.units} valueLabelOf={p => `${p.units} sold`} emptyText="No retail sales yet this year" />
        </Card>
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
  );
}
