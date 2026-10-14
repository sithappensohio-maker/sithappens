import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { todayISO, daysAgoISO } from "../../lib/date";

/**
 * What the walk-up register sold.
 *
 * The Insights tab (ShopAnalyticsDashboard) answers "what did the online
 * Shop do" — it reads shop_orders and nothing else, so a register sale
 * never appears there. This is the register's own "what sells": units and
 * revenue by product/option from pos_sales, plus the stock sitting on the
 * shelf that hasn't moved in the period.
 */

const money = (n) => (n == null ? "—" : `$${Number(n).toFixed(2)}`);
const num = (n) => (n == null ? "—" : Number(n).toLocaleString());

const RANGES = [
  { key: "today", label: "Today", days: 1 },
  { key: "7", label: "Last 7 days", days: 7 },
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "custom", label: "Custom", days: null },
];

function Card({ label, value, hint }) {
  return (
    <div className="border border-shBorder rounded-xl p-3 overflow-hidden sh-theme-dashboard-overlay" style={{ background: "var(--sh-card-base)" }}>
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

function ProductsTable({ rows }) {
  if (!rows || rows.length === 0) return <Empty>No register sales in this period.</Empty>;
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full text-[13px] min-w-[420px]" data-testid="register-sales-products">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-widest text-shTextMuted">
            <th scope="col" className="py-1">Product</th>
            <th scope="col" className="py-1 text-right">Units</th>
            <th scope="col" className="py-1 text-right">Revenue</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.product_id}:${r.variant_id || ""}`} className="border-t border-shBorder">
              <th scope="row" className="py-1.5 font-normal text-left text-shText">
                <span className="block truncate max-w-[280px]">{r.name}</span>
              </th>
              <td className="py-1.5 text-right tabular-nums text-shText">{num(r.units)}</td>
              <td className="py-1.5 text-right tabular-nums font-black text-shText">{money(r.revenue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NotSoldTable({ rows }) {
  if (!rows || rows.length === 0) return <Empty>Nothing — everything in stock sold at least once this period.</Empty>;
  return (
    <table className="w-full text-[13px]" data-testid="register-sales-not-sold">
      <thead>
        <tr className="text-left text-[10px] uppercase tracking-widest text-shTextMuted">
          <th scope="col" className="py-1">Product</th>
          <th scope="col" className="py-1 text-right">Stock on hand</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.product_id} className="border-t border-shBorder">
            <th scope="row" className="py-1.5 font-normal text-left text-shText">{r.name}</th>
            <td className="py-1.5 text-right tabular-nums text-shText">{num(r.stock_on_hand)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function RegisterSalesDashboard() {
  const [range, setRange] = useState("7");
  const [custom, setCustom] = useState({ start: "", end: "" });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const params = useMemo(() => {
    if (range === "custom") {
      if (!custom.start || !custom.end) return null;
      return { start_date: custom.start, end_date: custom.end };
    }
    const days = RANGES.find((r) => r.key === range)?.days || 7;
    return { start_date: daysAgoISO(days - 1), end_date: todayISO() };
  }, [range, custom]);

  const load = useCallback(() => {
    if (!params) return;
    setLoading(true);
    setError("");
    api.get("/admin/register/sales-by-product", { params })
      .then(({ data: d }) => setData(d))
      .catch((e) => setError(e?.response?.data?.detail || "Could not load register sales"))
      .finally(() => setLoading(false));
  }, [params]);

  useEffect(() => { load(); }, [load]);

  return (
    <div data-testid="register-sales-dashboard">
      <div className="flex items-end gap-2 flex-wrap">
        <div role="group" aria-label="Date range" className="flex gap-1.5 flex-wrap">
          {RANGES.map((r) => (
            <button key={r.key} type="button" onClick={() => setRange(r.key)}
                    aria-pressed={range === r.key}
                    data-testid={`register-sales-range-${r.key}`}
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
              <input type="date" value={custom.start} data-testid="register-sales-start"
                     onChange={(e) => setCustom((c) => ({ ...c, start: e.target.value }))}
                     className="block bg-black/20 border border-shBorder rounded px-2 py-1 text-shText text-[12px]" />
            </label>
            <label className="text-[10px] uppercase tracking-widest text-shTextMuted">
              To
              <input type="date" value={custom.end} data-testid="register-sales-end"
                     onChange={(e) => setCustom((c) => ({ ...c, end: e.target.value }))}
                     className="block bg-black/20 border border-shBorder rounded px-2 py-1 text-shText text-[12px]" />
            </label>
          </div>
        )}
      </div>

      {loading && <p className="text-shTextMuted text-sm py-6" data-testid="register-sales-loading">Loading…</p>}
      {error && <p className="text-shDanger text-sm py-4" role="alert">{error}</p>}

      {!loading && !error && data && (
        <>
          <p className="text-[11px] text-shTextMuted mt-3" data-testid="register-sales-range-label">
            {data.range.start_date} to {data.range.end_date}
          </p>

          <Section title="Register Sales">
            <div className="grid grid-cols-2 gap-2.5">
              <Card label="Units sold" value={num(data.totals.units)} />
              <Card label="Revenue" value={money(data.totals.revenue)} hint="Pre-tax, net of returns" />
            </div>
          </Section>

          <Section title="By product"
                   note="Every option sold at least once in this period, highest revenue first.">
            <ProductsTable rows={data.products} />
          </Section>

          <Section title="Not moving"
                   note="In stock, shown at the register, and sold zero units in this period.">
            <NotSoldTable rows={data.not_sold} />
          </Section>
        </>
      )}
    </div>
  );
}
