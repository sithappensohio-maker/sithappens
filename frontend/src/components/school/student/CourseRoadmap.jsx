import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import EmptyState from "../../training/EmptyState";
import { buildSchoolRoadmap, moduleQuizChip } from "../../../lib/onlineSchoolPolish";
import { moduleHue, GOLD } from "../../../lib/moduleIcons";
import { CourseHero, ModuleCard, LockedModuleRun, groupCourseModules } from "./course/CourseCards";

const QUIZ_CHIP_CLS = {
  passed: "text-[#3a2e00]",
  ready: "text-[#3a2e00]",
  locked: "text-shTextMuted",
};

/* My Course — the client's training journey, drawn as a literal trail.
 *
 * The trail redesign (approved mock: "The Trail, in full color") runs a
 * colored spine down the page through numbered module nodes — green where
 * you've been, the module hue where you're going, gold at graduation — with
 * quiz milestones stamped on the spine.
 *
 * The DATA contract is unchanged. buildSchoolRoadmap still supplies module
 * status/locked_reason and the backend roadmap still owns every lock and
 * progression decision — this screen only presents them. Lesson clicks
 * navigate through the caller exactly as before.
 */

function TrailNode({ position, status, hue }) {
  const isCurrent = status === "current";
  const isDone = status === "completed" || status === "complete";
  const style = isCurrent
    ? { background: `linear-gradient(135deg, ${hue.grad[0]}, ${hue.grad[1]})`, borderColor: hue.main, color: "#04101a", boxShadow: `0 0 0 5px ${hue.main}33, 0 0 24px ${hue.main}99` }
    : isDone
      ? { background: "#8cc63f", borderColor: "#8cc63f", color: "#071018" }
      : { background: "var(--bg-base, #060c2e)", borderColor: `${hue.main}b0`, color: hue.main };
  return (
    <span aria-hidden="true"
          className="sh-display absolute -left-9 top-4 w-[34px] h-[34px] -translate-x-1/2 ml-4 rounded-full grid place-items-center text-[12.5px] border-[2.5px] z-[2]"
          style={style}>
      {isDone ? <i className="fas fa-check text-[12px]" /> : String(position).padStart(2, "0")}
    </span>
  );
}

function GraduationStop({ completed, dogName }) {
  return (
    <div className="relative mb-1">
      <span aria-hidden="true"
            className="absolute -left-9 top-4 w-[34px] h-[34px] -translate-x-1/2 ml-4 rounded-full grid place-items-center z-[2] border-[2.5px]"
            style={{ borderColor: GOLD.main, color: completed ? "#3a2e00" : GOLD.main,
                     background: completed ? `linear-gradient(135deg, ${GOLD.grad[0]}, ${GOLD.grad[1]})` : "rgba(242,201,76,.08)",
                     boxShadow: "0 0 20px rgba(242,201,76,.3)" }}>
        <i className="fas fa-graduation-cap text-[13px]" />
      </span>
      <div className={`rounded-2xl p-4 flex items-center gap-3 ${completed ? "" : "border border-dashed"}`}
           style={{ borderColor: "rgba(242,201,76,.5)",
                    border: completed ? "1px solid rgba(242,201,76,.6)" : undefined,
                    background: `radial-gradient(120% 200% at 0% 0%, rgba(242,201,76,${completed ? ".2" : ".12"}), transparent 55%)` }}
           data-testid="course-graduation-stop">
        <span className="w-11 h-11 rounded-xl grid place-items-center shrink-0 text-[#3a2e00] shadow-[inset_0_1px_0_rgba(255,255,255,.3)]"
              style={{ background: `linear-gradient(135deg, ${GOLD.grad[0]}, ${GOLD.grad[1]})` }}>
          <i className="fas fa-trophy text-[16px]" />
        </span>
        <span className="min-w-0">
          <span className="block text-[14px] font-black" style={{ color: "#ffe9ad" }}>
            {completed ? "Graduated!" : "Graduation"}
          </span>
          <span className="block text-[11px] text-shTextMuted mt-0.5 leading-relaxed" data-testid={completed ? "course-completed-banner" : undefined}>
            {completed
              ? "Course complete — every lesson above stays open for review."
              : `Certificate, trainer sign-off, and what to train next${dogName ? ` with ${dogName}` : ""}.`}
          </span>
        </span>
      </div>
    </div>
  );
}

export default function CourseRoadmap({ detail, progress, loading, onOpenLesson, onResume, onAbout }) {
  /* Trophy count for the hero tile — the same /portal/trophies read Student
     Home already does, filtered to this course's dog. Real data only: the
     tile renders once the count (possibly 0) has actually loaded. */
  const [trophyCount, setTrophyCount] = useState(null);
  const dogId = detail?.dog_id;
  useEffect(() => {
    let live = true;
    if (!dogId) return undefined;
    api.get("/portal/trophies")
      .then(({ data }) => {
        if (!live) return;
        const mine = (data?.dog_trophies || []).filter(t => !t.dog_id || t.dog_id === dogId || t.recipient_id === dogId);
        setTrophyCount(mine.length);
      })
      .catch(() => { if (live) setTrophyCount(0); });
    return () => { live = false; };
  }, [dogId]);

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
  /* position (1-based roadmap order) rides each module so the trail nodes and
     hue cycle survive locked-run folding untouched. */
  const modules = buildSchoolRoadmap(roadmap).map((m, i) => ({ ...m, position: i + 1 }));
  const currentLessonId = roadmap?.current_lesson?.id || null;
  const isCompleted = detail.status === "completed";

  return (
    <div className="space-y-4" data-testid="course-roadmap">
      <CourseHero detail={detail} roadmap={roadmap} progress={progress}
                  onResume={isCompleted ? null : onOpenLesson} onAbout={onAbout} trophyCount={trophyCount} />

      {/* Open lesson access — say WHY nothing is locked (the roadmap data
          already reflects it; this is presentation only). */}
      {!isCompleted && detail.open_lesson_access && (
        <div className="flex items-center gap-3 rounded-2xl px-4 py-3 border border-shSecondary/40"
             style={{ background: "radial-gradient(80% 200% at 0% 50%, rgba(0,169,224,.18), transparent 60%)" }}
             data-testid="course-open-access-banner">
          <span className="w-9 h-9 rounded-xl grid place-items-center shrink-0 text-[#04101a] shadow-[0_8px_18px_-6px_rgba(0,169,224,.7)]"
                style={{ background: "linear-gradient(135deg,#25b9ec,#00a9e0)" }}>
            <i className="fas fa-lock-open text-[13px]" />
          </span>
          <span className="min-w-0">
            <span className="block text-[12.5px] font-black text-shText">Open lesson access is on</span>
            <span className="block text-[11px] text-shTextMuted mt-0.5 leading-relaxed">Every lesson is unlocked — take them in any order. Today still shows our recommended next step.</span>
          </span>
        </div>
      )}

      {modules.length === 0 ? (
        <EmptyState icon="fa-book-open" message="This course doesn't have any modules yet." testid="course-roadmap-empty" />
      ) : (
        <div className="relative pl-9" data-testid="course-roadmap-modules">
          {/* The trail spine — green where you've been, shifting through the
              module hues, gold at graduation. Pure decoration over the same
              module list. */}
          <span aria-hidden="true" className="absolute left-4 top-2 bottom-3 w-[3px] rounded-full -translate-x-1/2"
                style={{ background: "linear-gradient(180deg, #8cc63f 0%, #00a9e0 26%, #8cc63f 52%, #f7941d 78%, #f2c94c 100%)", boxShadow: "0 0 14px rgba(0,169,224,.25)" }} />

          {/* A long run of consecutive LOCKED modules folds into one summary.
              Service Dog opens with one current module and twenty-three locked
              ones; as separate cards that is twenty-three near-identical
              "Complete X before continuing" blocks between the client and the
              rest of the page. Nothing is removed — the run expands. */}
          {groupCourseModules(modules).map((item) => {
            if (item.kind === "locked_run") {
              return (
                <div key={item.id} className="relative mb-3.5">
                  <span aria-hidden="true"
                        className="absolute -left-9 top-4 w-[34px] h-[34px] -translate-x-1/2 ml-4 rounded-full grid place-items-center z-[2] border-[2.5px] border-dashed border-shBorder text-shTextMuted"
                        style={{ background: "var(--bg-base, #060c2e)" }}>
                    <i className="fas fa-lock text-[11px]" />
                  </span>
                  <LockedModuleRun modules={item.modules} />
                </div>
              );
            }
            const m = item.module;
            const chip = moduleQuizChip(m.quiz);
            return (
              <div key={m.id} className="relative mb-3.5">
                <TrailNode position={m.position} status={m.status} hue={moduleHue(m.position)} />
                <ModuleCard
                  module={m}
                  currentLessonId={currentLessonId}
                  onOpenLesson={onOpenLesson}
                  position={m.position}
                  /* The module being worked on opens by default; a completed
                     course opens nothing, so review starts from a clean list. */
                  defaultOpen={!isCompleted && m.status === "current"}
                />
                {chip && (
                  /* The quiz milestone, stamped at the module's exit on the
                     spine — same server-derived chip vocabulary as before. */
                  <span className={`absolute -left-9 -bottom-2.5 -translate-x-1/2 ml-4 z-[2] text-[8px] font-black uppercase tracking-[0.08em] rounded-md px-1.5 py-0.5 -rotate-3 shadow-lg ${QUIZ_CHIP_CLS[chip.tone] || QUIZ_CHIP_CLS.locked}`}
                        style={chip.tone === "locked"
                          ? { background: "rgba(255,255,255,.08)", border: "1px solid rgba(96,128,196,.3)" }
                          : { background: `linear-gradient(135deg, ${GOLD.grad[0]}, ${GOLD.grad[1]})` }}
                        data-testid={`course-module-quiz-${m.id}`} title={chip.label}>
                    {chip.tone === "passed" ? "QUIZ ✓" : "QUIZ"}
                  </span>
                )}
              </div>
            );
          })}

          <GraduationStop completed={isCompleted} dogName={detail.dog_name} />
        </div>
      )}
    </div>
  );
}
