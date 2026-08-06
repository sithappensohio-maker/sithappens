// Training UI Phase 3 — shows a trainer's reply/review note. Only ever
// receives props built from fields the backend already scopes as
// client-safe (e.g. DailyCheckInCard's existing `review_note`/question
// `answer` fields) — this component never has access to internal-only
// trainer notes, so there is nothing for it to accidentally leak.
export default function TrainerFeedbackNotice({ text, tone = "primary", label = "Trainer's note", testid }) {
  if (!text) return null;
  const toneCls = { primary: "border-shPrimary/40 bg-shPrimary/5 text-shPrimary", danger: "border-red-500/40 bg-red-500/5 text-red-300" }[tone] || "border-shPrimary/40 bg-shPrimary/5 text-shPrimary";
  return (
    <div className={`border rounded-lg p-3 ${toneCls}`} data-testid={testid}>
      <p className="text-[11px] font-black uppercase tracking-widest"><i className="fas fa-comment-dots mr-1.5"/>{label}</p>
      <p className="text-[14px] text-shText mt-1 italic">&ldquo;{text}&rdquo;</p>
    </div>
  );
}
