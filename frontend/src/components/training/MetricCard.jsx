// School redesign — one Session Performance Details metric card.
//
// Every metric carries three DISTINCT states the trainer can express:
//   blank        = nothing entered yet (the default)
//   a value (0!) = what actually happened, zero included
//   not needed   = the trainer deliberately marked the metric N/A for this
//                  lesson — a real recorded state, never the string "na"
// The checkbox drives the third state; while checked, the metric's controls
// stay visible but grayed/disabled so it is obvious what was switched off.
export default function MetricCard({
  icon, title, helper, notNeeded = false, onNotNeededChange, children, testid,
}) {
  return (
    <section className={`rounded-2xl border p-3.5 sm:p-4 flex flex-col transition ${
      notNeeded ? "border-shBorder/40 bg-black/10" : "border-shBorder/60 bg-gradient-to-br from-shSecondary/[0.045] via-black/15 to-black/20"
    }`} data-testid={testid}>
      <p className={`text-[11px] font-black uppercase tracking-[0.14em] flex items-center gap-2 ${notNeeded ? "text-shTextMuted/60" : "text-shSecondary"}`}>
        {icon && <span className={`w-6 h-6 rounded-lg grid place-items-center border shrink-0 ${notNeeded ? "border-shBorder/40 bg-black/15" : "border-shSecondary/30 bg-shSecondary/10"}`}><i className={`fas ${icon} text-[10px]`}/></span>}
        {title}
      </p>
      {helper && <p className={`text-[11.5px] mt-1.5 leading-relaxed ${notNeeded ? "text-shTextMuted/50" : "text-shTextMuted"}`}>{helper}</p>}
      <div className={`mt-2.5 flex-1 ${notNeeded ? "opacity-40 pointer-events-none select-none" : ""}`} aria-disabled={notNeeded || undefined}>
        {children}
      </div>
      {onNotNeededChange && (
        <label className="flex items-center gap-2 mt-3 pt-2.5 border-t border-shBorder/40 text-[11.5px] font-bold text-shTextMuted cursor-pointer min-h-[28px]"
               data-testid={testid ? `${testid}-not-needed` : undefined}>
          <input type="checkbox" checked={!!notNeeded} onChange={(e) => onNotNeededChange(e.target.checked)}
                 className="w-4 h-4 accent-[var(--sh-secondary)]"/>
          Not needed for this lesson
        </label>
      )}
    </section>
  );
}
