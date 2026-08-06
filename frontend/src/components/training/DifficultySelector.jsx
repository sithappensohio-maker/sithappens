// Training UI Phase 3 — shared "How did it go?" difficulty selector.
// Deferred from Phase 1 (nothing consumed it yet); built now for the
// Homework Practice completion flow. Maps directly onto the existing
// DaySubmitIn.difficulty enum ("easy"|"good"|"okay"|"hard"|"very_hard") —
// no new backend values. Accessible labeled buttons, not emoji-only.
const CHOICES = [
  { value: "easy", emoji: "😊", label: "Easy" },
  { value: "good", emoji: "🙂", label: "Good" },
  { value: "okay", emoji: "😐", label: "Okay" },
  { value: "hard", emoji: "😕", label: "Hard" },
  { value: "very_hard", emoji: "😣", label: "Very Hard" },
];

export default function DifficultySelector({ value, onChange, testid }) {
  return (
    <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="How did it go?" data-testid={testid}>
      {CHOICES.map(c => {
        const selected = value === c.value;
        return (
          <button key={c.value} type="button" role="radio" aria-checked={selected}
                  onClick={() => onChange(c.value)} data-testid={testid ? `${testid}-${c.value}` : undefined}
                  className={`flex flex-col items-center gap-1 py-2.5 rounded-lg border transition
                    ${selected ? "bg-shPrimary/15 border-shPrimary text-shPrimary" : "border-shBorder text-shTextMuted hover:border-shPrimary/40"}`}>
            <span className="text-[22px] leading-none" aria-hidden="true">{c.emoji}</span>
            <span className="text-[10px] font-black uppercase tracking-widest">{c.label}</span>
          </button>
        );
      })}
    </div>
  );
}
