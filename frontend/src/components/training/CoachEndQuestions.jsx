import { renderPracticeCoachText } from "../../lib/practiceCoachPolish";

export default function CoachEndQuestions({ questions, answers, onAnswerChange, tokens, testid }) {
  if (!questions || questions.length === 0) return null;
  return (
    <div className="rounded-2xl border border-shBorder/50 bg-black/12 p-4 space-y-4" data-testid={testid}>
      <div><p className="text-[10px] font-black uppercase tracking-[0.14em] text-shTextMuted">Quick wrap-up</p><p className="text-[12px] text-shTextMuted mt-1">A couple of details help your trainer see the whole picture.</p></div>
      {questions.map(q => (
        <div key={q.id} data-testid={testid ? `${testid}-${q.id}` : undefined}>
          <label className="text-[12px] font-black text-shText">
            {renderPracticeCoachText(q.label, tokens)}{q.required && <span className="text-shDanger"> *</span>}
          </label>
          {q.type === "choice" ? (
            <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 mt-2">
              {(q.options || []).map(opt => {
                const selected = answers?.[q.id] === opt;
                return (
                  <button key={opt} type="button" onClick={() => onAnswerChange(q.id, opt)}
                          data-testid={testid ? `${testid}-${q.id}-${opt}` : undefined}
                          className={`min-h-[42px] px-3 py-2 rounded-xl text-[11px] font-black border transition ${selected ? "bg-shPrimary/15 text-shPrimary border-shPrimary/45" : "bg-black/10 text-shTextMuted border-shBorder/55 hover:text-shText hover:border-shBorder"}`}>
                    {opt}
                  </button>
                );
              })}
            </div>
          ) : (
            <input value={answers?.[q.id] || ""} onChange={(e) => onAnswerChange(q.id, e.target.value)}
                   data-testid={testid ? `${testid}-${q.id}-input` : undefined}
                   className="w-full mt-2 min-h-[44px] bg-black/20 border border-shBorder/55 rounded-xl px-3 text-shText text-sm focus:outline-none focus:border-shSecondary/45"/>
          )}
        </div>
      ))}
    </div>
  );
}
