import fs from "fs";
import path from "path";

const src = fs.readFileSync(path.join(__dirname, "GuidedPracticeFlow.jsx"), "utf8");

test("guided practice tells a beginner what to do, what counts, and when to reset", () => {
  expect(src).toMatch(/Today&apos;s Goal|Today's Goal/);
  expect(src).toMatch(/Do This Rep/);
  expect(src).toMatch(/What Counts/);
  expect(src).toMatch(/Reset This Rep/);
  expect(src).toMatch(/target_response_seconds/);
});

test("guided practice coaches after each rep instead of only counting it", () => {
  expect(src).toMatch(/Do This Now/);
  // The repetition-handholding upgrade renamed the plain "Next Rep" button:
  // acknowledging an outcome now tells the client to reset and start the
  // numbered repetition (or take the scheduled break / see the round result).
  expect(src).toMatch(/Reset & Start Rep \$\{nextRepNumber\}/);
  expect(src).toMatch(/ReactiveTip/);
});

test("round summaries adapt difficulty from the actual success rate", () => {
  expect(src).toMatch(/roundCoachDecision/);
  expect(src).toMatch(/Keep this difficulty/);
  expect(src).toMatch(/Do not make it harder yet/);
  expect(src).toMatch(/Make the next round easier/);
});

test("finished practice shows a real session recap before logging", () => {
  expect(src).toMatch(/Session Complete/);
  expect(src).toMatch(/clean reps/);
  expect(src).toMatch(/success/);
  // The wrap-up handholding upgrade renamed the logging CTA: the recap now
  // hands off to the review-and-save wrap-up rather than logging directly.
  expect(src).toMatch(/Review & Save Today&apos;s Practice/);
});
