// Training UI Phase 1 — shared 0-5 segmented skill-level indicator. Read-only
// (no onChange) renders a compact filled-segment display for an activity's
// current_score; passing onChange turns the same visual into the trainer's
// score picker, replacing RecordFields' old plain number-button grid.
//
// UI Phase 4 — optional `label` prop (e.g. the backend's client-safe
// level_label: "Reliable"/"Mastered"/etc.) renders next to the segments
// instead of the raw "score/5" text, for client-facing skill cards that
// must never show a raw numeric score as the primary representation.
// School redesign — every level explains itself where the trainer taps, so
// a 2 recorded by one trainer means the same thing as a 2 from another.
// These are helper labels over the SAME saved 0-5 semantics, never a new
// scale.
export const SKILL_LEVEL_DESCRIPTIONS = {
  0: { title: "Unable", sub: "Not demonstrated" },
  1: { title: "Heavy Help", sub: "Needs full guidance" },
  2: { title: "Inconsistent", sub: "Needs moderate help" },
  3: { title: "Developing", sub: "Improving with help" },
  4: { title: "Strong", sub: "Minor help only" },
  5: { title: "Reliable", sub: "Consistent & confident" },
};

export default function SkillLevelIndicator({ score = 0, onChange, size = "md", label, testid }) {
  const segments = [0, 1, 2, 3, 4, 5];
  const interactive = typeof onChange === "function";

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
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-1.5" data-testid={testid}>
      {segments.map(n => {
        const d = SKILL_LEVEL_DESCRIPTIONS[n];
        return (
          <button key={n} type="button" onClick={() => onChange(n)} data-testid={testid ? `${testid}-${n}` : undefined}
                  className={`min-h-[52px] rounded-lg border px-1.5 py-1.5 text-center leading-tight transition ${score === n ? "bg-shPrimary/15 text-shPrimary border-shPrimary/70 shadow-[0_0_0_1px_var(--sh-primary)_inset]" : "border-shBorder/60 bg-black/15 text-shTextMuted hover:border-shPrimary/40"}`}>
            <span className="block text-[15px] font-black">{n}</span>
            <span className="block text-[10px] font-black uppercase tracking-[0.06em]">{d.title}</span>
            <span className="block text-[9.5px] font-semibold normal-case opacity-75">{d.sub}</span>
          </button>
        );
      })}
    </div>
  );
}
