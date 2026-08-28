// School redesign — one Session Performance Details metric card.
//
// Every metric carries three DISTINCT states the trainer can express:
//   blank        = nothing entered yet (the default)
//   a value (0!) = what actually happened, zero included
//   not needed   = the trainer deliberately marked the metric N/A for this
//                  lesson — a real recorded state, never the string "na"
// The checkbox drives the third state; while checked, the metric's controls
// stay visible but grayed/disabled so it is obvious what was switched off.
//
// Each metric owns a hue (tone prop) so the grid reads as a lively card wall
// and trainers learn "distraction is the orange one" by sight. Color is
// identity only — state still always carries an explicit word/control, and a
// not-needed card drops its hue entirely so muted = switched off.
const METRIC_TONES = {
  cyan: {
    card: "border-[#00a9e0]/55 bg-gradient-to-br from-[#00a9e0]/[0.24] via-black/20 to-black/25",
    title: "text-[#4cc9f0]",
    chip: "border-[#00a9e0]/60 bg-[#00a9e0]/20",
  },
  teal: {
    card: "border-[#2dd4bf]/50 bg-gradient-to-br from-[#2dd4bf]/[0.22] via-black/20 to-black/25",
    title: "text-[#2dd4bf]",
    chip: "border-[#2dd4bf]/55 bg-[#2dd4bf]/15",
  },
  lime: {
    card: "border-shPrimary/55 bg-gradient-to-br from-shPrimary/[0.24] via-black/20 to-black/25",
    title: "text-[#a3e635]",
    chip: "border-shPrimary/60 bg-shPrimary/20",
  },
  orange: {
    card: "border-shAccent/55 bg-gradient-to-br from-shAccent/[0.22] via-black/20 to-black/25",
    title: "text-[#fb923c]",
    chip: "border-shAccent/55 bg-shAccent/15",
  },
  green: {
    card: "border-[#4ade80]/50 bg-gradient-to-br from-[#4ade80]/[0.20] via-black/20 to-black/25",
    title: "text-[#4ade80]",
    chip: "border-[#4ade80]/50 bg-[#4ade80]/15",
  },
  purple: {
    card: "border-[#a78bfa]/55 bg-gradient-to-br from-[#a78bfa]/[0.24] via-black/20 to-black/25",
    title: "text-[#a78bfa]",
    chip: "border-[#a78bfa]/55 bg-[#a78bfa]/15",
  },
  pink: {
    card: "border-[#f472b6]/50 bg-gradient-to-br from-[#f472b6]/[0.22] via-black/20 to-black/25",
    title: "text-[#f472b6]",
    chip: "border-[#f472b6]/50 bg-[#f472b6]/15",
  },
};

const NEUTRAL_TONE = {
  card: "border-shBorder/60 bg-gradient-to-br from-shSecondary/[0.045] via-black/15 to-black/20",
  title: "text-shSecondary",
  chip: "border-shSecondary/30 bg-shSecondary/10",
};

export default function MetricCard({
  icon, title, helper, tone, notNeeded = false, onNotNeededChange, children, testid,
}) {
  const t = (tone && METRIC_TONES[tone]) || NEUTRAL_TONE;
  return (
    <section className={`rounded-2xl border p-3.5 sm:p-4 flex flex-col transition ${
      notNeeded ? "border-shBorder/40 bg-black/10" : t.card
    }`} data-testid={testid}>
      <p className={`text-[11px] font-black uppercase tracking-[0.14em] flex items-center gap-2 ${notNeeded ? "text-shTextMuted/60" : t.title}`}>
        {icon && <span className={`w-6 h-6 rounded-lg grid place-items-center border shrink-0 ${notNeeded ? "border-shBorder/40 bg-black/15" : t.chip}`}><i className={`fas ${icon} text-[10px]`}/></span>}
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
