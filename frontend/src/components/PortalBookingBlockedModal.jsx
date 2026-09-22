// Stage 1 — what a client sees when they press Book and setup still blocks it.
//
// The old flow let someone pick a service, pick a date, review a price and
// press Confirm, and only then said "RABIES VACCINE IS PENDING ADMIN REVIEW".
// Every fact needed to refuse that booking was knowable before step 1, so it
// is now said before step 1.
//
// Three questions, in this order, because that is the order a person asks:
//   1. what is stopping me
//   2. what happens next
//   3. what can I do about it
//
// Everything here is projected from GET /portal/setup-status — the same
// server-side computation the booking gate itself uses. Nothing on this
// screen is derived from a second opinion, and nothing claims a review
// turnaround time, because no such business rule exists to claim.

import PremiumButton from "./premium/PremiumButton";

const isDone = (s) => s?.status === "complete";

/** Steps that still stand between this client and a booking, in server order. */
export function blockingSteps(status) {
  const steps = status?.steps || [];
  return steps.filter((s) => !isDone(s) && !(s.optional && s.status !== "in_progress"));
}

/**
 * One plain sentence naming what is actually wrong.
 *
 * A vaccine sitting in our review queue is NOT "missing" — the client did
 * their part and telling them otherwise is how support calls start.
 */
export function blockerHeadline(step) {
  if (!step) return "Your setup isn't finished yet.";
  if (step.id === "vaccines") {
    const awaiting = step.awaiting_review || [];
    const missing = step.missing || [];
    if (missing.length === 0 && awaiting.length > 0) {
      return awaiting.length === 1
        ? `${awaiting[0]} is uploaded and waiting for our review.`
        : `${awaiting.length} vaccine records are uploaded and waiting for our review.`;
    }
    if (missing.length === 1) return `We still need ${missing[0]}.`;
    if (missing.length > 1) return `We still need ${missing.length} vaccine records.`;
    return "We still need current vaccine records.";
  }
  const missing = step.missing || [];
  if (missing.length === 1) return `We still need: ${missing[0]}.`;
  if (missing.length > 1) return `${step.label}: ${missing.length} items still needed.`;
  return `${step.label} isn't finished yet.`;
}

/** What happens next — only ever describes mechanics we actually implement. */
export function blockerNextLine(step) {
  if (step?.id === "vaccines" && (step.missing || []).length === 0 && (step.awaiting_review || []).length > 0) {
    return "Once Sit Happens approves the record, booking unlocks automatically. You don't need to do anything else for it.";
  }
  return "Booking unlocks automatically as soon as the remaining items are finished or approved.";
}

export default function PortalBookingBlockedModal({ status, onAction, onHelp, onClose }) {
  if (!status) return null;
  const blockers = blockingSteps(status);
  const primary = blockers[0] || null;
  const total = status.total_count || (status.steps || []).length;
  const done = status.completed_count ?? 0;
  // Only the vaccines step can be "done by the client but not yet cleared".
  const waitingOnUs = primary?.id === "vaccines"
    && (primary.missing || []).length === 0
    && (primary.awaiting_review || []).length > 0;

  return (
    <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
         role="dialog" aria-modal="true" aria-label="Booking not available yet"
         data-testid="portal-booking-blocked">
      <div className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl border-2 border-shAccent/50 shadow-sh p-5 sm:p-6 my-0 sm:my-8"
           style={{ background: "var(--sh-card-base)" }}>

        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.3em] text-shAccent">
              <i className={`fas ${waitingOnUs ? "fa-clock" : "fa-lock"} mr-1.5`} />
              {waitingOnUs ? "Waiting on us" : "One more thing first"}
            </p>
            <h2 className="text-xl sm:text-2xl font-black text-shText tracking-tight mt-1 break-words">
              Booking isn&apos;t open yet
            </h2>
          </div>
          <button onClick={onClose} aria-label="Close"
                  data-testid="portal-booking-blocked-close"
                  className="shrink-0 -m-2 p-3 text-shTextMuted hover:text-shText">
            <i className="fas fa-xmark text-lg" />
          </button>
        </div>

        {/* 1 — what is blocking */}
        <p className="text-[15px] text-shText mt-4 leading-relaxed break-words"
           data-testid="portal-booking-blocked-reason">
          {blockerHeadline(primary)}
        </p>

        {/* 2 — what happens next */}
        <p className="text-[13px] text-shTextMuted mt-2 leading-relaxed break-words"
           data-testid="portal-booking-blocked-next">
          {blockerNextLine(primary)}
        </p>

        {blockers.length > 1 && (
          <div className="mt-4 rounded-xl border border-shBorder p-3">
            <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">
              {done} of {total} setup steps done
            </p>
            <ul className="mt-2 space-y-1">
              {blockers.map((s) => (
                <li key={s.id} className="text-[12px] text-shTextMuted break-words">
                  <i className={`fas ${s.status === "pending_review" ? "fa-clock text-shSecondary" : "fa-circle-exclamation text-shAccent"} mr-1.5`} />
                  {s.label}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 3 — what they can do */}
        <div className="mt-5 flex flex-col gap-2">
          {primary && !waitingOnUs && (
            <PremiumButton variant="primary" className="w-full justify-center py-3"
                           data-testid="portal-booking-blocked-action"
                           onClick={() => { onClose?.(); onAction?.(primary.action_target); }}>
              <i className="fas fa-hand-pointer mr-2" />{primary.action_label}
            </PremiumButton>
          )}
          {waitingOnUs && (
            <PremiumButton variant="cyan" className="w-full justify-center py-3"
                           data-testid="portal-booking-blocked-view-vaccines"
                           onClick={() => { onClose?.(); onAction?.("vaccines"); }}>
              <i className="fas fa-shield-virus mr-2" />View vaccine records
            </PremiumButton>
          )}
          {onHelp && (
            <button onClick={() => { onClose?.(); onHelp(); }}
                    data-testid="portal-booking-blocked-help"
                    className="w-full py-3 text-[13px] font-black uppercase tracking-widest text-shSecondary hover:text-white">
              <i className="fas fa-comments mr-2" />Message Sit Happens
            </button>
          )}
          <button onClick={onClose}
                  className="w-full py-3 text-[12px] font-black uppercase tracking-widest text-shTextMuted hover:text-shText">
            See my full checklist
          </button>
        </div>
      </div>
    </div>
  );
}
