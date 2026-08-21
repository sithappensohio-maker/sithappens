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
  const fn = src.slice(src.indexOf("const importCurriculumZip"),
                       src.indexOf("const exportTemplate"));
  expect(fn).toMatch(/readAsDataURL/);
  expect(fn).toMatch(/filename: file\.name/);
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
  expect(src).toMatch(/zipResult\.program_action === "updated" \? "updated" : "imported"/);
});

test("a rejected package lists every problem and says nothing was created", () => {
  expect(src).toMatch(/data-testid="zip-import-errors"/);
  expect(src).toMatch(/Package not imported/);
  expect(src).toMatch(/Nothing was created/);
  expect(src).toMatch(/zipResult\.errors\.map/);
});

test("a validation failure is not flattened into a generic error string", () => {
  const fn = src.slice(src.indexOf("const importCurriculumZip"),
                       src.indexOf("const exportTemplate"));
  expect(fn).toMatch(/error_code === "invalid_curriculum_package"/);
  expect(fn).toMatch(/setZipResult\(\{ errors: detail\.errors \|\| \[\] \}\)/);
});

test("the catalogue refreshes after a successful import", () => {
  const fn = src.slice(src.indexOf("const importCurriculumZip"),
                       src.indexOf("const exportTemplate"));
  expect(fn).toMatch(/await load\(\)/);
});

test("a previous result never lingers over a new attempt", () => {
  const fn = src.slice(src.indexOf("const importCurriculumZip"),
                       src.indexOf("const exportTemplate"));
  expect(fn).toMatch(/setErr\(""\); setZipResult\(null\);/);
});
