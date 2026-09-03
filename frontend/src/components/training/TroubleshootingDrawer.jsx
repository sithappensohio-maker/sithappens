// Exercise-specific troubleshooting. Same state/Ask Trainer path, presented
// as a mobile bottom sheet and a centered panel on larger screens.
import { useState } from "react";
import PremiumButton from "../premium/PremiumButton";
import { useImmersiveWorkflow } from "../../lib/immersiveWorkflow";
import { renderPracticeCoachText } from "../../lib/practiceCoachPolish";

export default function TroubleshootingDrawer({ items, tokens, onAskTrainer, open, onClose, testid }) {
  const [openId, setOpenId] = useState(null);
  useImmersiveWorkflow(!!open);
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-[60] flex items-end sm:items-center justify-center sm:p-4"
         onClick={onClose} data-testid={testid}>
      <div className="w-full sm:max-w-lg max-h-[88dvh] sm:max-h-[82vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl border border-shAccent/30 bg-[var(--sh-card-base)] shadow-[0_-20px_70px_rgba(0,0,0,0.55)]"
           onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 z-10 bg-[var(--sh-card-base)]/95 backdrop-blur-xl border-b border-shBorder/50 px-4 sm:px-5 py-4 flex items-center justify-between gap-3">
          <div><p className="text-[11px] font-black uppercase tracking-[0.16em] text-shAccent">Practice Coach</p><h3 className="text-[21px] font-black text-white mt-0.5">Troubleshooting</h3></div>
          <button onClick={onClose} className="w-10 h-10 rounded-xl border border-shBorder/55 grid place-items-center text-shTextMuted" data-testid={testid ? `${testid}-close` : undefined}><i className="fas fa-xmark"/></button>
        </div>
        <div className="p-4 sm:p-5 space-y-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {(!items || items.length === 0) && <p className="text-[16px] text-shTextMuted rounded-2xl border border-shBorder/50 bg-black/10 p-4">No specific troubleshooting for this exercise yet.</p>}
          <div className="space-y-2.5">
            {(items || []).map(item => {
              const isOpen = openId === item.id;
              return (
                <div key={item.id} className={`rounded-2xl border overflow-hidden transition ${isOpen ? "border-shSecondary/30 bg-shSecondary/[0.035]" : "border-shBorder/50 bg-black/10"}`} data-testid={testid ? `${testid}-item-${item.id}` : undefined}>
                  <button onClick={() => setOpenId(isOpen ? null : item.id)} className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left min-h-[52px]">
                    <span className="text-[16px] font-black text-shText">{renderPracticeCoachText(item.title || item.trigger, tokens)}</span>
                    <i className={`fas fa-chevron-${isOpen ? "up" : "down"} text-shTextMuted text-[13px] shrink-0`}/>
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-4 border-t border-shBorder/35 pt-3 space-y-2.5">
                      {(item.actions || []).map((a, i) => <p key={i} className="text-[15px] sm:text-[16px] text-shTextMuted flex gap-2.5 leading-relaxed"><span className="w-6 h-6 rounded-lg bg-shSecondary/10 border border-shSecondary/25 grid place-items-center shrink-0"><i className="fas fa-arrow-right text-shSecondary text-[8px]"/></span><span>{renderPracticeCoachText(a, tokens)}</span></p>)}
                      {item.stop_round && <p className="text-[13px] font-black uppercase tracking-[0.12em] text-shAccent mt-2"><i className="fas fa-hand mr-1.5"/>Stop this round</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {onAskTrainer && <PremiumButton variant="secondary" onClick={onAskTrainer} data-testid={testid ? `${testid}-ask-trainer` : undefined} className="w-full justify-center min-h-[50px]"><i className="fas fa-comment-dots text-[13px]"/>Still stuck? Ask your trainer</PremiumButton>}
        </div>
      </div>
    </div>
  );
}
