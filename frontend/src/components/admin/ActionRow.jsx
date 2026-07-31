/* Shared "Do This Now" / Action Center row — extracted verbatim from
 * ActionCenter.jsx so Today.jsx can reuse the exact same card instead of a
 * second copy. Renders one /admin/today-brain item: icon + priority label +
 * kind + title + subtitle + Open/Hide actions. No behavior change from the
 * original inline component.
 */
export const ACTION_PRIORITY_META = {
  urgent: { label: "Urgent", border: "border-red-500/40", bg: "bg-red-500/10", text: "text-red-300", icon: "fa-triangle-exclamation" },
  warn:   { label: "Needs Attention", border: "border-shAccent/40", bg: "bg-shAccent/10", text: "text-shAccent", icon: "fa-circle-exclamation" },
  info:   { label: "FYI / Follow-up", border: "border-shPrimary/40", bg: "bg-shPrimary/10", text: "text-shPrimary", icon: "fa-lightbulb" },
};

export default function ActionRow({ item, onOpen, onDismiss, busy }) {
  const meta = ACTION_PRIORITY_META[item.priority] || ACTION_PRIORITY_META.info;
  return (
    <div className={`relative rounded-2xl border ${meta.border} ${meta.bg} p-4 shadow-lg`} data-testid={`action-center-row-${item.id}`}>
      {/* Stack vertically on narrow screens so the action buttons render in
          their own row below the title instead of squeezing into the same
          line as it (min-w-0 + flex-wrap never actually wraps here since the
          title has no minimum width to force it — it just compresses and
          visually collides with the buttons). Side-by-side from sm: up. */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <button onClick={onOpen} className="flex items-start gap-3 text-left min-w-0 sm:flex-1" data-testid={`action-center-open-${item.id}`}>
          <span className={`w-11 h-11 rounded-xl grid place-items-center bg-[var(--sh-card-base)] border border-shBorder shrink-0 ${meta.text}`}><i className={`fas ${item.icon || meta.icon}`}/></span>
          <span className="min-w-0">
            <span className="block text-[11px] font-black uppercase tracking-widest text-shTextMuted mb-1">{meta.label} · {item.kind || "task"}</span>
            <span className="block text-[16px] font-black text-shText uppercase italic tracking-tight">{item.title}</span>
            {item.subtitle && <span className="block text-[13px] text-shTextMuted mt-1">{item.subtitle}</span>}
          </span>
        </button>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={onOpen} className="bg-shSecondary/15 border border-shSecondary/30 text-shSecondary hover:bg-shSecondary/25 rounded-lg px-3 py-2 text-[11px] font-black uppercase tracking-widest transition"><i className="fas fa-arrow-right mr-1"/>Open</button>
          {onDismiss && (
            <button onClick={onDismiss} disabled={busy} className="bg-[var(--sh-card-base)] border border-shBorder text-shTextMuted hover:text-red-300 hover:border-red-400/40 rounded-lg px-3 py-2 text-[11px] font-black uppercase tracking-widest transition disabled:opacity-50"><i className="fas fa-times mr-1"/>Hide</button>
          )}
        </div>
      </div>
    </div>
  );
}
