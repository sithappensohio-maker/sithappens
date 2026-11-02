import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { fmt, StatTile, TwoColorStackedChart, RankedBars, Card } from "./shared";

export default function ClientsTab() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get("/analytics/clients").then(r => setData(r.data)).catch(() => {});
  }, []);

  if (!data) {
    return <div className="bg-[#10151f] border border-shBorder rounded-xl p-8 text-center text-shTextMuted">Loading clients…</div>;
  }

  const r = data.retention;

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4" data-testid="clients-stat-strip">
        <StatTile label="New Clients" value={data.new_clients_total.toLocaleString()} sub="this year" />
        <StatTile label="Avg Client Spend" value={fmt(data.avg_client_spend)} valueColor="text-shPrimary" sub="lifetime" />
        <StatTile label="Active · 30 Days" value={r.active_30d.toLocaleString()} valueColor="text-shSecondary" />
        <StatTile label="Active · 90 Days" value={r.active_90d.toLocaleString()} valueColor="text-shSecondary" />
        <StatTile label="Clients Ever" value={r.total_clients_ever.toLocaleString()} />
      </div>

      <Card testid="new-vs-returning">
        <div className="flex items-center justify-between mb-4">
          <p className="text-[13px] font-black uppercase tracking-widest text-shTextMuted">New vs Returning Clients — {data.year}</p>
          <div className="flex gap-3 text-[11px] font-black">
            <span className="text-shPrimary">● New</span><span className="text-shSecondary">● Returning</span>
          </div>
        </div>
        <TwoColorStackedChart points={data.clients_by_month} aKey="new" bKey="returning" aLabel="new" bLabel="returning" />
      </Card>

      <Card title="Top Clients — Lifetime Spend" testid="top-clients">
        <RankedBars
          items={data.top_clients}
          labelOf={c => c.name}
          valueOf={c => c.lifetime_spend}
          valueLabelOf={c => fmt(c.lifetime_spend)}
          barColor="bg-shPrimary"
          emptyText="No client activity yet"
        />
      </Card>
    </>
  );
}
