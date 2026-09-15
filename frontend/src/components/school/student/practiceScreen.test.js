/**
 * @jest-environment jsdom
 */
// Training Experience Clarity Pass — Stage 4: the client Practice destination
// answers "what should I do today?" first. Real renders of PracticeScreen
// with server-shaped `home` view-models, plus the pure helpers (primary
// selection, completion handoff) and the shell wiring guards.
import fs from "fs";
import path from "path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PracticeScreen from "./PracticeScreen";
import { primaryPractice, practiceCompletionHandoff, practiceEmptyState, practiceProgressLabel } from "../../../lib/practiceState";
import { practiceBuckets } from "./practice/PracticeCards";

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");
const screenSrc = read("PracticeScreen.jsx");
const appSrc = read("..", "..", "..", "screens", "SchoolApp.jsx");
const panelSrc = read("..", "..", "training", "PracticePanel.jsx");
const stateSrc = read("..", "..", "..", "lib", "practiceState.js");
const serverSrc = read("..", "..", "..", "..", "..", "backend", "server.py");
// practice-history moved into the School domain module — same path, same contract
const schoolDomainSrc = read("..", "..", "..", "..", "..", "backend", "domains", "school", "routes.py");

const TODAY = new Date().toISOString().slice(0, 10);
const row = (id, over = {}) => ({
  id, status: "assigned", title: `Template ${id}`, school_lesson_name: null, dog_name: "Bella", minutes_per_session: 5,
  template_snapshot: { practice_coach: { goal: "Stay on Place while mild distractions are added.", schedule: { minutes_per_round: 5, rounds_per_day: 2 } } },
  trainer_personalized_note: "", required: true, assigned_by_trainer: false, session_linked: false, is_optional: false, sessions_logged: 0, ...over,
});
const home = (over = {}) => ({
  status: "active", delivery_mode: "online", dog: { id: "dog-a", name: "Bella" }, program: { name: "Foundations" },
  current_lesson: { id: "l5", name: "Place With Duration" },
  current_action: { type: "practice", label: "Start practice", sublabel: "Place With Duration", target: { screen: "lesson", lesson_id: "l5" } },
  active_practice: [row("hw-1", { school_lesson_name: "Place With Duration", trainer_personalized_note: "Keep the leash loose. Calmly reset if your dog gets up." })],
  journey: {
    last: { kind: "none" }, recap: null,
    now: { kind: "practice", title: "Practice Place With Duration", body: "5 minutes · 2 rounds", practice: { id: "hw-1", title: "Place With Duration" }, cta: { label: "Start Practice", run: "action" } },
    next: { kind: "next_lesson", title: "Adding Distance", body: "Available after today's Practice.", appointment: null },
  },
  ...over,
});
const render = (h, props = {}) => renderToStaticMarkup(React.createElement(PracticeScreen, { home: h, ...props }));
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

test("one Practice due today: a single dominant card, one button, no equal-weight rows", () => {
  const html = render(home());
  const t = text(html);
  expect(html).toMatch(/data-testid="practice-today"/);
  expect(t).toMatch(/Do this today/);
  expect(t).toMatch(/Place With Duration/);
  expect(t).toMatch(/Stay on Place while mild distractions are added\./);
  expect(t).toMatch(/about 10 min/);
  expect(t).toMatch(/Trainer note: Keep the leash loose\./);
  expect(t).toMatch(/Start Practice/);
  expect((html.match(/data-testid="practice-primary-action"/g) || []).length).toBe(1);
  expect(html).not.toMatch(/practice-group-upcoming/);
  expect(html).not.toMatch(/practice-empty/);
  // internal words never appear
  expect(t).not.toMatch(/assignment|queue|status code|not_started|in_progress|assigned_by/i);
});

test("the primary item is the row Today's NOW points at — never a competing choice", () => {
  const h = home({ active_practice: [row("hw-general", { due_date: TODAY, title: "Loose Leash Turns" }), row("hw-1", { school_lesson_name: "Place With Duration" })] });
  const pick = primaryPractice(h, practiceBuckets(h.active_practice, { recommendedId: "hw-1" }));
  expect(pick.hw.id).toBe("hw-1");
  expect(pick.hw.id).toBe(h.journey.now.practice.id);
  const html = render(h);
  expect(html).toMatch(/data-practice-primary="hw-1"/);
  // the due general row is still there, under More Practice, compact and tappable
  expect(html).toMatch(/data-testid="practice-group-upcoming"/);
  expect(text(html)).toMatch(/More Practice/);
  expect(html).toMatch(/data-testid="practice-card-hw-general"[^>]*data-state="due"/);
  expect(text(html)).toMatch(/Loose Leash Turns Due today/);
  // exactly one big button
  expect((html.match(/data-testid="practice-primary-action"/g) || []).length).toBe(1);
});

test("the Practice the trainer assigned at the last lesson (prominent recap) is the primary item, matching Today", () => {
  const h = home({ current_action: { type: "lesson", label: "Review your current lesson" }, delivery_mode: "in_person",
    active_practice: [row("hw-general", { due_date: TODAY, title: "Loose Leash Turns" }), row("hw-1", { school_lesson_name: "Place With Duration", session_linked: true })],
    journey: { ...home().journey, now: { kind: "lesson", title: "Place With Duration", body: "", practice: null, cta: { label: "Review your current lesson", run: "action" } },
      recap: { prominence: "prominent", practice_state: "due", practice: { id: "hw-1", title: "Place With Duration", state: "due" } } } });
  const pick = primaryPractice(h, practiceBuckets(h.active_practice, { today: TODAY }));
  expect(pick.hw.id).toBe("hw-1");
  expect(pick.reason).toBe("session");
  expect(text(render(h))).toMatch(/From your last lesson/);
});

test("a row waiting for trainer review never blocks actionable work from being today's item", () => {
  const waiting = row("hw-t", { title: "Recall", daily_tracker: true, daily_progress: [{ day_number: 1, status: "submitted", log: {} }, { day_number: 2, status: "locked" }] });
  const h = home({ current_action: { type: "lesson", label: "Start lesson" }, journey: { ...home().journey, now: { kind: "lesson", practice: null } },
    active_practice: [waiting, row("hw-open", { title: "Door Manners" })] });
  const pick = primaryPractice(h, practiceBuckets(h.active_practice, { today: TODAY }));
  expect(pick.hw.id).toBe("hw-open");
  const t = text(render(h));
  expect(t).toMatch(/Door Manners/);
  expect(t).toMatch(/Recall Waiting for trainer review/);
  // Only when nothing else is open does the waiting row become the featured item.
  const only = home({ current_action: { type: "lesson", label: "Start lesson" }, journey: { ...home().journey, now: { kind: "lesson", practice: null } }, active_practice: [waiting] });
  expect(primaryPractice(only, practiceBuckets(only.active_practice, { today: TODAY })).reason).toBe("review");
});

test("several active rows without a NOW pointer fall back to the same urgency order the screen always used", () => {
  const h = home({ journey: { ...home().journey, now: { kind: "lesson", title: "x", body: "", practice: null, cta: null } },
    current_action: { type: "lesson", label: "Start lesson" },
    active_practice: [row("later", { due_date: "2999-01-01" }), row("late", { due_date: "2000-01-01", title: "Recall" }), row("today", { due_date: TODAY })] });
  const pick = primaryPractice(h, practiceBuckets(h.active_practice, { today: TODAY }));
  expect(pick.hw.id).toBe("late");
  expect(pick.reason).toBe("overdue");
  const t = text(render(h));
  expect(t).toMatch(/Still to do/);
  expect(t).toMatch(/This Practice was planned for earlier\. You can complete it now\./);
  expect(t).not.toMatch(/OVERDUE!/);
});

test("trainer-assigned and session-linked rows say so in plain words; optional work is labelled optional only when the server says so", () => {
  const h = home({ active_practice: [
    row("hw-1", { school_lesson_name: "Place With Duration", session_linked: true, assigned_by_trainer: true }),
    row("hw-extra", { title: "Door Manners", assigned_by_trainer: true }),
    row("hw-opt", { title: "Loose Leash Turns", is_optional: true, required: false }),
  ] });
  const t = text(render(h));
  expect(t).toMatch(/From your last lesson/);
  expect(t).toMatch(/Door Manners .*Trainer assigned/);
  expect(t).toMatch(/Loose Leash Turns Optional extra work/);
});

test("completed today: no dominant start button, a clear done state, and NEXT from the journey", () => {
  const h = home({
    current_action: { type: "trainer_guided", label: "Keep practicing before your next session" }, delivery_mode: "in_person",
    active_practice: [row("hw-1", { school_lesson_name: "Place With Duration", required_practice_satisfied: true, sessions_logged: 1, last_session_at: new Date().toISOString() })],
    journey: { ...home().journey, now: { kind: "done_today", title: "You're done for today", body: "", practice: { id: "hw-1" }, cta: { label: "Practice again", run: "practice_row", secondary: true } },
      next: { kind: "next_lesson", title: "Adding Distance", body: "With your trainer at your next visit.", appointment: null } },
  });
  const html = render(h);
  const t = text(html);
  expect(html).toMatch(/practice-tab-done-for-today/);
  expect(t).toMatch(/You're done for today Nice work\./);
  expect(t).toMatch(/Next: Adding Distance — With your trainer at your next visit\./);
  expect(html).not.toMatch(/data-testid="practice-primary-action"/);
  expect(html).toMatch(/data-testid="practice-group-done"/);
  expect(t).toMatch(/Practice logged today/);
});

test("review pending is distinguished from completed and never asks to resubmit", () => {
  const tracker = row("hw-t", { title: "Recall Around Distractions", daily_tracker: true, total_days: 3,
    daily_progress: [{ day_number: 1, status: "submitted", log: { submission_status: "submitted" } }, { day_number: 2, status: "locked" }, { day_number: 3, status: "locked" }] });
  const h = home({ active_practice: [tracker], journey: { ...home().journey, now: { kind: "practice", title: "Practice Recall", body: "", practice: { id: "hw-t" }, cta: { label: "Start Practice", run: "action" } } } });
  const html = render(h);
  const t = text(html);
  expect(t).toMatch(/Waiting for trainer review/);
  expect(t).toMatch(/Submitted — your trainer will review it\. Nothing to resend\./);
  expect(html).not.toMatch(/data-testid="practice-primary-action"/);
  expect(t).not.toMatch(/Completed/);
});

test("review returned (needs another try) surfaces the next required action", () => {
  const tracker = row("hw-t", { title: "Recall", daily_tracker: true, total_days: 2,
    daily_progress: [{ day_number: 1, status: "needs_redo", log: { submission_status: "needs_redo", review_note: "Try with fewer distractions." } }, { day_number: 2, status: "locked" }] });
  const h = home({ active_practice: [tracker], journey: { ...home().journey, now: { kind: "practice", title: "Practice Recall", body: "", practice: { id: "hw-t" }, cta: { label: "Start Practice", run: "action" } } } });
  const t = text(render(h));
  expect(t).toMatch(/Your trainer asked for another try/);
  expect(t).toMatch(/Try again/);
});

test("section-based (daily) Practice shows honest partial progress and continues, never reads complete after one day", () => {
  const tracker = row("hw-t", { title: "Recall", daily_tracker: true, total_days: 4,
    daily_progress: [{ day_number: 1, status: "approved", log: { submission_status: "approved" } }, { day_number: 2, status: "approved", log: { submission_status: "approved" } }, { day_number: 3, status: "available" }, { day_number: 4, status: "locked" }] });
  expect(practiceProgressLabel(tracker)).toBe("2 of 4 days complete");
  const h = home({ active_practice: [tracker], journey: { ...home().journey, now: { kind: "practice", title: "Practice Recall", body: "", practice: { id: "hw-t" }, cta: { label: "Start Practice", run: "action" } } } });
  const html = render(h);
  expect(text(html)).toMatch(/2 of 4 days complete/);
  expect(text(html)).toMatch(/Continue Practice/);
  expect(html).toMatch(/data-practice-kind="continue"/);
  expect(text(html)).not.toMatch(/Practice complete/);
  // Completion is the Coach's canonical transition, not this screen's.
  expect(screenSrc).not.toMatch(/\/complete|section-log|api\./);
});

test("locked by the lesson reading gate: no start button, plain explanation, canonical lesson CTA", () => {
  const h = home({ delivery_mode: "hybrid", active_practice: [], current_action: { type: "lesson", label: "Start lesson" },
    journey: { ...home().journey, now: { kind: "lesson", title: "Place With Duration", body: "", practice: null, cta: { label: "Start lesson", run: "action" } },
      recap: { prominence: "prominent", practice: { id: "hw-1", title: "Place With Duration", state: "locked", note: "Keep the leash loose." }, practice_state: "locked" } } });
  const html = render(h, { onOpenLesson: () => {} });
  const t = text(html);
  expect(html).toMatch(/data-practice-kind="locked"/);
  expect(t).toMatch(/Finish the lesson first/);
  expect(t).toMatch(/unlocks after you finish the lesson instructions/);
  expect(t).toMatch(/Continue lesson/);
  expect(t).not.toMatch(/Start Practice/);
});

test("checkpoint remediation: the trainer's plan is the primary item with the engine's remaining-count sentence", () => {
  const h = home({ current_action: { type: "remediation", label: "Complete remediation", sublabel: "2 more practice sessions before you can resubmit your checkpoint." },
    active_practice: [row("hw-r", { title: "Place refresher" })],
    journey: { ...home().journey, now: { kind: "remediation", title: "Your trainer's Practice plan", body: "", practice: { id: "hw-r" }, cta: { label: "Start Practice", run: "action" } } } });
  const t = text(render(h, { onPrimaryAction: () => {} }));
  expect(t).toMatch(/Your trainer's plan/);
  expect(t).toMatch(/2 more practice sessions before you can resubmit/);
  expect(t).toMatch(/Start Practice/);
});

test("empty states are truthful per mode and action, never an empty shell", () => {
  const led = home({ delivery_mode: "in_person", active_practice: [], current_action: { type: "lesson", label: "Review your current lesson" }, journey: { ...home().journey, now: { kind: "lesson", practice: null } } });
  let html = render(led);
  expect(html).toMatch(/data-empty-kind="trainer_led"/);
  expect(text(html)).toMatch(/Nothing to practice right now Your trainer will assign Practice after your lesson\./);
  const online = home({ active_practice: [], current_action: { type: "lesson", label: "Start lesson" }, journey: { ...home().journey, now: { kind: "lesson", practice: null } } });
  html = render(online, { onGoCourse: () => {} });
  expect(text(html)).toMatch(/You're caught up Continue your Course when you're ready\. Go to Course/);
  const waiting = home({ active_practice: [], current_action: { type: "awaiting_review", label: "Awaiting trainer review" }, journey: { ...home().journey, now: { kind: "awaiting_review", practice: null } } });
  expect(text(render(waiting))).toMatch(/No Practice right now Your checkpoint is waiting for trainer review/);
  const done = home({ status: "completed", active_practice: [], current_action: { type: "course_complete", label: "Review your journey" }, journey: { ...home().journey, now: { kind: "course_complete", practice: null } } });
  expect(text(render(done))).toMatch(/Practice complete You've finished this program/);
  expect(practiceEmptyState({ current_action: { type: "trainer_assist" } }).kind).toBe("assist");
});

test("legacy rows without the newer fields still render one clean card", () => {
  const legacy = { id: "old", status: "assigned", title: "Old Sit Homework", dog_name: "Bella" };
  const h = home({ active_practice: [legacy], journey: { ...home().journey, now: { kind: "practice", title: "Practice", body: "", practice: { id: "old" }, cta: { label: "Start Practice", run: "action" } } } });
  const t = text(render(h));
  expect(t).toMatch(/Old Sit Homework/);
  expect(t).toMatch(/Start Practice/);
  expect(t).not.toMatch(/undefined|NaN|null/);
});

test("switching dogs or programs swaps the whole screen — the view-model is the only input", () => {
  const a = text(render(home()));
  const b = text(render(home({ dog: { id: "dog-b", name: "Max" }, program: { name: "Leash Skills" },
    active_practice: [row("hw-b", { title: "Heel", school_lesson_name: "Loose Leash Basics" })],
    journey: { ...home().journey, now: { kind: "practice", title: "Practice Loose Leash Basics", body: "", practice: { id: "hw-b" }, cta: { label: "Start Practice", run: "action" } }, next: { title: "Adding Turns", body: "" } } })));
  expect(a).toMatch(/Place With Duration/); expect(a).not.toMatch(/Loose Leash Basics|Max/);
  expect(b).toMatch(/Loose Leash Basics/); expect(b).toMatch(/Max/); expect(b).not.toMatch(/Place With Duration|Bella/);
  expect(screenSrc).not.toMatch(/api\.|fetch\(|localStorage/);
  // The shell resets history per selected enrollment and loads it per enrollment id.
  expect(appSrc).toMatch(/setPracticeHistory\(null\); loadHome\(\); loadDetail\(\);/);
  expect(appSrc).toMatch(/api\.get\(`\/portal\/school\/\$\{selectedId\}\/practice-history`/);
});

test("history stays on demand, small, and exact: Recently completed + View older Practice", () => {
  const h = home();
  let html = render(h, { history: null, onLoadHistory: () => {} });
  expect(text(html)).toMatch(/View older Practice/);
  html = render(h, { history: { items: [row("done-1", { status: "completed", completed_at: "2026-09-10T10:00:00Z", title: "Sit" })], total: 7 }, onLoadHistory: () => {} });
  const t = text(html);
  expect(t).toMatch(/Recently completed 7 total/);
  expect(t).toMatch(/Sit Completed 2026-09-10/);
  expect(t).toMatch(/Load more/);
  html = render(h, { history: { items: [row("done-1", { status: "completed" })], total: 1 }, onLoadHistory: () => {} });
  expect(text(html)).not.toMatch(/Load more|View older/);
  expect(schoolDomainSrc).toMatch(/\/portal\/school\/\{school_enrollment_id\}\/practice-history/);
  expect(schoolDomainSrc).toMatch(/lim = max\(1, min\(int\(limit or 5\), 50\)\)/);
});

test("the Practice Coach gets the lesson context from the row no matter who opened it (Today rail, recap, Practice page, deep link)", () => {
  const { lessonIdForPractice } = require("../../../lib/practiceState");
  const h = home({ active_practice: [row("hw-1", { school_lesson_id: "l5", school_lesson_name: "Place With Duration" })] });
  // Today rail / recap only know the row id → resolved from the view-model.
  expect(lessonIdForPractice(h, "hw-1")).toBe("l5");
  // An explicit lesson id (lesson screen's Start Practice) still wins.
  expect(lessonIdForPractice(h, "hw-1", "l9")).toBe("l9");
  // Unknown / legacy rows resolve to nothing rather than a wrong lesson.
  expect(lessonIdForPractice(h, "hw-old")).toBeNull();
  // The shell's single opener applies it, and every School caller goes through it.
  expect(appSrc).toMatch(/setPractice\(\{ homework: hw, lessonId: lessonIdForPractice\(home, homeworkId, lessonId\) \}\);/);
  // Today (twice: routed + fallback), Practice, and Coach all use the same opener.
  expect((appSrc.match(/onOpenPractice=\{\(hw\) => openHomework\(hw\?\.id \|\| hw\)\}/g) || []).length).toBe(4);
  // …and the Coach header prefers that lesson name over the template title.
  expect(panelSrc).toMatch(/\{schoolLesson\?\.name \|\| homework\.title\}/);
  expect(appSrc).toMatch(/schoolLesson=\{schoolLessonFor\(practice\.homework, practice\.lessonId\)\}/);
});

test("every Practice button leads to the canonical Practice Coach, and deep links keep opening rows directly", () => {
  expect(appSrc).toMatch(/onOpenPractice=\{\(hw\) => openHomework\(hw\?\.id \|\| hw\)\}/);
  expect(appSrc).toMatch(/api\.get\(`\/homework\/\$\{homeworkId\}`\)/);
  expect(screenSrc).toMatch(/onClick=\{\(\) => onOpen\?\.\(hw\)\}/);
  // Locked rows go to the lesson, not around the gate.
  expect(screenSrc).toMatch(/onOpenLesson\(home\.current_lesson\.id\)/);
});

// ---------------------------------------------------------------------------
// Completion handoff
// ---------------------------------------------------------------------------

test("completion handoff phrases the FRESH current action instead of a bare tick", () => {
  const recurring = practiceCompletionHandoff(home(), "hw-1");
  expect(recurring.title).toBe("Practice complete");
  expect(recurring.next.title).toMatch(/Come back tomorrow/);
  expect(recurring.cta.kind).toBe("today");

  const led = practiceCompletionHandoff(home({ journey: { ...home().journey, now: { kind: "done_today", title: "You're done for today", body: "", practice: { id: "hw-1" } }, next: { title: "Adding Distance", body: "With your trainer at your next visit." } } }), "hw-1");
  expect(led.body).toBe("You're caught up for today.");
  expect(led.next.title).toBe("Adding Distance");

  const adv = practiceCompletionHandoff(home({ journey: { ...home().journey, now: { kind: "advance", title: "You finished Place", body: "", practice: null, cta: { label: "Continue to next lesson", run: "action" } } } }), "hw-1");
  expect(adv.body).toBe("You're ready for the next lesson.");
  expect(adv.cta).toEqual({ label: "Back to Today", kind: "today" });

  const waiting = practiceCompletionHandoff(home({ journey: { ...home().journey, now: { kind: "awaiting_review", title: "Waiting", body: "", practice: null, cta: null } } }), "hw-1");
  expect(waiting.title).toBe("Practice submitted");
  expect(waiting.body).toMatch(/needs to review your checkpoint/);

  const rem = practiceCompletionHandoff(home({ journey: { ...home().journey, now: { kind: "remediation", title: "Plan", body: "", practice: { id: "hw-r" } }, next: { title: "Resubmit your checkpoint", body: "After 1 more Practice session." } } }), "hw-r");
  expect(rem.body).toMatch(/until the checkpoint requirements are met/);

  const review = practiceCompletionHandoff(home({ active_practice: [row("hw-t", { daily_tracker: true, daily_progress: [{ day_number: 1, status: "submitted", log: {} }] })] }), "hw-t");
  expect(review.title).toBe("Practice submitted");
  expect(review.body).toMatch(/needs to review this before you continue/);
});

test("the Coach renders the handoff and only routes when the client continues (no auto-close timer)", () => {
  expect(panelSrc).not.toMatch(/setTimeout\(\(\) => onCompleted\(\), 1400\)/);
  expect(panelSrc).toMatch(/Promise\.resolve\(onCompleted\(homework\.id\)\)/);
  expect(panelSrc).toMatch(/data-testid="practice-complete-title"/);
  expect(panelSrc).toMatch(/next: "practice-complete-next"/); // Stage 10: shared HandoffPanel, Stage 4 testids kept
  expect(panelSrc).toMatch(/onAction=\{\(\) => \(onContinue \? onContinue\(handoff\) : onClose\(\)\)\}/);
  expect(panelSrc).not.toMatch(/✓ Practice Saved/);
  // The shell computes the handoff from the same home reload Today uses, and routes on Continue.
  expect(appSrc).toMatch(/return practiceCompletionHandoff\(freshHome \|\| home, hwId\);/);
  expect(appSrc).toMatch(/onCompleted=\{practiceCompleted\} onContinue=\{continueAfterPractice\}/);
  // No second completion write anywhere on this path.
  expect(stateSrc).not.toMatch(/api\.|fetch\(/);
});

test("private trainer data never renders on the Practice screen", () => {
  const h = home({ active_practice: [row("hw-1", { school_lesson_name: "Place", trainer_personalized_note: "Loose leash." })] });
  const t = text(render(h));
  for (const bad of ["session_note", "PRIVATE", "reviewed_by_id", "grading_plan"]) expect(t).not.toMatch(bad);
  for (const bad of ["session_note", "trainer_note", "private", "internal"]) expect(screenSrc.toLowerCase()).not.toContain(bad);
});
