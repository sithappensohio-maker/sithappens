import { computeLessonCompleteness, computeSkillCompleteness, rollUpCompleteness, groupValidationIssues, resolveValidationTarget } from "./programStudioPolish";

test("computeLessonCompleteness marks recommended-but-missing fields as needs_attention", () => {
  const items = computeLessonCompleteness({ name: "Sit" });
  expect(items.find(i => i.key === "client_overview").state).toBe("needs_attention");
  expect(items.find(i => i.key === "trainer_directions").state).toBe("needs_attention");
  expect(items.find(i => i.key === "advancement_criteria").state).toBe("needs_attention");
});

test("computeLessonCompleteness never flags missing video/homework as an error — optional only", () => {
  const items = computeLessonCompleteness({ name: "Sit" });
  expect(items.find(i => i.key === "video_resource").state).toBe("optional");
  expect(items.find(i => i.key === "homework_linked").state).toBe("optional");
});

test("computeLessonCompleteness marks present fields complete, including a linked video", () => {
  const items = computeLessonCompleteness({
    client_overview: "x", trainer_instructions: "x", success_criteria: "x",
    demo_video_url: "https://x.mp4", suggested_homework_template_ids: ["t1"],
    skill_ids: ["s1"], advancement_criteria: "x",
  });
  expect(items.every(i => i.state === "complete")).toBe(true);
});

test("computeSkillCompleteness treats measurements as optional, pass_criteria as recommended", () => {
  const items = computeSkillCompleteness({ name: "Sit" });
  expect(items.find(i => i.key === "measurements").state).toBe("optional");
  expect(items.find(i => i.key === "pass_criteria").state).toBe("needs_attention");
});

test("rollUpCompleteness returns needs_attention if any item needs attention, else complete", () => {
  expect(rollUpCompleteness([{ state: "complete" }, { state: "optional" }])).toBe("complete");
  expect(rollUpCompleteness([{ state: "complete" }, { state: "needs_attention" }])).toBe("needs_attention");
});

const validation = {
  errors: [
    { code: "broken_prerequisite", message: "broken prereq", module_id: "m1", skill_id: "s1" },
    { code: "broken_homework_ref", message: "broken hw", module_id: "m1", lesson_id: "l1" },
  ],
  warnings: [
    { code: "empty_module", message: "empty module", module_id: "m2" },
    { code: "missing_trainer_instructions", message: "no instructions", module_id: "m1", lesson_id: "l1" },
  ],
};

test("groupValidationIssues buckets prerequisite and homework codes into their own groups regardless of severity", () => {
  const groups = groupValidationIssues(validation);
  expect(groups.prerequisites).toHaveLength(1);
  expect(groups.homework_links).toHaveLength(1);
});

test("groupValidationIssues falls back to skill/lesson/module specificity when not a special code", () => {
  const groups = groupValidationIssues(validation);
  expect(groups.modules).toHaveLength(1); // empty_module, module-only
  expect(groups.modules[0].code).toBe("empty_module");
});

test("groupValidationIssues preserves severity on each issue", () => {
  const groups = groupValidationIssues(validation);
  expect(groups.prerequisites[0].severity).toBe("error");
  expect(groups.modules[0].severity).toBe("warning");
});

const modules = [
  { id: "m1", _key: "m1", goals: [{ id: "s1", _key: "s1k" }], lessons: [{ id: "l1", _key: "l1k" }] },
  { id: "m2", _key: "m2", goals: [], lessons: [] },
];

test("resolveValidationTarget maps a skill-level issue back to its module/skill selection keys", () => {
  expect(resolveValidationTarget({ module_id: "m1", skill_id: "s1" }, modules)).toEqual({ moduleKey: "m1", skillKey: "s1k" });
});

test("resolveValidationTarget maps a lesson-level issue back to its module/lesson selection keys", () => {
  expect(resolveValidationTarget({ module_id: "m1", lesson_id: "l1" }, modules)).toEqual({ moduleKey: "m1", lessonKey: "l1k" });
});

test("resolveValidationTarget returns null for a module that no longer exists in the current draft", () => {
  expect(resolveValidationTarget({ module_id: "gone" }, modules)).toBeNull();
});
