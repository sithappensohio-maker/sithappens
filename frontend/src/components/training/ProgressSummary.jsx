// Training UI Phase 4 — compact visual progress summary. Every number is
// passed in by the caller, computed from data the backend already returns
// (mastered_pct, current_module_name, skill counts derived client-side from
// the same current_skills array Progress already renders) — no parallel
// progress system.
import StatusChip from "./StatusChip";

export default function ProgressSummary({
  completionPct, currentModuleName, reliableCount, masteredCount,
  practiceSessions, streak, assessmentsPassed, testid,
}) {
  return (
    <div className="bg-black/20 border border-shBorder rounded-xl p-4" data-testid={testid}>
      <div className="flex items-center gap-4 mb-3">
        <div className="relative shrink-0 w-16 h-16">
          <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90">
            <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--sh-border, rgba(96,128,196,0.18))" strokeWidth="3"/>
            <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--sh-primary, #8cc63f)" strokeWidth="3"
                    strokeDasharray={`${(completionPct || 0) * 0.974} 200`} strokeLinecap="round"/>
          </svg>
          <span className="absolute inset-0 grid place-items-center text-[13px] font-black text-shText">{completionPct || 0}%</span>
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-widest text-shTextMuted">Program Complete</p>
          {currentModuleName && <p className="text-[14px] font-black text-shText mt-0.5 truncate">{currentModuleName}</p>}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {reliableCount != null && <StatusChip icon="fa-check" label="Reliable" value={reliableCount} tone="secondary"/>}
        {masteredCount != null && <StatusChip icon="fa-star" label="Mastered" value={masteredCount} tone="primary"/>}
        {practiceSessions != null && <StatusChip icon="fa-dumbbell" label="Practice Sessions" value={practiceSessions} tone="muted"/>}
        {streak > 0 && <StatusChip icon="fa-fire" label="Day Streak" value={streak} tone="accent"/>}
        {assessmentsPassed != null && <StatusChip icon="fa-clipboard-check" label="Assessments Passed" value={assessmentsPassed} tone="muted"/>}
      </div>
    </div>
  );
}
