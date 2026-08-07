// Client Practice Coach upgrade — "Before You Start" setup cards. Renders
// generically from practice_coach.setup_items; icon_key is a safe semantic
// key resolved through iconKeyToFaClass, never arbitrary markup.
import { iconKeyToFaClass, renderPracticeCoachText } from "../../lib/practiceCoachPolish";

export default function SetupChecklist({ items, tokens, testid }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" data-testid={testid}>
      {items.map(item => (
        <div key={item.id} className="bg-black/20 border border-shBorder rounded-lg p-2.5 flex flex-col items-center text-center gap-1"
             data-testid={testid ? `${testid}-item-${item.id}` : undefined}>
          <div className="relative">
            <i className={`fas ${iconKeyToFaClass(item.icon_key)} text-shSecondary text-[18px]`}/>
            {item.required && <i className="fas fa-check-circle text-shPrimary text-[10px] absolute -top-1 -right-2"/>}
          </div>
          <p className="text-[11px] font-black text-shText leading-tight">{renderPracticeCoachText(item.title, tokens)}</p>
          {item.description && <p className="text-[10px] text-shTextMuted leading-tight">{renderPracticeCoachText(item.description, tokens)}</p>}
        </div>
      ))}
    </div>
  );
}
