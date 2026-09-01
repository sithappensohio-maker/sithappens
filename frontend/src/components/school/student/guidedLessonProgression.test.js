// Online School — the guided lesson progression.
//
// The lesson stopped being eight equally-clickable rows and became a
// sequence: what you finished, where you are, what is next, what is locked
// and why. The progression RULES are pure functions, so they are tested
// behaviourally; the React wiring is pinned the way this repo does elsewhere.
//
// The gate itself is enforced on the server (see
// backend/test_school_guided_lesson.py) — nothing here should be read as
// proving a client-side lock is sufficient. What these tests protect is that
// the UI tells the truth about the server's state and never invents its own.
//
// Rendered behaviour was verified in the browser as a real enrolled client at
// 1440x900, 390x844 and 320x568.
import fs from "fs";
import path from "path";
import {
  buildGuide, groupBlocks, stepState, currentStepKey, lockReason, instructionalKeys,
  GUIDE_SECTIONS, GUIDE_MIN_CONTENT_STEPS,
} from "./lesson/LessonGuide";

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
// The guided-lesson implementation is deliberately split: LessonGuide.jsx is
// the beginner-language delivery wrapper and LessonGuideBase.jsx keeps the
// proven mapper/renderer (see LessonGuide.jsx's header). Every pinned
// behaviour below must hold across the pair, so read them as one source.
const guideSrc = read("lesson", "LessonGuide.jsx") + read("lesson", "LessonGuideBase.jsx");
const lessonSrc = read("LessonScreen.jsx");
const blocksSrc = read("LessonContentBlocks.jsx");

const RICH = {
  client_overview: "Why this matters.",
  equipment_needed: "Treats, lead.",
  client_instructions: "1. Lure\n2. Mark",
  common_mistakes: "Repeating the cue.",
  success_criteria: "Five in a row.",
};
const sections = (opts = { hasPractice: true, hasQuiz: true }) => buildGuide(RICH, opts);

// ---------------------------------------------------------------------------
// The sequence is a progression, not a menu
// ---------------------------------------------------------------------------

test("every step declares whether it is instructional", () => {
  // The instructional ones are what gate Practice, so the distinction has to
  // live in the data rather than in a hard-coded list of five keys.
  for (const s of GUIDE_SECTIONS) expect(s.kind).toBeTruthy();
  expect(GUIDE_SECTIONS.filter(s => s.kind === "instructional").map(s => s.key))
    .toEqual(["learn", "get_ready", "train", "watch_for", "know_got_it"]);
  expect(GUIDE_SECTIONS.find(s => s.key === "practice").kind).toBe("practice");
});

test("only instructional steps count towards the gate", () => {
  expect(instructionalKeys(sections())).toEqual(
    ["learn", "get_ready", "train", "watch_for", "know_got_it"]);
});

test("the current step is the first unfinished instructional one", () => {
  const s = sections();
  expect(currentStepKey(s, { completed: [] })).toBe("learn");
  expect(currentStepKey(s, { completed: ["learn"] })).toBe("get_ready");
  expect(currentStepKey(s, { completed: ["learn", "get_ready"] })).toBe("train");
});

test("once the material is done the current step becomes Practice", () => {
  const s = sections();
  const all = instructionalKeys(s);
  expect(currentStepKey(s, { completed: all, practiceUnlocked: true })).toBe("practice");
});

test("a practised lesson moves the client on to Quick Check", () => {
  const s = sections();
  const all = instructionalKeys(s);
  expect(currentStepKey(s, {
    completed: all, practiceUnlocked: true, practiced: true, quickCheckUnlocked: true,
  })).toBe("quick_check");
});

// ---------------------------------------------------------------------------
// Completed / current / locked
// ---------------------------------------------------------------------------

test("a finished step reads as completed and stays revisitable", () => {
  const s = sections();
  const learn = s.find(x => x.key === "learn");
  expect(stepState(learn, { completed: ["learn"] })).toBe("completed");
  // completed is never "locked" — the teaching material stays open for review
  expect(stepState(learn, { completed: ["learn"] })).not.toBe("locked");
});

test("Practice is locked until every instructional step is finished", () => {
  const s = sections();
  const practice = s.find(x => x.key === "practice");
  expect(stepState(practice, { completed: [], practiceUnlocked: false })).toBe("locked");
  expect(stepState(practice, { completed: instructionalKeys(s), practiceUnlocked: true }))
    .not.toBe("locked");
});

test("Quick Check is locked until the lesson has been practised", () => {
  const s = sections();
  const quick = s.find(x => x.key === "quick_check");
  expect(stepState(quick, { quickCheckUnlocked: false })).toBe("locked");
  expect(stepState(quick, { quickCheckUnlocked: true })).not.toBe("locked");
});

test("Next Step will not imply the lesson is finished while work remains", () => {
  const s = sections();
  const next = s.find(x => x.key === "next_step");
  expect(stepState(next, { practiceUnlocked: false, quickCheckUnlocked: false })).toBe("locked");
  expect(stepState(next, { practiceUnlocked: true, quickCheckUnlocked: false })).toBe("locked");
});

test("a locked step always says what would unlock it", () => {
  const s = sections();
  expect(lockReason(s.find(x => x.key === "practice"), {})).toMatch(/lesson material/i);
  expect(lockReason(s.find(x => x.key === "practice"),
    { practiceLockedReason: "Finish Learn to unlock Practice." })).toBe("Finish Learn to unlock Practice.");
  expect(lockReason(s.find(x => x.key === "quick_check"), {})).toMatch(/practice/i);
});

// ---------------------------------------------------------------------------
// The UI reflects the SERVER, and never decides for itself
// ---------------------------------------------------------------------------

test("progression state is read from the server payload", () => {
  expect(lessonSrc).toMatch(/const stepsCompleted = data\.steps_completed \|\| \[\]/);
  expect(lessonSrc).toMatch(/const practiceUnlocked = data\.practice_unlocked === true/);
  expect(lessonSrc).toMatch(/const quickCheckUnlocked = data\.quick_check_unlocked !== false/);
  // the client must not compute its own unlock rule
  const logic = code(lessonSrc).replace(/"[^"]*"/g, '""').replace(/`[^`]*`/g, "``");
  expect(logic).not.toMatch(/practiceUnlocked =\s*(true|false)\s*;/);
});

test("finishing a step posts to the canonical endpoint", () => {
  expect(lessonSrc).toMatch(/\/steps\/\$\{stepKey\}\/complete/);
  expect(lessonSrc).toMatch(/await load\(\)/);
});

test("a double-tap cannot record the same step twice", () => {
  // The guard now reports the ignored duplicate to its caller (the
  // completion-response step advancement) instead of returning bare.
  expect(lessonSrc).toMatch(/if \(stepBusy\) return \{ ok: false, ignored: true \};/);
  expect(lessonSrc).toMatch(/disabled=\{busy\}/);
});

test("opening a section does not complete it", () => {
  // Selecting a row only changes which body is shown; completion is a
  // separate, explicit action at the end of the content.
  const onSelect = lessonSrc.slice(lessonSrc.indexOf("onSelectSection={(k)"),
                                   lessonSrc.indexOf("onSelectSection={(k)") + 420);
  expect(onSelect).not.toMatch(/completeStep|steps\//);
  expect(onSelect).toMatch(/setGuideKey/);
});

test("completion is not inferred from a timer or a scroll heuristic", () => {
  const logic = code(guideSrc) + code(lessonSrc);
  expect(logic).not.toMatch(/setTimeout\([^)]*complete/i);
  expect(logic).not.toMatch(/IntersectionObserver|scrollHeight|onScroll/);
});

// ---------------------------------------------------------------------------
// The unlock moment, and the shared threshold
// ---------------------------------------------------------------------------

test("finishing the material produces an explicit unlock moment", () => {
  expect(guideSrc).toMatch(/You&apos;re ready to practice/i);
  expect(lessonSrc).toMatch(/showUnlockMoment/);
  expect(lessonSrc).toMatch(/<PracticeUnlockedCard/);
  // ...instead of a disabled row quietly turning into an enabled one
  expect(lessonSrc).toMatch(/!showUnlockMoment/);
});

test("the guided threshold is shared with the server", () => {
  // A lesson that renders flat has no Continue action, so the Practice gate
  // must not bind on it — backend/school_lesson_guide.py uses the same number.
  expect(GUIDE_MIN_CONTENT_STEPS).toBe(1);
  expect(lessonSrc).toMatch(/>= GUIDE_MIN_CONTENT_STEPS/);
});

test("a first-time client is told how the lesson works", () => {
  expect(guideSrc).toMatch(/How this lesson works/i);
  expect(lessonSrc).toMatch(/<LessonHowItWorks/);
});

test("lesson progress is stated in real counts, never a misleading percentage", () => {
  expect(guideSrc).toMatch(/\{doneCount\} of \{instructional\.length\}/);
  expect(guideSrc).toMatch(/complete/i);
  expect(code(guideSrc)).not.toMatch(/Math\.round\([^)]*\/[^)]*\* ?100/);
});

// ---------------------------------------------------------------------------
// Accessibility
// ---------------------------------------------------------------------------

test("a locked row is genuinely disabled, not just dimmed", () => {
  expect(guideSrc).toMatch(/disabled=\{locked\}/);
  expect(guideSrc).toMatch(/aria-disabled=\{locked \|\| undefined\}/);
});

test("the current step is announced to assistive technology", () => {
  expect(guideSrc).toMatch(/aria-current=\{isCurrent \? "step" : undefined\}/);
});

test("state is never carried by colour alone", () => {
  // every state also renders a word and an icon
  expect(guideSrc).toMatch(/>Complete</);
  expect(guideSrc).toMatch(/>Current</);
  expect(guideSrc).toMatch(/>Locked</);
  expect(guideSrc).toMatch(/fa-lock/);
  expect(guideSrc).toMatch(/fa-check/);
});

test("focus stays visible on every interactive control", () => {
  for (const src of [guideSrc]) {
    expect(src).toMatch(/focus-visible:ring/);
  }
  expect(blocksSrc).toMatch(/focus-visible:ring/);
});

test("checklist boxes are properly labelled and a real tap target", () => {
  expect(blocksSrc).toMatch(/<label htmlFor=\{id\}/);
  expect(blocksSrc).toMatch(/<input id=\{id\} type="checkbox"/);
  expect(blocksSrc).toMatch(/w-6 h-6/);
});

test("ticking a prep checkbox does not report lesson progress", () => {
  // The lesson model does not define prep items as completion criteria.
  const checklist = blocksSrc.slice(blocksSrc.indexOf("function ChecklistBlock"),
                                    blocksSrc.indexOf("function TimerBlock"));
  expect(checklist).not.toMatch(/api\.|complete|onComplete|progress/i);
});

// ---------------------------------------------------------------------------
// Typography and hierarchy
// ---------------------------------------------------------------------------

test("the lesson title is the most prominent thing on the page", () => {
  expect(lessonSrc).toMatch(/text-\[24px\] sm:text-\[32px\]/);
});

test("the current step title reads as the heading for what is being read", () => {
  expect(guideSrc).toMatch(/text-\[26px\] sm:text-\[30px\]/);
});

test("step metadata stays metadata-sized", () => {
  expect(guideSrc).toMatch(/text-\[13px\] font-black uppercase tracking-\[0\.16em\]/);
  expect(guideSrc).toMatch(/Step \{section\.n\} of \{all\.length\}/);
});

test("instruction copy is comfortable to read", () => {
  expect(guideSrc).toMatch(/text-\[17px\] sm:text-\[18px\]/);
  expect(guideSrc).toMatch(/leading-\[1\.55\]/);
  expect(blocksSrc).toMatch(/text-\[17px\] sm:text-\[18px\]/);
});

test("a content heading is a heading, not tiny all-caps microcopy", () => {
  // "Before You Begin" is instructional structure; only true metadata such as
  // "STEP 2 OF 8" keeps the small uppercase treatment.
  expect(blocksSrc).toMatch(/<h3 className=\{`text-\[21px\] sm:text-\[23px\] font-black/);
  expect(blocksSrc).not.toMatch(/\{b\.title\} && !hideTitles && <p className=\{`text-\[10px\]/);
});

test("tracker rows are titles with secondary descriptions", () => {
  expect(guideSrc).toMatch(/text-\[21px\] sm:text-\[22px\] font-black/);
  expect(guideSrc).toMatch(/text-\[18px\] sm:text-\[19px\] text-shTextMuted/);
});

test("the primary continuation is impossible to miss", () => {
  expect(guideSrc).toMatch(/min-h-\[56px\]/);
  expect(guideSrc).toMatch(/Continue to \$\{nextLabel\}/);
  expect(guideSrc).toMatch(/Finish lesson material/);
});

// ---------------------------------------------------------------------------
// Nothing here is hard-coded to one program
// ---------------------------------------------------------------------------

test("the progression is not special-cased to any one lesson or program", () => {
  const all = code(guideSrc) + code(lessonSrc);
  expect(all).not.toMatch(/clean sit|teach a clean|blocklab|sit happens foundations/i);
});

test("a lesson with different content still produces a coherent sequence", () => {
  const sparse = buildGuide({ client_overview: "A.", success_criteria: "B." },
                            { hasPractice: true, hasQuiz: false });
  expect(sparse.map(s => s.key)).toEqual(["learn", "know_got_it", "practice", "next_step"]);
  expect(currentStepKey(sparse, { completed: ["learn"] })).toBe("know_got_it");
});

// ---------------------------------------------------------------------------
// Strict instructional sequencing + presentation hardening
// ---------------------------------------------------------------------------

test("future instructional steps are locked until the current one is complete", () => {
  const s = sections();
  const learn = s.find(x => x.key === "learn");
  const train = s.find(x => x.key === "train");
  const cur = currentStepKey(s, { completed: [] });
  expect(cur).toBe("learn");
  expect(stepState(learn, { completed: [], currentKey: cur })).toBe("current");
  expect(stepState(train, { completed: [], currentKey: cur })).toBe("locked");
  expect(lockReason(train, { currentInstructionalLabel: "Learn" })).toMatch(/Complete Learn first/i);
});

test("inline media follows the authored semantic section rather than collapsing into Train", () => {
  const lesson = { content_blocks: [
    { id: "intro", type: "text", title: "What you are teaching", body: "x", order: 0 },
    { id: "steps", type: "steps", title: "Step-by-step lesson", items: ["x"], order: 1 },
    { id: "demo", type: "image", title: "Demo", order: 2 },
    { id: "success", type: "text", title: "What a good repetition looks like", body: "x", order: 3 },
    { id: "finished", type: "image", title: "Finished", order: 4 },
    { id: "mistakes", type: "text", title: "Common mistakes to avoid", body: "x", order: 5 },
    { id: "wrong", type: "image", title: "Wrong", order: 6 },
  ] };
  const grouped = groupBlocks(lesson.content_blocks);
  expect(grouped.train.map(b => b.id)).toEqual(["steps", "demo"]);
  expect(grouped.know_got_it.map(b => b.id)).toEqual(["success", "finished"]);
  expect(grouped.watch_for.map(b => b.id)).toEqual(["mistakes", "wrong"]);
});

test("stale local section selection cannot reveal a locked future section", () => {
  expect(lessonSrc).toMatch(/setGuideKey\(null\);[\s\S]*setData\(null\);[\s\S]*load\(\);/);
  expect(lessonSrc).toMatch(/const requestedState = requestedSection/);
  expect(lessonSrc).toMatch(/stepState\(requestedSection, \{ \.\.\.guideCtx, currentKey \}\)/);
  expect(lessonSrc).toMatch(/guideKey && requestedState !== "locked" \? guideKey : currentKey/);
});

test("an old Practice log cannot visually outrank unfinished guided material", () => {
  const s = sections();
  const practice = s.find(x => x.key === "practice");
  expect(stepState(practice, {
    completed: ["learn"], practiceUnlocked: false, practiced: true,
    quickCheckUnlocked: false, currentKey: "get_ready",
  })).toBe("locked");
});

test("Quick Check remains established non-gating reinforcement", () => {
  expect(blocksSrc).toMatch(/Knowledge checks reinforce the lesson; they do not unlock or block course progression/);
  expect(lessonSrc).not.toMatch(/quick-check\/\$\{blockId\}\/complete/);
});
