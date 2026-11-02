import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { fmt, StatTile, ServiceMixBars, Card, SERVICE_COLORS } from "./shared";

const STACK_CATEGORIES = ["Daycare", "Boarding", "Training", "Grooming", "Retail"];

function ServiceStackedChart({ points }) {
  if (!points || points.length === 0) return null;
  const max = Math.max(...points.map(p => STACK_CATEGORIES.reduce((s, c) => s + (p[c] || 0), 0)), 1);
  return (
    <div data-testid="service-stacked-chart">
      <div className="flex items-end justify-center gap-3 h-48">
        {points.map(p => {
          const total = STACK_CATEGORIES.reduce((s, c) => s + (p[c] || 0), 0);
          const hTotal = Math.max((total / max) * 100, total > 0 ? 3 : 0);
          return (
            <div key={p.month} className="flex-1 max-w-[56px] h-full flex flex-col justify-end items-center"
                 title={STACK_CATEGORIES.map(c => `${c}: ${fmt(p[c] || 0)}`).join(" · ")}>
              <div className="w-full flex flex-col-reverse rounded-t-md overflow-hidden" style={{ height: `${hTotal}%` }}>
                {STACK_CATEGORIES.map(c => (
                  <div key={c} className={SERVICE_COLORS[c]} style={{ height: total > 0 ? `${((p[c] || 0) / total) * 100}%` : 0 }} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex justify-center gap-3 mt-3 pt-3 border-t border-shBorder/60">
        {points.map(p => (
          <span key={p.month} className="flex-1 max-w-[56px] text-center text-[11px] font-black uppercase tracking-widest text-shTextMuted">{p.label}</span>
        ))}
      </div>
      <div className="flex flex-wrap gap-3 mt-4 justify-center text-[11px] font-black">
        {STACK_CATEGORIES.map(c => (
          <span key={c} className={SERVICE_COLORS[c].replace("bg-", "text-")}>● {c}</span>
        ))}
      </div>
    </div>
  );
}

export default function ServicesTab() {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.get("/analytics/services").then(r => setData(r.data)).catch(() => {});
  }, []);

  if (!data) {
    return <div className="bg-[#10151f] border border-shBorder rounded-xl p-8 text-center text-shTextMuted">Loading services…</div>;
  }

  const cp = data.credit_pack_redeemed;

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4" data-testid="services-stat-strip">
        <StatTile label="Top Service"
          value={data.service_mix[0]?.label || "—"}
          valueColor="text-shPrimary"
          sub={data.service_mix[0] ? `${data.service_mix[0].pct}% of revenue` : null} />
        <StatTile label="Credit Packs Redeemed" value={(cp.count || 0).toLocaleString()} sub={cp.value ? fmt(cp.value) + " in value" : null} />
        <StatTile label="Categories Earning" value={data.service_mix.length.toLocaleString()} />
      </div>

      <Card title={`Revenue by Service — ${data.year}`} testid="service-stacked">
        <ServiceStackedChart points={data.by_month} />
      </Card>

      <Card title="Service Mix — Revenue Share" testid="service-mix">
        <ServiceMixBars mix={data.service_mix} />
      </Card>
    </>
  );
}
