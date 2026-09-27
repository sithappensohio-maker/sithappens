/**
 * In person, a passed module quiz never moves the dog (the trainer does) and
 * the final quiz only makes the dog ready to graduate — the result says so
 * instead of "The next module is unlocked." Mounted.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("../../../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn() },
  formatErr: (x) => String(x || ""),
}));
jest.mock("../../../lib/immersiveWorkflow", () => ({ useImmersiveWorkflow: () => {} }));

const { api } = require("../../../lib/api");
const ModuleQuizPanel = require("./ModuleQuizPanel").default;

global.IS_REACT_ACT_ENVIRONMENT = true;

const QUIZ = {
  title: "Knowledge Check", module_name: "Module 3", status: "available", passing_score: 80, question_count: 1,
  attempt_count: 0, questions: [{ id: "q1", type: "true_false", question: "End on a win?", options: [{ id: "o1", text: "True" }, { id: "o2", text: "False" }] }],
};

let container, root;
beforeEach(() => {
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  api.get.mockReset(); api.post.mockReset();
  api.get.mockResolvedValue({ data: QUIZ });
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const flush = () => act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); });
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await flush(); };

async function passWith(result) {
  api.post.mockResolvedValue({ data: { passed: true, score_percent: 100, correct_count: 1, question_count: 1, results: [], ...result } });
  act(() => root.render(<ModuleQuizPanel enrollmentId="se1" moduleId="m3" onClose={() => {}} />)); await flush();
  await click(q("module-quiz-start"));
  await click(q("module-quiz-option-o1"));
  await click(q("module-quiz-submit"));
  return q("module-quiz-after-pass").textContent;
}

test("in person, the final quiz says the trainer will confirm graduation", async () => {
  expect(await passWith({ trainer_led: true, graduation_ready: true, advanced: false, course_completed: false }))
    .toMatch(/trainer will confirm/i);
});

test("in person, a mid-course quiz says the trainer moves the dog on", async () => {
  expect(await passWith({ trainer_led: true, graduation_ready: false, advanced: false, course_completed: false }))
    .toMatch(/trainer moves you to the next lesson/i);
});

test("online, passing still unlocks the next module", async () => {
  expect(await passWith({ advanced: true, course_completed: false })).toMatch(/next module is unlocked/i);
});
