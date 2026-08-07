// Client Practice Coach upgrade — the template-defined response shown
// after a difficulty rating. The trainer/template author controls this
// wording; the frontend never invents dog-training advice of its own.
import { renderPracticeCoachText } from "../../lib/practiceCoachPolish";

export default function DifficultyFeedbackNotice({ difficulty, feedback, tokens, testid }) {
  const text = difficulty && feedback ? feedback[difficulty] : null;
  if (!text) return null;
  return (
    <div className="bg-shSecondary/10 border border-shSecondary/30 rounded-lg p-2.5 flex items-start gap-2" data-testid={testid}>
      <i className="fas fa-lightbulb text-shSecondary text-[13px] mt-0.5 shrink-0"/>
      <p className="text-[12px] text-shText">{renderPracticeCoachText(text, tokens)}</p>
    </div>
  );
}
