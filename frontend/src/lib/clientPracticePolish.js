// Training UI Phase 3 — pure presentation helpers for the Client Today /
// Homework Practice screens. Every function here derives its answer from
// homework data the app already loads (GET /homework) — no new streak or
// progress calculation, no second source of truth for anything the backend
// already computes (daily_progress, streak, section_logs).
import { todayISO, daysAgoISO } from "./date";

const STATUS_ORDER = ["overdue", "needs_redo", "in_progress", "waiting_review", "not_started", "completed"];

// One assignment card's derived visual state. Handles BOTH homework shapes:
// daily-tracker (day-by-day, needs `daily_progress` from GET /homework) and
// single-log/section-based (template_snapshot.sections, section_logs).
export function assignmentCardModel(hw) {
  const isOverdue = hw.due_date && hw.due_date < todayISO() && hw.status !== "completed";

  if (hw.daily_tracker) {
    const progress = hw.daily_progress || [];
    const actionableDay = progress.find(p => p.status === "available" || p.status === "needs_redo");
    const anySubmitted = progress.some(p => p.log);
    let status, primaryAction;
    if (hw.status === "completed") {
      status = "completed"; primaryAction = "Review";
    } else if (actionableDay?.status === "needs_redo") {
      status = "needs_redo"; primaryAction = "Try Again";
    } else if (actionableDay) {
      status = anySubmitted ? "in_progress" : "not_started";
      primaryAction = anySubmitted ? "Continue" : "Start Practice";
    } else {
      status = "waiting_review"; primaryAction = "Review";
    }
    if (isOverdue && status !== "completed") status = "overdue";

    const lastLoggedDay = [...progress].reverse().find(p => p.log);
    const attentionLabel = lastLoggedDay?.log?.difficulty && ["hard", "very_hard"].includes(lastLoggedDay.log.difficulty)
      ? "Marked Difficult Last Time" : null;

    return {
      status, primaryAction,
      sessionsRequired: progress.length ? `Day ${Math.min((actionableDay?.day_number) || progress.length, progress.length)} of ${progress.length}` : null,
      attentionLabel,
      actionableDay: actionableDay || null,
      kind: "daily_tracker",
    };
  }

  // Section-based (single-log) homework — no per-day locking, always
  // available to log another session until marked complete.
  const logs = hw.section_logs || [];
  let status = hw.status === "completed" ? "completed" : (logs.length > 0 ? "in_progress" : "not_started");
  if (isOverdue && status !== "completed") status = "overdue";
  const firstSection = (hw.template_snapshot?.sections || [])[0];
  const targetField = firstSection?.fields?.find(f => f.target);
  return {
    status,
    primaryAction: status === "completed" ? "Review" : (logs.length > 0 ? "Log Another Practice" : "Start Practice"),
    sessionsRequired: targetField ? `Goal: ${targetField.target}` : (logs.length ? `${logs.length} logged` : null),
    attentionLabel: null,
    actionableDay: null,
    kind: "section_log",
  };
}

// Sort assignments so what needs attention surfaces first; completed items
// stay in the list (visually settled) rather than disappearing.
export function sortAssignments(homeworkList) {
  return [...homeworkList].sort((a, b) => {
    const oa = STATUS_ORDER.indexOf(assignmentCardModel(a).status);
    const ob = STATUS_ORDER.indexOf(assignmentCardModel(b).status);
    if (oa !== ob) return oa - ob;
    return String(a.due_date || "").localeCompare(String(b.due_date || ""));
  });
}

// Group assignments by dog, in the SAME order as the client's dogs list —
// never blended, per the multi-dog household requirement.
export function groupByDog(homeworkList, dogs) {
  const byDog = new Map(dogs.map(d => [d.id, { dog: d, items: [] }]));
  for (const hw of homeworkList) {
    if (!byDog.has(hw.dog_id)) byDog.set(hw.dog_id, { dog: { id: hw.dog_id, name: hw.dog_name }, items: [] });
    byDog.get(hw.dog_id).items.push(hw);
  }
  return [...byDog.values()].filter(g => g.items.length > 0);
}

function loggedToday(hw) {
  const today = todayISO();
  if (hw.daily_tracker) return (hw.daily_progress || []).some(p => p.log && (p.log.date || "").slice(0, 10) === today);
  return (hw.section_logs || []).some(l => (l.date || "") === today);
}

function logDatesWithinWeek(hw) {
  const since = daysAgoISO(7);
  if (hw.daily_tracker) return (hw.daily_progress || []).filter(p => p.log && (p.log.date || "").slice(0, 10) >= since).length;
  return (hw.section_logs || []).filter(l => (l.date || "") >= since).length;
}

// Weekly summary chip data — every number is a tally over data already in
// `homeworkList` (from GET /homework); the streak is the max of the
// server-computed `hw.streak` values, never recomputed.
export function weeklyPracticeStats(homeworkList) {
  const active = homeworkList.filter(hw => hw.status !== "completed");
  const todayCandidates = active.filter(hw => {
    const m = assignmentCardModel(hw);
    return m.status !== "locked" && m.status !== "waiting_review";
  });
  const todayTotal = todayCandidates.length;
  const todayCompleted = todayCandidates.filter(loggedToday).length;
  const weekCompleted = homeworkList.reduce((sum, hw) => sum + logDatesWithinWeek(hw), 0);
  const streak = homeworkList.reduce((max, hw) => Math.max(max, Number(hw.streak) || 0), 0);
  const feedbackWaiting = homeworkList.reduce((sum, hw) => {
    if (!hw.daily_tracker) return sum;
    const answered = (hw.daily_progress || []).reduce((s, p) => s + (p.questions || []).filter(q => q.answer).length, 0);
    return sum + answered;
  }, 0);
  return { todayTotal, todayCompleted, weekCompleted, streak, feedbackWaiting };
}
