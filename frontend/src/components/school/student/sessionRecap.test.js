/**
 * @jest-environment jsdom
 */
// Training Experience Clarity Pass — Stage 3: the post-lesson client handoff
// rendered INSIDE the LAST → NOW → NEXT rail. Server-shaped `journey.recap`
// fixtures (the shape backend/test_school_recap.py pins) drive the real card.
import fs from "fs";
import path from "path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TodayCommandCard } from "./StudentHome";
import { recapMode, recapHeading, practiceCoveredByRecap } from "./today/journey";

const homeSrc = fs.readFileSync(path.join(__dirname, "StudentHome.jsx"), "utf8");
const cssSrc = fs.readFileSync(path.join(__dirname, "..", "..", "..", "index.css"), "utf8");
const appSrc = fs.readFileSync(path.join(__dirname, "..", "..", "..", "screens", "SchoolApp.jsx"), "utf8");

const NOW_ISO = new Date().toISOString();
const recapFull = (over = {}) => ({
  session_at: NOW_ISO, trainer_name: "Garrett", lesson_name: "Place With Distractions",
  went_well: "Stayed on Place for 20 seconds while the door opened.",
  needs_work: "Breaking position when someone walks in.",
  next_focus: "Door distractions and longer duration.",
  trainer_message: "Lexi did great once we slowed the setup down. Keep resets calm.",
  outcome_label: "Staying on this lesson for now.",
  observations: [{ skill: "Place", observation: "Held for 20 seconds.", outcome: "Improving" }],
  practice: { id: "hw-1", title: "Place With Duration", detail: "5 minutes · 2 rounds", note: "Keep the leash loose and reset calmly.", state: "due", sessions_logged: 0 },
  practice_state: "due", prominence: "prominent",
  ...over,
});
const base = (over = {}) => ({
  status: "active", delivery_mode: "in_person",
  dog: { id: "dog-a", name: "Lexi", photo: "" }, program: { name: "Foundations" },
  current_lesson: { id: "l5", name: "Place With Distractions" },
  current_action: { type: "lesson", label: "Review your current lesson", sublabel: "Place With Distractions" },
  progress: { course_pct: 40, lessons_completed: 4, lessons_total: 10 },
  active_practice: [{ id: "hw-1", status: "assigned" }],
  journey: {
    last: { kind: "session", eyebrow: "Last lesson with your trainer", title: "Place With Distractions", summary: "Stayed on Place for 20 seconds while the door opened.", at: NOW_ISO },
    recap: recapFull(),
    now: { kind: "lesson", title: "Place With Distractions", body: "Place With Distractions", practice: null, cta: { label: "Review your current lesson", run: "action" } },
    next: { kind: "next_lesson", title: "Adding Distance", body: "With your trainer at your next visit. Keep practicing until then.", appointment: null },
  },
  ...over,
});
const render = (home) => renderToStaticMarkup(React.createElement(TodayCommandCard, { home }));
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");

test("a just-completed trainer session is the whole rail: recap in LAST, its Practice in NOW, next focus in NEXT", () => {
  const html = render(base());
  const t = text(html);
  expect(t).toMatch(/Today's training recap/);
  expect(t).toMatch(/Last · What happened Place With Distractions/);
  expect(t).toMatch(/Today · with Garrett · Staying on this lesson for now\./);
  expect(t).toMatch(/What went well Stayed on Place for 20 seconds while the door opened\./);
  expect(t).toMatch(/Keep working on Breaking position when someone walks in\./);
  expect(t).toMatch(/Lexi did great once we slowed the setup down/);
  expect(t).toMatch(/Now · Practice at home Practice Place With Duration/);
  expect(t).toMatch(/5 minutes · 2 rounds/);
  expect(t).toMatch(/Trainer note: Keep the leash loose/);
  expect(t).toMatch(/Start Practice/);
  expect(t).toMatch(/Next · Next focus Door distractions and longer duration\. Adding Distance/);
  // One primary button; the engine's own action stays reachable as a smaller link.
  expect((html.match(/data-testid="today-primary-action"/g) || []).length).toBe(1);
  expect(html).toMatch(/data-testid="today-journey-engine-action"/);
  expect(t).toMatch(/Review your current lesson/);
  // No disclosure while prominent, no raw enum values, no private text.
  expect(html).not.toMatch(/today-recap-disclosure/);
  expect(t).not.toMatch(/\bremain\b|not_yet|needs_more_work|improving\b/);
});

test("the Practice CTA opens the canonical Practice row through the existing Practice Coach hook", () => {
  expect(homeSrc).toMatch(/const recapCta = recapPracticeDue \? \{ label: "Start Practice", run: "practice_row", practiceId: recapPractice\.id \} : null;/);
  expect(homeSrc).toMatch(/if \(c\?\.run === "practice_row" && c\.practiceId && onOpenPractice\) onOpenPractice\(\{ id: c\.practiceId \}\);/);
  // SchoolApp's onOpenPractice is the one Practice Coach opener (GET /homework/{id}).
  expect(appSrc).toMatch(/onOpenPractice=\{\(hw\) => openHomework\(hw\?\.id \|\| hw\)\}/);
  expect(appSrc).toMatch(/api\.get\(`\/homework\/\$\{homeworkId\}`\)/);
});

test("Practice already completed: no giant start button, a caught-up message, NEXT explains the step", () => {
  const home = base({ journey: { ...base().journey, recap: recapFull({ practice_state: "completed", practice: { id: "hw-1", title: "Place With Duration", detail: "", note: null, state: "completed", sessions_logged: 2 }, prominence: "reduced" }) } });
  // Reduced → normal rail with the recap behind a disclosure.
  let html = render(home);
  expect(html).toMatch(/today-recap-disclosure/);
  expect(text(html)).toMatch(/Show recap/);
  expect(text(html)).toMatch(/Keep working on Breaking position/); // content is still there, just folded
  expect(text(html)).not.toMatch(/Start Practice/);
  // After the client logs that Practice, LAST becomes the Practice event — the recap must still be one tap away.
  const logged = base({ journey: { ...home.journey, last: { kind: "practice", eyebrow: "Last Practice", title: "Practice: Place With Distractions", summary: "Practice logged — nice work staying consistent.", at: NOW_ISO } } });
  const loggedHtml = render(logged);
  expect(loggedHtml).toMatch(/today-recap-disclosure/);
  expect(text(loggedHtml)).toMatch(/Lesson recap · Place With Distractions/);
  expect(text(loggedHtml)).toMatch(/What went well Stayed on Place/);
  // If the server still marks it prominent with a completed row (edge), the copy says caught up.
  home.journey.recap.prominence = "prominent";
  html = render(home);
  expect(text(html)).toMatch(/Practice completed/);
  expect(text(html)).toMatch(/you're caught up/);
  expect(text(html)).not.toMatch(/Start Practice/);
});

test("no Practice assigned is said plainly and never renders an empty Practice section", () => {
  const home = base({ active_practice: [], journey: { ...base().journey, recap: recapFull({ practice: null, practice_state: "none" }) } });
  const t = text(render(home));
  expect(t).toMatch(/No home Practice from this lesson/);
  expect(t).toMatch(/Nothing to log at home from this one\. Your next step is below\./);
  expect(t).not.toMatch(/Start Practice/);
  expect(t).toMatch(/Review your current lesson/); // engine action is the button
  expect(t).not.toMatch(/Trainer note:/);
});

test("hybrid: a locked Practice explains the online gate instead of hiding the trainer's assignment", () => {
  const home = base({ delivery_mode: "hybrid", journey: { ...base().journey,
    recap: recapFull({ practice_state: "locked", practice: { ...recapFull().practice, state: "locked" } }),
    next: { kind: "next_lesson", title: "Adding Distance", body: "Available after today's Practice. Your trainer also works through it with you in person.", appointment: null } } });
  const html = render(home);
  const t = text(html);
  expect(t).toMatch(/Finish this lesson's reading in the app first/);
  expect(t).not.toMatch(/Start Practice/);
  expect(t).toMatch(/Review your current lesson/);
  expect(t).toMatch(/Hybrid/);
  expect(t).toMatch(/works through it with you in person/);
});

test("legacy session with none of the modern fields renders one honest line, never blank labels", () => {
  const home = base({ journey: { ...base().journey, recap: recapFull({ went_well: null, needs_work: null, next_focus: null, trainer_message: null, outcome_label: null, observations: [], practice: null, practice_state: "none" }) } });
  const t = text(render(home));
  expect(t).toMatch(/Worked with your trainer on Place With Distractions\./);
  expect(t).not.toMatch(/What went well/);
  expect(t).not.toMatch(/Keep working on/);
  expect(t).not.toMatch(/Next focus/);
  expect(t).not.toMatch(/—\s*(Now|Next)|\bNone\b|undefined/);
});

test("an online enrollment with no trainer session shows the ordinary rail (no recap section at all)", () => {
  const home = base({ delivery_mode: "online", active_practice: [], journey: { ...base().journey, recap: null, last: { kind: "none", eyebrow: "Just getting started", title: "Nothing logged yet", summary: "Your first lesson is right below.", at: null } } });
  const html = render(home);
  expect(text(html)).toMatch(/Today's Next Step/);
  expect(html).not.toMatch(/today-recap-/);
  expect(text(html)).not.toMatch(/recap/i);
});

test("the recap message is omitted when the trainer left none, and the trainer's name is shown with it when present", () => {
  const noMsg = base({ journey: { ...base().journey, recap: recapFull({ trainer_message: null }) } });
  expect(render(noMsg)).not.toMatch(/today-recap-trainer-message/);
  const withMsg = render(base());
  expect(withMsg).toMatch(/today-recap-trainer-message/);
  expect(text(withMsg)).toMatch(/— Garrett/);
});

test("switching dogs swaps the recap with the rest of the rail — Dog A's session never sits above Dog B's Practice", () => {
  const a = text(render(base()));
  const b = text(render(base({
    dog: { id: "dog-b", name: "Max", photo: "" }, program: { name: "Leash Skills" }, active_practice: [],
    current_lesson: { id: "l1", name: "Loose Leash Basics" },
    current_action: { type: "lesson", label: "Review your current lesson", sublabel: "Loose Leash Basics" },
    journey: { ...base().journey, recap: null,
      now: { kind: "lesson", title: "Loose Leash Basics", body: "Loose Leash Basics", practice: null, cta: { label: "Review your current lesson", run: "action" } },
      last: { kind: "none", eyebrow: "Just getting started", title: "Nothing logged yet", summary: "Your first lesson is right below.", at: null },
      next: { kind: "next_lesson", title: "Adding Turns", body: "With your trainer at your next visit.", appointment: null } },
  })));
  expect(a).toMatch(/Lexi/); expect(a).toMatch(/Place With Distractions/); expect(a).toMatch(/Garrett/);
  expect(b).toMatch(/Max/); expect(b).toMatch(/Nothing logged yet/); expect(b).toMatch(/Adding Turns/);
  for (const leak of ["Lexi", "Place With Distractions", "Garrett", "door opened"]) expect(b).not.toMatch(leak);
});

test("the Today practice card steps aside while the recap carries the same Practice, but not for other rows", () => {
  expect(practiceCoveredByRecap(base())).toBe(true);
  const two = base({ active_practice: [{ id: "hw-1", status: "assigned" }, { id: "hw-general", status: "assigned" }] });
  expect(practiceCoveredByRecap(two)).toBe(false);
  const reduced = base({ journey: { ...base().journey, recap: recapFull({ prominence: "reduced" }) } });
  expect(practiceCoveredByRecap(reduced)).toBe(false);
  expect(recapMode(base().journey)).toBe("prominent");
  expect(recapMode(reduced.journey)).toBe("reduced");
  expect(recapMode({ recap: null })).toBeNull();
  expect(recapHeading(recapFull())).toBe("Today's training recap");
  expect(recapHeading(recapFull({ session_at: "2020-01-01T10:00:00Z" }))).toBe("Your last lesson recap");
});

test("320px School shell: the scroll-root's phone padding is not doubled by the page gutter", () => {
  expect(appSrc).toMatch(/className="app-scroll-root sh-school-scroll /);
  expect(appSrc).toMatch(/max-w-5xl mx-auto w-full px-3\.5 sm:px-6/);
  expect(cssSrc).toMatch(/\.app-scroll-root\.sh-school-scroll \{ padding-left:0 !important; padding-right:0 !important; \}/);
  // The rule lives inside the same phone media query as the padding it corrects.
  const block = cssSrc.slice(cssSrc.indexOf("@media (max-width: 767px)"), cssSrc.indexOf("@media (max-width: 359px)"));
  expect(block).toMatch(/\.app-scroll-root \{ padding:14px !important; \}/);
  expect(block).toMatch(/sh-school-scroll/);
});
