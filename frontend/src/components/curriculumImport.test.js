// Online School — importing a full curriculum package (.zip) from Programs.
//
// The package format, its validation and its re-import behaviour are proven
// server-side in backend/test_school_curriculum_import.py — that is where the
// gate lives. These tests protect the client contract: that the ZIP importer
// is ADDITIVE (the CSV and .json template paths still exist), that a failed
// import shows every problem rather than a shrug, and that the summary tells
// an author what actually happened to their media.
import fs from "fs";
import path from "path";

const src = fs.readFileSync(path.join(__dirname, "Programs.jsx"), "utf8");
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ---------------------------------------------------------------------------
// Additive, not a replacement
// ---------------------------------------------------------------------------

test("the ZIP importer sits alongside the existing importers", () => {
  expect(src).toMatch(/data-testid="prog-import-zip"/);       // new: full curriculum
  expect(src).toMatch(/data-testid="prog-import"/);           // existing: .json template
  expect(src).toMatch(/CsvImportButton|parseProgramCsv/);     // existing: modules+goals CSV
});

test("the existing template importer is untouched", () => {
  expect(src).toMatch(/parseProgramTemplate/);
  expect(src).toMatch(/accept="application\/json,\.json"/);
});

test("the ZIP control only accepts a zip", () => {
  expect(src).toMatch(/accept="\.zip,application\/zip"/);
});

// ---------------------------------------------------------------------------
// It posts to the canonical endpoint
// ---------------------------------------------------------------------------

test("import posts the package to the server rather than parsing it here", () => {
  // Placement and validation are the server's job — the browser must not get
  // a vote in where an image lands.
  expect(src).toMatch(/api\.post\("\/admin\/school\/curriculum\/import"/);
  expect(code).not.toMatch(/JSZip|unzip|inflate/i);
});

test("the whole package is sent, media included", () => {
  const fn = src.slice(src.indexOf("const sendCurriculumZip"),
                       src.indexOf("const exportTemplate"));
  expect(fn).toMatch(/readAsDataURL/);
  // the file's own name travels with the bytes, whatever the call is shaped like
  expect(fn).toMatch(/file\.name/);
  expect(fn).toMatch(/const body = \{ data, filename \}/);
});

// ---------------------------------------------------------------------------
// Reporting what happened
// ---------------------------------------------------------------------------

test("a successful import reports structure and media", () => {
  expect(src).toMatch(/data-testid="zip-import-summary"/);
  for (const field of ["modules", "lessons", "blocks", "images", "unplaced_media"]) {
    expect(src).toContain(`zipResult.${field}`);
  }
});

test("placed and unplaced media are both reported", () => {
  expect(src).toMatch(/demonstration image/);
  expect(src).toContain(" needs");
  expect(src).toContain("s need");
  expect(src).toContain("} placement");
  // and unplaced media is explained rather than left as a bare number
  expect(src).toMatch(/Kept in School Resources/);
});

test("an update reads differently from a first import", () => {
  expect(src).toMatch(/zipResult\.program_action === "updated"/);
  expect(src).toContain('"imported"');
});

test("a rejected package lists every problem and says nothing was created", () => {
  expect(src).toMatch(/data-testid="zip-import-errors"/);
  expect(src).toMatch(/Package not imported/);
  expect(src).toMatch(/Nothing was created/);
  expect(src).toMatch(/zipResult\.errors\.map/);
});

test("a validation failure is not flattened into a generic error string", () => {
  const fn = src.slice(src.indexOf("const sendCurriculumZip"),
                       src.indexOf("const exportTemplate"));
  expect(fn).toMatch(/error_code === "invalid_curriculum_package"/);
  expect(fn).toMatch(/setZipResult\(\{ errors: detail\.errors \|\| \[\] \}\)/);
});

test("the catalogue refreshes after a successful import", () => {
  const fn = src.slice(src.indexOf("const sendCurriculumZip"),
                       src.indexOf("const exportTemplate"));
  expect(fn).toMatch(/await load\(\)/);
});

test("a previous result never lingers over a new attempt", () => {
  const fn = src.slice(src.indexOf("const sendCurriculumZip"),
                       src.indexOf("const exportTemplate"));
  expect(fn).toMatch(/setErr\(""\); setZipResult\(null\);/);
});


// ---------------------------------------------------------------------------
// Adopting an archived course that already owns the pathway
//
// A course that ran here before still owns its pathway slug even when
// archived, so re-importing it is refused rather than duplicated. That is a
// question, not a failure, and the client must ask it rather than guess — and
// must say plainly that answering yes brings an archived course back.
// ---------------------------------------------------------------------------

test("the adoption offer is a confirmation, not an error banner", () => {
  expect(src).toMatch(/data-testid="zip-adopt-prompt"/);
  expect(src).toMatch(/Existing archived course found/);
  expect(src).toMatch(/Use this course for the imported curriculum\?/);
  expect(src).toMatch(/data-testid="zip-adopt-name"/);
});

test("the offer says nothing has been imported yet", () => {
  expect(src).toMatch(/Nothing has been imported yet/);
});

test("reactivating an archived course is stated, not silent", () => {
  expect(src).toMatch(/data-testid="zip-adopt-reactivate"/);
  expect(src).toMatch(/This import will reactivate the course\./);
  expect(src).toMatch(/adoptPrompt\.will_reactivate/);
});

test("the admin can confirm or cancel", () => {
  expect(src).toMatch(/data-testid="zip-adopt-confirm"/);
  expect(src).toMatch(/data-testid="zip-adopt-cancel"/);
  expect(src).toMatch(/Use this course/);
  expect(src).toMatch(/const cancelAdoption/);
});

test("confirming re-sends the same package with the admin's answer", () => {
  const fn = src.slice(src.indexOf("const sendCurriculumZip"),
                       src.indexOf("const exportTemplate"));
  expect(fn).toMatch(/adopt_program_id/);
  expect(fn).toMatch(/adoptPrompt\.program_id/);
  // held in a ref so the 15 MB data URL is not re-read or re-rendered
  expect(fn).toMatch(/pendingZipRef\.current/);
});

test("the adoption question is recognised as its own outcome", () => {
  const fn = src.slice(src.indexOf("const sendCurriculumZip"),
                       src.indexOf("const exportTemplate"));
  expect(fn).toMatch(/error_code === "archived_course_adoption_required"/);
  expect(fn).toMatch(/setAdoptPrompt\(detail\)/);
});

test("a stale offer never survives a new upload or another failure", () => {
  const fn = src.slice(src.indexOf("const sendCurriculumZip"),
                       src.indexOf("const exportTemplate"));
  expect(fn).toMatch(/setAdoptPrompt\(null\)/);
});

test("double-confirming is not possible while an import is running", () => {
  const btn = src.slice(src.indexOf("onClick={confirmAdoption}"),
                        src.indexOf('data-testid="zip-adopt-cancel"'));
  expect(btn).toMatch(/disabled=\{importing\}/);
  // and the handler itself refuses a second run rather than trusting the button
  expect(src).toMatch(/if \(!pending \|\| !adoptPrompt \|\| importing\) return;/);
});

test("an adopted course reads as added to the existing course", () => {
  expect(src).toMatch(/program_action === "adopted"/);
});
