// Client-facing practice assignment card. Behavior unchanged; branded dog
// photo fallback now uses the Sit Happens husky mascot system.
import HuskyDogImage from "../brand/HuskyDogImage";

const STATUS_META = {
  not_started:    { icon: "fa-circle", color: "text-shTextMuted", badge: "bg-shBorder/25 text-shTextMuted border-shBorder/45", label: "Not Started" },
  in_progress:    { icon: "fa-circle-play", color: "text-shSecondary", badge: "bg-shSecondary/10 text-shSecondary border-shSecondary/25", label: "In Progress" },
  waiting_review: { icon: "fa-hourglass-half", color: "text-shAccent", badge: "bg-shAccent/10 text-shAccent border-shAccent/25", label: "Waiting on Trainer" },
  completed:      { icon: "fa-circle-check", color: "text-shPrimary", badge: "bg-shPrimary/10 text-shPrimary border-shPrimary/25", label: "Completed" },
  needs_redo:     { icon: "fa-rotate-left", color: "text-shAccent", badge: "bg-shAccent/10 text-shAccent border-shAccent/25", label: "Needs Another Try" },
  overdue:        { icon: "fa-triangle-exclamation", color: "text-red-400", badge: "bg-red-500/10 text-red-300 border-red-500/25", label: "Overdue" },
  locked:         { icon: "fa-lock", color: "text-shTextMuted", badge: "bg-shBorder/20 text-shTextMuted border-shBorder/35", label: "Locked" },
};

export default function PracticeAssignmentCard({
  icon = "fa-paw", title, goal, estimatedMinutes, sessionsRequired,
  status = "not_started", attentionLabel,
  primaryActionLabel, onPrimaryAction, disabled,
  dogName, dogPhoto, testid,
}) {
  const meta = STATUS_META[status] || STATUS_META.not_started;
  return (
    <div className={`relative overflow-hidden border rounded-2xl p-4 sm:p-5 transition ${status === "completed" ? "border-shPrimary/20 bg-shPrimary/[0.025] opacity-80" : "border-shBorder/55 bg-black/15"}`} data-testid={testid}>
      <div className="flex items-start gap-3.5">
        {dogName ? (
          <div className="shrink-0 w-14 h-14 rounded-2xl overflow-hidden border border-shPrimary/25 bg-black/30"><HuskyDogImage src={dogPhoto} name={dogName} alt={dogName} className="w-full h-full object-cover object-top"/></div>
        ) : (
          <div className="shrink-0 w-12 h-12 rounded-xl bg-shPrimary/10 border border-shPrimary/30 grid place-items-center"><i className={`fas ${icon} text-shPrimary text-[16px]`}/></div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            {dogName && <span className="text-[9px] font-black uppercase tracking-[0.12em] text-shTextMuted">{dogName}</span>}
            <span className={`inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.1em] px-2 py-1 rounded-lg border ${meta.badge}`}><i className={`fas ${meta.icon}`}/>{meta.label}</span>
            {attentionLabel && <span className="inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.1em] text-shAccent bg-shAccent/10 border border-shAccent/25 rounded-lg px-2 py-1"><i className="fas fa-triangle-exclamation"/>{attentionLabel}</span>}
          </div>
          <p className="text-[15px] sm:text-[16px] font-black text-shText leading-tight">{title}</p>
          {goal && <p className="text-[12px] sm:text-[13px] text-shTextMuted mt-1 leading-relaxed">{goal}</p>}
          <div className="flex items-center gap-3 mt-2 text-[10px] sm:text-[11px] text-shTextMuted font-bold">
            {estimatedMinutes ? <span><i className="fas fa-clock mr-1.5 text-shSecondary"/>{estimatedMinutes} min</span> : null}
            {sessionsRequired ? <span><i className="fas fa-rotate mr-1.5 text-shPrimary"/>{sessionsRequired}</span> : null}
          </div>
        </div>
      </div>
      {primaryActionLabel && (
        <button onClick={onPrimaryAction} disabled={disabled} data-testid={testid ? `${testid}-action` : undefined}
                className="mt-4 w-full min-h-[48px] bg-shPrimary text-bgHeader py-2.5 rounded-xl font-black text-[12px] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-shPrimary/90 transition shadow-[0_10px_28px_-20px_rgba(140,198,63,0.8)]">
          {primaryActionLabel} <i className="fas fa-arrow-right ml-1.5 text-[9px]"/>
        </button>
      )}
    </div>
  );
}
