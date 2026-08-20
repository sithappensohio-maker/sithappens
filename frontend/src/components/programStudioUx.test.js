// Program Studio UX polish — outline scale, lesson paging, save state,
// readiness totals.
//
// The navigation/search/readiness logic lives in pure helpers, so it is tested
// BEHAVIOURALLY here (real inputs, real outputs) rather than by pinning
// source. The React wiring that connects those helpers to the UI is pinned the
// way this repo does elsewhere, and the rendered result was verified in the
// browser at all four viewports on a 24-module / 120-lesson program.
import fs from "fs";
import path from "path";
import {
  computeProgramReadiness, computeCheckpointCompleteness, lessonHasCheckpoint,
  flattenLessons, lessonNeighbours, filterCurriculum, firstIncomplete,
} from "../lib/programStudioPolish";

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");
const studioSrc = read("ProgramStudio.jsx");
const treeSrc = read("training", "CurriculumTree.jsx");

// A complete lesson by the EXISTING computeLessonCompleteness dimensions.
const readyLesson = (key, name, extra = {}) => ({
  _key: key, name,
  client_overview: "o", trainer_instructions: "t", success_criteria: "s",
  advancement_criteria: "a", skill_ids: ["g1"], ...extra,
});
const unreadyLesson = (key, name, extra = {}) => ({ _key: key, name, skill_ids: [], ...extra });
const readySkill = (key, name) => ({ _key: key, name, client_facing_explanation: "e", pass_criteria: "p" });
const unreadySkill = (key, name) => ({ _key: key, name });

const PROGRAM = [
  { _key: "m1", name: "Foundation", lessons: [readyLesson("l1", "Day 1 — Name recognition"), unreadyLesson("l2", "Day 2 — Loose leash")], goals: [readySkill("g1", "Sit"), unreadySkill("g2", "Down")] },
  { _key: "m2", name: "Public Access", lessons: [readyLesson("l3", "Day 3 — Cafe visit")], goals: [unreadySkill("g3", "Place")] },
  { _key: "m3", name: "Task Work", lessons: [], goals: [] },
];

// ---------------------------------------------------------------------------
// Previous / Next lesson
// ---------------------------------------------------------------------------

test("lessons flatten in real curriculum order, modules then lessons", () => {
  expect(flattenLessons(PROGRAM).map(x => x.lessonKey)).toEqual(["l1", "l2", "l3"]);
});

test("Next crosses a module boundary", () => {
  const n = lessonNeighbours(PROGRAM, { moduleKey: "m1", lessonKey: "l2" });
  expect(n.next).toMatchObject({ lessonKey: "l3", moduleKey: "m2" });
  expect(n.index).toBe(1);
  expect(n.total).toBe(3);
});

test("Previous crosses a module boundary backwards", () => {
  const n = lessonNeighbours(PROGRAM, { moduleKey: "m2", lessonKey: "l3" });
  expect(n.prev).toMatchObject({ lessonKey: "l2", moduleKey: "m1" });
});

test("the first lesson has no Previous and the last has no Next", () => {
  expect(lessonNeighbours(PROGRAM, { lessonKey: "l1" }).prev).toBeNull();
  expect(lessonNeighbours(PROGRAM, { lessonKey: "l3" }).next).toBeNull();
});

test("paging never wraps around the ends", () => {
  const first = lessonNeighbours(PROGRAM, { lessonKey: "l1" });
  const last = lessonNeighbours(PROGRAM, { lessonKey: "l3" });
  expect(first.prev).toBeNull();
  expect(last.next).toBeNull();
});

test("a module selection (no lesson) reports no position rather than guessing one", () => {
  expect(lessonNeighbours(PROGRAM, { moduleKey: "m1" }).index).toBe(-1);
});

// ---------------------------------------------------------------------------
// Curriculum search
// ---------------------------------------------------------------------------

test("search matches lesson names and keeps only the matching children", () => {
  const r = filterCurriculum(PROGRAM, "name recognition");
  expect(r.filtered).toBe(true);
  expect(r.modules).toHaveLength(1);
  expect(r.modules[0].lessons.map(l => l._key)).toEqual(["l1"]);
});

test("search matches skill names", () => {
  const r = filterCurriculum(PROGRAM, "place");
  expect(r.modules).toHaveLength(1);
  expect(r.modules[0].goals.map(g => g._key)).toEqual(["g3"]);
});

test("a module-name match keeps all of that module's children", () => {
  const r = filterCurriculum(PROGRAM, "foundation");
  expect(r.modules).toHaveLength(1);
  expect(r.modules[0].lessons).toHaveLength(2);
  expect(r.modules[0].goals).toHaveLength(2);
});

test("search is case-insensitive and reports a match count", () => {
  expect(filterCurriculum(PROGRAM, "DAY 3").matchCount).toBe(1);
});

test("clearing the search restores the untouched outline", () => {
  const r = filterCurriculum(PROGRAM, "");
  expect(r.filtered).toBe(false);
  expect(r.modules).toBe(PROGRAM);
});

test("search never mutates the draft", () => {
  const snapshot = JSON.stringify(PROGRAM);
  filterCurriculum(PROGRAM, "day");
  filterCurriculum(PROGRAM, "nothing matches this");
  expect(JSON.stringify(PROGRAM)).toBe(snapshot);
});

test("a search with no matches yields an empty outline, not everything", () => {
  const r = filterCurriculum(PROGRAM, "zzzz-no-such-thing");
  expect(r.filtered).toBe(true);
  expect(r.modules).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Readiness totals — reusing the EXISTING completeness dimensions
// ---------------------------------------------------------------------------

test("readiness counts ready vs total for lessons and skills", () => {
  const r = computeProgramReadiness(PROGRAM);
  expect(r.modules.total).toBe(3);
  expect(r.lessons).toEqual({ ready: 2, total: 3 });
  expect(r.skills).toEqual({ ready: 1, total: 3 });
});

test("only lessons that actually HAVE a checkpoint are counted", () => {
  const withCp = [{
    _key: "m", name: "M", goals: [],
    lessons: [
      readyLesson("a", "A"),  // no checkpoint at all — not counted
      readyLesson("b", "B", { checkpoint: { enabled: true, submission_instructions: "film", handler_criteria: [{ id: "h" }], dog_criteria: [{ id: "d" }] } }),
      readyLesson("c", "C", { checkpoint: { enabled: true } }), // enabled but ungradeable
    ],
  }];
  expect(computeProgramReadiness(withCp).checkpoints).toEqual({ ready: 1, total: 2 });
});

test("a checkpoint with no criteria is not counted as ready", () => {
  const states = computeCheckpointCompleteness({ checkpoint: { enabled: true } }).map(i => i.state);
  expect(states).toEqual(["needs_attention", "needs_attention", "needs_attention"]);
  expect(lessonHasCheckpoint({ checkpoint: { enabled: false } })).toBe(false);
});

test("clicking an incomplete metric resolves to the first item needing attention", () => {
  expect(firstIncomplete(PROGRAM, "lessons")).toEqual({ moduleKey: "m1", lessonKey: "l2" });
  expect(firstIncomplete(PROGRAM, "skills")).toEqual({ moduleKey: "m1", skillKey: "g2" });
});

test("a fully ready program offers nothing to jump to", () => {
  const ready = [{ _key: "m", name: "M", lessons: [readyLesson("l", "L")], goals: [readySkill("g", "G")] }];
  expect(firstIncomplete(ready, "lessons")).toBeNull();
  expect(firstIncomplete(ready, "skills")).toBeNull();
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

test("module collapse/expand is caller-owned and never hides the selected module", () => {
  expect(treeSrc).toMatch(/const isCollapsed = \(m\) => !!collapsedModules\?\.has\?\.\(m\._key\) && selected\?\.moduleKey !== m\._key/);
  expect(treeSrc).toMatch(/collapsedModules, onToggleModule,/);
  expect(treeSrc).toMatch(/\{!collapsed && <div className="px-2 pb-2\.5 pt-1\.5 space-y-2">/);
});

test("Collapse All / Expand All / Jump to Module are wired", () => {
  for (const id of ["studio-collapse-all", "studio-expand-all", "studio-jump-to-module", "studio-outline-search"]) {
    expect(studioSrc).toMatch(new RegExp(`data-testid="${id}"`));
  }
  expect(studioSrc).toMatch(/const collapseAll = \(\) => setCollapsedModules\(new Set\(modules\.map\(m => m\._key\)\)\)/);
  expect(studioSrc).toMatch(/const expandAll = \(\) => setCollapsedModules\(new Set\(\)\)/);
});

test("a filtered outline is always fully expanded", () => {
  // Collapsing a search result would hide the matches the search just found.
  expect(studioSrc).toMatch(/collapsedModules=\{searchView\.filtered \? EMPTY_COLLAPSED : collapsedModules\}/);
});

test("navigating to a lesson reveals its module", () => {
  expect(studioSrc).toMatch(/const goToLesson = \(target\) => \{[\s\S]*?revealModule\(target\.moduleKey\)/);
  expect(studioSrc).toMatch(/const jumpToModule = \(key\) => \{ revealModule\(key\)/);
});

test("save state is real, not decorative — Studio has no autosave", () => {
  // Two explicit buttons persist; the badge must be derived from an actual
  // comparison against what was last saved, never hardcoded.
  expect(studioSrc).toMatch(/const dirty = currentSerialized !== savedBaseline/);
  expect(studioSrc).toMatch(/const saveState = saving \? "saving" : dirty \? "unsaved" : "saved"/);
  expect(studioSrc).toMatch(/data-testid="studio-save-state" data-state=\{saveState\}/);
  expect(studioSrc).toMatch(/markSaved\(\)/);
});

test("closing with unsaved changes asks before discarding", () => {
  expect(studioSrc).toMatch(/if \(dirty && !\(await confirm\(\{/);
  expect(studioSrc).toMatch(/Discard unsaved changes\?/);
});

test("Import / Export collapses without losing any feature", () => {
  expect(studioSrc).toMatch(/data-testid="studio-import-export-toggle"/);
  expect(studioSrc).toMatch(/const \[importOpen, setImportOpen\] = useState\(false\)/);
  // every original control still lives inside the disclosure
  expect(studioSrc).toMatch(/<CsvImportButton/);
  expect(studioSrc).toMatch(/PROGRAM_CSV_SAMPLE/);
  expect(studioSrc).toMatch(/Copy from another program…/);
});

test("readiness metrics render ready/total and link to the first problem", () => {
  expect(studioSrc).toMatch(/data-testid=\{`studio-readiness-\$\{item\.key\}`\}/);
  expect(studioSrc).toMatch(/onClick=\{\(\) => incomplete && jumpToIncomplete\(item\.key\)\}/);
  expect(studioSrc).toMatch(/\$\{item\.ready\} \/ \$\{item\.total\}/);
  // checkpoints only appear when the program actually has any
  expect(studioSrc).toMatch(/item\.key !== "checkpoints" \|\| item\.total > 0/);
});

test("the lesson pager is reachable and labelled at both ends", () => {
  expect(studioSrc).toMatch(/function LessonPager/);
  expect(studioSrc).toMatch(/data-testid=\{`\$\{testid\}-prev`\}/);
  expect(studioSrc).toMatch(/data-testid=\{`\$\{testid\}-next`\}/);
  expect(studioSrc).toMatch(/disabled=\{!prev\}/);
  expect(studioSrc).toMatch(/disabled=\{!next\}/);
  // compact labels so the controls survive a 320px viewport
  expect(studioSrc).toMatch(/<span className="sm:hidden">Prev<\/span>/);
});
