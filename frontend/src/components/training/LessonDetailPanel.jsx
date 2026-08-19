// Full lesson detail. Training semantics are unchanged; this is the same
// client-safe lesson data arranged to match the polished Online School.
import VideoDemoCard from "./VideoDemoCard";
import ExpandableSection from "./ExpandableSection";
import EquipmentChips from "./EquipmentChips";
import PracticeInstructionSteps from "./PracticeInstructionSteps";
import PremiumButton from "../premium/PremiumButton";
import SectionCard from "../premium/SectionCard";

export default function LessonDetailPanel({ lesson, nextLessonName, relatedHomeworkTitles = [], actionLabel, onAction, testid }) {
  if (!lesson) return null;
  return (
    <div className="space-y-4" data-testid={testid}>
      <VideoDemoCard videoUrl={lesson.demo_video_url} testid={testid ? `${testid}-video` : undefined}/>

      {(lesson.client_overview || lesson.why_it_matters) && (
        <SectionCard accent="cyan" intensity="subtle">
          <div className="grid gap-4 sm:grid-cols-2">
            {lesson.client_overview && (
              <div>
                <p className="text-[9px] font-black uppercase tracking-[0.16em] text-shSecondary mb-1.5">Today&apos;s goal</p>
                <p className="text-[15px] sm:text-[16px] font-black text-shText leading-snug">{lesson.client_overview}</p>
              </div>
            )}
            {lesson.why_it_matters && (
              <div className="sm:border-l sm:border-shBorder/45 sm:pl-4">
                <p className="text-[9px] font-black uppercase tracking-[0.16em] text-shTextMuted mb-1.5">Why it matters</p>
                <p className="text-[13px] sm:text-[14px] text-shText/90 leading-relaxed">{lesson.why_it_matters}</p>
              </div>
            )}
          </div>
        </SectionCard>
      )}

      {lesson.equipment_needed && (
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.14em] text-shTextMuted mb-2">Grab this first</p>
          <EquipmentChips equipment={lesson.equipment_needed} testid={testid ? `${testid}-equipment` : undefined}/>
        </div>
      )}

      {lesson.success_criteria && (
        <SectionCard accent="lime" intensity="subtle">
          <div className="flex items-start gap-3">
            <span className="w-10 h-10 rounded-xl bg-shPrimary/12 border border-shPrimary/30 grid place-items-center shrink-0"><i className="fas fa-flag-checkered text-shPrimary text-[13px]"/></span>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-shPrimary mb-1">Success looks like</p>
              <p className="text-[13px] sm:text-[14px] text-shText leading-relaxed">{lesson.success_criteria}</p>
            </div>
          </div>
        </SectionCard>
      )}

      {lesson.safety_notes && (
        <div className="rounded-2xl border border-red-400/30 bg-red-500/[0.055] p-4">
          <div className="flex items-start gap-3">
            <span className="w-9 h-9 rounded-xl bg-red-400/10 border border-red-400/25 grid place-items-center shrink-0"><i className="fas fa-triangle-exclamation text-red-300 text-[12px]"/></span>
            <div><p className="text-[10px] font-black uppercase tracking-[0.14em] text-red-300 mb-1">Safety note</p><p className="text-[13px] text-red-100/90 leading-relaxed">{lesson.safety_notes}</p></div>
          </div>
        </div>
      )}

      {lesson.client_instructions && (
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-shPrimary mb-2">How to do it</p>
          <PracticeInstructionSteps text={lesson.client_instructions} testid={testid ? `${testid}-steps` : undefined}/>
        </div>
      )}

      <div className="space-y-2.5">
        {lesson.common_mistakes && (
          <ExpandableSection title="Common Mistakes" icon="fa-triangle-exclamation" tone="accent" testid={testid ? `${testid}-mistakes` : undefined}>
            <p className="text-[13px] sm:text-[14px] text-shText leading-relaxed">{lesson.common_mistakes}</p>
          </ExpandableSection>
        )}
        {lesson.troubleshooting && (
          <ExpandableSection title="Troubleshooting" icon="fa-wrench" tone="secondary" testid={testid ? `${testid}-troubleshooting` : undefined}>
            <p className="text-[13px] sm:text-[14px] text-shText leading-relaxed">{lesson.troubleshooting}</p>
          </ExpandableSection>
        )}
        {nextLessonName && (
          <ExpandableSection title="What Comes Next" icon="fa-arrow-right" testid={testid ? `${testid}-next` : undefined}>
            <p className="text-[13px] sm:text-[14px] text-shText">{nextLessonName}</p>
          </ExpandableSection>
        )}
        {relatedHomeworkTitles.length > 0 && (
          <ExpandableSection title="Related Practice" icon="fa-graduation-cap" testid={testid ? `${testid}-homework` : undefined}>
            <ul className="space-y-2">
              {relatedHomeworkTitles.map((t, i) => <li key={i} className="text-[13px] text-shText flex items-center gap-2"><i className="fas fa-book text-shSecondary text-[10px]"/>{t}</li>)}
            </ul>
          </ExpandableSection>
        )}
      </div>

      {actionLabel && (
        <div className="sticky bottom-0 -mx-1 pt-2 pb-[max(0.25rem,env(safe-area-inset-bottom))] bg-gradient-to-t from-[var(--sh-card-base)] via-[var(--sh-card-base)]/95 to-transparent">
          <PremiumButton onClick={onAction} data-testid={testid ? `${testid}-action` : undefined} className="w-full justify-center min-h-[50px] sm:min-h-[46px] text-[13px]">
            <i className="fas fa-play text-[10px]"/>{actionLabel}
          </PremiumButton>
        </div>
      )}
    </div>
  );
}
