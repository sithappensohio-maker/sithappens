/**
 * @jest-environment jsdom
 */
// Training Experience Clarity Pass — Stage 2: the client LAST → NOW → NEXT
// rail on Today. These render the real card with server-shaped `home`
// view-models (the same shape backend/test_school_journey.py pins) and
// check the words a client sees per state, that the primary button is the
// journey's NOW action, and that two dogs / two programs never blend.
import fs from "fs";
import path from "path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TodayCommandCard } from "./StudentHome";
import { journeyWhen, appointmentLabel, practiceCoveredByJourney } from "./today/journey";

const homeSrc = fs.readFileSync(path.join(__dirname, "StudentHome.jsx"), "utf8");

const base = (over = {}) => ({
  school_enrollment_id: "se-1", status: "active", access_state: "active", delivery_mode: "online",
  dog: { id: "dog-a", name: "Bella", photo: "" },
  program: { name: "Puppy Foundations" },
  current_lesson: { id: "l5", name: "Place With Duration" },
  current_action: { type: "practice", label: "Start practice", sublabel: "Place With Duration", target: { screen: "lesson", lesson_id: "l5" } },
  progress: { course_pct: 40, lessons_completed: 4, lessons_total: 10 },
  active_practice: [],
  journey: {
    last: { kind: "session", eyebrow: "Last lesson with your trainer", title: "Place With Distractions",
            summary: "Worked on staying in Place while the door opened.", at: new Date(Date.now() - 86400000).toISOString() },
    now: { kind: "practice", title: "Practice Place With Duration", body: "5 minutes · 2 rounds",
           practice: { id: "hw-1", title: "Place With Duration", detail: "5 minutes · 2 rounds", note: "Keep the leash loose and reset calmly.", sessions_logged: 0 },
           cta: { label: "Start Practice", run: "action" } },
    next: { kind: "next_lesson", title: "Lesson 6 — Adding Distance", body: "Available after today's Practice.", appointment: null },
  },
  ...over,
});

const render = (home, props = {}) => renderToStaticMarkup(React.createElement(TodayCommandCard, { home, ...props }));
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

test("the rail reads LAST → NOW → NEXT in that order, and NOW carries the only primary button", () => {
  const html = render(base());
  const iLast = html.indexOf('data-testid="today-journey-last"');
  const iNow = html.indexOf('data-testid="today-journey-now"');
  const iNext = html.indexOf('data-testid="today-journey-next"');
  expect(iLast).toBeGreaterThan(-1);
  expect(iNow).toBeGreaterThan(iLast);
  expect(iNext).toBeGreaterThan(iNow);
  expect((html.match(/data-testid="today-primary-action"/g) || []).length).toBe(1);
  const t = text(html);
  expect(t).toMatch(/Last · Last lesson with your trainer/);
  expect(t).toMatch(/Place With Distractions/);
  expect(t).toMatch(/Yesterday/);
  expect(t).toMatch(/Now · Do this now/);
  expect(t).toMatch(/Practice Place With Duration/);
  expect(t).toMatch(/5 minutes · 2 rounds/);
  expect(t).toMatch(/Trainer note: Keep the leash loose/);
  expect(t).toMatch(/Start Practice/);
  expect(t).toMatch(/Lesson 6 — Adding Distance/);
  expect(t).toMatch(/Available after today's Practice\./);
  // The dog and program are visible so a household with two dogs knows whose rail this is.
  expect(t).toMatch(/Puppy Foundations · Bella · Online/);
  expect(html).toMatch(/data-journey-dog="dog-a"/);
});

test("trainer-led journey: NEXT waits for the trainer, names a booked visit only when one exists", () => {
  const led = base({
    delivery_mode: "in_person",
    current_action: { type: "trainer_guided", label: "Keep practicing before your next session", sublabel: "Your trainer will advance Place With Duration when you're ready." },
    active_practice: [{ id: "hw-1", status: "assigned", required_practice_satisfied: true, sessions_logged: 1 }],
    journey: {
      last: base().journey.last,
      now: { kind: "done_today", title: "You're done for today", body: "Keep practicing Place With Duration until your next lesson with your trainer.",
             practice: { id: "hw-1", title: "Place With Duration", detail: "", note: null, sessions_logged: 1 },
             cta: { label: "Practice again", run: "practice_row", secondary: true } },
      next: { kind: "next_lesson", title: "Adding Distance", body: "With your trainer at your next visit. Keep practicing until then.", appointment: null },
    },
  });
  let html = render(led);
  let t = text(html);
  expect(t).toMatch(/Now · Done for today/);
  expect(t).toMatch(/You're done for today/);
  expect(t).toMatch(/at your next visit/);
  expect(html).not.toMatch(/Your next visit:/);
  // Done for today: there is deliberately NO big button (nothing is due), and
  // "Practice again" is a clearly secondary control.
  expect(html).not.toMatch(/data-testid="today-primary-action"/);
  expect(html).toMatch(/data-testid="today-journey-secondary-action"/);
  expect(t).toMatch(/Practice again/);
  expect(t).toMatch(/Trainer-Led/);

  led.journey.next.appointment = { date: "2099-06-01", time: "14:00", status: "approved" };
  html = render(led);
  expect(text(html)).toMatch(/Your next visit: .*Jun 1 · 2:00 PM/);
  led.journey.next.appointment.status = "pending";
  expect(text(render(led))).toMatch(/\(requested\)/);
});

test("online lesson continuation and hybrid wording", () => {
  const lesson = base({
    current_action: { type: "lesson", label: "Start lesson", sublabel: "Learn Place With Duration before you practice." },
    journey: { ...base().journey,
      now: { kind: "lesson", title: "Place With Duration", body: "Learn Place With Duration before you practice.", practice: null, cta: { label: "Continue lesson", run: "action" } },
      next: { kind: "next_lesson", title: "Adding Distance", body: "Available after this lesson and its Practice.", appointment: null } },
  });
  let t = text(render(lesson));
  expect(t).toMatch(/Continue lesson/);
  expect(t).toMatch(/Available after this lesson and its Practice/);

  const hybrid = base({ delivery_mode: "hybrid", journey: { ...base().journey,
    next: { kind: "next_lesson", title: "Adding Distance", body: "Available after today's Practice. Your trainer also works through it with you in person.", appointment: { date: "2099-06-03", time: null, status: "approved" } } } });
  t = text(render(hybrid));
  expect(t).toMatch(/Hybrid/);
  expect(t).toMatch(/works through it with you in person/);
  expect(t).toMatch(/Your next visit: .*Jun 3/);
});

test("waiting for checkpoint review shows no fake button and says so plainly", () => {
  const waiting = base({
    current_action: { type: "awaiting_review", label: "Awaiting trainer review", sublabel: "You submitted your Place With Duration checkpoint — your trainer will review it soon." },
    journey: {
      last: { kind: "checkpoint_submitted", eyebrow: "Last checkpoint", title: "Checkpoint: Place With Duration", summary: "Submitted — your trainer will review it.", at: new Date().toISOString() },
      now: { kind: "awaiting_review", title: "Waiting for trainer review", body: "You don't need to do anything right now. Your trainer will review your checkpoint soon.", practice: null, cta: null },
      next: { kind: "checkpoint_review", title: "Checkpoint review", body: "Your trainer will review your submission before you continue. Then: Adding Distance.", appointment: null },
    },
  });
  const html = render(waiting);
  expect(html).not.toMatch(/data-testid="today-primary-action"/);
  expect(html).toMatch(/data-testid="today-journey-waiting"/);
  const t = text(html);
  expect(t).toMatch(/Waiting for trainer review/);
  expect(t).toMatch(/nothing to do right now/);
  expect(t).toMatch(/Today/); // the submission is stamped today
});

test("checkpoint remediation: NOW is the trainer's plan, NEXT is the resubmission", () => {
  const rem = base({
    current_action: { type: "remediation", label: "Complete remediation", sublabel: "2 more practice sessions before you can resubmit your checkpoint." },
    journey: {
      last: { kind: "checkpoint", eyebrow: "Last checkpoint", title: "Checkpoint: Place With Duration", summary: "Your trainer asked for more Practice first. Loosen the leash.", at: new Date().toISOString() },
      now: { kind: "remediation", title: "Your trainer's Practice plan", body: "2 more practice sessions before you can resubmit your checkpoint.", practice: null, cta: { label: "Start Practice", run: "action" } },
      next: { kind: "checkpoint_resubmit", title: "Resubmit your checkpoint", body: "After 2 more Practice sessions.", appointment: null },
    },
  });
  const t = text(render(rem));
  expect(t).toMatch(/more Practice first\. Loosen the leash\./);
  expect(t).toMatch(/Your trainer's Practice plan/);
  expect(t).toMatch(/Resubmit your checkpoint/);
  expect(t).toMatch(/After 2 more Practice sessions/);
});

test("program complete is intentional, not a dead end", () => {
  const done = base({
    current_action: { type: "course_complete", label: "Review your journey", sublabel: "You completed the program — see everything your dog learned." },
    journey: {
      last: { kind: "checkpoint", eyebrow: "Last checkpoint", title: "Checkpoint: Recall", summary: "Passed — you moved on.", at: new Date().toISOString() },
      now: { kind: "course_complete", title: "Program complete", body: "You and Bella finished Puppy Foundations. Every lesson stays open for review.", practice: null, cta: { label: "See your progress", run: "action" } },
      next: { kind: "next_program", title: "Next program: Level 2", body: "Ask your trainer when you're ready for it.", appointment: null },
    },
  });
  const t = text(render(done));
  expect(t).toMatch(/Program complete/);
  expect(t).toMatch(/See your progress/);
  expect(t).toMatch(/Next program: Level 2/);
});

test("legacy history and a brand-new enrollment never leave a blank card", () => {
  const legacy = base({ journey: { ...base().journey,
    last: { kind: "session", eyebrow: "Last lesson with your trainer", title: "Lesson with your trainer", summary: "Your trainer logged this lesson.", at: null } } });
  let t = text(render(legacy));
  expect(t).toMatch(/Lesson with your trainer/);
  expect(t).toMatch(/Your trainer logged this lesson\./);
  expect(t).not.toMatch(/\bNone\b|\bUnknown\b|\bundefined\b/);

  const fresh = base({
    current_action: { type: "lesson", label: "Start lesson", sublabel: "Learn Name Response before you practice." },
    journey: {
      last: { kind: "none", eyebrow: "Just getting started", title: "Nothing logged yet", summary: "Your first lesson is right below.", at: null },
      now: { kind: "lesson", title: "Name Response", body: "Learn Name Response before you practice.", practice: null, cta: { label: "Start lesson", run: "action" } },
      next: { kind: "next_lesson", title: "The Marker Word", body: "Available after this lesson and its Practice.", appointment: null },
    },
  });
  t = text(render(fresh));
  expect(t).toMatch(/Just getting started/);
  expect(t).toMatch(/Nothing logged yet/);
  expect(t).not.toMatch(/—\s*(Now|Next)/);
});

test("without a journey block (older payload) the card still renders NOW from current_action", () => {
  const html = render(base({ journey: undefined }));
  expect(html).not.toMatch(/today-journey-last/);
  expect(html).not.toMatch(/today-journey-next/);
  expect(html).toMatch(/data-testid="today-primary-action"/);
  expect(text(html)).toMatch(/Start practice/);
});

test("switching dogs swaps LAST, NOW and NEXT together — never Dog A's last with Dog B's next", () => {
  const dogA = base();
  const dogB = base({
    dog: { id: "dog-b", name: "Max", photo: "" }, program: { name: "Leash Skills" }, delivery_mode: "in_person",
    current_action: { type: "lesson", label: "Review your current lesson", sublabel: "Loose Leash Basics" },
    journey: {
      last: { kind: "none", eyebrow: "Just getting started", title: "Nothing logged yet", summary: "Your first lesson is right below.", at: null },
      now: { kind: "lesson", title: "Loose Leash Basics", body: "Loose Leash Basics", practice: null, cta: { label: "Review your current lesson", run: "action" } },
      next: { kind: "next_lesson", title: "Adding Turns", body: "With your trainer at your next visit.", appointment: null },
    },
  });
  const a = text(render(dogA));
  const b = text(render(dogB));
  expect(a).toMatch(/Bella/); expect(a).toMatch(/Place With Distractions/); expect(a).toMatch(/Lesson 6/);
  expect(b).toMatch(/Max/); expect(b).toMatch(/Nothing logged yet/); expect(b).toMatch(/Adding Turns/);
  for (const leak of ["Bella", "Place With Distractions", "Lesson 6", "Puppy Foundations"]) expect(b).not.toMatch(leak);
  for (const leak of ["Max", "Adding Turns", "Leash Skills"]) expect(a).not.toMatch(leak);
});

test("the rail is one view-model: the card reads nothing outside `home`, and the shell passes the selected enrollment's home", () => {
  // No second fetch and no module-level state that could survive a dog switch.
  expect(homeSrc).not.toMatch(/journey.*api\.get/);
  expect(homeSrc).not.toMatch(/let (last|now|next)Cache/);
  expect(homeSrc).toMatch(/const journey = home\?\.journey \|\| null;/);
  // The shell reloads `home` per selected enrollment (SchoolApp), which is
  // what keeps two programs on one dog from blending.
  const appSrc = fs.readFileSync(path.join(__dirname, "..", "..", "..", "screens", "SchoolApp.jsx"), "utf8");
  expect(appSrc).toMatch(/api\.get\(`\/portal\/school\/\$\{selectedId\}\/home`\)/);
  expect(appSrc).toMatch(/setHomeLoading\(true\); setHome\(null\); setDetail\(null\); setPracticeHistory\(null\); loadHome\(\); loadDetail\(\);/);
});

test("the practice_row CTA opens the named Practice row; everything else runs current_action", () => {
  expect(homeSrc).toMatch(/if \(c\?\.run === "practice_row" && now\?\.practice\?\.id && onOpenPractice\) onOpenPractice\(now\.practice\);/);
  expect(homeSrc).toMatch(/else onPrimaryAction\?\.\(\);/);
});

test("Today stops repeating the rail: the practice card only renders for rows NOW does not name", () => {
  expect(homeSrc).toMatch(/!practiceCoveredByJourney\(home\) && !practiceCoveredByRecap\(home\) && <PracticeCard/);
  expect(homeSrc).toMatch(/!home\.journey && <NextMilestoneCard/);
  const h = base({ active_practice: [{ id: "hw-1", status: "assigned" }] });
  expect(practiceCoveredByJourney(h)).toBe(true);
  // A second open row (a trainer's general Practice) still earns the card.
  h.active_practice.push({ id: "hw-general", status: "assigned", title: "Loose-Leash Bonus" });
  expect(practiceCoveredByJourney(h)).toBe(false);
  // NOW pointing at a satisfied row while another open row exists → the card shows the open one.
  const led = base({ active_practice: [{ id: "hw-1", status: "assigned", required_practice_satisfied: true }, { id: "hw-general", status: "assigned" }],
    journey: { ...base().journey, now: { kind: "practice_row", title: "Practice Loose-Leash Bonus", body: "", practice: { id: "hw-general" }, cta: { label: "Start Practice", run: "practice_row" } } } });
  expect(practiceCoveredByJourney(led)).toBe(true);
  expect(practiceCoveredByJourney(base({ journey: undefined }))).toBe(false);
});

test("date helpers speak plainly", () => {
  const now = new Date("2026-09-14T15:00:00");
  expect(journeyWhen("2026-09-14T09:00:00", now)).toBe("Today");
  expect(journeyWhen("2026-09-13T22:00:00", now)).toBe("Yesterday");
  expect(journeyWhen("2026-09-11T22:00:00", now)).toBe("3 days ago");
  expect(journeyWhen("2026-08-30T22:00:00", now)).toMatch(/Aug 30/);
  expect(journeyWhen(null, now)).toBe("");
  expect(appointmentLabel({ date: "2099-06-01", time: "09:05", status: "approved" })).toMatch(/Jun 1 · 9:05 AM/);
  expect(appointmentLabel({ date: "2099-06-01", time: null, status: "approved" })).toMatch(/Jun 1$/);
  expect(appointmentLabel(null)).toBe("");
});
