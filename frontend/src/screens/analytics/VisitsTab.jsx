import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { StatTile, CountBarChart, OccupancyHeatmap, RankedBars, Card } from "./shared";

export default function VisitsTab() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get("/analytics/visits").then(r => setData(r.data)).catch(() => {});
  }, []);

  if (!data) {
    return <div className="bg-[#10151f] border border-shBorder rounded-xl p-8 text-center text-shTextMuted">Loading visits…</div>;
  }

  const nsr = data.no_show_rate;

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4" data-testid="visits-stat-strip">
        <StatTile label="Total Visits · YTD" value={data.total_visits.toLocaleString()} />
        <StatTile label="Occupancy Rate" value={data.occupancy_rate_this_month != null ? `${data.occupancy_rate_this_month}%` : "—"} valueColor="text-shSecondary" sub="this month" />
        <StatTile label="No-Show Rate"
          value={nsr.pct != null ? `${nsr.pct}%` : "—"} valueColor={nsr.pct > 10 ? "text-red-400" : "text-shText"}
          sub={nsr.resolved_total ? `${nsr.no_show_count} of ${nsr.resolved_total} appointments` : "No activity yet"} />
      </div>

      <Card title={`Visits Trend — ${data.year}`} testid="visits-trend">
        <CountBarChart points={data.by_month} />
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Occupancy Heatmap — Day × Time" testid="occupancy-heatmap">
          <OccupancyHeatmap heatmap={data.occupancy_heatmap} />
        </Card>

        <Card title="Busiest Days of the Week" testid="weekday-breakdown">
          <RankedBars
            items={[...data.by_weekday].sort((a, b) => b.avg_visits - a.avg_visits)}
            labelOf={w => w.name}
            valueOf={w => w.avg_visits}
            valueLabelOf={w => `${w.avg_visits} avg`}
            barColor="bg-shSecondary"
          />
        </Card>
      </div>
    </>
  );
}
