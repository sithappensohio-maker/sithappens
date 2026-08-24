// School delivery-system handholding — curriculum-agnostic by design.
//
// Existing programs keep their authored curriculum and progression model while
// the client-facing shell supplies the direction a true beginner needs.
import fs from "fs";
import path from "path";
import { buildGuide, GUIDE_SECTIONS } from "./lesson/LessonGuide";
import { actionCoachCopy } from "./SchoolOrientation";

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");
const orientationSrc = read("SchoolOrientation.jsx");
const homeSrc = read("StudentHome.jsx");
const guideSrc = read("lesson", "LessonGuide.jsx");
const lessonSrc = read("LessonScreen.jsx");
const workspaceSrc = read("StudentWorkspaceExtras.jsx");
const schoolAppSrc = read("../../../screens/SchoolApp.jsx");
const completionSrc = read("CourseCompletionCard.jsx");

test("existing legacy lessons are mapped into the new plain-language delivery steps", () => {
  const lesson = {
    client_overview: "Why this matters",
    equipment_needed: "Treats and leash",
    client_instructions: "1. Do this\n2. Then this",
    common_mistakes: "Do not repeat the cue",
    success_criteria: "Five good repetitions",
  };
  const steps = buildGuide(lesson, { hasPractice: true });
  expect(steps.filter(s => s.kind === "instructional").map(s => s.key)).toEqual([
    "learn", "get_ready", "train", "watch_for", "know_got_it",
  ]);
  expect(steps.find(s => s.key === "train").body).toContain("Do this");
});

test("existing Course Builder blocks keep using their same semantic mapping", () => {
  const lesson = { content_blocks: [
    { type: "text", title: "Why this matters", body: "Intro", order: 1 },
    { type: "checklist", title: "Equipment", items: ["Treats"], order: 2 },
    { type: "steps", title: "Steps", items: ["One", "Two"], order: 3 },
    { type: "text", title: "Common mistakes", body: "Mistake", order: 4 },
    { type: "text", title: "Success criteria", body: "Success", order: 5 },
  ]};
  const steps = buildGuide(lesson, { hasPractice: true });
  expect(steps.find(s => s.key === "learn").blocks[0].body).toBe("Intro");
  expect(steps.find(s => s.key === "get_ready").blocks[0].type).toBe("checklist");
  expect(steps.find(s => s.key === "train").blocks[0].type).toBe("steps");
  expect(steps.find(s => s.key === "watch_for").blocks[0].body).toBe("Mistake");
  expect(steps.find(s => s.key === "know_got_it").blocks[0].body).toBe("Success");
});

test("student part labels tell a beginner what to physically do", () => {
  const labels = Object.fromEntries(GUIDE_SECTIONS.map(s => [s.key, s.label]));
  expect(labels.learn).toBe("Read This First");
  expect(labels.get_ready).toBe("Get Your Stuff Ready");
  expect(labels.train).toBe("Do This With Your Dog");
  expect(labels.watch_for).toBe("If This Happens, Do This");
  expect(labels.know_got_it).toBe("How You'll Know It's Working");
  expect(labels.next_step).toMatch(/What's Next/);
});

test("each instructional part tells the client what their job is and uses an explicit acknowledgement", () => {
  expect(guideSrc).toMatch(/Your job right now/);
  expect(guideSrc).toMatch(/Do not start training yet/);
  expect(guideSrc).toMatch(/I READ THIS — NEXT/);
  expect(guideSrc).toMatch(/I'M READY — NEXT/);
  expect(guideSrc).toMatch(/I DID THESE STEPS — NEXT/);
  expect(guideSrc).toMatch(/I KNOW WHAT TO WATCH FOR — NEXT/);
  expect(guideSrc).toMatch(/I KNOW WHAT SUCCESS LOOKS LIKE/);
});

test("a fresh lesson has an unmistakable Start Lesson moment", () => {
  expect(guideSrc).toMatch(/fresh-lesson-start/);
  expect(guideSrc).toMatch(/New lesson · Start here/);
  expect(guideSrc).toMatch(/Start Lesson — Show Me Part 1/);
  expect(guideSrc).toMatch(/You have not started this lesson yet/);
});

test("lesson progress uses the same part count the client can actually see", () => {
  expect(guideSrc).toMatch(/Lesson journey/);
  expect(guideSrc).toMatch(/Part \{partIndex \+ 1\} of \{sections\.length\}/);
  expect(guideSrc).toMatch(/-progress"\]\{display:none!important/);
});

test("Today explains the current server action instead of expecting the client to interpret it", () => {
  expect(actionCoachCopy({ type: "lesson" }, "Bella")).toMatch(/one step at a time/i);
  expect(actionCoachCopy({ type: "practice" }, "Bella")).toMatch(/Bella/);
  expect(actionCoachCopy({ type: "advance" }, "Bella")).toMatch(/correct next lesson automatically/i);
  expect(homeSrc).toMatch(/data-testid="today-command-center"/);
  expect(homeSrc).toMatch(/What you do now/);
  expect(homeSrc).toMatch(/actionCoachCopy\(action, home\?\.dog\?\.name\)/);
});

test("Today never collapses to a blank page when its shortcut view-model fails", () => {
  expect(homeSrc).toMatch(/student-home-unavailable/);
  expect(homeSrc).toMatch(/One quick step before training/);
  expect(homeSrc).toMatch(/one-time setup below/);
  expect(homeSrc).toMatch(/Open All Lessons/);
  expect(homeSrc).toMatch(/student-home-open-course-fallback/);
});

test("first-time School orientation teaches the GPS-style workflow and can be reopened", () => {
  expect(orientationSrc).toMatch(/You do not need to know how to use School/);
  expect(orientationSrc).toMatch(/Use the big next button/);
  expect(orientationSrc).toMatch(/Do one step at a time/);
  expect(orientationSrc).toMatch(/Go back whenever you want/);
  expect(orientationSrc).toMatch(/sh_school_orientation_v3/);
  expect(orientationSrc).toMatch(/How School works/);
  expect(homeSrc).toMatch(/<SchoolOrientation dogName=\{home\.dog\?\.name\}/);
});

test("required School setup is explained and shown before the current lesson", () => {
  expect(workspaceSrc).toMatch(/Before your first lesson · one-time setup/);
  expect(workspaceSrc).toMatch(/This is not a test/);
  expect(workspaceSrc).toMatch(/Save & Start My First Lesson/);
  expect(lessonSrc).toMatch(/current_action\?\.type === "onboarding"/);
  expect(lessonSrc).toMatch(/lesson-onboarding-gate/);
  expect(lessonSrc).toMatch(/<SchoolOnboarding/);
  expect(schoolAppSrc).toMatch(/go\("today"\);\s*revealOnboarding\(\)/);
});

test("Today recovers the onboarding form only for the real Home setup blocker", () => {
  expect(workspaceSrc).toMatch(/homeBlockedByOnboarding/);
  expect(workspaceSrc).toMatch(/online school setup/);
  expect(workspaceSrc).toMatch(/recoveringMissingHome/);
  expect(workspaceSrc).toMatch(/!home&&!!workspace&&!baseline&&homeBlockedByOnboarding/);
  expect(workspaceSrc).toMatch(/require_equipment_check:false/);
  expect(workspaceSrc).toMatch(/This is the step School was waiting for/);
  expect(workspaceSrc).toMatch(/Today plan will appear automatically/);
});

test("part completion visibly leads to the server-selected next lesson destination", () => {
  expect(guideSrc).toMatch(/finishAndRevealNext/);
  expect(guideSrc).toMatch(/await Promise\.resolve\(onComplete\(section\.key\)\)/);
  expect(guideSrc).toMatch(/result\?\.next_instructional_step/);
  expect(guideSrc).toMatch(/revealStepOrAction\(destination\)/);
  expect(guideSrc).toMatch(/lesson-actions/);
  expect(guideSrc).toMatch(/lesson-section-guided-/);
});

test("completed courses explicitly become a reusable library without resetting completion", () => {
  expect(completionSrc).toMatch(/Review any lesson/);
  expect(completionSrc).toMatch(/original completion stays saved/);
});
