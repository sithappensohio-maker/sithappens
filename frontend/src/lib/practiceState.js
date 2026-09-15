import { makeHandoff, HANDOFF_LABELS } from "./handoff";
/* Client-facing words for the server's practice summary on a Today practice
 * row (portal_school_home.active_practice):
 *   required_practice_satisfied · sessions_logged · last_session_at
 *
 * These helpers only PHRASE what the server already decided. Nothing here
 * infers whether practice happened from raw logs — that stays on the server,
 * with the same predicate School's gates use. */

/** What the row is called on School surfaces: the lesson it belongs to when the
 *  server names one, otherwise the homework's own title. */
import { assignmentCardModel } from "./clientPracticePolish";

export function practiceTitle(hw) {
  return (hw && (hw.school_lesson_name || hw.title)) || "Practice";
}

export function isRequiredPracticeSatisfied(hw) {
  return !!(hw && hw.required_practice_satisfied === true);
}

export function loggedToday(hw, now = new Date()) {
  const at = hw?.last_session_at;
  if (!at) return false;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return false;
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

export function sessionsLabel(hw) {
  const n = Number(hw?.sessions_logged) || 0;
  if (n <= 0) return "";
  return `${n} session${n === 1 ? "" : "s"} logged`;
}

/** { title, detail } for a satisfied row, e.g.
 *  "Practice logged today" / "1 session logged · Practice again any time". */
export function practiceLoggedLabel(hw, now = new Date()) {
  const title = loggedToday(hw, now) ? "Practice logged today" : "Practice logged";
  const parts = [sessionsLabel(hw), "Practice again any time"].filter(Boolean);
  return { title, detail: parts.join(" · ") };
}


/* ─── Stage 4 — Practice screen helpers ─────────────────────────────────────
 * These only PHRASE server state. The primary item follows Today's NOW
 * (journey.now.practice, i.e. the existing current-action engine) whenever it
 * names a row; otherwise the same urgency buckets the screen always used.
 * Nothing here decides gating, counts or completion. */

/** Status words for one row, via the existing card model (daily-tracker
 *  waiting_review / needs_redo / in_progress / not_started / completed). */
export function practiceRowStatus(hw) {
  try { return assignmentCardModel(hw || {}); } catch { return { status: hw?.status === "completed" ? "completed" : "not_started" }; }
}

/** "2 of 4 days complete" for daily trackers, "3 sessions logged" for
 *  section Practice with logs, else null — never a fake progress line. */
export function practiceProgressLabel(hw) {
  if (!hw) return null;
  if (hw.daily_tracker) {
    const days = hw.daily_progress || [];
    const total = days.length || Number(hw.total_days) || 0;
    if (!total) return null;
    const done = days.filter((d) => d && d.log && !d.is_rest_day).length;
    return `${done} of ${total} days complete`;
  }
  const n = Number(hw.sessions_logged) || 0;
  return n > 0 ? `${n} session${n === 1 ? "" : "s"} logged` : null;
}

/** The one thing to do today. Returns
 *  { kind: "practice", hw, reason } | { kind: "locked", practice } | null. */
export function primaryPractice(home, buckets) {
  const b = buckets || {};
  const open = [...(b.overdue || []), ...(b.due || []), ...(b.recommended || []), ...(b.upcoming || [])];
  const now = home?.journey?.now;
  if (now?.practice?.id && ["practice", "practice_row", "remediation"].includes(now.kind)) {
    const hit = open.find((hw) => hw.id === now.practice.id);
    if (hit) return { kind: "practice", hw: hit, reason: now.kind === "remediation" ? "remediation" : (b.overdue || []).some((x) => x.id === hit.id) ? "overdue" : "now" };
  }
  const recap = home?.journey?.recap;
  if (recap?.practice?.state === "locked" && recap.prominence === "prominent") {
    return { kind: "locked", practice: recap.practice };
  }
  // Today promotes the Practice the trainer assigned at the last lesson while
  // the recap is prominent — the Practice screen must agree.
  if (recap?.practice?.id && recap.prominence === "prominent" && recap.practice.state === "due") {
    const hit = open.find((hw) => hw.id === recap.practice.id);
    if (hit) return { kind: "practice", hw: hit, reason: (b.overdue || []).some((x) => x.id === hit.id) ? "overdue" : "session" };
  }
  // A row waiting for the trainer is not something to DO today; prefer any
  // actionable row, and only feature the waiting one when nothing else is open.
  const actionable = (rows) => rows.filter((hw) => practiceRowStatus(hw).status !== "waiting_review");
  for (const [rows, reason] of [[b.overdue, "overdue"], [b.due, "due"], [b.recommended, "now"], [b.upcoming, "open"]]) {
    const act = actionable(rows || []);
    if (act.length) return { kind: "practice", hw: act[0], reason };
  }
  if (open.length) return { kind: "practice", hw: open[0], reason: "review" };
  return null;
}

/** Truthful empty state from the current action + delivery mode. */
export function practiceEmptyState(home) {
  const t = home?.current_action?.type;
  const mode = home?.delivery_mode;
  if (t === "course_complete") return { kind: "complete", icon: "fa-graduation-cap", eyebrow: "Program complete", title: "Practice complete", body: "You've finished this program. Every lesson stays open for review.", intro: "You've finished this program.", cta: null };
  if (t === "awaiting_review") return { kind: "review", icon: "fa-hourglass-half", eyebrow: "Checkpoint", title: "No Practice right now", body: "Your checkpoint is waiting for trainer review. You don't need to do anything else.", intro: "Your checkpoint is with your trainer.", cta: null };
  if (t === "trainer_assist") return { kind: "assist", icon: "fa-hand-holding-heart", eyebrow: "Trainer Assist", title: "No Practice right now", body: "Your trainer will work through this with you in person.", intro: "Your trainer is stepping in.", cta: null };
  if (mode === "in_person" || mode === "trainer_led") return { kind: "trainer_led", icon: "fa-person-chalkboard", eyebrow: "Trainer-led", title: "Nothing to practice right now", body: "Your trainer will assign Practice after your lesson.", intro: "Your trainer assigns Practice after each lesson.", cta: null };
  return { kind: "caught_up", icon: "fa-circle-check", eyebrow: "All caught up", title: "You're caught up", body: "Continue your Course when you're ready.", intro: "Nothing outstanding right now.", cta: "course" };
}

/** What to show the moment a Practice session is saved, from the FRESH home
 *  view-model (current_action / journey) — never invented progression.
 *
 *  Stage 10: built on the shared handoff model (lib/handoff.js). The object
 *  keeps the Stage 4 aliases (`body`, `next.title/body`, `cta.kind`) so the
 *  Coach and the shell read one shape: action.kind / cta.kind is "action"
 *  (run current_action), "today" or "progress". */
export function practiceCompletionHandoff(home, hwId) {
  const now = home?.journey?.now || null;
  const next = home?.journey?.next || null;
  const row = (home?.active_practice || []).find((r) => r?.id === hwId) || null;
  const rowStatus = row ? practiceRowStatus(row).status : null;
  const nextBlock = next?.title ? { label: next.title, description: next.body || "" } : null;
  const today = { label: HANDOFF_LABELS.back_to_today, run: "today" };
  const scope = { enrollmentId: home?.id || home?.enrollment_id || null, dogName: home?.dog?.name || null };
  const build = (h) => withPracticeAliases(makeHandoff({ ...h, scope }));

  if (rowStatus === "waiting_review") {
    return build({ state: "waiting", title: "Practice submitted", summary: "Your trainer needs to review this before you continue. You don't need to do anything else right now.", next: { label: "Wait for trainer review", description: "You'll see their note in Coach." }, action: null, secondary: today });
  }
  switch (now?.kind) {
    case "practice":
    case "practice_row":
      if (now.practice?.id && now.practice.id === hwId) {
        return build({ state: "complete", title: "Practice complete", summary: "Nice work. You completed today's round.", next: { label: "Come back tomorrow for your next round.", description: nextBlock?.label ? `Then: ${nextBlock.label}` : "" }, action: null, secondary: today });
      }
      return build({ state: "next", title: "Practice complete", summary: "Nice work.", next: { label: now.title, description: now.body || "" }, action: { label: HANDOFF_LABELS.start_practice, run: "action" }, secondary: today });
    case "remediation":
      return build({ state: "needs_work", title: "Practice complete", summary: "Continue with your trainer's plan until the checkpoint requirements are met.", next: nextBlock, action: null, secondary: today });
    case "advance":
      // Advancing stays the engine's own button on Today (one tap away):
      // moving the pointer from the completion screen would leave the lesson
      // just practised looking open in the Practice list.
      return build({ state: "next", title: "Practice complete", summary: "You're ready for the next lesson.", next: nextBlock, action: null, secondary: today });
    case "submit_checkpoint":
      return build({ state: "next", title: "Practice complete", summary: "Time to show your trainer.", next: { label: now.title, description: now.body || "" }, action: { label: HANDOFF_LABELS.start_checkpoint, run: "action" }, secondary: today });
    case "module_quiz":
      return build({ state: "next", title: "Practice complete", summary: "One more step before the next module.", next: { label: now.title, description: now.body || "" }, action: { label: HANDOFF_LABELS.take_quiz, run: "action" }, secondary: today });
    case "awaiting_review":
      return build({ state: "waiting", title: "Practice submitted", summary: "Your trainer needs to review your checkpoint before you continue. You don't need to do anything else right now.", next: nextBlock, action: null, secondary: today });
    case "done_today":
      return build({ state: "complete", title: "Practice complete", summary: "You're caught up for today.", next: nextBlock || { label: "Keep practicing until your next lesson with your trainer.", description: "" }, action: null, secondary: today });
    case "course_complete":
      return build({ state: "program_complete", title: "Program complete", summary: now.body || "You finished the program.", next: nextBlock, action: { label: HANDOFF_LABELS.view_progress, run: "progress" }, secondary: null });
    default:
      return build({ state: "complete", title: "Practice complete", summary: "Nice work.", next: nextBlock, action: null, secondary: today });
  }
}

/** Stage 4 aliases on top of the shared shape: `body`, `next.title/body`
 *  and a single `cta` (the primary action, else the calm way out). */
function withPracticeAliases(h) {
  const cta = h.action || h.secondary || null;
  return {
    ...h,
    body: h.summary,
    next: h.next ? { ...h.next, title: h.next.label, body: h.next.description || "" } : null,
    cta: cta ? { label: cta.label, kind: cta.kind } : null,
  };
}

/** The School lesson a Practice row belongs to, for the Practice Coach header.
 *  Callers (Today rail, recap, Practice page, deep links) may only know the
 *  row id; the Today view-model's active rows carry the server-resolved
 *  `school_lesson_id`, so every opener gets the same lesson context. */
export function lessonIdForPractice(home, hwId, lessonId = null) {
  if (lessonId) return lessonId;
  const row = (home?.active_practice || []).find((r) => r?.id === hwId);
  return row?.school_lesson_id || null;
}
