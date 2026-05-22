import { useMemo, useState } from "react";

/**
 * Two-month forward calendar grid for picking specific (non-consecutive) days.
 * Used by AdminBookingModal and PortalBookWizard.
 *
 * Props:
 *   value: string[] — selected dates as YYYY-MM-DD
 *   onChange: (next: string[]) => void
 *   monthsAhead: number — how many months past current month to render (default 2)
 *   closedDates: string[] — YYYY-MM-DD list to mark as closed (read-only)
 *   testid: optional root testid prefix
 */
function pad(n) { return n < 10 ? "0" + n : "" + n; }
function fmtDate(d) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function todayISO() { return fmtDate(new Date()); }
function fmtChip(d) {
  return new Date(d + "T12:00:00").toLocaleDateString(undefined, { month:"short", day:"numeric" });
}
const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

export default function MultiDatePicker({
  value = [],
  onChange,
  monthsAhead = 2,
  closedDates = [],
  testid = "multi-date-picker",
}) {
  const [offset, setOffset] = useState(0); // month-offset relative to "this month"
  const selected = useMemo(() => new Set(value), [value]);
  const closed = useMemo(() => new Set(closedDates || []), [closedDates]);
  const today = todayISO();

  const toggle = (iso) => {
    if (iso < today) return;            // can't pick past
    if (closed.has(iso)) return;        // closed days are read-only
    const next = selected.has(iso) ? value.filter(d => d !== iso) : [...value, iso].sort();
    onChange(next);
  };

  const renderMonth = (yearOffset, monthOffset) => {
    const base = new Date();
    const first = new Date(base.getFullYear(), base.getMonth() + monthOffset, 1);
    const monthLabel = first.toLocaleDateString(undefined, { month:"long", year:"numeric" });
    const startWeekday = first.getDay(); // 0=Sun
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < startWeekday; i++) cells.push(null);
    for (let day = 1; day <= daysInMonth; day++) {
      cells.push(new Date(first.getFullYear(), first.getMonth(), day));
    }
    return (
      <div key={monthLabel} className="bg-bgBase border border-bgHover rounded-lg p-3" data-testid={`${testid}-month`}>
        <p className="text-[13px] font-black uppercase tracking-widest text-gray-300 text-center mb-2">{monthLabel}</p>
        <div className="grid grid-cols-7 gap-1 text-[11px] font-black uppercase text-gray-500 text-center mb-1">
          {WEEKDAY_LABELS.map((d,i) => <div key={`${monthLabel}-h-${i}`}>{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((d, idx) => {
            if (!d) return <div key={`${monthLabel}-e-${idx}`} className="h-8"/>;
            const iso = fmtDate(d);
            const isPast = iso < today;
            const isToday = iso === today;
            const isSelected = selected.has(iso);
            const isClosed = closed.has(iso);
            const disabled = isPast || isClosed;
            const base =
              "h-8 rounded text-[12px] font-black flex items-center justify-center transition border";
            const color = disabled
              ? "border-transparent text-gray-700 line-through cursor-not-allowed"
              : isSelected
                ? "bg-shGreen text-black border-shGreen shadow"
                : isToday
                  ? "border-shBlue/60 text-shBlue hover:bg-shBlue/15"
                  : "border-bgHover text-gray-300 hover:border-shGreen/60 hover:bg-shGreen/10";
            return (
              <button
                key={`${monthLabel}-${iso}`}
                onClick={() => toggle(iso)}
                disabled={disabled}
                data-testid={`${testid}-day-${iso}`}
                className={`${base} ${color}`}
                title={isClosed ? "Closed" : ""}
              >
                {d.getDate()}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const months = [];
  for (let i = 0; i <= monthsAhead; i++) {
    months.push(renderMonth(0, offset + i));
  }

  const clearAll = () => onChange([]);

  return (
    <div data-testid={testid}>
      <div className="flex items-center justify-between mb-2">
        <button onClick={()=>setOffset(o => Math.max(o - 1, 0))} disabled={offset === 0}
                data-testid={`${testid}-prev`}
                className="text-[12px] font-black uppercase tracking-widest text-gray-400 hover:text-shBlue disabled:opacity-40 px-2 py-1">
          <i className="fas fa-chevron-left mr-1"/>Prev
        </button>
        <span className="text-[12px] font-black uppercase tracking-widest text-gray-500">
          Tap dates to pick
        </span>
        <button onClick={()=>setOffset(o => o + 1)}
                data-testid={`${testid}-next`}
                className="text-[12px] font-black uppercase tracking-widest text-gray-400 hover:text-shBlue px-2 py-1">
          Next<i className="fas fa-chevron-right ml-1"/>
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {months}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 min-h-[28px]" data-testid={`${testid}-chips`}>
        {value.length === 0 ? (
          <span className="text-[13px] text-gray-500 font-black uppercase tracking-widest">No dates selected</span>
        ) : (
          <>
            <span className="text-[13px] font-black uppercase tracking-widest text-shGreen">
              {value.length} day{value.length===1?"":"s"} picked
            </span>
            {value.map(d => (
              <span key={d} className="bg-shGreen/15 border border-shGreen/40 text-shGreen rounded px-2 py-0.5 text-[13px] font-black flex items-center gap-1.5"
                    data-testid={`${testid}-chip-${d}`}>
                {fmtChip(d)}
                <button onClick={()=>toggle(d)} className="hover:text-white" title="Remove">
                  <i className="fas fa-times text-[11px]"/>
                </button>
              </span>
            ))}
            <button onClick={clearAll}
                    data-testid={`${testid}-clear`}
                    className="text-[12px] font-black uppercase tracking-widest text-gray-400 hover:text-red-400 ml-1">
              Clear all
            </button>
          </>
        )}
      </div>
    </div>
  );
}
