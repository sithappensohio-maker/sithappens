// Training UI Phase 3 — compact weekly summary chip row. Purely
// presentational; every number is computed by the caller from data already
// loaded (homework list, bookings) — no second streak/progress calculation.
import StatusChip from "./StatusChip";

export default function WeeklyPracticeSummary({ todayCompleted, todayTotal, weekCompleted, streak, nextAppointment, feedbackWaiting, testid }) {
  return (
    <div className="flex flex-wrap gap-2" data-testid={testid}>
      {todayTotal > 0 && (
        <StatusChip icon="fa-circle-check" label="Today" value={`${todayCompleted}/${todayTotal}`} tone={todayCompleted >= todayTotal ? "primary" : "muted"}/>
      )}
      <StatusChip icon="fa-calendar-week" label="This Week" value={weekCompleted} tone="secondary"/>
      {streak > 0 && <StatusChip icon="fa-fire" label="Day Streak" value={streak} tone="accent"/>}
      {nextAppointment && <StatusChip icon="fa-calendar-day" label="Next Visit" value={nextAppointment} tone="muted"/>}
      {feedbackWaiting > 0 && <StatusChip icon="fa-comment-dots" label="Trainer Feedback" value={feedbackWaiting} tone="secondary"/>}
    </div>
  );
}
