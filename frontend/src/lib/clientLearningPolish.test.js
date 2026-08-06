import { buildModuleRoadmap, buildLessonCards, filterSkills, deriveStrongestSkill, deriveRecentWin, lockedLessonExplanation } from "./clientLearningPolish";

const learnEntry = (overrides = {}) => ({
  dog_id: "dog-1", dog_name: "Lexi", program_name: "Stage 1 Obedience", current_module_name: "Module 2",
  locked_module_count: 1,
  modules: [
    { id: "m1", name: "Module 1", description: "Foundations", is_current: false, locked_lesson_count: 0,
      lessons: [{ id: "l1", name: "Lesson 1", client_overview: "Intro", demo_video_url: "", is_current: false, skill_ids: ["s1"] }] },
    { id: "m2", name: "Module 2", description: "Positions", is_current: true, locked_lesson_count: 2,
      lessons: [
        { id: "l2", name: "Lesson 1", client_overview: "Sit", demo_video_url: "https://x.mp4", is_current: false, skill_ids: ["s2"] },
        { id: "l3", name: "Lesson 2", client_overview: "Down", demo_video_url: "", is_current: true, skill_ids: ["s3"] },
      ] },
  ],
  ...overrides,
});

// 2. Current module identified correctly.
test("buildModuleRoadmap marks the current module and prior modules correctly", () => {
  const roadmap = buildModuleRoadmap(learnEntry());
  const m1 = roadmap.find(m => m.id === "m1");
  const m2 = roadmap.find(m => m.id === "m2");
  expect(m1.status).toBe("completed");
  expect(m2.status).toBe("current");
  expect(m2.currentLessonName).toBe("Lesson 2");
});

// 3. Completed/current/locked module states map correctly, including the
// locked tail placeholder built ONLY from a count (brief's "unpublished
// curriculum" constraint) — never a fabricated name for hidden modules.
test("buildModuleRoadmap appends a count-only locked placeholder, never a fabricated module", () => {
  const roadmap = buildModuleRoadmap(learnEntry());
  const locked = roadmap.find(m => m.status === "locked");
  expect(locked).toBeTruthy();
  expect(locked.name).toMatch(/1 More Module/);
  expect(roadmap.length).toBe(3); // 2 real + 1 locked placeholder
});

test("buildModuleRoadmap omits the locked placeholder when nothing is locked", () => {
  const roadmap = buildModuleRoadmap(learnEntry({ locked_module_count: 0 }));
  expect(roadmap.some(m => m.status === "locked")).toBe(false);
});

// 4. Locked lessons explain the prerequisite — never a bare disabled button.
test("buildLessonCards appends a count-only locked placeholder with a reason, never a fabricated lesson name", () => {
  const currentModule = buildModuleRoadmap(learnEntry()).find(m => m.status === "current");
  const cards = buildLessonCards(currentModule);
  const locked = cards.find(c => c.status === "locked");
  expect(locked).toBeTruthy();
  expect(locked.name).toMatch(/2 More Lesson/);
  expect(lockedLessonExplanation({ isCurrentModule: true })).toMatch(/unlock/i);
  expect(lockedLessonExplanation({ isCurrentModule: false })).toMatch(/module/i);
});

test("buildLessonCards marks the matching lesson as current, others as completed", () => {
  const cards = buildLessonCards(learnEntry().modules[1]);
  expect(cards.find(c => c.id === "l2").status).toBe("completed");
  expect(cards.find(c => c.id === "l3").status).toBe("current");
});

// 7. Skill scores map to the correct six client-safe levels — mirrors the
// backend's SKILL_LEVEL_LABELS exactly (0-5 -> 6 labels).
test("filterSkills level ordering matches the backend's six-level scale", () => {
  const skills = [
    { id: "a", level_label: "Not Introduced" }, { id: "b", level_label: "Introduced" },
    { id: "c", level_label: "Learning" }, { id: "d", level_label: "Practicing" },
    { id: "e", level_label: "Reliable" }, { id: "f", level_label: "Mastered" },
  ];
  expect(filterSkills(skills, "needs_practice", new Set()).map(s => s.id)).toEqual(["a", "b", "c"]);
  expect(filterSkills(skills, "reliable", new Set()).map(s => s.id)).toEqual(["e"]);
  expect(filterSkills(skills, "mastered", new Set()).map(s => s.id)).toEqual(["f"]);
});

test("filterSkills current_module filter uses the provided id set, not a second lookup", () => {
  const skills = [{ id: "s1", level_label: "Learning" }, { id: "s2", level_label: "Learning" }];
  const result = filterSkills(skills, "current_module", new Set(["s2"]));
  expect(result.map(s => s.id)).toEqual(["s2"]);
});

test("filterSkills needs_practice also includes a flagged needs_reassessment skill regardless of level", () => {
  const skills = [{ id: "s1", level_label: "Mastered", needs_reassessment: true }];
  expect(filterSkills(skills, "needs_practice", new Set()).map(s => s.id)).toEqual(["s1"]);
});

// Report-card heuristics — derived from existing data only.
test("deriveStrongestSkill picks the highest-scored current skill", () => {
  const skills = [{ id: "a", name: "Sit", score: 3 }, { id: "b", name: "Down", score: 5 }];
  expect(deriveStrongestSkill(skills).name).toBe("Down");
});

test("deriveRecentWin finds the most recent recently-mastered skill from session recaps", () => {
  const recaps = [
    { skills_practiced: [{ name: "Stay", status: "in_progress" }] },
    { skills_practiced: [{ name: "Sit", status: "mastered" }] },
  ];
  expect(deriveRecentWin(recaps)).toBe("Sit");
});

test("deriveRecentWin returns null when nothing was recently mastered", () => {
  expect(deriveRecentWin([{ skills_practiced: [{ name: "Stay", status: "in_progress" }] }])).toBeNull();
});
