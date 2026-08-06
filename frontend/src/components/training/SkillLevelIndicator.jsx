// Training UI Phase 1 — shared 0-5 segmented skill-level indicator. Read-only
// (no onChange) renders a compact filled-segment display for an activity's
// current_score; passing onChange turns the same visual into the trainer's
// score picker, replacing RecordFields' old plain number-button grid.
//
// UI Phase 4 — optional `label` prop (e.g. the backend's client-safe
// level_label: "Reliable"/"Mastered"/etc.) renders next to the segments
// instead of the raw "score/5" text, for client-facing skill cards that
// must never show a raw numeric score as the primary representation.
export default function SkillLevelIndicator({ score = 0, onChange, size = "md", label, testid }) {
  const segments = [0, 1, 2, 3, 4, 5];
  const interactive = typeof onChange === "function";
  const dim = size === "sm" ? "w-5 h-5 text-[10px]" : "py-1.5 text-[13px]";

  if (!interactive) {
    return (
      <div className="flex items-center gap-1" data-testid={testid}>
        {segments.slice(1).map(n => (
          <span key={n} className={`rounded-sm ${size === "sm" ? "w-2.5 h-2.5" : "w-3 h-3"} ${n <= score ? "bg-shPrimary" : "bg-shBorder"}`}/>
        ))}
        <span className="ml-1.5 text-[11px] font-black uppercase tracking-widest text-shTextMuted">{label || `${score}/5`}</span>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-6 gap-1" data-testid={testid}>
      {segments.map(n => (
        <button key={n} type="button" onClick={() => onChange(n)} data-testid={testid ? `${testid}-${n}` : undefined}
                className={`${dim} rounded font-black border ${score === n ? "bg-shPrimary text-bgHeader border-shPrimary" : "border-shBorder text-shTextMuted hover:border-shPrimary/50"}`}>
          {n}
        </button>
      ))}
    </div>
  );
}
