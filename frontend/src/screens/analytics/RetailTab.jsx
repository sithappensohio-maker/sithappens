import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { fmt, compactFmt, StatTile, CountBarChart, RankedBars, Card } from "./shared";

export default function RetailTab() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get("/analytics/retail").then(r => setData(r.data)).catch(() => {});
  }, []);

  if (!data) {
    return <div className="bg-[#10151f] border border-shBorder rounded-xl p-8 text-center text-shTextMuted">Loading retail…</div>;
  }

  const { in_store, online } = data.channel_split;
  const totalRevenue = in_store.revenue + online.revenue;
  const onlinePct = totalRevenue ? Math.round((online.revenue / totalRevenue) * 100) : 0;

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4" data-testid="retail-stat-strip">
        <StatTile label="In-Store Revenue" value={fmt(in_store.revenue)} sub={`${in_store.units} units`} />
        <StatTile label="Online Revenue" value={fmt(online.revenue)} valueColor="text-shSecondary"
          sub={online.average_order_value != null ? `avg order ${fmt(online.average_order_value)}` : `${online.units} units`} />
        <StatTile label="Online Share" value={`${onlinePct}%`} valueColor="text-purple-400" sub="of retail revenue" />
      </div>

      <Card title={`Retail Revenue Trend — ${data.year}`} testid="retail-trend">
        <CountBarChart points={data.by_month} formatValue={compactFmt} title="revenue" />
      </Card>

      <Card title="Top Sellers — All Channels" testid="top-sellers">
        <RankedBars
          items={data.top_sellers}
          labelOf={p => p.name}
          valueOf={p => p.units}
          valueLabelOf={p => `${p.units} sold`}
          emptyText="No retail sales yet this year"
        />
      </Card>
    </>
  );
}
