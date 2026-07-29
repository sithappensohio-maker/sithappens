import { useState } from "react";

/**
 * Two-month forward calendar grid where the client taps days to toggle
 * them into the selected list. Returns an array of YYYY-MM-DD strings
 * via `onToggle(date)`.
 *
 * Past days are non-interactive. Today is highlighted blue.
 */
function ymd(d) { return d.toISOString().split("T")[0]; }

function MonthGrid({ year, month, selected, onToggle, today }) {
  const first = new Date(year, month, 1);
  const start = new Date(first);
  start.setDate(start.getDate() - start.getDay()); // back up to Sunday
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const cell = new Date(start);
    cell.setDate(start.getDate() + i);
    cells.push(cell);
  }
  const monthName = first.toLocaleString("default", { month: "long", year: "numeric" });
  const todayStr = ymd(today);
  return (
    <div>
      <p className="text-[14px] font-black uppercase tracking-widest text-shSecondary mb-2">{monthName}</p>
      <div className="grid grid-cols-7 gap-1 text-center text-[12px] font-black text-shTextMuted uppercase tracking-widest mb-1">
        <span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d) => {
          const inMonth = d.getMonth() === month;
          const iso = ymd(d);
          const isPast = iso < todayStr;
          const isToday = iso === todayStr;
          const isSelected = selected.includes(iso);
          if (!inMonth) return <div key={iso} />;
          return (
            <button
              key={iso}
              onClick={() => !isPast && onToggle(iso)}
              disabled={isPast}
              data-testid={`md-cell-${iso}`}
              className={`aspect-square rounded text-[14px] font-black uppercase transition
                ${isPast ? "text-gray-700 bg-[var(--sh-card-base)] cursor-not-allowed"
                  : isSelected ? "bg-shPrimary text-bgHeader shadow-md"
                  : isToday ? "bg-shSecondary/20 text-shSecondary border border-shSecondary/40 hover:bg-shSecondary/30"
                  : "bg-[var(--sh-card-base)] border border-shBorder text-shTextMuted hover:border-shPrimary hover:text-shPrimary"}`}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function MultiDateCalendar({ selected, onToggle }) {
  const today = new Date();
  const [anchor, setAnchor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const next = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
  const prev = () => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1));
  const fwd = () => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1));
  const clear = () => selected.forEach(d => onToggle(d));

  return (
    <div className="mb-3" data-testid="multi-date-calendar">
      <div className="flex items-center justify-between mb-2">
        <button onClick={prev} className="text-shSecondary text-[14px] font-black px-2"><i className="fas fa-chevron-left"/></button>
        <p className="text-[14px] font-black uppercase tracking-widest text-shTextMuted">Tap to toggle days</p>
        <button onClick={fwd} className="text-shSecondary text-[14px] font-black px-2"><i className="fas fa-chevron-right"/></button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-[var(--sh-card-base)] border border-shBorder rounded p-3">
        <MonthGrid year={anchor.getFullYear()} month={anchor.getMonth()} selected={selected} onToggle={onToggle} today={today} />
        <MonthGrid year={next.getFullYear()} month={next.getMonth()} selected={selected} onToggle={onToggle} today={today} />
      </div>
      {selected.length > 0 && (
        <div className="mt-3 bg-shPrimary/10 border border-shPrimary/30 rounded p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[14px] font-black uppercase tracking-widest text-shPrimary"><i className="fas fa-calendar-check mr-1"/>{selected.length} day{selected.length===1?"":"s"} selected</p>
            <button onClick={clear} className="text-[13px] uppercase tracking-widest text-shDanger font-black hover:underline">Clear all</button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {selected.map(d => (
              <span key={d} className="bg-[var(--sh-card-base)] text-shPrimary text-[13px] font-black uppercase tracking-widest px-2 py-1 rounded flex items-center gap-1.5">
                {d}
                <button onClick={()=>onToggle(d)} className="hover:text-shDanger"><i className="fas fa-times text-[9px]"/></button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
