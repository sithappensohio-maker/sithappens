// Practice Coach visual examples. All authored content/semantics unchanged.
import { renderPracticeCoachText } from "../../lib/practiceCoachPolish";

function ExampleCard({ title, icon, tone, example, tokens, testid }) {
  if (!example || !(example.sequence || []).length) return null;
  const good = tone === "good";
  return (
    <div className={`relative overflow-hidden border rounded-2xl p-4 ${good ? "border-shPrimary/30 bg-shPrimary/[0.055]" : "border-shAccent/30 bg-shAccent/[0.045]"}`} data-testid={testid}>
      <div className="flex items-center gap-2 mb-3">
        <span className={`w-9 h-9 rounded-xl border grid place-items-center ${good ? "bg-shPrimary/10 border-shPrimary/25 text-shPrimary" : "bg-shAccent/10 border-shAccent/25 text-shAccent"}`}><i className={`fas ${icon} text-[15px]`}/></span>
        <p className={`text-[16px] font-black uppercase tracking-[0.1em] ${good ? "text-shPrimary" : "text-shAccent"}`}>{title}</p>
      </div>
      {example.media_url && <img src={example.media_url} alt="" className="w-full rounded-xl border border-shBorder/50 mb-3"/>}
      <div className="flex flex-wrap items-center gap-1.5 text-shText text-[16px] sm:text-[17px] font-bold">
        {example.sequence.map((step, i) => (
          <span key={i} className="flex items-center gap-1.5 max-w-full">
            <span className="bg-black/25 border border-shBorder/45 rounded-lg px-2.5 py-1.5 break-words">{renderPracticeCoachText(step, tokens)}</span>
            {i < example.sequence.length - 1 && <i className="fas fa-arrow-right text-shTextMuted text-[11px]"/>}
          </span>
        ))}
      </div>
      {example.explanation && <p className="text-[16px] sm:text-[17px] text-shTextMuted leading-relaxed mt-3">{renderPracticeCoachText(example.explanation, tokens)}</p>}
    </div>
  );
}

export default function GoodRepNotThisCards({ goodRep, notThis, tokens, testid }) {
  if (!goodRep && !notThis) return null;
  return (
    <div className="space-y-2.5" data-testid={testid}>
      <div><p className="text-[15px] sm:text-[16px] font-black uppercase tracking-[0.1em] text-shSecondary">What should this look like?</p><p className="text-[17px] text-shTextMuted mt-0.5">Compare a clean rep with the most common miss.</p></div>
      <div className="grid sm:grid-cols-2 gap-3">
        <ExampleCard title="Good Rep" icon="fa-circle-check" tone="good" example={goodRep} tokens={tokens} testid={testid ? `${testid}-good` : undefined}/>
        <ExampleCard title="Not This" icon="fa-circle-xmark" tone="bad" example={notThis} tokens={tokens} testid={testid ? `${testid}-not-this` : undefined}/>
      </div>
    </div>
  );
}
