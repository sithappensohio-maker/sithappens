// Training UI Phase 3 — the client-facing "Today's Plan" practice card.
// One card per assignment, one primary action — no full directions text
// here (those live in the Homework Practice screen this card opens).
const STATUS_META = {
  not_started:    { icon: "fa-circle", color: "text-shTextMuted", badge: "bg-shBorder/30 text-shTextMuted", label: "Not Started" },
  in_progress:    { icon: "fa-circle-play", color: "text-shSecondary", badge: "bg-shSecondary/15 text-shSecondary", label: "In Progress" },
  waiting_review: { icon: "fa-hourglass-half", color: "text-shSecondary", badge: "bg-shSecondary/15 text-shSecondary", label: "Waiting on Trainer" },
  completed:      { icon: "fa-circle-check", color: "text-shPrimary", badge: "bg-shPrimary/15 text-shPrimary", label: "Completed" },
  needs_redo:     { icon: "fa-rotate-left", color: "text-shAccent", badge: "bg-shAccent/15 text-shAccent", label: "Needs Another Try" },
  overdue:        { icon: "fa-triangle-exclamation", color: "text-red-400", badge: "bg-red-500/15 text-red-300", label: "Overdue" },
  locked:         { icon: "fa-lock", color: "text-shTextMuted", badge: "bg-shBorder/20 text-shTextMuted", label: "Locked" },
};

export default function PracticeAssignmentCard({
  icon = "fa-paw", title, goal, estimatedMinutes, sessionsRequired,
  status = "not_started", attentionLabel,
  primaryActionLabel, onPrimaryAction, disabled,
  dogName, dogPhoto, testid,
}) {
  const meta = STATUS_META[status] || STATUS_META.not_started;
  return (
    <div className={`bg-black/20 border border-shBorder rounded-xl p-3.5 ${status === "completed" ? "opacity-75" : ""}`} data-testid={testid}>
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-11 h-11 rounded-xl bg-shPrimary/10 border border-shPrimary/30 grid place-items-center">
          <i className={`fas ${icon} text-shPrimary text-[17px]`}/>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            {dogName && (
              <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-shTextMuted bg-shBorder/20 rounded-full px-2 py-0.5">
                {dogPhoto ? <img src={dogPhoto} alt="" className="w-3.5 h-3.5 rounded-full object-cover"/> : <i className="fas fa-paw text-[9px]"/>}
                {dogName}
              </span>
            )}
            <span className={`inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${meta.badge}`}>
              <i className={`fas ${meta.icon}`}/>{meta.label}
            </span>
            {attentionLabel && (
              <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-shAccent bg-shAccent/15 rounded-full px-2 py-0.5">
                <i className="fas fa-triangle-exclamation"/>{attentionLabel}
              </span>
            )}
          </div>
          <p className="text-[15px] font-black text-shText leading-tight truncate">{title}</p>
          {goal && <p className="text-[13px] text-shTextMuted mt-0.5 leading-snug">{goal}</p>}
          <div className="flex items-center gap-3 mt-1.5 text-[11px] text-shTextMuted font-bold">
            {estimatedMinutes ? <span><i className="fas fa-clock mr-1"/>{estimatedMinutes} min</span> : null}
            {sessionsRequired ? <span><i className="fas fa-rotate mr-1"/>{sessionsRequired}</span> : null}
          </div>
        </div>
      </div>
      {primaryActionLabel && (
        <button onClick={onPrimaryAction} disabled={disabled} data-testid={testid ? `${testid}-action` : undefined}
                className="mt-3 w-full bg-shPrimary text-bgHeader py-2 rounded-lg font-black text-[12px] uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed hover:bg-shPrimary/90 transition">
          {primaryActionLabel}
        </button>
      )}
    </div>
  );
}
