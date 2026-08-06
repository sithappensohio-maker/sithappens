// Training UI Phase 4 — one module in the roadmap. Status drives color +
// default collapse state: completed modules collapse (tap to expand),
// the current module stays expanded, future/locked modules stay compact.
const STATUS_META = {
  completed:     { icon: "fa-circle-check", color: "text-shPrimary", border: "border-l-shPrimary", badge: "bg-shPrimary/15 text-shPrimary", label: "Completed" },
  current:       { icon: "fa-circle-play", color: "text-shSecondary", border: "border-l-shSecondary", badge: "bg-shSecondary/15 text-shSecondary", label: "Current Module" },
  needs_review:  { icon: "fa-triangle-exclamation", color: "text-shAccent", border: "border-l-shAccent", badge: "bg-shAccent/15 text-shAccent", label: "Needs Review" },
  available:     { icon: "fa-circle", color: "text-shTextMuted", border: "border-l-shBorder", badge: "bg-shBorder/20 text-shTextMuted", label: "Available" },
  locked:        { icon: "fa-lock", color: "text-shTextMuted", border: "border-l-shBorder", badge: "bg-shBorder/10 text-shTextMuted", label: "Locked" },
};

export default function ModuleJourneyCard({
  name, description, lessonCount, skillCount, status = "available",
  currentLessonName, expanded, onToggle, children, testid,
}) {
  const meta = STATUS_META[status] || STATUS_META.available;
  const compact = status === "locked";
  return (
    <div className={`bg-black/20 border border-shBorder border-l-4 rounded-xl ${meta.border} ${compact ? "opacity-60" : ""}`} data-testid={testid}>
      <button onClick={onToggle} data-testid={testid ? `${testid}-toggle` : undefined}
              className="w-full flex items-start gap-3 px-4 py-3 text-left">
        <i className={`fas ${meta.icon} ${meta.color} text-[16px] mt-0.5 shrink-0`}/>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[14px] font-black text-shText uppercase tracking-tight">{name}</p>
            <span className={`text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full ${meta.badge}`}>{meta.label}</span>
          </div>
          {description && !compact && <p className="text-[12px] text-shTextMuted mt-0.5">{description}</p>}
          <div className="flex items-center gap-3 mt-1 text-[11px] text-shTextMuted font-bold">
            {lessonCount != null && <span><i className="fas fa-book mr-1"/>{lessonCount} lesson{lessonCount === 1 ? "" : "s"}</span>}
            {skillCount != null && <span><i className="fas fa-star mr-1"/>{skillCount} skill{skillCount === 1 ? "" : "s"}</span>}
          </div>
          {currentLessonName && status === "current" && (
            <p className="text-[12px] text-shSecondary font-bold mt-1"><i className="fas fa-arrow-right mr-1"/>{currentLessonName}</p>
          )}
        </div>
        {children && <i className={`fas fa-chevron-${expanded ? "up" : "down"} text-shTextMuted text-[12px] mt-1 shrink-0`}/>}
      </button>
      {expanded && children && <div className="px-4 pb-3 space-y-2">{children}</div>}
    </div>
  );
}
