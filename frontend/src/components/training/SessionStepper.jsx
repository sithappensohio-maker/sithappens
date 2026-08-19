// Training UI Phase 1 — shared session-workspace stepper. Purely a visual
// presentation layer computed from the EXISTING draft/actuals state
// (activeStage/completedKeys are derived by the caller) — it never
// introduces a new backend status, and stages are not independently
// clickable/settable. See TrainingSessionWorkspace's `computeStage`.
const STAGES = [
  { key: "review", label: "Review", icon: "fa-clipboard-list" },
  { key: "train", label: "Train", icon: "fa-dog" },
  { key: "record", label: "Record", icon: "fa-pen" },
  { key: "homework", label: "Practice", icon: "fa-graduation-cap" },
  { key: "complete", label: "Complete", icon: "fa-flag-checkered" },
];

export default function SessionStepper({ activeKey, testid }) {
  const activeIdx = STAGES.findIndex(s => s.key === activeKey);
  return (
    <div className="flex items-center" data-testid={testid}>
      {STAGES.map((s, i) => {
        const done = i < activeIdx;
        const current = i === activeIdx;
        return (
          <div key={s.key} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1 shrink-0">
              <div className={`w-7 h-7 rounded-full grid place-items-center border-2 text-[11px] font-black
                ${done ? "bg-shPrimary border-shPrimary text-bgHeader" : current ? "border-shSecondary text-shSecondary bg-shSecondary/10" : "border-shBorder text-shTextMuted"}`}>
                {done ? <i className="fas fa-check"/> : <i className={`fas ${s.icon}`}/>}
              </div>
              <span className={`text-[9px] font-black uppercase tracking-widest ${current ? "text-shSecondary" : done ? "text-shPrimary" : "text-shTextMuted"}`}>{s.label}</span>
            </div>
            {i < STAGES.length - 1 && (
              <div className={`h-0.5 flex-1 mx-1 mb-4 ${i < activeIdx ? "bg-shPrimary" : "bg-shBorder"}`}/>
            )}
          </div>
        );
      })}
    </div>
  );
}
