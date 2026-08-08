// Shared "How did it go?" selector. Values/back-end mapping unchanged.
const CHOICES = [
  { value: "easy", emoji: "😊", label: "Easy" },
  { value: "good", emoji: "🙂", label: "Good" },
  { value: "okay", emoji: "😐", label: "Okay" },
  { value: "hard", emoji: "😕", label: "Hard" },
  { value: "very_hard", emoji: "😣", label: "Very Hard" },
];

export default function DifficultySelector({ value, onChange, testid }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2" role="radiogroup" aria-label="How did it go?" data-testid={testid}>
      {CHOICES.map((c, index) => {
        const selected = value === c.value;
        return (
          <button key={c.value} type="button" role="radio" aria-checked={selected}
                  onClick={() => onChange(c.value)} data-testid={testid ? `${testid}-${c.value}` : undefined}
                  className={`min-h-[72px] flex flex-col items-center justify-center gap-1.5 px-2 py-3 rounded-xl border transition ${index === CHOICES.length - 1 ? "col-span-2 sm:col-span-1" : ""}
                    ${selected ? "bg-shPrimary/12 border-shPrimary/55 text-shPrimary shadow-[0_0_22px_rgba(140,198,63,0.08)]" : "bg-black/10 border-shBorder/55 text-shTextMuted hover:border-shPrimary/35 hover:bg-white/[0.025]"}`}>
            <span className="text-[24px] leading-none" aria-hidden="true">{c.emoji}</span>
            <span className="text-[10px] font-black uppercase tracking-[0.1em]">{c.label}</span>
          </button>
        );
      })}
    </div>
  );
}
