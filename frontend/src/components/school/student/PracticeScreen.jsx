import { PracticeCard } from "./today/TodayCards";
import EmptyState from "../../training/EmptyState";

/* Practice — the fourth primary destination.
 *
 * Phase 2 introduces the screen so the five-item navigation has a real home
 * for Practice instead of it being reachable only as a modal from Today. The
 * Practice COACH itself (the in-session experience) is untouched and is
 * redesigned in a later phase; opening an assignment still hands off to the
 * existing canonical Practice engine.
 *
 * All data comes from the existing home view-model's active_practice — no new
 * endpoint, no second Practice store.
 */
export default function PracticeScreen({ home, loading, onOpenPractice, onPrimaryAction }) {
  if (loading && !home) {
    return (
      <div className="space-y-3" data-testid="practice-screen-loading">
        <div className="h-8 w-40 rounded bg-shBorder/40 animate-pulse" />
        <div className="h-24 rounded-2xl bg-shBorder/25 animate-pulse" />
        <div className="h-24 rounded-2xl bg-shBorder/20 animate-pulse" />
      </div>
    );
  }
  if (!home) return null;

  const all = home.active_practice || [];
  const open = all.filter(p => p && p.status !== "completed");
  const done = all.filter(p => p && p.status === "completed");
  const practiceIsNext = home.current_action?.type === "practice";

  return (
    <div className="space-y-4" data-testid="practice-screen">
      <header>
        <h1 className="text-shText font-black text-[22px] sm:text-[26px] leading-tight">Practice</h1>
        <p className="text-[13px] text-shTextMuted mt-0.5">
          {open.length > 0
            ? `Short reps between lessons are what make it stick${home.dog?.name ? ` for ${home.dog.name}` : ""}.`
            : "Nothing outstanding right now — your next lesson will assign more when it's time."}
        </p>
      </header>

      {/* When the server says practice IS the next best action, offer it here
          too so the client never has to go back to Today to start. */}
      {practiceIsNext && home.current_action?.label && (
        <button type="button" onClick={onPrimaryAction} data-testid="practice-primary-action"
                className="w-full min-h-[50px] rounded-xl bg-shPrimary text-[#071018] font-black text-[14px] inline-flex items-center justify-center gap-2 hover:brightness-110 transition">
          {home.current_action.label}<i className="fas fa-arrow-right text-[11px]" />
        </button>
      )}

      {open.length === 0 ? (
        <PracticeCard practice={[]} />
      ) : (
        <section className="space-y-3" data-testid="practice-open-list">
          {open.map(hw => (
            <PracticeCard key={hw.id} practice={[hw]} onOpen={onOpenPractice} />
          ))}
        </section>
      )}

      {done.length > 0 && (
        <section data-testid="practice-completed-list">
          <p className="text-[9.5px] font-black uppercase tracking-[0.18em] text-shTextMuted mb-2">Completed</p>
          <div className="space-y-2">
            {done.map(hw => (
              <div key={hw.id} className="rounded-xl border border-shBorder/40 bg-black/10 p-3 flex items-center gap-3">
                <span className="w-8 h-8 rounded-lg grid place-items-center shrink-0 bg-shPrimary/10 border border-shPrimary/25 text-shPrimary">
                  <i className="fas fa-check text-[11px]" />
                </span>
                <p className="text-[13px] font-black text-shText truncate min-w-0 flex-1">{hw.title || "Practice"}</p>
              </div>
            ))}
          </div>
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
