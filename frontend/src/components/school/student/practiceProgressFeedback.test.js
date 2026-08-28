// Client School redesign — phase 3: Practice, Practice Coach, Quick Check,
// Progress, Trainer Recap and Feedback.
//
// The bucketing, card modelling and coach-state selectors are pure, so they
// are tested BEHAVIOURALLY. React wiring is pinned the way this repo does
// elsewhere. Rendered behaviour was verified in the browser as a real enrolled
// client against the imported Sit Happens curriculum.
import fs from "fs";
import path from "path";
import { practiceBuckets, practiceCardModel } from "./practice/PracticeCards";
import {
  troubleshootingForState, troubleshootingByTrigger, guidedSessionProgress,
  REACTIVE_TIP_MISS_THRESHOLD, initGuidedState, guidedPracticeReducer,
} from "../../../lib/practiceCoachPolish";

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");
/* Assertions about what the UI must NOT contain run against code with
   comments and user-facing strings removed — a comment explaining why
   something is absent must not trip the check that proves it is absent. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const logicOnly = (src) => code(src).replace(/"[^"]*"/g, '""').replace(/`[^`]*`/g, "``");

const practiceScreenSrc = read("PracticeScreen.jsx");
const practiceCardsSrc = read("practice", "PracticeCards.jsx");
const coachSrc = read("..", "..", "training", "GuidedPracticeFlow.jsx");
const quizPanelSrc = read("ModuleQuizPanel.jsx");
const blocksSrc = read("LessonContentBlocks.jsx");
const progressSrc = read("ProgressScreen.jsx");
const recapSrc = read("LessonHistoryScreen.jsx");
const feedbackSrc = read("FeedbackScreen.jsx");

const TODAY = "2026-08-20";

// ---------------------------------------------------------------------------
// 1. Practice destination — "what should I practice today?"
// ---------------------------------------------------------------------------

test("practice is ordered by urgency, not by assignment order", () => {
  const b = practiceBuckets([
    { id: "future", due_date: "2026-09-01" },
    { id: "late", due_date: "2026-08-01" },
    { id: "today", due_date: TODAY },
    { id: "done", status: "completed" },
  ], { today: TODAY });
  expect(b.overdue.map(x => x.id)).toEqual(["late"]);
  expect(b.due.map(x => x.id)).toEqual(["today"]);
  expect(b.upcoming.map(x => x.id)).toEqual(["future"]);
  expect(b.completed.map(x => x.id)).toEqual(["done"]);
});

test("the recommended item is the one the SERVER named", () => {
  // This screen never picks a favourite of its own.
  const b = practiceBuckets([{ id: "a", due_date: "2026-09-01" }, { id: "b", due_date: "2026-09-02" }],
    { recommendedId: "b", today: TODAY });
  expect(b.recommended.map(x => x.id)).toEqual(["b"]);
  expect(b.upcoming.map(x => x.id)).toEqual(["a"]);
  expect(practiceScreenSrc).toMatch(/action\?\.type === "practice"/);
  expect(practiceScreenSrc).toMatch(/action\?\.target\?\.homework_id/);
});

test("a completed assignment is never re-listed as outstanding", () => {
  const b = practiceBuckets([{ id: "x", due_date: "2026-08-01", status: "completed" }], { today: TODAY });
  expect(b.overdue).toHaveLength(0);
  expect(b.completed.map(x => x.id)).toEqual(["x"]);
});

test("overdue is computed from the real due date", () => {
  expect(practiceCardModel({ due_date: "2026-08-01" }, { today: TODAY }).overdue).toBe(true);
  expect(practiceCardModel({ due_date: TODAY }, { today: TODAY }).overdue).toBe(false);
  expect(practiceCardModel({ due_date: null }, { today: TODAY }).overdue).toBe(false);
});

test("approximate time comes from the authored recipe, never invented", () => {
  const withSchedule = practiceCardModel({
    template_snapshot: { practice_coach: { schedule: { minutes_per_round: 10, rounds_per_day: 2 } } },
  }, { today: TODAY });
  expect(withSchedule.timeLabel).toBe("about 20 min");
  // one round -> no multiplication
  expect(practiceCardModel({ minutes_per_session: 8 }, { today: TODAY }).timeLabel).toBe("about 8 min");
  // nothing authored -> nothing claimed
  expect(practiceCardModel({}, { today: TODAY }).timeLabel).toBeNull();
});

test("trainer context appears only when a trainer actually wrote something", () => {
  expect(practiceCardModel({ trainer_personalized_note: "  " }, { today: TODAY }).trainerNote).toBe("");
  expect(practiceCardModel({ trainer_personalized_note: "Keep it short." }, { today: TODAY }).trainerNote).toBe("Keep it short.");
  expect(practiceCardsSrc).toMatch(/\{m\.trainerNote && \(/);
});

test("orange stays an attention state rather than the page's language", () => {
  // Only the overdue state may use the accent colour.
  const states = practiceCardsSrc.slice(practiceCardsSrc.indexOf("const STATE = {"), practiceCardsSrc.indexOf("/** Sort assignments"));
  const accentLines = states.split("\n").filter(l => l.includes("shAccent"));
  expect(accentLines).toHaveLength(1);
  expect(accentLines[0]).toMatch(/overdue/);
});

test("every Practice card leads to the canonical Practice engine", () => {
  // No second practice implementation: the screen hands the assignment off.
  expect(practiceCardsSrc).toMatch(/onOpen\(hw\)/);
  expect(logicOnly(practiceScreenSrc)).not.toMatch(/api\.|axios|fetch\(/);
});

// ---------------------------------------------------------------------------
// 2. Practice Coach — used while physically handling a dog
// ---------------------------------------------------------------------------

test("troubleshooting reacts to repeated misses instead of waiting in a drawer", () => {
  const pc = { troubleshooting: [
    { id: "t1", trigger: "no_response", title: "Missing the cue", actions: ["Reduce one variable"] },
    { id: "t3", trigger: "repeated_misses", title: "Two misses", actions: ["Make it easier"] },
  ] };
  const base = { phase: "active", missesInARow: 0 };
  expect(troubleshootingForState(pc, base)).toBeNull();
  expect(troubleshootingForState(pc, { ...base, missesInARow: 1 })).toBeNull();
  expect(troubleshootingForState(pc, { ...base, missesInARow: REACTIVE_TIP_MISS_THRESHOLD })?.id).toBe("t3");
});

test("a stopped round surfaces the recipe's own stop-round guidance", () => {
  const pc = { troubleshooting: [
    { id: "t1", trigger: "no_response", stop_round: false },
    { id: "t2", trigger: "over_aroused", stop_round: true },
  ] };
  expect(troubleshootingForState(pc, { phase: "stopped" })?.id).toBe("t2");
});

test("a recipe with no matching entry shows nothing rather than invented advice", () => {
  expect(troubleshootingForState({ troubleshooting: [] }, { phase: "active", missesInARow: 5 })).toBeNull();
  expect(troubleshootingForState(null, { phase: "active", missesInARow: 5 })).toBeNull();
  expect(troubleshootingByTrigger({ troubleshooting: [] }, "no_response")).toBeNull();
});

test("the reactive tip fires BEFORE the stop rule, never instead of it", () => {
  // Two misses coaches; three stops. Reversing that order would swallow the
  // safety stop behind a tip.
  const { STOP_RULE_MISS_THRESHOLD } = jest.requireActual("../../../lib/practiceCoachPolish");
  expect(REACTIVE_TIP_MISS_THRESHOLD).toBeLessThan(STOP_RULE_MISS_THRESHOLD);
});

test("session progress counts every round, not just the current one", () => {
  const s = { roundIndex: 1, repIndex: 3, roundsPerDay: 2, repsPerRound: 8 };
  expect(guidedSessionProgress(s)).toEqual({ done: 11, total: 16, pct: 69 });
});

test("the coach's grading and analytics are untouched by the redesign", () => {
  // The reducer still records exactly what it recorded before: outcomes,
  // totals, misses in a row, and the stop rule.
  const pc = { schedule: { rounds_per_day: 1, reps_per_round: 3 }, stop_rules: [{ message: "Stop." }] };
  let st = initGuidedState(pc);
  st = guidedPracticeReducer(st, { type: "RECORD_OUTCOME", outcome: "success" }, pc);
  expect(st.totals).toEqual({ repsAttempted: 1, successfulReps: 1, roundsCompleted: 0 });
  st = guidedPracticeReducer(st, { type: "ACK_OUTCOME" }, pc);
  st = guidedPracticeReducer(st, { type: "RECORD_OUTCOME", outcome: "miss" }, pc);
  expect(st.missesInARow).toBe(1);
  expect(st.totals.successfulReps).toBe(1);
});

test("the two outcome buttons are large, thumb-first and authored-label-first", () => {
  // The per-rep coaching upgrade grew the buttons again and rephrased the
  // default labels in plain beginner language; the recipe's own wording
  // still wins over both defaults.
  expect(coachSrc).toMatch(/min-h-\[72px\]/);
  expect(coachSrc).toMatch(/gp\.success_button_label \|\| "YES — THAT COUNTED"/);
  expect(coachSrc).toMatch(/gp\.miss_button_label \|\| "NO — RESET THIS REP"/);
});

test("active practice never demands typing", () => {
  const active = coachSrc.slice(coachSrc.indexOf('state.phase === "active"'), coachSrc.indexOf('state.phase === "resting"'));
  expect(active).not.toMatch(/<textarea|<input/);
});

test("one escape hatch, not two identical ones", () => {
  // These were previously two buttons side by side calling the same handler.
  expect((coachSrc.match(/onClick=\{onOpenTroubleshooting\}/g) || []).length).toBeLessThanOrEqual(2);
  expect(coachSrc).toMatch(/-im-stuck`/);
  expect(code(coachSrc)).not.toMatch(/Troubleshooting\s*<\/button>/);
});

// ---------------------------------------------------------------------------
// 3. Quick Knowledge Check
// ---------------------------------------------------------------------------

test("the module quiz asks one question at a time with visible progress", () => {
  expect(quizPanelSrc).toMatch(/Question \{i \+ 1\} of \{questions\.length\}/);
  expect(quizPanelSrc).toMatch(/data-testid="module-quiz-progress"/);
  expect(quizPanelSrc).toMatch(/data-testid="module-quiz-next"/);
  expect(quizPanelSrc).toMatch(/data-testid="module-quiz-back"/);
});

test("Next Question is blocked until the current one is answered", () => {
  expect(quizPanelSrc).toMatch(/onClick=\{\(\) => setQIndex\(i \+ 1\)\} disabled=\{!chosen\}/);
});

test("a retake starts at question one", () => {
  expect(quizPanelSrc).toMatch(/setQIndex\(0\);\s*\/\/ a retake starts at question one/);
});

test("module quiz grading stays server-authoritative", () => {
  // Every answer is still submitted together and scored by the server; the
  // pagination is presentation only.
  expect(quizPanelSrc).toMatch(/quiz\/submit/);
  expect(quizPanelSrc).toMatch(/answers: questions\.map/);
  // correct answers only ever appear as something the SERVER returned in the
  // graded result — never compared client-side to decide right or wrong.
  expect(quizPanelSrc).toMatch(/r\.correct_answer/);
  expect(logicOnly(quizPanelSrc)).not.toMatch(/===\s*\w*correct_answer|correct_answer\s*===/);
  expect(quizPanelSrc).toMatch(/result\.passed/);
  expect(logicOnly(quizPanelSrc)).not.toMatch(/passed\s*=\s*[^=]/);
});

test("the in-lesson check explains itself immediately, because it can", () => {
  // The authored block already carries the correct answer and explanation, so
  // there is nothing to wait for.
  expect(blocksSrc).toMatch(/const checked = options\.length \? !!answer : reflected/);
  expect(blocksSrc).toMatch(/block\.config\?\.explanation/);
  expect(blocksSrc).toMatch(/data-testid=\{`quick-check-feedback-\$\{block\.id\}`\}/);
});

test("the in-lesson check has large targets and an obvious selected state", () => {
  expect(blocksSrc).toMatch(/min-h-\[56px\]/);
  expect(blocksSrc).toMatch(/data-selected=\{on \? "true" : "false"\}/);
});

test("no quiz scoring rule is invented for the in-lesson check", () => {
  expect(blocksSrc).toMatch(/they do not unlock or block course progression/);
});

// ---------------------------------------------------------------------------
// 4. Progress
// ---------------------------------------------------------------------------

test("Progress ends with the server's own next action", () => {
  expect(progressSrc).toMatch(/data-testid="progress-momentum"/);
  expect(progressSrc).toMatch(/home\.current_action\.label/);
  // suppressed entirely when there is no action to offer
  expect(progressSrc).toMatch(/\{onPrimaryAction && home\?\.current_action\?\.label && \(/);
});

test("Progress fabricates no streak, ranking or XP", () => {
  // Word-boundary matched: "checkpoints" legitimately contains "points".
  for (const banned of [/streaks?/, /rank(ing|ed)?/, /xp/, /level ?up/,
                        /leaderboard/, /badges?/, /points(?!.*check)/]) {
    expect(code(progressSrc).toLowerCase()).not.toMatch(banned);
  }
});

test("Progress reports only metrics the server actually keeps", () => {
  expect(progressSrc).toMatch(/p\.lessons_completed/);
  expect(progressSrc).toMatch(/p\.modules_completed/);
  expect(progressSrc).toMatch(/p\.checkpoints_passed/);
  expect(progressSrc).toMatch(/mastered_pct/);
  // trophies are the real award record, not invented badges
  expect(progressSrc).toMatch(/portal\/trophies/);
});

// ---------------------------------------------------------------------------
// 5. Trainer lesson recap
// ---------------------------------------------------------------------------

test("the recap presents the whole professional report", () => {
  for (const field of ["date", "trainer_name", "module_name", "lesson_name",
                       "what_went_well", "needs_work", "trainer_feedback",
                       "next_lesson_focus", "practice_assigned"]) {
    expect(recapSrc).toContain(field);
  }
});

test("checkpoint scores are READ from the checkpoint record, not session data", () => {
  expect(recapSrc).toMatch(/checkpoint-history/);
  expect(recapSrc).toMatch(/data-testid=\{`lesson-history-checkpoint-\$\{l\.session_id\}`\}/);
  expect(recapSrc).toMatch(/handler=\{cp\.handler_overall\} dog=\{cp\.dog_overall\}/);
});

test("the recap renders the server's allowlisted payload without filtering it", () => {
  // Privacy is a server guarantee — this component must never become the
  // thing standing between an owner and a leaked internal note.
  expect(recapSrc).toMatch(/lesson-history/);
  expect(logicOnly(recapSrc)).not.toMatch(/trainer_only|private_note|internal_note|session_note/);
});

test("private trainer fields are absent from every client surface", () => {
  for (const src of [recapSrc, feedbackSrc, progressSrc, practiceCardsSrc]) {
    for (const forbidden of ["trainer_only_guidance", "trainer_prep_notes", "private", "internal"]) {
      expect(code(src).toLowerCase()).not.toContain(forbidden);
    }
  }
});

// ---------------------------------------------------------------------------
// 6. Feedback — the coaching inbox
// ---------------------------------------------------------------------------

test("Feedback surfaces every client-visible coaching source", () => {
  expect(feedbackSrc).toMatch(/checkpoint-history/);      // checkpoint feedback
  expect(feedbackSrc).toMatch(/lesson-history/);          // trainer lesson recaps
  expect(feedbackSrc).toMatch(/practice_reviews/);        // practice feedback
  expect(feedbackSrc).toMatch(/support\.threads/);        // trainer conversation
  expect(feedbackSrc).toMatch(/trainer_assist/);          // Trainer Assist
});

test("Feedback creates no second feedback store", () => {
  // Recaps are a second VIEW of the same allowlisted record.
  expect(feedbackSrc).toMatch(/setRecaps\(lh\?\.lessons \|\| \[\]\)/);
  expect(logicOnly(feedbackSrc)).not.toMatch(/api\.post\(`\/portal\/school\/\$\{enrollmentId\}\/feedback/);
});

test("Feedback claims nothing is there only when every source is empty", () => {
  // A client with practice feedback but no checkpoint HAS heard from their
  // trainer, and must not be told otherwise.
  expect(feedbackSrc).toMatch(/history\.length === 0 && recaps\.length === 0/);
  expect(feedbackSrc).toMatch(/\(support\.practice_reviews \|\| \[\]\)\.length === 0/);
  expect(feedbackSrc).toMatch(/\(support\.threads \|\| \[\]\)\.length === 0/);
});
