// Client School redesign — phase 4: the checkpoint experience.
//
// The state machine, the "what unlocked" derivation and the score handling are
// pure, so they are tested BEHAVIOURALLY. React wiring is pinned the way this
// repo does elsewhere. Every state was also exercised end to end in a browser
// against the real imported curricula, driving real submissions and real
// trainer grades through the canonical endpoints.
import fs from "fs";
import path from "path";
import {
  checkpointState, nextStepAfter, NON_SUBMITTING_STATES,
} from "./checkpoint/CheckpointCards";

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");
/* Assertions about what the UI must NOT contain run against code with
   comments and user-facing strings removed — a comment explaining why
   something is absent must not trip the check that proves it is absent. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const logicOnly = (src) => code(src).replace(/"[^"]*"/g, '""').replace(/`[^`]*`/g, "``");

const panelSrc = read("CheckpointPanel.jsx");
const cardsSrc = read("checkpoint", "CheckpointCards.jsx");
const lessonSrc = read("LessonScreen.jsx");
const progressSrc = read("ProgressScreen.jsx");
const feedbackSrc = read("FeedbackScreen.jsx");

const RUBRIC = {
  title: "Module Checkpoint — Foundation Prep",
  handler_criteria: [{ id: "h1", name: "Cue clarity & timing" }, { id: "h2", name: "Handling mechanics" }],
  dog_criteria: [{ id: "d1", name: "First-cue response" }],
  submission_instructions: "Use a secure fenced area or attached long line; never stage unsafe off-leash work for a video.",
  submission_requirements: "Show the full setup and enough repetitions to judge consistency.",
};

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

test("an in-person student is never put in a submitting state", () => {
  // B6. The server answers a client submission with 409; the UI must never
  // offer the action in the first place.
  for (const mode of ["in_person", "trainer_led"]) {
    expect(checkpointState({ deliveryMode: mode, practiced: true })).toBe("in_person");
    expect(checkpointState({ deliveryMode: mode, practiced: false })).toBe("in_person");
  }
});

test("online and hybrid students follow the submitting path", () => {
  // Hybrid clients CAN submit — verified against the live endpoint, which
  // accepted a hybrid submission and refused the in-person one.
  for (const mode of ["online", "hybrid", undefined]) {
    expect(checkpointState({ deliveryMode: mode, practiced: false })).toBe("not_ready");
    expect(checkpointState({ deliveryMode: mode, practiced: true })).toBe("ready");
  }
});

test("a submitted checkpoint is awaiting review, whatever the delivery mode", () => {
  expect(checkpointState({ status: { status: "awaiting_review" }, deliveryMode: "online" })).toBe("awaiting_review");
  expect(checkpointState({ status: { status: "awaiting_review" }, deliveryMode: "in_person" })).toBe("awaiting_review");
});

test("each graded outcome maps to its own experience", () => {
  const g = (outcome) => checkpointState({ status: { status: "graded", outcome }, practiced: true });
  expect(g("advance")).toBe("passed");
  expect(g("prescribe_practice")).toBe("more_practice");
  expect(g("trainer_assist_recommended")).toBe("trainer_assist");
});

test("an active Trainer Assist hold outranks every other state", () => {
  expect(checkpointState({
    status: { status: "graded", outcome: "prescribe_practice", on_hold: true, trainer_assist: { status: "scheduled" } },
  })).toBe("trainer_assist");
});

test("a cleared Trainer Assist hands back to the checkpoint, not to a fake pass", () => {
  expect(checkpointState({
    status: { status: "graded", outcome: "prescribe_practice", on_hold: false, trainer_assist: { status: "completed" } },
  })).toBe("assist_complete");
  // ...but a hold cleared on a PASSED checkpoint stays passed.
  expect(checkpointState({
    status: { status: "graded", outcome: "advance", on_hold: false, trainer_assist: { status: "completed" } },
  })).toBe("passed");
});

// ---------------------------------------------------------------------------
// No forbidden action is ever offered
// ---------------------------------------------------------------------------

test("no submit control exists in any non-submitting state", () => {
  // Each of these branches returns before the submit form is constructed.
  const submitting = panelSrc.indexOf("function CheckpointSubmitForm");
  const branches = panelSrc.slice(0, submitting);
  for (const state of NON_SUBMITTING_STATES) {
    const idx = branches.indexOf(`state === "${state}"`);
    expect(idx).toBeGreaterThan(-1);
    const next = branches.indexOf("/* ---", idx);
    const body = branches.slice(idx, next === -1 ? undefined : next);
    expect(body).not.toMatch(/CheckpointSubmitForm/);
  }
});

test("awaiting review offers no way to submit again", () => {
  const start = panelSrc.indexOf('state === "awaiting_review"');
  const body = panelSrc.slice(start, panelSrc.indexOf('state === "passed"'));
  expect(body).not.toMatch(/PracticeMediaUploader|school-checkpoint-submit/);
});

test("More Practice offers no advancement action the server would reject", () => {
  const start = panelSrc.indexOf('state === "more_practice"');
  const body = panelSrc.slice(start, panelSrc.indexOf('state === "not_ready"'));
  expect(logicOnly(body)).not.toMatch(/onContinue|onAdvance|advance\(/);
  // the strongest action is practice
  expect(body).toMatch(/data-testid="school-checkpoint-start-prescribed"/);
  // and the resubmit form only appears when the required practice is done
  expect(body).toMatch(/\{canResubmit && \(/);
  expect(body).toMatch(/const canResubmit = !remaining \|\| remaining <= 0/);
});

test("Trainer Assist offers no advancement and invents no booking flow", () => {
  const start = panelSrc.indexOf('state === "trainer_assist"');
  const body = panelSrc.slice(start, panelSrc.indexOf('state === "assist_complete"'));
  expect(logicOnly(body)).not.toMatch(/onContinue|advance\(/);
  expect(body).not.toMatch(/CheckpointSubmitForm/);
  // nothing in the payload can create an appointment, so nothing offers one
  expect(body.toLowerCase()).not.toMatch(/book (a|an|your)|pick a time|choose a slot/);
});

test("a double tap cannot produce a second submission", () => {
  // The server also refuses one with a 409, verified live; this stops the UI
  // firing the request twice in the first place.
  expect(panelSrc).toMatch(/const \[sent, setSent\] = useState\(false\)/);
  expect(panelSrc).toMatch(/if \(sent \|\| busy\) return; setSent\(true\)/);
  expect(panelSrc).toMatch(/disabled=\{!videoDataUrl \|\| busy \|\| sent\}/);
});

// ---------------------------------------------------------------------------
// Scores — persisted, never manufactured
// ---------------------------------------------------------------------------

test("scores come from the persisted overalls and are never defaulted", () => {
  // No `|| 0`, no `?? 0`, no rounding of an absent score into existence.
  expect(cardsSrc).toMatch(/handler=\{entry\.handler_overall\} dog=\{entry\.dog_overall\}/);
  expect(logicOnly(cardsSrc)).not.toMatch(/handler_overall\s*\|\|\s*0|handler_overall\s*\?\?\s*0/);
  expect(logicOnly(cardsSrc)).not.toMatch(/dog_overall\s*\|\|\s*0|dog_overall\s*\?\?\s*0/);
  expect(panelSrc).toMatch(/handler=\{status\?\.handler_overall\} dog=\{status\?\.dog_overall\}/);
});

test("a legacy checkpoint with no resolvable score says so instead of showing zero", () => {
  expect(cardsSrc).toMatch(/const missing = handler == null && dog == null/);
  expect(cardsSrc).toMatch(/data-scored=\{missing \? "false" : "true"\}/);
  expect(cardsSrc).toMatch(/Scores weren&apos;t recorded for this checkpoint/);
});

test("the per-criterion breakdown skips criteria with no recorded score", () => {
  expect(cardsSrc).toMatch(/\.filter\(\(r\) => Number\.isFinite\(Number\(r\.score\)\)\)/);
  expect(cardsSrc).toMatch(/if \(!h\.length && !d\.length\) return null/);
});

test("Progress keeps legacy checkpoint rows in the record", () => {
  // Filtering them out told a client with a real passed checkpoint that they
  // had none at all.
  expect(progressSrc).toMatch(/const graded = \(history \|\| \[\]\)\.filter\(\(x\) => x && x\.status === "graded"\)/);
  expect(progressSrc).toMatch(/\{graded\.length === 0 \?/);
  expect(progressSrc).toMatch(/data-testid=\{`progress-checkpoint-unscored-\$\{x\.id\}`\}/);
  // the average is still only taken over rows that have numbers
  expect(progressSrc).toMatch(/const scored = graded\.filter\(\(x\) => x\.handler_overall != null \|\| x\.dog_overall != null\)/);
});

test("Feedback explains an unscored row rather than leaving bare dashes", () => {
  expect(feedbackSrc).toMatch(/data-testid=\{`feedback-unscored-\$\{entry\.id\}`\}/);
  expect(feedbackSrc).toMatch(/entry\.handler_overall == null && entry\.dog_overall == null/);
});

// ---------------------------------------------------------------------------
// What passing actually unlocks
// ---------------------------------------------------------------------------

test("the unlocked step is read from the roadmap, never invented", () => {
  const roadmap = {
    current_lesson_id: "l2", current_module_id: "m1",
    modules: [{ id: "m1", name: "Foundation", lessons: [{ id: "l1" }, { id: "l2" }, { id: "l3", name: "Day 3" }] },
              { id: "m2", name: "Loose-Leash Walking", lessons: [] }],
  };
  expect(nextStepAfter(roadmap)).toEqual({ kind: "lesson", name: "Day 3" });
});

test("the last lesson of a module points at the next module", () => {
  const roadmap = {
    current_lesson_id: "l3",
    modules: [{ id: "m1", lessons: [{ id: "l3" }] }, { id: "m2", name: "Loose-Leash Walking", lessons: [] }],
  };
  expect(nextStepAfter(roadmap)).toEqual({ kind: "module", name: "Loose-Leash Walking" });
});

test("a roadmap that cannot say returns null rather than guessing", () => {
  expect(nextStepAfter(null)).toBeNull();
  expect(nextStepAfter({ modules: [] })).toBeNull();
  expect(nextStepAfter({ current_lesson_id: "x", modules: [{ id: "m1", lessons: [{ id: "x" }] }] })).toBeNull();
  expect(panelSrc).toMatch(/if \(!next\) return "The next step in your course is ready\."/);
});

test("passing is never presented as a real-world permission", () => {
  // Level 3 is an off-leash curriculum. Passing an online checkpoint unlocks
  // the next LESSON — it is not a statement that a dog may now be off leash.
  for (const src of [panelSrc, cardsSrc]) {
    expect(code(src).toLowerCase()).not.toMatch(/off.?leash (ready|certified|approved|permission)|unrestricted|now allowed off/);
  }
  expect(panelSrc).toMatch(/Your next lesson is ready|The next module is open/);
});

// ---------------------------------------------------------------------------
// Preparation content
// ---------------------------------------------------------------------------

test("preparation shows context, skills, criteria and requirements", () => {
  for (const piece of ["SkillsCovered", "ScoredCriteria", "SubmissionRequirements", "WhatHappensNext"]) {
    expect(panelSrc).toContain(piece);
  }
  expect(lessonSrc).toMatch(/moduleName=\{data\.module_name\}/);
  expect(lessonSrc).toMatch(/skills=\{data\.skills\}/);
});

test("authored safety copy is rendered in full, never clamped", () => {
  // Advanced curricula carry real safety constraints in this text; truncating
  // one to tidy a card is not a trade this UI may make.
  const start = cardsSrc.indexOf("export function SubmissionRequirements");
  const body = cardsSrc.slice(start, cardsSrc.indexOf("export function WhatHappensNext"));
  expect(body).not.toMatch(/line-clamp|truncate|slice\(/);
  expect(body).toMatch(/whitespace-pre-wrap/);
});

test("the trainer's mark scheme is never shown to the client", () => {
  // The server strips pass_readiness_guidance and per-criterion guidance; the
  // client must not reintroduce them by reading those keys.
  for (const src of [panelSrc, cardsSrc]) {
    expect(code(src)).not.toMatch(/pass_readiness_guidance|c\.guidance|criterion\.guidance/);
  }
  expect(cardsSrc).toMatch(/\{c\.name\}/);
});

test("no response time is promised for a review", () => {
  expect(code(panelSrc)).not.toMatch(/within \d|\d+ (hours|business days)|24 hours|48 hours/i);
});

// ---------------------------------------------------------------------------
// Result durability + accessibility
// ---------------------------------------------------------------------------

test("a passed checkpoint stays visible after the enrolment auto-advances", () => {
  // Passing advances the enrolment server-side, so the live checkpoint status
  // is already gone when the client looks. The persisted record is the source.
  expect(lessonSrc).toMatch(/checkpoint-history/);
  expect(lessonSrc).toMatch(/\(rows \|\| \[\]\)\.find\(\(r\) => r\.lesson_id === lessonId\)/);
  expect(lessonSrc).toMatch(/\{!isCurrent && cpResult && \(/);
});

test("the celebration respects reduced motion and is decorative only", () => {
  expect(cardsSrc).toMatch(/prefers-reduced-motion: reduce/);
  expect(cardsSrc).toMatch(/\$\{motion \? "animate-bounce" : ""\}/);
  expect(cardsSrc).toMatch(/aria-hidden="true"/);
});

test("result state is never conveyed by colour alone", () => {
  // Every outcome carries a word and an icon, not just a hue.
  expect(cardsSrc).toMatch(/eyebrow: "Passed"/);
  expect(cardsSrc).toMatch(/eyebrow: "Trainer Assist"/);
  expect(cardsSrc).toMatch(/eyebrow: "More practice"/);
  expect(cardsSrc).toMatch(/data-outcome=\{outcome \|\| "reviewed"\}/);
});

test("the submit control carries a meaningful accessible label", () => {
  expect(panelSrc).toMatch(/aria-label=\{resubmit \? "Submit checkpoint again for trainer review" : "Submit checkpoint for trainer review"\}/);
  expect(panelSrc).toMatch(/htmlFor="cp-note"/);
  expect(panelSrc).toMatch(/id="cp-note"/);
  expect(panelSrc).toMatch(/role="alert"/);
});

test("primary checkpoint actions stay thumb-sized", () => {
  const bigButtons = panelSrc.match(/min-h-\[5[02]px\]/g) || [];
  expect(bigButtons.length).toBeGreaterThanOrEqual(4);
});
