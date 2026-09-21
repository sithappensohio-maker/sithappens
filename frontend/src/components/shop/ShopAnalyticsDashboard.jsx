import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";

/**
 * What the shop did, on one screen.
 *
 * The temptation with a page like this is forty KPI cards. Forty numbers is
 * not information; it is a wall somebody stops reading after a week. So this
 * answers five questions in five blocks — what did we make, where do people
 * fall out, what sells, what do people search for, which departments earn —
 * and stops.
 *
 * There are no canvas charts. Every figure is text in a table, and the bars
 * that appear are decoration behind a number that is already written out.
 * That is not a compromise for accessibility; it is the more useful design
 * for a shop this size, where "4 of 11" beats a sparkline every time. It
 * also means nothing here depends on colour to be readable.
 */

const money = (n) => (n == null ? "—" : `$${Number(n).toFixed(2)}`);
const pct = (n) => (n == null ? "—" : `${Number(n).toFixed(1)}%`);
const num = (n) => (n == null ? "—" : Number(n).toLocaleString());

const RANGES = [
  { key: "today", label: "Today", days: 1 },
  { key: "7", label: "Last 7 days", days: 7 },
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "custom", label: "Custom", days: null },
];

function Card({ label, value, hint }) {
  return (
    <div className="border border-shBorder rounded-xl p-3" style={{ background: "var(--sh-card-base)" }}>
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-shTextMuted">{label}</p>
      <p className="text-[22px] font-black text-shText mt-1 leading-none">{value}</p>
      {hint && <p className="text-[11px] text-shTextMuted mt-1">{hint}</p>}
    </div>
  );
}

function Section({ title, children, note }) {
  return (
    <section className="mt-6">
      <h3 className="text-[12px] font-black uppercase tracking-[0.18em] text-shText">{title}</h3>
      {note && <p className="text-[11px] text-shTextMuted mt-0.5">{note}</p>}
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Empty({ children }) {
  return <p className="text-[12px] text-shTextMuted py-4">{children}</p>;
}

/**
 * A funnel as a table.
 *
 * Each step shows its own count AND the percentage that reached it from the
 * step above, because "142 visitors, 38 product viewers" is only half the
 * story without "27%". The bar is behind the text, never instead of it.
 */
function Funnel({ funnel }) {
  const steps = [
    ["Shop visitors", funnel.visitors, null],
    ["Viewed a product", funnel.product_viewers, funnel.rates?.visit_to_product_view],
    ["Added to cart", funnel.carts, funnel.rates?.product_view_to_cart],
    ["Started checkout", funnel.checkout_starts, funnel.rates?.cart_to_checkout],
    ["Completed an order", funnel.orders, funnel.rates?.checkout_to_order],
  ];
  const top = Math.max(1, funnel.visitors || 0);
  return (
    <table className="w-full text-[13px]" data-testid="shop-analytics-funnel">
      <caption className="sr-only">
        Shop funnel: visitors through to completed orders, with the share of the previous step.
      </caption>
      <thead>
        <tr className="text-left text-[10px] uppercase tracking-widest text-shTextMuted">
          <th scope="col" className="py-1">Step</th>
          <th scope="col" className="py-1 text-right">People</th>
          <th scope="col" className="py-1 text-right">Of previous</th>
        </tr>
      </thead>
      <tbody>
        {steps.map(([label, value, rate]) => (
          <tr key={label} className="border-t border-shBorder">
            <th scope="row" className="py-1.5 font-normal text-shText text-left">
              {/* The bar is clamped at 100%. A step CAN exceed the one above
                  it — orders are counted from paid orders while visitors are
                  counted from events, so a period holding old orders and new
                  analytics genuinely reads as more than 100%. The NUMBER
                  says so honestly; the bar just stops growing instead of
                  spilling six times the width of its own row, which is what
                  browser QA caught it doing. */}
              <span className="relative inline-block w-full">
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 left-0 bg-shPrimary/15 rounded"
                  style={{ width: `${Math.min(100, Math.round(((value || 0) / top) * 100))}%` }}
                />
                <span className="relative">{label}</span>
              </span>
            </th>
            <td className="py-1.5 text-right font-black text-shText tabular-nums">{num(value)}</td>
            <td className="py-1.5 text-right text-shTextMuted tabular-nums">{pct(rate)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ProductTable({ rows, testId, showFunnel = true }) {
  if (!rows || rows.length === 0) return <Empty>Nothing to show for this period yet.</Empty>;
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full text-[13px] min-w-[560px]" data-testid={testId}>
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-widest text-shTextMuted">
            <th scope="col" className="py-1">Product</th>
            <th scope="col" className="py-1 text-right">Views</th>
            <th scope="col" className="py-1 text-right">Cart adds</th>
            <th scope="col" className="py-1 text-right">Units</th>
            <th scope="col" className="py-1 text-right">Revenue</th>
            {showFunnel && <th scope="col" className="py-1 text-right">View → buy</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.kind}:${r.ref_id}`} className="border-t border-shBorder">
              <th scope="row" className="py-1.5 font-normal text-left text-shText">
                <span className="block truncate max-w-[220px]">{r.name}</span>
                <span className="text-[10px] uppercase tracking-widest text-shTextMuted">
                  {r.department || r.kind}
                  {/* Said in words, never only by greying the row out. */}
                  {!r.available && " · no longer listed"}
                </span>
              </th>
              <td className="py-1.5 text-right tabular-nums text-shText">{num(r.views)}</td>
              <td className="py-1.5 text-right tabular-nums text-shText">{num(r.cart_adds)}</td>
              <td className="py-1.5 text-right tabular-nums text-shText">{num(r.units)}</td>
              <td className="py-1.5 text-right tabular-nums font-black text-shText">{money(r.revenue)}</td>
              {showFunnel && (
                <td className="py-1.5 text-right tabular-nums text-shTextMuted">{pct(r.view_to_purchase)}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SearchTable({ rows, testId, emptyText }) {
  if (!rows || rows.length === 0) return <Empty>{emptyText}</Empty>;
  return (
    <table className="w-full text-[13px]" data-testid={testId}>
      <thead>
        <tr className="text-left text-[10px] uppercase tracking-widest text-shTextMuted">
          <th scope="col" className="py-1">Search</th>
          <th scope="col" className="py-1 text-right">Times</th>
          <th scope="col" className="py-1 text-right">People</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.query} className="border-t border-shBorder">
            <th scope="row" className="py-1.5 font-normal text-left text-shText">{r.query}</th>
            <td className="py-1.5 text-right tabular-nums text-shText">{num(r.searches)}</td>
            <td className="py-1.5 text-right tabular-nums text-shTextMuted">{num(r.sessions)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function ShopAnalyticsDashboard() {
  const [range, setRange] = useState("7");
  const [custom, setCustom] = useState({ start: "", end: "" });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const params = useMemo(() => {
    if (range === "custom") {
      if (!custom.start || !custom.end) return null;
      return { start: custom.start, end: custom.end };
    }
    return { days: RANGES.find((r) => r.key === range)?.days || 7 };
  }, [range, custom]);

  const load = useCallback(() => {
    if (!params) return;
    setLoading(true);
    setError("");
    api.get("/shop-manager/analytics/overview", { params })
      .then(({ data: d }) => setData(d))
      .catch((e) => setError(e?.response?.data?.detail || "Could not load Shop analytics"))
      .finally(() => setLoading(false));
  }, [params]);

  useEffect(() => { load(); }, [load]);

  const sales = data?.sales;
  const audience = data?.splits?.audience || {};
  const device = data?.splits?.device || {};

  return (
    <div data-testid="shop-analytics-dashboard">
      <div className="flex items-end gap-2 flex-wrap">
        <div role="group" aria-label="Date range" className="flex gap-1.5 flex-wrap">
          {RANGES.map((r) => (
            <button key={r.key} type="button" onClick={() => setRange(r.key)}
                    aria-pressed={range === r.key}
                    data-testid={`shop-analytics-range-${r.key}`}
                    className={`text-[11px] font-black uppercase tracking-widest px-2.5 py-1.5 rounded-lg border transition
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-shPrimary
                      ${range === r.key ? "border-shPrimary/60 bg-shPrimary/10 text-shPrimary"
                                        : "border-shBorder text-shTextMuted hover:text-shText"}`}>
              {r.label}
            </button>
          ))}
        </div>
        {range === "custom" && (
          <div className="flex items-end gap-2">
            <label className="text-[10px] uppercase tracking-widest text-shTextMuted">
              From
              <input type="date" value={custom.start} data-testid="shop-analytics-start"
                     onChange={(e) => setCustom((c) => ({ ...c, start: e.target.value }))}
                     className="block bg-black/20 border border-shBorder rounded px-2 py-1 text-shText text-[12px]" />
            </label>
            <label className="text-[10px] uppercase tracking-widest text-shTextMuted">
              To
              <input type="date" value={custom.end} data-testid="shop-analytics-end"
                     onChange={(e) => setCustom((c) => ({ ...c, end: e.target.value }))}
                     className="block bg-black/20 border border-shBorder rounded px-2 py-1 text-shText text-[12px]" />
            </label>
          </div>
        )}
      </div>

      {loading && <p className="text-shTextMuted text-sm py-6" data-testid="shop-analytics-loading">Loading…</p>}
      {error && <p className="text-shDanger text-sm py-4" role="alert">{error}</p>}

      {!loading && !error && data && (
        <>
          <p className="text-[11px] text-shTextMuted mt-3" data-testid="shop-analytics-range-label">
            {data.range.start} to {data.range.end}
          </p>

          <Section title="Sales">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
              <Card label="Revenue" value={money(sales.revenue)}
                    hint={sales.orders === 0 ? "No completed orders yet" : "Completed orders, net of refunds"} />
              <Card label="Orders" value={num(sales.orders)}
                    hint={`${num(sales.guest_orders)} guest · ${num(sales.account_orders)} account`} />
              <Card label="Units sold" value={num(sales.units)} />
              <Card label="Average order" value={money(sales.average_order_value)} />
            </div>
          </Section>

          <Section title="Funnel"
                   note="People, not page views — each step counts distinct shopping sessions. Orders come from paid orders, never from the browser.">
            <Funnel funnel={data.funnel} />
            <p className="text-[11px] text-shTextMuted mt-2" data-testid="shop-analytics-splits">
              Visitors: {num(audience.true)} guest · {num(audience.false)} signed in ·
              {" "}{num(device.mobile)} mobile · {num(device.tablet)} tablet · {num(device.desktop)} desktop
            </p>
          </Section>

          <Section title="Departments">
            {data.departments.length === 0 ? <Empty>No sales in this period.</Empty> : (
              <table className="w-full text-[13px]" data-testid="shop-analytics-departments">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-widest text-shTextMuted">
                    <th scope="col" className="py-1">Department</th>
                    <th scope="col" className="py-1 text-right">Orders</th>
                    <th scope="col" className="py-1 text-right">Units</th>
                    <th scope="col" className="py-1 text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {data.departments.map((d) => (
                    <tr key={d.department} className="border-t border-shBorder">
                      <th scope="row" className="py-1.5 font-normal text-left text-shText">{d.label}</th>
                      <td className="py-1.5 text-right tabular-nums text-shText">{num(d.orders)}</td>
                      <td className="py-1.5 text-right tabular-nums text-shText">{num(d.units)}</td>
                      <td className="py-1.5 text-right tabular-nums font-black text-shText">{money(d.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section title="Top products">
            <ProductTable rows={data.top_products} testId="shop-analytics-top-products" />
          </Section>

          <Section title="Looked at, not bought"
                   note="At least five views and no sales in this period — the products worth a better photo, a better price or a better description.">
            <ProductTable rows={data.viewed_not_bought} testId="shop-analytics-viewed-not-bought"
                          showFunnel={false} />
          </Section>

          <Section title="Best sellers"
                   note="Top 5 by units actually sold in the last 30 days, minimum 5 units. Nothing qualifies until the shop has sold enough for the badge to mean something.">
            {data.best_sellers.length === 0
              ? <Empty>Not enough completed sales yet for a Best Seller badge to be honest.</Empty>
              : (
                <ul className="text-[13px] space-y-1 list-none p-0 m-0" data-testid="shop-analytics-best-sellers">
                  {data.best_sellers.map((b, i) => (
                    <li key={b.ref_id} className="flex justify-between gap-3 border-t border-shBorder py-1.5">
                      <span className="text-shText truncate">{i + 1}. {b.name}</span>
                      <span className="text-shTextMuted tabular-nums shrink-0">
                        {num(b.units)} sold · {money(b.revenue)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
          </Section>

          <Section title="What people searched for">
            <div className="grid md:grid-cols-2 gap-5">
              <div>
                <h4 className="text-[11px] font-black uppercase tracking-widest text-shTextMuted mb-1">Most searched</h4>
                <SearchTable rows={data.searches.top_searches} testId="shop-analytics-top-searches"
                             emptyText="Nobody has used the search box in this period." />
              </div>
              <div>
                <h4 className="text-[11px] font-black uppercase tracking-widest text-shOrange mb-1">Found nothing</h4>
                <SearchTable rows={data.searches.zero_result_searches}
                             testId="shop-analytics-zero-results"
                             emptyText="Every search found something." />
              </div>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
