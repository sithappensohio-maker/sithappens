/**
 * @jest-environment jsdom
 */
// Recipe demo pictures: the editor can attach them, the client Coach shows them.
import fs from "fs";
import path from "path";
import { hasRecipeMedia, recipeHasAnyMedia, recipeMediaSrc, _resetRecipeMediaCacheForTests } from "./recipeMedia";
import { practiceCoachReadiness } from "./practiceCoachPolish";

jest.mock("./api", () => ({ api: { get: jest.fn() } }));
const { api } = require("./api");

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");

beforeEach(() => { _resetRecipeMediaCacheForTests(); api.get.mockReset(); });

test("either an external link or an uploaded file counts as media", () => {
  expect(hasRecipeMedia({ media_url: "https://x/y.jpg" })).toBe(true);
  expect(hasRecipeMedia({ media_id: "m1" })).toBe(true);
  expect(hasRecipeMedia({})).toBe(false);
  expect(hasRecipeMedia(null)).toBe(false);
  expect(recipeHasAnyMedia({ steps: [{ title: "a" }], not_this: { media_id: "m2" } })).toBe(true);
  expect(recipeHasAnyMedia({ steps: [{ title: "a" }] })).toBe(false);
  // the readiness checklist agrees
  const ready = practiceCoachReadiness({ steps: [{ title: "a", media_id: "m1" }] });
  expect(ready.find((r) => /media|video|photo/i.test(r.label))?.met).toBe(true);
});

test("an uploaded file is fetched through the authenticated API once and cached", async () => {
  api.get.mockResolvedValue({ data: { id: "m1", data: "data:image/png;base64,AAAA" } });
  expect(await recipeMediaSrc({ media_id: "m1" })).toBe("data:image/png;base64,AAAA");
  expect(await recipeMediaSrc({ media_id: "m1" })).toBe("data:image/png;base64,AAAA");
  expect(api.get).toHaveBeenCalledTimes(1);
  expect(api.get).toHaveBeenCalledWith("/homework/resource/m1");
  expect(await recipeMediaSrc({ media_url: "https://x/y.jpg", media_id: "m1" })).toBe("https://x/y.jpg");
  expect(await recipeMediaSrc({})).toBe("");
});

test("editor and Coach are wired to the same fields", () => {
  const editor = read("..", "components", "HomeworkTemplateEditor.jsx");
  const overview = read("..", "components", "training", "CoachPracticeOverview.jsx");
  const examples = read("..", "components", "training", "GoodRepNotThisCards.jsx");
  // editor: one picture slot per step and per example, upload or link
  expect(editor).toMatch(/function RecipeImageSlot\(/);
  expect(editor).toMatch(/api\.post\("\/homework\/resource-upload", \{ data, filename: file\.name \}\)/);
  expect(editor).toMatch(/testid=\{`tpl-step-\$\{i\}-image`\}/);
  expect(editor).toMatch(/testid=\{`tpl-\$\{key\}-image`\}/);
  expect(editor).toMatch(/onChange\(\{ media_url: link\.trim\(\), media_id: null \}\)/);
  // client: resolves both kinds
  expect(overview).toMatch(/const hasDetail = hasRecipeMedia\(step\);/);
  expect(overview).toMatch(/const mediaSrc = useRecipeMediaSrc\(step\);/);
  expect(examples).toMatch(/const mediaSrc = useRecipeMediaSrc\(example\);/);
});
