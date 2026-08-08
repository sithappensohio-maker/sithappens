// Training UI Phase 4 — one module in the roadmap. Status drives color +
// default collapse state: completed modules collapse (tap to expand),
// the current module stays expanded, future/locked modules stay compact.
const STATUS_META = {
  completed:     { icon: "fa-check", color: "text-shPrimary", edge: "bg-shPrimary", badge: "bg-shPrimary/12 text-shPrimary border-shPrimary/25", label: "Completed" },
  current:       { icon: "fa-play", color: "text-shSecondary", edge: "bg-shSecondary", badge: "bg-shSecondary/12 text-shSecondary border-shSecondary/25", label: "Current Module" },
  needs_review:  { icon: "fa-triangle-exclamation", color: "text-shAccent", edge: "bg-shAccent", badge: "bg-shAccent/12 text-shAccent border-shAccent/25", label: "Needs Review" },
  available:     { icon: "fa-circle", color: "text-shTextMuted", edge: "bg-shBorder", badge: "bg-white/[0.04] text-shTextMuted border-shBorder/60", label: "Available" },
  locked:        { icon: "fa-lock", color: "text-shTextMuted", edge: "bg-shBorder", badge: "bg-white/[0.025] text-shTextMuted border-shBorder/45", label: "Locked" },
};

export default function ModuleJourneyCard({
  name, description, lessonCount, skillCount, status = "available",
  currentLessonName, expanded, onToggle, children, testid,
}) {
  const meta = STATUS_META[status] || STATUS_META.available;
  const compact = status === "locked";
  const current = status === "current";
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border transition ${
        current
          ? "border-shSecondary/45 bg-shSecondary/[0.045] shadow-[0_0_28px_rgba(0,169,224,0.09)]"
          : compact
            ? "border-shBorder/40 bg-black/10 opacity-60"
            : "border-shBorder/60 bg-black/15"
      }`}
      data-testid={testid}
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${meta.edge}`}/>
      <button
        onClick={onToggle}
        data-testid={testid ? `${testid}-toggle` : undefined}
        className="w-full flex items-start gap-3 px-4 py-4 sm:px-5 text-left"
      >
        <div className={`w-9 h-9 rounded-xl border grid place-items-center shrink-0 ${
          current ? "bg-shSecondary/12 border-shSecondary/30" : "bg-white/[0.025] border-shBorder/55"
        }`}>
          <i className={`fas ${meta.icon} ${meta.color} text-[13px]`}/>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[15px] font-black text-shText leading-tight">{name}</p>
            <span className={`text-[9px] font-black uppercase tracking-[0.12em] px-2 py-1 rounded-md border ${meta.badge}`}>{meta.label}</span>
          </div>
          {description && !compact && <p className="text-[12px] text-shTextMuted mt-1 leading-relaxed max-w-2xl">{description}</p>}
          <div className="flex items-center gap-4 mt-2 text-[11px] text-shTextMuted font-semibold">
            {lessonCount != null && <span><i className="fas fa-book-open mr-1.5"/>{lessonCount} lesson{lessonCount === 1 ? "" : "s"}</span>}
            {skillCount != null && <span><i className="fas fa-star mr-1.5"/>{skillCount} skill{skillCount === 1 ? "" : "s"}</span>}
          </div>
          {currentLessonName && status === "current" && (
            <p className="text-[12px] text-shSecondary font-bold mt-2"><i className="fas fa-arrow-right mr-1.5"/>{currentLessonName}</p>
          )}
        </div>
        {children && <i className={`fas fa-chevron-${expanded ? "up" : "down"} text-shTextMuted text-[11px] mt-2 shrink-0`}/>} 
      </button>
      {expanded && children && <div className="px-4 sm:px-5 pb-4 sm:pb-5 space-y-2">{children}</div>}
    </div>
  );
}
