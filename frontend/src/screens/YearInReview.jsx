import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import PageHero from "../components/PageHero";
import { todayISO } from "../lib/date";
import { MonthlyBarChart } from "./Income";
import { fmt, prettyDate, StatTile, Card, ServiceMixBars, RankedBars } from "./analytics/shared";

function ChangeBadge({ pct }) {
  if (pct == null) return null;
  const up = pct >= 0;
  return (
    <span className={`ml-2 text-[14px] font-black ${up ? "text-shPrimary" : "text-red-400"}`}>
      <i className={`fas fa-arrow-${up ? "up" : "down"} mr-1`}/>{Math.abs(pct)}% vs last year
    </span>
  );
}

// Tailwind only generates classes it can see literally in source — a
// template-interpolated `border-${color}/20` would silently render
// unstyled, so each variant is spelled out in full here instead.
function FunStatTile({ icon, variant, label, value }) {
  const borderClass = { primary: "border-shPrimary/20", secondary: "border-shSecondary/20", purple: "border-purple-400/20" }[variant];
  const bgClass = { primary: "bg-shPrimary/15", secondary: "bg-shSecondary/15", purple: "bg-purple-400/15" }[variant];
  return (
    <div className={`bg-[#10151f] border ${borderClass} rounded-xl p-4 flex items-center gap-4`}>
      <div className={`w-11 h-11 rounded-full ${bgClass} flex items-center justify-center text-[18px]`}>{icon}</div>
      <div>
        <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">{label}</p>
        <p className="text-[17px] font-black text-shText">{value}</p>
      </div>
    </div>
  );
}

export default function YearInReview() {
  const currentYear = Number(todayISO().slice(0, 4));
  const [year, setYear] = useState(currentYear);
  const [yearOverview, setYearOverview] = useState(null);
  const [overview, setOverview] = useState(null);
  const [pl, setPl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");

  const load = useCallback(async (y) => {
    setLoading(true); setMsg("");
    try {
      const endDate = y === currentYear ? todayISO() : `${y}-12-31`;
      const [yo, ao, plRes] = await Promise.all([
        api.get("/transactions/year-overview", { params: { year: y } }),
        api.get("/analytics/overview", { params: { year: y } }),
        api.get("/reports/pl", { params: { start_date: `${y}-01-01`, end_date: endDate } }),
      ]);
      setYearOverview(yo.data);
      setOverview(ao.data);
      setPl(plRes.data);
    } catch (e) {
      setMsg(`Load failed: ${e.response?.data?.detail || e.message}`);
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentYear]);

  useEffect(() => { load(year); }, [year, load]);

  const topClient = pl?.top_clients?.[0];
  const otherClients = pl?.top_clients?.slice(1, 4) || [];
  const topDog = pl?.top_dogs?.[0];
  const otherDogs = pl?.top_dogs?.slice(1, 4) || [];
  const ready = !loading && yearOverview && overview && pl;

  return (
    <div className="space-y-6 animate-slide-in" data-testid="year-in-review-screen">
      <style>{`@media print { .no-print{display:none!important;} body{background:white!important;} .print-card{background:white!important;color:black!important;border-color:#ccc!important;} .print-card *{color:black!important;} }`}</style>

      <div className="no-print">
        <PageHero
          eyebrow={{ icon: "fa-star", text: "Look back", color: "text-shPrimary" }}
          title="Year in Review."
          highlight={`Your ${year}.`}
          subtitle="Every milestone, record, and best month — all in one place."
          testid="year-in-review-hero"
          right={(
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={() => setYear((y) => y - 1)} disabled={year <= 2000} data-testid="yir-year-prev"
                      className="bg-[#10151f] border border-shBorder text-shText w-9 h-9 rounded-lg hover:border-shSecondary transition disabled:opacity-40">
                <i className="fas fa-chevron-left"/>
              </button>
              <span className="text-[18px] font-black text-shText w-16 text-center" data-testid="yir-year-label">{year}</span>
              <button onClick={() => setYear((y) => y + 1)} disabled={year >= currentYear} data-testid="yir-year-next"
                      className="bg-[#10151f] border border-shBorder text-shText w-9 h-9 rounded-lg hover:border-shSecondary transition disabled:opacity-40">
                <i className="fas fa-chevron-right"/>
              </button>
              <button onClick={() => window.print()} data-testid="yir-print"
                      className="bg-shPrimary text-bgHeader px-4 py-2.5 rounded-lg text-[13px] font-black uppercase tracking-widest shadow hover:bg-shPrimary/90 transition">
                <i className="fas fa-print mr-1.5"/>Print
              </button>
            </div>
          )}
        />
      </div>

      {msg && (
        <div className="bg-red-500/10 border border-red-500/40 text-red-400 px-4 py-2.5 rounded-lg text-[13px]" data-testid="yir-msg">
          {msg}
        </div>
      )}

      {loading && <p className="text-shTextMuted">Loading your year…</p>}

      {ready && (
        <>
          {/* Hero net profit banner */}
          <div className="print-card bg-[#10151f] border border-shPrimary/30 rounded-xl p-8 text-center" data-testid="yir-net-hero">
            <p className="text-[13px] font-black uppercase tracking-widest text-shTextMuted">Net Profit — {year}</p>
            <p className="text-[48px] font-black text-shPrimary mt-1">{fmt(yearOverview.net_total)}</p>
            {yearOverview.prior_year?.net_change_pct != null && (
              <p className="mt-1"><ChangeBadge pct={yearOverview.prior_year.net_change_pct} /></p>
            )}
          </div>

          {/* Headline stat grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4" data-testid="yir-stat-strip">
            <StatTile label="Gross Revenue" value={fmt(yearOverview.gross_total)} valueColor="text-shPrimary"
              sub={yearOverview.prior_year?.gross_change_pct != null ? `${yearOverview.prior_year.gross_change_pct >= 0 ? "↑" : "↓"} ${Math.abs(yearOverview.prior_year.gross_change_pct)}% vs last year` : null}
              subColor={yearOverview.prior_year?.gross_change_pct >= 0 ? "text-shPrimary font-black" : "text-red-400 font-black"} />
            <StatTile label="Total Visits" value={overview.total_visits.toLocaleString()}
              sub={overview.visits_yoy_pct != null ? `${overview.visits_yoy_pct >= 0 ? "↑" : "↓"} ${Math.abs(overview.visits_yoy_pct)}% vs last year` : null}
              subColor={overview.visits_yoy_pct >= 0 ? "text-shPrimary font-black" : "text-red-400 font-black"} />
            <StatTile label="New Clients" value={overview.new_clients_total.toLocaleString()} sub="this year" />
            <StatTile label="Expenses" value={fmt(yearOverview.expenses_total)} valueColor="text-red-400" />
            <StatTile label="Sales Tax Collected" value={fmt(pl.income.sales_tax_collected)} valueColor="text-shSecondary" sub="pass-through, not income" />
          </div>

          {/* The shape of the year */}
          <Card title={`The Shape of Your Year — ${year}`} testid="yir-shape">
            <MonthlyBarChart points={yearOverview.by_month} />
          </Card>

          {/* Best month / best week */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="print-card bg-[#10151f] border border-shAccent/20 rounded-xl p-5">
              <p className="text-[13px] font-black uppercase tracking-widest text-shTextMuted mb-2">🏅 Best Month</p>
              {yearOverview.best_month ? (
                <>
                  <p className="text-[20px] font-black text-shText">{yearOverview.best_month.label}</p>
                  <p className="text-[22px] font-black text-shPrimary">{fmt(yearOverview.best_month.total)}</p>
                </>
              ) : <p className="text-shTextMuted italic">No revenue yet this year</p>}
            </div>
            <div className="print-card bg-[#10151f] border border-shAccent/20 rounded-xl p-5">
              <p className="text-[13px] font-black uppercase tracking-widest text-shTextMuted mb-2">🔥 Best Week</p>
              {yearOverview.best_week ? (
                <>
                  <p className="text-[20px] font-black text-shText">{yearOverview.best_week.week_start} → {yearOverview.best_week.week_end}</p>
                  <p className="text-[22px] font-black text-shPrimary">{fmt(yearOverview.best_week.total)}</p>
                </>
              ) : <p className="text-shTextMuted italic">No revenue yet this year</p>}
            </div>
          </div>

          {/* MVPs — client and dog of the year */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" data-testid="yir-mvps">
            <div className="print-card bg-[#10151f] border border-shSecondary/20 rounded-xl p-5">
              <p className="text-[13px] font-black uppercase tracking-widest text-shTextMuted mb-3">🏆 Client of the Year</p>
              {topClient ? (
                <>
                  <p className="text-[22px] font-black text-shText">{topClient.name}</p>
                  <p className="text-[15px] text-shSecondary font-black">{fmt(topClient.total)} · {topClient.visits} visit{topClient.visits === 1 ? "" : "s"}</p>
                  {otherClients.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-shBorder/60 space-y-1">
                      {otherClients.map((c, i) => (
                        <p key={c.client_id} className="text-[12px] text-shTextMuted">#{i + 2} {c.name} — {fmt(c.total)}</p>
                      ))}
                    </div>
                  )}
                </>
              ) : <p className="text-shTextMuted italic">No client revenue yet this year</p>}
            </div>
            <div className="print-card bg-[#10151f] border border-purple-400/20 rounded-xl p-5">
              <p className="text-[13px] font-black uppercase tracking-widest text-shTextMuted mb-3">🐾 Dog of the Year</p>
              {topDog ? (
                <>
                  <p className="text-[22px] font-black text-shText">{topDog.name}</p>
                  <p className="text-[15px] text-purple-400 font-black">{topDog.visits} visit{topDog.visits === 1 ? "" : "s"}</p>
                  {otherDogs.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-shBorder/60 space-y-1">
                      {otherDogs.map((d, i) => (
                        <p key={d.dog_id} className="text-[12px] text-shTextMuted">#{i + 2} {d.name} — {d.visits} visits</p>
                      ))}
                    </div>
                  )}
                </>
              ) : <p className="text-shTextMuted italic">No visits yet this year</p>}
            </div>
          </div>

          {/* Where the money came from / top sellers */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card title="Where the Money Came From" testid="yir-service-mix">
              <ServiceMixBars mix={overview.service_mix} />
            </Card>
            <Card title="Top Sellers" testid="yir-top-sellers">
              <RankedBars items={overview.top_sellers} labelOf={(p) => p.name} valueOf={(p) => p.units} valueLabelOf={(p) => `${p.units} sold`} emptyText="No retail sales yet this year" />
            </Card>
          </div>

          {/* All-time fun stats */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" data-testid="yir-fun-stats">
            <FunStatTile icon="🐾" variant="primary" label="Dogs Served All-Time" value={overview.fun_stats.dogs_served_all_time.toLocaleString()} />
            <FunStatTile icon="📅" variant="secondary" label="Busiest Day Ever" value={overview.fun_stats.busiest_day_ever ? `${prettyDate(overview.fun_stats.busiest_day_ever.date)} — ${overview.fun_stats.busiest_day_ever.count} visits` : "—"} />
            <FunStatTile icon="💰" variant="purple" label="Biggest Single Sale Ever" value={overview.fun_stats.biggest_single_sale ? fmt(overview.fun_stats.biggest_single_sale.amount) : "—"} />
          </div>
        </>
      )}
    </div>
  );
}
