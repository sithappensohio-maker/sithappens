import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import PageHero from "../components/PageHero";
import { todayISO } from "../lib/date";

function fmt(n) {
  const v = Number(n) || 0;
  return v < 0 ? `-$${Math.abs(v).toFixed(2)}` : `$${v.toFixed(2)}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function Tile({ label, value, accent = "text-shText" }) {
  return (
    <div className="bg-[#0a0f18] border border-shBorder rounded-lg px-3 py-2.5 text-center">
      <p className="text-[10px] font-black uppercase tracking-widest text-shTextMuted mb-1">{label}</p>
      <p className={`text-[18px] font-black ${accent}`}>{value}</p>
    </div>
  );
}

function SectionTable({ title, accent, rows, totalLabel = "TOTAL", totalValue, cols }) {
  if (!rows || !rows.length) return null;
  return (
    <div className="mb-5">
      <p className={`text-[12px] font-black uppercase tracking-widest mb-2 ${accent}`}>{title}</p>
      <div className="overflow-x-auto rounded-lg border border-shBorder">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-[#0a0f18] text-shTextMuted uppercase text-[10px] tracking-widest">
              {cols.map((c) => <th key={c} className="px-3 py-2 text-left">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-shBorder/50">
                {r.map((cell, j) => <td key={j} className={`px-3 py-1.5 ${j === 0 ? "text-shText" : "text-right text-shTextMuted"}`}>{cell}</td>)}
              </tr>
            ))}
            {totalValue != null && (
              <tr className="border-t border-shBorder font-black">
                <td className="px-3 py-1.5" colSpan={cols.length - 1}>{totalLabel}</td>
                <td className="px-3 py-1.5 text-right text-shText">{totalValue}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MonthDetail({ detail, onDownloadPdf, pdfBusy }) {
  const pl = detail.pl;
  const tax = detail.sales_tax;
  const pm = detail.payment_methods || {};
  const gc = detail.gift_cards;
  const mi = detail.mileage;
  const net = pl.net;

  return (
    <div className="bg-[#10151f] border border-shAccent/20 rounded-xl p-5 mt-3" data-testid="mr-detail">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <p className="text-[16px] font-black text-shText">{detail.label} <span className="text-shTextMuted font-normal text-[12px]">· {detail.start_date} → {detail.end_date}</span></p>
        <button onClick={onDownloadPdf} disabled={pdfBusy} data-testid="mr-detail-pdf"
                className="bg-[#10151f] border border-shSecondary/40 text-shSecondary px-3 py-2 rounded-lg text-[12px] font-black uppercase tracking-widest hover:bg-shSecondary/10 disabled:opacity-50 transition">
          <i className={`fas ${pdfBusy ? "fa-spinner fa-spin" : "fa-file-pdf"} mr-1.5`}/>Download PDF
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-5">
        <Tile label="Revenue" value={fmt(pl.income.net_total)} accent="text-shPrimary" />
        <Tile label="Expenses" value={fmt(pl.expenses.total)} accent="text-red-400" />
        <Tile label="Payroll" value={fmt(pl.payroll.total_cost)} accent="text-red-400" />
        <Tile label="Sales Tax" value={fmt(tax.total_tax_collected)} accent="text-shSecondary" />
        <Tile label="Net Profit" value={fmt(net)} accent={net >= 0 ? "text-shPrimary" : "text-red-400"} />
      </div>

      <SectionTable title="Income by Service" accent="text-shPrimary" cols={["Service", "Count", "Total"]}
        rows={(pl.income.by_service || []).map((s) => [s.name, s.count, fmt(s.total)])}
        totalValue={fmt(pl.income.by_service.reduce((a, s) => a + s.total, 0))} />

      <SectionTable title="Retail Sales" accent="text-purple-400" cols={["Category", "Items", "Total"]}
        rows={(pl.retail?.by_category || []).map((c) => [c.name, c.count, fmt(c.total)])}
        totalValue={pl.retail?.by_category?.length ? fmt(pl.retail.total) : null} />

      <SectionTable title="Training Program Revenue" accent="text-shAccent" cols={["Program", "Sales", "Total"]}
        rows={(pl.training_revenue?.by_program || []).map((p) => [p.name, p.count, fmt(p.total)])}
        totalValue={pl.training_revenue?.by_program?.length ? fmt(pl.training_revenue.total) : null} />

      <SectionTable title="Payment Method Breakdown" accent="text-shAccent" cols={["Method", "Amount"]}
        rows={Object.entries(pm).filter(([, v]) => Math.abs(Number(v) || 0) >= 0.005).map(([k, v]) => [k.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase()), fmt(v)])}
        totalValue={Object.values(pm).length ? fmt(Object.values(pm).reduce((a, v) => a + (Number(v) || 0), 0)) : null} />

      <div className="mb-5">
        <p className="text-[12px] font-black uppercase tracking-widest mb-2 text-shAccent">Sales Tax Detail</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Tile label="Bookings Tax" value={fmt(tax.bookings_tax_total)} />
          <Tile label="Retail Tax" value={fmt(tax.retail_tax_total)} />
          <Tile label="Reversed" value={fmt(tax.tax_reversed)} />
          <Tile label="Net Liability" value={fmt(tax.total_tax_collected)} accent="text-shAccent" />
        </div>
        <p className="text-[11px] text-shTextMuted mt-2">Pass-through liability, owed to the state — already excluded from revenue above.</p>
      </div>

      <SectionTable title="Expenses by Category" accent="text-red-400" cols={["Category", "Items", "Total"]}
        rows={(pl.expenses.by_category || []).map((c) => [c.name, c.count, fmt(c.total)])}
        totalValue={pl.expenses.by_category?.length ? fmt(pl.expenses.total) : null} />

      <SectionTable title="Recurring Bills Paid" accent="text-red-400" cols={["Date", "Bill", "Category", "Amount"]}
        rows={(detail.bills_paid?.rows || []).map((b) => [b.date, b.vendor || b.name || "—", b.category || "—", fmt(b.amount)])}
        totalValue={detail.bills_paid?.rows?.length ? fmt(detail.bills_paid.total) : null} />
      {detail.bills_paid?.rows?.length > 0 && (
        <p className="text-[11px] text-shTextMuted -mt-3 mb-5">One-off (non-recurring) expenses: {fmt(detail.one_off_expenses_total)}</p>
      )}

      <div className="mb-5">
        <p className="text-[12px] font-black uppercase tracking-widest mb-2 text-red-400">Payroll Cost · clocked-in staff</p>
        {pl.payroll?.entry_count ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
              <Tile label="Hours" value={pl.payroll.total_hours.toFixed(1)} />
              <Tile label="Gross Wages" value={fmt(pl.payroll.gross)} />
              <Tile label="Employer Burden" value={fmt(pl.payroll.employer_burden)} />
              <Tile label="Total Cost" value={fmt(pl.payroll.total_cost)} accent="text-red-400" />
            </div>
            <SectionTable title="By Employee" accent="text-red-400" cols={["Employee", "Hours", "Rate", "Gross", "Burden", "Total"]}
              rows={(pl.payroll.per_employee || []).map((e) => [e.name, e.hours.toFixed(1), fmt(e.rate), fmt(e.gross), fmt(e.employer_burden), fmt(e.total_cost)])} />
          </>
        ) : <p className="text-[12px] text-shTextMuted italic">No completed time-clock entries this month — payroll cost is $0.</p>}
      </div>

      <div className="mb-5">
        <p className="text-[12px] font-black uppercase tracking-widest mb-2 text-purple-400">Gift Card Activity</p>
        <div className="grid grid-cols-2 gap-2">
          <Tile label={`Sold (${gc.sold_count})`} value={fmt(gc.sold_total)} />
          <Tile label={`Redeemed (${gc.redeemed_count})`} value={fmt(gc.redeemed_total)} />
        </div>
        <p className="text-[11px] text-shTextMuted mt-2">Sales already counted in Retail Sales above — informational only.</p>
      </div>

      {(mi.miles > 0 || mi.deduction > 0) && (
        <div className="mb-5">
          <p className="text-[12px] font-black uppercase tracking-widest mb-2 text-shPrimary">Mileage Deduction (Schedule C)</p>
          <div className="grid grid-cols-3 gap-2">
            <Tile label="Miles Logged" value={mi.miles.toFixed(1)} />
            <Tile label="IRS Rate" value={`$${mi.rate.toFixed(3)}/mi`} />
            <Tile label="Deduction" value={fmt(mi.deduction)} accent="text-shPrimary" />
          </div>
        </div>
      )}

      <SectionTable title="Top 5 Clients by Revenue" accent="text-shSecondary" cols={["Client", "Visits", "Revenue"]}
        rows={(pl.top_clients || []).map((c) => [c.name, c.visits, fmt(c.total)])} />
    </div>
  );
}

export default function MonthlyReports() {
  const currentYear = Number(todayISO().slice(0, 4));
  const [year, setYear] = useState(currentYear);
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [openMonth, setOpenMonth] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [pdfBusyKey, setPdfBusyKey] = useState(null);
  const [msg, setMsg] = useState("");

  const loadOverview = useCallback(async (y) => {
    setLoading(true);
    try {
      const { data } = await api.get("/reports/monthly/year-overview", { params: { year: y } });
      setOverview(data);
    } catch (e) {
      setMsg(`Load failed: ${e.response?.data?.detail || e.message}`);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadOverview(year); setOpenMonth(null); setDetail(null); }, [year, loadOverview]);

  const openMonthDetail = async (m) => {
    if (openMonth === m) { setOpenMonth(null); setDetail(null); return; }
    setOpenMonth(m);
    setDetail(null);
    setDetailLoading(true);
    try {
      const { data } = await api.get("/reports/monthly/detail", { params: { year, month: m }, timeout: 45000 });
      setDetail(data);
    } catch (e) {
      setMsg(`Load failed: ${e.code === "ECONNABORTED" ? "Timed out — try again." : (e.response?.data?.detail || e.message)}`);
    } finally { setDetailLoading(false); }
  };

  const downloadMonthPdf = async (m) => {
    const key = `m${m}`;
    setPdfBusyKey(key);
    try {
      const res = await api.get("/reports/monthly/detail/pdf", { params: { year, month: m }, responseType: "blob", timeout: 45000 });
      downloadBlob(res.data, `Monthly_Report_${year}-${String(m).padStart(2, "0")}.pdf`);
    } catch (e) {
      setMsg(`Download failed: ${e.code === "ECONNABORTED" ? "Timed out — try again, or check a smaller range." : (e.response?.data?.detail || e.message)}`);
    } finally { setPdfBusyKey(null); }
  };

  const downloadYearPdf = async () => {
    setPdfBusyKey("year");
    try {
      const res = await api.get("/reports/monthly/year-pdf", { params: { year }, responseType: "blob", timeout: 120000 });
      downloadBlob(res.data, `Monthly_Reports_${year}.pdf`);
    } catch (e) {
      setMsg(`Download failed: ${e.code === "ECONNABORTED" ? "Timed out — a full year is a lot of data, try one month at a time." : (e.response?.data?.detail || e.message)}`);
    } finally { setPdfBusyKey(null); }
  };

  return (
    <div className="space-y-6 animate-slide-in" data-testid="monthly-reports-screen">
      <PageHero
        eyebrow={{ icon: "fa-file-invoice-dollar", text: "Year-end & tax prep", color: "text-shPrimary" }}
        title="Monthly Reports."
        highlight="Every month, in one place."
        subtitle="A complete, printable financial report for any month — revenue, expenses, payroll, sales tax, and more."
        testid="monthly-reports-hero"
        right={(
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => setYear((y) => y - 1)} disabled={year <= 2000} data-testid="mr-year-prev"
                    className="bg-[#10151f] border border-shBorder text-shText w-9 h-9 rounded-lg hover:border-shSecondary transition disabled:opacity-40">
              <i className="fas fa-chevron-left"/>
            </button>
            <span className="text-[18px] font-black text-shText w-16 text-center" data-testid="mr-year-label">{year}</span>
            <button onClick={() => setYear((y) => y + 1)} disabled={year >= currentYear} data-testid="mr-year-next"
                    className="bg-[#10151f] border border-shBorder text-shText w-9 h-9 rounded-lg hover:border-shSecondary transition disabled:opacity-40">
              <i className="fas fa-chevron-right"/>
            </button>
            <button onClick={downloadYearPdf} disabled={pdfBusyKey === "year"} data-testid="mr-year-pdf"
                    className="bg-shSecondary text-bgHeader px-4 py-2.5 rounded-lg text-[13px] font-black uppercase tracking-widest shadow hover:bg-shSecondary/90 transition disabled:opacity-50">
              <i className={`fas ${pdfBusyKey === "year" ? "fa-spinner fa-spin" : "fa-file-pdf"} mr-1.5`}/>Full Year PDF
            </button>
          </div>
        )}
      />

      {msg && (
        <div className="bg-red-500/10 border border-red-500/40 text-red-400 px-4 py-2.5 rounded-lg text-[13px]" data-testid="mr-msg">
          {msg}
        </div>
      )}

      {loading ? (
        <p className="text-shTextMuted">Loading…</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3" data-testid="mr-grid">
          {overview?.months.map((m) => {
            const isOpen = openMonth === m.month;
            return (
              <div key={m.month}
                   className={`bg-[#10151f] border rounded-xl p-4 transition ${isOpen ? "border-shSecondary" : "border-shBorder"} ${m.available ? "" : "opacity-50"}`}
                   data-testid={`mr-month-${m.month}`}>
                <p className="text-[14px] font-black text-shText mb-2">{m.label} {year}</p>
                {m.available ? (
                  <>
                    <p className="text-[11px] text-shTextMuted">Revenue</p>
                    <p className="text-[16px] font-black text-shPrimary mb-1">{fmt(m.revenue)}</p>
                    <p className="text-[11px] text-shTextMuted">Net Profit</p>
                    <p className={`text-[16px] font-black mb-3 ${m.net >= 0 ? "text-shPrimary" : "text-red-400"}`}>{fmt(m.net)}</p>
                    <div className="flex gap-1.5">
                      <button onClick={() => openMonthDetail(m.month)} data-testid={`mr-month-${m.month}-view`}
                              className="flex-1 bg-[#0a0f18] border border-shBorder text-shText px-2 py-1.5 rounded text-[11px] font-black uppercase tracking-widest hover:border-shSecondary transition">
                        {isOpen ? "Close" : "View"}
                      </button>
                      <button onClick={() => downloadMonthPdf(m.month)} disabled={pdfBusyKey === `m${m.month}`} data-testid={`mr-month-${m.month}-pdf`}
                              className="bg-[#0a0f18] border border-shSecondary/40 text-shSecondary px-2 py-1.5 rounded text-[11px] font-black hover:bg-shSecondary/10 disabled:opacity-50 transition">
                        <i className={`fas ${pdfBusyKey === `m${m.month}` ? "fa-spinner fa-spin" : "fa-file-pdf"}`}/>
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="text-[12px] text-shTextMuted italic">Not yet available</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {openMonth != null && (
        detailLoading ? <p className="text-shTextMuted">Loading report…</p> :
        detail && <MonthDetail detail={detail} onDownloadPdf={() => downloadMonthPdf(openMonth)} pdfBusy={pdfBusyKey === `m${openMonth}`} />
      )}
    </div>
  );
}
