import EmptyState from "../../training/EmptyState";
import { buildSchoolRoadmap, moduleQuizChip } from "../../../lib/onlineSchoolPolish";
import { CourseHero, ModuleCard } from "./course/CourseCards";

const QUIZ_CHIP_CLS = {
  passed: "bg-shPrimary/15 text-shPrimary",
  ready: "bg-shSecondary/15 text-shSecondary",
  locked: "bg-shBorder/30 text-shTextMuted",
};

/* My Course — the client's training journey.
 *
 * Redesigned in phase 2 to read as a path rather than a database tree: a hero
 * with the program promise and real progress, then modules with friendly
 * state words and a stated reason for anything locked.
 *
 * The DATA contract is unchanged. buildSchoolRoadmap still supplies module
 * status/locked_reason and the backend roadmap still owns every lock and
 * progression decision — this screen only presents them. Lesson clicks
 * navigate through the caller exactly as before.
 */
export default function CourseRoadmap({ detail, loading, onOpenLesson, onResume }) {
  if (loading && !detail) {
    return (
      <div className="space-y-3" data-testid="course-roadmap-loading">
        <div className="h-32 rounded-2xl bg-shBorder/30 animate-pulse" />
        <div className="h-24 rounded-2xl bg-shBorder/20 animate-pulse" />
        <div className="h-24 rounded-2xl bg-shBorder/20 animate-pulse" />
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
  const currentLessonId = roadmap?.current_lesson?.id || null;
  const isCompleted = detail.status === "completed";

  return (
    <div className="space-y-4" data-testid="course-roadmap">
      <CourseHero detail={detail} roadmap={roadmap} onResume={isCompleted ? null : onOpenLesson} />

      {isCompleted && (
        <p className="text-[13px] font-black text-shPrimary" data-testid="course-completed-banner">
          <i className="fas fa-graduation-cap mr-1.5" />Course complete — every lesson below stays open for review.
        </p>
      )}

      {modules.length === 0 ? (
        <EmptyState icon="fa-book-open" message="This course doesn't have any modules yet." testid="course-roadmap-empty" />
      ) : (
        <div className="space-y-3" data-testid="course-roadmap-modules">
          {modules.map((m) => {
            const chip = moduleQuizChip(m.quiz);
            return (
              <div key={m.id}>
                <ModuleCard
                  module={m}
                  currentLessonId={currentLessonId}
                  onOpenLesson={onOpenLesson}
                  /* The module being worked on opens by default; a completed
                     course opens nothing, so review starts from a clean list. */
                  defaultOpen={!isCompleted && m.status === "current"}
                />
                {chip && (
                  <p className={`mt-1.5 ml-4 inline-block text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-full ${QUIZ_CHIP_CLS[chip.tone] || QUIZ_CHIP_CLS.locked}`}
                     data-testid={`course-module-quiz-${m.id}`}>
                    {chip.label}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
