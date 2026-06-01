// Sprint 110bq — Quick-log mileage tile for the admin Dashboard.
//
// Solo-operator workflow: end of every day, glance at the dashboard, type in
// the miles you drove for the business, hit "Log". Today + Month + YTD tiles
// update instantly and the YTD deduction flows into the Quarterly Tax tab.

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { toast } from "sonner";
import { todayISO } from "../lib/date";

export function MileageDashTile({ onNavTax }) {
  const [data, setData] = useState(null);
  const [recent, setRecent] = useState([]);
  const [date, setDate] = useState(todayISO());
  const [miles, setMiles] = useState("");
  const [purpose, setPurpose] = useState("");
  const [destination, setDestination] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const [s, r] = await Promise.all([
        api.get("/admin/mileage/summary"),
        api.get("/admin/mileage/recent-trips").catch(() => ({ data: { trips: [] } })),
      ]);
      setData(s.data);
      setRecent(r.data.trips || []);
    } catch (e) {
      setError(e.response?.data?.detail || "Could not load mileage");
    }
  };
  useEffect(() => { load(); }, []);

  const applyRecent = (idx) => {
    if (idx === "") return;
    const t = recent[Number(idx)];
    if (!t) return;
    setPurpose(t.purpose || "");
    setDestination(t.destination || "");
    if (t.last_miles && !miles) setMiles(String(t.last_miles));
  };

  const log = async (e) => {
    e?.preventDefault?.();
    const m = parseFloat(miles);
    if (!Number.isFinite(m) || m <= 0) {
      setError("Enter miles greater than 0");
      return;
    }
    setBusy(true); setError("");
    try {
      const r = await api.post("/admin/mileage", {
        miles: m,
        date,
        purpose: purpose.trim(),
        destination: destination.trim(),
      });
      const ded = r.data.miles * (data?.rate_per_mile || 0.7);
      const savings = ded * ((data?.combined_tax_rate_pct || 0) / 100);
      toast.success(
        savings > 0
          ? `Logged ${r.data.miles} mi · +$${ded.toFixed(2)} deduction · ~$${savings.toFixed(2)} tax saved`
          : `Logged ${r.data.miles} mi · +$${ded.toFixed(2)} deduction`
      );
      setMiles(""); setPurpose(""); setDestination("");
      setDate(todayISO());
      await load();
    } catch (err) {
      setError(err.response?.data?.detail || "Could not log mileage");
    } finally { setBusy(false); }
  };

  return (
    <div className="bg-bgPanel rounded-xl border border-bgHover overflow-hidden card-pop" data-testid="mileage-dash-tile">
      <div className="px-4 pt-3 pb-2 flex items-center justify-between flex-wrap gap-2">
        <p className="text-[12px] font-black uppercase tracking-[0.3em] text-shGreen">
          <i className="fas fa-car-side mr-2"/>Business Mileage
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          {data && data.ytd_tax_savings > 0 && (
            <span data-testid="mileage-tax-savings-chip"
                  title={`Approx ${data.combined_tax_rate_pct}% combined marginal rate`}
                  className="bg-shGreen/10 border border-shGreen/40 text-shGreen px-2.5 py-1 rounded-full text-[11px] font-black uppercase tracking-widest">
              <i className="fas fa-piggy-bank mr-1"/>
              YTD tax savings ${data.ytd_tax_savings.toFixed(2)}
            </span>
          )}
          {data && (
            <button onClick={onNavTax}
                    data-testid="mileage-dash-nav"
                    className="text-[11px] font-black uppercase tracking-widest text-shBlue hover:underline">
              Quarterly tax<i className="fas fa-arrow-right ml-1"/>
            </button>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2 px-4 pb-3" data-testid="mileage-stats">
        <Stat label="Today" miles={data?.today_miles} dollars={data?.today_deduction} accent="text-shGreen"/>
        <Stat label="This month" miles={data?.mtd_miles} dollars={data?.mtd_deduction} accent="text-white"/>
        <Stat label="YTD" miles={data?.ytd_miles} dollars={data?.ytd_deduction} accent="text-shBlue"/>
      </div>

      {/* Quick-log form */}
      <form onSubmit={log}
            className="border-t border-bgHover bg-bgBase/30 px-4 py-3 space-y-2"
            data-testid="mileage-log-form">
        {recent.length > 0 && (
          <div className="flex items-center gap-2" data-testid="mileage-recent-row">
            <label className="block flex-1">
              <span className="block text-[10px] font-black uppercase tracking-widest text-gray-500">
                <i className="fas fa-clock-rotate-left mr-1 text-shBlue"/>Re-use a recent trip
              </span>
              <select onChange={(e) => applyRecent(e.target.value)}
                      defaultValue=""
                      data-testid="mileage-recent-select"
                      className="mt-1 w-full bg-bgPanel border border-bgHover rounded p-2 text-white text-sm">
                <option value="">— pick a recent trip —</option>
                {recent.map((t, i) => (
                  <option key={i} value={i}>
                    {[t.purpose, t.destination].filter(Boolean).join(" · ")}
                    {t.last_miles ? ` (${t.last_miles} mi)` : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="block text-[10px] font-black uppercase tracking-widest text-gray-500">Date</span>
            <input type="date" value={date} onChange={(e)=>setDate(e.target.value)}
                   data-testid="mileage-input-date"
                   className="mt-1 bg-bgPanel border border-bgHover rounded p-2 text-white text-sm"/>
          </label>
          <label className="block">
            <span className="block text-[10px] font-black uppercase tracking-widest text-gray-500">Miles</span>
            <input type="number" min="0" step="0.1" value={miles} onChange={(e)=>setMiles(e.target.value)}
                   placeholder="e.g. 12.5"
                   data-testid="mileage-input-miles"
                   className="mt-1 w-24 bg-bgPanel border border-bgHover rounded p-2 text-white text-sm"/>
          </label>
          <label className="block flex-1 min-w-[160px]">
            <span className="block text-[10px] font-black uppercase tracking-widest text-gray-500">Purpose</span>
            <input type="text" value={purpose} onChange={(e)=>setPurpose(e.target.value)}
                   placeholder='e.g. "Supply run"'
                   data-testid="mileage-input-purpose"
                   className="mt-1 w-full bg-bgPanel border border-bgHover rounded p-2 text-white text-sm"/>
          </label>
          <label className="block flex-1 min-w-[160px]">
            <span className="block text-[10px] font-black uppercase tracking-widest text-gray-500">Destination</span>
            <input type="text" value={destination} onChange={(e)=>setDestination(e.target.value)}
                   placeholder='e.g. "Petco · Niles Rd"'
                   data-testid="mileage-input-destination"
                   className="mt-1 w-full bg-bgPanel border border-bgHover rounded p-2 text-white text-sm"/>
          </label>
          <button type="submit" disabled={busy}
                  data-testid="mileage-log-submit"
                  className="bg-shGreen text-bgHeader px-4 py-2 rounded text-[12px] font-black uppercase tracking-widest disabled:opacity-50">
            {busy ? <><i className="fas fa-circle-notch fa-spin mr-1"/>Logging…</> : <><i className="fas fa-plus mr-1"/>Log miles</>}
          </button>
          {data?.rate_per_mile && (
            <span className="text-[11px] text-gray-500 italic">Rate ${data.rate_per_mile}/mi</span>
          )}
        </div>
      </form>

      {error && (
        <p className="px-4 pb-2 text-red-400 text-[12px]" data-testid="mileage-error">
          <i className="fas fa-circle-exclamation mr-1"/>{error}
        </p>
      )}
    </div>
  );
}

function Stat({ label, miles, dollars, accent }) {
  const m = miles ?? 0;
  const d = dollars ?? 0;
  return (
    <div className="bg-bgBase rounded-lg border border-bgHover p-2 text-center">
      <p className="text-[10px] font-black uppercase tracking-widest text-gray-500">{label}</p>
      <p className={`text-lg font-black ${accent}`}>{m} mi</p>
      <p className="text-[11px] text-gray-400">${d.toFixed ? d.toFixed(2) : d}</p>
    </div>
  );
}
