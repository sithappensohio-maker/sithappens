// Client Practice Coach overview. All behavior/data remains driven by the
// authored practice_coach object; only presentation changed.
import { useState } from "react";
import SetupChecklist from "./SetupChecklist";
import GoodRepNotThisCards from "./GoodRepNotThisCards";
import HuskyDogImage from "../brand/HuskyDogImage";
import PremiumButton from "../premium/PremiumButton";
import SectionCard from "../premium/SectionCard";
import { renderPracticeCoachText, practiceTimeLabel } from "../../lib/practiceCoachPolish";

function StepRow({ step, index, tokens, testid }) {
  const [open, setOpen] = useState(false);
  const hasDetail = !!step.media_url;
  return (
    <div className="rounded-2xl border border-shBorder/50 bg-black/12 overflow-hidden" data-testid={testid}>
      <button type="button" onClick={() => hasDetail && setOpen(o => !o)}
              className="w-full flex items-start gap-3 px-3.5 py-3.5 sm:px-4 text-left hover:bg-white/[0.02] transition">
        <span className="w-8 h-8 rounded-xl bg-shSecondary/12 border border-shSecondary/30 text-shSecondary text-[15px] font-black grid place-items-center shrink-0">
          {index + 1}
        </span>
        <span className="min-w-0 flex-1">
          <p className="text-[18px] sm:text-[19px] font-black text-shText leading-tight">{renderPracticeCoachText(step.title, tokens)}</p>
          <p className="text-[17px] text-shTextMuted leading-relaxed mt-1">{renderPracticeCoachText(step.instruction, tokens)}</p>
        </span>
        {hasDetail && <i className={`fas fa-chevron-${open ? "up" : "down"} text-shTextMuted text-[13px] mt-2 shrink-0`}/>} 
      </button>
      {open && hasDetail && (
        <div className="px-3.5 pb-3.5 sm:px-4 sm:pb-4">
          <img src={step.media_url} alt="" className="w-full rounded-xl border border-shBorder/50"/>
        </div>
      )}
    </div>
  );
}

export default function CoachPracticeOverview({
  practiceCoach, tokens, dogPhoto, onStartGuided, onQuickPractice, onOpenTroubleshooting, testid,
}) {
  const pc = practiceCoach || {};
  const dogName = tokens?.dog_name || "Your dog";
  return (
    <div className="space-y-4 sm:space-y-5" data-testid={testid}>
      <section className="relative overflow-hidden rounded-3xl border border-shSecondary/30 bg-gradient-to-br from-shSecondary/[0.085] via-black/20 to-black/35 min-h-[250px] sm:min-h-[280px]">
        <div className="absolute -right-12 -top-12 w-56 h-56 rounded-full bg-shSecondary/10 blur-3xl pointer-events-none"/>
        <div className="grid sm:grid-cols-[1.25fr_0.75fr] min-h-[250px] sm:min-h-[280px]">
          <div className="relative z-10 p-5 sm:p-6 flex flex-col justify-center order-2 sm:order-1">
            <div className="flex items-center gap-2 text-shSecondary text-[15px] font-black uppercase tracking-[0.11em] mb-3" data-testid={testid ? `${testid}-time` : undefined}>
              <i className="fas fa-clock"/>{practiceTimeLabel(pc.schedule) || "Today's practice"}
            </div>
            <p className="text-[15px] sm:text-[16px] font-black uppercase tracking-[0.1em] text-shPrimary mb-1.5"><i className="fas fa-bullseye mr-1.5"/>Today&apos;s Goal</p>
            <h3 className="text-[22px] sm:text-[28px] font-black text-white leading-tight max-w-xl">{renderPracticeCoachText(pc.goal, tokens)}</h3>
            {pc.success_today && (
              <p className="text-[17px] sm:text-[18px] text-shTextMuted mt-3 leading-relaxed"><span className="font-black text-shText">Success today: </span>{renderPracticeCoachText(pc.success_today, tokens)}</p>
            )}
            {pc.encouragement && <p className="text-[16px] sm:text-[17px] text-shTextMuted mt-2 italic">{renderPracticeCoachText(pc.encouragement, tokens)}</p>}
            <div className="flex flex-col sm:flex-row gap-2.5 mt-5">
              {onStartGuided && (
                <PremiumButton onClick={onStartGuided} data-testid={testid ? `${testid}-start-guided` : undefined} className="justify-center min-h-[48px] sm:min-w-[220px]">
                  <i className="fas fa-play text-[13px]"/>Start Guided Practice
                </PremiumButton>
              )}
              {onQuickPractice && (
                <PremiumButton variant="secondary" onClick={onQuickPractice} data-testid={testid ? `${testid}-quick-practice` : undefined} className="justify-center min-h-[48px]">
                  <i className="fas fa-bolt text-[13px]"/>Quick Practice
                </PremiumButton>
              )}
            </div>
          </div>
          <div className="relative h-[170px] sm:h-auto order-1 sm:order-2 overflow-hidden border-b sm:border-b-0 sm:border-l border-shSecondary/20">
            <div className="absolute inset-0 bg-gradient-to-t sm:bg-gradient-to-l from-[var(--sh-card-base)] via-transparent to-transparent z-10 pointer-events-none"/>
            <HuskyDogImage src={dogPhoto} name={dogName} alt={dogName} className="absolute inset-0 w-full h-full object-cover object-top"/>
            <div className="absolute left-4 bottom-4 z-20 px-3 py-1.5 rounded-lg bg-black/60 backdrop-blur border border-white/10 text-white text-[16px] font-black">{dogName}</div>
          </div>
        </div>
      </section>

      {(pc.setup_items || []).length > 0 && (
        <SectionCard accent="cyan" intensity="subtle">
          <p className="text-[15px] sm:text-[16px] font-black uppercase tracking-[0.1em] text-shSecondary mb-3">Before You Start</p>
          <SetupChecklist items={pc.setup_items} tokens={tokens} testid={testid ? `${testid}-setup` : undefined}/>
        </SectionCard>
      )}

      {pc.pro_tip && (
        <SectionCard accent="lime" intensity="subtle">
          <div className="flex items-start gap-3">
            <span className="w-9 h-9 rounded-xl bg-shPrimary/12 border border-shPrimary/30 grid place-items-center shrink-0"><i className="fas fa-lightbulb text-shPrimary text-[15px]"/></span>
            <p className="text-[17px] sm:text-[18px] text-shText leading-relaxed"><span className="font-black text-shPrimary">Pro tip: </span>{renderPracticeCoachText(pc.pro_tip, tokens)}</p>
          </div>
        </SectionCard>
      )}

      {(pc.steps || []).length > 0 && (
        <div>
          <div className="flex items-end justify-between gap-3 mb-2.5">
            <div><p className="text-[15px] sm:text-[16px] font-black uppercase tracking-[0.1em] text-shTextMuted">How It Works</p><p className="text-[18px] text-shTextMuted mt-0.5">Keep it simple and move one rep at a time.</p></div>
            <span className="text-[15px] font-black text-shSecondary shrink-0">{pc.steps.length} step{pc.steps.length === 1 ? "" : "s"}</span>
          </div>
          <div className="space-y-2.5">
            {pc.steps.map((step, i) => (
              <StepRow key={step.id} step={step} index={i} tokens={tokens} testid={testid ? `${testid}-step-${step.id}` : undefined}/>
            ))}
          </div>
        </div>
      )}

      <GoodRepNotThisCards goodRep={pc.good_rep} notThis={pc.not_this} tokens={tokens} testid={testid ? `${testid}-examples` : undefined}/>

      {onOpenTroubleshooting && (pc.troubleshooting || []).length > 0 && (
        <button type="button" onClick={onOpenTroubleshooting} data-testid={testid ? `${testid}-troubleshooting-link` : undefined}
                className="w-full text-left rounded-2xl border border-shBorder/55 bg-black/15 px-4 py-3.5 text-[17px] font-bold text-shSecondary flex items-center justify-between gap-3 hover:border-shSecondary/35 hover:bg-shSecondary/[0.035] transition min-h-[48px]">
          <span><i className="fas fa-circle-question mr-2"/>What if {renderPracticeCoachText("{{dog_name}}", tokens) || "your dog"} doesn&apos;t...?</span>
          <i className="fas fa-chevron-right text-[13px] shrink-0"/>
        </button>
      )}
    </div>
  );
}
