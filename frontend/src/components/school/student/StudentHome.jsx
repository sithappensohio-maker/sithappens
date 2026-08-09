import { greeting } from "../../../lib/studentSchool";
import CurrentTrainingCard from "./CurrentTrainingCard";
import TrainerCard from "./TrainerCard";
import LatestFeedbackCard from "./LatestFeedbackCard";
import ProgressSummary from "./ProgressSummary";
import UpcomingCard from "./UpcomingCard";
import CourseCompletionCard from "./CourseCompletionCard";

/* Student Home — the command center. Small composition over the backend
 * view-model (/portal/school/{id}/home); each section is its own component.
 * The hero's primary CTA reflects the server-derived current_action. */
export default function StudentHome({ home, loading, clientName, onPrimaryAction, onAsk, onViewFeedback, onViewProgress }) {
  if (loading && !home) {
    return (
      <div className="space-y-4" data-testid="student-home-loading">
        <div className="h-8 w-48 rounded bg-shBorder/40 animate-pulse" />
        <div className="h-44 rounded-2xl bg-shBorder/30 animate-pulse" />
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="h-40 rounded-2xl bg-shBorder/20 animate-pulse" />
          <div className="h-40 rounded-2xl bg-shBorder/20 animate-pulse" />
        </div>
      </div>
    );
  }
  if (!home) return null;

  const hasUnansweredQuestion = !!home.trainer?.has_unanswered_question;

  return (
    <div className="space-y-4 sm:space-y-5" data-testid="student-home">
      <header>
        <h1 className="text-shText font-black text-[22px] sm:text-[26px] leading-tight text-balance">
          {greeting(clientName)}
        </h1>
        {home.dog?.name && (
          <p className="text-[13px] text-shTextMuted mt-0.5">Here's where {home.dog.name} is at.</p>
        )}
      </header>

      {home.status === "completed" ? (
        <CourseCompletionCard home={home} onProgress={onViewProgress} onFeedback={onViewFeedback} />
      ) : (
        <CurrentTrainingCard home={home} onPrimary={onPrimaryAction} />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4 min-w-0">
          <LatestFeedbackCard feedback={home.latest_feedback} onView={onViewFeedback} />
          <ProgressSummary progress={home.progress} onView={onViewProgress} />
        </div>
        <div className="space-y-4 min-w-0">
          <TrainerCard trainer={home.trainer} onAsk={onAsk} onViewFeedback={onViewFeedback}
                       hasUnansweredQuestion={hasUnansweredQuestion} unreadReplies={home.trainer?.unread_replies || 0} />
          <UpcomingCard upcoming={home.upcoming} />
        </div>
      </div>
    </div>
  );
}
