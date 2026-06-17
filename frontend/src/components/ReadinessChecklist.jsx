import { useEffect, useState } from "react";
import { api } from "../lib/api";

export default function ReadinessChecklist({ onNavigate = () => {} }) {
  const [data, setData] = useState(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: r } = await api.get("/admin/readiness");
        if (alive) setData(r);
      } catch {
        if (alive) setData({ checks: [], completed: 0, total: 0 });
      }
    })();
    return () => { alive = false; };
  }, []);

  if (!data) return null;
  const { checks = [], completed = 0, total = 0 } = data;
  if (total === 0) return null;
  const pct = total ? Math.round((completed / total) * 100) : 0;
  const allDone = completed === total;

  return (
    <div className="bg-bgPanel rounded-xl border border-bgHover overflow-hidden" data-testid="readiness-checklist">
      <button
        type="button"
        onClick={() => setCollapsed(c => !c)}
        className="w-full px-5 py-4 flex items-center justify-between gap-3 hover:bg-bgBase/30 transition text-left"
        data-testid="readiness-toggle"
      >
        <div className="flex items-center gap-3 min-w-0">
          <i className={`fas ${allDone ? "fa-circle-check text-shGreen" : "fa-list-check text-shOrange"} text-lg`}/>
          <div className="min-w-0">
            <p className="text-xs font-black text-white uppercase tracking-widest">
              Operational Readiness · <span className={allDone ? "text-shGreen" : "text-shOrange"}>{completed}/{total}</span>
            </p>
            <p className="text-[12px] text-gray-400 mt-0.5">
              {allDone ? "You're set — every core piece is configured." : "Finish setting up the essentials so the app runs hands-free."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="hidden sm:block w-32 h-2 rounded-full bg-bgBase overflow-hidden">
            <div className={`h-full ${allDone ? "bg-shGreen" : "bg-shOrange"}`} style={{ width: `${pct}%` }}/>
          </div>
          <span className="text-[14px] font-black text-gray-500 uppercase tracking-widest">{pct}%</span>
          <i className={`fas fa-chevron-${collapsed ? "down" : "up"} text-gray-500`}/>
        </div>
      </button>

      {!collapsed && (
        <div className="border-t border-bgHover divide-y divide-bgHover/40">
          {checks.map(c => (
            <div
              key={c.id}
              className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-bgBase/30 transition"
              data-testid={`readiness-row-${c.id}`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <i className={`fas ${c.done ? "fa-circle-check text-shGreen" : "fa-circle text-gray-600"} text-base`}/>
                <div className="min-w-0">
                  <p className={`text-[14px] font-black uppercase tracking-tight ${c.done ? "text-gray-400 line-through" : "text-white"}`}>
                    {c.label}
                  </p>
                  {!c.done && c.fix && (
                    <p className="text-[12px] text-gray-500 mt-0.5">{c.fix}</p>
                  )}
                </div>
              </div>
              {!c.done && c.goto && (
                <button
                  onClick={() => onNavigate(c.goto)}
                  data-testid={`readiness-fix-${c.id}`}
                  className="text-[12px] font-black uppercase tracking-widest px-3 py-1.5 rounded bg-shBlue/15 text-shBlue hover:bg-shBlue/25 transition shrink-0"
                >
                  Fix <i className="fas fa-arrow-right ml-1"/>
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
