/* Stage 11 — Trainer Daily Queue presentation helpers.
 *
 * The server's GET /admin/training/day already returns one deduped, ordered
 * list of items with a section, ONE primary action and a reason when there
 * is none. These helpers only group and label — no data is derived here that
 * the server did not already decide. */

export const SECTIONS = [
  { key: "needs_attention", title: "Needs attention", hint: "Blocking progression or waiting on you", icon: "fa-bell", tone: "accent" },
  { key: "today", title: "Today's training", hint: "Dogs you are expected to work with today", icon: "fa-paw", tone: "primary" },
  { key: "continue", title: "Continue", hint: "Started but not finished", icon: "fa-person-running", tone: "secondary" },
  { key: "upcoming", title: "Upcoming", hint: "Scheduled after today", icon: "fa-calendar-day", tone: "muted" },
  { key: "done", title: "Done today", hint: "What got finished today", icon: "fa-flag-checkered", tone: "muted" },
];

/* Stage 12 — the SAME hub, presented for who is using it. The owner (anyone who may
 * assign training staff) oversees the operation; a trainer teaches their dogs. */
export function hubPresentation({ canAssign = false } = {}) {
  return canAssign
    ? { eyebrow: "Training Operations", title: "Training Operations.", highlight: "Today, staff, reviews.",
        subtitle: "See today's training, staff workload, reviews, programs and items needing attention.", heading: "Today's operation" }
    : { eyebrow: "My Training Day", title: "My Training Day.", highlight: "Your dogs, your reviews.",
        subtitle: "Your assigned dogs, reviews, sessions and next actions.", heading: "Your day" };
}

/** Work that needs a trainer and has none — only ever shown to someone who can assign. */
export function needsAssignmentCount(items) {
  return (items || []).filter((it) => it && it.needs_assignment).length;
}

export const MODE_LABELS = { in_person: "In person", online: "Online", hybrid: "Hybrid" };

export const ACTION_LABELS = {
  start_session: "Start session",
  resume_session: "Resume session",
  resolve_session: "Resolve",
  view_session: "View session",
  review_checkpoint: "Review checkpoint",
  review_practice: "Review practice",
  review_daily: "Review daily work",
  open_trainer_assist: "Open Trainer Assist",
  open_dog: "View dog",
  check_in: "Check in",
};

/** Items grouped by section in display order; empty sections omitted. */
export function groupTrainerDay(items, { mineOnly = false, needsAssignmentOnly = false } = {}) {
  const list = (items || []).filter((it) => it && (!mineOnly || it.mine !== false) && (!needsAssignmentOnly || it.needs_assignment));
  return SECTIONS.map((s) => ({ ...s, items: list.filter((it) => it.section === s.key) })).filter((s) => s.items.length > 0);
}

/** What still needs the trainer (everything except upcoming/done). */
export function actionableCount(items, opts) {
  return groupTrainerDay(items, opts).filter((s) => s.key !== "upcoming" && s.key !== "done").reduce((n, s) => n + s.items.length, 0);
}

/** Second line under the dog: Program · Module · Lesson, only the parts that exist. */
export function contextLine(item) {
  return [item?.program?.name, item?.lesson?.module_name, item?.lesson?.lesson_name].filter(Boolean).join(" · ");
}

export function modeLabel(mode) {
  return MODE_LABELS[mode] || null;
}

/** "3h ago" / "2d ago" from an ISO timestamp — how long this has waited. */
export function waitedLabel(iso, now = Date.now()) {
  if (!iso) return null;
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return mins <= 1 ? "just now" : `${mins}m waiting`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h waiting`;
  return `${Math.floor(hrs / 24)}d waiting`;
}

/** The empty state is a calm, truthful sentence — never a manufactured task. */
export function emptyStateCopy({ upcomingCount = 0, mineOnly = false } = {}) {
  return {
    title: "You're caught up.",
    body: mineOnly ? "No training work assigned to you needs attention right now." : "No training work currently needs your attention.",
    upcoming: upcomingCount > 0 ? `${upcomingCount} lesson${upcomingCount === 1 ? "" : "s"} scheduled after today.` : null,
  };
}
