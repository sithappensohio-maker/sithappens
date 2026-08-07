// Client Practice Coach upgrade — "What Should This Look Like?" paired
// examples. Renders as a simple text/icon storyboard (arrow-joined sequence
// steps) — never requires custom media; media_url, if present, is shown
// above the sequence.
import { renderPracticeCoachText } from "../../lib/practiceCoachPolish";

function ExampleCard({ title, icon, tone, example, tokens, testid }) {
  if (!example || !(example.sequence || []).length) return null;
  const toneCls = tone === "good"
    ? "border-shPrimary/40 bg-shPrimary/5 text-shPrimary"
    : "border-shDanger/40 bg-shDanger/5 text-shDanger";
  return (
    <div className={`border rounded-lg p-3 space-y-2 ${toneCls}`} data-testid={testid}>
      <p className="text-[11px] font-black uppercase tracking-widest flex items-center gap-1.5">
        <i className={`fas ${icon}`}/>{title}
      </p>
      {example.media_url && (
        <img src={example.media_url} alt="" className="w-full rounded-md border border-shBorder/60"/>
      )}
      <div className="flex flex-wrap items-center gap-1.5 text-shText text-[12px] font-bold">
        {example.sequence.map((step, i) => (
          <span key={i} className="flex items-center gap-1.5">
            <span className="bg-black/30 border border-shBorder rounded px-2 py-1">{renderPracticeCoachText(step, tokens)}</span>
            {i < example.sequence.length - 1 && <i className="fas fa-arrow-right text-shTextMuted text-[10px]"/>}
          </span>
        ))}
      </div>
      {example.explanation && (
        <p className="text-[11px] text-shTextMuted">{renderPracticeCoachText(example.explanation, tokens)}</p>
      )}
    </div>
  );
}

export default function GoodRepNotThisCards({ goodRep, notThis, tokens, testid }) {
  if (!goodRep && !notThis) return null;
  return (
    <div className="space-y-2" data-testid={testid}>
      <p className="text-[12px] font-black uppercase tracking-widest text-shSecondary">What Should This Look Like?</p>
      <ExampleCard title="Good Rep" icon="fa-circle-check" tone="good" example={goodRep} tokens={tokens}
                   testid={testid ? `${testid}-good` : undefined}/>
      <ExampleCard title="Not This" icon="fa-circle-xmark" tone="bad" example={notThis} tokens={tokens}
                   testid={testid ? `${testid}-not-this` : undefined}/>
    </div>
  );
}
