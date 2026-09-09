// The lesson's demonstration images and videos follow the client into the
// Practice Coach automatically — same blocks, same renderer as the lesson page.
import fs from "fs";
import path from "path";
import { demoBlocksFromLesson } from "./LessonDemoMedia";

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");

test("only the lesson's active demo media, in lesson order, from either payload shape", () => {
  const blocks = [
    { id: "t", type: "text", order: 0 },
    { id: "v", type: "video", order: 5, resource_id: "r1" },
    { id: "i", type: "image", order: 2, url: "/api/media/1" },
    { id: "gone", type: "image", order: 3, url: "/x", active: false },
    { id: "empty", type: "image", order: 4 },
  ];
  expect(demoBlocksFromLesson({ lesson: { content_blocks: blocks } }).map((b) => b.id)).toEqual(["i", "v"]);
  expect(demoBlocksFromLesson({ content_blocks: blocks }).map((b) => b.id)).toEqual(["i", "v"]);
  expect(demoBlocksFromLesson(null)).toEqual([]);
  expect(demoBlocksFromLesson({ lesson: {} })).toEqual([]);
});

test("the Coach loads the lesson the practice belongs to and shows the media on both screens", () => {
  const panel = read("PracticePanel.jsx");
  const overview = read("CoachPracticeOverview.jsx");
  const guided = read("GuidedPracticeFlow.jsx");
  const media = read("LessonDemoMedia.jsx");
  const schoolApp = read("..", "..", "screens", "SchoolApp.jsx");
  // the enrollment id reaches the panel from School, and the panel loads the lesson
  expect(schoolApp).toMatch(/schoolLesson=\{schoolLessonFor\(practice\.homework, practice\.lessonId\)\} enrollmentId=\{selectedId\}/);
  expect(panel).toMatch(/const demoBlocks = useLessonDemoBlocks\(enrollmentId, schoolLesson\?\.id \|\| null\);/);
  expect(media).toMatch(/api\.get\(`\/portal\/school\/\$\{enrollmentId\}\/lessons\/\$\{lessonId\}`\)/);
  // same client renderer as the lesson page (media resolution included)
  expect(media).toMatch(/import LessonContentBlocks, \{ orderBlocksForStudent, isDemoMediaBlock \} from "\.\.\/school\/student\/LessonContentBlocks"/);
  // overview: full card right under the hero; rep screen: compact row under the cue
  expect(overview).toMatch(/<LessonDemoMedia blocks=\{demoBlocks\} enrollmentId=\{enrollmentId\} variant="full"/);
  expect(guided).toMatch(/<LessonDemoMedia blocks=\{demoBlocks\} enrollmentId=\{enrollmentId\} variant="compact"/);
  // ...and on the rep screen it comes AFTER the scoring buttons, so the cue and
  // both buttons still fit a 320×568 screen without scrolling.
  const buttons = guided.indexOf('data-testid={testid ? `${testid}-miss` : undefined}');
  const demo = guided.indexOf('variant="compact"');
  expect(buttons).toBeGreaterThan(-1);
  expect(demo).toBeGreaterThan(buttons);
  // nothing renders when the lesson has no media
  expect(media).toMatch(/if \(!blocks\.length\) return null;/);
});
