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
  // The shared-data modernization replaced the local load() with the
  // useProgramsData() hook's refresh; a successful import still re-fetches
  // the catalogue.
  const fn = src.slice(src.indexOf("const sendCurriculumZip"),
                       src.indexOf("const exportTemplate"));
  expect(fn).toMatch(/refreshPrograms\(\)/);
  expect(src).toMatch(/const \{ data: programs, refresh: refreshPrograms \} = useProgramsData\(\)/);
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
// QUESTION, not a failure - and the first cut got this wrong: the server's
// sentence fell through to the generic red error banner, which named a
// problem and offered no way out of it. It has to be a confirmation the admin
// can actually act on.
// ---------------------------------------------------------------------------

const modal = () => src.slice(src.indexOf('data-testid="zip-adopt-modal"'),
                              src.indexOf("{zipResult &&"));
const importBlock = () => src.slice(src.indexOf("const sendCurriculumZip"),
                                    src.indexOf("const exportTemplate"));

test("the conflict is a modal, not a dead-end banner", () => {
  const m = modal();
  expect(m).toBeTruthy();
  expect(src).toMatch(/data-testid="zip-adopt-modal"/);
  // a real overlay, not a line of text among the page content
  expect(src).toMatch(/fixed inset-0[^"]*z-50"\s*\n?\s*data-testid="zip-adopt-modal"/);
  expect(m).toMatch(/role="dialog"/);
  expect(m).toMatch(/aria-modal="true"/);
});

test("the modal says what was found and asks the question", () => {
  const m = modal();
  expect(m).toMatch(/Existing Archived Course Found/);
  expect(m).toMatch(/data-testid="zip-adopt-name"/);
  expect(m).toMatch(/adoptPrompt\.program_name/);
  expect(m).toMatch(/This imported curriculum matches an archived course already in Sit Happens\./);
  expect(m).toMatch(/Use this existing course and reactivate it\?/);
});

test("the modal explains every consequence before the admin agrees", () => {
  const m = modal();
  expect(m).toMatch(/data-testid="zip-adopt-effects"/);
  expect(m).toMatch(/existing program ID will be preserved/i);
  expect(m).toMatch(/enrollments, progress and history will be preserved/i);
  expect(m).toMatch(/will be merged into it/i);
  // and the counts come from the server rather than being guessed here
  expect(m).toMatch(/adoptPrompt\.lessons/);
  expect(m).toMatch(/adoptPrompt\.images/);
  expect(m).toMatch(/adoptPrompt\.practice_recipes/);
});

test("reactivating an archived course is stated, not silent", () => {
  const m = modal();
  expect(m).toMatch(/data-testid="zip-adopt-reactivate"/);
  expect(m).toMatch(/reactivated, because the package declares it active/i);
  expect(m).toMatch(/adoptPrompt\.will_reactivate/);
});

test("the modal offers cancel and use existing course", () => {
  const m = modal();
  expect(m).toMatch(/data-testid="zip-adopt-cancel"/);
  expect(m).toMatch(/data-testid="zip-adopt-confirm"/);
  expect(m).toMatch(/>\s*Cancel\s*</);
  expect(m).toMatch(/Use existing course/);
  expect(m).toMatch(/Nothing has been imported yet/);
});

test("the adoption question never becomes the generic error banner", () => {
  // The reported bug: the server's message was shown as an unactionable red
  // banner because this branch did not exist.
  const fn = importBlock();
  const branch = fn.slice(fn.indexOf('error_code === "archived_course_adoption_required"'),
                          fn.indexOf("} else {"));
  expect(branch).toMatch(/setAdoptPrompt\(detail\)/);
  expect(branch).not.toMatch(/setErr\(/);
});

test("confirming re-sends the held package with the admin's answer", () => {
  const fn = importBlock();
  expect(fn).toMatch(/adopt_program_id/);
  expect(fn).toMatch(/adoptPrompt\.program_id/);
  // the package is kept in memory so the admin never re-picks the file
  expect(fn).toMatch(/pendingZipRef\.current = \{ data, filename \}/);
  expect(fn).toMatch(/const pending = pendingZipRef\.current/);
});

test("the answer names one program - there is no blanket force flag", () => {
  const fn = importBlock();
  expect(fn).not.toMatch(/force\s*[:=]\s*true/);
  expect(fn).not.toMatch(/\boverwrite\b/i);
  // the only thing sent is the id the server itself offered
  expect(fn).toMatch(/body\.adopt_program_id = adoptProgramId/);
});

test("cancelling clears the question and drops the package", () => {
  const fn = importBlock();
  const cancel = fn.slice(fn.indexOf("const cancelAdoption"));
  expect(cancel).toMatch(/setAdoptPrompt\(null\)/);
  expect(cancel).toMatch(/pendingZipRef\.current = null/);
  // cancelling posts nothing
  expect(cancel.slice(0, cancel.indexOf("};"))).not.toMatch(/api\.post/);
});

test("a stale question never survives a new upload or another failure", () => {
  expect(importBlock()).toMatch(/setAdoptPrompt\(null\)/);
});

test("double-confirming is not possible while an import is running", () => {
  const m = modal();
  expect((m.match(/disabled=\{importing\}/g) || []).length).toBe(2);
  // and the handler refuses a second run rather than trusting the button
  expect(src).toMatch(/if \(!pending \|\| !adoptPrompt \|\| importing\) return;/);
});

test("an adopted course reads as added to the existing course", () => {
  expect(src).toMatch(/program_action === "adopted"/);
});


// ---------------------------------------------------------------------------
// Structured errors have to survive the response interceptor
//
// This is what actually broke the flow in production. api.js flattens any
// object `detail` to a plain string so legacy JSX renderers cannot crash on
// it - which also destroyed `error_code`, so BOTH the validation-error list
// and the archived-course confirmation fell through to the generic red
// banner. The banner named a problem and offered no way out of it.
// ---------------------------------------------------------------------------

const apiSrc = fs.readFileSync(path.join(__dirname, "..", "lib", "api.js"), "utf8");

test("the interceptor keeps the machine-readable error body", () => {
  expect(apiSrc).toMatch(/err\.response\.data\.detail_object = d;/);
  // and it still flattens `detail` itself, so nothing existing changes
  expect(apiSrc).toMatch(/err\.response\.data\.detail = d\.msg \|\| JSON\.stringify\(d\);/);
});

test("the importer branches on the structured body, not the flattened string", () => {
  const fn = importBlock();
  expect(fn).toMatch(/detail_object/);
  // the flattened string stays as the fallback for anything unstructured
  expect(fn).toMatch(/e\.response\?\.data\?\.detail_object \|\| e\.response\?\.data\?\.detail/);
});

test("a rejected package can still reach its own error list", () => {
  // Same root cause: without the structured body this branch was unreachable
  // and a bad package showed a JSON blob in the red banner instead.
  const fn = importBlock();
  const branch = fn.slice(fn.indexOf('error_code === "invalid_curriculum_package"'),
                          fn.indexOf('error_code === "archived_course_adoption_required"'));
  expect(branch).toMatch(/setZipResult\(\{ errors: detail\.errors \|\| \[\] \}\)/);
});
