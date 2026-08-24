import fs from "fs";
import path from "path";

const read = (...parts) => fs.readFileSync(path.join(__dirname, ...parts), "utf8");
const overview = read("CoachPracticeOverview.jsx");
const completion = read("PracticeCompletionPanel.jsx");
const measurements = read("MeasurementChips.jsx");
const css = read("practiceTypography.css");
const entry = read("..", "..", "index.js");

test("Practice Coach section labels use the readable hierarchy", () => {
  expect(overview).toMatch(/text-\[12px\] sm:text-\[13px\] font-black uppercase/);
  expect(completion).toMatch(/text-\[12px\] sm:text-\[13px\] font-black uppercase/);
  expect(measurements).toMatch(/text-\[12px\] sm:text-\[13px\] font-black uppercase/);
});

test("Practice Coach has a scoped floor for legacy tiny helper text", () => {
  expect(css).toMatch(/data-testid=\"practice-panel\"/);
  expect(css).toMatch(/text-\\\[9px\\\]/);
  expect(css).toMatch(/font-size: 12\.5px !important/);
  expect(css).toMatch(/font-size: 14px !important/);
  expect(entry).toMatch(/practiceTypography\.css/);
});
