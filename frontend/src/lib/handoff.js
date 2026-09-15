/* Stage 10 — "What happens next?"
 *
 * One shared MODEL for the moment after a meaningful training action. Every
 * transition (client or trainer) describes itself as:
 *
 *   state    complete | next | waiting | needs_work | program_complete | saved | error
 *   title    what just happened                       ("Lesson complete")
 *   summary  one plain sentence of detail             ("You finished Adding Distance.")
 *   next     { label, description } — what happens next, always truthful
 *   action   { label, run } — ONLY when there is a real action available
 *   secondary { label, run } — a calm way out (Back to Today, Return to Training)
 *   scope    { enrollmentId, dogName } — the handoff belongs to ONE enrollment
 *
 * Nothing here is persisted and nothing here decides progression: every
 * builder reads the canonical, already-updated data (a mutation response or
 * the freshly refetched home view-model) and only PRESENTS it.
 *
 * `run` values are plain strings the host screen interprets ("action" = run
 * the server's current_action, "today", "progress", "course", "close" …).
 */

export const HANDOFF_STATES = ["complete", "next", "waiting", "needs_work", "program_complete", "saved", "error"];

/** Icon + eyebrow per state — the state is never carried by colour alone. */
export const HANDOFF_STATE_META = {
  complete: { icon: "fa-circle-check", eyebrow: "Done", tone: "lime" },
  next: { icon: "fa-circle-check", eyebrow: "Done", tone: "lime" },
  waiting: { icon: "fa-hourglass-half", eyebrow: "Waiting", tone: "cyan" },
  needs_work: { icon: "fa-rotate-left", eyebrow: "Keep going", tone: "cyan" },
  program_complete: { icon: "fa-graduation-cap", eyebrow: "Program complete", tone: "lime" },
  saved: { icon: "fa-floppy-disk", eyebrow: "Saved", tone: "cyan" },
  error: { icon: "fa-triangle-exclamation", eyebrow: "Something went wrong", tone: "red" },
};

/** The one button vocabulary. Engine labels on Today (server-authored) are
 *  untouched; these are the labels every handoff uses. */
export const HANDOFF_LABELS = {
  start_practice: "Start Practice",
  continue_practice: "Continue Practice",
  continue_lesson: "Continue Lesson",
  continue_course: "Continue Course",
  start_checkpoint: "Start Checkpoint",
  take_quiz: "Take the Module Quiz",
  try_again: "Try Again",
  view_results: "View Results",
  view_progress: "View Progress",
  review_course: "Review Course",
  back_to_today: "Back to Today",
  return_to_training: "Return to Training",
  back_to_reviews: "Back to Reviews",
  back_to_queue: "Back to Queue",
  keep_editing: "Keep Editing",
  dismiss: "Dismiss",
};

const clean = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Normalise a handoff. Actions without a run are dropped (no fake buttons). */
export function makeHandoff({ state = "complete", title, summary = null, next = null, action = null, secondary = null, scope = null } = {}) {
  const st = HANDOFF_STATES.includes(state) ? state : "complete";
  const nextBlock = next && (clean(next.label) || clean(next.description))
    ? { label: clean(next.label), description: clean(next.description) }
    : null;
  const act = action && clean(action.label) && action.run ? { label: clean(action.label), run: action.run, kind: action.kind || action.run } : null;
  const sec = secondary && clean(secondary.label) && secondary.run ? { label: clean(secondary.label), run: secondary.run, kind: secondary.kind || secondary.run } : null;
  return { state: st, title: clean(title) || "Done", summary: clean(summary), next: nextBlock, action: act, secondary: sec, scope: scope || null };
}

const TRAINER_LED = new Set(["in_person", "trainer_led"]);
export const isTrainerLed = (mode) => TRAINER_LED.has(mode);

const lessonName = (home) => home?.current_lesson?.name || home?.current_action?.sublabel || null;

/**
 * The client's truthful NEXT from the freshly loaded home view-model. This is
 * the single mapping every client handoff uses after an action, so "what
 * happens next" always agrees with Today.
 *
 * Returns { state, next, action, secondary } (no title/summary — the caller
 * knows what just happened).
 */
export function clientNextStep(home, { today = true } = {}) {
  const act = home?.current_action || null;
  const t = act?.type || null;
  const mode = home?.delivery_mode || null;
  const journeyNext = home?.journey?.next || null;
  const secondary = today ? { label: HANDOFF_LABELS.back_to_today, run: "today" } : null;
  const lesson = lessonName(home);

  if (t === "course_complete") {
    return { state: "program_complete", next: { label: "What's next", description: "Every lesson stays open to review, and your Progress page has the full story." }, action: { label: HANDOFF_LABELS.view_progress, run: "progress" }, secondary: { label: HANDOFF_LABELS.review_course, run: "course" } };
  }
  if (isTrainerLed(mode)) {
    // Trainer-led: the client is never invited to move the program forward.
    if (t === "practice") {
      return { state: "next", next: { label: "Practice at home", description: act.sublabel || "Keep practising this skill until your next visit." }, action: { label: HANDOFF_LABELS.start_practice, run: "action" }, secondary };
    }
    if (t === "lesson") {
      return { state: "next", next: { label: lesson ? `Read over ${lesson}` : "Read over your current lesson", description: "Your trainer will move you forward at your next lesson." }, action: { label: HANDOFF_LABELS.continue_lesson, run: "action" }, secondary };
    }
    return { state: "waiting", next: { label: "You're caught up", description: "Your trainer will move you forward at your next lesson." }, action: null, secondary };
  }
  switch (t) {
    case "practice":
      return { state: "next", next: { label: "Practice what you learned before continuing.", description: act.sublabel || null }, action: { label: HANDOFF_LABELS.start_practice, run: "action" }, secondary };
    case "lesson":
      // journey.next is the milestone AFTER this lesson — say so, don't describe the lesson with it
      return { state: "next", next: { label: lesson ? `Lesson — ${lesson}` : "Your current lesson", description: journeyNext?.title ? `Then: ${journeyNext.title}` : null }, action: { label: HANDOFF_LABELS.continue_lesson, run: "action" }, secondary };
    case "submit_checkpoint":
      return { state: "next", next: { label: lesson ? `Checkpoint — ${lesson}` : "Checkpoint", description: "Show your trainer what you've built. Your trainer reviews it before the program continues." }, action: { label: HANDOFF_LABELS.start_checkpoint, run: "action" }, secondary };
    case "awaiting_review":
      return { state: "waiting", next: { label: "Wait for trainer review", description: "Your trainer needs to review your checkpoint before you continue. You don't need to do anything right now." }, action: null, secondary };
    case "remediation":
      return { state: "needs_work", next: { label: act.sublabel || "More Practice before you retry the checkpoint", description: "Your trainer wants a few more sessions first. Every one counts toward the retry." }, action: { label: HANDOFF_LABELS.start_practice, run: "action" }, secondary };
    case "trainer_assist":
      return { state: "waiting", next: { label: "Your trainer is stepping in", description: act.sublabel || "Your trainer will work through this with you. You don't need to do anything right now." }, action: null, secondary };
    case "module_quiz":
      return { state: "next", next: { label: "Module quiz", description: "One short check before the next module." }, action: { label: HANDOFF_LABELS.take_quiz, run: "action" }, secondary };
    case "advance":
      return { state: "next", next: { label: journeyNext?.title ? `Next: ${journeyNext.title}` : "You're ready for the next lesson", description: journeyNext?.body || null }, action: { label: HANDOFF_LABELS.continue_course, run: "action" }, secondary };
    case "onboarding":
    case "setup_required":
    case "start":
      return { state: "next", next: { label: act.label || "Set up your course", description: act.sublabel || null }, action: { label: HANDOFF_LABELS.back_to_today, run: "today" }, secondary: null };
    default:
      return { state: "waiting", next: { label: "You're done for now", description: "Today will show your next step." }, action: null, secondary };
  }
}

/** After a lesson's material is finished (a no-Practice lesson, or the
 *  self-advance), from the FRESH home. */
export function lessonCompleteHandoff({ lessonName: finished, home, scope = null }) {
  const n = clientNextStep(home);
  return makeHandoff({
    state: n.state === "waiting" || n.state === "program_complete" ? n.state : "complete",
    title: n.state === "program_complete" ? "Program complete" : "Lesson complete",
    summary: finished ? `You finished ${finished}.` : "Your lesson is complete.",
    next: n.next, action: n.action, secondary: n.secondary, scope,
  });
}

/** After a Module Quiz, from the quiz RESPONSE + the fresh home. */
export function quizHandoff(result, home, scope = null) {
  if (!result?.passed) {
    return makeHandoff({ state: "needs_work", title: "Almost there", summary: `You got ${result?.correct_count ?? 0} of ${result?.question_count ?? 0}. Review the answers and try again — retakes are always free.`, next: { label: "Try the quiz again when you're ready", description: null }, action: { label: HANDOFF_LABELS.try_again, run: "retry" }, secondary: null, scope });
  }
  const n = clientNextStep(home);
  if (result.course_completed || n.state === "program_complete") {
    return makeHandoff({ state: "program_complete", title: "Program complete", summary: `Quiz passed — ${Math.round(result.score_percent || 0)}%. That was the last step of your program.`, next: n.next, action: { label: HANDOFF_LABELS.view_progress, run: "progress" }, secondary: { label: HANDOFF_LABELS.review_course, run: "course" }, scope });
  }
  return makeHandoff({ state: "complete", title: "Module quiz passed", summary: `${Math.round(result.score_percent || 0)}% — ${result.correct_count} of ${result.question_count} correct.`, next: n.next, action: n.action, secondary: n.secondary, scope });
}

/** The moment a checkpoint video is sent (before any trainer has looked). */
export function checkpointSubmittedHandoff({ lessonName: name, scope = null } = {}) {
  return makeHandoff({
    state: "waiting", title: "Checkpoint submitted",
    summary: name ? `Your ${name} checkpoint is with your trainer.` : "Your checkpoint is with your trainer.",
    next: { label: "Wait for trainer review", description: "Your trainer needs to review your checkpoint before you continue. You do not need to submit it again." },
    action: null, secondary: { label: HANDOFF_LABELS.back_to_today, run: "today" }, scope,
  });
}

/* ------------------------------------------------------------ trainer */

export function trainerSaveHandoff({ dogName = null } = {}) {
  return makeHandoff({
    state: "saved", title: "Session saved",
    summary: `Your work is saved. This session is still open and has not been sent to ${dogName ? `${dogName}'s owner` : "the client"} as a completed lesson.`,
    next: { label: "Resume it later", description: "Open it again from the Pipeline or the dog's Training tab — it picks up exactly where you left off." },
    action: { label: HANDOFF_LABELS.return_to_training, run: "close" },
    secondary: { label: HANDOFF_LABELS.keep_editing, run: "resume" },
  });
}

const REVIEW_WORDS = {
  looks_good: { title: "Practice approved", state: "complete", summary: (who) => `${who} can continue according to the program's next step. Your note travels with the approval.` },
  approved: { title: "Practice approved", state: "complete", summary: (who) => `${who} can continue according to the program's next step. Your note travels with the approval.` },
  keep_practicing: { title: "Practice sent back", state: "needs_work", summary: (who) => `${who} will see your note in Coach and keep practising this skill. Nothing else changes until they log another round.` },
  needs_redo: { title: "Practice sent back", state: "needs_work", summary: (who) => `${who} will see your note and a Try Again on that day's Practice.` },
  trainer_attention: { title: "Flagged for trainer attention", state: "waiting", summary: (who) => `${who}'s Practice is marked for a closer look. Your note is visible to them in Coach.` },
};

/** After a Practice review (School section review or daily-tracker day review). */
export function practiceReviewHandoff(status, { dogName = null, clientName = null, backLabel = HANDOFF_LABELS.back_to_reviews } = {}) {
  const w = REVIEW_WORDS[status] || { title: "Review saved", state: "complete", summary: () => "The client can see your review." };
  const who = dogName ? `${dogName}'s owner` : clientName || "The client";
  return makeHandoff({
    state: w.state, title: w.title, summary: w.summary(who),
    next: { label: "What the client sees", description: status === "trainer_attention" ? "Your note in Coach, and a flag that stays until the next review." : "Your note in Coach; their next step shows on their Today. Nothing else to do here." },
    action: { label: backLabel, run: "back" }, secondary: null,
  });
}

const PRESCRIPTION_WORDS = {
  repeat_current_recipe: "repeat the current lesson's Practice",
  assign_recipe: "work through the Practice you chose",
  assign_refresher_lesson: "review the refresher lesson, then practise",
};

/** After grading a checkpoint (queue or live), from the grade RESPONSE. */
export function checkpointGradeHandoff(sub, { dogName = null, lessonName: name = null, backLabel = HANDOFF_LABELS.back_to_queue, enrollment = null } = {}) {
  const outcome = sub?.outcome || sub?.grading_plan?.outcome || null;
  const plan = sub?.grading_plan || {};
  const dog = dogName || "The dog";
  const lesson = name || sub?.lesson_name || "this lesson";
  const back = { label: backLabel, run: "back" };
  // Stage 11 — say "Program complete" only when the grade response carries the
  // enrollment's persisted status; "final lesson" alone never implies it.
  if (outcome === "advance" && enrollment && enrollment.status === "completed") {
    return makeHandoff({
      state: "program_complete", title: "Program complete",
      summary: `${dog} passed the ${lesson} checkpoint — that completed ${enrollment.program_name || "the program"}.`,
      next: { label: "What the client sees", description: "The completed program now shows in their Course and Progress. No further lesson is scheduled unless a new program is assigned." },
      action: back,
    });
  }
  if (outcome === "advance") {
    const deferred = !!plan.progression_deferred_for_module_quiz;
    const moved = !!plan.intended_target_lesson_id;
    const final = !!plan.intended_target_is_final && !moved;
    // Only claim movement the response actually records; otherwise point at
    // the canonical surfaces instead of guessing.
    const description = deferred ? "The Module Quiz is next — the program moves on once the client passes it."
      : final ? "That was the final checkpoint. The program is ready to be completed."
      : moved ? "The program moved to the next lesson. The client sees it on Today and Course now."
      : "The client's Today and Course show the program's current position.";
    return makeHandoff({
      state: "complete", title: "Checkpoint passed",
      summary: `${dog} passed the ${lesson} checkpoint.`,
      next: { label: "Next program position", description },
      action: back,
    });
  }
  if (outcome === "prescribe_practice") {
    const pres = sub?.prescription || plan.prescription || {};
    const min = pres.min_practice_sessions_required || pres.min_sessions || null;
    return makeHandoff({
      state: "needs_work", title: "More Practice assigned",
      summary: `${dog} stays on ${lesson}. The client will ${PRESCRIPTION_WORDS[pres.action] || "practise more"}${min ? ` — at least ${min} session${min === 1 ? "" : "s"}` : ""} before retrying the checkpoint.`,
      next: { label: "What the client receives", description: "Their Today shows the extra Practice with your feedback. The checkpoint reopens once the sessions are logged." },
      action: back,
    });
  }
  if (outcome === "trainer_assist_recommended") {
    return makeHandoff({
      state: "waiting", title: "Trainer Assist recommended",
      summary: `${dog} stays on ${lesson} until you've worked through it together.`,
      next: { label: "What the client receives", description: "Their Today says you are stepping in. The checkpoint reopens when the assist is marked complete." },
      action: back,
    });
  }
  return makeHandoff({ state: "complete", title: "Checkpoint saved", summary: `${dog} · ${lesson}.`, next: null, action: back });
}
