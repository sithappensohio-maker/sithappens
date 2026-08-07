// Client Practice Coach upgrade — Screen 4, the guided round/rep
// interaction. Local UI state only (useReducer over
// guidedPracticeReducer) — per 01_CLAUDE_IMPLEMENTATION_PROMPT.md's
// "Important persistence boundary", nothing here calls the network. The
// caller receives the final tallies via onFinish(metrics) and folds them
// into whichever existing submit call it already makes.
import { useReducer } from "react";
import {
  initGuidedState, guidedPracticeReducer, sessionMetricsFromGuidedState, renderPracticeCoachText,
} from "../../lib/practiceCoachPolish";

export default function GuidedPracticeFlow({ practiceCoach, tokens, onOpenTroubleshooting, onFinish, testid }) {
  const gp = practiceCoach?.guided_practice || {};
  const [state, dispatch] = useReducer(
    (s, action) => guidedPracticeReducer(s, action, practiceCoach),
    practiceCoach,
    initGuidedState,
  );

  const record = (outcome) => dispatch({ type: "RECORD_OUTCOME", outcome });

  return (
    <div className="space-y-4" data-testid={testid}>
      <div className="flex items-center justify-between text-[11px] font-black uppercase tracking-widest text-shTextMuted">
        <span data-testid={testid ? `${testid}-round` : undefined}>Round {state.roundIndex + 1} of {state.roundsPerDay}</span>
        <span data-testid={testid ? `${testid}-rep` : undefined}>Rep {Math.min(state.repIndex + 1, state.repsPerRound)} of {state.repsPerRound}</span>
      </div>

      {state.phase === "active" && !state.lastOutcome && (
        <div className="space-y-3 text-center">
          <div className="w-20 h-20 mx-auto rounded-full border-4 border-shPrimary/40 flex items-center justify-center">
            <span className="text-[26px] font-black text-shText">{state.repIndex + 1}</span>
          </div>
          <p className="text-[11px] font-black uppercase tracking-widest text-shPrimary">Ready</p>
          <p className="text-[13px] text-shTextMuted">{renderPracticeCoachText(gp.ready_instruction, tokens)}</p>
          <p className="text-[16px] font-black text-shText">{renderPracticeCoachText(gp.cue_prompt, tokens)}</p>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button type="button" onClick={() => record("success")} data-testid={testid ? `${testid}-success` : undefined}
                    className="bg-shPrimary/15 text-shPrimary border border-shPrimary rounded-lg py-3 font-black text-[13px] uppercase tracking-widest">
              <i className="fas fa-check mr-1.5"/>{gp.success_button_label || "SUCCESS"}
            </button>
            <button type="button" onClick={() => record("miss")} data-testid={testid ? `${testid}-miss` : undefined}
                    className="bg-shDanger/10 text-shDanger border border-shDanger/60 rounded-lg py-3 font-black text-[13px] uppercase tracking-widest">
              <i className="fas fa-xmark mr-1.5"/>{gp.miss_button_label || "MISS"}
            </button>
          </div>
        </div>
      )}

      {state.phase === "active" && state.lastOutcome && (
        <div className="space-y-3 text-center">
          <p className={`text-[14px] font-bold ${state.lastOutcome === "success" ? "text-shPrimary" : "text-shDanger"}`}
             data-testid={testid ? `${testid}-outcome-message` : undefined}>
            {renderPracticeCoachText(state.lastOutcome === "success" ? gp.success_message : gp.miss_message, tokens)}
          </p>
          <button type="button" onClick={() => dispatch({ type: "ACK_OUTCOME" })} data-testid={testid ? `${testid}-next-rep` : undefined}
                  className="bg-shPrimary text-bgHeader rounded-lg px-5 py-2.5 font-black text-[13px] uppercase tracking-widest">
            Next Rep
          </button>
        </div>
      )}

      {state.phase === "resting" && (
        <div className="space-y-3 text-center bg-shSecondary/10 border border-shSecondary/30 rounded-lg p-4">
          <i className="fas fa-mug-hot text-shSecondary text-[22px]"/>
          <p className="text-[13px] font-black text-shText">Take a short break</p>
          <button type="button" onClick={() => dispatch({ type: "CONTINUE_AFTER_REST" })} data-testid={testid ? `${testid}-continue-after-rest` : undefined}
                  className="bg-shSecondary text-bgHeader rounded-lg px-5 py-2.5 font-black text-[13px] uppercase tracking-widest">
            Continue
          </button>
        </div>
      )}

      {state.phase === "stopped" && (
        <div className="space-y-3 text-center bg-shAccent/10 border border-shAccent/30 rounded-lg p-4">
          <i className="fas fa-hand text-shAccent text-[22px]"/>
          <p className="text-[13px] font-black text-shText">Let&apos;s pause here</p>
          {state.stopMessage && <p className="text-[12px] text-shTextMuted">{renderPracticeCoachText(state.stopMessage, tokens)}</p>}
          <div className="flex items-center justify-center gap-2">
            <button type="button" onClick={() => dispatch({ type: "RESUME_AFTER_STOP" })} data-testid={testid ? `${testid}-resume` : undefined}
                    className="bg-black/20 border border-shBorder text-shText rounded-lg px-4 py-2.5 font-black text-[12px] uppercase tracking-widest">
              Try Again
            </button>
            <button type="button" onClick={() => onFinish(sessionMetricsFromGuidedState(state))} data-testid={testid ? `${testid}-finish-from-stop` : undefined}
                    className="bg-shPrimary text-bgHeader rounded-lg px-4 py-2.5 font-black text-[12px] uppercase tracking-widest">
              Finish for Now
            </button>
          </div>
        </div>
      )}

      {state.phase === "round_summary" && (
        <div className="space-y-3 text-center bg-black/20 border border-shBorder rounded-lg p-4">
          <i className="fas fa-star text-shPrimary text-[22px]"/>
          <p className="text-[13px] font-black text-shText">
            Round {state.roundIndex + 1} done — {state.successesThisRound} of {state.repsPerRound}
          </p>
          <div className="flex items-center justify-center gap-2">
            <button type="button" onClick={() => onFinish(sessionMetricsFromGuidedState(state))} data-testid={testid ? `${testid}-finish-for-now` : undefined}
                    className="bg-black/20 border border-shBorder text-shText rounded-lg px-4 py-2.5 font-black text-[12px] uppercase tracking-widest">
              Finish for Now
            </button>
            {state.roundIndex + 1 < state.roundsPerDay && (
              <button type="button" onClick={() => dispatch({ type: "NEXT_ROUND" })} data-testid={testid ? `${testid}-next-round` : undefined}
                      className="bg-shPrimary text-bgHeader rounded-lg px-4 py-2.5 font-black text-[12px] uppercase tracking-widest">
                Next Round
              </button>
            )}
          </div>
        </div>
      )}

      {state.phase === "finished" && (
        <div className="space-y-2 text-center bg-shPrimary/10 border border-shPrimary/30 rounded-lg p-4">
          <i className="fas fa-trophy text-shPrimary text-[22px]"/>
          <p className="text-[13px] font-black text-shText">Great job today!</p>
          <button type="button" onClick={() => onFinish(sessionMetricsFromGuidedState(state))} data-testid={testid ? `${testid}-wrap-up` : undefined}
                  className="bg-shPrimary text-bgHeader rounded-lg px-5 py-2.5 font-black text-[13px] uppercase tracking-widest">
            Continue
          </button>
        </div>
      )}

      {state.phase !== "finished" && (
        <div className="flex items-center gap-2">
          {onOpenTroubleshooting && (
            <button type="button" onClick={onOpenTroubleshooting} data-testid={testid ? `${testid}-troubleshooting` : undefined}
                    className="flex-1 bg-black/20 border border-shBorder text-shTextMuted rounded-lg py-2 text-[11px] font-black uppercase tracking-widest">
              <i className="fas fa-circle-question mr-1"/>Troubleshooting
            </button>
          )}
          {onOpenTroubleshooting && (
            <button type="button" onClick={onOpenTroubleshooting} data-testid={testid ? `${testid}-im-stuck` : undefined}
                    className="flex-1 bg-black/20 border border-shBorder text-shTextMuted rounded-lg py-2 text-[11px] font-black uppercase tracking-widest">
              <i className="fas fa-life-ring mr-1"/>I&apos;m Stuck
            </button>
          )}
        </div>
      )}
    </div>
  );
}
