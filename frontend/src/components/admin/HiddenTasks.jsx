/* "Hidden" to-dos for Today, the Action Center and the Dashboard tile.
 * A dismissed item leaves the live list, so the feed returns it under
 * `hidden` (/admin/today-brain). This lists those items and gives each one an
 * Un-hide control that calls the restore endpoint. Hidden items also come back
 * on their own the next business day while they are still open.
 */
import { useState } from "react";
import { api } from "../../lib/api";

export default function HiddenTasks({ items = [], onRestored, testid = "hidden-tasks" }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  if (!items.length) return null;

  const unhide = async (item) => {
    setBusy(true);
    setErr("");
    try {
      await api.post("/admin/today-brain/restore", { item_id: item.id });
      await onRestored?.();
    } catch (e) {
      setErr(e.response?.data?.detail || "Could not un-hide this task");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 pt-3 border-t border-shBorder" data-testid={testid}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
              data-testid={`${testid}-toggle`}
              className="text-[11px] font-black uppercase tracking-widest text-shTextMuted hover:text-shText transition">
        <i className={`fas ${open ? "fa-chevron-up" : "fa-chevron-down"} mr-1`}/>Hidden · {items.length}
      </button>
      {open && (
        <ul className="mt-2 space-y-2">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 min-w-0" data-testid={`${testid}-row-${item.id}`}>
              <span className="min-w-0 text-[13px] text-shTextMuted truncate">{item.title}</span>
              <button type="button" onClick={() => unhide(item)} disabled={busy}
                      data-testid={`hidden-task-unhide-${item.id}`}
                      title="Show this task again now"
                      className="shrink-0 bg-[var(--sh-card-base)] border border-shBorder text-shSecondary hover:border-shSecondary rounded-lg px-3 py-1.5 text-[11px] font-black uppercase tracking-widest transition disabled:opacity-50">
                <i className="fas fa-eye mr-1"/>Un-hide
              </button>
            </li>
          ))}
        </ul>
      )}
      {err && <p role="alert" className="mt-2 text-[12px] text-shAccent">{err}</p>}
    </div>
  );
}
