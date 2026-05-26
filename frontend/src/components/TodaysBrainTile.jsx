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
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try { const r = await api.get("/admin/today-brain"); setData(r.data); setErr(""); }
    catch (e) { setErr(e.response?.data?.detail || "Failed to load"); }
  };
  useEffect(() => { load(); }, []);

  const dismissOne = async (item) => {
    setBusy(true);
    try {
      await api.post("/admin/today-brain/dismiss", { item_id: item.id, signature: item.signature || "" });
      await load();
    } catch (e) { setErr(e.response?.data?.detail || "Dismiss failed"); }
    finally { setBusy(false); }
  };

  const clearAll = async () => {
    if (!window.confirm("Hide every task currently on the list? They'll reappear automatically if the underlying state changes (e.g. a credit pool drops further, a new booking request comes in).")) return;
    setBusy(true);
    try {
      await api.post("/admin/today-brain/clear-all");
      await load();
    } catch (e) { setErr(e.response?.data?.detail || "Clear-all failed"); }
    finally { setBusy(false); }
  };

  if (err) return null; // silent — don't break dashboard if the endpoint hiccups
  if (!data) return (
    <div className="rounded-xl border border-bgHover bg-bgPanel p-4 mb-4" data-testid="todays-brain-loading">
      <p className="text-[13px] text-gray-500 font-black uppercase tracking-widest"><i className="fas fa-list-check mr-2"/>Today's tasks · loading…</p>
    </div>
  );

  const { items, counts } = data;
  const top3 = items.slice(0, 3);
  const hasMore = items.length > 3;

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-shGreen/30 bg-shGreen/5 p-4 mb-4" data-testid="todays-brain-empty">
        <p className="text-[14px] font-black uppercase tracking-widest text-shGreen">
          <i className="fas fa-list-check mr-2"/>Today's tasks · all clear
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
            <i className="fas fa-list-check mr-2 text-shBlue"/>Today's tasks
          </p>
          <div className="flex items-center gap-2 text-[12px] font-black uppercase tracking-widest">
            {counts.urgent > 0 && <span className="bg-red-500/15 text-red-300 px-2 py-0.5 rounded" data-testid="brain-count-urgent">{counts.urgent} urgent</span>}
            {counts.warn > 0   && <span className="bg-shOrange/15 text-shOrange px-2 py-0.5 rounded" data-testid="brain-count-warn">{counts.warn} warn</span>}
            {counts.info > 0   && <span className="bg-shGreen/15 text-shGreen px-2 py-0.5 rounded" data-testid="brain-count-info">{counts.info} info</span>}
            <button onClick={clearAll} disabled={busy} data-testid="brain-clear-all"
                    className="text-gray-500 hover:text-red-300 disabled:opacity-40 border border-bgHover hover:border-red-400/40 rounded px-2 py-0.5 transition"
                    title="Hide every task on the list (they'll reappear if the state changes)">
              <i className={`fas ${busy ? "fa-spinner fa-spin" : "fa-broom"} mr-1`}/>Clear all
            </button>
          </div>
        </div>
        <div className="space-y-2">
          {top3.map(it => <BrainRow key={it.id} item={it} onClick={() => onCTA?.(it)} onDismiss={() => dismissOne(it)} dismissBusy={busy} />)}
        </div>
        {hasMore && (
          <button onClick={() => setShowAll(true)} data-testid="brain-see-all"
                  className="mt-3 w-full text-center text-[13px] font-black uppercase tracking-widest text-shBlue hover:text-white py-2 border-t border-bgHover">
            See all {items.length} · <i className="fas fa-arrow-right ml-1"/>
          </button>
        )}
      </div>
      {showAll && (
        <TodaysBrainModal items={items} counts={counts}
                          onClose={() => { setShowAll(false); load(); }}
                          onCTA={(it) => { setShowAll(false); onCTA?.(it); }}
                          onDismiss={dismissOne}
                          onClearAll={clearAll}
                          busy={busy} />
      )}
    </>
  );
}


function BrainRow({ item, onClick, onDismiss, dismissBusy }) {
  const pm = PRIORITY_META[item.priority] || PRIORITY_META.info;
  return (
    <div
      data-testid={`brain-row-${item.id}`}
      className={`relative w-full flex items-start gap-3 p-3 pr-10 rounded-lg border ${pm.color} hover:ring-1 hover:ring-shBlue/40 transition`}
    >
      <button onClick={onClick} className="flex items-start gap-3 flex-1 text-left min-w-0" data-testid={`brain-row-cta-${item.id}`}>
        <span className={`shrink-0 w-9 h-9 rounded-full grid place-items-center ${pm.chip}`}>
          <i className={`fas ${item.icon || pm.icon}`}/>
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-black text-white truncate">{item.title}</p>
          {item.subtitle && <p className="text-[13px] text-gray-400 truncate">{item.subtitle}</p>}
        </div>
        <i className={`fas fa-chevron-right ${pm.accent} text-xs mt-2.5`}/>
      </button>
      {onDismiss && (
        <button onClick={(e) => { e.stopPropagation(); onDismiss(); }}
                disabled={dismissBusy}
                data-testid={`brain-dismiss-${item.id}`}
                title="Hide this task (it'll reappear if the underlying state changes)"
                className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full grid place-items-center text-gray-500 hover:text-red-300 hover:bg-red-500/10 disabled:opacity-40 transition">
          <i className="fas fa-times text-xs"/>
        </button>
      )}
    </div>
  );
}


function TodaysBrainModal({ items, counts, onClose, onCTA, onDismiss, onClearAll, busy }) {
  const [filter, setFilter] = useState("all"); // all | urgent | warn | info
  const filtered = filter === "all" ? items : items.filter(it => it.priority === filter);

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-3" onClick={onClose} data-testid="todays-brain-modal">
      <div className="bg-bgPanel border border-bgHover rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-bgHover gap-2 flex-wrap">
          <h4 className="text-lg font-black uppercase italic tracking-tight text-white">
            <i className="fas fa-list-check text-shBlue mr-2"/>Today's tasks · {items.length}
          </h4>
          <div className="flex items-center gap-2">
            {onClearAll && items.length > 0 && (
              <button onClick={onClearAll} disabled={busy} data-testid="brain-modal-clear-all"
                      className="text-[12px] font-black uppercase tracking-widest text-gray-400 hover:text-red-300 disabled:opacity-40 border border-bgHover hover:border-red-400/40 rounded px-2.5 py-1.5 transition">
                <i className={`fas ${busy ? "fa-spinner fa-spin" : "fa-broom"} mr-1`}/>Clear all
              </button>
            )}
            <button onClick={onClose} className="text-gray-500 hover:text-white" data-testid="brain-modal-close"><i className="fas fa-times"/></button>
          </div>
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
          ) : filtered.map(it => <BrainRow key={it.id} item={it} onClick={() => onCTA?.(it)} onDismiss={() => onDismiss?.(it)} dismissBusy={busy} />)}
        </div>
      </div>
    </div>
  );
}
