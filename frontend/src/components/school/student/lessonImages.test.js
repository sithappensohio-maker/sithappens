// Online School — inline demonstration images in the guided lesson.
//
// Images carry real instructional weight in dog training, so they render as
// content between the paragraphs that discuss them — not as a gallery, a hero
// or an attachment list. `image` was already a first-class block type; what
// this pass added is a client-visible caption, a separate accessible
// description, and rendering that behaves on a phone.
//
// Ordering and persistence are proven server-side in
// backend/test_school_lesson_images.py. These tests protect the rendering
// contract and that images did not quietly change the progression rules.
//
// Rendered behaviour was verified in the browser at 1440x900, 390x844 and
// 320x568 with landscape, portrait and square images.
import fs from "fs";
import path from "path";
import { buildGuide, instructionalKeys, currentStepKey, stepState } from "./lesson/LessonGuide";

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const blocksSrc = read("LessonContentBlocks.jsx");
const studioSrc = read("..", "..", "ProgramStudio.jsx");

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

test("an image renders as a figure, not a bare tag", () => {
  expect(blocksSrc).toMatch(/<figure/);
  expect(blocksSrc).toMatch(/<figcaption/);
});

test("the caption is tied to its image rather than floating as loose text", () => {
  const fn = blocksSrc.slice(blocksSrc.indexOf("function InlineImage"),
                             blocksSrc.indexOf("function SplitLines"));
  expect(fn).toMatch(/<figcaption[\s\S]*\{caption\}/);
});

test("alt text comes from the authored description", () => {
  expect(blocksSrc).toMatch(/alt=\{alt \|\| ""\}/);
  expect(blocksSrc).toMatch(/alt=\{b\.config\?\.alt\}/);
});

test("a missing description marks the image decorative instead of guessing", () => {
  // Repeating the caption or inventing a description is worse than none.
  const fn = blocksSrc.slice(blocksSrc.indexOf("function InlineImage"),
                             blocksSrc.indexOf("function SplitLines"));
  expect(fn).toMatch(/alt=\{alt \|\| ""\}/);
  expect(code(fn)).not.toMatch(/alt=\{[^}]*caption/);
});

test("the caption is never used as the accessible description", () => {
  expect(code(blocksSrc)).not.toMatch(/alt=\{b\.config\?\.caption\}/);
});

test("an image scales instead of overflowing or stretching", () => {
  const fn = blocksSrc.slice(blocksSrc.indexOf("function InlineImage"),
                             blocksSrc.indexOf("function SplitLines"));
  expect(fn).toMatch(/w-full/);
  expect(fn).toMatch(/max-w-full/);
  expect(fn).toMatch(/h-auto/);          // aspect ratio preserved
  expect(fn).toMatch(/object-contain/);  // never distorted
});

test("a portrait image cannot swallow the page", () => {
  const fn = blocksSrc.slice(blocksSrc.indexOf("function InlineImage"),
                             blocksSrc.indexOf("function SplitLines"));
  expect(fn).toMatch(/max-h-\[60vh\] sm:max-h-\[520px\]/);
});

test("both image sources render through the same component", () => {
  // A direct URL and a School resource must look identical to the client.
  expect(blocksSrc).toMatch(/b\.type === "image" && b\.url && <InlineImage/);
  expect(blocksSrc).toMatch(/if \(type === "image"\) return <InlineImage/);
});

test("existing video rendering is untouched", () => {
  expect(blocksSrc).toMatch(/b\.type === "video" && b\.url && <div className="aspect-video/);
  expect(blocksSrc).toMatch(/if \(type === "video"\)/);
});

// ---------------------------------------------------------------------------
// Ordering — authored position is authoritative
// ---------------------------------------------------------------------------

test("blocks render in authored order, images included", () => {
  // The renderer maps the array it is given; nothing re-sorts by type, and
  // nothing collects media at the end.
  expect(blocksSrc).toMatch(/blocks\b[\s\S]{0,200}\.map\(/);
  const logic = code(blocksSrc);
  expect(logic).not.toMatch(/filter\([^)]*type === "image"\)[\s\S]{0,60}map/);
  expect(logic).not.toMatch(/sort\(\([^)]*\) => [^)]*type/);
});

test("an image between two paragraphs stays between them", () => {
  const lesson = { content_blocks: [
    { type: "text", title: "Lure position", body: "a", order: 0 },
    { type: "image", url: "u", order: 1, config: { caption: "Like this." } },
    { type: "text", title: "Moving up and back", body: "b", order: 2 },
  ] };
  const learn = buildGuide(lesson, { hasPractice: true }).find(s => s.key === "learn");
  expect(learn.blocks.map(b => b.type)).toEqual(["text", "image", "text"]);
});

test("images follow their surrounding text into the right step", () => {
  const lesson = { content_blocks: [
    { type: "steps", title: "Train", items: ["Lure"], order: 0 },
    { type: "text", title: "Common mistakes to avoid", body: "x", order: 1 },
    { type: "image", url: "u", order: 2 },
  ] };
  const keys = buildGuide(lesson, {}).map(s => s.key);
  expect(keys).toContain("train");
  expect(keys).toContain("watch_for");
});

// ---------------------------------------------------------------------------
// Images must not change the progression
// ---------------------------------------------------------------------------

test("an image-rich section is still ordinary instructional content", () => {
  const lesson = { content_blocks: [
    { type: "text", title: "Lure position", body: "a", order: 0 },
    { type: "image", url: "u1", order: 1 },
    { type: "image", url: "u2", order: 2 },
  ] };
  const s = buildGuide(lesson, { hasPractice: true });
  expect(instructionalKeys(s)).toContain("learn");
  expect(currentStepKey(s, { completed: [] })).toBe("learn");
});

test("an image never becomes a step of its own", () => {
  const lesson = { content_blocks: [{ type: "image", url: "u", order: 0 }] };
  const keys = buildGuide(lesson, { hasPractice: true }).map(s => s.key);
  expect(keys).not.toContain("image");
});

test("Practice still gates behind an image-heavy lesson", () => {
  const lesson = { content_blocks: [
    { type: "text", title: "Lure position", body: "a", order: 0 },
    { type: "image", url: "u", order: 1 },
  ] };
  const s = buildGuide(lesson, { hasPractice: true });
  const practice = s.find(x => x.key === "practice");
  expect(stepState(practice, { completed: [], practiceUnlocked: false })).toBe("locked");
  expect(stepState(practice, {
    completed: instructionalKeys(s), practiceUnlocked: true,
  })).not.toBe("locked");
});

test("viewing an image does not complete anything", () => {
  // No click handler, no completion side effect on the image itself.
  const fn = blocksSrc.slice(blocksSrc.indexOf("function InlineImage"),
                             blocksSrc.indexOf("function SplitLines"));
  expect(code(fn)).not.toMatch(/onClick|complete|api\./i);
});

// ---------------------------------------------------------------------------
// Program Studio authoring
// ---------------------------------------------------------------------------

test("an author can upload an image from the block being edited", () => {
  expect(studioSrc).toMatch(/function BlockImageUpload/);
  expect(studioSrc).toMatch(/\/admin\/school\/resources\/upload/);
});

test("upload reuses the School Resources pipeline rather than a new store", () => {
  const fn = studioSrc.slice(studioSrc.indexOf("function BlockImageUpload"),
                             studioSrc.indexOf("function LessonBlocksEditor"));
  expect(fn).toMatch(/api\.post\("\/admin\/school\/resources\/upload"/);
  expect(fn).toMatch(/api\.post\("\/admin\/school\/resources"/);
  // the block ends up with an ordinary resource_id, like a library pick
  expect(studioSrc).toMatch(/onUploaded=\{\(rid\)=>\{update\(idx,\{resource_id:rid,url:""\}\)/);
  // ...and the picker reloads so the new image is immediately selectable
  expect(studioSrc).toMatch(/loadResources\(\);\}\}/);
});

test("only the image types the media pipeline already accepts are offered", () => {
  const fn = studioSrc.slice(studioSrc.indexOf("function BlockImageUpload"),
                             studioSrc.indexOf("function LessonBlocksEditor"));
  expect(fn).toMatch(/accept="image\/jpeg,image\/png,image\/webp,image\/heic"/);
  expect(fn).not.toMatch(/svg/i);
});

test("caption and alt text are separate authoring fields", () => {
  expect(studioSrc).toMatch(/Caption \(shown to the client, optional\)/);
  expect(studioSrc).toMatch(/Alt text \(describes the image for screen readers\)/);
  expect(studioSrc).toMatch(/config:\{\.\.\.\(b\.config\|\|\{\}\),caption:e\.target\.value\}/);
  expect(studioSrc).toMatch(/config:\{\.\.\.\(b\.config\|\|\{\}\),alt:e\.target\.value\}/);
});

test("an imported image is an ordinary editable block", () => {
  // Same editor row as any other block: reorder, hide, delete, retype.
  expect(studioSrc).toMatch(/onClick=\{\(\)=>move\(idx,-1\)\}/);
  expect(studioSrc).toMatch(/onClick=\{\(\)=>move\(idx,1\)\}/);
  expect(studioSrc).toMatch(/onClick=\{\(\)=>remove\(idx\)\}/);
  // and there is no separate "imported image" concept anywhere
  expect(code(studioSrc)).not.toMatch(/importedImage|imported_media|isImported/);
});

test("the upload control has an accessible name", () => {
  const fn = studioSrc.slice(studioSrc.indexOf("function BlockImageUpload"),
                             studioSrc.indexOf("function LessonBlocksEditor"));
  expect(fn).toMatch(/htmlFor=\{inputId\}/);
  expect(fn).toMatch(/id=\{inputId\}/);
  expect(fn).toMatch(/Upload image|Replace image/);
});

test("an upload failure is reported rather than swallowed", () => {
  expect(studioSrc).toMatch(/onError=\{setUploadErr\}/);
  expect(studioSrc).toMatch(/\{uploadErr && <p/);
});

// ---------------------------------------------------------------------------
// Delivery weight and format reality
// ---------------------------------------------------------------------------

test("a lesson image is compressed before upload, like every other image in the app", () => {
  // The School Resource ceiling is 50 MB and a phone photo is 3-5 MB, so
  // without this a lesson could hand students tens of megabytes of pictures.
  expect(studioSrc).toMatch(/import \{ compressImage \} from "\.\.\/lib\/imageCompress"/);
  const fn = studioSrc.slice(studioSrc.indexOf("function BlockImageUpload"),
                             studioSrc.indexOf("function LessonBlocksEditor"));
  expect(fn).toMatch(/await compressImage\(file\)/);
  // ...and the raw FileReader path it replaced is gone
  expect(fn).not.toMatch(/readAsDataURL/);
});

test("the compressor keeps demonstration detail rather than shrinking to a thumbnail", () => {
  const compress = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "lib", "imageCompress.js"), "utf8");
  expect(compress).toMatch(/DEFAULT_MAX_WIDTH = 1600/);
  expect(compress).toMatch(/DEFAULT_QUALITY = 0\.82/);
});

test("an HEIC that the browser cannot decode is refused, not silently accepted", () => {
  // Chrome reports image/heic unsupported, so it would render broken for most
  // students. On Safari compressImage has already transcoded it to JPEG.
  const fn = studioSrc.slice(studioSrc.indexOf("function BlockImageUpload"),
                             studioSrc.indexOf("function LessonBlocksEditor"));
  expect(fn).toContain("data:image");
  expect(fn).toContain("hei[cf]");
  expect(fn).toMatch(/HEIC images don't display in most browsers/);
});

test("HEIC is only restricted for inline lesson images, not for School Resources at large", () => {
  // The resource pipeline's own allow-list is untouched.
  const suite = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "..", "..", "backend", "school_suite.py"), "utf8");
  expect(suite).toMatch(/"image\/heic"/);
});
