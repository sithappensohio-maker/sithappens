// Training UI Phase 5 — pure presentation helpers for the Trainer Daily
// Dashboard. Every function derives its answer from /admin/training/today
// rows already loaded by Pipeline.jsx — no second query, no new counters.

const RESOLUTION_REASON_LABELS = {
  no_active_enrollment: "No active training program",
  multiple_active_enrollments: "Multiple active programs — needs selection",
  no_current_module: "No current module set",
  no_lessons_in_module: "Current module is empty",
  current_lesson_requires_resolution: "Current lesson needs Admin resolution",
  legacy_curriculum_requires_migration: "Retired legacy curriculum — move into School",
};

// Header/summary metrics — a straight reduce over the already-loaded rows.
export function computeDaySummary(rows) {
  const list = rows || [];
  return {
    trainingToday: list.length,
    checkedIn: list.filter(r => r.checked_in).length,
    plansReady: list.filter(r => r.session_status === "plan_ready").length,
    inProgress: list.filter(r => r.session_status === "in_progress").length,
    needsReview: list.filter(r => _needsReview(r)).length,
    completed: list.filter(r => r.session_status === "completed").length,
  };
}

function _needsReview(r) {
  return !!r.client_question || (r.media_awaiting_review || 0) > 0 || (r.homework_difficulty_flags || 0) > 0;
}

// Documented status -> action mapping (the one obvious primary action per
// row). "not_checked_in" splits on the row's own `checked_in` flag: a dog
// that's physically checked in but has no plan yet should open a plan, not
// re-offer Check In. `reopen_count` distinguishes "resume a fresh plan"
// from "resume a reopened one" for plan_ready — both call the same
// open-workspace action, only the label differs.
export function resolvePrimaryAction(row) {
  if (row.resolution_reason === "legacy_curriculum_requires_migration") return { label: "Move into School", kind: "migrate_legacy" };
  if (!row.assigned_trainer_id) return { label: "Assign Trainer", kind: "assign_trainer" };
  if (row.session_status === "resolution_needed") return { label: "Resolve", kind: "open_workspace" };
  if (row.session_status === "completed") return { label: "View Completed Session", kind: "open_workspace" };
  if (row.session_status === "in_progress") return { label: "Continue Session", kind: "open_workspace" };
  if (row.session_status === "plan_ready") return { label: (row.reopen_count || 0) > 0 ? "Resume Draft" : "Continue Session", kind: "open_workspace" };
  if (!row.checked_in) return { label: "Check In", kind: "check_in" };
  return { label: "Open Plan", kind: "open_workspace" };
}

function _minutesAgo(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 60000));
}

export function relativeAge(iso) {
  const mins = _minutesAgo(iso);
  if (mins == null) return "";
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

// A plan_ready draft sitting unstarted for over an hour is worth flagging —
// draft_created_at is already stored on the draft, just newly surfaced.
const STALE_DRAFT_MINUTES = 60;
function _isStaleDraft(row) {
  if (row.session_status !== "plan_ready") return false;
  const mins = _minutesAgo(row.draft_created_at);
  return mins != null && mins >= STALE_DRAFT_MINUTES;
}

// Attention queue — compiled entirely from data already on today's rows.
// Each item: { key, bookingId, dogId, dogName, reason, age, actionLabel,
// actionKind, tone }. Deliberately scoped to TODAY's roster (the same data
// already loaded for the dashboard) rather than an all-time trainer-wide
// scan, which would need new backend aggregation outside this phase's
// "use existing data" constraint.
export function buildAttentionQueue(rows) {
  const items = [];
  for (const r of (rows || [])) {
    const base = { bookingId: r.booking_id, dogId: r.dog_id, dogName: r.dog_name };
    if (r.session_status === "resolution_needed") {
      items.push({ ...base, key: `resolve-${r.booking_id}`,
        reason: RESOLUTION_REASON_LABELS[r.resolution_reason] || "Needs attention",
        age: r.time || "Today",
        actionLabel: r.resolution_reason === "legacy_curriculum_requires_migration" ? "Move into School" : "Resolve",
        actionKind: r.resolution_reason === "legacy_curriculum_requires_migration" ? "migrate_legacy" : "open_workspace",
        tone: "danger" });
      continue; // a resolution-needed row has nothing else useful to say yet
    }
    if (r.client_question) {
      items.push({ ...base, key: `question-${r.booking_id}`, reason: "Client asked a question",
        age: "Awaiting reply", actionLabel: "Review Homework", actionKind: "review_homework", tone: "secondary" });
    }
    if ((r.media_awaiting_review || 0) > 0) {
      items.push({ ...base, key: `media-${r.booking_id}`,
        reason: `${r.media_awaiting_review} video${r.media_awaiting_review === 1 ? "" : "s"} awaiting review`,
        age: "New", actionLabel: "Review Homework", actionKind: "review_homework", tone: "accent" });
    }
    if ((r.homework_difficulty_flags || 0) > 0) {
      items.push({ ...base, key: `difficulty-${r.booking_id}`,
        reason: `${r.homework_difficulty_flags} difficult homework day${r.homework_difficulty_flags === 1 ? "" : "s"}`,
        age: "This week", actionLabel: "Review Homework", actionKind: "review_homework", tone: "accent" });
    }
    if ((r.needs_reassessment_count || 0) > 0) {
      items.push({ ...base, key: `reassess-${r.booking_id}`,
        reason: `${r.needs_reassessment_count} skill${r.needs_reassessment_count === 1 ? "" : "s"} flagged for reassessment`,
        age: "Next session", actionLabel: "Open Plan", actionKind: "open_workspace", tone: "secondary" });
    }
    if ((r.reopen_count || 0) > 0 && r.session_status !== "completed") {
      items.push({ ...base, key: `reopened-${r.booking_id}`, reason: "Session was reopened",
        age: "Today", actionLabel: "Resume Draft", actionKind: "open_workspace", tone: "muted" });
    }
    if (_isStaleDraft(r)) {
      items.push({ ...base, key: `stale-${r.booking_id}`, reason: "Plan ready but not yet started",
        age: relativeAge(r.draft_created_at), actionLabel: "Continue Session", actionKind: "open_workspace", tone: "muted" });
    }
  }
  return items;
}

// Simple filters — "my_dogs" now uses the REAL trainer id assigned to
// today's booking (or the program-level assigned trainer fallback).  No name
// matching, no "last person who touched the dog" proxy.
export function filterTrainingRows(rows, filter, viewer) {
  const list = rows || [];
  switch (filter) {
    case "my_dogs":
      return list.filter(r => r.assigned_trainer_id && viewer?.id && r.assigned_trainer_id === viewer.id);
    case "not_checked_in": return list.filter(r => r.session_status === "not_checked_in");
    case "ready": return list.filter(r => r.session_status === "plan_ready");
    case "in_progress": return list.filter(r => r.session_status === "in_progress");
    case "needs_review": return list.filter(r => _needsReview(r) || r.session_status === "resolution_needed");
    case "completed": return list.filter(r => r.session_status === "completed");
    default: return list;
  }
}
