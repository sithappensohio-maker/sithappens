import fs from "fs";
import path from "path";

const src = fs.readFileSync(path.join(__dirname, "GuidedPracticeFlow.jsx"), "utf8");

test("guided practice explicitly teaches what a repetition means", () => {
  expect(src).toMatch(/A repetition \(rep\) means one complete try/);
  expect(src).toMatch(/repeat the same training sequence/);
  expect(src).toMatch(/reset your dog to the starting setup/);
});

test("every later rep tells the beginner to start the sequence again", () => {
  expect(src).toMatch(/Start over at Step 1/);
  expect(src).toMatch(/do the same training sequence again/);
  expect(src).toMatch(/Reset & Start Rep/);
});

test("next rounds make the additional repetitions explicit", () => {
  expect(src).toMatch(/More Reps/);
});
