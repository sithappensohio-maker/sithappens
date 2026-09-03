import { useEffect, useState } from "react";
import { api } from "../../../lib/api";
import { greeting } from "../../../lib/studentSchool";
import TrainerCard from "./TrainerCard";
import LatestFeedbackCard from "./LatestFeedbackCard";
import CourseCompletionCard from "./CourseCompletionCard";
import SchoolOrientation, { actionCoachCopy, doThisNowCopy } from "./SchoolOrientation";
import { PracticeCard, NextMilestoneCard, ProgressRow } from "./today/TodayCards";

/* Today's command card. Mobile hierarchy, top to bottom:
 *   lesson / current task name
 *   one plain sentence ("do this now")
 *   THE button
 *   then the fuller explanation and progress.
 * The customer understands the button before tapping it without reading
 * several paragraphs first, and on a 320×568 phone the button is on screen
 * without scrolling. The backend's current_action stays the source of truth. */
function TodayCommandCard({ home, onPrimaryAction, onViewCourse }) {
  const action = home?.current_action || {};
  const lesson = home?.current_lesson || {};
  const progress = home?.progress || {};
  const pct = Math.max(0, Math.min(100, Number(progress.course_pct || 0)));
  const lessonPosition = progress.lessons_total
    ? `Lesson ${Math.min((progress.lessons_completed || 0) + 1, progress.lessons_total)} of ${progress.lessons_total}`
    : null;
  const noButton = ["awaiting_review", "access_expired", "course_paused", "setup_required"].includes(action.type);
  const title = lesson.name || action.label || "Your next training step";
  const doNow = doThisNowCopy(action, home?.dog?.name, lesson.name);

  return (
    <section className="rounded-3xl border border-shPrimary/40 bg-gradient-to-br from-shPrimary/[0.11] via-black/18 to-shSecondary/[0.055] overflow-hidden" data-testid="today-command-center">
      <div className="p-4 sm:p-7">
        <p className="text-[13px] font-black uppercase tracking-[0.2em] text-shPrimary"><i className="fas fa-location-arrow mr-1.5"/>Today&apos;s Next Step</p>
        <p className="text-[14px] text-shTextMuted mt-1 truncate">{home?.program?.name || "Your training program"}{home?.dog?.name ? ` · ${home.dog.name}` : ""}</p>
        <h2 className="text-[24px] sm:text-[32px] font-black text-shText leading-tight mt-2 text-balance">{title}</h2>
        {doNow && <p className="text-[17px] sm:text-[19px] text-shText mt-1.5 leading-snug" data-testid="today-do-now">{doNow}</p>}

        {!noButton && (
          <button type="button" onClick={onPrimaryAction} data-testid="today-primary-action" data-school-primary="true"
                  className="mt-3.5 w-full min-h-[58px] rounded-xl bg-shPrimary text-[#071018] font-black text-[17px] sm:text-[18px] uppercase tracking-widest inline-flex items-center justify-center gap-2 hover:brightness-110 transition shadow-[0_12px_34px_-12px_rgba(140,198,63,0.8)]">
            {action.label || "Continue Training"}<i className="fas fa-arrow-right text-[14px]"/>
          </button>
        )}

        <div className="mt-4 rounded-2xl border border-white/10 bg-black/18 p-3.5 sm:p-4">
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-shSecondary">What you do now</p>
          <p className="text-[17px] sm:text-[19px] text-shText mt-1.5 leading-relaxed">{actionCoachCopy(action, home?.dog?.name)}</p>
        </div>

        <div className="mt-4 pt-4 border-t border-white/10">
          <div className="flex items-center justify-between gap-3 text-[14px]">
            <span className="font-black text-shText">{lessonPosition || "Your program"}</span>
            <span className="font-black text-shPrimary">{Math.round(pct)}% complete</span>
          </div>
          <div className="h-2 rounded-full bg-black/40 overflow-hidden mt-2" aria-hidden="true">
            <div className="h-full rounded-full bg-shPrimary transition-all" style={{ width: `${pct}%` }}/>
          </div>
          <button type="button" onClick={onViewCourse} className="mt-2 min-h-[40px] px-1 text-[13px] font-black uppercase tracking-widest text-shSecondary hover:text-shText" data-testid="today-command-view-course">
            All lessons <i className="fas fa-chevron-right ml-1 text-[11px]"/>
          </button>
        </div>
      </div>
    </section>
  );
}

/* Student Today is the command center, not a dashboard. The backend's
 * current_action remains the source of truth; this screen turns it into one
 * unmistakable instruction and one primary button. */
export default function StudentHome({ home, loading, clientName, blockedByOnboarding = false, onPrimaryAction, onAsk, onViewFeedback, onViewProgress, onViewCourse, onOpenPractice }) {
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
        <div className="h-64 rounded-3xl bg-shBorder/25 animate-pulse" />
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="h-24 rounded-2xl bg-shBorder/20 animate-pulse" />
          <div className="h-24 rounded-2xl bg-shBorder/20 animate-pulse" />
        </div>
      </div>
    );
  }

  if (!home && blockedByOnboarding) {
    // Step 0. The one-time setup form renders directly under this card
    // (StudentWorkspaceExtras) — one thing to do, and it is right here.
    return (
      <div className="space-y-4" data-testid="student-home-setup-first">
        <section className="rounded-3xl border border-shPrimary/35 bg-gradient-to-br from-shPrimary/[0.12] via-black/15 to-shSecondary/[0.05] p-4 sm:p-7">
          <p className="text-[13px] font-black uppercase tracking-[0.22em] text-shPrimary"><i className="fas fa-location-arrow mr-1.5"/>Step 0 · Before your first lesson</p>
          <h1 className="text-[24px] sm:text-[32px] font-black text-shText mt-2 leading-tight text-balance">Tell us a little about your dog, then we start training.</h1>
          <p className="text-[17px] sm:text-[19px] text-shText mt-2 leading-snug">Answer the short questions right below this. When you save them, School opens your first lesson.</p>
          <p className="text-[15px] text-shTextMuted mt-2 leading-relaxed"><i className="fas fa-arrow-down mr-1.5 text-shPrimary" aria-hidden="true" />The questions are just below. A sentence or two each is plenty.</p>
        </section>
      </div>
    );
  }

  if (!home) {
    return (
      <div className="space-y-4" data-testid="student-home-unavailable">
        <section className="rounded-3xl border border-shPrimary/35 bg-gradient-to-br from-shPrimary/[0.12] via-black/15 to-shSecondary/[0.05] p-6 sm:p-8">
          <p className="text-[13px] font-black uppercase tracking-[0.22em] text-shPrimary">Start here</p>
          <h1 className="text-[26px] sm:text-[34px] font-black text-shText mt-1 leading-tight text-balance">One quick step before training</h1>
          <p className="text-[18px] sm:text-[20px] text-shTextMuted mt-3 leading-relaxed max-w-2xl">
            If you see the one-time setup below, complete that first. When you save it, your Today plan will load automatically and School will tell you exactly what to do next.
          </p>
          <p className="text-[16px] sm:text-[17px] text-shTextMuted mt-2 leading-relaxed max-w-2xl">
            Already finished the setup? Open All Lessons and continue from the first available lesson.
          </p>
          <button type="button" onClick={onViewCourse} data-testid="student-home-open-course-fallback"
                  className="mt-5 w-full sm:w-auto sm:px-8 min-h-[56px] rounded-xl border border-shBorder bg-black/15 text-shText font-black text-[16px] sm:text-[17px] uppercase tracking-widest inline-flex items-center justify-center gap-2 hover:border-shPrimary/40 transition">
            Open All Lessons <i className="fas fa-arrow-right text-[14px]" />
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
          <h1 className="text-shText font-black text-[20px] sm:text-[26px] leading-tight text-balance">{greeting(clientName)}</h1>
          {home.dog?.name && <p className="text-[14px] sm:text-[16px] text-shTextMuted mt-0.5">School will tell you exactly what {home.dog.name} needs next.</p>}
        </div>
        <SchoolOrientation dogName={home.dog?.name} />
      </header>

      {completed ? (
        <CourseCompletionCard home={home} onCourse={onViewCourse} onProgress={onViewProgress} onFeedback={onViewFeedback} />
      ) : (
        <TodayCommandCard home={home} onPrimaryAction={onPrimaryAction} onViewCourse={onViewCourse} />
      )}

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
