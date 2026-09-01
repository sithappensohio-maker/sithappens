/* "Your Trainer" — makes the trainer feel present. Uses the real grader/replier
 * name when one exists; otherwise the general Sit Happens support presentation
 * (never a fabricated person, never "undefined trainer"). Ask Trainer preserves
 * the current course/lesson context via the caller. */
export default function TrainerCard({ trainer, onAsk, onViewFeedback, hasUnansweredQuestion, unreadReplies = 0 }) {
  const named = trainer?.name && !trainer?.is_general_support;
  const displayName = named ? trainer.name : "Your Sit Happens team";
  const role = named ? (trainer.role || "Sit Happens Trainer") : "Training support";
  const initials = (displayName || "S")
    .split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  return (
    <section className="rounded-2xl border border-shBorder bg-[var(--sh-card-base)] p-4 sm:p-5" data-testid="trainer-card">
      <p className="text-[14px] font-black uppercase tracking-[0.28em] text-shTextMuted mb-3">
        <i className="fas fa-user-tie mr-1.5 text-shSecondary" />Your trainer
      </p>
      <div className="flex items-center gap-3">
        <span className="shrink-0 w-11 h-11 rounded-full grid place-items-center font-black text-[18px] bg-shSecondary/15 text-shSecondary border border-shSecondary/30">
          {named ? initials : <i className="fas fa-paw" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-shText font-bold text-[18px] truncate">{displayName}</p>
          <p className="text-[15px] text-shTextMuted truncate">{role}</p>
        </div>
      </div>

      {unreadReplies > 0 ? (
        <button type="button" onClick={onViewFeedback} className="mt-3 text-left text-[15px] font-black text-shPrimary" data-testid="trainer-new-reply">
          <i className="fas fa-reply mr-1" />New trainer {unreadReplies === 1 ? "reply" : "replies"} — view feedback
        </button>
      ) : hasUnansweredQuestion ? (
        <p className="mt-3 text-[15px] font-bold text-shAccent">
          <i className="fas fa-hourglass-half mr-1" />Waiting on a reply to your question
        </p>
      ) : null}

      <button
        type="button"
        onClick={onAsk}
        className="mt-4 w-full inline-flex items-center justify-center gap-2 text-[16px] font-black uppercase tracking-widest px-4 py-3 rounded-xl border border-shSecondary/40 bg-shSecondary/10 text-shSecondary hover:bg-shSecondary/20 transition"
        data-testid="trainer-ask-button"
      >
        <i className="fas fa-comment-dots" />Ask your trainer
      </button>
    </section>
  );
}
