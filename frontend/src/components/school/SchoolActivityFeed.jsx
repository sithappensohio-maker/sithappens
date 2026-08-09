import { eventMeta, actionLabel, timeAgo, contextLine } from "../../lib/schoolHq";
import { accentRgb } from "../premium/tokens";
import EmptyState from "../premium/EmptyState";

/* Chronological, scannable timeline of everything happening in the school.
 * Attention-worthy rows carry a real action; routine rows are just history.
 * Deliberately compact — one line of substance per event, not a card wall. */
export default function SchoolActivityFeed({ items = [], loading = false, onOpen, onLoadMore, hasMore = false }) {
  if (loading && items.length === 0) {
    return <p className="text-[13px] uppercase tracking-widest font-black text-shTextMuted p-2">Loading…</p>;
  }
  if (items.length === 0) {
    return <EmptyState icon="fa-stream" title="No activity yet" description="Student activity will appear here as it happens." accent="cyan" />;
  }
  return (
    <div data-testid="school-activity-feed">
      <ul className="space-y-1.5">
        {items.map((e) => {
          const meta = eventMeta(e.event_type);
          const rgb = accentRgb(meta.accent);
          const ctx = contextLine(e);
          return (
            <li key={e.id}
                className="rounded-lg border border-shBorder/70 bg-[var(--sh-card-base)]/60 px-3 py-2 flex items-start gap-3"
                data-testid={`activity-${e.id}`}>
              <span className="shrink-0 w-7 h-7 rounded-md grid place-items-center mt-0.5"
                    style={{ background: `rgba(${rgb},0.14)`, color: `rgb(${rgb})` }}>
                <i className={`fas ${meta.icon} text-[12px]`} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-shText text-[13.5px] leading-snug">
                  <span className="font-bold">{e.title || meta.label}</span>
                  {e.summary && <span className="text-shTextMuted"> — {e.summary}</span>}
                </p>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-[11px] uppercase tracking-widest text-shTextMuted">
                  {ctx && <span className="truncate max-w-full">{ctx}</span>}
                  <span><i className="fas fa-clock mr-1" />{timeAgo(e.created_at)}</span>
                </div>
              </div>
              {e.requires_attention && (
                <button type="button" onClick={() => onOpen?.(e)}
                        className="shrink-0 self-center text-[11px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg border border-shPrimary/40 bg-shPrimary/10 text-shPrimary hover:bg-shPrimary/20 transition"
                        data-testid={`activity-open-${e.id}`}>
                  {actionLabel(e.event_type)}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {hasMore && (
        <div className="text-center mt-3">
          <button type="button" onClick={onLoadMore}
                  className="text-[12px] font-black uppercase tracking-widest px-4 py-2 rounded-lg border border-shBorder text-shTextMuted hover:text-shText transition"
                  data-testid="activity-load-more">
            Load more
          </button>
        </div>
      )}
    </div>
  );
}
