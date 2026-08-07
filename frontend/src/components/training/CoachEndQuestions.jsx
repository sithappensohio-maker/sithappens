// Client Practice Coach upgrade — end-of-practice questions, rendered only
// when the recipe actually defines them (never forced on every exercise).
// `answers` is a plain {question_id: value} map the caller folds into
// field_values (e.g. field_values["q_" + question_id]) when submitting —
// no new backend endpoint, reuses the existing flexible field_values dict.
import { renderPracticeCoachText } from "../../lib/practiceCoachPolish";

export default function CoachEndQuestions({ questions, answers, onAnswerChange, tokens, testid }) {
  if (!questions || questions.length === 0) return null;
  return (
    <div className="space-y-3" data-testid={testid}>
      {questions.map(q => (
        <div key={q.id} data-testid={testid ? `${testid}-${q.id}` : undefined}>
          <label className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">
            {renderPracticeCoachText(q.label, tokens)}{q.required && <span className="text-shDanger"> *</span>}
          </label>
          {q.type === "choice" ? (
            <div className="flex flex-wrap gap-1.5 mt-1">
              {(q.options || []).map(opt => {
                const selected = answers?.[q.id] === opt;
                return (
                  <button key={opt} type="button" onClick={() => onAnswerChange(q.id, opt)}
                          data-testid={testid ? `${testid}-${q.id}-${opt}` : undefined}
                          className={`px-2.5 py-1.5 rounded text-[11px] font-black uppercase tracking-widest border transition
                            ${selected ? "bg-shPrimary text-bgHeader border-shPrimary" : "bg-transparent text-shTextMuted border-shBorder hover:text-shText"}`}>
                    {opt}
                  </button>
                );
              })}
            </div>
          ) : (
            <input value={answers?.[q.id] || ""} onChange={(e) => onAnswerChange(q.id, e.target.value)}
                   data-testid={testid ? `${testid}-${q.id}-input` : undefined}
                   className="w-full mt-1 bg-black/20 border border-shBorder rounded p-2 text-shText text-sm"/>
          )}
        </div>
      ))}
    </div>
  );
}
