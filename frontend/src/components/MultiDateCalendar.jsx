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
      <p className="text-[14px] font-black uppercase tracking-widest text-shBlue mb-2">{monthName}</p>
      <div className="grid grid-cols-7 gap-1 text-center text-[12px] font-black text-gray-500 uppercase tracking-widest mb-1">
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
                ${isPast ? "text-gray-700 bg-bgBase/40 cursor-not-allowed"
                  : isSelected ? "bg-shGreen text-bgHeader shadow-md"
                  : isToday ? "bg-shBlue/20 text-shBlue border border-shBlue/40 hover:bg-shBlue/30"
                  : "bg-bgBase border border-bgHover text-gray-300 hover:border-shGreen hover:text-shGreen"}`}
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
        <button onClick={prev} className="text-shBlue text-[14px] font-black px-2"><i className="fas fa-chevron-left"/></button>
        <p className="text-[14px] font-black uppercase tracking-widest text-gray-500">Tap to toggle days</p>
        <button onClick={fwd} className="text-shBlue text-[14px] font-black px-2"><i className="fas fa-chevron-right"/></button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-bgBase/40 border border-bgHover rounded p-3">
        <MonthGrid year={anchor.getFullYear()} month={anchor.getMonth()} selected={selected} onToggle={onToggle} today={today} />
        <MonthGrid year={next.getFullYear()} month={next.getMonth()} selected={selected} onToggle={onToggle} today={today} />
      </div>
      {selected.length > 0 && (
        <div className="mt-3 bg-shGreen/10 border border-shGreen/30 rounded p-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[14px] font-black uppercase tracking-widest text-shGreen"><i className="fas fa-calendar-check mr-1"/>{selected.length} day{selected.length===1?"":"s"} selected</p>
            <button onClick={clear} className="text-[13px] uppercase tracking-widest text-red-400 font-black hover:underline">Clear all</button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {selected.map(d => (
              <span key={d} className="bg-bgPanel text-shGreen text-[13px] font-black uppercase tracking-widest px-2 py-1 rounded flex items-center gap-1.5">
                {d}
                <button onClick={()=>onToggle(d)} className="hover:text-red-400"><i className="fas fa-times text-[9px]"/></button>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
