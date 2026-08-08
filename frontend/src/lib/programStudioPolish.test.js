import { computeLessonCompleteness, computeSkillCompleteness, rollUpCompleteness, groupValidationIssues, resolveValidationTarget, programToTemplate, templateToNewProgram, referencedHomeworkTemplateIds, parseProgramTemplate, remapProgramHomework } from "./programStudioPolish";

const bundleProgram = {
  id: "prog-1", name: "Puppy Foundations", type: "private_lessons",
  modules: [
    { id: "m1", name: "Module 1", goals: [{ id: "g1", name: "Focus" }],
      lessons: [{ id: "l1", name: "Lesson 1", skill_ids: ["g1"], suggested_homework_template_ids: ["hw-old-1"] }] },
    { id: "m2", name: "Module 2",
      lessons: [{ id: "l2", name: "Lesson 2", suggested_homework_template_ids: ["hw-old-2"] }] },
  ],
};
const hwLibrary = [
  { id: "hw-old-1", _id: "z", name: "Focus Reps", practice_coach: { enabled: true }, practice_coach_readiness: { errors: [] } },
  { id: "hw-old-2", name: "Sit Reps", practice_coach: { enabled: true } },
  { id: "hw-unrelated", name: "Unused", practice_coach: { enabled: true } },
];

test("referencedHomeworkTemplateIds finds every practice recipe the lessons link to", () => {
  expect(referencedHomeworkTemplateIds(bundleProgram).sort()).toEqual(["hw-old-1", "hw-old-2"]);
  expect(referencedHomeworkTemplateIds({ modules: [] })).toEqual([]);
  expect(referencedHomeworkTemplateIds(null)).toEqual([]);
});

test("programToTemplate bundles ONLY the referenced recipes and strips their runtime fields", () => {
  const t = programToTemplate(bundleProgram, hwLibrary);
  expect(t.version).toBe(2);
  expect(t.homework_templates.map(h => h.id).sort()).toEqual(["hw-old-1", "hw-old-2"]); // not hw-unrelated
  const focus = t.homework_templates.find(h => h.id === "hw-old-1");
  expect(focus._id).toBeUndefined();
  expect(focus.practice_coach_readiness).toBeUndefined();
  expect(focus.id).toBe("hw-old-1"); // id kept so import can remap
  expect(focus.practice_coach.enabled).toBe(true);
});

test("parseProgramTemplate returns the id-less program draft plus its bundled recipes", () => {
  const t = programToTemplate(bundleProgram, hwLibrary);
  const parsed = parseProgramTemplate(t);
  expect(parsed.program.id).toBeUndefined();
  expect(parsed.program.name).toBe("Puppy Foundations");
  expect(parsed.homeworkTemplates.map(h => h.id).sort()).toEqual(["hw-old-1", "hw-old-2"]);
  expect(parseProgramTemplate({ foo: 1 })).toBeNull();
  // a v1 (program-only) file still parses, just with no recipes
  expect(parseProgramTemplate({ program: { name: "Old", modules: [] } }).homeworkTemplates).toEqual([]);
});

test("remapProgramHomework relinks EVERY homework site to new ids, keeping non-bundled ids as-is", () => {
  const prog = {
    welcome_homework_template_id: "hw-old-1",
    modules: [
      { homework_template_id: "hw-old-2",
        goals: [{ id: "g1", homework_template_ids: ["hw-old-1", "hw-installed"] }],
        lessons: [{ suggested_homework_template_ids: ["hw-old-2", "hw-installed"] }] },
    ],
  };
  const out = remapProgramHomework(prog, { "hw-old-1": "hw-new-1", "hw-old-2": "hw-new-2" });
  expect(out.welcome_homework_template_id).toBe("hw-new-1");
  expect(out.modules[0].homework_template_id).toBe("hw-new-2");
  expect(out.modules[0].goals[0].homework_template_ids).toEqual(["hw-new-1", "hw-installed"]); // installed id kept
  expect(out.modules[0].lessons[0].suggested_homework_template_ids).toEqual(["hw-new-2", "hw-installed"]);
});

test("programToTemplate strips identity/runtime fields but keeps the authored curriculum", () => {
  const program = {
    id: "prog-1", _id: "x", slug: "puppy", created_at: "2026-01-01", is_default: true,
    owner_dog_id: "d1", draft: { name: "stale" }, practice_coach_readiness: {},
    name: "Puppy Foundations", type: "private_lessons", price: 149, delivery_mode: "both",
    modules: [{ id: "m1", name: "Module 1", goals: [{ id: "g1", name: "Focus" }] }],
  };
  const t = programToTemplate(program);
  expect(t.sit_happens_template).toBe("online_school_program");
  expect(t.program.id).toBeUndefined();
  expect(t.program.slug).toBeUndefined();
  expect(t.program.created_at).toBeUndefined();
  expect(t.program.is_default).toBeUndefined();
  expect(t.program.draft).toBeUndefined();
  expect(t.program.name).toBe("Puppy Foundations");
  expect(t.program.modules[0].goals[0].id).toBe("g1"); // curriculum ids preserved (skill_ids stay valid)
});

test("templateToNewProgram accepts wrapped or bare shapes, always drops the id, rejects junk", () => {
  const wrapped = { sit_happens_template: "online_school_program", program: { id: "old", name: "Course", modules: [] } };
  expect(templateToNewProgram(wrapped).id).toBeUndefined();
  expect(templateToNewProgram(wrapped).name).toBe("Course");
  const bare = { name: "Bare", modules: [{ name: "M" }] };
  expect(templateToNewProgram(bare).name).toBe("Bare");
  // not a usable program => null so the caller can show an error, not open an empty editor
  expect(templateToNewProgram({ foo: 1 })).toBeNull();
  expect(templateToNewProgram({ program: { name: "no modules" } })).toBeNull();
  expect(templateToNewProgram(null)).toBeNull();
  expect(templateToNewProgram({ modules: [] })).toBeNull(); // no name
});

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
