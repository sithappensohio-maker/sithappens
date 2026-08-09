import ProgramRoadmap from "../../training/ProgramRoadmap";
import LessonCard from "../../training/LessonCard";
import EmptyState from "../../training/EmptyState";
import HuskyDogImage from "../../brand/HuskyDogImage";
import { buildSchoolRoadmap, buildSchoolLessonCards, formatCompletionPct } from "../../../lib/onlineSchoolPolish";

/* My Course — the native roadmap screen (Phase 2B). Answers "where am I in the
 * program?" Reuses the SAME shared roadmap components (ProgramRoadmap /
 * ModuleJourneyCard / LessonCard) and polish builders the app already has; all
 * module/lesson/lock state comes from the backend roadmap — nothing derived
 * here. Lesson clicks navigate to the native lesson route via the caller. */
export default function CourseRoadmap({ detail, loading, onOpenLesson, onResume }) {
  if (loading && !detail) {
    return (
      <div className="space-y-3" data-testid="course-roadmap-loading">
        <div className="h-28 rounded-2xl bg-shBorder/30 animate-pulse" />
        <div className="h-40 rounded-2xl bg-shBorder/20 animate-pulse" />
        <div className="h-40 rounded-2xl bg-shBorder/20 animate-pulse" />
      </div>
    );
  }
  if (!detail) {
    return <EmptyState icon="fa-route" message="We couldn't load this course right now — pull to refresh or try again shortly." testid="course-roadmap-error" />;
  }
  if (detail.access_state === "revoked") {
    return <EmptyState icon="fa-lock" message="Access to this course has ended. Contact us if you believe this is a mistake." testid="course-roadmap-revoked" />;
  }

  const roadmap = detail.roadmap;
  const modules = buildSchoolRoadmap(roadmap);
  // Backend-derived curriculum completion (completed/total lessons) — never
  // the trainer-scored mastered_pct, which is a different measure.
  const pct = Math.max(0, Math.min(100, Math.round(detail.course_pct ?? 0)));
  const currentModule = modules.find((m) => m.status === "current");
  const currentLesson = roadmap?.current_lesson;
  const cpStatus = roadmap?.checkpoint_status;
  const isCompleted = detail.status === "completed";

  return (
    <div className="space-y-4" data-testid="course-roadmap">
      {/* Header: dog · course · completion · current module · resume CTA */}
      <section className="rounded-2xl border border-shBorder bg-[var(--sh-card-base)] p-4 sm:p-5">
        <div className="flex items-center gap-3 sm:gap-4">
          <span className="shrink-0 w-12 h-12 sm:w-14 sm:h-14 rounded-2xl overflow-hidden border border-shSecondary/30 bg-black/25">
            <HuskyDogImage src={detail.dog_photo} name={detail.dog_name} className="w-full h-full object-cover" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-shSecondary truncate">{detail.dog_name} · My Course</p>
            <h1 className="text-shText font-black text-[19px] sm:text-[22px] leading-tight text-balance">{detail.program_name}</h1>
            {currentModule && !isCompleted && (
              <p className="text-[12.5px] text-shTextMuted mt-0.5 truncate">Current module: <span className="text-shText font-bold">{currentModule.name}</span></p>
            )}
          </div>
        </div>
        {/* Skill-mastery % is misleading next to a "Course complete" banner
            (they measure different things) — completed courses show the banner
            only, never a contradictory percentage. */}
        {!isCompleted && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-[11px] font-bold text-shTextMuted mb-1.5">
              <span>Course progress</span><span className="text-shPrimary">{formatCompletionPct(pct)}</span>
            </div>
            <div className="h-2 rounded-full bg-shBorder/50 overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-shSecondary to-shPrimary" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
        {!isCompleted && currentLesson && (
          <button type="button" onClick={onResume} data-testid="course-resume-cta"
                  className="mt-4 w-full sm:w-auto inline-flex items-center justify-center gap-2 text-[13px] font-black uppercase tracking-widest px-5 py-3 rounded-xl bg-shPrimary text-bgHeader active:scale-[0.99] transition">
            Continue training <i className="fas fa-arrow-right" />
          </button>
        )}
        {isCompleted && (
          <p className="mt-4 text-[13px] font-black text-shPrimary" data-testid="course-completed-banner">
            <i className="fas fa-graduation-cap mr-1.5" />Course complete — every lesson below stays open for review.
          </p>
        )}
      </section>

      {/* Modules */}
      {modules.length === 0 ? (
        <EmptyState icon="fa-book-open" message="This course doesn't have any modules yet." testid="course-roadmap-empty" />
      ) : (
        <ProgramRoadmap
          modules={modules}
          testid="course-roadmap-modules"
          renderModuleBody={(m) => {
            if (m.status === "locked") {
              return <EmptyState icon="fa-lock" message={m.lockedReason} testid="course-module-locked" />;
            }
            const cards = buildSchoolLessonCards(m);
            if (cards.length === 0) return <EmptyState icon="fa-book-open" message="No lessons in this module yet." testid={`course-module-${m.id}-empty`} />;
            return (
              <div>
                {cards.map((card, i) => {
                  // Checkpoint config is only honestly known for the CURRENT
                  // lesson (the client-safe roadmap strips it elsewhere).
                  const isCheckpoint = card.isCurrent && !!roadmap?.requires_checkpoint;
                  const isFinal = isCheckpoint && roadmap?.checkpoint_rubric?.assessment_type === "final_assessment";
                  const awaiting = isCheckpoint && cpStatus?.status === "awaiting_review";
                  return (
                    <div key={card.id} className="flex gap-3">
                      <div className="flex flex-col items-center w-4 shrink-0" aria-hidden="true">
                        <span className={`w-2.5 h-2.5 rounded-full mt-4 shrink-0 ${
                          card.status === "completed" ? "bg-shPrimary" : card.status === "current" ? "bg-shBlue" : card.status === "locked" ? "bg-shBorder" : "bg-shTextMuted/50"
                        }`} />
                        {i < cards.length - 1 && <span className="w-px flex-1 bg-shBorder/60 my-0.5" />}
                      </div>
                      <div className={`flex-1 min-w-0 pb-3 ${card.isCurrent ? "rounded-xl ring-2 ring-shBlue/40" : ""}`}>
                        {isCheckpoint && (
                          <div className="flex mb-1">
                            <span className={`text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full ${awaiting ? "bg-shAccent/20 text-shAccent" : isFinal ? "bg-shAccent/15 text-shAccent" : "bg-shAccent/10 text-shAccent/80"}`}
                                  data-testid={awaiting ? "course-checkpoint-awaiting" : undefined}>
                              <i className={`fas ${awaiting ? "fa-hourglass-half" : "fa-video"} mr-1`} />
                              {awaiting ? "Awaiting Trainer Review" : isFinal ? "Final Assessment" : "Trainer Checkpoint"}
                            </span>
                          </div>
                        )}
                        <LessonCard
                          name={card.name} overview={card.overview} estimatedMinutes={card.estimatedMinutes}
                          status={card.status} hasVideo={card.hasVideo}
                          lockedReason={card.status === "locked" ? card.lockedReason : null}
                          actionLabel={card.status !== "locked" ? (card.isCurrent ? "Open" : "Review") : null}
                          onAction={card.status !== "locked" ? () => onOpenLesson(card.id) : undefined}
                          testid={`course-lesson-${card.id}`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          }}
        />
      )}
    </div>
  );
}
