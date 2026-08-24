import fs from "fs";
import path from "path";

const read = (name) => fs.readFileSync(path.join(__dirname, name), "utf8");
const guided = read("GuidedPracticeFlow.jsx");
const completion = read("PracticeCompletionPanel.jsx");
const measurements = read("MeasurementChips.jsx");
const panel = read("PracticePanel.jsx");

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

test("the wrap-up tells a beginner exactly what to do and has an early-stop version", () => {
  expect(completion).toMatch(/Last Step · Save Today/);
  expect(completion).toMatch(/The training part is done\. Now record how it went/);
  expect(completion).toMatch(/You stopped before the planned practice was finished/);
  expect(completion).toMatch(/Check the results/);
  expect(completion).toMatch(/Answer the wrap-up/);
  expect(completion).toMatch(/Save & continue/);
  expect(completion).toMatch(/What made you stop/);
});

test("practice plan and actual results are visually separate", () => {
  expect(panel).toMatch(/Today&apos;s Plan/);
  expect(panel).toMatch(/Today&apos;s Results/);
  expect(panel).toMatch(/testid="practice-plan"/);
  expect(panel).toMatch(/testid="practice-results"/);
  expect(measurements).toMatch(/Today's Plan/);
  expect(measurements).toMatch(/Today's Result/);
});

test("client measurement vocabulary is round plus repetition everywhere in the wrap-up", () => {
  expect(measurements).toMatch(/Repetitions Per Round/);
  expect(measurements).toMatch(/Rounds Completed/);
  expect(measurements).toMatch(/A repetition is one complete try/);
  expect(measurements).toMatch(/how many full rounds you actually completed/i);
  expect(measurements).toMatch(/how many minutes you actually practiced/i);
});

test("School save button promises the next step instead of a vague finish", () => {
  expect(panel).toMatch(/Save Practice & Show Me What's Next/);
  expect(panel).toMatch(/School is checking what comes next/);
});
