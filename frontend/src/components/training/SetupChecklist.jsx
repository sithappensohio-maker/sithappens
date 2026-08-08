// Practice Coach setup cards. Content remains fully recipe-driven.
import { iconKeyToFaClass, renderPracticeCoachText } from "../../lib/practiceCoachPolish";

export default function SetupChecklist({ items, tokens, testid }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5" data-testid={testid}>
      {items.map(item => (
        <div key={item.id} className="rounded-xl border border-shBorder/50 bg-black/12 p-3 min-h-[96px] flex flex-col justify-center items-center text-center gap-1.5"
             data-testid={testid ? `${testid}-item-${item.id}` : undefined}>
          <div className="relative w-9 h-9 rounded-xl bg-shSecondary/10 border border-shSecondary/25 grid place-items-center">
            <i className={`fas ${iconKeyToFaClass(item.icon_key)} text-shSecondary text-[13px]`}/>
            {item.required && <i className="fas fa-check-circle text-shPrimary text-[10px] absolute -top-1 -right-1"/>}
          </div>
          <p className="text-[11px] sm:text-[12px] font-black text-shText leading-tight">{renderPracticeCoachText(item.title, tokens)}</p>
          {item.description && <p className="text-[10px] text-shTextMuted leading-snug">{renderPracticeCoachText(item.description, tokens)}</p>}
        </div>
      ))}
    </div>
  );
}
