// Training UI Phase 4 — one lesson within a module, shown as a compact
// visual card (never the full lesson text — that's LessonDetailPanel).
const STATUS_META = {
  completed: { icon: "fa-check", color: "text-shPrimary", badge: "bg-shPrimary/12 text-shPrimary border-shPrimary/25", label: "Completed" },
  current:   { icon: "fa-play", color: "text-shSecondary", badge: "bg-shSecondary/12 text-shSecondary border-shSecondary/25", label: "In Progress" },
  available: { icon: "fa-book-open", color: "text-shTextMuted", badge: "bg-white/[0.04] text-shTextMuted border-shBorder/70", label: "Available" },
  locked:    { icon: "fa-lock", color: "text-shTextMuted", badge: "bg-white/[0.025] text-shTextMuted border-shBorder/50", label: "Locked" },
};

export default function LessonCard({
  name, overview, estimatedMinutes, status = "available", hasVideo,
  lockedReason, actionLabel, onAction, testid,
}) {
  const meta = STATUS_META[status] || STATUS_META.available;
  const locked = status === "locked";
  const current = status === "current";
  return (
    <div
      className={`group relative overflow-hidden rounded-xl border transition ${
        current
          ? "border-shSecondary/50 bg-shSecondary/[0.07] shadow-[0_0_22px_rgba(0,169,224,0.10)]"
          : locked
            ? "border-shBorder/45 bg-black/15 opacity-60"
            : "border-shBorder/65 bg-black/20 hover:border-shBorder hover:bg-white/[0.025]"
      }`}
      data-testid={testid}
    >
      {current && <span className="absolute inset-y-0 left-0 w-1 bg-shSecondary"/>}
      <div className="flex items-start gap-3 p-3.5 sm:p-4">
        <div className={`shrink-0 w-10 h-10 rounded-xl grid place-items-center border ${
          current ? "border-shSecondary/35 bg-shSecondary/12" : locked ? "border-shBorder/50 bg-white/[0.025]" : "border-shBorder/60 bg-white/[0.03]"
        }`}>
          <i className={`fas ${hasVideo && !locked ? "fa-circle-play" : meta.icon} ${current ? "text-shSecondary" : meta.color} text-[14px]`}/>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[14px] font-black text-shText leading-tight truncate">{name}</p>
              {overview && !locked && <p className="text-[12px] text-shTextMuted mt-1 leading-relaxed line-clamp-2">{overview}</p>}
              {locked && lockedReason && (
                <p className="text-[12px] text-shTextMuted mt-1 leading-relaxed"><i className="fas fa-lock mr-1.5 text-[10px]"/>{lockedReason}</p>
              )}
            </div>
            <span className={`shrink-0 text-[9px] font-black uppercase tracking-[0.12em] px-2 py-1 rounded-md border ${meta.badge}`}>{meta.label}</span>
          </div>
          <div className="flex items-center gap-3 mt-2 text-[11px] text-shTextMuted">
            {estimatedMinutes && !locked && <span><i className="far fa-clock mr-1"/>{estimatedMinutes} min</span>}
            {hasVideo && !locked && <span><i className="fas fa-video mr-1"/>Video</span>}
          </div>
        </div>
      </div>
      {actionLabel && !locked && (
        <button
          onClick={onAction}
          data-testid={testid ? `${testid}-action` : undefined}
          className={`w-full border-t px-4 py-2.5 text-[12px] font-black transition flex items-center justify-between ${
            current
              ? "border-shSecondary/20 text-shSecondary hover:bg-shSecondary/10"
              : "border-shBorder/50 text-shText hover:bg-white/[0.035]"
          }`}
        >
          <span>{actionLabel}</span><i className="fas fa-arrow-right text-[10px]"/>
        </button>
      )}
    </div>
  );
}
