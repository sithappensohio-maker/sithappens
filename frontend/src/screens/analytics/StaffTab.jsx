import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { fmt, StatTile, CountBarChart, RankedBars, Card } from "./shared";

export default function StaffTab() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get("/analytics/staff").then(r => setData(r.data)).catch(() => {});
  }, []);

  if (!data) {
    return <div className="bg-[#10151f] border border-shBorder rounded-xl p-8 text-center text-shTextMuted">Loading staff…</div>;
  }

  const laborPoints = data.by_month.map(m => ({ month: m.month, label: m.label, total: m.labor_pct_of_revenue ?? 0 }));
  const totalHours = data.staff_hours.reduce((s, p) => s + p.hours, 0);
  const totalLabor = data.by_month.reduce((s, m) => s + (m.labor_total || 0), 0);
  const totalRevenue = data.by_month.reduce((s, m) => s + (m.revenue || 0), 0);
  const overallPct = totalRevenue ? Math.round((totalLabor / totalRevenue) * 1000) / 10 : null;

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4" data-testid="staff-stat-strip">
        <StatTile label="Labor Cost · YTD" value={fmt(totalLabor)} sub="gross + employer burden" />
        <StatTile label="Labor % of Revenue" value={overallPct != null ? `${overallPct}%` : "—"} valueColor="text-shSecondary" />
        <StatTile label="Hours Worked · YTD" value={totalHours.toLocaleString(undefined, { maximumFractionDigits: 1 })} sub="excl. owner" />
      </div>

      <Card title={`Labor Cost — % of Revenue · ${data.year}`} testid="labor-trend">
        <CountBarChart points={laborPoints} formatValue={n => `${n}%`} title="of revenue" />
      </Card>

      <Card title="Hours Worked by Staff Member" testid="staff-hours">
        <RankedBars
          items={data.staff_hours}
          labelOf={s => s.name}
          valueOf={s => s.hours}
          valueLabelOf={s => `${s.hours}h`}
          barColor="bg-shSecondary"
          emptyText="No clocked hours yet this year"
        />
      </Card>
    </>
  );
}
