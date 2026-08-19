// Training UI Phase 5 — Program Studio's visual validation checklist.
// Grouped by section (never one giant unstructured list) via
// groupValidationIssues (lib/programStudioPolish.js); clicking an issue
// navigates directly to the affected item via onNavigate, which the parent
// wires to the SAME setSelected the curriculum tree already uses.
import { groupValidationIssues, resolveValidationTarget } from "../../lib/programStudioPolish";
import EmptyState from "./EmptyState";

const GROUP_LABELS = {
  program: "Program", modules: "Modules", lessons: "Lessons", skills: "Skills",
  homework_links: "Practice Links", prerequisites: "Prerequisites & Advancement",
};
const GROUP_ORDER = ["program", "modules", "lessons", "skills", "homework_links", "prerequisites"];

export default function ValidationChecklist({ validation, modules, onNavigate, onRefresh, refreshing, testid }) {
  if (!validation) {
    return onRefresh ? (
      <button onClick={onRefresh} disabled={refreshing} data-testid={testid ? `${testid}-refresh` : undefined}
              className="bg-shPrimary/15 text-shPrimary border border-shPrimary/40 px-3 py-1.5 rounded text-[12px] font-black uppercase tracking-widest disabled:opacity-40">
        {refreshing ? "Checking…" : "Check for Problems"}
      </button>
    ) : null;
  }
  const groups = groupValidationIssues(validation);
  const totalIssues = GROUP_ORDER.reduce((n, k) => n + groups[k].length, 0);

  return (
    <div className="space-y-3" data-testid={testid}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className={`rounded p-2 text-[12px] font-black uppercase tracking-widest ${validation.valid ? "bg-shPrimary/15 text-shPrimary" : "bg-red-500/15 text-red-400"}`}
             data-testid={testid ? `${testid}-summary` : undefined}>
          {validation.valid ? "Publishing Readiness: No blocking errors" : `Publishing Readiness: ${validation.errors.length} error(s) block publishing`}
        </div>
        {onRefresh && (
          <button onClick={onRefresh} disabled={refreshing} data-testid={testid ? `${testid}-refresh` : undefined}
                  className="text-shTextMuted hover:text-shText text-[11px] font-black uppercase tracking-widest">
            <i className={`fas fa-rotate mr-1 ${refreshing ? "fa-spin" : ""}`}/>Re-check
          </button>
        )}
      </div>
      {totalIssues === 0 && <EmptyState icon="fa-circle-check" message="No issues found — this draft is clean."/>}
      {GROUP_ORDER.filter(k => groups[k].length > 0).map(key => (
        <div key={key} className="space-y-1" data-testid={testid ? `${testid}-group-${key}` : undefined}>
          <p className="text-[11px] font-black uppercase tracking-widest text-shTextMuted">{GROUP_LABELS[key]}</p>
          {groups[key].map((issue, i) => {
            const target = resolveValidationTarget(issue, modules);
            const isError = issue.severity === "error";
            return (
              <button key={`${key}-${i}`} onClick={() => target && onNavigate(target)} disabled={!target}
                      data-testid={testid ? `${testid}-issue-${key}-${i}` : undefined}
                      className={`w-full text-left text-[13px] rounded px-2 py-1.5 border transition ${
                        isError ? "bg-red-500/10 border-red-500/30 text-shText hover:bg-red-500/20" : "bg-shAccent/10 border-shAccent/30 text-shText hover:bg-shAccent/20"
                      } ${!target ? "cursor-default opacity-70" : "cursor-pointer"}`}>
                <i className={`fas ${isError ? "fa-circle-exclamation text-red-400" : "fa-triangle-exclamation text-shAccent"} mr-1.5`}/>
                {issue.message}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
