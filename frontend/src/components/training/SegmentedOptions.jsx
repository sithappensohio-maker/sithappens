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
  disabled = false, minChipWidth = 88, testid,
}) {
  // Chips size to the space the CARD actually has, not to the viewport. These
  // selectors sit inside narrow metric cards, so viewport breakpoints used to
  // hand a 5-across grid ~33px per chip while a word like "MODERATE" needs ~89px
  // — the label then spilled out of its button and collided with its neighbours.
  // auto-fit keeps every chip at least `minChipWidth` wide and simply wraps to
  // another row when they do not fit; `break-words` is the last-resort guard for
  // a container narrower than one chip, so a label can never escape its button.
  return (
    <div className="grid gap-1.5" data-testid={testid}
         style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(${minChipWidth}px, 100%), 1fr))` }}>
      {options.map((o) => {
        const selected = value === o.value;
        return (
          <button key={o.value} type="button" disabled={disabled}
                  onClick={() => onChange(selected && clearable ? null : o.value)}
                  data-testid={testid ? `${testid}-${String(o.value).toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : undefined}
                  className={`min-h-[40px] min-w-0 rounded-lg border px-2 py-1.5 text-left leading-tight transition disabled:opacity-40 ${
                    selected ? (TONES[tone] || TONES.secondary) : "border-shBorder/60 bg-black/15 text-shTextMuted hover:border-shSecondary/40"
                  }`}>
            {/* Sized so the longest label in these scales ("MODERATE") still fits
                one line inside a `minChipWidth` chip at the default text size.
                A larger text-size setting wraps the word instead of overflowing. */}
            <span className="block break-words text-[12px] font-black uppercase tracking-[0.02em]">{o.label}</span>
            {o.sublabel && <span className="block break-words text-[13px] font-semibold normal-case tracking-normal opacity-80 mt-0.5">{o.sublabel}</span>}
          </button>
        );
      })}
    </div>
  );
}
