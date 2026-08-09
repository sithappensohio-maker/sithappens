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
import LessonContentBlocks from "../school/student/LessonContentBlocks";

const noop = () => {};

const TABS = [
  { key: "client", label: "Client", icon: "fa-user" },
  { key: "trainer", label: "Trainer", icon: "fa-clipboard-user" },
  { key: "mobile", label: "Phone", icon: "fa-mobile-screen-button" },
  { key: "validation", label: "Validate", icon: "fa-clipboard-check" },
];

function ClientPreviewContent({ modules, selectedModule, selectedLesson, selectedSkill }) {
  if (selectedLesson) {
    const activeBlocks = (selectedLesson.content_blocks || []).filter((b) => b?.active !== false);
    if (activeBlocks.length) {
      return (
        <div className="space-y-4">
          <div className="rounded-2xl border border-shBorder bg-[var(--sh-card-base)] p-4">
            <p className="text-[9px] font-black uppercase tracking-[0.16em] text-shSecondary">Student lesson</p>
            <p className="mt-1 text-lg font-black text-shText">{selectedLesson.name}</p>
            {selectedLesson.overview && <p className="mt-2 text-[13px] leading-relaxed text-shTextMuted">{selectedLesson.overview}</p>}
          </div>
          <LessonContentBlocks blocks={activeBlocks} previewMode />
          <button type="button" onClick={noop} className="min-h-[46px] rounded-xl bg-shPrimary px-5 text-[11px] font-black uppercase tracking-widest text-[#071018]">{(selectedLesson.suggested_homework_template_ids || []).length ? "Start Practice" : "Complete Lesson"}</button>
        </div>
      );
    }
    return <LessonDetailPanel lesson={selectedLesson} actionLabel="Mark Practiced" onAction={noop}/>;
  }
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
      <div className="px-3 pt-3 shrink-0 bg-black/10">
        <div className="grid grid-cols-4 gap-1 rounded-xl border border-shBorder/60 bg-black/25 p-1 overflow-x-auto">
          {TABS.map(t => (
            <button key={t.key} onClick={() => onTabChange(t.key)} data-testid={testid ? `${testid}-tab-${t.key}` : undefined}
                    className={`min-h-[40px] px-2 py-2 text-[10px] font-black whitespace-nowrap rounded-lg transition ${tab === t.key ? "bg-shSecondary text-[#031018] shadow-[0_0_16px_rgba(0,169,224,0.10)]" : "text-shTextMuted hover:text-shText hover:bg-white/[0.035]"}`}>
              <i className={`fas ${t.icon} mr-1`}/>{t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4">
        {tab !== "validation" && (
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <p className="text-[9px] font-black uppercase tracking-[0.16em] text-shTextMuted">Live preview</p>
              <p className="text-[10px] text-shTextMuted mt-0.5">Same production components — not a fake mockup.</p>
            </div>
            <span className="rounded-full border border-shBorder/50 bg-black/20 px-2 py-1 text-[9px] font-black text-shTextMuted">{tab === "mobile" ? "320px target" : tab === "trainer" ? "Trainer view" : "Client view"}</span>
          </div>
        )}
        {tab === "client" && <ClientPreviewContent modules={modules} selectedModule={selectedModule} selectedLesson={selectedLesson} selectedSkill={selectedSkill}/>} 
        {tab === "trainer" && <TrainerPreviewContent selectedLesson={selectedLesson} selectedSkill={selectedSkill}/>} 
        {tab === "mobile" && (
          <div className="mx-auto rounded-[28px] border-[5px] border-[#1a2030] bg-[#03050a] shadow-[0_20px_60px_rgba(0,0,0,0.5)] p-1.5" style={{ width: "min(320px, 100%)" }} data-testid={testid ? `${testid}-mobile-frame` : undefined}>
            <div className="h-4 flex items-center justify-center"><span className="w-14 h-1 rounded-full bg-white/10"/></div>
            <div className="max-h-[520px] overflow-y-auto rounded-[20px] p-2 bg-black/30">
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
