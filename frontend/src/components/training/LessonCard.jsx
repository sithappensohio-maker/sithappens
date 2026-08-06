// Training UI Phase 4 — one lesson within a module, shown as a compact
// visual card (never the full lesson text — that's LessonDetailPanel).
const STATUS_META = {
  completed: { icon: "fa-circle-check", color: "text-shPrimary", badge: "bg-shPrimary/15 text-shPrimary", label: "Completed" },
  current:   { icon: "fa-circle-play", color: "text-shSecondary", badge: "bg-shSecondary/15 text-shSecondary", label: "In Progress" },
  available: { icon: "fa-circle", color: "text-shTextMuted", badge: "bg-shBorder/20 text-shTextMuted", label: "Available" },
  locked:    { icon: "fa-lock", color: "text-shTextMuted", badge: "bg-shBorder/10 text-shTextMuted", label: "Locked" },
};

export default function LessonCard({
  name, overview, estimatedMinutes, status = "available", hasVideo,
  lockedReason, actionLabel, onAction, testid,
}) {
  const meta = STATUS_META[status] || STATUS_META.available;
  const locked = status === "locked";
  return (
    <div className={`bg-black/20 border border-shBorder rounded-lg p-3 ${locked ? "opacity-70" : ""}`} data-testid={testid}>
      <div className="flex items-start gap-3">
        <div className={`shrink-0 w-9 h-9 rounded-lg grid place-items-center border ${locked ? "border-shBorder bg-shBorder/10" : "border-shSecondary/30 bg-shSecondary/10"}`}>
          <i className={`fas ${hasVideo && !locked ? "fa-circle-play" : meta.icon} ${locked ? "text-shTextMuted" : "text-shSecondary"} text-[15px]`}/>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[13px] font-black text-shText truncate">{name}</p>
            <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full ${meta.badge}`}>{meta.label}</span>
            {hasVideo && !locked && <i className="fas fa-video text-shSecondary text-[11px]" title="Includes video"/>}
          </div>
          {overview && !locked && <p className="text-[12px] text-shTextMuted mt-0.5">{overview}</p>}
          {estimatedMinutes && !locked && <p className="text-[11px] text-shTextMuted mt-0.5"><i className="fas fa-clock mr-1"/>{estimatedMinutes} min</p>}
          {locked && lockedReason && (
            <p className="text-[12px] text-shTextMuted mt-0.5"><i className="fas fa-lock mr-1"/>{lockedReason}</p>
          )}
        </div>
      </div>
      {actionLabel && !locked && (
        <button onClick={onAction} data-testid={testid ? `${testid}-action` : undefined}
                className="mt-2.5 w-full bg-shSecondary/15 text-shSecondary border border-shSecondary/40 py-1.5 rounded-lg font-black text-[11px] uppercase tracking-widest hover:bg-shSecondary/25 transition">
          {actionLabel}
        </button>
      )}
    </div>
  );
}
