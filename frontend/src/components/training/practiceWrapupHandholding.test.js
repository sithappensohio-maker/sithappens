import fs from "fs";
import path from "path";

const read = (name) => fs.readFileSync(path.join(__dirname, name), "utf8");
const guided = read("GuidedPracticeFlow.jsx");
const completion = read("PracticeCompletionPanel.jsx");
const measurements = read("MeasurementChips.jsx");

test("round completion makes stopping versus continuing unmistakable", () => {
  expect(guided).toMatch(/Choose What Happens Next/);
  expect(guided).toMatch(/Training Is Finished for Today/);
  expect(guided).toMatch(/End Practice Here & Log Today/);
  expect(guided).toMatch(/All Rounds Done — Review & Save Session/);
  expect(guided).toMatch(/Start Round \{state\.roundIndex \+ 2\} — \{state\.repsPerRound\} More Reps/);
});

test("the transition out of guided practice explains that training is over and saving comes next", () => {
  expect(guided).toMatch(/The dog-training part is finished/);
  expect(guided).toMatch(/Review & Save Today/);
});

test("the wrap-up form teaches a beginner exactly what to do", () => {
  expect(completion).toMatch(/Last Step · Save Today/);
  expect(completion).toMatch(/The training part is done\. Now record how it went/);
  expect(completion).toMatch(/Check the details/);
  expect(completion).toMatch(/Answer the wrap-up/);
  expect(completion).toMatch(/Tap the green save button once/);
  expect(completion).toMatch(/Check Today/);
  expect(completion).toMatch(/Save Today/);
});

test("editable practice measurements explain what number or text belongs in each box", () => {
  expect(measurements).toMatch(/how many rounds you actually completed/i);
  expect(measurements).toMatch(/how many complete tries you did in each round/i);
  expect(measurements).toMatch(/how many minutes you actually practiced/i);
  expect(measurements).toMatch(/1 = very hard, 3 = mixed, 5 = easy and repeatable/i);
  expect(measurements).toMatch(/skill or setup you practiced today/i);
});
