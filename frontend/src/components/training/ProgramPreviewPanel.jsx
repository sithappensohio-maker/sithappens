// Training UI Phase 5 — Program Studio's right-column live preview +
// readiness. Client/Trainer tabs reuse the EXACT same production
// components clients/trainers see elsewhere in the app (LessonDetailPanel,
// ActivityCard, SkillLevelIndicator, ProgramRoadmap) — never a second,
// separately-styled preview markup. Mobile tab reuses the Client preview
// content inside a narrower frame, not a third implementation. Validation
// tab reuses ValidationChecklist.
import LessonDetailPanel from "./LessonDetailPanel";
import ActivityCard from "./ActivityCard";
import SkillLevelIndicator from "./SkillLevelIndicator";
import ProgramRoadmap from "./ProgramRoadmap";
import EmptyState from "./EmptyState";
import ValidationChecklist from "./ValidationChecklist";

const noop = () => {};

const TABS = [
  { key: "client", label: "Client", icon: "fa-user" },
  { key: "trainer", label: "Trainer", icon: "fa-clipboard-user" },
  { key: "mobile", label: "Mobile", icon: "fa-mobile-screen-button" },
  { key: "validation", label: "Validation", icon: "fa-clipboard-check" },
];

function ClientPreviewContent({ modules, selectedModule, selectedLesson, selectedSkill }) {
  if (selectedLesson) return <LessonDetailPanel lesson={selectedLesson} actionLabel="Mark Practiced" onAction={noop}/>;
  if (selectedSkill) {
    return (
      <div className="space-y-3 p-1">
        <p className="text-sm font-black text-shText">{selectedSkill.name}</p>
        <SkillLevelIndicator score={0}/>
        {selectedSkill.client_facing_explanation && <p className="text-[13px] text-shTextMuted">{selectedSkill.client_facing_explanation}</p>}
      </div>
    );
  }
  const roadmapModules = modules.map((m, mi) => ({
    id: m._key, name: m.name, description: m.description,
    lessonCount: (m.lessons || []).length, skillCount: (m.goals || []).length,
    status: selectedModule?._key === m._key ? "current" : (mi === 0 ? "available" : "locked"),
  }));
  if (roadmapModules.length === 0) return <EmptyState icon="fa-diagram-project" message="Add a module to see the client preview."/>;
  return <ProgramRoadmap modules={roadmapModules} renderModuleBody={() => null}/>;
}

function TrainerPreviewContent({ selectedLesson, selectedSkill }) {
  if (selectedLesson) {
    const activity = {
      name: selectedLesson.name, objective: selectedLesson.trainer_purpose,
      estimated_minutes: selectedLesson.estimated_minutes, current_status: "not_started",
    };
    return (
      <ActivityCard activity={activity} index={0} total={1} expanded onToggleExpand={noop} onMove={noop} onRemove={noop} onToggleSkip={noop}>
        {selectedLesson.trainer_instructions && <p className="text-[13px] text-shText whitespace-pre-wrap"><span className="text-shAccent font-black">Instructions: </span>{selectedLesson.trainer_instructions}</p>}
        {selectedLesson.trainer_prep_notes && <p className="text-[13px] text-shTextMuted"><span className="text-shAccent font-black">Prep: </span>{selectedLesson.trainer_prep_notes}</p>}
        {selectedLesson.safety_notes && <p className="text-[13px] text-red-400"><span className="font-black">Safety: </span>{selectedLesson.safety_notes}</p>}
      </ActivityCard>
    );
  }
  if (selectedSkill) {
    const activity = { name: selectedSkill.name, objective: selectedSkill.training_objective, current_status: "not_started", manual_only: selectedSkill.manual_only };
    return (
      <ActivityCard activity={activity} index={0} total={1} expanded onToggleExpand={noop} onMove={noop} onRemove={noop} onToggleSkip={noop}>
        {selectedSkill.trainer_only_guidance && <p className="text-[13px] text-shText"><span className="text-shAccent font-black">Guidance: </span>{selectedSkill.trainer_only_guidance}</p>}
        {selectedSkill.pass_criteria && <p className="text-[13px] text-shTextMuted"><span className="font-black">Pass: </span>{selectedSkill.pass_criteria}</p>}
      </ActivityCard>
    );
  }
  return <EmptyState icon="fa-clipboard-user" message="Select a lesson or skill to preview what a trainer sees."/>;
}

export default function ProgramPreviewPanel({ modules, selectedModule, selectedLesson, selectedSkill, validation, onValidationNavigate, onValidationRefresh, validating, tab, onTabChange, testid }) {
  return (
    <div className="flex flex-col h-full" data-testid={testid}>
      <div className="flex border-b border-shBorder shrink-0 overflow-x-auto">
        {TABS.map(t => (
          <button key={t.key} onClick={() => onTabChange(t.key)} data-testid={testid ? `${testid}-tab-${t.key}` : undefined}
                  className={`px-3 py-2 text-[12px] font-black uppercase tracking-widest whitespace-nowrap border-b-2 ${tab === t.key ? "border-shSecondary text-shSecondary" : "border-transparent text-shTextMuted hover:text-shText"}`}>
            <i className={`fas ${t.icon} mr-1`}/>{t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        {tab === "client" && <ClientPreviewContent modules={modules} selectedModule={selectedModule} selectedLesson={selectedLesson} selectedSkill={selectedSkill}/>}
        {tab === "trainer" && <TrainerPreviewContent selectedLesson={selectedLesson} selectedSkill={selectedSkill}/>}
        {tab === "mobile" && (
          <div className="mx-auto border-4 border-shBorder rounded-2xl overflow-hidden" style={{ width: 280 }} data-testid={testid ? `${testid}-mobile-frame` : undefined}>
            <div className="max-h-[420px] overflow-y-auto p-2 bg-black/30">
              <ClientPreviewContent modules={modules} selectedModule={selectedModule} selectedLesson={selectedLesson} selectedSkill={selectedSkill}/>
            </div>
          </div>
        )}
        {tab === "validation" && (
          <ValidationChecklist validation={validation} modules={modules} onNavigate={onValidationNavigate}
                                onRefresh={onValidationRefresh} refreshing={validating} testid={testid ? `${testid}-validation` : undefined}/>
        )}
      </div>
    </div>
  );
}
