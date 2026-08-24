import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { greeting } from "../../../lib/studentSchool";
import TrainerCard from "./TrainerCard";
import LatestFeedbackCard from "./LatestFeedbackCard";
import CourseCompletionCard from "./CourseCompletionCard";
import SchoolOrientation, { CurrentActionGuide } from "./SchoolOrientation";
import { ProgramHeroCard, CurrentLessonCard, PracticeCard, NextMilestoneCard, ProgressRow } from "./today/TodayCards";

/* Student Today — the client's daily plan.
 *
 * Redesigned per the client-experience brief: guided rather than
 * dashboard-like, one unmistakable primary action, and trainer presence kept
 * prominent instead of buried. The composition order below IS the brief's
 * priority order — program, current lesson + Continue, practice, trainer
 * feedback, next milestone, progress snapshot.
 *
 * The backend view-model (/portal/school/{id}/home) is unchanged and remains
 * the source of truth: current_action decides the primary CTA, so this screen
 * never second-guesses what the student should do next.
 */
export default function StudentHome({ home, loading, clientName, onPrimaryAction, onAsk, onViewFeedback, onViewProgress, onViewCourse, onOpenPractice }) {
  // Real awarded trophies for the badge tile. Failure is silent and the tile
  // simply shows 0 — a decorative metric must never break the day's plan.
  const [trophyCount, setTrophyCount] = useState(null);
  const dogId = home?.dog?.id;
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

  if (loading && !home) {
    return (
      <div className="space-y-4" data-testid="student-home-loading">
        <div className="h-8 w-48 rounded bg-shBorder/40 animate-pulse" />
        <div className="h-32 rounded-2xl bg-shBorder/30 animate-pulse" />
        <div className="h-40 rounded-2xl bg-shBorder/20 animate-pulse" />
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="h-24 rounded-2xl bg-shBorder/20 animate-pulse" />
          <div className="h-24 rounded-2xl bg-shBorder/20 animate-pulse" />
        </div>
      </div>
    );
  }

  /* Never leave a beginner staring at an empty School page. StudentWorkspaceExtras
     renders the one-time onboarding form immediately below this card when that
     is what blocked the Today view-model. Keep this copy aligned with that
     recovery path instead of sending the student away from the form they need. */
  if (!home) {
    return (
      <div className="space-y-4" data-testid="student-home-unavailable">
        <section className="rounded-3xl border border-shPrimary/35 bg-gradient-to-br from-shPrimary/[0.12] via-black/15 to-shSecondary/[0.05] p-6 sm:p-8">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-shPrimary">Start here</p>
          <h1 className="text-[26px] sm:text-[34px] font-black text-shText mt-1 leading-tight text-balance">One quick step before training</h1>
          <p className="text-[15px] sm:text-[17px] text-shTextMuted mt-3 leading-relaxed max-w-2xl">
            If you see the one-time setup below, complete that first. When you save it, your Today plan will load automatically and School will tell you exactly what to do next.
          </p>
          <p className="text-[13px] sm:text-[14px] text-shTextMuted mt-2 leading-relaxed max-w-2xl">
            Already finished the setup? You can open your course and continue from the first available lesson.
          </p>
          <button type="button" onClick={onViewCourse} data-testid="student-home-open-course-fallback"
                  className="mt-5 w-full sm:w-auto sm:px-8 min-h-[56px] rounded-xl border border-shBorder bg-black/15 text-shText font-black text-[13px] sm:text-[14px] uppercase tracking-widest inline-flex items-center justify-center gap-2 hover:border-shPrimary/40 transition">
            Open my course <i className="fas fa-arrow-right text-[11px]" />
          </button>
        </section>
      </div>
    );
  }

  const hasUnansweredQuestion = !!home.trainer?.has_unanswered_question;
  const completed = home.status === "completed";

  return (
    <div className="space-y-4" data-testid="student-home">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-shText font-black text-[22px] sm:text-[26px] leading-tight text-balance">{greeting(clientName)}</h1>
          {home.dog?.name && <p className="text-[13px] text-shTextMuted mt-0.5">Here&rsquo;s {home.dog.name}&rsquo;s plan for today.</p>}
        </div>
        <SchoolOrientation dogName={home.dog?.name} />
      </header>

      {completed ? (
        <CourseCompletionCard home={home} onCourse={onViewCourse} onProgress={onViewProgress} onFeedback={onViewFeedback} />
      ) : (
        <>
          <ProgramHeroCard home={home} onViewCourse={onViewCourse} />
          <CurrentActionGuide home={home} />
          <CurrentLessonCard home={home} onPrimary={onPrimaryAction} />
        </>
      )}

      {/* Below the fold on mobile, side-by-side from lg. Practice and trainer
          feedback are the two things a client checks between sessions. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4 min-w-0">
          {!completed && <PracticeCard practice={home.active_practice} onOpen={onOpenPractice} />}
          {!completed && <NextMilestoneCard home={home} onOpen={onViewCourse} />}
        </div>
        <div className="space-y-4 min-w-0">
          <LatestFeedbackCard feedback={home.latest_feedback} onView={onViewFeedback} />
          <TrainerCard trainer={home.trainer} onAsk={onAsk} onViewFeedback={onViewFeedback}
                       hasUnansweredQuestion={hasUnansweredQuestion} unreadReplies={home.trainer?.unread_replies || 0} />
        </div>
      </div>

      <ProgressRow progress={home.progress} trophyCount={trophyCount} onViewAll={onViewProgress} />
    </div>
  );
}
