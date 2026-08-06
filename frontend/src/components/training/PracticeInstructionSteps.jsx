// Training UI Phase 3 — short numbered practice sequence, always visible by
// default (unlike the longer tips/mistakes/troubleshooting text, which stay
// inside ExpandableSection). Accepts either a pre-split array of steps or a
// single "1. ...\n2. ..." style text block and splits it — no new backend
// field, just presentation over existing instructions text.
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
    <ol className="space-y-2" data-testid={testid}>
      {items.map((step, i) => (
        <li key={i} className="flex items-start gap-2.5">
          <span className="shrink-0 w-6 h-6 rounded-full bg-shPrimary/15 border border-shPrimary/40 text-shPrimary text-[12px] font-black grid place-items-center">{i + 1}</span>
          <span className="text-[14px] text-shText leading-snug pt-0.5">{step}</span>
        </li>
      ))}
    </ol>
  );
}
