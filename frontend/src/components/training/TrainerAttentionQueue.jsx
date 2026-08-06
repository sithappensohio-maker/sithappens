// Training UI Phase 5 — compiled attention queue for the Trainer Daily
// Dashboard. Items come from buildAttentionQueue (lib/trainerDashboardPolish.js),
// itself derived entirely from rows already loaded for the dashboard above —
// no second query, no new stored signal.
import EmptyState from "./EmptyState";

const TONE_CLS = {
  danger: "border-red-500/30 bg-red-500/5",
  secondary: "border-shSecondary/30 bg-shSecondary/5",
  accent: "border-shAccent/30 bg-shAccent/5",
  muted: "border-shBorder bg-black/10",
};

export default function TrainerAttentionQueue({ items, onAction, testid }) {
  const list = items || [];
  if (list.length === 0) {
    return <EmptyState icon="fa-circle-check" message="Nothing needs attention right now." testid={testid ? `${testid}-empty` : undefined}/>;
  }
  return (
    <div className="space-y-1.5" data-testid={testid}>
      {list.map(item => (
        <div key={item.key} data-testid={testid ? `${testid}-${item.key}` : undefined}
             className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${TONE_CLS[item.tone] || TONE_CLS.muted}`}>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-black text-shText truncate">{item.dogName}</p>
            <p className="text-[12px] text-shTextMuted truncate">{item.reason} <span className="opacity-60">· {item.age}</span></p>
          </div>
          <button onClick={() => onAction(item)} data-testid={testid ? `${testid}-${item.key}-action` : undefined}
                  className="shrink-0 bg-black/20 border border-shBorder text-shText px-2.5 py-1.5 rounded text-[11px] font-black uppercase tracking-widest hover:bg-black/30 whitespace-nowrap">
            {item.actionLabel}
          </button>
        </div>
      ))}
    </div>
  );
}
