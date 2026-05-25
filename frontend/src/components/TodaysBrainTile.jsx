import { useEffect, useState } from "react";
import { api } from "../lib/api";

const PRIORITY_META = {
  urgent: { color: "border-red-500/40 bg-red-500/5",   chip: "bg-red-500/15 text-red-300",   accent: "text-red-300",   icon: "fa-circle-exclamation" },
  warn:   { color: "border-shOrange/40 bg-shOrange/5", chip: "bg-shOrange/15 text-shOrange", accent: "text-shOrange",  icon: "fa-triangle-exclamation" },
  info:   { color: "border-shGreen/40 bg-shGreen/5",   chip: "bg-shGreen/15 text-shGreen",   accent: "text-shGreen",   icon: "fa-lightbulb" },
};

/**
 * "Today's brain" — single prioritized tile on the admin dashboard that
 * collapses every "needs your attention" signal from the rest of the app
 * (homework reviews, vaccine flags, no-checkin, low credits, pending
 * bookings, unanswered questions, pipeline-ready, new signups, Monday
 * digest) into one panel. Items auto-resolve when fixed.
 *
 * Compact tile (top 3 items) + "See all" → full-screen modal.
 *
 * Props:
 *   onCTA(item)  — callback when user clicks an item. The parent decides
 *                  what to do based on item.cta.type:
 *                    open_dog / open_client → jump-to handler
 *                    open_screen → navigate sidebar
 *                    send_monday_digest → fire the digest API
 */
export default function TodaysBrainTile({ onCTA }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [showAll, setShowAll] = useState(false);

  const load = async () => {
    try { const r = await api.get("/admin/today-brain"); setData(r.data); setErr(""); }
    catch (e) { setErr(e.response?.data?.detail || "Failed to load"); }
  };
  useEffect(() => { load(); }, []);

  if (err) return null; // silent — don't break dashboard if the endpoint hiccups
  if (!data) return (
    <div className="rounded-xl border border-bgHover bg-bgPanel p-4 mb-4" data-testid="todays-brain-loading">
      <p className="text-[13px] text-gray-500 font-black uppercase tracking-widest"><i className="fas fa-brain mr-2"/>Today's brain · loading…</p>
    </div>
  );

  const { items, counts } = data;
  const top3 = items.slice(0, 3);
  const hasMore = items.length > 3;

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-shGreen/30 bg-shGreen/5 p-4 mb-4" data-testid="todays-brain-empty">
        <p className="text-[14px] font-black uppercase tracking-widest text-shGreen">
          <i className="fas fa-brain mr-2"/>Today's brain · all clear
        </p>
        <p className="text-[13px] text-gray-400 mt-1">Nothing urgent on the queue. Inbox zero, basically.</p>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-xl border border-bgHover bg-bgPanel p-4 mb-4 shadow-lg" data-testid="todays-brain-tile">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
          <p className="text-[14px] font-black uppercase tracking-widest text-white">
            <i className="fas fa-brain mr-2 text-shBlue"/>Today's brain
          </p>
          <div className="flex items-center gap-2 text-[12px] font-black uppercase tracking-widest">
            {counts.urgent > 0 && <span className="bg-red-500/15 text-red-300 px-2 py-0.5 rounded" data-testid="brain-count-urgent">{counts.urgent} urgent</span>}
            {counts.warn > 0   && <span className="bg-shOrange/15 text-shOrange px-2 py-0.5 rounded" data-testid="brain-count-warn">{counts.warn} warn</span>}
            {counts.info > 0   && <span className="bg-shGreen/15 text-shGreen px-2 py-0.5 rounded" data-testid="brain-count-info">{counts.info} info</span>}
          </div>
        </div>
        <div className="space-y-2">
          {top3.map(it => <BrainRow key={it.id} item={it} onClick={() => onCTA?.(it)} />)}
        </div>
        {hasMore && (
          <button onClick={() => setShowAll(true)} data-testid="brain-see-all"
                  className="mt-3 w-full text-center text-[13px] font-black uppercase tracking-widest text-shBlue hover:text-white py-2 border-t border-bgHover">
            See all {items.length} · <i className="fas fa-arrow-right ml-1"/>
          </button>
        )}
      </div>
      {showAll && (
        <TodaysBrainModal items={items} counts={counts} onClose={() => { setShowAll(false); load(); }}
                          onCTA={(it) => { setShowAll(false); onCTA?.(it); }} />
      )}
    </>
  );
}


function BrainRow({ item, onClick }) {
  const pm = PRIORITY_META[item.priority] || PRIORITY_META.info;
  return (
    <button
      onClick={onClick}
      data-testid={`brain-row-${item.id}`}
      className={`w-full text-left flex items-start gap-3 p-3 rounded-lg border ${pm.color} hover:ring-1 hover:ring-shBlue/40 transition`}
    >
      <span className={`shrink-0 w-9 h-9 rounded-full grid place-items-center ${pm.chip}`}>
        <i className={`fas ${item.icon || pm.icon}`}/>
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-black text-white truncate">{item.title}</p>
        {item.subtitle && <p className="text-[13px] text-gray-400 truncate">{item.subtitle}</p>}
      </div>
      <i className={`fas fa-chevron-right ${pm.accent} text-xs mt-2.5`}/>
    </button>
  );
}


function TodaysBrainModal({ items, counts, onClose, onCTA }) {
  const [filter, setFilter] = useState("all"); // all | urgent | warn | info
  const filtered = filter === "all" ? items : items.filter(it => it.priority === filter);

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-3" onClick={onClose} data-testid="todays-brain-modal">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-bgHover">
          <h4 className="text-lg font-black uppercase italic tracking-tight text-white">
            <i className="fas fa-brain text-shBlue mr-2"/>Today's brain · {items.length}
          </h4>
          <button onClick={onClose} className="text-gray-500 hover:text-white" data-testid="brain-modal-close"><i className="fas fa-times"/></button>
        </div>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-bgHover flex-wrap">
          {[
            { id: "all",    label: `All · ${counts.total}`,   color: "text-white" },
            { id: "urgent", label: `Urgent · ${counts.urgent}`, color: "text-red-300" },
            { id: "warn",   label: `Warn · ${counts.warn}`,     color: "text-shOrange" },
            { id: "info",   label: `Info · ${counts.info}`,     color: "text-shGreen" },
          ].map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)} data-testid={`brain-filter-${f.id}`}
                    className={`text-[12px] font-black uppercase tracking-widest px-3 py-1.5 rounded transition ${filter === f.id ? "bg-bgHover " + f.color : "bg-bgBase text-gray-500 hover:text-white"}`}>
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {filtered.length === 0 ? (
            <p className="text-[14px] text-gray-500 italic text-center py-8">Nothing in this group.</p>
          ) : filtered.map(it => <BrainRow key={it.id} item={it} onClick={() => onCTA?.(it)} />)}
        </div>
      </div>
    </div>
  );
}
