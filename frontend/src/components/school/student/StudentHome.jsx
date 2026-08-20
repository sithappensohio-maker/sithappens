import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { greeting } from "../../../lib/studentSchool";
import TrainerCard from "./TrainerCard";
import LatestFeedbackCard from "./LatestFeedbackCard";
import CourseCompletionCard from "./CourseCompletionCard";
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
  if (!home) return null;

  const hasUnansweredQuestion = !!home.trainer?.has_unanswered_question;
  const completed = home.status === "completed";

  return (
    <div className="space-y-4" data-testid="student-home">
      <header>
        <h1 className="text-shText font-black text-[22px] sm:text-[26px] leading-tight text-balance">
          {greeting(clientName)}
        </h1>
        {home.dog?.name && (
          <p className="text-[13px] text-shTextMuted mt-0.5">Here&rsquo;s {home.dog.name}&rsquo;s plan for today.</p>
        )}
      </header>

      {completed ? (
        <CourseCompletionCard home={home} onProgress={onViewProgress} onFeedback={onViewFeedback} />
      ) : (
        <>
          <ProgramHeroCard home={home} onViewCourse={onViewCourse} />
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
