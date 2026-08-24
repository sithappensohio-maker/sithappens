import { guidedAutofillValues } from "./PracticePanel";

const fields = [
  { id: "sets", label: "Sets Today", kind: "sets" },
  { id: "reps", label: "Reps Per Set", kind: "reps" },
  { id: "minutes", label: "Session Length (min)", kind: "duration_min" },
  { id: "rate", label: "Success Rate", kind: "success_rate" },
  { id: "reliability", label: "Reliability Today (1-5)", kind: "rating_5" },
  { id: "focus", label: "What We Worked On", kind: "text" },
];

test("guided practice prefills only objective facts the app actually tracked", () => {
  const out = guidedAutofillValues(
    fields,
    { rounds_completed: 2, reps_attempted: 10, successful_reps: 8, success_rate: 80 },
    { reps_per_round: 5 },
    367,
    "Engagement & Name Recognition",
  );

  expect(out.sets).toBe(2);
  expect(out.reps).toBe(5);
  expect(out.minutes).toBe(6);
  expect(out.rate).toBe(80);
  expect(out.focus).toBe("Engagement & Name Recognition");
  expect(out.reliability).toBeUndefined();
});

test("reps per round is not invented when the client stops with a partial extra round", () => {
  const out = guidedAutofillValues(
    fields,
    { rounds_completed: 1, reps_attempted: 7, successful_reps: 5, success_rate: 71 },
    { reps_per_round: 5 },
    0,
    "Name Recognition",
  );

  expect(out.sets).toBe(1);
  expect(out.reps).toBeUndefined();
  expect(out.minutes).toBeUndefined();
  expect(out.reliability).toBeUndefined();
});
