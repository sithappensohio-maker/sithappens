// Training UI Phase 5 — Program Studio curriculum-completeness indicator.
// Items come from computeLessonCompleteness/computeSkillCompleteness
// (lib/programStudioPolish.js) — this component only renders them.
const STATE_META = {
  complete: { icon: "fa-circle-check", cls: "text-shPrimary" },
  needs_attention: { icon: "fa-triangle-exclamation", cls: "text-shAccent" },
  optional: { icon: "fa-circle-dot", cls: "text-shTextMuted" },
  missing: { icon: "fa-circle-xmark", cls: "text-red-400" },
};

export default function ContentCompleteness({ items, testid }) {
  const list = items || [];
  if (list.length === 0) return null;
  return (
    <div className="space-y-1" data-testid={testid}>
      {list.map(item => {
        const meta = STATE_META[item.state] || STATE_META.optional;
        return (
          <div key={item.key} className="flex items-center gap-2 text-[12px]" data-testid={testid ? `${testid}-${item.key}` : undefined}>
            <i className={`fas ${meta.icon} ${meta.cls} w-4 text-center shrink-0`}/>
            <span className="text-shText">{item.label}</span>
            <span className={`ml-auto text-[10px] font-black uppercase tracking-widest ${meta.cls}`}>
              {item.state === "needs_attention" ? "Needs Attention" : item.state === "optional" ? "Optional" : item.state === "missing" ? "Missing" : "Complete"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
