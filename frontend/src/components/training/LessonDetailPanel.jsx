// Training UI Phase 4 — full lesson detail: a layered structure where the
// short essentials stay always visible and longer content lives behind
// ExpandableSection, reusing UI-1/UI-3 shared components throughout.
import VideoDemoCard from "./VideoDemoCard";
import ExpandableSection from "./ExpandableSection";
import EquipmentChips from "./EquipmentChips";
import PracticeInstructionSteps from "./PracticeInstructionSteps";

export default function LessonDetailPanel({ lesson, nextLessonName, relatedHomeworkTitles = [], actionLabel, onAction, testid }) {
  if (!lesson) return null;
  return (
    <div className="space-y-3" data-testid={testid}>
      <VideoDemoCard videoUrl={lesson.demo_video_url} testid={testid ? `${testid}-video` : undefined}/>

      {lesson.client_overview && (
        <p className="text-[13px]"><span className="text-shTextMuted font-black uppercase text-[11px] tracking-widest">Goal: </span><span className="text-shText">{lesson.client_overview}</span></p>
      )}
      {lesson.why_it_matters && (
        <p className="text-[13px]"><span className="text-shTextMuted font-black uppercase text-[11px] tracking-widest">Why it matters: </span><span className="text-shText">{lesson.why_it_matters}</span></p>
      )}
      <EquipmentChips equipment={lesson.equipment_needed} testid={testid ? `${testid}-equipment` : undefined}/>
      {lesson.success_criteria && (
        <div className="bg-shPrimary/5 border border-shPrimary/30 rounded-lg p-3">
          <p className="text-[11px] font-black uppercase tracking-widest text-shPrimary mb-1"><i className="fas fa-flag-checkered mr-1.5"/>Success Criteria</p>
          <p className="text-[13px] text-shText">{lesson.success_criteria}</p>
        </div>
      )}
      {lesson.safety_notes && (
        <div className="bg-red-500/5 border border-red-500/30 rounded-lg p-3">
          <p className="text-[11px] font-black uppercase tracking-widest text-red-300 mb-1"><i className="fas fa-triangle-exclamation mr-1.5"/>Safety</p>
          <p className="text-[13px] text-red-200">{lesson.safety_notes}</p>
        </div>
      )}

      {lesson.client_instructions && (
        <ExpandableSection title="Step-by-Step Directions" icon="fa-list-ol" defaultOpen testid={testid ? `${testid}-steps` : undefined}>
          <PracticeInstructionSteps text={lesson.client_instructions}/>
        </ExpandableSection>
      )}
      {lesson.common_mistakes && (
        <ExpandableSection title="Common Mistakes" icon="fa-triangle-exclamation" tone="accent" testid={testid ? `${testid}-mistakes` : undefined}>
          <p className="text-[13px] text-shText">{lesson.common_mistakes}</p>
        </ExpandableSection>
      )}
      {lesson.troubleshooting && (
        <ExpandableSection title="Troubleshooting" icon="fa-wrench" testid={testid ? `${testid}-troubleshooting` : undefined}>
          <p className="text-[13px] text-shText">{lesson.troubleshooting}</p>
        </ExpandableSection>
      )}
      {nextLessonName && (
        <ExpandableSection title="What Comes Next" icon="fa-arrow-right" testid={testid ? `${testid}-next` : undefined}>
          <p className="text-[13px] text-shText">{nextLessonName}</p>
        </ExpandableSection>
      )}
      {relatedHomeworkTitles.length > 0 && (
        <ExpandableSection title="Related Homework" icon="fa-graduation-cap" testid={testid ? `${testid}-homework` : undefined}>
          <ul className="space-y-1">
            {relatedHomeworkTitles.map((t, i) => <li key={i} className="text-[13px] text-shText"><i className="fas fa-book mr-1.5 text-shTextMuted"/>{t}</li>)}
          </ul>
        </ExpandableSection>
      )}

      {actionLabel && (
        <button onClick={onAction} data-testid={testid ? `${testid}-action` : undefined}
                className="w-full bg-shPrimary text-bgHeader py-2.5 rounded-lg font-black text-[13px] uppercase tracking-widest shadow">
          {actionLabel}
        </button>
      )}
    </div>
  );
}
