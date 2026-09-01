import { practiceBuckets, PracticeGroup, PracticeAssignmentCard } from "./practice/PracticeCards";
import EmptyState from "../../training/EmptyState";

/* Practice — the fourth primary destination.
 *
 * Phase 2 gave Practice a real home instead of a modal reachable only from
 * Today. Phase 3 makes it answer the question a client actually arrives with:
 * "what should I practice today?" Work is ordered by urgency — overdue, due,
 * the server's recommended next, then everything else — and recent completions
 * sit at the bottom as evidence of effort rather than as a to-do list.
 *
 * All data comes from the existing home view-model's active_practice. The
 * Practice COACH itself is the canonical engine and is untouched here; opening
 * an assignment hands off to it exactly as before.
 */
export default function PracticeScreen({ home, loading, onOpenPractice, onPrimaryAction }) {
  if (loading && !home) {
    return (
      <div className="space-y-3" data-testid="practice-screen-loading">
        <div className="h-8 w-40 rounded bg-shBorder/40 animate-pulse" />
        <div className="h-28 rounded-2xl bg-shBorder/25 animate-pulse" />
        <div className="h-28 rounded-2xl bg-shBorder/20 animate-pulse" />
      </div>
    );
  }
  if (!home) return null;

  const all = home.active_practice || [];
  const action = home.current_action;
  const practiceIsNext = action?.type === "practice";
  // The server already decided what comes next; this screen only labels it.
  const recommendedId = practiceIsNext ? (action?.target?.homework_id || action?.target?.practice_id || null) : null;
  const b = practiceBuckets(all, { recommendedId });
  const openCount = b.overdue.length + b.due.length + b.recommended.length + b.upcoming.length;
  const dogName = home.dog?.name;

  return (
    <div className="space-y-5" data-testid="practice-screen">
      <header>
        <h1 className="text-shText font-black text-[22px] sm:text-[26px] leading-tight">Practice</h1>
        <p className="text-[16px] text-shTextMuted mt-0.5 leading-relaxed">
          {b.overdue.length > 0
            ? `Start here — ${b.overdue.length} practice ${b.overdue.length === 1 ? "session is" : "sessions are"} past due.`
            : openCount > 0
              ? `Short reps between lessons are what make it stick${dogName ? ` for ${dogName}` : ""}.`
              : "Nothing outstanding right now — your next lesson will assign more when it's time."}
        </p>
      </header>

      {/* When the server says practice IS the next best action, offer it here
          too so the client never has to go back to Today to start. */}
      {practiceIsNext && action?.label && (
        <button type="button" onClick={onPrimaryAction} data-testid="practice-primary-action"
                className="w-full min-h-[52px] rounded-xl bg-shPrimary text-[#071018] font-black text-[17px] inline-flex items-center justify-center gap-2 hover:brightness-110 transition shadow-[0_10px_30px_-12px_rgba(140,198,63,0.8)]">
          {action.label}<i className="fas fa-arrow-right text-[14px]" />
        </button>
      )}

      <PracticeGroup testid="practice-group-overdue" title="Overdue" state="overdue" items={b.overdue}
                     hint="Catching up matters more than doing it perfectly." onOpen={onOpenPractice} />
      <PracticeGroup testid="practice-group-due" title="Due today" state="due" items={b.due}
                     onOpen={onOpenPractice} />
      <PracticeGroup testid="practice-group-recommended" title="Recommended next" state="recommended" items={b.recommended}
                     onOpen={onOpenPractice} />
      <PracticeGroup testid="practice-group-upcoming" title="Also assigned" state="open" items={b.upcoming}
                     onOpen={onOpenPractice} />

      {b.completed.length > 0 && (
        <section data-testid="practice-group-completed" className="space-y-2.5">
          <p className="text-[12px] font-black uppercase tracking-[0.18em] text-shTextMuted">Recently completed</p>
          {b.completed.map(hw => (
            <PracticeAssignmentCard key={hw.id} hw={hw} state="completed" />
          ))}
        </section>
      )}

      {all.length === 0 && !practiceIsNext && (
        <EmptyState icon="fa-paw" accent="lime" title="No practice assigned yet"
                    message="Your trainer assigns practice as you move through the course."
                    testid="practice-empty" />
      )}
    </div>
  );
}
