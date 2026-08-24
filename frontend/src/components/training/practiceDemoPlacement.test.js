import fs from "fs";
import path from "path";

const src = fs.readFileSync(path.join(__dirname, "PracticePanel.jsx"), "utf8");

test("coach demo is shown before guided practice starts", () => {
  expect(src).toMatch(/viewMode === "overview"/);
  expect(src).toMatch(/practice-video-before-start/);
  expect(src).toMatch(/Watch Before You Start/);
});

test("guided wrap-up does not show the demo video again", () => {
  expect(src).toMatch(/entryContext !== "guided_done"/);
  expect(src).toMatch(/practice-video/);
});
