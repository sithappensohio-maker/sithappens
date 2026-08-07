// Client Practice Coach upgrade — exercise-specific troubleshooting, kept
// immediately available throughout Guided Practice ("I'm Stuck") and from
// the How It Works screen ("What if my dog doesn't...?"). Escalates to the
// EXISTING Ask Trainer function last, never a new/parallel contact path.
import { useState } from "react";
import { renderPracticeCoachText } from "../../lib/practiceCoachPolish";

export default function TroubleshootingDrawer({ items, tokens, onAskTrainer, open, onClose, testid }) {
  const [openId, setOpenId] = useState(null);
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black/80 z-[60] flex items-end sm:items-center justify-center p-2 sm:p-4"
         onClick={onClose} data-testid={testid}>
      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-md max-h-[80vh] overflow-y-auto p-4 space-y-3"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-black uppercase tracking-widest text-shAccent">Troubleshooting</p>
          <button onClick={onClose} className="text-shTextMuted" data-testid={testid ? `${testid}-close` : undefined}>
            <i className="fas fa-xmark"/>
          </button>
        </div>
        {(!items || items.length === 0) && (
          <p className="text-[12px] text-shTextMuted">No specific troubleshooting for this exercise yet.</p>
        )}
        <div className="space-y-2">
          {(items || []).map(item => {
            const isOpen = openId === item.id;
            return (
              <div key={item.id} className="bg-black/20 border border-shBorder rounded-lg" data-testid={testid ? `${testid}-item-${item.id}` : undefined}>
                <button onClick={() => setOpenId(isOpen ? null : item.id)}
                        className="w-full flex items-center justify-between px-3 py-2.5 text-left">
                  <span className="text-[12px] font-bold text-shText">{renderPracticeCoachText(item.title || item.trigger, tokens)}</span>
                  <i className={`fas fa-chevron-${isOpen ? "up" : "down"} text-shTextMuted text-[11px] shrink-0 ml-2`}/>
                </button>
                {isOpen && (
                  <div className="px-3 pb-3 space-y-1">
                    {(item.actions || []).map((a, i) => (
                      <p key={i} className="text-[12px] text-shTextMuted flex gap-1.5">
                        <i className="fas fa-arrow-right text-shSecondary text-[10px] mt-1 shrink-0"/>
                        {renderPracticeCoachText(a, tokens)}
                      </p>
                    ))}
                    {item.stop_round && (
                      <p className="text-[11px] font-black uppercase tracking-widest text-shAccent mt-1.5">
                        <i className="fas fa-hand mr-1"/>Stop this round
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {onAskTrainer && (
          <button onClick={onAskTrainer} data-testid={testid ? `${testid}-ask-trainer` : undefined}
                  className="w-full bg-shSecondary/15 text-shSecondary border border-shSecondary/40 rounded-lg py-2.5 text-[12px] font-black uppercase tracking-widest">
            <i className="fas fa-comment-dots mr-1.5"/>Still stuck? Ask your trainer
          </button>
        )}
      </div>
    </div>
  );
}
