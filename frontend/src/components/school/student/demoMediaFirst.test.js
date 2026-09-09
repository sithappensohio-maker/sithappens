// Demonstration images and videos are the first thing a student sees in a
// lesson part. Display rule only: nothing removed, stored order untouched.
import fs from "fs";
import path from "path";
import { orderBlocksForStudent, isDemoMediaBlock } from "./LessonContentBlocks";

const blocks = [
  { id: "intro", type: "text", order: 0, body: "Why this matters" },
  { id: "steps", type: "steps", order: 1, items: ["Say the name", "Mark", "Reward"] },
  { id: "photo", type: "image", order: 2, url: "/api/media/1", config: { caption: "Lure height" } },
  { id: "tip", type: "trainer_tip", order: 3, body: "Keep sessions short" },
  { id: "clip", type: "video", order: 4, resource_id: "res-9" },
  { id: "old", type: "image", order: 5, url: "/api/media/2", active: false },
  { id: "quiz", type: "quiz", order: 6 },
  { id: "empty", type: "image", order: 7 }, // no url and no resource: not a demo
];

test("images and videos move to the top; everything else keeps its authored order; nothing is dropped", () => {
  const ids = orderBlocksForStudent(blocks).map((b) => b.id);
  expect(ids).toEqual(["photo", "clip", "intro", "steps", "tip", "quiz", "empty"]);
  // every active block is still there exactly once
  const activeIds = blocks.filter((b) => b.active !== false).map((b) => b.id).sort();
  expect([...ids].sort()).toEqual(activeIds);
});

test("media keeps its own authored order when there is more than one", () => {
  const ids = orderBlocksForStudent([
    { id: "b", type: "video", order: 9, url: "/v" },
    { id: "a", type: "image", order: 3, url: "/i" },
    { id: "t", type: "text", order: 1 },
  ]).map((b) => b.id);
  expect(ids).toEqual(["a", "b", "t"]);
});

test("only real demonstration media counts", () => {
  expect(isDemoMediaBlock({ type: "image", url: "/i" })).toBe(true);
  expect(isDemoMediaBlock({ type: "video", resource_id: "r" })).toBe(true);
  expect(isDemoMediaBlock({ type: "image" })).toBe(false);
  expect(isDemoMediaBlock({ type: "download", resource_id: "r" })).toBe(false);
  expect(isDemoMediaBlock({ type: "image", url: "/i", active: false })).toBe(false);
  expect(isDemoMediaBlock(null)).toBe(false);
});

test("the student renderer uses the rule (and so does admin preview, which shares the component)", () => {
  const src = fs.readFileSync(path.join(__dirname, "LessonContentBlocks.jsx"), "utf8");
  expect(src).toMatch(/const active = useMemo\(\(\) => orderBlocksForStudent\(blocks\), \[blocks\]\);/);
  const preview = fs.readFileSync(path.join(__dirname, "..", "..", "training", "ProgramPreviewPanel.jsx"), "utf8");
  expect(preview).toMatch(/LessonContentBlocks/);
});
