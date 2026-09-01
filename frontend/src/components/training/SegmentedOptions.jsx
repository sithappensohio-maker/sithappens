// School redesign — shared segmented option selector. One tap per choice,
// with an optional sublabel under each option so the meaning of every level
// is explained where the trainer taps (never a bare jargon word). Selecting
// the already-selected option clears it when `clearable` — "no answer" stays
// a real state, matching the rest of the recording model.
const TONES = {
  primary: "bg-shPrimary/15 text-shPrimary border-shPrimary/60",
  secondary: "bg-shSecondary/15 text-shSecondary border-shSecondary/55",
  accent: "bg-shAccent/15 text-shAccent border-shAccent/55",
};

export default function SegmentedOptions({
  options, value, onChange, tone = "secondary", clearable = true,
  disabled = false, columns = "grid-cols-2 sm:grid-cols-3", testid,
}) {
  return (
    <div className={`grid ${columns} gap-1.5`} data-testid={testid}>
      {options.map((o) => {
        const selected = value === o.value;
        return (
          <button key={o.value} type="button" disabled={disabled}
                  onClick={() => onChange(selected && clearable ? null : o.value)}
                  data-testid={testid ? `${testid}-${String(o.value).toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : undefined}
                  className={`min-h-[40px] rounded-lg border px-2 py-1.5 text-left leading-tight transition disabled:opacity-40 ${
                    selected ? (TONES[tone] || TONES.secondary) : "border-shBorder/60 bg-black/15 text-shTextMuted hover:border-shSecondary/40"
                  }`}>
            <span className="block text-[14px] font-black uppercase tracking-[0.08em]">{o.label}</span>
            {o.sublabel && <span className="block text-[13px] font-semibold normal-case tracking-normal opacity-80 mt-0.5">{o.sublabel}</span>}
          </button>
        );
      })}
    </div>
  );
}
