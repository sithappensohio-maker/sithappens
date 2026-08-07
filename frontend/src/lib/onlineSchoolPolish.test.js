import {
  buildSchoolRoadmap, schoolLessonCardStatus, buildSchoolLessonCards,
  nextActionLabel, canAdvance, practiceButtonLabel, continueButtonLabel, formatCompletionPct,
} from "./onlineSchoolPolish";

const ROADMAP = {
  current_module_id: "m1", current_lesson_id: "l1a", current_lesson_practiced: false,
  is_final_lesson: false,
  current_lesson: { id: "l1a", name: "Lesson 1.1", status: "available", locked_reason: null, is_current: true },
  modules: [
    {
      id: "m1", name: "Module 1", description: "First module", order: 0, status: "current", locked_reason: null,
      lessons: [
        { id: "l1a", name: "Lesson 1.1", client_overview: "Overview A", demo_video_url: "https://x/a.mp4",
          estimated_minutes: 5, status: "available", locked_reason: null, is_current: true, skill_ids: ["s1"] },
        { id: "l1b", name: "Lesson 1.2", status: "locked", locked_reason: "Complete Lesson 1.1 before continuing." },
      ],
    },
    { id: "m2", name: "Module 2", description: "Second module", order: 1, status: "locked",
      locked_reason: "Complete Module 1 before continuing.", lessons: [] },
  ],
};

test("buildSchoolRoadmap maps module status directly (already matches ModuleJourneyCard vocabulary)", () => {
  const modules = buildSchoolRoadmap(ROADMAP);
  expect(modules).toHaveLength(2);
  expect(modules[0].status).toBe("current");
  expect(modules[1].status).toBe("locked");
});

test("locked module reports null counts, never a fabricated lesson/skill count", () => {
  const modules = buildSchoolRoadmap(ROADMAP);
  const locked = modules.find(m => m.id === "m2");
  expect(locked.lessonCount).toBeNull();
  expect(locked.skillCount).toBeNull();
});

test("current module surfaces the current lesson's real name, not a placeholder", () => {
  const modules = buildSchoolRoadmap(ROADMAP);
  const current = modules.find(m => m.id === "m1");
  expect(current.currentLessonName).toBe("Lesson 1.1");
});

test("buildSchoolRoadmap returns empty array for missing roadmap rather than throwing", () => {
  expect(buildSchoolRoadmap(null)).toEqual([]);
  expect(buildSchoolRoadmap(undefined)).toEqual([]);
});

test("schoolLessonCardStatus translates in_progress to LessonCard's current key, passes others through", () => {
  expect(schoolLessonCardStatus("in_progress")).toBe("current");
  expect(schoolLessonCardStatus("available")).toBe("available");
  expect(schoolLessonCardStatus("completed")).toBe("completed");
  expect(schoolLessonCardStatus("locked")).toBe("locked");
});

test("buildSchoolLessonCards exposes real locked_reason text on a locked lesson", () => {
  const cards = buildSchoolLessonCards(ROADMAP.modules[0]);
  const locked = cards.find(c => c.id === "l1b");
  expect(locked.status).toBe("locked");
  expect(locked.lockedReason).toBe("Complete Lesson 1.1 before continuing.");
});

test("buildSchoolLessonCards marks hasVideo only when a real demo_video_url is present", () => {
  const cards = buildSchoolLessonCards(ROADMAP.modules[0]);
  expect(cards.find(c => c.id === "l1a").hasVideo).toBe(true);
  expect(cards.find(c => c.id === "l1b").hasVideo).toBe(false);
});

test("nextActionLabel says Start before practice, Continue after", () => {
  expect(nextActionLabel({ current_lesson_name: "Name Response", current_lesson_practiced: false })).toBe("Start: Name Response");
  expect(nextActionLabel({ current_lesson_name: "Name Response", current_lesson_practiced: true })).toBe("Continue: Name Response");
});

test("nextActionLabel falls back honestly when there's no current lesson at all", () => {
  expect(nextActionLabel(null)).toBe("Review your progress");
  expect(nextActionLabel({ current_lesson_name: null })).toBe("Review your progress");
});

test("canAdvance is true only once the server confirms real practice happened", () => {
  expect(canAdvance(ROADMAP)).toBe(false);
  expect(canAdvance({ ...ROADMAP, current_lesson_practiced: true })).toBe(true);
  expect(canAdvance({ ...ROADMAP, current_lesson: null, current_lesson_practiced: true })).toBe(false);
});

test("practiceButtonLabel offers to practice again rather than implying it's the first time", () => {
  expect(practiceButtonLabel(false)).toBe("Start Practice");
  expect(practiceButtonLabel(true)).toBe("Practice Again");
});

test("continueButtonLabel switches to Finish Program only at the true end of the roadmap", () => {
  expect(continueButtonLabel(ROADMAP)).toBe("Continue Training");
  expect(continueButtonLabel({ ...ROADMAP, is_final_lesson: true, current_lesson_practiced: true })).toBe("Finish Program");
  expect(continueButtonLabel({ ...ROADMAP, is_final_lesson: true, current_lesson_practiced: false })).toBe("Continue Training");
});

test("formatCompletionPct clamps and rounds honestly, never shows a fabricated 100 or negative", () => {
  expect(formatCompletionPct(37.6)).toBe("38% complete");
  expect(formatCompletionPct(0)).toBe("0% complete");
  expect(formatCompletionPct(150)).toBe("100% complete");
  expect(formatCompletionPct(-5)).toBe("0% complete");
  expect(formatCompletionPct(undefined)).toBe("0% complete");
});
