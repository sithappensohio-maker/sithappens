/* Stage 8 — WHAT SHOULD HAPPEN NEXT?
 *
 * The trainer decision is a presentation over the EXISTING nine advancement
 * actions. These tests pin the audit table (every backend action, its
 * permission tier and wording), the three ordinary choices and their
 * mapping, that Needs Review is the real `assign_review` action (never an
 * invented value), the locked states, the advanced list per role, the
 * confirmations for moves outside normal progression, and the truthful
 * post-finish summary.
 */
import fs from "fs";
import path from "path";
import {
  ADVANCEMENT_AUDIT, ADVANCEMENT_KEYS, NORMAL_KEYS, progressionChoices, advancedActions, confirmationFor, progressionOutcome, completionReadiness,
} from "../lib/sessionWrapUp";

const baseSrc = fs.readFileSync(path.join(__dirname, "TrainingSessionWorkspaceBase.jsx"), "utf8");
const BACKEND_ACTIONS = ["remain", "advance_next", "advance_lesson", "advance_module", "assign_review", "reopen_previous_lesson", "skip_lesson", "mark_for_assessment", "complete_program"];

test("the audit covers exactly the nine backend actions, with the admin tier matching the route's override set", () => {
  expect([...ADVANCEMENT_KEYS].sort()).toEqual([...BACKEND_ACTIONS].sort());
  const adminOnly = BACKEND_ACTIONS.filter((k) => ADVANCEMENT_AUDIT[k].admin).sort();
  expect(adminOnly).toEqual(["advance_lesson", "advance_module", "complete_program", "reopen_previous_lesson", "skip_lesson"]);
  for (const k of BACKEND_ACTIONS) {
    expect(ADVANCEMENT_AUDIT[k].label).not.toMatch(/_/); // never an implementation term
    expect(ADVANCEMENT_AUDIT[k].meaning.length).toBeGreaterThan(20);
  }
  expect(NORMAL_KEYS).toEqual(["remain", "advance_next", "assign_review"]);
});

test("an ordinary lesson offers Stay Here → remain, Ready for Next Lesson → advance_next, Needs Review → assign_review", () => {
  const c = progressionChoices({ isFinalLesson: false, isAdmin: false, checkpoint: null, dogName: "Milo" });
  expect(c.map((x) => [x.key, x.title, x.enabled])).toEqual([
    ["remain", "Stay Here", true], ["advance_next", "Ready for Next Lesson", true], ["assign_review", "Needs Review", true],
  ]);
  expect(c[0].body).toBe("Finish today's session, but keep this lesson as Milo's next lesson.");
  expect(c[1].body).toBe("Move to the next normal lesson when this session is finished.");
  // Needs Review is a real existing action, not an invented value
  expect(BACKEND_ACTIONS).toContain("assign_review");
  expect(JSON.stringify(c)).not.toMatch(/needs_review/);
});

test("a hybrid checkpoint that is not passed locks Ready for Next Lesson with the reason; a passed one does not", () => {
  const locked = progressionChoices({ trainingMode: "hybrid", checkpoint: { state: "submitted", label: "Checkpoint needs review" } });
  const next = locked.find((x) => x.key === "advance_next");
  expect(next.enabled).toBe(false);
  expect(next.lockedTitle).toBe("Next lesson is locked");
  expect(next.lockedBody).toMatch(/Checkpoint needs review\. This checkpoint must be reviewed before the program can continue\./);
  expect(locked.find((x) => x.key === "remain").enabled).toBe(true);
  const passed = progressionChoices({ trainingMode: "hybrid", checkpoint: { state: "passed", label: "Checkpoint passed" } });
  expect(passed.find((x) => x.key === "advance_next").enabled).toBe(true);
  expect(progressionChoices({ checkpoint: null }).every((x) => x.enabled)).toBe(true);
});

test("trainer-led in-person keeps the backend's non-gated Ready for Next Lesson, but completing the program still waits for the live checkpoint", () => {
  const cp = { state: "ready", label: "Checkpoint lesson" };
  const inPerson = progressionChoices({ trainingMode: "in_person", checkpoint: cp });
  expect(inPerson.find((x) => x.key === "advance_next").enabled).toBe(true); // no fake frontend gate
  const finalInPerson = progressionChoices({ trainingMode: "in_person", isFinalLesson: true, isAdmin: true, checkpoint: cp });
  const done = finalInPerson.find((x) => x.key === "complete_program");
  expect(done.enabled).toBe(false);
  expect(done.lockedBody).toMatch(/Grade the live checkpoint \(School HQ → Students\) first/);
  const passedFinal = progressionChoices({ trainingMode: "in_person", isFinalLesson: true, isAdmin: true, checkpoint: { state: "passed", label: "Checkpoint passed" } });
  expect(passedFinal.find((x) => x.key === "complete_program").enabled).toBe(true);
});

test("the final lesson replaces Ready for Next Lesson with Ready to Complete Program, gated to admins", () => {
  const admin = progressionChoices({ isFinalLesson: true, isAdmin: true });
  expect(admin.map((x) => x.key)).toEqual(["remain", "complete_program", "assign_review"]);
  expect(admin[1].title).toBe("Ready to Complete Program");
  expect(admin[1].enabled).toBe(true);
  const trainer = progressionChoices({ isFinalLesson: true, isAdmin: false });
  expect(trainer[1].enabled).toBe(false);
  expect(trainer[1].lockedTitle).toBe("Needs an owner or manager");
  expect(JSON.stringify(admin)).not.toMatch(/Ready for Next Lesson/);
});

test("advanced actions never widen permissions: trainers get the reassessment flag only, admins get every recovery action", () => {
  expect(advancedActions({ isAdmin: false }).map((a) => a.key)).toEqual(["mark_for_assessment"]);
  expect(advancedActions({ isAdmin: true, isFinalLesson: false }).map((a) => a.key)).toEqual(["mark_for_assessment", "advance_lesson", "advance_module", "skip_lesson", "reopen_previous_lesson", "complete_program"]);
  // on the final lesson Complete Program is already the main choice
  expect(advancedActions({ isAdmin: true, isFinalLesson: true }).map((a) => a.key)).not.toContain("complete_program");
  // every backend action is reachable somewhere for an admin
  const reachable = new Set([...progressionChoices({ isAdmin: true }).map((c) => c.key), ...advancedActions({ isAdmin: true }).map((a) => a.key), ...progressionChoices({ isAdmin: true, isFinalLesson: true }).map((c) => c.key)]);
  for (const k of BACKEND_ACTIONS) expect(reachable.has(k)).toBe(true);
});

test("moves outside normal progression require a confirmation that names the consequence; ordinary choices do not", () => {
  for (const k of ["remain", "advance_next", "assign_review", "mark_for_assessment"]) expect(confirmationFor(k)).toBeNull();
  const skip = confirmationFor("skip_lesson", { dogName: "Milo", lessonName: "Lesson 6" });
  expect(skip).toEqual({ title: "Skip this lesson", text: "Skip this lesson? This moves Milo past Lesson 6 without completing its normal progression requirements." });
  expect(confirmationFor("complete_program", { dogName: "Milo" }).text).toMatch(/Complete the program for Milo\?/);
  for (const k of ["advance_lesson", "advance_module", "reopen_previous_lesson"]) expect(confirmationFor(k, { dogName: "Milo", lessonName: "Lesson 6" }).text).toMatch(/Milo/);
});

test("readiness asks for the decision and never exposes an action name", () => {
  const d = { plan: { activities: [] }, what_went_well: "w", needs_work: "n", next_lesson_focus: "f", client_recap_note: "c" };
  const r = completionReadiness(d, { action: null });
  expect(r.ready).toBe(false);
  expect(r.missing.map((m) => [m.key, m.target])).toEqual([["progression", "wrap-next-step"]]);
  expect(r.done.at(-1)).toEqual({ key: "progression", label: "Choose what should happen next", ok: false });
  const chosen = completionReadiness(d, { action: "advance_next" });
  expect(chosen.ready).toBe(true);
  expect(chosen.done.at(-1).label).toBe("Next step chosen: Ready for Next Lesson");
  expect(JSON.stringify(chosen.done)).not.toMatch(/advance_next|remain\b/);
});

test("the post-finish summary reports what actually happened from the response", () => {
  const stay = progressionOutcome({ session_log: { advancement_action: "remain" }, enrollment: { status: "active", current_lesson_name: "Place With Distractions" } });
  expect(stay).toEqual({ title: "Next training step", detail: "Repeat Place With Distractions." });
  const moved = progressionOutcome({ session_log: { advancement_action: "advance_next", lesson_change: { to_lesson_id: "l6" } }, enrollment: { status: "active", current_lesson_name: "Adding Distance", current_module_name: "Module 2" } });
  expect(moved).toEqual({ title: "Next training step", detail: "Module 2 · Adding Distance" });
  const done = progressionOutcome({ session_log: { advancement_action: "complete_program" }, enrollment: { status: "completed", program_name: "Basic Obedience" } });
  expect(done).toEqual({ title: "Program complete", detail: "Basic Obedience is finished." });
  const review = progressionOutcome({ session_log: { advancement_action: "assign_review" }, enrollment: { status: "active", current_lesson_name: "Heel Basics" } });
  expect(review.detail).toBe("Review Heel Basics before moving on.");
  const finalStay = progressionOutcome({ session_log: { advancement_action: "advance_next", at_final_lesson: true }, enrollment: { status: "active", current_lesson_name: "Last Lesson" } });
  expect(finalStay.detail).toMatch(/final lesson — the program stays open/);
});

test("the workspace renders the decision as a real single-choice control with no silent default", () => {
  expect(baseSrc).toMatch(/const \[action, setAction\] = useState\(null\)/);
  expect(baseSrc).toMatch(/role="radiogroup" aria-label="What should happen next" data-testid="progression-choices"/);
  expect(baseSrc).toMatch(/role="radio" aria-checked=\{selected\} aria-disabled=\{!c\.enabled \|\| undefined\}/);
  expect(baseSrc).toMatch(/focus-visible:ring-2/);
  expect(baseSrc).toMatch(/What should happen next\?/);
  expect(baseSrc).toMatch(/Finishing always saves today&apos;s session\. This only decides/);
  // advanced stays collapsed and secondary; dangerous actions confirm before the canonical POST
  expect(baseSrc).toMatch(/<details className="[^"]*" data-testid="advanced-progression">/);
  expect(baseSrc).toMatch(/if \(confirmation && !confirmed\) \{ setConfirming\(true\); return; \}/);
  expect(baseSrc).toMatch(/role="alertdialog" aria-labelledby="progression-confirm-title" data-testid="progression-confirm"/);
  expect(baseSrc).toMatch(/advancement_action: action,/);
  expect(baseSrc).toMatch(/next: "workspace-next-training-step"/); // Stage 10: the NEXT block of the shared HandoffPanel
  expect(baseSrc).not.toMatch(/needs_review/);
});
