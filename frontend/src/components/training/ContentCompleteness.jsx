// Training UI Phase 5 — Program Studio curriculum-completeness indicator.
// Items come from computeLessonCompleteness/computeSkillCompleteness
// (lib/programStudioPolish.js) — this component only renders them.
const STATE_META = {
  complete: { icon: "fa-check", cls: "text-shPrimary", box: "border-shPrimary/20 bg-shPrimary/[0.035]" },
  needs_attention: { icon: "fa-exclamation", cls: "text-shAccent", box: "border-shAccent/20 bg-shAccent/[0.03]" },
  optional: { icon: "fa-minus", cls: "text-shTextMuted", box: "border-shBorder/50 bg-black/10" },
  missing: { icon: "fa-times", cls: "text-red-400", box: "border-red-500/20 bg-red-500/[0.03]" },
};

export default function ContentCompleteness({ items, testid }) {
  const list = items || [];
  if (list.length === 0) return null;
  const complete = list.filter(i => i.state === "complete").length;
  const needs = list.filter(i => i.state === "needs_attention" || i.state === "missing").length;
  return (
    <div className="rounded-2xl border border-shBorder/50 bg-black/10 p-3" data-testid={testid}>
      <div className="flex items-center justify-between gap-3 mb-2.5">
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.16em] text-shTextMuted">Content readiness</p>
          <p className="text-[11px] text-shTextMuted mt-0.5">{complete} complete{needs > 0 ? ` · ${needs} need attention` : " · ready to review"}</p>
        </div>
        <span className={`rounded-full px-2 py-1 text-[9px] font-black border ${needs > 0 ? "text-shAccent border-shAccent/25 bg-shAccent/[0.04]" : "text-shPrimary border-shPrimary/25 bg-shPrimary/[0.04]"}`}>
          {needs > 0 ? "Needs attention" : "Looking good"}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {list.map(item => {
          const meta = STATE_META[item.state] || STATE_META.optional;
          return (
            <div key={item.key} className={`min-h-[34px] rounded-lg border px-2.5 py-2 flex items-center gap-2 ${meta.box}`} data-testid={testid ? `${testid}-${item.key}` : undefined}>
              <span className={`w-5 h-5 rounded-md border border-current/10 grid place-items-center shrink-0 ${meta.cls}`}><i className={`fas ${meta.icon} text-[8px]`}/></span>
              <span className="text-[10px] text-shText flex-1 min-w-0">{item.label}</span>
              <span className={`text-[8px] font-black whitespace-nowrap ${meta.cls}`}>
                {item.state === "needs_attention" ? "Needs attention" : item.state === "optional" ? "Optional" : item.state === "missing" ? "Missing" : "Done"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
