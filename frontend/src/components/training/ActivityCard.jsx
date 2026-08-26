// Training UI Phase 1 — shared visual activity card. Status color follows
// the brief's semantics (green=mastered/on-track, blue=in progress,
// orange=needs review, gray=not started/skipped) — color is always paired
// with an icon+text label, never color alone.
import SkillLevelIndicator from "./SkillLevelIndicator";

const STATUS_META = {
  mastered:            { tone: "border-l-shPrimary", icon: "fa-circle-check", iconColor: "text-shPrimary", label: "Mastered" },
  in_progress:         { tone: "border-l-shSecondary", icon: "fa-circle-dot", iconColor: "text-shSecondary", label: "In Progress" },
  learning:            { tone: "border-l-shSecondary", icon: "fa-circle-dot", iconColor: "text-shSecondary", label: "Learning" },
  needs_reassessment:  { tone: "border-l-shAccent", icon: "fa-triangle-exclamation", iconColor: "text-shAccent", label: "Needs Review" },
  not_started:         { tone: "border-l-shBorder", icon: "fa-circle", iconColor: "text-shTextMuted", label: "Not Started" },
};

export default function ActivityCard({ activity: a, index, total, expanded, onToggleExpand, onMove, onRemove, onToggleSkip, onSkipReason, locked = false, children, testid }) {
  const meta = a.skipped
    ? { tone: "border-l-shBorder", icon: "fa-forward", iconColor: "text-shTextMuted", label: "Skipped" }
    : (STATUS_META[a.current_status] || STATUS_META.not_started);

  return (
    <div className={`bg-black/20 border border-shBorder border-l-4 rounded-lg ${meta.tone} ${a.skipped ? "opacity-60" : ""}`} data-testid={testid}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className="text-[10px] text-shTextMuted w-5 text-center shrink-0">{index + 1}</span>
        <i className={`fas ${meta.icon} ${meta.iconColor} text-[13px] shrink-0`} title={meta.label}/>
        <button onClick={onToggleExpand} data-testid={testid ? `${testid}-toggle` : undefined} className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[14px] font-black text-shText truncate">{a.name}</p>
            {a.estimated_minutes ? (
              <span className="text-[10px] font-black uppercase tracking-widest text-shTextMuted bg-shBorder/30 rounded px-1.5 py-0.5 shrink-0">
                <i className="fas fa-clock mr-1"/>{a.estimated_minutes} min
              </span>
            ) : null}
          </div>
          {a.objective && !expanded && <p className="text-[12px] text-shTextMuted truncate mt-0.5">{a.objective}</p>}
        </button>
        {!a.manual_only && !expanded && <SkillLevelIndicator score={a.current_score || 0} size="sm" testid={testid ? `${testid}-score` : undefined}/>}
        {locked ? (
          <span className="px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest border border-shPrimary/35 text-shPrimary shrink-0" title="Required by the current curriculum lesson">
            <i className="fas fa-lock mr-1"/>Required
          </span>
        ) : (
          <>
            <button onClick={() => onMove(-1)} disabled={index === 0} className="w-6 h-6 rounded text-shTextMuted hover:bg-white/10 disabled:opacity-25 shrink-0"><i className="fas fa-chevron-up text-[11px]"/></button>
            <button onClick={() => onMove(1)} disabled={index === total - 1} className="w-6 h-6 rounded text-shTextMuted hover:bg-white/10 disabled:opacity-25 shrink-0"><i className="fas fa-chevron-down text-[11px]"/></button>
            <button onClick={onToggleSkip} title="Skip this activity" data-testid={testid ? `${testid}-skip` : undefined}
                    className={`px-2 py-1 rounded text-[11px] font-black uppercase tracking-widest border shrink-0 ${a.skipped ? "bg-shAccent/20 text-shAccent border-shAccent/40" : "border-shBorder text-shTextMuted"}`}>Skip</button>
            <button onClick={onRemove} className="w-6 h-6 rounded text-red-400 hover:bg-red-500/15 shrink-0"><i className="fas fa-trash text-[11px]"/></button>
          </>
        )}
      </div>
      {a.skipped && (
        <div className="px-3 pb-2">
          <input value={a.skip_reason || ""} onChange={(e) => onSkipReason(e.target.value)} placeholder="Reason for skipping (optional)"
                 data-testid={testid ? `${testid}-skip-reason` : undefined}
                 className="w-full bg-black/20 border border-shBorder rounded p-1.5 text-shText text-[12px]"/>
        </div>
      )}
      {expanded && <div className="px-3 pb-3 space-y-3 border-t border-shBorder pt-3">{children}</div>}
    </div>
  );
}
