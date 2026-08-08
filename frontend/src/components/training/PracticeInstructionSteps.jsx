// Shared numbered practice sequence. Logic unchanged; presentation matches
// the Online School journey and stacks cleanly at 320px.
function splitSteps(text) {
  if (!text) return [];
  const lines = String(text).split("\n").map(l => l.trim()).filter(Boolean);
  const numbered = lines.filter(l => /^\d+[.)]/.test(l));
  const source = numbered.length >= 2 ? numbered : lines;
  return source.map(l => l.replace(/^\d+[.)]\s*/, ""));
}

export default function PracticeInstructionSteps({ steps, text, testid }) {
  const items = steps && steps.length ? steps : splitSteps(text);
  if (items.length === 0) return null;
  return (
    <ol className="space-y-2.5" data-testid={testid}>
      {items.map((step, i) => (
        <li key={i} className="flex items-start gap-3 rounded-xl border border-shBorder/45 bg-black/10 p-3 sm:p-3.5">
          <span className="shrink-0 w-8 h-8 rounded-xl bg-shPrimary/12 border border-shPrimary/35 text-shPrimary text-[12px] font-black grid place-items-center">{i + 1}</span>
          <span className="text-[13px] sm:text-[14px] text-shText leading-relaxed pt-1">{step}</span>
        </li>
      ))}
    </ol>
  );
}
