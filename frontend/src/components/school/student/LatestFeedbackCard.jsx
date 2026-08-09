import ScorePair from "./ScorePair";

/* Latest trainer feedback, made prominent on Home. Shows the Handler vs Dog
 * scores separately and the trainer's note — never raw DB values. Only renders
 * when real graded feedback exists. */
export default function LatestFeedbackCard({ feedback, onView }) {
  if (!feedback) return null;
  const trainer = feedback.trainer_name || "Your trainer";
  const when = feedback.graded_at ? new Date(feedback.graded_at).toLocaleDateString() : "";
  const OUTCOME = {
    advance: { label: "Passed — you advanced", cls: "text-shPrimary" },
    prescribe_practice: { label: "More practice prescribed", cls: "text-shAccent" },
    trainer_assist_recommended: { label: "Trainer Assist recommended", cls: "text-purple-300" },
  }[feedback.outcome];

  return (
    <section className="rounded-2xl border border-shSecondary/30 bg-[var(--sh-card-base)] p-4 sm:p-5" data-testid="latest-feedback-card">
      <div className="flex items-center justify-between gap-2 mb-3">
        <p className="text-[11px] font-black uppercase tracking-[0.28em] text-shSecondary">
          <i className="fas fa-comment-dots mr-1.5" />Latest trainer feedback
        </p>
        {when && <span className="text-[11px] uppercase tracking-widest text-shTextMuted">{when}</span>}
      </div>

      <p className="text-shText text-[14px] font-bold">
        {trainer} reviewed {feedback.lesson_name ? `“${feedback.lesson_name}”` : "your checkpoint"}
      </p>
      {OUTCOME && <p className={`text-[12px] font-black uppercase tracking-widest mt-0.5 ${OUTCOME.cls}`}>{OUTCOME.label}</p>}

      <div className="mt-3">
        <ScorePair handler={feedback.handler_overall} dog={feedback.dog_overall} compact />
      </div>

      {feedback.trainer_feedback && (
        <p className="mt-3 text-[13px] text-gray-200 italic whitespace-pre-wrap leading-relaxed border-l-2 border-shSecondary/40 pl-3">
          “{feedback.trainer_feedback}”
        </p>
      )}

      <button
        type="button"
        onClick={onView}
        className="mt-4 text-[12px] font-black uppercase tracking-widest text-shSecondary hover:text-shText transition"
        data-testid="latest-feedback-view"
      >
        View full feedback <i className="fas fa-arrow-right ml-1" />
      </button>
    </section>
  );
}
