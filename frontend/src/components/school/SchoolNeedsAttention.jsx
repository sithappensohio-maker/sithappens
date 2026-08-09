import { eventMeta, actionLabel, priorityMeta, timeAgo, contextLine } from "../../lib/schoolHq";
import { accentRgb } from "../premium/tokens";
import EmptyState from "../premium/EmptyState";

/* The consolidated "who needs a human" queue — one operational view over the
 * School notification spine. Scannable rows (never giant cards), each with a
 * real action that opens the exact record + read/resolve controls. */
export default function SchoolNeedsAttention({
  items = [], loading = false, busyId = null,
  onOpen, onRead, onResolve, emptyHint = "Nothing needs you right now.",
}) {
  if (loading && items.length === 0) {
    return <p className="text-[13px] uppercase tracking-widest font-black text-shTextMuted p-2">Loading…</p>;
  }
  if (items.length === 0) {
    return <EmptyState icon="fa-mug-hot" title="All caught up" description={emptyHint} accent="lime" />;
  }
  return (
    <div className="space-y-2" data-testid="school-needs-attention">
      {items.map((n) => {
        const meta = eventMeta(n.notification_type || n.event_type);
        const pm = priorityMeta(n.priority);
        const rgb = accentRgb(meta.accent);
        const ctx = contextLine(n);
        const busy = busyId === n.id;
        return (
          <div key={n.id}
               className="rounded-xl border border-shBorder bg-[var(--sh-card-base)] p-3 flex items-start gap-3"
               data-testid={`na-item-${n.id}`}>
            <span className="shrink-0 w-9 h-9 rounded-lg grid place-items-center"
                  style={{ background: `rgba(${rgb},0.14)`, color: `rgb(${rgb})` }}>
              <i className={`fas ${meta.icon} text-[15px]`} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <p className="text-shText text-[14px] font-bold leading-snug min-w-0">{n.title}</p>
                <span className={`shrink-0 text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded border ${pm.cls}`}>{pm.label}</span>
              </div>
              {n.body && <p className="text-shTextMuted text-[12.5px] mt-0.5 line-clamp-2">{n.body}</p>}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-[11px] uppercase tracking-widest text-shTextMuted">
                {ctx && <span className="truncate max-w-full">{ctx}</span>}
                <span><i className="fas fa-clock mr-1" />{timeAgo(n.created_at)}</span>
                {!n.read_at && <span className="text-shAccent font-black">• New</span>}
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <button type="button" onClick={() => onOpen?.(n)} disabled={busy}
                        className="text-[12px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg border border-shPrimary/40 bg-shPrimary/10 text-shPrimary hover:bg-shPrimary/20 transition disabled:opacity-50"
                        data-testid={`na-open-${n.id}`}>
                  <i className="fas fa-arrow-right mr-1" />{actionLabel(n.notification_type || n.event_type)}
                </button>
                {!n.read_at && (
                  <button type="button" onClick={() => onRead?.(n)} disabled={busy}
                          className="text-[12px] font-bold uppercase tracking-widest px-2.5 py-1.5 rounded-lg border border-shBorder text-shTextMuted hover:text-shText transition disabled:opacity-50"
                          data-testid={`na-read-${n.id}`}>
                    Mark read
                  </button>
                )}
                <button type="button" onClick={() => onResolve?.(n)} disabled={busy}
                        className="text-[12px] font-bold uppercase tracking-widest px-2.5 py-1.5 rounded-lg border border-shBorder text-shTextMuted hover:text-shPrimary transition disabled:opacity-50"
                        data-testid={`na-resolve-${n.id}`}>
                  <i className="fas fa-check mr-1" />Resolve
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
