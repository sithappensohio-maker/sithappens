// Program Studio responsive structure — source-level guards, matching this
// repo's convention (see onlineSchoolEntryPoints.test.js): the real layout was
// verified in the browser at 1440x900, 1024x768, 390x844 and 320x568 as part
// of the release report; these tests stop the specific CSS mistakes that
// caused the reported defect from coming back.
//
// The defect: the Curriculum Workbench was a three-column flex row whose two
// asides were BOTH `shrink-0` at fixed widths (320px + 410px = 730px reserved
// before the editor got anything). At 1024 that left the lesson editor 257px,
// and because the modal is `overflow-hidden` the excess was clipped rather
// than scrollable — the editor was pushed off the visible area entirely.
import fs from "fs";
import path from "path";

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");

const studioSrc = read("ProgramStudio.jsx");
const treeItemSrc = read("training", "CurriculumTreeItem.jsx");

// ---------------------------------------------------------------------------
// The row itself
// ---------------------------------------------------------------------------

test("the workbench row lets its children shrink instead of forcing the modal wider", () => {
  expect(studioSrc).toMatch(/className="relative flex flex-col md:flex-row flex-1 min-h-0 min-w-0"/);
});

test("the lesson editor keeps flex-1 min-w-0 so it consumes the remaining width", () => {
  expect(studioSrc).toMatch(/<main className=\{`\$\{mobileStage === "edit" \? "block" : "hidden"\} md:block flex-1 min-w-0 overflow-y-auto`\}/);
});

// ---------------------------------------------------------------------------
// The two asides — the actual cause
// ---------------------------------------------------------------------------

test("the Course Outline has a bounded, responsive width rather than one fixed 320px", () => {
  expect(studioSrc).toMatch(/md:w-\[248px\] lg:w-\[280px\] xl:w-\[320px\]/);
  expect(studioSrc).toMatch(/shrink-0 min-w-0 border-b md:border-b-0 md:border-r/);
});

test("the Publish Center is NOT a permanent fixed-width desktop column", () => {
  // The exact class combination that reserved 410px at every desktop size.
  expect(studioSrc).not.toMatch(/md:block md:w-\[410px\] shrink-0/);
  // It is a drawer below 2xl…
  expect(studioSrc).toMatch(/md:absolute md:inset-y-0 md:right-0 md:z-20 md:w-\[380px\]/);
  // …and only becomes a real third column where there is room for one.
  expect(studioSrc).toMatch(/2xl:!block 2xl:!static 2xl:!w-\[380px\]/);
});

test("the Publish Center stays reachable below 2xl via an explicit toggle", () => {
  expect(studioSrc).toMatch(/data-testid="studio-toggle-publish"/);
  expect(studioSrc).toMatch(/const \[publishOpen, setPublishOpen\] = useState\(false\)/);
  // hidden at 2xl, where the panel is always on screen anyway
  expect(studioSrc).toMatch(/2xl:hidden min-h-\[38px\]/);
});

test("no desktop aside reserves more width than the editor gets", () => {
  // Guard against a future edit reintroducing a wide always-on column.
  const wideFixed = studioSrc.match(/md:w-\[(\d+)px\][^"`]*shrink-0/g) || [];
  for (const decl of wideFixed) {
    const px = parseInt(decl.match(/md:w-\[(\d+)px\]/)[1], 10);
    expect(px).toBeLessThanOrEqual(320);
  }
});

// ---------------------------------------------------------------------------
// Outline readability
// ---------------------------------------------------------------------------

test("outline names get a width floor so they cannot collapse to zero", () => {
  // With a wrapping (non-nowrap) name, `min-w-0` alone let the flex item
  // collapse to 0 width and stack one letter per line next to the always-
  // present action buttons. The floor is relaxed on the narrowest phones so
  // the row still fits 320px.
  expect(treeItemSrc).toMatch(/flex-1 basis-0 min-w-\[3\.5rem\] sm:min-w-\[6\.5rem\]/);
});

test("outline names show two lines and expose the full name as a tooltip", () => {
  expect(treeItemSrc).toMatch(/line-clamp-2 break-words/);
  expect(treeItemSrc).toMatch(/<span title=\{name\}/);
  expect(treeItemSrc).toMatch(/title=\{metaText\}/);
});

test("outline row actions cannot steal the name's width", () => {
  expect(treeItemSrc).toMatch(/flex items-center gap-0\.5 shrink-0 opacity-70/);
});

// ---------------------------------------------------------------------------
// Narrow viewports
// ---------------------------------------------------------------------------

test("the mobile stage switcher fits a 320px viewport", () => {
  // 360px forced the fourth stage (Validate) off-screen behind a horizontal
  // scroll on the narrowest supported phone.
  expect(studioSrc).toMatch(/grid grid-cols-4 min-w-\[288px\]/);
  expect(studioSrc).not.toMatch(/grid-cols-4 min-w-\[360px\]/);
});
