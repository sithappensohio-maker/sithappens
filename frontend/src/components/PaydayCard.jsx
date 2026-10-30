import { useCallback, useEffect, useState } from "react";
import { api, formatErr } from "../lib/api";
import { fmtDate } from "../lib/format";
import { parseLocalISO, todayISO } from "../lib/date";

/* Staff → Payroll: the pay schedule, and on payday who is owed what.
 * Amounts come from GET /admin/payroll/payday, which reuses the Payroll Tax
 * estimate for the pay period, so they match that tab and the CSV. */

const CADENCES = [["biweekly", "Every 2 weeks"], ["weekly", "Every week"]];

export function dayLabel(iso) {
  if (!iso) return "";
  return `${parseLocalISO(iso).toLocaleDateString("en-US", { weekday: "short" })} ${fmtDate(iso)}`;
}

const money = (n) => `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function PaydayCard() {
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ cadence: "biweekly", anchor_payday: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setErr("");
    try { setData((await api.get("/admin/payroll/payday")).data); }
    catch (e) {
      // Without finance_reports there is nothing here this person may see.
      if (e?.response?.status === 403) setData({ forbidden: true });
      else setErr(formatErr(e));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const openEditor = () => {
    setForm({ cadence: data?.schedule?.cadence || "biweekly", anchor_payday: data?.schedule?.anchor_payday || todayISO() });
    setErr("");
    setEditing(true);
  };
  const save = async () => {
    setSaving(true); setErr("");
    try {
      setData((await api.put("/admin/payroll/schedule", form)).data);
      setEditing(false);
    } catch (e) { setErr(formatErr(e)); }
    finally { setSaving(false); }
  };

  const shell = "bg-[var(--sh-card-base)] border border-shBorder rounded-xl p-5 space-y-3";
  if (data?.forbidden) return null;
  if (!data) {
    return (
      <div className={shell} data-testid="payday-card">
        <p className="text-shTextMuted text-[14px]">{err || "Loading payday…"}</p>
        {err && (
          <button onClick={load} data-testid="payday-retry"
                  className="bg-[var(--sh-card-base)] border border-shBorder px-3 py-2 rounded text-[12px] font-black uppercase tracking-widest text-shTextMuted hover:border-shPrimary">
            <i className="fas fa-rotate-right mr-1"/>Try again
          </button>
        )}
      </div>
    );
  }

  if (!data.configured || editing) {
    return (
      <div className={shell} data-testid="payday-card">
        <h4 className="text-shText font-black uppercase italic"><i className="fas fa-calendar-check text-shPrimary mr-2"/>Pay schedule</h4>
        <p className="text-[14px] text-shTextMuted">
          {data.configured ? "Change how often you pay staff. Paydays before today count as paid." : "Set when you pay staff and the app will tell you on each payday what you owe each person."}
          {" "}Each payday pays every hour worked since the last payday, up to the day before.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-[12px] font-black uppercase tracking-widest text-shTextMuted">
            <span className="block mb-1">How often</span>
            <select value={form.cadence} onChange={(e) => setForm({ ...form, cadence: e.target.value })} data-testid="payday-cadence"
                    className="bg-[var(--sh-card-base)] border border-shBorder rounded p-1.5 text-shText text-sm normal-case tracking-normal">
              {CADENCES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
          <label className="text-[12px] font-black uppercase tracking-widest text-shTextMuted">
            <span className="block mb-1">One payday (past or next)</span>
            <input type="date" value={form.anchor_payday} onChange={(e) => setForm({ ...form, anchor_payday: e.target.value })}
                   style={{ colorScheme: "dark" }} data-testid="payday-anchor"
                   className="bg-[var(--sh-card-base)] border border-shBorder rounded p-1.5 text-shText text-sm"/>
          </label>
          <button onClick={save} disabled={saving || !form.anchor_payday} data-testid="payday-save"
                  className="bg-shPrimary text-bgHeader px-4 py-2 rounded text-[13px] font-black uppercase tracking-widest disabled:opacity-50">
            {saving ? "Saving…" : "Save schedule"}
          </button>
          {data.configured && (
            <button onClick={() => setEditing(false)} data-testid="payday-cancel"
                    className="px-3 py-2 rounded text-[13px] font-black uppercase tracking-widest text-shTextMuted hover:text-shText">
              Cancel
            </button>
          )}
        </div>
        {err && <p className="text-red-400 text-[14px]">{err}</p>}
      </div>
    );
  }

  const staff = data.per_user || [];
  return (
    <div className={shell} data-testid="payday-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`text-[11px] font-black uppercase tracking-[0.25em] ${data.is_today ? "text-shAccent" : "text-shTextMuted"}`}>
            <i className="fas fa-money-check-dollar mr-1"/>{data.is_today ? "Payday is today" : "Last payday"}
          </p>
          <h4 className="text-shText font-black text-xl" data-testid="payday-date">{dayLabel(data.payday)}</h4>
          <p className="text-[13px] text-shTextMuted" data-testid="payday-period">
            {data.before_schedule_change
              ? "This payday came before you changed your schedule"
              : `Pays hours worked ${dayLabel(data.period_start)} – ${dayLabel(data.period_end)}`}
            {" "}· Next payday {dayLabel(data.next_payday)}
          </p>
        </div>
        <button onClick={openEditor} data-testid="payday-edit"
                className="bg-[var(--sh-card-base)] border border-shBorder px-3 py-2 rounded text-[12px] font-black uppercase tracking-widest text-shTextMuted hover:border-shPrimary">
          <i className="fas fa-sliders mr-1"/>Change schedule
        </button>
      </div>

      {data.open_shifts > 0 && (
        <div className="bg-shAccent/10 border border-shAccent/40 rounded-lg p-3 text-[13px] text-shText" data-testid="payday-open-shifts">
          <i className="fas fa-triangle-exclamation text-shAccent mr-1"/>
          {data.open_shifts} shift{data.open_shifts !== 1 ? "s" : ""} in this pay period {data.open_shifts !== 1 ? "are" : "is"} still clocked in, so {data.open_shifts !== 1 ? "they aren't" : "it isn't"} counted below. Clock {data.open_shifts !== 1 ? "them" : "it"} out under Timecards first.
        </div>
      )}

      {staff.length === 0 ? (
        <p className="text-[14px] text-shTextMuted" data-testid="payday-empty">
          {data.before_schedule_change
            ? `Nothing is owed on it. Hours worked since your last payday are paid on ${dayLabel(data.next_payday)}.`
            : "No hours were clocked in this pay period, so nobody is owed pay."}
        </p>
      ) : (
        <div className="divide-y divide-shBorder/50" data-testid="payday-list">
          {staff.map((u) => (
            <div key={u.user_id} className="flex items-baseline justify-between gap-3 py-2" data-testid={`payday-row-${u.user_id}`}>
              <div className="min-w-0">
                <p className="text-shText font-black break-words">{u.name}</p>
                <p className="text-[12px] text-shTextMuted">{u.hours} hrs · est. take-home {money(u.estimated_take_home)}</p>
              </div>
              <p className="text-shPrimary font-black text-lg shrink-0">{money(u.gross)}</p>
            </div>
          ))}
          <div className="flex items-baseline justify-between pt-2">
            <p className="text-shText font-black uppercase tracking-widest text-[13px]">You owe</p>
            <p className="text-shPrimary font-black text-xl" data-testid="payday-total">{money(data.totals?.gross)}</p>
          </div>
        </div>
      )}
      <p className="text-[12px] text-shTextMuted">
        Owed is gross pay: hours × the rate each shift was worked at. Take-home is an estimate from your Payroll Tax rates. Your own hours as owner aren't here, since they're your draw.
      </p>
    </div>
  );
}
