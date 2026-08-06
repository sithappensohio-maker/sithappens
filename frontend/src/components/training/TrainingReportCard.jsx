// Training UI Phase 4 — polished, print-friendly report card built ENTIRELY
// from data already returned by /portal/progress + /portal/session-recaps.
// No new document-generation backend: "Print"/"Save as PDF" both use the
// browser's native print dialog, the same mechanism printCertificate()
// already relies on elsewhere in this app.
import Avatar from "../Avatar";
import ProgressSummary from "./ProgressSummary";
import SkillProgressCard from "./SkillProgressCard";

export default function TrainingReportCard({ dog, progress, strongestSkill, recentWin, onClose, onPrint, testid }) {
  const reliableCount = (progress.current_skills || []).filter(s => s.level_label === "Reliable").length;
  const masteredCount = (progress.current_skills || []).filter(s => s.level_label === "Mastered").length;

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-2 sm:p-4 print:static print:bg-white print:p-0" data-testid={testid}>
      <div className="bg-[var(--sh-card-base)] border border-shBorder rounded-2xl w-full max-w-2xl max-h-[calc(var(--app-height)_-_1rem)] flex flex-col min-h-0 shadow-2xl print:max-w-none print:max-h-none print:border-0 print:shadow-none print:bg-white">
        <div className="px-5 py-4 border-b border-shBorder flex items-center justify-between shrink-0 print:hidden">
          <h3 className="text-lg font-black text-shText uppercase italic tracking-tight">Training Report Card</h3>
          <button onClick={onClose} data-testid={testid ? `${testid}-close` : undefined} className="text-shTextMuted hover:text-shText text-xl px-2"><i className="fas fa-times"/></button>
        </div>

        <div className="overflow-y-auto flex-1 min-h-0 px-5 py-5 space-y-4 print:text-black">
          <div className="flex items-center gap-3">
            <Avatar src={dog.dog_photo} icon="fa-paw" size="lg" alt={dog.dog_name}/>
            <div>
              <h4 className="text-xl font-black text-shText print:text-black uppercase italic tracking-tight">{dog.dog_name}</h4>
              <p className="text-[13px] text-shTextMuted print:text-gray-700">{progress.program_name} · {progress.program_status === "completed" ? "Program Completed" : "Active"}</p>
            </div>
          </div>

          <ProgressSummary
            completionPct={progress.mastered_pct}
            currentModuleName={progress.current_module_name}
            reliableCount={reliableCount}
            masteredCount={masteredCount}
            practiceSessions={(progress.session_history || []).length}
            testid={testid ? `${testid}-summary` : undefined}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {strongestSkill && (
              <div className="bg-shPrimary/5 border border-shPrimary/30 rounded-lg p-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-shPrimary mb-1">Strongest Skill</p>
                <p className="text-[14px] text-shText font-bold">{strongestSkill.name}</p>
              </div>
            )}
            {recentWin && (
              <div className="bg-shSecondary/5 border border-shSecondary/30 rounded-lg p-3">
                <p className="text-[10px] font-black uppercase tracking-widest text-shSecondary mb-1">Recent Win</p>
                <p className="text-[14px] text-shText font-bold">{recentWin}</p>
              </div>
            )}
            {(progress.whats_next || []).length > 0 && (
              <div className="bg-shAccent/5 border border-shAccent/30 rounded-lg p-3 sm:col-span-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-shAccent mb-1">Continue Working On</p>
                <p className="text-[14px] text-shText">{progress.whats_next.join(", ")}</p>
              </div>
            )}
          </div>

          <div>
            <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted mb-2">Skills This Module</p>
            <div className="space-y-2">
              {(progress.current_skills || []).map(s => (
                <SkillProgressCard key={s.id} skill={s} testid={testid ? `${testid}-skill-${s.id}` : undefined}/>
              ))}
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-shBorder flex justify-end gap-2 shrink-0 print:hidden">
          <button onClick={onClose} data-testid={testid ? `${testid}-return` : undefined} className="text-shTextMuted hover:text-shText font-black uppercase text-[13px] tracking-widest px-2">Return to Progress</button>
          <button onClick={onPrint || (() => window.print())} data-testid={testid ? `${testid}-print` : undefined}
                  className="bg-shPrimary text-bgHeader px-4 py-2 rounded font-black text-[13px] uppercase tracking-widest shadow">
            <i className="fas fa-print mr-1.5"/>Print / Save as PDF
          </button>
        </div>
      </div>
    </div>
  );
}
