import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { useConfirm } from "../lib/useConfirm";
import CollapsibleDateGroups from "../components/CollapsibleDateGroups";
import PageHero from "../components/PageHero";
import { compressImage } from "../lib/imageCompress";
import Lightbox from "../components/Lightbox";
import { todayISO, localISOFromDate, parseLocalISO } from "../lib/date";
import AccountsReceivableTab from "./AccountsReceivable";
import TakePaymentModal from "../components/TakePaymentModal";

function fmt(n) { return `$${(Number(n) || 0).toFixed(2)}`; }

const PAYMENT_STATUSES = [
  { key: "unpaid",       label: "Unpaid",   color: "bg-shOrange/15 text-shOrange" },
  { key: "paid",         label: "Paid",     color: "bg-shGreen/15 text-shGreen" },
  { key: "paid_partial", label: "Partial",  color: "bg-amber-500/15 text-amber-300" },
  { key: "comped",       label: "Comped",   color: "bg-shBlue/15 text-shBlue" },
  { key: "refunded",     label: "Refunded", color: "bg-red-500/15 text-red-400" },
];

const PAYMENT_METHODS = ["cash", "card", "transfer", "credits", "other"];

export default function Income() {
  const confirm = useConfirm();
  // Sprint 110di-51 — Top-level tabs. "transactions" is the existing
  // ledger/range/expenses view. "ar" is the new Accounts Receivable
  // (per-client tab / partial-pay summary) view.
  const [tab, setTab] = useState("transactions");
  const [summary, setSummary] = useState(null);
  const [refDate, setRefDate] = useState(todayISO());
  const [rangeSummary, setRangeSummary] = useState(null);
  const [rangePreset, setRangePreset] = useState("month"); // month | quarter | ytd | custom
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  const [rows, setRows] = useState([]);
  const [services, setServices] = useState([]);
  const [dogs, setDogs] = useState([]);
  const [logOpen, setLogOpen] = useState(false);
  const [plBusy, setPlBusy] = useState(false);
  const [plMsg, setPlMsg] = useState("");
  const [filters, setFilters] = useState({ dog_id: "", service_id: "", payment_status: "", status: "" });
  const [showLegacy, setShowLegacy] = useState(false);
  const [groupByDate, setGroupByDate] = useState(true);  // Sprint 110dl — default ON, compact Month → Day
  const [search, setSearch] = useState("");
  const [savingId, setSavingId] = useState(null);
  const [editErr, setEditErr] = useState(""); // ephemeral toast-style error for inline edits
  // Sprint 110eg-3 — Monthly P&L auto-email status (cron fires on the 1st)
  const [plAutoStatus, setPlAutoStatus] = useState(null);

  // ── Expenses (tracked in the same date range as the Range View above)
  const [expenses, setExpenses] = useState([]);
  const [expCategories, setExpCategories] = useState([]);
  const [expOpen, setExpOpen] = useState(false);
  const [expEditing, setExpEditing] = useState(null);

  // ── Retail sales (external POS — flows into the same NET total above)
  const [retailSales, setRetailSales] = useState([]);
  const [retailCategories, setRetailCategories] = useState([]);
  const [retailOpen, setRetailOpen] = useState(false);
  // Sprint 110di-61 — Cash-register "Take Payment" modal (standalone).
  const [takePaymentOpen, setTakePaymentOpen] = useState(false);
  const [retailEditing, setRetailEditing] = useState(null);
  const [clients, setClients] = useState([]);

  const loadExpenses = async () => {
    if (!rangeStart || !rangeEnd) return;
    try {
      const [{ data }, { data: cats }] = await Promise.all([
        api.get("/expenses", { params: { start_date: rangeStart, end_date: rangeEnd } }),
        api.get("/expenses/categories"),
      ]);
      setExpenses(data || []);
      setExpCategories(cats?.categories || []);
    } catch (e) { console.warn("expenses load failed", e); }
  };
  useEffect(() => { loadExpenses(); /* eslint-disable-next-line */ }, [rangeStart, rangeEnd]);

  const loadRetail = async () => {
    if (!rangeStart || !rangeEnd) return;
    try {
      const [{ data }, { data: cats }] = await Promise.all([
        api.get("/retail-sales", { params: { start_date: rangeStart, end_date: rangeEnd } }),
        api.get("/retail-sales/categories"),
      ]);
      setRetailSales(data || []);
      setRetailCategories(cats?.categories || []);
    } catch (e) { console.warn("retail load failed", e); }
  };
  useEffect(() => { loadRetail(); /* eslint-disable-next-line */ }, [rangeStart, rangeEnd]);

  // Clients list (loaded once) — used by the retail-sale modal to optionally tag a sale to a client
  useEffect(() => {
    api.get("/clients").then(r => setClients(r.data || [])).catch(()=>{});
  }, []);

  // Sprint 110eg-3 — Surface the monthly P&L auto-email status near the
  // "Email Me" button so the operator can see at-a-glance whether the
  // cron is configured and when the last email went out.
  useEffect(() => {
    api.get("/admin/pl-monthly-status").then(r => setPlAutoStatus(r.data)).catch(()=>{});
  }, []);

  const refreshAfterExpenseChange = () => {
    loadExpenses();
    // re-pull range summary so the Net tile updates
    if (rangeStart && rangeEnd) {
      api.get("/transactions/summary-range", { params: { start_date: rangeStart, end_date: rangeEnd } })
         .then(r => setRangeSummary(r.data))
         .catch(()=>{});
    }
  };

  const refreshAfterRetailChange = () => {
    loadRetail();
    if (rangeStart && rangeEnd) {
      api.get("/transactions/summary-range", { params: { start_date: rangeStart, end_date: rangeEnd } })
         .then(r => setRangeSummary(r.data))
         .catch(()=>{});
    }
    // weekly tile also needs a refresh so the retail count chip updates
    api.get("/transactions/weekly-summary", { params: { ref_date: refDate } })
       .then(r => setSummary(r.data))
       .catch(()=>{});
  };

  const removeExpense = async (e) => {
    if (!(await confirm({ title: "Remove expense?", body: `"${e.description}" on ${e.date} (${fmt(e.amount)}) will be permanently removed.`, confirmText: "Remove", tone: "danger" }))) return;
    try {
      await api.delete(`/expenses/${e.id}`);
      refreshAfterExpenseChange();
    } catch (err) { setEditErr(`Delete failed: ${err.response?.data?.detail || err.message}`); }
  };

  const removeRetail = async (r) => {
    if (!(await confirm({ title: "Remove retail sale?", body: `"${r.description}" on ${r.date} (${fmt(r.amount)}) will be permanently removed.`, confirmText: "Remove", tone: "danger" }))) return;
    try {
      await api.delete(`/retail-sales/${r.id}`);
      refreshAfterRetailChange();
    } catch (err) { setEditErr(`Delete failed: ${err.response?.data?.detail || err.message}`); }
  };

  const load = async () => {
    const [s, sum, svcs, ds] = await Promise.all([
      api.get("/transactions", { params: { revenue_only: !showLegacy } }),
      api.get("/transactions/weekly-summary", { params: { ref_date: refDate } }),
      api.get("/services"),
      api.get("/dogs"),
    ]);
    setRows(s.data); setSummary(sum.data); setServices(svcs.data); setDogs(ds.data);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [refDate, showLegacy]);

  // Compute preset range start/end (Month / Quarter / YTD anchored to refDate)
  useEffect(() => {
    if (rangePreset === "custom") return;
    const d = parseLocalISO(refDate);
    let s, e;
    if (rangePreset === "month") {
      s = new Date(d.getFullYear(), d.getMonth(), 1);
      e = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    } else if (rangePreset === "quarter") {
      const qStart = Math.floor(d.getMonth() / 3) * 3;
      s = new Date(d.getFullYear(), qStart, 1);
      e = new Date(d.getFullYear(), qStart + 3, 0);
    } else if (rangePreset === "ytd") {
      s = new Date(d.getFullYear(), 0, 1);
      e = d;
    }
    setRangeStart(localISOFromDate(s));
    setRangeEnd(localISOFromDate(e));
  }, [rangePreset, refDate]);

  // Load range summary whenever range changes
  useEffect(() => {
    if (!rangeStart || !rangeEnd) return;
    let cancelled = false;
    api.get("/transactions/summary-range", { params: { start_date: rangeStart, end_date: rangeEnd } })
       .then(r => !cancelled && setRangeSummary(r.data))
       .catch(()=>{});
    return () => { cancelled = true; };
  }, [rangeStart, rangeEnd]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return rows.filter(r => {
      if (filters.dog_id && r.dog_id !== filters.dog_id) return false;
      if (filters.service_id && r.service_id !== filters.service_id) return false;
      if (filters.payment_status && r.payment_status !== filters.payment_status) return false;
      if (filters.status && r.status !== filters.status) return false;
      if (q && !(r.dog_name + " " + r.client_name + " " + (r.service_name||r.service_type||"")).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, filters, search]);

  const exportCSV = () => {
    const header = ["date", "dog", "client", "service", "type", "actual_price", "status", "payment_status", "payment_method", "notes"];
    const lines = [header.join(",")];
    filtered.forEach(r => {
      const row = [
        r.date,
        r.dog_name, r.client_name,
        r.service_name || "",
        r.service_type || "",
        r.actual_price || 0,
        r.status, r.payment_status || "", r.payment_method || "",
        (r.notes || "").replace(/"/g, "'"),
      ].map(v => `"${String(v ?? "")}"`).join(",");
      lines.push(row);
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `income_${todayISO()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const inlineUpdate = async (r, patch) => {
    setSavingId(r.id);
    try {
      const { data } = await api.put(`/transactions/${r.id}`, patch);
      setRows(rs => rs.map(x => x.id === r.id ? { ...x, ...data } : x));
      const sum = await api.get("/transactions/weekly-summary", { params: { ref_date: refDate } });
      setSummary(sum.data);
    } catch (e) {
      setEditErr(`Update failed: ${e.response?.data?.detail || e.message}`);
      load();  // pull fresh values to revert local optimistic state
    } finally { setSavingId(null); }
  };

  const removeTxn = async (r) => {
    if (!(await confirm({ title: "Remove transaction?", body: `Transaction for ${r.dog_name} on ${r.date} will be permanently removed from your income log.`, confirmText: "Remove", tone: "danger" }))) return;
    await api.delete(`/transactions/${r.id}`);
    load();
  };

  const downloadPL = async () => {
    if (!rangeStart || !rangeEnd) { setPlMsg("Pick a date range first"); return; }
    setPlBusy(true); setPlMsg("");
    try {
      const res = await api.get("/reports/pl/pdf", {
        params: { start_date: rangeStart, end_date: rangeEnd },
        responseType: "blob",
      });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url; a.download = `PL_${rangeStart}_to_${rangeEnd}.pdf`; a.click();
      URL.revokeObjectURL(url);
      setPlMsg("Downloaded");
      setTimeout(()=>setPlMsg(""), 2500);
    } catch (e) {
      setPlMsg(`Download failed: ${e.response?.data?.detail || e.message}`);
    } finally { setPlBusy(false); }
  };

  const emailPL = async () => {
    if (!rangeStart || !rangeEnd) { setPlMsg("Pick a date range first"); return; }
    if (!(await confirm({ title: "Email P&L Report?", body: `Send a Profit & Loss PDF for ${rangeStart} → ${rangeEnd} to your admin notification email.`, confirmText: "Send", tone: "info" }))) return;
    setPlBusy(true); setPlMsg("");
    try {
      const { data } = await api.post("/reports/pl/email-now", null, {
        params: { start_date: rangeStart, end_date: rangeEnd },
      });
      setPlMsg(`Sent to ${data.to} · Net $${(data.net||0).toFixed(2)}`);
      setTimeout(()=>setPlMsg(""), 4000);
    } catch (e) {
      setPlMsg(`Email failed: ${e.response?.data?.detail || e.message}`);
    } finally { setPlBusy(false); }
  };

  return (
    <div className="space-y-6 animate-slide-in" data-testid="income-screen">
      {editErr && (
        <div className="fixed top-4 right-4 z-[70] bg-red-500/95 text-white px-4 py-2.5 rounded-lg shadow-xl flex items-center gap-2 animate-slide-in" data-testid="income-edit-err">
          <i className="fas fa-exclamation-triangle"/>
          <span className="text-[15px] font-bold">{editErr}</span>
          <button onClick={()=>setEditErr("")} className="ml-2 text-white/80 hover:text-white"><i className="fas fa-times"/></button>
        </div>
      )}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <PageHero
          eyebrow={{ icon: "fa-dollar-sign", text: "Money in, money out", color: "text-shGreen" }}
          title="Income & Services."
          highlight="The cash story."
          subtitle="Weekly tally, transaction log, and quick service entry."
          right={(
            <div className="flex gap-2 flex-wrap">
              <button onClick={exportCSV} data-testid="income-export-csv"
                      className="bg-bgBase border border-bgHover text-gray-200 px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest hover:border-shBlue transition">
                <i className="fas fa-file-csv mr-1"/>Export CSV
              </button>
              <button onClick={downloadPL} disabled={plBusy} data-testid="pl-download-btn"
                      className="bg-bgBase border border-shBlue/40 text-shBlue px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest hover:bg-shBlue/10 disabled:opacity-50 transition">
                <i className={`fas ${plBusy ? "fa-spinner fa-spin" : "fa-file-pdf"} mr-1`}/>P&L PDF
              </button>
              <button onClick={emailPL} disabled={plBusy} data-testid="pl-email-btn"
                      className="bg-bgBase border border-shOrange/40 text-shOrange px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest hover:bg-shOrange/10 disabled:opacity-50 transition">
                <i className="fas fa-envelope mr-1"/>Email Me
              </button>
              <button onClick={()=>{ setRetailEditing(null); setRetailOpen(true); }} data-testid="retail-add-btn"
                      className="bg-purple-500/20 text-purple-300 border border-purple-500/40 px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest hover:bg-purple-500/30 transition">
                <i className="fas fa-bag-shopping mr-1"/>Log Retail Sale
              </button>
              <button onClick={()=>setLogOpen(true)} data-testid="income-log-service-btn"
                      className="bg-shGreen text-bgHeader px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest hover:bg-shGreen/90 transition">
                <i className="fas fa-plus mr-1"/>Log Service
              </button>
            </div>
          )}
          testid="income-hero"
        />
      </div>
      {/* Sprint 110di-51 — Tab strip: Transactions vs Accounts Receivable */}
      <div className="flex items-center gap-1 border-b border-bgHover" data-testid="income-tabs">
        <button onClick={()=>setTab("transactions")} data-testid="income-tab-transactions"
                className={`px-4 py-2.5 text-[12px] font-black uppercase tracking-widest border-b-2 transition ${tab==="transactions" ? "text-shGreen border-shGreen" : "text-gray-400 border-transparent hover:text-shGreen/80"}`}>
          <i className="fas fa-list mr-1.5"/>Transactions
        </button>
        <button onClick={()=>setTab("ar")} data-testid="income-tab-ar"
                className={`px-4 py-2.5 text-[12px] font-black uppercase tracking-widest border-b-2 transition ${tab==="ar" ? "text-shOrange border-shOrange" : "text-gray-400 border-transparent hover:text-shOrange/80"}`}>
          <i className="fas fa-file-invoice-dollar mr-1.5"/>Accounts Receivable
        </button>
      </div>
      {tab === "ar" ? (
        <AccountsReceivableTab />
      ) : (
      <>
      {plMsg && (
        <div className="bg-shBlue/10 border border-shBlue/30 text-shBlue px-4 py-2 rounded text-[14px] font-black uppercase tracking-widest" data-testid="pl-status">
          <i className="fas fa-circle-info mr-2"/>{plMsg} · range {rangeStart} → {rangeEnd}
        </div>
      )}
      {/* Sprint 110eg-3 — Monthly P&L auto-email status indicator. */}
      {plAutoStatus && (
        <div
          className={`px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest flex items-center gap-2 flex-wrap ${
            plAutoStatus.enabled
              ? "bg-shGreen/10 border border-shGreen/30 text-shGreen"
              : "bg-shOrange/10 border border-shOrange/30 text-shOrange"
          }`}
          data-testid="pl-auto-status"
        >
          <i className={`fas ${plAutoStatus.enabled ? "fa-calendar-check" : "fa-triangle-exclamation"}`}/>
          {plAutoStatus.enabled ? (
            <>
              <span>Auto-email · ON</span>
              <span className="text-gray-400">·</span>
              <span className="normal-case text-gray-300">
                Fires the 1st of each month
                {plAutoStatus.admin_email && <> to <strong className="text-white">{plAutoStatus.admin_email}</strong></>}
              </span>
              {plAutoStatus.last_sent_at && (
                <>
                  <span className="text-gray-400">·</span>
                  <span className="normal-case text-gray-300">
                    Last sent <strong className="text-white">{plAutoStatus.last_sent_at.slice(0,10)}</strong>
                    {plAutoStatus.last_period_key && (
                      <> ({plAutoStatus.last_period_key.replace("pl:","")} · net ${(plAutoStatus.last_net||0).toFixed(2)})</>
                    )}
                  </span>
                </>
              )}
            </>
          ) : (
            <span className="normal-case">Auto-email OFF — set <code>ADMIN_NOTIFICATION_EMAIL</code> and <code>RESEND_API_KEY</code> in backend env to enable.</span>
          )}
        </div>
      )}

      {/* Weekly tally tiles */}
      {summary && (
        <div className="card-finance rounded-xl p-5" data-testid="weekly-summary">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
            <div>
              <p className="text-[15px] font-black uppercase tracking-widest text-gray-500">This Week (Mon–Sun)</p>
              <p className="text-white font-black uppercase italic tracking-tight">{summary.week_start} → {summary.week_end}</p>
            </div>
            <div className="flex gap-2 items-center flex-wrap">
              <button onClick={()=>setRefDate(localISOFromDate(new Date(parseLocalISO(refDate).getTime() - 7*86400000)))}
                      className="bg-bgBase border border-bgHover px-3 py-1.5 rounded text-gray-300 text-[14px] font-black hover:border-shBlue">
                <i className="fas fa-chevron-left"/>
              </button>
              <input type="date" value={refDate} onChange={(e)=>setRefDate(e.target.value)} style={{colorScheme:"dark"}}
                     className="bg-bgBase border border-bgHover rounded p-1.5 text-white text-sm" data-testid="weekly-ref-date" />
              <button onClick={()=>setRefDate(localISOFromDate(new Date(parseLocalISO(refDate).getTime() + 7*86400000)))}
                      className="bg-bgBase border border-bgHover px-3 py-1.5 rounded text-gray-300 text-[14px] font-black hover:border-shBlue">
                <i className="fas fa-chevron-right"/>
              </button>
              <button onClick={()=>setRefDate(todayISO())}
                      className="bg-bgBase border border-bgHover px-3 py-1.5 rounded text-shBlue text-[14px] font-black uppercase tracking-widest hover:border-shBlue">
                Today
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatTile label="Completed" value={fmt(summary.completed_total)} sub={`${summary.completed_count} transaction${summary.completed_count===1?"":"s"}`} color="text-shGreen" icon="fa-circle-check" big data-testid="tile-completed" />
            <StatTile label="Paid" value={fmt(summary.paid_total)} sub="received" color="text-shBlue" icon="fa-dollar-sign" />
            <StatTile label="Unpaid" value={fmt(summary.unpaid_total)}
                      sub={summary.ar_outstanding_total > 0
                        ? `outstanding · incl. ${fmt(summary.ar_outstanding_total)} on tabs (${summary.ar_outstanding_count})`
                        : "outstanding"}
                      color="text-shOrange" icon="fa-hourglass-half" />
            <StatTile label="Booked (upcoming)" value={fmt(summary.booked_total)} sub={`${summary.booked_count} sessions`} color="text-gray-300" icon="fa-calendar" />
          </div>
          {summary.by_service?.length > 0 && (
            <div className="mt-4">
              <p className="text-[14px] font-black uppercase tracking-widest text-gray-500 mb-2">Breakdown by service</p>
              <div className="flex flex-wrap gap-2">
                {summary.by_service.map(b => (
                  <span key={b.name} className="bg-bgBase border border-bgHover rounded px-3 py-1.5 text-[14px]">
                    <span className="text-gray-300">{b.name}</span>
                    <span className="text-gray-500 mx-1">·</span>
                    <span className="text-white font-black">{fmt(b.total)}</span>
                    <span className="text-gray-500 ml-1">({b.count})</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Range view (month / quarter / YTD / custom) */}
      {rangeSummary && (
        <div className="card-finance rounded-xl p-5" data-testid="range-summary">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
            <div>
              <p className="text-[15px] font-black uppercase tracking-widest text-gray-500">Longer-Range View</p>
              <p className="text-white font-black uppercase italic tracking-tight">{rangeStart} → {rangeEnd}</p>
            </div>
            <div className="flex flex-wrap gap-1">
              {["month","quarter","ytd","custom"].map(k => (
                <button key={k} onClick={()=>setRangePreset(k)} data-testid={`range-preset-${k}`}
                        className={`px-3 py-1.5 rounded text-[14px] font-black uppercase tracking-widest ${rangePreset===k?"bg-shBlue text-white":"bg-bgBase text-gray-400 border border-bgHover hover:border-shBlue"}`}>
                  {k === "ytd" ? "YTD" : k}
                </button>
              ))}
            </div>
          </div>
          {rangePreset === "custom" && (
            <div className="flex gap-2 mb-4">
              <input type="date" value={rangeStart} onChange={(e)=>setRangeStart(e.target.value)} style={{colorScheme:"dark"}}
                     className="bg-bgBase border border-bgHover rounded p-1.5 text-white text-sm" />
              <span className="text-gray-500 self-center">to</span>
              <input type="date" value={rangeEnd} onChange={(e)=>setRangeEnd(e.target.value)} style={{colorScheme:"dark"}}
                     className="bg-bgBase border border-bgHover rounded p-1.5 text-white text-sm" />
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
            <StatTile label="Income (all sources)" value={fmt(rangeSummary.completed_total)} sub="Services · Training · Retail · Packs" color="text-shGreen" icon="fa-circle-check" big />
            <StatTile label="Expenses" value={fmt(rangeSummary.expenses_total || 0)} sub={`${rangeSummary.expense_count || 0} item${rangeSummary.expense_count===1?"":"s"}`} color="text-red-300" icon="fa-receipt" />
            <StatTile label="Labor (w/ taxes)" value={fmt(rangeSummary.labor_total || 0)} sub={rangeSummary.labor_burden ? `${fmt(rangeSummary.labor_gross)} + ${fmt(rangeSummary.labor_burden)} taxes` : "no clocked hours"} color="text-shOrange" icon="fa-user-clock" />
            <StatTile label="Net (after labor)" value={fmt(rangeSummary.net_total ?? rangeSummary.completed_total)} sub={(rangeSummary.net_total ?? 0) >= 0 ? "in the black" : "in the red"} color={(rangeSummary.net_total ?? 0) >= 0 ? "text-shBlue" : "text-red-400"} icon="fa-scale-balanced" big />
            <StatTile label="Avg / day" value={fmt(rangeSummary.completed_total / Math.max(rangeSummary.by_day?.length || 1, 1))} sub="active-day average" color="text-gray-300" icon="fa-chart-line" />
          </div>
          {/* Sprint 110cz — removed Credits Redeemed range-view chip; the
              all-in-one Income tile + breakdown shows the full picture now. */}
          {rangeSummary.by_day?.length > 0 && <DailyBarChart points={rangeSummary.by_day} />}
        </div>
      )}

      {/* Retail Sales (external POS) — date range matches Range View above */}
      <div className="card-finance rounded-xl p-5" data-testid="retail-card">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
          <div>
            <h4 className="text-sm font-black text-purple-300 uppercase tracking-widest"><i className="fas fa-bag-shopping mr-2"/>Retail Sales</h4>
            <p className="text-[14px] text-gray-500 mt-1">External POS revenue · logged in <span className="text-gray-300 font-black">{rangeStart} → {rangeEnd}</span> · added to gross above.</p>
          </div>
          <button onClick={()=>{ setRetailEditing(null); setRetailOpen(true); }} data-testid="retail-add-btn-card"
                  className="bg-purple-500/20 text-purple-300 border border-purple-500/40 px-4 py-2 rounded text-[14px] font-black uppercase tracking-widest hover:bg-purple-500/30">
            <i className="fas fa-plus mr-1.5"/>Log Sale
          </button>
          {/* Sprint 110di-61 — Standalone "Take Payment" entry point. */}
          <button onClick={()=>setTakePaymentOpen(true)} data-testid="take-payment-open-btn"
                  className="bg-shGreen/20 text-shGreen border border-shGreen/40 px-4 py-2 rounded text-[14px] font-black uppercase tracking-widest hover:bg-shGreen/30 ml-2">
            <i className="fas fa-cash-register mr-1.5"/>Take Payment
          </button>
        </div>
        {retailSales.length === 0 ? (
          <div className="text-center py-6 text-gray-500 text-[15px]">
            <i className="fas fa-bag-shopping text-2xl mb-2 block opacity-40"/>
            No retail sales logged in this range.
          </div>
        ) : (
          <CollapsibleDateGroups
            rows={retailSales}
            getDate={(r) => r.date}
            getAmount={(r) => Number(r.amount) || 0}
            fmtAmount={(n) => fmt(n)}
            compact
            testid="retail-groups"
            emptyText="No retail sales logged in this range."
            renderRow={(r) => (
              <div key={r.id} className="bg-bgBase/40 border border-bgHover/40 rounded px-3 py-2 flex items-start gap-3" data-testid={`retail-row-${r.id}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black text-white truncate">{r.description}</p>
                  <p className="text-[12px] text-gray-500 font-black uppercase tracking-widest mt-0.5">
                    {r.category || "—"} · <span className="capitalize">{r.payment_method || "—"}</span>
                    {r.client_name && <> · <span className="text-purple-300">{r.client_name}</span></>}
                  </p>
                </div>
                <span className="text-sm font-black text-purple-300 whitespace-nowrap">+{fmt(r.amount)}</span>
                <div className="flex gap-2 shrink-0">
                  <button onClick={()=>{ setRetailEditing(r); setRetailOpen(true); }} className="text-[14px] text-gray-400 hover:text-shBlue p-1" data-testid={`retail-edit-${r.id}`}><i className="fas fa-pen"/></button>
                  <button onClick={()=>removeRetail(r)} className="text-[14px] text-gray-400 hover:text-red-400 p-1" data-testid={`retail-delete-${r.id}`}><i className="fas fa-trash"/></button>
                </div>
              </div>
            )}
          />
        )}
      </div>

      {retailOpen && (
        <RetailSaleModal sale={retailEditing}
                         categories={retailCategories}
                         clients={clients}
                         onClose={()=>{ setRetailOpen(false); setRetailEditing(null); }}
                         onSaved={()=>{ setRetailOpen(false); setRetailEditing(null); refreshAfterRetailChange(); }}
                         onError={(msg)=>setEditErr(msg)} />
      )}

      {/* Expenses (date range matches Range View above) */}
      <div className="bg-bgPanel border border-bgHover rounded-xl p-5" data-testid="expenses-card">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
          <div>
            <h4 className="text-sm font-black text-red-300 uppercase tracking-widest"><i className="fas fa-receipt mr-2"/>Expenses</h4>
            <p className="text-[14px] text-gray-500 mt-1">Logged in <span className="text-gray-300 font-black">{rangeStart} → {rangeEnd}</span> · subtracted from gross to show NET above.</p>
          </div>
          <button onClick={()=>{ setExpEditing(null); setExpOpen(true); }} data-testid="expense-add-btn"
                  className="bg-red-500/20 text-red-300 border border-red-500/40 px-4 py-2 rounded text-[14px] font-black uppercase tracking-widest hover:bg-red-500/30">
            <i className="fas fa-plus mr-1.5"/>Add Expense
          </button>
        </div>
        {expenses.length === 0 ? (
          <div className="text-center py-6 text-gray-500 text-[15px]">
            <i className="fas fa-receipt text-2xl mb-2 block opacity-40"/>
            No expenses logged in this range.
          </div>
        ) : (
          <CollapsibleDateGroups
            rows={expenses}
            getDate={(e) => e.date}
            getAmount={(e) => -Math.abs(Number(e.amount) || 0)}
            fmtAmount={(n) => n === 0 ? "—" : `${n < 0 ? "−" : ""}${fmt(Math.abs(n))}`}
            compact
            testid="expenses-groups"
            emptyText="No expenses logged in this range."
            renderRow={(e) => (
              <div key={e.id} className="bg-bgBase/40 border border-bgHover/40 rounded px-3 py-2 flex items-start gap-3" data-testid={`expense-row-${e.id}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-black text-white truncate flex items-center gap-2">
                    {e.description}
                    {e.receipt_image && (
                      <span className="inline-flex items-center gap-1 bg-shGreen/15 text-shGreen px-1.5 py-0.5 rounded text-[10px] uppercase tracking-widest font-black" title="Receipt attached">
                        <i className="fas fa-paperclip"/>RCPT
                      </span>
                    )}
                  </p>
                  <p className="text-[12px] text-gray-500 font-black uppercase tracking-widest mt-0.5">
                    {e.category || "—"} · <span className="capitalize">{e.payment_method || "—"}</span>
                  </p>
                </div>
                <span className="text-sm font-black text-red-300 whitespace-nowrap">−{fmt(e.amount)}</span>
                <div className="flex gap-2 shrink-0">
                  <button onClick={()=>{ setExpEditing(e); setExpOpen(true); }} className="text-[14px] text-gray-400 hover:text-shBlue p-1" data-testid={`expense-edit-${e.id}`}><i className="fas fa-pen"/></button>
                  <button onClick={()=>removeExpense(e)} className="text-[14px] text-gray-400 hover:text-red-400 p-1" data-testid={`expense-delete-${e.id}`}><i className="fas fa-trash"/></button>
                </div>
              </div>
            )}
          />
        )}
      </div>

      {expOpen && (
        <ExpenseModal expense={expEditing}
                      categories={expCategories}
                      onClose={()=>{ setExpOpen(false); setExpEditing(null); }}
                      onSaved={()=>{ setExpOpen(false); setExpEditing(null); refreshAfterExpenseChange(); }}
                      onError={(msg)=>setEditErr(msg)} />
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search dog, client, service…" data-testid="income-search"
               className="flex-1 min-w-[180px] bg-bgPanel border border-bgHover rounded p-2 text-white text-sm" />
        <select value={filters.dog_id} onChange={(e)=>setFilters({...filters, dog_id: e.target.value})}
                className="bg-bgPanel border border-bgHover rounded p-2 text-white text-sm">
          <option value="">All dogs</option>
          {dogs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={filters.service_id} onChange={(e)=>setFilters({...filters, service_id: e.target.value})}
                className="bg-bgPanel border border-bgHover rounded p-2 text-white text-sm">
          <option value="">All services</option>
          {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={filters.payment_status} onChange={(e)=>setFilters({...filters, payment_status: e.target.value})}
                className="bg-bgPanel border border-bgHover rounded p-2 text-white text-sm">
          <option value="">All payment</option>
          {PAYMENT_STATUSES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        <select value={filters.status} onChange={(e)=>setFilters({...filters, status: e.target.value})}
                className="bg-bgPanel border border-bgHover rounded p-2 text-white text-sm">
          <option value="">All status</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="completed">Completed</option>
        </select>
        <label className="flex items-center gap-2 text-[14px] font-black uppercase tracking-widest text-gray-400 cursor-pointer hover:text-shBlue">
          <input type="checkbox" checked={showLegacy} onChange={(e)=>setShowLegacy(e.target.checked)} data-testid="show-legacy-toggle"
                 className="w-4 h-4 accent-shBlue" />
          Include unpriced
        </label>
        <label className="flex items-center gap-2 text-[14px] font-black uppercase tracking-widest text-gray-400 cursor-pointer hover:text-shGreen">
          <input type="checkbox" checked={groupByDate} onChange={(e)=>setGroupByDate(e.target.checked)} data-testid="group-by-date-toggle"
                 className="w-4 h-4 accent-shGreen" />
          <i className="fas fa-layer-group"/> Group by date
        </label>
      </div>

      {/* Spreadsheet table OR grouped-by-date view */}
      {groupByDate ? (
        <div className="bg-bgPanel border border-bgHover rounded-xl p-4 card-table" data-testid="income-grouped">
          <CollapsibleDateGroups
            rows={filtered}
            getDate={(r) => r.date}
            getAmount={(r) => Number(r.actual_price) || 0}
            fmtAmount={(n) => fmt(n)}
            compact
            testid="income-groups"
            emptyText="No transactions match these filters."
            renderRow={(r) => {
              const ps = PAYMENT_STATUSES.find(p => p.key === r.payment_status);
              return (
                <div key={r.id} className="bg-bgBase/40 border border-bgHover/40 rounded px-3 py-2 flex items-start gap-3" data-testid={`income-grouped-row-${r.id}`}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-black text-white truncate">{r.dog_name} <span className="text-gray-500 font-normal">· {r.client_name}</span></p>
                    <p className="text-[12px] text-gray-500 font-black uppercase tracking-widest mt-0.5">
                      {r.service_name || r.service_type || "—"} · <span className="capitalize">{r.payment_method || "—"}</span>
                    </p>
                  </div>
                  {ps && <span className={`shrink-0 text-[12px] font-black uppercase tracking-widest px-2 py-0.5 rounded ${ps.color}`}>{ps.label}</span>}
                  <span className="text-sm font-black text-shGreen whitespace-nowrap">{fmt(r.actual_price || 0)}</span>
                </div>
              );
            }}
          />
        </div>
      ) : (
      <div className="bg-bgPanel border border-bgHover rounded-xl overflow-hidden" data-testid="income-table">
        <div className="overflow-x-auto">
          <table className="w-full text-[15px]">
            <thead className="bg-bgBase border-b border-bgHover text-[13px] font-black uppercase tracking-widest text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Dog · Client</th>
                <th className="px-3 py-2 text-left">Service</th>
                <th className="px-3 py-2 text-right">Price</th>
                <th className="px-3 py-2 text-center">Status</th>
                <th className="px-3 py-2 text-center">Payment</th>
                <th className="px-3 py-2 text-center">Method</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan="8" className="text-center text-gray-500 text-[14px] uppercase font-black tracking-widest py-10">No transactions match these filters.</td></tr>
              )}
              {filtered.map(r => {
                const ps = PAYMENT_STATUSES.find(p => p.key === r.payment_status);
                return (
                  <tr key={r.id} className="border-b border-bgHover/40 hover:bg-bgBase/50" data-testid={`txn-row-${r.id}`}>
                    <td className="px-3 py-2 text-gray-300">{r.date}</td>
                    <td className="px-3 py-2">
                      <p className="text-white font-black">{r.dog_name}</p>
                      <p className="text-[13px] text-gray-500">{r.client_name}</p>
                    </td>
                    <td className="px-3 py-2">
                      <select value={r.service_id || ""} onChange={(e)=>{ if (e.target.value) inlineUpdate(r, { service_id: e.target.value }); }}
                              className="bg-bgBase border border-bgHover rounded p-1 text-[14px] text-gray-300 max-w-[150px]">
                        <option value="" disabled>— select service —</option>
                        {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                      {!r.service_id && r.service_type && (
                        <p className="text-[12px] text-gray-500 mt-0.5 uppercase">legacy · {r.service_type}</p>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input type="number" step="0.01" defaultValue={r.actual_price || 0}
                             onBlur={(e)=>{
                               const v = parseFloat(e.target.value) || 0;
                               if (v !== (r.actual_price || 0)) inlineUpdate(r, { actual_price: v });
                             }}
                             data-testid={`txn-price-${r.id}`}
                             className="w-20 bg-bgBase border border-bgHover rounded p-1 text-right text-shGreen font-black text-[15px]" />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-[13px] font-black uppercase tracking-widest px-2 py-0.5 rounded ${r.status==="completed"?"bg-shGreen/15 text-shGreen":r.status==="approved"?"bg-shBlue/15 text-shBlue":"bg-shOrange/15 text-shOrange"}`}>{r.status}</span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <select value={r.payment_status || ""} onChange={(e)=>inlineUpdate(r, { payment_status: e.target.value })}
                              data-testid={`txn-payment-${r.id}`}
                              className={`text-[13px] font-black uppercase tracking-widest rounded px-2 py-0.5 ${ps?.color || "bg-bgBase text-gray-400"} border border-bgHover`}>
                        <option value="">— set —</option>
                        {PAYMENT_STATUSES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <select value={r.payment_method || ""} onChange={(e)=>inlineUpdate(r, { payment_method: e.target.value })}
                              className="bg-bgBase border border-bgHover rounded p-1 text-[14px] text-gray-300">
                        <option value="">—</option>
                        {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {savingId === r.id ? <i className="fas fa-spinner fa-spin text-gray-400 text-[14px]"/> : (
                        <button onClick={()=>removeTxn(r)} className="text-gray-500 hover:text-red-400 px-2" title="Remove transaction">
                          <i className="fas fa-trash text-[14px]"/>
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {filtered.length > 0 && (
              <tfoot className="bg-bgBase border-t border-bgHover">
                <tr>
                  <td colSpan="3" className="px-3 py-2 text-[13px] font-black uppercase tracking-widest text-gray-500">{filtered.length} rows</td>
                  <td className="px-3 py-2 text-right text-shGreen font-black text-[15px]">
                    {fmt(filtered.reduce((sum, r) => sum + (Number(r.actual_price) || 0), 0))}
                  </td>
                  <td colSpan="4"></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
      )}

      {logOpen && <LogServiceModal onClose={()=>setLogOpen(false)} onSaved={load} dogs={dogs} services={services} />}
      {takePaymentOpen && (
        <TakePaymentModal onClose={()=>setTakePaymentOpen(false)}
                          onSuccess={()=>{ setTakePaymentOpen(false); refreshAfterRetailChange(); }} />
      )}
      </>
      )}
    </div>
  );
}

function DailyBarChart({ points }) {
  if (!points || points.length === 0) return null;
  const max = Math.max(...points.map(p => p.total), 1);
  return (
    <div className="bg-bgBase border border-bgHover rounded p-3" data-testid="daily-bar-chart">
      <div className="flex items-end gap-[2px] h-32 overflow-x-auto">
        {points.map((p) => {
          const h = Math.max((p.total / max) * 100, 2);
          return (
            <div key={p.date} className="flex-1 min-w-[6px] flex flex-col items-center group" title={`${p.date} · $${p.total.toFixed(2)}`}>
              <div className="w-full bg-shGreen/30 hover:bg-shGreen transition rounded-t" style={{ height: `${h}%` }} />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-2 text-[12px] text-gray-500 font-black uppercase tracking-widest">
        <span>{points[0]?.date}</span>
        <span>{points.length} days w/ revenue</span>
        <span>{points[points.length - 1]?.date}</span>
      </div>
    </div>
  );
}

function StatTile({ label, value, sub, color, icon, big = false }) {  return (
    <div className={`bg-bgBase border border-bgHover rounded-lg p-3 ${big ? "md:col-span-1" : ""}`}>
      <p className="text-[13px] font-black uppercase tracking-widest text-gray-500"><i className={`fas ${icon} mr-1 ${color}`}/>{label}</p>
      <p className={`${big ? "text-[24px]" : "text-[18px]"} font-black ${color} mt-1`}>{value}</p>
      {sub && <p className="text-[13px] text-gray-500 font-black uppercase tracking-widest mt-0.5">{sub}</p>}
    </div>
  );
}

function LogServiceModal({ onClose, onSaved, dogs, services }) {
  const [form, setForm] = useState({
    dog_id: dogs[0]?.id || "",
    service_id: services[0]?.id || "",
    date: todayISO(),
    actual_price: services[0]?.base_price || 0,
    notes: "",
    status: "completed",
    payment_status: "paid",
    payment_method: "cash",
  });
  const [dogQuery, setDogQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const dogResults = dogQuery.trim()
    ? dogs.filter(d => (d.name + " " + (d.breed||"")).toLowerCase().includes(dogQuery.toLowerCase())).slice(0, 8)
    : [];

  const onServiceChange = (sid) => {
    const svc = services.find(s => s.id === sid);
    setForm({ ...form, service_id: sid, actual_price: svc?.base_price || 0 });
  };

  const save = async () => {
    setBusy(true); setErr("");
    try {
      await api.post("/transactions", form);
      onSaved?.();
      onClose?.();
    } catch (e) {
      setErr(e.response?.data?.detail || "Save failed");
    } finally { setBusy(false); }
  };

  const selectedDog = dogs.find(d => d.id === form.dog_id);

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-lg p-6 shadow-2xl" onClick={(e)=>e.stopPropagation()} data-testid="log-service-modal">
        <h4 className="text-lg font-black text-white uppercase italic tracking-tight mb-4">Log a Service</h4>
        <div className="space-y-3">
          <div>
            <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Dog</label>
            <div className="relative">
              <input value={dogQuery || selectedDog?.name || ""} onChange={(e)=>{setDogQuery(e.target.value); setForm({...form, dog_id: ""});}}
                     placeholder="Type to search…" data-testid="log-dog-search"
                     className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
              {dogResults.length > 0 && (
                <div className="absolute z-10 mt-1 w-full bg-bgPanel border border-bgHover rounded shadow-2xl max-h-48 overflow-y-auto">
                  {dogResults.map(d => (
                    <button key={d.id} onClick={()=>{setForm({...form, dog_id: d.id}); setDogQuery("");}}
                            data-testid={`log-dog-pick-${d.id}`}
                            className="w-full text-left px-3 py-2 hover:bg-bgHover text-white text-[15px]">
                      <span className="font-black">{d.name}</span> <span className="text-gray-500 text-[13px]">· {d.breed || "Unknown"}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div>
            <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Service</label>
            <select value={form.service_id} onChange={(e)=>onServiceChange(e.target.value)} data-testid="log-service-select"
                    className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
              {services.map(s => <option key={s.id} value={s.id}>{s.name} · ${s.base_price?.toFixed(2)}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Price (override)</label>
              <input type="number" step="0.01" value={form.actual_price} onChange={(e)=>setForm({...form, actual_price: parseFloat(e.target.value) || 0})}
                     data-testid="log-price-input"
                     className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-shGreen font-black text-sm" />
            </div>
            <div>
              <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Date</label>
              <input type="date" value={form.date} onChange={(e)=>setForm({...form, date: e.target.value})}
                     className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" style={{colorScheme:"dark"}} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Status</label>
              <select value={form.status} onChange={(e)=>setForm({...form, status: e.target.value})}
                      className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                <option value="completed">Completed</option>
                <option value="approved">Approved (upcoming)</option>
                <option value="pending">Pending</option>
              </select>
            </div>
            <div>
              <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Payment</label>
              <select value={form.payment_status} onChange={(e)=>setForm({...form, payment_status: e.target.value})}
                      className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                {PAYMENT_STATUSES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Method</label>
              <select value={form.payment_method} onChange={(e)=>setForm({...form, payment_method: e.target.value})}
                      className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-[14px] font-black text-gray-500 uppercase tracking-widest">Notes</label>
            <textarea value={form.notes} onChange={(e)=>setForm({...form, notes: e.target.value})} rows={2}
                      className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
          </div>
          {err && <p className="text-red-400 text-[15px]">{err}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="text-gray-400 px-4 py-2 font-black uppercase text-[15px] tracking-widest">Cancel</button>
            <button onClick={save} disabled={busy || !form.dog_id || !form.service_id} data-testid="log-save-btn"
                    className="bg-shGreen text-black px-6 py-2 rounded font-black text-[15px] uppercase tracking-widest hover:bg-shGreen/80 disabled:opacity-50">
              {busy ? "Saving…" : "Log Service"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}



function ExpenseModal({ expense, categories, onClose, onSaved, onError }) {
  const isEdit = !!expense;
  const [form, setForm] = useState({
    date: expense?.date || todayISO(),
    description: expense?.description || "",
    amount: expense?.amount ?? "",
    category: expense?.category || "",
    payment_method: expense?.payment_method || "card",
    notes: expense?.notes || "",
    receipt_image: expense?.receipt_image || "",
    receipt_filename: expense?.receipt_filename || "",
  });
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Sprint 110ap — upload a photo or PDF receipt. Images get client-side
  // compressed to ~800kB so the JSON payload stays under typical 2MB limits.
  // PDFs are passed through as data URLs up to ~2MB (we warn beyond that).
  const onReceiptFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      if (file.type.startsWith("image/")) {
        const compressed = await compressImage(file, { maxWidth: 1400, maxHeight: 1800, quality: 0.78 });
        setForm(s => ({ ...s, receipt_image: compressed, receipt_filename: file.name }));
      } else if (file.type === "application/pdf") {
        if (file.size > 2_500_000) {
          onError && onError("PDF is over 2.5 MB — please compress before uploading.");
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          setForm(s => ({ ...s, receipt_image: reader.result, receipt_filename: file.name }));
        };
        reader.readAsDataURL(file);
      } else {
        onError && onError("Receipt must be an image (PNG/JPG) or a PDF.");
      }
    } catch (err) {
      onError && onError(`Receipt upload failed: ${err.message}`);
    } finally {
      setUploading(false);
      // Reset the input so re-selecting the same file fires onChange again
      e.target.value = "";
    }
  };

  const removeReceipt = () => setForm(s => ({ ...s, receipt_image: "", receipt_filename: "" }));

  const isPdf = (form.receipt_image || "").startsWith("data:application/pdf");
  const [previewOpen, setPreviewOpen] = useState(false);

  const save = async () => {
    if (!form.description.trim()) { onError && onError("Description is required"); return; }
    if (form.amount === "" || isNaN(Number(form.amount)) || Number(form.amount) <= 0) {
      onError && onError("Amount must be greater than zero"); return;
    }
    setBusy(true);
    try {
      const body = {
        date: form.date,
        description: form.description.trim(),
        amount: Number(form.amount),
        category: (form.category || "").trim(),
        notes: (form.notes || "").trim(),
        payment_method: form.payment_method,
        receipt_image: form.receipt_image || "",
        receipt_filename: form.receipt_filename || "",
      };
      if (isEdit) await api.put(`/expenses/${expense.id}`, body);
      else await api.post("/expenses", body);
      onSaved && onSaved();
    } catch (e) {
      onError && onError(`Save failed: ${e.response?.data?.detail || e.message}`);
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-[80] flex items-center justify-center p-4" onClick={onClose} data-testid="expense-modal">
      <div className="bg-bgPanel border border-bgHover rounded-xl max-w-md w-full p-6 space-y-4" onClick={(e)=>e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <h3 className="text-lg font-black text-white uppercase italic tracking-tight">
            <i className="fas fa-receipt text-red-300 mr-2"/>{isEdit ? "Edit Expense" : "Add Expense"}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><i className="fas fa-times"/></button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[13px] uppercase tracking-widest text-gray-500 font-black">Date</label>
            <input type="date" value={form.date} onChange={(e)=>setForm({...form, date:e.target.value})} style={{colorScheme:"dark"}}
                   className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
          </div>
          <div>
            <label className="text-[13px] uppercase tracking-widest text-gray-500 font-black">Amount (USD)</label>
            <input type="number" step="0.01" min="0" value={form.amount} onChange={(e)=>setForm({...form, amount:e.target.value})}
                   className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" data-testid="expense-amount" />
          </div>
        </div>

        <div>
          <label className="text-[13px] uppercase tracking-widest text-gray-500 font-black">What was it</label>
          <input type="text" value={form.description} onChange={(e)=>setForm({...form, description:e.target.value})}
                 placeholder="e.g., 40lb kibble bag, vet supplies, paper towels"
                 className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" data-testid="expense-description" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[13px] uppercase tracking-widest text-gray-500 font-black">Category</label>
            <input type="text" value={form.category} onChange={(e)=>setForm({...form, category:e.target.value})}
                   list="expense-categories" placeholder="e.g., Food, Supplies, Utilities"
                   className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" data-testid="expense-category" />
            <datalist id="expense-categories">
              {categories.map(c => <option key={c} value={c}/>)}
            </datalist>
          </div>
          <div>
            <label className="text-[13px] uppercase tracking-widest text-gray-500 font-black">Payment method</label>
            <select value={form.payment_method} onChange={(e)=>setForm({...form, payment_method:e.target.value})}
                    className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
              <option value="card">Card</option>
              <option value="cash">Cash</option>
              <option value="transfer">Transfer</option>
              <option value="check">Check</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>

        <div>
          <label className="text-[13px] uppercase tracking-widest text-gray-500 font-black">Notes (optional)</label>
          <textarea value={form.notes} onChange={(e)=>setForm({...form, notes:e.target.value})} rows={2}
                    className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm resize-none" />
        </div>

        {/* Sprint 110ap — receipt photo / PDF upload for IRS-grade audit trail. */}
        <div data-testid="expense-receipt-field">
          <label className="text-[13px] uppercase tracking-widest text-gray-500 font-black">
            <i className="fas fa-receipt text-red-300 mr-1"/>Receipt (optional)
          </label>
          {form.receipt_image ? (
            <div className="mt-2 flex items-center gap-3 bg-bgBase/60 border border-bgHover rounded-lg p-3">
              {isPdf ? (
                <a href={form.receipt_image} download={form.receipt_filename || "receipt.pdf"}
                   className="w-16 h-16 grid place-items-center rounded bg-red-500/10 border border-red-500/30 text-red-300 hover:bg-red-500/20"
                   title="Download PDF receipt">
                  <i className="fas fa-file-pdf text-2xl"/>
                </a>
              ) : (
                <button type="button" onClick={()=>setPreviewOpen(true)}
                        className="w-16 h-16 rounded overflow-hidden border border-bgHover hover:border-shGreen">
                  <img src={form.receipt_image} alt="receipt preview" className="w-full h-full object-cover"/>
                </button>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-[13px] text-white truncate font-bold">{form.receipt_filename || (isPdf ? "receipt.pdf" : "receipt.jpg")}</div>
                <div className="text-[12px] text-gray-500">{isPdf ? "PDF document" : "Tap to view full size"}</div>
              </div>
              <button type="button" onClick={removeReceipt} data-testid="expense-receipt-remove"
                      className="text-[12px] font-black uppercase tracking-widest text-red-400 hover:text-red-300">
                <i className="fas fa-trash mr-1"/>Remove
              </button>
            </div>
          ) : (
            <label className="mt-2 flex items-center gap-3 bg-bgBase/40 border border-dashed border-bgHover rounded-lg p-4 cursor-pointer hover:border-shGreen/60 transition" data-testid="expense-receipt-uploader">
              <div className="w-12 h-12 grid place-items-center rounded bg-shGreen/10 text-shGreen">
                <i className={`fas ${uploading ? "fa-spinner fa-spin" : "fa-camera"} text-xl`}/>
              </div>
              <div className="flex-1">
                <div className="text-[14px] font-black text-white">{uploading ? "Uploading…" : "Snap or attach receipt"}</div>
                <div className="text-[12px] text-gray-500">JPG/PNG (auto-compressed) or PDF up to 2.5 MB</div>
              </div>
              <input type="file" accept="image/*,application/pdf" capture="environment"
                     onChange={onReceiptFile} className="hidden"
                     data-testid="expense-receipt-input" />
            </label>
          )}
        </div>

        {previewOpen && form.receipt_image && !isPdf && (
          <Lightbox src={form.receipt_image} onClose={()=>setPreviewOpen(false)} />
        )}

        <div className="flex gap-2 justify-end pt-2">
          <button onClick={onClose} className="bg-bgBase border border-bgHover text-gray-300 px-4 py-2 rounded text-[14px] font-black uppercase tracking-widest hover:border-shBlue">Cancel</button>
          <button onClick={save} disabled={busy} data-testid="expense-save"
                  className="bg-red-500/20 text-red-300 border border-red-500/40 px-5 py-2 rounded text-[14px] font-black uppercase tracking-widest hover:bg-red-500/30 disabled:opacity-50">
            {busy ? "Saving…" : (isEdit ? "Save changes" : "Add expense")}
          </button>
        </div>
      </div>
    </div>
  );
}


function RetailSaleModal({ sale, categories, clients, onClose, onSaved, onError }) {
  const isEdit = !!sale;
  const [form, setForm] = useState({
    date: sale?.date || todayISO(),
    description: sale?.description || "",
    amount: sale?.amount ?? "",
    category: sale?.category || "",
    payment_method: sale?.payment_method || "card",
    notes: sale?.notes || "",
    client_id: sale?.client_id || "",
  });
  const [busy, setBusy] = useState(false);
  const [clientQuery, setClientQuery] = useState("");
  // Sprint 110di-61 — Partial-pay toggle (cash-basis, option 1c).
  // Only meaningful when a client is selected (no tab without a client).
  const [payMode, setPayMode] = useState("full"); // "full" | "partial"
  const [amountPaid, setAmountPaid] = useState("");

  const selectedClient = clients?.find(c => c.id === form.client_id);
  const clientResults = clientQuery.trim()
    ? (clients || []).filter(c => (c.name + " " + (c.email || "")).toLowerCase().includes(clientQuery.toLowerCase())).slice(0, 8)
    : [];

  const save = async () => {
    if (!form.description.trim()) { onError && onError("Description is required"); return; }
    if (form.amount === "" || isNaN(Number(form.amount)) || Number(form.amount) <= 0) {
      onError && onError("Amount must be greater than zero"); return;
    }
    setBusy(true);
    try {
      const body = {
        date: form.date,
        description: form.description.trim(),
        amount: Number(form.amount),
        category: (form.category || "").trim(),
        notes: (form.notes || "").trim(),
        payment_method: form.payment_method,
        client_id: form.client_id || null,
      };
      // Sprint 110di-61 — Partial pay (requires a linked client).
      if (form.client_id && payMode === "partial" && amountPaid !== "") {
        body.amount_paid = Number(amountPaid);
      }
      if (isEdit) await api.put(`/retail-sales/${sale.id}`, body);
      else await api.post("/retail-sales", body);
      onSaved && onSaved();
    } catch (e) {
      onError && onError(`Save failed: ${e.response?.data?.detail || e.message}`);
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-[80] flex items-center justify-center p-4" onClick={onClose} data-testid="retail-modal">
      <div className="bg-bgPanel border border-bgHover rounded-xl max-w-md w-full p-6 space-y-4" onClick={(e)=>e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <h3 className="text-lg font-black text-white uppercase italic tracking-tight">
            <i className="fas fa-bag-shopping text-purple-300 mr-2"/>{isEdit ? "Edit Retail Sale" : "Log Retail Sale"}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white" data-testid="retail-modal-close"><i className="fas fa-times"/></button>
        </div>

        <p className="text-[13px] text-gray-500 leading-relaxed">
          Manually log a sale from your external POS so it counts toward your Income totals and the monthly P&amp;L PDF.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[13px] uppercase tracking-widest text-gray-500 font-black">Date</label>
            <input type="date" value={form.date} onChange={(e)=>setForm({...form, date:e.target.value})} style={{colorScheme:"dark"}}
                   className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" data-testid="retail-date" />
          </div>
          <div>
            <label className="text-[13px] uppercase tracking-widest text-gray-500 font-black">Amount (USD)</label>
            <input type="number" step="0.01" min="0" value={form.amount} onChange={(e)=>setForm({...form, amount:e.target.value})}
                   className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-purple-300 font-black text-sm" data-testid="retail-amount" />
          </div>
        </div>

        <div>
          <label className="text-[13px] uppercase tracking-widest text-gray-500 font-black">What did you sell</label>
          <input type="text" value={form.description} onChange={(e)=>setForm({...form, description:e.target.value})}
                 placeholder="e.g., 40lb kibble bag, retractable leash, chew toy"
                 className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" data-testid="retail-description" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[13px] uppercase tracking-widest text-gray-500 font-black">Category</label>
            <input type="text" value={form.category} onChange={(e)=>setForm({...form, category:e.target.value})}
                   list="retail-categories" placeholder="e.g., Food, Treats, Toys, Gear"
                   className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" data-testid="retail-category" />
            <datalist id="retail-categories">
              {categories.map(c => <option key={c} value={c}/>)}
            </datalist>
          </div>
          <div>
            <label className="text-[13px] uppercase tracking-widest text-gray-500 font-black">Payment method</label>
            <select value={form.payment_method} onChange={(e)=>setForm({...form, payment_method:e.target.value})}
                    className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" data-testid="retail-payment-method">
              <option value="card">Card</option>
              <option value="cash">Cash</option>
              <option value="transfer">Transfer</option>
              <option value="check">Check</option>
              <option value="credits">Credits</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>

        <div>
          <label className="text-[13px] uppercase tracking-widest text-gray-500 font-black">Tag to client (optional)</label>
          <div className="relative">
            {form.client_id ? (
              <div className="w-full mt-1 bg-bgBase border border-purple-500/40 rounded p-2 flex items-center gap-2" data-testid="retail-client-selected">
                <i className="fas fa-user text-purple-300 text-[12px]"/>
                <span className="text-white text-sm font-black flex-1">{selectedClient?.name || "Unknown"}</span>
                <button onClick={()=>{ setForm({...form, client_id:""}); setClientQuery(""); }} className="text-gray-400 hover:text-red-400 text-[12px]" data-testid="retail-client-clear">
                  <i className="fas fa-times"/>
                </button>
              </div>
            ) : (
              <>
                <input value={clientQuery} onChange={(e)=>setClientQuery(e.target.value)}
                       placeholder="Type to search clients…" data-testid="retail-client-search"
                       className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
                {clientResults.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full bg-bgPanel border border-bgHover rounded shadow-2xl max-h-48 overflow-y-auto">
                    {clientResults.map(c => (
                      <button key={c.id} onClick={()=>{ setForm({...form, client_id:c.id}); setClientQuery(""); }}
                              data-testid={`retail-client-pick-${c.id}`}
                              className="w-full text-left px-3 py-2 hover:bg-bgHover text-white text-[15px]">
                        <span className="font-black">{c.name}</span> <span className="text-gray-500 text-[13px]">· {c.email || "—"}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div>
          <label className="text-[13px] uppercase tracking-widest text-gray-500 font-black">Notes (optional)</label>
          <textarea value={form.notes} onChange={(e)=>setForm({...form, notes:e.target.value})} rows={2}
                    className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm resize-none" data-testid="retail-notes" />
        </div>

        {/* Sprint 110di-61 — Partial-pay toggle. Only available when a
            client is selected (tab requires a client to attach to). */}
        {form.client_id && !isEdit && Number(form.amount) > 0 && (
          <div className="border-t border-bgHover pt-3">
            <label className="text-[13px] uppercase tracking-widest text-gray-500 font-black block mb-2">
              <i className="fas fa-cash-register mr-1 text-shGreen"/>How much is the client paying today?
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={()=>{ setPayMode("full"); setAmountPaid(""); }}
                      data-testid="retail-pay-full"
                      className={`p-2 rounded border-2 text-left transition ${payMode==="full" ? "border-shGreen bg-shGreen/15 text-white" : "border-bgHover bg-bgPanel text-gray-400 hover:border-shGreen/50"}`}>
                <div className="text-[12px] font-black uppercase tracking-widest"><i className="fas fa-check-circle mr-1"/>Paid in full</div>
              </button>
              <button type="button" onClick={()=>setPayMode("partial")}
                      data-testid="retail-pay-partial"
                      className={`p-2 rounded border-2 text-left transition ${payMode==="partial" ? "border-shOrange bg-shOrange/15 text-white" : "border-bgHover bg-bgPanel text-gray-400 hover:border-shOrange/50"}`}>
                <div className="text-[12px] font-black uppercase tracking-widest"><i className="fas fa-file-invoice-dollar mr-1"/>Partial / on tab</div>
              </button>
            </div>
            {payMode === "partial" && (
              <div className="mt-2 grid grid-cols-3 gap-3 items-end bg-shOrange/5 border border-shOrange/30 rounded p-3" data-testid="retail-partial-block">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-gray-500 font-black">Total</p>
                  <p className="text-xl font-black text-white mt-1">${Number(form.amount).toFixed(2)}</p>
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-widest text-shOrange font-black block">Paying today</label>
                  <input type="number" step="0.01" min="0" value={amountPaid}
                         onChange={(e)=>setAmountPaid(e.target.value)}
                         data-testid="retail-amount-paid" placeholder="$0.00"
                         className="w-full mt-1 bg-bgPanel border-2 border-shOrange/60 rounded p-2 text-white text-lg font-black focus:border-shOrange focus:outline-none"/>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-gray-500 font-black">On tab</p>
                  <p className="text-xl font-black mt-1">
                    <span className={amountPaid === "" ? "text-gray-500" : (Number(amountPaid) < Number(form.amount) ? "text-shOrange" : (Number(amountPaid) > Number(form.amount) ? "text-shGreen" : "text-gray-400"))}>
                      {amountPaid === "" ? `+$${Number(form.amount).toFixed(2)}` : Number(amountPaid) < Number(form.amount) ? `+$${(Number(form.amount) - Number(amountPaid)).toFixed(2)}` : Number(amountPaid) > Number(form.amount) ? `−$${(Number(amountPaid) - Number(form.amount)).toFixed(2)}` : "$0.00"}
                    </span>
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2 justify-end pt-2">
          <button onClick={onClose} className="bg-bgBase border border-bgHover text-gray-300 px-4 py-2 rounded text-[14px] font-black uppercase tracking-widest hover:border-shBlue">Cancel</button>
          <button onClick={save} disabled={busy} data-testid="retail-save"
                  className="bg-purple-500/20 text-purple-300 border border-purple-500/40 px-5 py-2 rounded text-[14px] font-black uppercase tracking-widest hover:bg-purple-500/30 disabled:opacity-50">
            {busy ? "Saving…" : (isEdit ? "Save changes" : "Log sale")}
          </button>
        </div>
      </div>
    </div>
  );
}
