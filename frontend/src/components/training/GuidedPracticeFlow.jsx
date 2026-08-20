// Guided Practice local UI state. Reducer/network boundaries are unchanged;
// this pass only gives the interaction the same premium Online School shell.
import { useReducer } from "react";
import PremiumButton from "../premium/PremiumButton";
import {
  initGuidedState, guidedPracticeReducer, sessionMetricsFromGuidedState, renderPracticeCoachText,
  troubleshootingForState, guidedSessionProgress,
} from "../../lib/practiceCoachPolish";

/* The authored tip that fits what is happening RIGHT NOW, shown in place
   rather than behind a drawer nobody opens with a dog on the leash. Every word
   comes from the recipe's own troubleshooting entry. */
function ReactiveTip({ item, tokens, onOpenTroubleshooting, testid }) {
  if (!item) return null;
  return (
    <section className="rounded-2xl border border-shAccent/35 bg-shAccent/[0.06] p-4" data-testid={testid} data-trigger={item.trigger || ""}>
      <p className="text-[9px] font-black uppercase tracking-[0.16em] text-shAccent">
        <i className="fas fa-lightbulb mr-1.5" />Try this
      </p>
      <p className="text-[14px] font-black text-shText mt-1.5 leading-snug">{renderPracticeCoachText(item.title, tokens)}</p>
      <ul className="mt-2.5 space-y-1.5">
        {(item.actions || []).slice(0, 3).map((a, i) => (
          <li key={i} className="flex gap-2.5 text-[12.5px] text-shTextMuted leading-relaxed">
            <i className="fas fa-arrow-right text-shAccent text-[8px] mt-1.5 shrink-0" />
            <span>{renderPracticeCoachText(a, tokens)}</span>
          </li>
        ))}
      </ul>
      {onOpenTroubleshooting && (
        <button type="button" onClick={onOpenTroubleshooting} data-testid={testid ? `${testid}-more` : undefined}
                className="mt-3 text-[11px] font-black text-shSecondary underline underline-offset-2">
          More troubleshooting
        </button>
      )}
    </section>
  );
}

export default function GuidedPracticeFlow({ practiceCoach, tokens, onOpenTroubleshooting, onFinish, testid }) {
  const gp = practiceCoach?.guided_practice || {};
  const [state, dispatch] = useReducer(
    (s, action) => guidedPracticeReducer(s, action, practiceCoach),
    practiceCoach,
    initGuidedState,
  );

  const record = (outcome) => dispatch({ type: "RECORD_OUTCOME", outcome });
  const roundPct = state.repsPerRound ? Math.min(100, ((Math.min(state.repIndex, state.repsPerRound) / state.repsPerRound) * 100)) : 0;
  const tip = troubleshootingForState(practiceCoach, state);
  const session = guidedSessionProgress(state);
  const schedule = practiceCoach?.schedule || {};

  return (
    <div className="space-y-4 sm:space-y-5" data-testid={testid}>
      <div className="rounded-2xl border border-shSecondary/25 bg-gradient-to-br from-shSecondary/[0.07] via-black/15 to-black/25 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.16em] text-shSecondary">Guided Practice</p>
            <p className="text-[15px] sm:text-[17px] font-black text-shText mt-1" data-testid={testid ? `${testid}-round` : undefined}>Round {state.roundIndex + 1} of {state.roundsPerDay}</p>
          </div>
          <div className="text-right">
            <p className="text-[9px] font-black uppercase tracking-[0.14em] text-shTextMuted">Current rep</p>
            <p className="text-[14px] font-black text-shText mt-1" data-testid={testid ? `${testid}-rep` : undefined}>{Math.min(state.repIndex + 1, state.repsPerRound)} / {state.repsPerRound}</p>
          </div>
        </div>
        <div className="h-2 rounded-full bg-white/[0.055] overflow-hidden mt-4"><div className="h-full rounded-full bg-gradient-to-r from-shSecondary to-shPrimary transition-all" style={{ width: `${roundPct}%` }}/></div>
        {/* Progress through the WHOLE session, not just this round — "rep 3 of
            8" alone doesn't tell the client how much is left today. */}
        <p className="text-[10px] text-shTextMuted mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1" data-testid={testid ? `${testid}-session-progress` : undefined}>
          <span className="font-black text-shTextMuted">{session.done} of {session.total} reps today</span>
          {schedule.minutes_per_round ? <span>· about {schedule.minutes_per_round} min a round</span> : null}
          {schedule.target_response_seconds ? <span>· give {schedule.target_response_seconds}s to respond</span> : null}
        </p>
      </div>

      {state.phase === "active" && !state.lastOutcome && (
        <section className="rounded-3xl border border-shPrimary/30 bg-gradient-to-br from-shPrimary/[0.07] via-black/15 to-black/30 p-5 sm:p-7 text-center shadow-[0_18px_55px_-38px_rgba(140,198,63,0.8)]">
          <div className="w-24 h-24 sm:w-28 sm:h-28 mx-auto rounded-full border border-shPrimary/40 bg-shPrimary/[0.065] shadow-[0_0_40px_rgba(140,198,63,0.08)] grid place-items-center">
            <div><p className="text-[9px] font-black uppercase tracking-[0.14em] text-shPrimary/80">Rep</p><span className="text-[36px] sm:text-[42px] leading-none font-black text-white">{state.repIndex + 1}</span></div>
          </div>
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-shPrimary mt-5">Ready</p>
          {gp.ready_instruction && <p className="text-[12px] sm:text-[13px] text-shTextMuted mt-2 max-w-lg mx-auto leading-relaxed">{renderPracticeCoachText(gp.ready_instruction, tokens)}</p>}
          <p className="text-[19px] sm:text-[23px] font-black text-shText mt-3 leading-snug">{renderPracticeCoachText(gp.cue_prompt, tokens)}</p>
          <div className="grid grid-cols-2 gap-3 mt-6">
            <button type="button" onClick={() => record("success")} data-testid={testid ? `${testid}-success` : undefined}
                    className="min-h-[64px] sm:min-h-[70px] rounded-2xl bg-shPrimary/14 text-shPrimary border border-shPrimary/55 font-black text-[13px] sm:text-[14px] uppercase tracking-[0.1em] hover:bg-shPrimary/20 active:scale-[0.98] transition">
              <i className="fas fa-check mr-2"/>{gp.success_button_label || "CLEAN REP"}
            </button>
            <button type="button" onClick={() => record("miss")} data-testid={testid ? `${testid}-miss` : undefined}
                    className="min-h-[64px] sm:min-h-[70px] rounded-2xl bg-shDanger/[0.07] text-shDanger border border-shDanger/45 font-black text-[13px] sm:text-[14px] uppercase tracking-[0.1em] hover:bg-shDanger/10 active:scale-[0.98] transition">
              <i className="fas fa-xmark mr-2"/>{gp.miss_button_label || "NEEDS RESET"}
            </button>
          </div>
        </section>
      )}

      {state.phase === "active" && state.lastOutcome && (
        <section className={`rounded-3xl border p-6 sm:p-7 text-center ${state.lastOutcome === "success" ? "border-shPrimary/30 bg-shPrimary/[0.06]" : "border-shDanger/30 bg-shDanger/[0.05]"}`}>
          <div className={`w-14 h-14 rounded-2xl mx-auto grid place-items-center border ${state.lastOutcome === "success" ? "bg-shPrimary/10 border-shPrimary/30 text-shPrimary" : "bg-shDanger/10 border-shDanger/30 text-shDanger"}`}><i className={`fas ${state.lastOutcome === "success" ? "fa-check" : "fa-rotate-left"} text-[18px]`}/></div>
          <p className={`text-[16px] sm:text-[18px] font-black mt-4 ${state.lastOutcome === "success" ? "text-shPrimary" : "text-shDanger"}`} data-testid={testid ? `${testid}-outcome-message` : undefined}>
            {renderPracticeCoachText(state.lastOutcome === "success" ? gp.success_message : gp.miss_message, tokens)}
          </p>
          <PremiumButton onClick={() => dispatch({ type: "ACK_OUTCOME" })} data-testid={testid ? `${testid}-next-rep` : undefined} className="mt-5 justify-center min-h-[48px] sm:min-w-[180px]">Next Step <i className="fas fa-arrow-right text-[10px]"/></PremiumButton>
        </section>
      )}

      {/* Reactive coaching: the recipe's own advice, surfaced the moment the
          state it was written for actually happens. */}
      {state.phase === "active" && (
        <ReactiveTip item={tip} tokens={tokens} onOpenTroubleshooting={onOpenTroubleshooting}
                     testid={testid ? `${testid}-reactive-tip` : undefined} />
      )}

      {state.phase === "resting" && (
        <section className="rounded-3xl border border-shSecondary/30 bg-shSecondary/[0.06] p-6 sm:p-7 text-center">
          <div className="w-14 h-14 rounded-2xl bg-shSecondary/10 border border-shSecondary/30 grid place-items-center mx-auto"><i className="fas fa-mug-hot text-shSecondary text-[18px]"/></div>
          <p className="text-[17px] font-black text-shText mt-4">Take a short break</p>
          <p className="text-[12px] text-shTextMuted mt-1">Give both of you a reset before the next round.</p>
          <PremiumButton onClick={() => dispatch({ type: "CONTINUE_AFTER_REST" })} data-testid={testid ? `${testid}-continue-after-rest` : undefined} className="mt-5 justify-center min-h-[48px]">Continue</PremiumButton>
        </section>
      )}

      {state.phase === "stopped" && (
        <section className="rounded-3xl border border-shAccent/30 bg-shAccent/[0.06] p-5 sm:p-6 text-center">
          <div className="w-14 h-14 rounded-2xl bg-shAccent/10 border border-shAccent/30 grid place-items-center mx-auto"><i className="fas fa-hand text-shAccent text-[18px]"/></div>
          <p className="text-[17px] font-black text-shText mt-4">Let&apos;s pause here</p>
          {state.stopMessage && <p className="text-[12px] sm:text-[13px] text-shTextMuted mt-2 max-w-lg mx-auto leading-relaxed">{renderPracticeCoachText(state.stopMessage, tokens)}</p>}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2.5 mt-5">
            <PremiumButton variant="secondary" onClick={() => dispatch({ type: "RESUME_AFTER_STOP" })} data-testid={testid ? `${testid}-resume` : undefined} className="justify-center min-h-[48px]">Try Again</PremiumButton>
            <PremiumButton onClick={() => onFinish(sessionMetricsFromGuidedState(state))} data-testid={testid ? `${testid}-finish-from-stop` : undefined} className="justify-center min-h-[48px]">Finish for Now</PremiumButton>
          </div>
        </section>
      )}

      {state.phase === "round_summary" && (
        <section className="rounded-3xl border border-shBorder/55 bg-black/15 p-5 sm:p-6 text-center">
          <div className="w-14 h-14 rounded-2xl bg-shPrimary/10 border border-shPrimary/30 grid place-items-center mx-auto"><i className="fas fa-star text-shPrimary text-[18px]"/></div>
          <p className="text-[17px] font-black text-shText mt-4">Round {state.roundIndex + 1} done</p>
          <p className="text-[13px] text-shTextMuted mt-1">{state.successesThisRound} of {state.repsPerRound} successful reps</p>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2.5 mt-5">
            <PremiumButton variant="secondary" onClick={() => onFinish(sessionMetricsFromGuidedState(state))} data-testid={testid ? `${testid}-finish-for-now` : undefined} className="justify-center min-h-[48px]">Finish for Now</PremiumButton>
            {state.roundIndex + 1 < state.roundsPerDay && <PremiumButton onClick={() => dispatch({ type: "NEXT_ROUND" })} data-testid={testid ? `${testid}-next-round` : undefined} className="justify-center min-h-[48px]">Next Round <i className="fas fa-arrow-right text-[10px]"/></PremiumButton>}
          </div>
        </section>
      )}

      {state.phase === "finished" && (
        <section className="rounded-3xl border border-shPrimary/35 bg-gradient-to-br from-shPrimary/[0.09] via-black/15 to-black/25 p-6 sm:p-7 text-center">
          <div className="w-16 h-16 rounded-2xl bg-shPrimary/12 border border-shPrimary/35 grid place-items-center mx-auto"><i className="fas fa-trophy text-shPrimary text-[21px]"/></div>
          <p className="text-[20px] font-black text-white mt-4">Great job today!</p>
          <p className="text-[12px] text-shTextMuted mt-1">Wrap up the session and log how it went.</p>
          <PremiumButton onClick={() => onFinish(sessionMetricsFromGuidedState(state))} data-testid={testid ? `${testid}-wrap-up` : undefined} className="mt-5 justify-center min-h-[48px] sm:min-w-[180px]">Continue</PremiumButton>
        </section>
      )}

      {/* One escape hatch, not two. These were previously two buttons side by
          side calling the same handler, which cost thumb space and taught the
          client nothing about the difference. */}
      {state.phase !== "finished" && onOpenTroubleshooting && (
        <button type="button" onClick={onOpenTroubleshooting} data-testid={testid ? `${testid}-im-stuck` : undefined}
                className="w-full min-h-[48px] rounded-xl bg-black/10 border border-shBorder/55 text-shTextMuted px-3 py-2 text-[11px] font-black hover:text-shSecondary hover:border-shSecondary/30 transition">
          <i className="fas fa-life-ring mr-1.5"/>I&apos;m stuck &mdash; what now?
        </button>
      )}
    </div>
  );
}
