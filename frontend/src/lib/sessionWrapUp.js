import { makeHandoff, HANDOFF_LABELS } from "./handoff";
/* Stage 7 — Trainer workspace BEFORE → TRAIN → WRAP UP.
 *
 * Pure helpers for the session workspace. Nothing here talks to the server
 * or invents state: readiness MIRRORS the backend completion rules (which
 * stay authoritative — see session_completion_gaps and
 * _current_lesson_assessment_gaps), the client preview reads the SAME draft
 * fields the client recap is built from, and phase choice is derived from
 * what the draft already holds. */

export const PHASES = [
  { key: "before", label: "Before", icon: "fa-bolt", hint: "Know what you're doing" },
  { key: "train", label: "Train", icon: "fa-dog", hint: "Work the dog, record what matters" },
  { key: "wrap", label: "Wrap Up", icon: "fa-flag-checkered", hint: "Tell the client, assign Practice, finish" },
];

const text = (v) => String(v || "").trim();

export const OUTCOME_LABELS = {
  skipped: "Not worked", introduced: "Introduced", needs_more_work: "Needs work",
  improving: "Improving", passed: "Good", reliable: "Reliable",
};
export const MASTERY_LABELS = { mastered: "Mastered", not_yet: "Not yet" };

/** Skills the backend gate cares about: curriculum-required skill rows. */
export function requiredSkillActivities(draft) {
  return ((draft?.plan?.activities) || []).filter((a) => a && a.source === "skill" && a.required_curriculum);
}

/** Per-skill recording state, used by the TRAIN rows and the readiness list. */
export function skillRecordState(activity, actual = {}) {
  const required = !!activity?.required_curriculum && activity?.source === "skill";
  const skipped = !!activity?.skipped || actual?.outcome === "skipped";
  const missing = [];
  if (required) {
    if (skipped) {
      if (!text(activity?.skip_reason) && !text(actual?.skip_reason)) missing.push("reason for skipping");
    } else {
      if (!actual?.outcome) missing.push("outcome");
      if (!activity?.manual_only && (actual?.score == null)) missing.push("skill level");
    }
  }
  const recorded = !skipped && (!!actual?.outcome || actual?.score != null);
  return { required, skipped, missing, recorded, complete: required ? missing.length === 0 : true };
}

/** What still has to happen before Finish Session — the same rules the
 *  backend enforces, phrased for the trainer, each with a place to go. */
export function completionReadiness(draft, { sendRecap = true, action = null, reason = "", practice = null } = {}) {
  const items = [];
  const actuals = draft?.actuals || {};
  for (const a of requiredSkillActivities(draft)) {
    const st = skillRecordState(a, actuals[a.id] || {});
    for (const m of st.missing) {
      items.push({ key: `skill:${a.id}:${m}`, phase: "train", target: `activity-${a.id}`, label: `${a.name || "Skill"} — add ${m === "reason for skipping" ? "a reason for skipping" : `the ${m}`}` });
    }
  }
  if (!text(draft?.what_went_well)) items.push({ key: "what_went_well", phase: "wrap", target: "workspace-what-went-well", label: "Say what went well" });
  if (!text(draft?.needs_work)) items.push({ key: "needs_work", phase: "wrap", target: "workspace-needs-work", label: "Say what needs work" });
  if (sendRecap && !text(draft?.client_recap_note)) items.push({ key: "client_recap_note", phase: "wrap", target: "workspace-recap-note", label: "Write the client recap (or turn off sending it)" });
  if (!text(draft?.next_lesson_focus)) items.push({ key: "next_lesson_focus", phase: "wrap", target: "workspace-next-lesson-focus", label: "Enter the next lesson focus" });
  if (action === "skip_lesson" && !text(reason)) items.push({ key: "reason", phase: "wrap", target: "advancement-reason", label: "Give a reason for skipping the lesson" });
  if (!action) items.push({ key: "progression", phase: "wrap", target: "wrap-next-step", label: "Choose what should happen next" });

  const recommended = [];
  for (const a of requiredSkillActivities(draft)) {
    const actual = actuals[a.id] || {};
    if (!a.skipped && actual.outcome && actual.outcome !== "skipped" && !text(actual.client_observation)) {
      recommended.push({ key: `obs:${a.id}`, phase: "train", target: `activity-${a.id}`, label: `Add a client-safe observation for ${a.name || "this skill"}` });
    }
  }
  const done = [
    { key: "skills", label: "Skill results recorded", ok: !items.some((i) => i.phase === "train") },
    { key: "recap", label: sendRecap ? "Client recap ready" : "Client recap not being sent", ok: !items.some((i) => ["what_went_well", "needs_work", "client_recap_note"].includes(i.key)) },
    { key: "focus", label: "Next focus entered", ok: !items.some((i) => i.key === "next_lesson_focus") },
    ...(practice ? [{ key: "practice", label: practice.assigned ? "Practice ready" : practice.configured ? "Practice withheld for this visit" : "No Practice configured for this lesson", ok: true }] : []),
    { key: "progression", label: action ? `Next step chosen: ${(ADVANCEMENT_AUDIT[action] || {}).label || action}` : "Choose what should happen next", ok: !!action },
  ];
  return { ready: items.length === 0, missing: items, recommended, done };
}

/** The lightweight "client will see" preview. Reads ONLY client-safe draft
 *  fields — session_note and per-skill private notes never reach it. */
export function clientHandoffPreview(draft, overview, { assignPractice = true, sendRecap = true } = {}) {
  const actuals = draft?.actuals || {};
  const observations = ((draft?.plan?.activities) || [])
    .filter((a) => a && !a.skipped && text(actuals[a.id]?.client_observation))
    .map((a) => ({ name: a.name || "Skill", text: text(actuals[a.id].client_observation) }));
  const lp = overview?.current_lesson_practice || {};
  const practice = assignPractice && lp.configured && lp.available !== false
    ? { title: lp.title || "Lesson Practice", note: text(draft?.practice_note) || null }
    : null;
  return {
    wentWell: text(draft?.what_went_well) || null,
    needsWork: text(draft?.needs_work) || null,
    recap: sendRecap ? (text(draft?.client_recap_note) || null) : null,
    nextFocus: text(draft?.next_lesson_focus) || null,
    practice,
    observations,
  };
}

/** Where a resumed draft should land after the briefing: Wrap Up once the
 *  trainer has started any Wrap Up field, Train otherwise. A completed
 *  session opens on Wrap Up (its record). */
export function resumePhase(draft) {
  if (!draft) return "train";
  if (draft.status === "completed" || draft.status === "completing") return "wrap";
  const wrapStarted = ["what_went_well", "needs_work", "next_lesson_focus", "client_recap_note", "practice_note"].some((k) => text(draft[k]));
  return wrapStarted ? "wrap" : "train";
}

/** Compact per-skill results for the Wrap Up "session result" block. */
export function sessionResultRows(draft) {
  const actuals = draft?.actuals || {};
  return ((draft?.plan?.activities) || []).filter(Boolean).map((a) => {
    const actual = actuals[a.id] || {};
    const st = skillRecordState(a, actual);
    return {
      id: a.id, name: a.name || "Skill", required: st.required, skipped: st.skipped,
      score: actual.score ?? null, outcome: actual.outcome ? (OUTCOME_LABELS[actual.outcome] || actual.outcome) : null,
      mastery: actual.mastery_decision ? (MASTERY_LABELS[actual.mastery_decision] || actual.mastery_decision) : null,
      complete: st.complete,
    };
  });
}

/* ------------------------------------------------------------------ Stage 8
 * WHAT SHOULD HAPPEN NEXT? — the trainer decision over the EXISTING nine
 * advancement actions. Nothing here changes what the backend does with an
 * action; it only decides which ones an ordinary lesson shows up front, how
 * they are worded, and which need a confirmation. Audit (server.py
 * complete_training_session / _compute_completion_plan, 2026-09-14):
 *
 *  key                     | who      | pointer effect                         | gate
 *  remain                  | staff    | none                                    | —
 *  advance_next            | staff    | next lesson (crosses module boundary;   | assessment gaps; hybrid checkpoint;
 *                          |          | on the FINAL lesson: stays, flags)      | in-person NOT gated (trainer controls)
 *  assign_review           | staff    | none (recap: review before moving on)   | —
 *  mark_for_assessment     | staff    | none; flags every recorded skill        | —
 *                          |          | needs_reassessment                      |
 *  advance_lesson          | admin    | next lesson in module (no assessment    | hybrid checkpoint
 *                          |          | gate)                                   |
 *  advance_module          | admin    | next module, first lesson               | hybrid checkpoint
 *  skip_lesson             | admin    | next lesson in module; reason required  | hybrid checkpoint
 *  reopen_previous_lesson  | admin    | previous (or target) lesson             | —
 *  complete_program        | admin +  | enrollment status → completed           | hybrid checkpoint
 *                          | graduation authority (settings perm or assigned trainer)
 *
 * Practice creation is independent of the action (assign_lesson_practice).
 */
export const ADVANCEMENT_AUDIT = {
  remain: { label: "Stay Here", meaning: "Finish today's session, but keep this lesson as the dog's next lesson.", admin: false, moves: false, dangerous: false },
  advance_next: { label: "Ready for Next Lesson", meaning: "Move to the next normal lesson when this session is finished.", admin: false, moves: true, dangerous: false },
  assign_review: { label: "Needs Review", meaning: "No forward progress — the next session should review this material before moving on.", admin: false, moves: false, dangerous: false },
  mark_for_assessment: { label: "Flag skills for a formal reassessment", meaning: "Stay on this lesson and flag every skill recorded today for reassessment next visit.", admin: false, moves: false, dangerous: false },
  advance_lesson: { label: "Jump to the next lesson (override)", meaning: "Moves to the next lesson in this module without today's recording gate.", admin: true, moves: true, dangerous: true,
    confirm: (d, l) => `Jump ${d} past ${l}? This moves the dog to the next lesson without completing this lesson's normal recording requirements.` },
  advance_module: { label: "Jump to the next module (override)", meaning: "Moves to the next module and its first lesson.", admin: true, moves: true, dangerous: true,
    confirm: (d, l) => `Jump ${d} to the next module? Every remaining lesson in the current module, including ${l}, is left behind.` },
  skip_lesson: { label: "Skip this lesson (override)", meaning: "Moves past this lesson without completing it. A reason is required.", admin: true, moves: true, dangerous: true,
    confirm: (d, l) => `Skip this lesson? This moves ${d} past ${l} without completing its normal progression requirements.` },
  reopen_previous_lesson: { label: "Go back to the previous lesson (override)", meaning: "Steps the dog back to the prior lesson.", admin: true, moves: true, dangerous: true,
    confirm: (d, l) => `Move ${d} back a lesson? The dog's next lesson becomes the one before ${l}.` },
  complete_program: { label: "Complete the program", meaning: "Ends this program now. Only the owner/manager or the dog's assigned trainer can do this.", admin: true, moves: true, dangerous: true,
    confirm: (d) => `Complete the program for ${d}? The dog leaves this program today; this is not undone by the next session.` },
};
export const ADVANCEMENT_KEYS = Object.keys(ADVANCEMENT_AUDIT);
export const NORMAL_KEYS = ["remain", "advance_next", "assign_review"];

/** The ordinary trainer decision for THIS session. */
export function progressionChoices({ isFinalLesson = false, isAdmin = false, checkpoint = null, nextLessonName = null, dogName = "the dog", trainingMode = null } = {}) {
  // Mirrors _required_checkpoint_blocks_advancement: an unpassed checkpoint
  // gates moving on for HYBRID only (in-person trainers control advance_next),
  // and gates completing the program for both School modes.
  const unpassed = checkpoint && checkpoint.state !== "passed" ? checkpoint : null;
  const gateNext = unpassed && trainingMode === "hybrid" ? unpassed : null;
  const gateComplete = unpassed;
  const gradeHint = trainingMode === "in_person" ? "Grade the live checkpoint (School HQ → Students) first." : "This checkpoint must be reviewed first.";
  const choices = [
    { key: "remain", title: "Stay Here", body: `Finish today's session, but keep this lesson as ${dogName}'s next lesson.`, icon: "fa-rotate-left", enabled: true },
  ];
  if (!isFinalLesson) {
    choices.push({
      key: "advance_next", title: "Ready for Next Lesson", icon: "fa-forward",
      body: nextLessonName ? `Move on to ${nextLessonName} when this session is finished.` : "Move to the next normal lesson when this session is finished.",
      enabled: !gateNext,
      lockedTitle: gateNext ? "Next lesson is locked" : null,
      lockedBody: gateNext ? `${gateNext.label}. This checkpoint must be reviewed before the program can continue.` : null,
    });
  } else {
    choices.push({
      key: "complete_program", title: "Ready to Complete Program", icon: "fa-graduation-cap",
      body: "This is the final lesson. Completing ends the program today; nothing completes automatically.",
      enabled: isAdmin && !gateComplete,
      lockedTitle: gateComplete ? "Program completion is locked" : (!isAdmin ? "Needs an owner or manager" : null),
      lockedBody: gateComplete ? `${gateComplete.label}. ${gradeHint} The program cannot be completed until it is passed.`
        : (!isAdmin ? "Only the owner/manager (or an Admin who is the assigned trainer) can complete a program. Choose Stay Here and let them finish it." : null),
    });
  }
  choices.push({ key: "assign_review", title: "Needs Review", body: "Something needs another look before progression changes. The dog stays here and the next session reviews this material.", icon: "fa-magnifying-glass", enabled: true });
  return choices;
}

/** Actions under "Advanced progression actions" for this user. Never
 *  widens permissions: admin-only actions are listed only for admins. */
export function advancedActions({ isAdmin = false, isFinalLesson = false } = {}) {
  const keys = ["mark_for_assessment", ...(isAdmin ? ["advance_lesson", "advance_module", "skip_lesson", "reopen_previous_lesson", ...(isFinalLesson ? [] : ["complete_program"])] : [])];
  return keys.map((key) => ({ key, ...ADVANCEMENT_AUDIT[key] }));
}

export function confirmationFor(action, { dogName = "the dog", lessonName = "this lesson" } = {}) {
  const meta = ADVANCEMENT_AUDIT[action];
  if (!meta || !meta.dangerous) return null;
  return { title: meta.label.replace(/ \(override\)$/, ""), text: meta.confirm(dogName, lessonName) };
}

/** Plain summary of what actually happened, from the completion response. */
export function progressionOutcome(result, { previousLessonName = null } = {}) {
  const enr = result?.enrollment || {};
  const log = result?.session_log || {};
  if (enr.status === "completed") return { title: "Program complete", detail: enr.program_name ? `${enr.program_name} is finished.` : null };
  const moved = !!log.lesson_change || !!log.advanced_module;
  const name = enr.current_lesson_name || null;
  if (moved) return { title: "Next training step", detail: name ? `${enr.current_module_name ? enr.current_module_name + " · " : ""}${name}` : "Moved to the next lesson." };
  if (log.advancement_action === "assign_review") return { title: "Next training step", detail: `Review ${name || previousLessonName || "this lesson"} before moving on.` };
  if (log.at_final_lesson && log.advancement_action === "advance_next") return { title: "Next training step", detail: `${name || previousLessonName || "This lesson"} is the final lesson — the program stays open until it is completed.` };
  return { title: "Next training step", detail: `Repeat ${name || previousLessonName || "this lesson"}.` };
}

/* ------------------------------------------------------------------------
 * Stage 10 — the trainer's post-action handoffs on the shared model.
 * ---------------------------------------------------------------------- */

/** Finish Session → one truthful handoff from the completion RESPONSE.
 *  `progressionOutcome` stays the source of the next-step line; this adds
 *  the result sentence, the meaning of each choice and the way out. */
export function finishHandoff(result, { previousLessonName = null, dogName = null, sendRecap = true } = {}) {
  const enr = result?.enrollment || {};
  const log = result?.session_log || {};
  const outcome = progressionOutcome(result, { previousLessonName });
  const practiceAssigned = (result?.homework_assigned?.length || result?.homework_created?.length || 0) > 0;
  const skills = log.goal_updates?.length || 0;
  const dog = dogName || "This dog";
  const facts = [
    sendRecap ? "The client recap is ready." : "No recap was sent.",
    practiceAssigned ? "Practice has been assigned." : "No Practice this visit.",
    `${skills} skill result${skills === 1 ? "" : "s"} recorded.`,
  ].join(" ");
  const back = { label: HANDOFF_LABELS.return_to_training, run: "close" };
  const action = log.advancement_action || null;
  const lesson = enr.current_lesson_name || previousLessonName || "this lesson";

  if (enr.status === "completed") {
    return makeHandoff({
      state: "program_complete", title: "Program complete",
      summary: `${enr.program_name || "The program"} has been completed for ${dog}. ${facts}`,
      next: { label: "What the client sees", description: "The completed program now shows in their Course and Progress. No further lesson is scheduled unless a new program is assigned." },
      action: back,
    });
  }
  const moved = !!log.lesson_change || !!log.advanced_module;
  if (moved) {
    return makeHandoff({
      state: "complete", title: "Session finished", summary: facts,
      next: { label: outcome.title, description: `${outcome.detail} — the program moved forward.` },
      action: back,
    });
  }
  if (action === "assign_review") {
    return makeHandoff({
      state: "next", title: "Session finished", summary: `${facts} Review work was assigned.`,
      next: { label: outcome.title, description: `${lesson} stays current until the review work is resolved.` },
      action: back,
    });
  }
  if (action === "mark_for_assessment") {
    return makeHandoff({
      state: "next", title: "Session finished", summary: `${facts} ${dog} is flagged for assessment.`,
      next: { label: outcome.title, description: `Stay on ${lesson}. Assess it at the next visit before moving on.` },
      action: back,
    });
  }
  if (log.at_final_lesson && action === "advance_next") {
    return makeHandoff({
      state: "next", title: "Session finished", summary: facts,
      next: { label: outcome.title, description: outcome.detail },
      action: back,
    });
  }
  return makeHandoff({
    state: "next", title: "Session finished", summary: facts,
    next: { label: outcome.title, description: `Stay on ${lesson}. ${dog} will work on the same lesson next time.` },
    action: back,
  });
}
