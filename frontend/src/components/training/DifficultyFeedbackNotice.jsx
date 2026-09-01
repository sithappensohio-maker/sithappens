import { renderPracticeCoachText } from "../../lib/practiceCoachPolish";

export default function DifficultyFeedbackNotice({ difficulty, feedback, tokens, testid }) {
  const text = difficulty && feedback ? feedback[difficulty] : null;
  if (!text) return null;
  return (
    <div className="rounded-xl border border-shSecondary/25 bg-shSecondary/[0.055] p-3.5 flex items-start gap-3" data-testid={testid}>
      <span className="w-8 h-8 rounded-lg bg-shSecondary/10 border border-shSecondary/25 grid place-items-center shrink-0"><i className="fas fa-lightbulb text-shSecondary text-[14px]"/></span>
      <p className="text-[15px] sm:text-[16px] text-shText leading-relaxed pt-0.5">{renderPracticeCoachText(text, tokens)}</p>
    </div>
  );
}
