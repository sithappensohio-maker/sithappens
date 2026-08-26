// Admin "Assign School Program" — the picker must never show an unexplained
// blank body.
//
// The reported defect: the modal rendered a group per known curriculum type
// and `null` for each empty one, with no loading, empty or error state. Any
// condition producing no matching group — an archived/draft curriculum (the
// list endpoint returns ACTIVE programs only), an empty catalogue, or a
// program whose type is outside /programs/meta — showed nothing at all and
// explained nothing.
//
// The assignment behaviour itself (canonical enrollment, no duplicates, no
// invented money, permissions) is proven server-side in
// backend/test_school_assignment_picker.py.
import fs from "fs";
import path from "path";

const src = fs.readFileSync(
  path.join(__dirname, "DogTrainingTab.jsx"), "utf8");
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ---------------------------------------------------------------------------
// The four states the modal must be able to show
// ---------------------------------------------------------------------------

test("the picker can say it is still loading", () => {
  expect(src).toMatch(/data-testid="school-assign-loading"/);
  expect(src).toMatch(/Loading programs…/);
});

test("the picker explains an empty catalogue instead of rendering nothing", () => {
  expect(src).toMatch(/data-testid="school-assign-empty"/);
  expect(src).toMatch(/No assignable programs/);
  // and the explanation is actionable — it names the real reason
  expect(src).toMatch(/School curricula/);
  expect(src).toMatch(/Program Studio/);
});

test("the picker offers a retry when loading failed", () => {
  expect(src).toMatch(/data-testid="school-assign-error"/);
  expect(src).toMatch(/Unable to load programs/);
  expect(src).toMatch(/data-testid="school-assign-retry"/);
  expect(src).toMatch(/onRetry/);
});

test("the four states are mutually exclusive and ordered", () => {
  // loading → error → empty → list, so a failed load can never be mistaken
  // for "there are no programs".
  const body = src.slice(src.indexOf('loadState === "loading"'),
                         src.indexOf('data-testid={`school-assign-pick-'));
  expect(body.indexOf('loadState === "loading"'))
    .toBeLessThan(body.indexOf('loadState === "error"'));
  expect(body.indexOf('loadState === "error"'))
    .toBeLessThan(body.indexOf("!groups.length"));
});

// ---------------------------------------------------------------------------
// Grouping can no longer silently drop a program
// ---------------------------------------------------------------------------

test("a program whose type is unknown still appears", () => {
  // This was the silent-drop path: `programs.filter(p => p.type === t.key)`
  // over known types only, with `null` for every empty group.
  expect(src).toMatch(/const orphans = programs\.filter\(p => !knownKeys\.has\(p\.type\)\)/);
  expect(src).toMatch(/Other programs/);
});

test("the body no longer returns null for an empty group", () => {
  expect(code).not.toMatch(/if \(!items\.length\) return null;/);
  expect(src).toMatch(/\.filter\(g => g\.items\.length > 0\)/);
});

// ---------------------------------------------------------------------------
// The surrounding screen
// ---------------------------------------------------------------------------

test("a failed load no longer sits on a permanent spinner", () => {
  // `meta` stayed null when the load threw, so the whole tab rendered
  // "Loading…" for ever with no way to retry.
  expect(src).toMatch(/data-testid="dog-training-load-error"/);
  expect(src).toMatch(/data-testid="dog-training-retry"/);
  expect(src).toMatch(/loadState === "error"/);
});

test("load state distinguishes loading, ready and error", () => {
  expect(src).toMatch(/useState\("loading"\)/);
  expect(src).toMatch(/setLoadState\("ready"\)/);
  expect(src).toMatch(/setLoadState\("error"\)/);
});

test("the modal is told the load state rather than guessing from an empty array", () => {
  expect(src).toMatch(/loadState=\{loadState\} loadError=\{err\} onRetry=\{load\}/);
});

// ---------------------------------------------------------------------------
// Assignment stays on the canonical path
// ---------------------------------------------------------------------------

test("assigning posts to the one canonical School enrol endpoint", () => {
  expect(src).toMatch(/api\.post\("\/school\/enroll"/);
});

test("the picker invents no payment, sale or invoice", () => {
  const modal = src.slice(src.indexOf("function SchoolProgramAssignModal"),
                          src.indexOf("function LegacyMigrationModal"));
  expect(modal).not.toMatch(/stripe|checkout|payment|invoice|pos_sale|charge/i);
});

test("assignment failures are shown inside the open modal", () => {
  expect(src).toMatch(/data-testid="school-assign-submit-error"/);
  expect(src).toMatch(/assignError=\{assignErr\}/);
  expect(src).toMatch(/setAssignErr\(formatErr\(e\.response\?\.data\?\.detail\)/);
});

test("assignment cannot be double-submitted while the request is running", () => {
  expect(src).toMatch(/if \(assignBusy\) return/);
  expect(src).toMatch(/disabled=\{assignBusy\}/);
  expect(src).toMatch(/Assigning…/);
});


// ---------------------------------------------------------------------------
// A "custom" program is not automatically one dog's private plan
//
// Production had a global catalog course stored with type "custom" and no
// `owner_dog_id`. It was active and GET /programs returned it, but Assign
// Program filtered it out for every dog because the rule keyed on the TYPE
// rather than on ownership. These run the real predicate, not its source
// text, because the previous rule read perfectly and was still wrong.
// ---------------------------------------------------------------------------

const { isAssignableProgram } = require("./DogTrainingTab");

const DOG = "dog-1";
const OTHER = "dog-2";

test("a School-ready ordinary catalog program is offered", () => {
  expect(isAssignableProgram({ type: "private_lessons", school_curriculum_ready: true }, DOG)).toBe(true);
  expect(isAssignableProgram({ type: "board_train", school_curriculum_ready: true }, DOG)).toBe(true);
  expect(isAssignableProgram({ type: "service_dog", school_curriculum_ready: true }, DOG)).toBe(true);
});

test("a retired legacy definition is never assignable", () => {
  expect(isAssignableProgram({ type: "private_lessons", school_curriculum_ready: false }, DOG)).toBe(false);
});

test("a global custom program with no owner_dog_id is offered", () => {
  // the exact production shape
  expect(isAssignableProgram({ type: "custom" }, DOG)).toBe(true);
  expect(isAssignableProgram({ type: "custom", owner_dog_id: null }, DOG)).toBe(true);
  expect(isAssignableProgram({ type: "custom", owner_dog_id: "" }, DOG)).toBe(true);
});

test("a custom program owned by this dog is offered", () => {
  expect(isAssignableProgram({ type: "custom", owner_dog_id: DOG }, DOG)).toBe(true);
});

test("a custom program owned by another dog is hidden", () => {
  expect(isAssignableProgram({ type: "custom", owner_dog_id: OTHER }, DOG)).toBe(false);
});

test("the picker filters with the predicate rather than on type alone", () => {
  expect(src).toMatch(/programs\.filter\(p => isAssignableProgram\(p, dogId\)\)/);
  // the old rule must be gone: it hid every global custom course
  expect(code).not.toMatch(/p\.type !== "custom" \|\| p\.owner_dog_id === dogId/);
});

test("hiding another dog's plan is not left to the client alone", () => {
  // The server owns this too — proven in
  // backend/test_school_assignment_picker.py; asserted here so the two halves
  // are not silently decoupled.
  const backend = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "backend", "server.py"), "utf8");
  expect(backend).toMatch(/belongs to another dog and cannot be assigned here/);
});
