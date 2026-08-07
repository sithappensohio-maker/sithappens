// Client Practice Coach upgrade — Screens 2-3 of the approved client flow
// (03_CLIENT_FLOW.md): practice time / Quick Practice / Today's Goal /
// Success Today / Encouragement / Before You Start / Pro Tip / How It
// Works steps / Good Rep-Not This / troubleshooting quick link / Start
// Guided Practice. Renders entirely from practice_coach — no
// exercise-specific content of its own.
import { useState } from "react";
import SetupChecklist from "./SetupChecklist";
import GoodRepNotThisCards from "./GoodRepNotThisCards";
import { renderPracticeCoachText, practiceTimeLabel } from "../../lib/practiceCoachPolish";

function StepRow({ step, index, tokens, testid }) {
  const [open, setOpen] = useState(false);
  const hasDetail = !!step.media_url;
  return (
    <div className="bg-black/20 border border-shBorder rounded-lg" data-testid={testid}>
      <button type="button" onClick={() => hasDetail && setOpen(o => !o)}
              className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left">
        <span className="w-5 h-5 rounded-full bg-shSecondary/20 text-shSecondary text-[11px] font-black flex items-center justify-center shrink-0 mt-0.5">
          {index + 1}
        </span>
        <span className="min-w-0 flex-1">
          <p className="text-[12px] font-black text-shText">{renderPracticeCoachText(step.title, tokens)}</p>
          <p className="text-[11px] text-shTextMuted">{renderPracticeCoachText(step.instruction, tokens)}</p>
        </span>
        {hasDetail && <i className={`fas fa-chevron-${open ? "up" : "down"} text-shTextMuted text-[10px] mt-1 shrink-0`}/>}
      </button>
      {open && hasDetail && (
        <div className="px-3 pb-3">
          <img src={step.media_url} alt="" className="w-full rounded-md border border-shBorder/60"/>
        </div>
      )}
    </div>
  );
}

export default function CoachPracticeOverview({
  practiceCoach, tokens, dogPhoto, onStartGuided, onQuickPractice, onOpenTroubleshooting, testid,
}) {
  const pc = practiceCoach || {};
  return (
    <div className="space-y-4" data-testid={testid}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-shTextMuted text-[11px] font-bold" data-testid={testid ? `${testid}-time` : undefined}>
          <i className="fas fa-clock"/>{practiceTimeLabel(pc.schedule) || "Today's practice"}
        </div>
        {onQuickPractice && (
          <button type="button" onClick={onQuickPractice} data-testid={testid ? `${testid}-quick-practice` : undefined}
                  className="flex items-center gap-1.5 bg-shSecondary/15 text-shSecondary border border-shSecondary/40 rounded-lg px-2.5 py-1.5 text-[11px] font-black uppercase tracking-widest">
            <i className="fas fa-bolt"/>Quick Practice
          </button>
        )}
      </div>

      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-[10px] font-black uppercase tracking-widest text-shPrimary flex items-center gap-1.5">
            <i className="fas fa-bullseye"/>Today&apos;s Goal
          </p>
          <p className="text-[16px] font-black text-shText leading-snug">{renderPracticeCoachText(pc.goal, tokens)}</p>
          {pc.success_today && (
            <p className="text-[12px] text-shTextMuted">
              <span className="font-black text-shText">Success today = </span>{renderPracticeCoachText(pc.success_today, tokens)}
            </p>
          )}
          {pc.encouragement && <p className="text-[11px] text-shTextMuted italic">{renderPracticeCoachText(pc.encouragement, tokens)}</p>}
        </div>
        {dogPhoto && <img src={dogPhoto} alt="" className="w-16 h-16 rounded-lg object-cover border border-shBorder shrink-0"/>}
      </div>

      {(pc.setup_items || []).length > 0 && (
        <div>
          <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted mb-1.5">Before You Start</p>
          <SetupChecklist items={pc.setup_items} tokens={tokens} testid={testid ? `${testid}-setup` : undefined}/>
        </div>
      )}

      {pc.pro_tip && (
        <div className="bg-shPrimary/10 border border-shPrimary/30 rounded-lg p-2.5 flex items-start gap-2">
          <i className="fas fa-lightbulb text-shPrimary text-[13px] mt-0.5 shrink-0"/>
          <p className="text-[12px] text-shText"><span className="font-black">Pro tip: </span>{renderPracticeCoachText(pc.pro_tip, tokens)}</p>
        </div>
      )}

      {(pc.steps || []).length > 0 && (
        <div>
          <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted mb-1.5">How It Works</p>
          <div className="space-y-1.5">
            {pc.steps.map((step, i) => (
              <StepRow key={step.id} step={step} index={i} tokens={tokens} testid={testid ? `${testid}-step-${step.id}` : undefined}/>
            ))}
          </div>
        </div>
      )}

      <GoodRepNotThisCards goodRep={pc.good_rep} notThis={pc.not_this} tokens={tokens} testid={testid ? `${testid}-examples` : undefined}/>

      {onOpenTroubleshooting && (pc.troubleshooting || []).length > 0 && (
        <button type="button" onClick={onOpenTroubleshooting} data-testid={testid ? `${testid}-troubleshooting-link` : undefined}
                className="w-full text-left bg-black/20 border border-shBorder rounded-lg px-3 py-2.5 text-[12px] font-bold text-shSecondary flex items-center justify-between">
          What if {renderPracticeCoachText("{{dog_name}}", tokens) || "your dog"} doesn&apos;t...?
          <i className="fas fa-chevron-right text-[10px]"/>
        </button>
      )}

      {onStartGuided && (
        <button type="button" onClick={onStartGuided} data-testid={testid ? `${testid}-start-guided` : undefined}
                className="w-full bg-shPrimary text-bgHeader rounded-lg py-3 font-black text-[13px] uppercase tracking-widest shadow">
          <i className="fas fa-play mr-1.5"/>Start Guided Practice
        </button>
      )}
    </div>
  );
}
