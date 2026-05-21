// Collapsible grouped list — Year → Month → Week → Day, each level showing
// the rolled-up total. Used by both the Expenses and Bookings screens to
// tame long historical lists.
//
// Default: most-recent group expanded (so you see today/this-week immediately),
//          everything older collapsed (so the screen stays short).
//
// Props:
//   rows:       array of items (must each have `date` ISO string + a value)
//   getDate:    (row) => "YYYY-MM-DD"
//   getAmount:  (row) => number (for the totals; pass () => 1 for count-only)
//   fmtAmount:  (num) => string  (e.g. fmt currency)
//   renderRow:  (row) => JSX for one expanded row
//   emptyText:  shown when rows is empty

import { useMemo, useState } from "react";

export default function CollapsibleDateGroups({
  rows,
  getDate,
  getAmount = () => 0,
  fmtAmount = (n) => String(n),
  renderRow,
  emptyText = "No items.",
  testid = "collapsible-groups",
}) {
  const tree = useMemo(() => buildTree(rows || [], getDate, getAmount), [rows]); // eslint-disable-line

  const [openKeys, setOpenKeys] = useState(() => {
    const ks = new Set();
    if (tree[0]) {
      ks.add(tree[0].key);
      const m = tree[0].months[0]; if (m) {
        ks.add(m.key);
        const w = m.weeks[0]; if (w) {
          ks.add(w.key);
          const d = w.days[0]; if (d) ks.add(d.key);
        }
      }
    }
    return ks;
  });
  const toggle = (k) => setOpenKeys(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const isOpen = (k) => openKeys.has(k);

  if (!rows || rows.length === 0) {
    return <div className="text-center py-6 text-gray-500 text-[15px]" data-testid={`${testid}-empty`}>{emptyText}</div>;
  }

  return (
    <div className="space-y-2" data-testid={testid}>
      {tree.map(year => (
        <div key={year.key} data-testid={`group-year-${year.key}`}>
          <GroupHeader g={year} level="year" open={isOpen(year.key)} onToggle={() => toggle(year.key)} fmtAmount={fmtAmount} />
          {isOpen(year.key) && (
            <div className="mt-1 space-y-1">
              {year.months.map(month => (
                <div key={month.key} data-testid={`group-month-${month.key}`}>
                  <GroupHeader g={month} level="month" open={isOpen(month.key)} onToggle={() => toggle(month.key)} fmtAmount={fmtAmount} />
                  {isOpen(month.key) && (
                    <div className="mt-1 space-y-1">
                      {month.weeks.map(week => (
                        <div key={week.key} data-testid={`group-week-${week.key}`}>
                          <GroupHeader g={week} level="week" open={isOpen(week.key)} onToggle={() => toggle(week.key)} fmtAmount={fmtAmount} />
                          {isOpen(week.key) && (
                            <div className="mt-1 space-y-1">
                              {week.days.map(day => (
                                <div key={day.key} data-testid={`group-day-${day.key}`}>
                                  <GroupHeader g={day} level="day" open={isOpen(day.key)} onToggle={() => toggle(day.key)} fmtAmount={fmtAmount} />
                                  {isOpen(day.key) && (
                                    <div className="pl-12 space-y-1 mt-1">
                                      {day.items.map(r => renderRow(r))}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function GroupHeader({ g, level, open, onToggle, fmtAmount }) {
  const indent = { year: "", month: "pl-3", week: "pl-6", day: "pl-9" }[level];
  const labelColor = {
    year: "text-shGreen",
    month: "text-shBlue",
    week: "text-gray-300",
    day: "text-gray-400",
  }[level];
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`w-full ${indent} flex items-center justify-between bg-bgBase/40 hover:bg-bgBase/70 rounded px-3 py-2 transition`}
    >
      <span className="flex items-center gap-2">
        <i className={`fas fa-chevron-${open ? "down" : "right"} text-[11px] text-gray-500 w-3`}/>
        <span className={`text-[14px] font-black uppercase tracking-widest ${labelColor}`}>{g.label}</span>
        <span className="text-[12px] text-gray-500 font-black tracking-widest">· {g.count} item{g.count === 1 ? "" : "s"}</span>
      </span>
      <span className="text-[14px] font-black text-white tracking-widest">{fmtAmount(g.total)}</span>
    </button>
  );
}

// ── Tree builder ────────────────────────────────────────────────────────
function buildTree(rows, getDate, getAmount) {
  const sorted = [...rows].filter(r => getDate(r)).sort((a, b) => getDate(b).localeCompare(getDate(a)));
  const years = new Map();

  for (const r of sorted) {
    const iso = getDate(r);
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    const weekKey = isoWeekKey(dt);
    const monthLabel = dt.toLocaleString(undefined, { month: "long", year: "numeric" });
    const dayLabel = dt.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric" });
    const weekLabel = `Week of ${weekStart(dt).toLocaleString(undefined, { month: "short", day: "numeric" })}`;
    const amount = Number(getAmount(r)) || 0;

    if (!years.has(y)) years.set(y, { key: `y-${y}`, label: String(y), count: 0, total: 0, months: new Map() });
    const yo = years.get(y);
    yo.count++; yo.total += amount;

    const mk = `m-${y}-${m}`;
    if (!yo.months.has(mk)) yo.months.set(mk, { key: mk, label: monthLabel, count: 0, total: 0, weeks: new Map() });
    const mo = yo.months.get(mk);
    mo.count++; mo.total += amount;

    if (!mo.weeks.has(weekKey)) mo.weeks.set(weekKey, { key: weekKey, label: weekLabel, count: 0, total: 0, days: new Map() });
    const wo = mo.weeks.get(weekKey);
    wo.count++; wo.total += amount;

    if (!wo.days.has(iso)) wo.days.set(iso, { key: `d-${iso}`, label: dayLabel, count: 0, total: 0, items: [] });
    const dobj = wo.days.get(iso);
    dobj.count++; dobj.total += amount; dobj.items.push(r);
  }

  return Array.from(years.values()).map(yo => ({
    ...yo,
    months: Array.from(yo.months.values()).map(mo => ({
      ...mo,
      weeks: Array.from(mo.weeks.values()).map(wo => ({
        ...wo,
        days: Array.from(wo.days.values()),
      })),
    })),
  }));
}

function weekStart(d) {
  const dt = new Date(d);
  const day = dt.getDay() || 7;
  if (day !== 1) dt.setDate(dt.getDate() - (day - 1));
  return dt;
}

function isoWeekKey(d) {
  const ws = weekStart(d);
  return `w-${ws.getFullYear()}-${ws.getMonth()+1}-${ws.getDate()}`;
}
