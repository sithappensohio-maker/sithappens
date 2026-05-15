import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";

function todayISO() { return new Date().toISOString().split("T")[0]; }
function fmt(n) { return `$${(Number(n) || 0).toFixed(2)}`; }

const PAYMENT_STATUSES = [
  { key: "unpaid",   label: "Unpaid",   color: "bg-shOrange/15 text-shOrange" },
  { key: "paid",     label: "Paid",     color: "bg-shGreen/15 text-shGreen" },
  { key: "comped",   label: "Comped",   color: "bg-shBlue/15 text-shBlue" },
  { key: "refunded", label: "Refunded", color: "bg-red-500/15 text-red-400" },
];

const PAYMENT_METHODS = ["cash", "card", "transfer", "credits", "other"];

export default function Income() {
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
  const [filters, setFilters] = useState({ dog_id: "", service_id: "", payment_status: "", status: "" });
  const [showLegacy, setShowLegacy] = useState(false);
  const [search, setSearch] = useState("");
  const [savingId, setSavingId] = useState(null);

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
    const d = new Date(refDate);
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
    setRangeStart(s.toISOString().split("T")[0]);
    setRangeEnd(e.toISOString().split("T")[0]);
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
      window.alert(`Update failed: ${e.response?.data?.detail || e.message}`);
      load();  // pull fresh values to revert local optimistic state
    } finally { setSavingId(null); }
  };

  const removeTxn = async (r) => {
    if (!window.confirm(`Remove transaction for ${r.dog_name} on ${r.date}?`)) return;
    await api.delete(`/transactions/${r.id}`);
    load();
  };

  return (
    <div className="space-y-6 animate-slide-in" data-testid="income-screen">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h3 className="text-xl font-black text-white uppercase italic tracking-tight"><i className="fas fa-dollar-sign text-shGreen mr-2"/>Income & Services</h3>
          <p className="text-[14px] text-gray-500 font-black uppercase tracking-widest mt-1">Weekly tally, transaction log, and quick service entry</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportCSV} data-testid="income-export-csv"
                  className="bg-bgPanel border border-bgHover text-gray-300 px-4 py-2 rounded text-[12px] font-black uppercase tracking-widest hover:border-shBlue">
            <i className="fas fa-file-csv mr-1"/>Export CSV
          </button>
          <button onClick={()=>setLogOpen(true)} data-testid="income-log-service-btn"
                  className="bg-shGreen text-black px-5 py-2 rounded text-[13px] font-black uppercase tracking-widest hover:bg-shGreen/80">
            <i className="fas fa-plus mr-1"/>Log Service
          </button>
        </div>
      </div>

      {/* Weekly tally tiles */}
      {summary && (
        <div className="bg-bgPanel border border-bgHover rounded-xl p-5" data-testid="weekly-summary">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
            <div>
              <p className="text-[13px] font-black uppercase tracking-widest text-gray-500">This Week (Mon–Sun)</p>
              <p className="text-white font-black uppercase italic tracking-tight">{summary.week_start} → {summary.week_end}</p>
            </div>
            <div className="flex gap-2 items-center">
              <button onClick={()=>setRefDate(new Date(new Date(refDate).getTime() - 7*86400000).toISOString().split("T")[0])}
                      className="bg-bgBase border border-bgHover px-3 py-1.5 rounded text-gray-300 text-[12px] font-black hover:border-shBlue">
                <i className="fas fa-chevron-left"/>
              </button>
              <input type="date" value={refDate} onChange={(e)=>setRefDate(e.target.value)} style={{colorScheme:"dark"}}
                     className="bg-bgBase border border-bgHover rounded p-1.5 text-white text-sm" data-testid="weekly-ref-date" />
              <button onClick={()=>setRefDate(new Date(new Date(refDate).getTime() + 7*86400000).toISOString().split("T")[0])}
                      className="bg-bgBase border border-bgHover px-3 py-1.5 rounded text-gray-300 text-[12px] font-black hover:border-shBlue">
                <i className="fas fa-chevron-right"/>
              </button>
              <button onClick={()=>setRefDate(todayISO())}
                      className="bg-bgBase border border-bgHover px-3 py-1.5 rounded text-shBlue text-[12px] font-black uppercase tracking-widest hover:border-shBlue">
                Today
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatTile label="Completed" value={fmt(summary.completed_total)} sub={`${summary.completed_count} sessions`} color="text-shGreen" icon="fa-circle-check" big data-testid="tile-completed" />
            <StatTile label="Paid" value={fmt(summary.paid_total)} sub="received" color="text-shBlue" icon="fa-dollar-sign" />
            <StatTile label="Unpaid" value={fmt(summary.unpaid_total)} sub="outstanding" color="text-shOrange" icon="fa-hourglass-half" />
            <StatTile label="Booked (upcoming)" value={fmt(summary.booked_total)} sub={`${summary.booked_count} sessions`} color="text-gray-300" icon="fa-calendar" />
          </div>
          {summary.by_service?.length > 0 && (
            <div className="mt-4">
              <p className="text-[12px] font-black uppercase tracking-widest text-gray-500 mb-2">Breakdown by service</p>
              <div className="flex flex-wrap gap-2">
                {summary.by_service.map(b => (
                  <span key={b.name} className="bg-bgBase border border-bgHover rounded px-3 py-1.5 text-[12px]">
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
        <div className="bg-bgPanel border border-bgHover rounded-xl p-5" data-testid="range-summary">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
            <div>
              <p className="text-[13px] font-black uppercase tracking-widest text-gray-500">Longer-Range View</p>
              <p className="text-white font-black uppercase italic tracking-tight">{rangeStart} → {rangeEnd}</p>
            </div>
            <div className="flex flex-wrap gap-1">
              {["month","quarter","ytd","custom"].map(k => (
                <button key={k} onClick={()=>setRangePreset(k)} data-testid={`range-preset-${k}`}
                        className={`px-3 py-1.5 rounded text-[12px] font-black uppercase tracking-widest ${rangePreset===k?"bg-shBlue text-white":"bg-bgBase text-gray-400 border border-bgHover hover:border-shBlue"}`}>
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
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
            <StatTile label="Completed (revenue earned)" value={fmt(rangeSummary.completed_total)} sub={`over ${rangeSummary.by_day?.length || 0} active days`} color="text-shGreen" icon="fa-circle-check" big />
            <StatTile label="Paid" value={fmt(rangeSummary.paid_total)} sub="received" color="text-shBlue" icon="fa-dollar-sign" />
            <StatTile label="Avg / day" value={fmt(rangeSummary.completed_total / Math.max(rangeSummary.by_day?.length || 1, 1))} sub="active-day average" color="text-gray-300" icon="fa-chart-line" />
          </div>
          {rangeSummary.by_day?.length > 0 && <DailyBarChart points={rangeSummary.by_day} />}
        </div>
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
        <label className="flex items-center gap-2 text-[12px] font-black uppercase tracking-widest text-gray-400 cursor-pointer hover:text-shBlue">
          <input type="checkbox" checked={showLegacy} onChange={(e)=>setShowLegacy(e.target.checked)} data-testid="show-legacy-toggle"
                 className="w-4 h-4 accent-shBlue" />
          Include unpriced
        </label>
      </div>

      {/* Spreadsheet table */}
      <div className="bg-bgPanel border border-bgHover rounded-xl overflow-hidden" data-testid="income-table">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="bg-bgBase border-b border-bgHover text-[11px] font-black uppercase tracking-widest text-gray-500">
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
                <tr><td colSpan="8" className="text-center text-gray-500 text-[12px] uppercase font-black tracking-widest py-10">No transactions match these filters.</td></tr>
              )}
              {filtered.map(r => {
                const ps = PAYMENT_STATUSES.find(p => p.key === r.payment_status);
                return (
                  <tr key={r.id} className="border-b border-bgHover/40 hover:bg-bgBase/50" data-testid={`txn-row-${r.id}`}>
                    <td className="px-3 py-2 text-gray-300">{r.date}</td>
                    <td className="px-3 py-2">
                      <p className="text-white font-black">{r.dog_name}</p>
                      <p className="text-[11px] text-gray-500">{r.client_name}</p>
                    </td>
                    <td className="px-3 py-2">
                      <select value={r.service_id || ""} onChange={(e)=>{ if (e.target.value) inlineUpdate(r, { service_id: e.target.value }); }}
                              className="bg-bgBase border border-bgHover rounded p-1 text-[12px] text-gray-300 max-w-[150px]">
                        <option value="" disabled>— select service —</option>
                        {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                      {!r.service_id && r.service_type && (
                        <p className="text-[10px] text-gray-500 mt-0.5 uppercase">legacy · {r.service_type}</p>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <input type="number" step="0.01" defaultValue={r.actual_price || 0}
                             onBlur={(e)=>{
                               const v = parseFloat(e.target.value) || 0;
                               if (v !== (r.actual_price || 0)) inlineUpdate(r, { actual_price: v });
                             }}
                             data-testid={`txn-price-${r.id}`}
                             className="w-20 bg-bgBase border border-bgHover rounded p-1 text-right text-shGreen font-black text-[13px]" />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-[11px] font-black uppercase tracking-widest px-2 py-0.5 rounded ${r.status==="completed"?"bg-shGreen/15 text-shGreen":r.status==="approved"?"bg-shBlue/15 text-shBlue":"bg-shOrange/15 text-shOrange"}`}>{r.status}</span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <select value={r.payment_status || ""} onChange={(e)=>inlineUpdate(r, { payment_status: e.target.value })}
                              data-testid={`txn-payment-${r.id}`}
                              className={`text-[11px] font-black uppercase tracking-widest rounded px-2 py-0.5 ${ps?.color || "bg-bgBase text-gray-400"} border border-bgHover`}>
                        <option value="">— set —</option>
                        {PAYMENT_STATUSES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <select value={r.payment_method || ""} onChange={(e)=>inlineUpdate(r, { payment_method: e.target.value })}
                              className="bg-bgBase border border-bgHover rounded p-1 text-[12px] text-gray-300">
                        <option value="">—</option>
                        {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {savingId === r.id ? <i className="fas fa-spinner fa-spin text-gray-400 text-[12px]"/> : (
                        <button onClick={()=>removeTxn(r)} className="text-gray-500 hover:text-red-400 px-2" title="Remove transaction">
                          <i className="fas fa-trash text-[12px]"/>
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
                  <td colSpan="3" className="px-3 py-2 text-[11px] font-black uppercase tracking-widest text-gray-500">{filtered.length} rows</td>
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

      {logOpen && <LogServiceModal onClose={()=>setLogOpen(false)} onSaved={load} dogs={dogs} services={services} />}
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
      <div className="flex justify-between mt-2 text-[10px] text-gray-500 font-black uppercase tracking-widest">
        <span>{points[0]?.date}</span>
        <span>{points.length} days w/ revenue</span>
        <span>{points[points.length - 1]?.date}</span>
      </div>
    </div>
  );
}

function StatTile({ label, value, sub, color, icon, big = false }) {  return (
    <div className={`bg-bgBase border border-bgHover rounded-lg p-3 ${big ? "md:col-span-1" : ""}`}>
      <p className="text-[11px] font-black uppercase tracking-widest text-gray-500"><i className={`fas ${icon} mr-1 ${color}`}/>{label}</p>
      <p className={`${big ? "text-[24px]" : "text-[18px]"} font-black ${color} mt-1`}>{value}</p>
      {sub && <p className="text-[11px] text-gray-500 font-black uppercase tracking-widest mt-0.5">{sub}</p>}
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
            <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Dog</label>
            <div className="relative">
              <input value={dogQuery || selectedDog?.name || ""} onChange={(e)=>{setDogQuery(e.target.value); setForm({...form, dog_id: ""});}}
                     placeholder="Type to search…" data-testid="log-dog-search"
                     className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
              {dogResults.length > 0 && (
                <div className="absolute z-10 mt-1 w-full bg-bgPanel border border-bgHover rounded shadow-2xl max-h-48 overflow-y-auto">
                  {dogResults.map(d => (
                    <button key={d.id} onClick={()=>{setForm({...form, dog_id: d.id}); setDogQuery("");}}
                            data-testid={`log-dog-pick-${d.id}`}
                            className="w-full text-left px-3 py-2 hover:bg-bgHover text-white text-[13px]">
                      <span className="font-black">{d.name}</span> <span className="text-gray-500 text-[11px]">· {d.breed || "Unknown"}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div>
            <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Service</label>
            <select value={form.service_id} onChange={(e)=>onServiceChange(e.target.value)} data-testid="log-service-select"
                    className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
              {services.map(s => <option key={s.id} value={s.id}>{s.name} · ${s.base_price?.toFixed(2)}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Price (override)</label>
              <input type="number" step="0.01" value={form.actual_price} onChange={(e)=>setForm({...form, actual_price: parseFloat(e.target.value) || 0})}
                     data-testid="log-price-input"
                     className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-shGreen font-black text-sm" />
            </div>
            <div>
              <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Date</label>
              <input type="date" value={form.date} onChange={(e)=>setForm({...form, date: e.target.value})}
                     className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" style={{colorScheme:"dark"}} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Status</label>
              <select value={form.status} onChange={(e)=>setForm({...form, status: e.target.value})}
                      className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                <option value="completed">Completed</option>
                <option value="approved">Approved (upcoming)</option>
                <option value="pending">Pending</option>
              </select>
            </div>
            <div>
              <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Payment</label>
              <select value={form.payment_status} onChange={(e)=>setForm({...form, payment_status: e.target.value})}
                      className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                {PAYMENT_STATUSES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Method</label>
              <select value={form.payment_method} onChange={(e)=>setForm({...form, payment_method: e.target.value})}
                      className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm">
                {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-[12px] font-black text-gray-500 uppercase tracking-widest">Notes</label>
            <textarea value={form.notes} onChange={(e)=>setForm({...form, notes: e.target.value})} rows={2}
                      className="w-full mt-1 bg-bgBase border border-bgHover rounded p-2 text-white text-sm" />
          </div>
          {err && <p className="text-red-400 text-[13px]">{err}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="text-gray-400 px-4 py-2 font-black uppercase text-[13px] tracking-widest">Cancel</button>
            <button onClick={save} disabled={busy || !form.dog_id || !form.service_id} data-testid="log-save-btn"
                    className="bg-shGreen text-black px-6 py-2 rounded font-black text-[13px] uppercase tracking-widest hover:bg-shGreen/80 disabled:opacity-50">
              {busy ? "Saving…" : "Log Service"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
