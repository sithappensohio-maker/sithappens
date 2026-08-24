// Guided Practice local UI state. Reducer/network boundaries are unchanged;
// this component turns the authored Practice Recipe into live, beginner-safe
// coaching while the client is actually working with the dog.
import { useReducer } from "react";
import PremiumButton from "../premium/PremiumButton";
import {
  initGuidedState, guidedPracticeReducer, sessionMetricsFromGuidedState, renderPracticeCoachText,
  troubleshootingForState, guidedSessionProgress,
} from "../../lib/practiceCoachPolish";

function ReactiveTip({ item, tokens, onOpenTroubleshooting, testid }) {
  if (!item) return null;
  return (
    <section className="rounded-2xl border border-shAccent/35 bg-shAccent/[0.06] p-4" data-testid={testid} data-trigger={item.trigger || ""}>
      <p className="text-[9px] font-black uppercase tracking-[0.16em] text-shAccent"><i className="fas fa-lightbulb mr-1.5" />Try this</p>
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
                className="mt-3 text-[11px] font-black text-shSecondary underline underline-offset-2">More troubleshooting</button>
      )}
    </section>
  );
}

function TextSequence({ title, items, explanation, fallback, tokens, tone = "good" }) {
  const rows = (items || []).filter(Boolean);
  const hasAnything = rows.length > 0 || explanation || fallback;
  if (!hasAnything) return null;
  const good = tone === "good";
  return (
    <div className={`rounded-2xl border p-3.5 sm:p-4 ${good ? "border-shPrimary/25 bg-shPrimary/[0.045]" : "border-shDanger/25 bg-shDanger/[0.035]"}`}>
      <p className={`text-[9px] font-black uppercase tracking-[0.16em] ${good ? "text-shPrimary" : "text-shDanger"}`}>
        <i className={`fas ${good ? "fa-circle-check" : "fa-rotate-left"} mr-1.5`} />{title}
      </p>
      {rows.length > 0 && (
        <ul className="mt-2.5 space-y-1.5">
          {rows.slice(0, 5).map((row, i) => (
            <li key={i} className="flex gap-2 text-[12px] sm:text-[12.5px] text-shText leading-relaxed">
              <span className={`font-black shrink-0 ${good ? "text-shPrimary" : "text-shDanger"}`}>{i + 1}.</span>
              <span>{renderPracticeCoachText(row, tokens)}</span>
            </li>
          ))}
        </ul>
      )}
      {(explanation || fallback) && <p className="text-[11.5px] sm:text-[12px] text-shTextMuted mt-2 leading-relaxed">{renderPracticeCoachText(explanation || fallback, tokens)}</p>}
    </div>
  );
}

export function roundCoachDecision(successes, total) {
  const safeTotal = Math.max(1, Number(total) || 1);
  const rate = Math.round(((Number(successes) || 0) / safeTotal) * 100);
  if (rate >= 80) return {
    rate,
    title: "Keep this difficulty",
    body: "That round was successful enough to repeat. Keep the setup the same and aim for the same clean response.",
  };
  if (rate >= 50) return {
    rate,
    title: "Stay here and clean it up",
    body: "Do not make it harder yet. Keep the same setup and focus on cleaner, more consistent reps.",
  };
  return {
    rate,
    title: "Make the next round easier",
    body: "Reduce one thing — distance, distraction, duration, or difficulty — so your dog can succeed more often.",
  };
}

function LiveRecipeGuide({ practiceCoach, tokens }) {
  const pc = practiceCoach || {};
  const gp = pc.guided_practice || {};
  const steps = (pc.steps || []).filter((s) => s && (s.title || s.instruction));
  return (
    <div className="space-y-3">
      {(pc.goal || pc.success_today) && (
        <section className="rounded-2xl border border-shSecondary/25 bg-shSecondary/[0.045] p-4 sm:p-5">
          <p className="text-[9px] font-black uppercase tracking-[0.16em] text-shSecondary"><i className="fas fa-bullseye mr-1.5" />Today&apos;s Goal</p>
          {pc.goal && <p className="text-[16px] sm:text-[18px] font-black text-shText mt-1.5 leading-snug">{renderPracticeCoachText(pc.goal, tokens)}</p>}
          {pc.success_today && <p className="text-[12px] sm:text-[13px] text-shTextMuted mt-2 leading-relaxed"><span className="font-black text-shText">Success today: </span>{renderPracticeCoachText(pc.success_today, tokens)}</p>}
        </section>
      )}

      <section className="rounded-2xl border border-shBorder/60 bg-black/15 p-4 sm:p-5">
        <p className="text-[9px] font-black uppercase tracking-[0.16em] text-shPrimary"><i className="fas fa-list-check mr-1.5" />Do This Rep</p>
        {gp.cue_prompt && <p className="text-[18px] sm:text-[21px] font-black text-white mt-1.5 leading-snug">{renderPracticeCoachText(gp.cue_prompt, tokens)}</p>}
        {gp.ready_instruction && <p className="text-[12px] sm:text-[13px] text-shTextMuted mt-2 leading-relaxed">{renderPracticeCoachText(gp.ready_instruction, tokens)}</p>}
        {steps.length > 0 && (
          <ol className="mt-4 space-y-2">
            {steps.slice(0, 6).map((step, i) => (
              <li key={step.id || i} className="flex gap-3 items-start">
                <span className="w-6 h-6 rounded-lg bg-shSecondary/10 border border-shSecondary/25 text-shSecondary text-[10px] font-black grid place-items-center shrink-0">{i + 1}</span>
                <div className="min-w-0">
                  {step.title && <p className="text-[12.5px] font-black text-shText leading-snug">{renderPracticeCoachText(step.title, tokens)}</p>}
                  {step.instruction && <p className="text-[11.5px] sm:text-[12px] text-shTextMuted mt-0.5 leading-relaxed">{renderPracticeCoachText(step.instruction, tokens)}</p>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <TextSequence title="What Counts" items={pc.good_rep?.sequence} explanation={pc.good_rep?.explanation}
                      fallback={pc.success_today} tokens={tokens} tone="good" />
        <TextSequence title="Reset This Rep" items={pc.not_this?.sequence} explanation={pc.not_this?.explanation}
                      fallback={gp.miss_message} tokens={tokens} tone="reset" />
      </div>
    </div>
  );
}

export default function GuidedPracticeFlow({ practiceCoach, tokens, onOpenTroubleshooting, onFinish, testid }) {
  const pc = practiceCoach || {};
  const gp = pc.guided_practice || {};
  const [state, dispatch] = useReducer(
    (s, action) => guidedPracticeReducer(s, action, practiceCoach),
    practiceCoach,
    initGuidedState,
  );

  const record = (outcome) => dispatch({ type: "RECORD_OUTCOME", outcome });
  const roundPct = state.repsPerRound ? Math.min(100, ((Math.min(state.repIndex, state.repsPerRound) / state.repsPerRound) * 100)) : 0;
  const tip = troubleshootingForState(practiceCoach, state);
  const session = guidedSessionProgress(state);
  const schedule = pc.schedule || {};
  const roundDecision = roundCoachDecision(state.successesThisRound, state.repsPerRound);
  const metrics = sessionMetricsFromGuidedState(state);
  const nextOutcomeButton = state.pendingTransition === "round_summary" ? "See Round Result" : state.pendingTransition === "resting" ? "Take Break" : "Next Rep";

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
        <p className="text-[10px] text-shTextMuted mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1" data-testid={testid ? `${testid}-session-progress` : undefined}>
          <span className="font-black text-shTextMuted">{session.done} of {session.total} reps today</span>
          {schedule.minutes_per_round ? <span>· about {schedule.minutes_per_round} min a round</span> : null}
          {schedule.target_response_seconds ? <span>· give {schedule.target_response_seconds}s to respond</span> : null}
        </p>
      </div>

      {state.phase === "active" && !state.lastOutcome && (
        <>
          <LiveRecipeGuide practiceCoach={practiceCoach} tokens={tokens} />
          <section className="rounded-3xl border border-shPrimary/30 bg-gradient-to-br from-shPrimary/[0.07] via-black/15 to-black/30 p-5 sm:p-6 shadow-[0_18px_55px_-38px_rgba(140,198,63,0.8)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[9px] font-black uppercase tracking-[0.16em] text-shPrimary">Rep {state.repIndex + 1} of {state.repsPerRound}</p>
                <p className="text-[15px] sm:text-[17px] font-black text-shText mt-1">Watch your dog, then choose what actually happened.</p>
              </div>
              {schedule.target_response_seconds ? (
                <span className="shrink-0 rounded-xl border border-shSecondary/25 bg-shSecondary/[0.06] px-3 py-2 text-center">
                  <span className="block text-[9px] font-black uppercase tracking-widest text-shTextMuted">Wait up to</span>
                  <span className="block text-[18px] font-black text-shSecondary">{schedule.target_response_seconds}s</span>
                </span>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 mt-5">
              <button type="button" onClick={() => record("success")} data-testid={testid ? `${testid}-success` : undefined}
                      className="min-h-[72px] rounded-2xl bg-shPrimary/14 text-shPrimary border border-shPrimary/55 px-4 py-3 font-black text-[13px] sm:text-[14px] uppercase tracking-[0.08em] hover:bg-shPrimary/20 active:scale-[0.98] transition">
                <i className="fas fa-check mr-2"/>{gp.success_button_label || "YES — THAT COUNTED"}
                <span className="block mt-1 text-[10px] normal-case tracking-normal font-semibold text-shTextMuted">Count this repetition</span>
              </button>
              <button type="button" onClick={() => record("miss")} data-testid={testid ? `${testid}-miss` : undefined}
                      className="min-h-[72px] rounded-2xl bg-shDanger/[0.07] text-shDanger border border-shDanger/45 px-4 py-3 font-black text-[13px] sm:text-[14px] uppercase tracking-[0.08em] hover:bg-shDanger/10 active:scale-[0.98] transition">
                <i className="fas fa-rotate-left mr-2"/>{gp.miss_button_label || "NO — RESET THIS REP"}
                <span className="block mt-1 text-[10px] normal-case tracking-normal font-semibold text-shTextMuted">Do not count this repetition</span>
              </button>
            </div>
          </section>
        </>
      )}

      {state.phase === "active" && state.lastOutcome && (
        <>
          <section className={`rounded-3xl border p-5 sm:p-6 ${state.lastOutcome === "success" ? "border-shPrimary/30 bg-shPrimary/[0.06]" : "border-shDanger/30 bg-shDanger/[0.05]"}`}>
            <div className="flex gap-3 items-start">
              <div className={`w-12 h-12 rounded-2xl grid place-items-center border shrink-0 ${state.lastOutcome === "success" ? "bg-shPrimary/10 border-shPrimary/30 text-shPrimary" : "bg-shDanger/10 border-shDanger/30 text-shDanger"}`}>
                <i className={`fas ${state.lastOutcome === "success" ? "fa-check" : "fa-rotate-left"} text-[16px]`}/>
              </div>
              <div className="min-w-0 flex-1">
                <p className={`text-[9px] font-black uppercase tracking-[0.16em] ${state.lastOutcome === "success" ? "text-shPrimary" : "text-shDanger"}`}>Do This Now</p>
                <p className="text-[16px] sm:text-[18px] font-black text-shText mt-1 leading-snug" data-testid={testid ? `${testid}-outcome-message` : undefined}>
                  {renderPracticeCoachText(state.lastOutcome === "success" ? (gp.success_message || "Good rep. Reward it and reset calmly.") : (gp.miss_message || "Reset calmly and make the next rep easier."), tokens)}
                </p>
                {state.lastOutcome === "success" && pc.good_rep?.explanation && <p className="text-[12px] text-shTextMuted mt-2 leading-relaxed">{renderPracticeCoachText(pc.good_rep.explanation, tokens)}</p>}
                {state.lastOutcome === "miss" && pc.not_this?.explanation && <p className="text-[12px] text-shTextMuted mt-2 leading-relaxed">{renderPracticeCoachText(pc.not_this.explanation, tokens)}</p>}
              </div>
            </div>
            <PremiumButton onClick={() => dispatch({ type: "ACK_OUTCOME" })} data-testid={testid ? `${testid}-next-rep` : undefined} className="mt-5 w-full sm:w-auto justify-center min-h-[50px] sm:min-w-[210px]">
              {nextOutcomeButton} <i className="fas fa-arrow-right text-[10px]"/>
            </PremiumButton>
          </section>
          {state.lastOutcome === "miss" && <ReactiveTip item={tip} tokens={tokens} onOpenTroubleshooting={onOpenTroubleshooting} testid={testid ? `${testid}-reactive-tip` : undefined} />}
        </>
      )}

      {state.phase === "active" && !state.lastOutcome && tip && (
        <ReactiveTip item={tip} tokens={tokens} onOpenTroubleshooting={onOpenTroubleshooting} testid={testid ? `${testid}-reactive-tip` : undefined} />
      )}

      {state.phase === "resting" && (
        <section className="rounded-3xl border border-shSecondary/30 bg-shSecondary/[0.06] p-6 sm:p-7 text-center">
          <div className="w-14 h-14 rounded-2xl bg-shSecondary/10 border border-shSecondary/30 grid place-items-center mx-auto"><i className="fas fa-mug-hot text-shSecondary text-[18px]"/></div>
          <p className="text-[17px] font-black text-shText mt-4">Take a short break</p>
          <p className="text-[12px] text-shTextMuted mt-1">Give both of you a reset before the next repetition.</p>
          {pc.pro_tip && <p className="text-[12px] text-shText mt-3 max-w-lg mx-auto"><span className="font-black text-shPrimary">Remember: </span>{renderPracticeCoachText(pc.pro_tip, tokens)}</p>}
          <PremiumButton onClick={() => dispatch({ type: "CONTINUE_AFTER_REST" })} data-testid={testid ? `${testid}-continue-after-rest` : undefined} className="mt-5 justify-center min-h-[48px]">I&apos;m Ready — Continue</PremiumButton>
        </section>
      )}

      {state.phase === "stopped" && (
        <section className="rounded-3xl border border-shAccent/30 bg-shAccent/[0.06] p-5 sm:p-6 text-center">
          <div className="w-14 h-14 rounded-2xl bg-shAccent/10 border border-shAccent/30 grid place-items-center mx-auto"><i className="fas fa-hand text-shAccent text-[18px]"/></div>
          <p className="text-[17px] font-black text-shText mt-4">Stop this round for a moment</p>
          <p className="text-[12px] sm:text-[13px] text-shTextMuted mt-2 max-w-lg mx-auto leading-relaxed">{renderPracticeCoachText(state.stopMessage || "The last few reps were not working. Make the setup easier before trying again.", tokens)}</p>
          <ReactiveTip item={tip} tokens={tokens} onOpenTroubleshooting={onOpenTroubleshooting} testid={testid ? `${testid}-stopped-tip` : undefined} />
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2.5 mt-5">
            <PremiumButton variant="secondary" onClick={() => dispatch({ type: "RESUME_AFTER_STOP" })} data-testid={testid ? `${testid}-resume` : undefined} className="justify-center min-h-[48px]">Try an Easier Rep</PremiumButton>
            <PremiumButton onClick={() => onFinish(sessionMetricsFromGuidedState(state))} data-testid={testid ? `${testid}-finish-from-stop` : undefined} className="justify-center min-h-[48px]">Finish for Now</PremiumButton>
          </div>
        </section>
      )}

      {state.phase === "round_summary" && (
        <section className="rounded-3xl border border-shBorder/55 bg-black/15 p-5 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-shPrimary/10 border border-shPrimary/30 grid place-items-center shrink-0">
              <span className="text-[20px] font-black text-shPrimary">{roundDecision.rate}%</span>
            </div>
            <div className="min-w-0">
              <p className="text-[9px] font-black uppercase tracking-[0.16em] text-shSecondary">Round {state.roundIndex + 1} Complete</p>
              <p className="text-[18px] font-black text-shText mt-1">{state.successesThisRound} of {state.repsPerRound} clean reps</p>
              <p className="text-[15px] font-black text-shPrimary mt-2">{roundDecision.title}</p>
              <p className="text-[12.5px] text-shTextMuted mt-1 leading-relaxed">{roundDecision.body}</p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 mt-5">
            <PremiumButton variant="secondary" onClick={() => onFinish(sessionMetricsFromGuidedState(state))} data-testid={testid ? `${testid}-finish-for-now` : undefined} className="justify-center min-h-[48px]">Finish for Now</PremiumButton>
            {state.roundIndex + 1 < state.roundsPerDay && <PremiumButton onClick={() => dispatch({ type: "NEXT_ROUND" })} data-testid={testid ? `${testid}-next-round` : undefined} className="justify-center min-h-[48px]">Start Next Round <i className="fas fa-arrow-right text-[10px]"/></PremiumButton>}
          </div>
        </section>
      )}

      {state.phase === "finished" && (
        <section className="rounded-3xl border border-shPrimary/35 bg-gradient-to-br from-shPrimary/[0.09] via-black/15 to-black/25 p-6 sm:p-7">
          <div className="flex flex-col sm:flex-row gap-4 sm:items-center">
            <div className="w-16 h-16 rounded-2xl bg-shPrimary/12 border border-shPrimary/35 grid place-items-center shrink-0"><i className="fas fa-trophy text-shPrimary text-[21px]"/></div>
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.16em] text-shPrimary">Session Complete</p>
              <p className="text-[20px] font-black text-white mt-1">{metrics.successful_reps} of {metrics.reps_attempted} clean reps</p>
              <p className="text-[12.5px] text-shTextMuted mt-1">{metrics.success_rate == null ? "Practice recorded." : `${metrics.success_rate}% success across this guided session.`}</p>
            </div>
          </div>
          {pc.success_today && <p className="mt-4 rounded-xl border border-shBorder/55 bg-black/15 px-4 py-3 text-[12px] text-shTextMuted leading-relaxed"><span className="font-black text-shText">Compare with today&apos;s target: </span>{renderPracticeCoachText(pc.success_today, tokens)}</p>}
          <p className="text-[12px] text-shTextMuted mt-3">Next, tell School how the session felt and add anything your trainer should know.</p>
          <PremiumButton onClick={() => onFinish(metrics)} data-testid={testid ? `${testid}-wrap-up` : undefined} className="mt-5 w-full sm:w-auto justify-center min-h-[50px] sm:min-w-[220px]">Log This Practice <i className="fas fa-arrow-right text-[10px]"/></PremiumButton>
        </section>
      )}

      {state.phase !== "finished" && onOpenTroubleshooting && (
        <button type="button" onClick={onOpenTroubleshooting} data-testid={testid ? `${testid}-im-stuck` : undefined}
                className="w-full min-h-[48px] rounded-xl bg-black/10 border border-shBorder/55 text-shTextMuted px-3 py-2 text-[11px] font-black hover:text-shSecondary hover:border-shSecondary/30 transition">
          <i className="fas fa-life-ring mr-1.5"/>I&apos;m stuck — what now?
        </button>
      )}
    </div>
  );
}
