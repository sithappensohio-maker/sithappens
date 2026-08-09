import { parseSchoolPath, schoolPathFor } from "./studentSchool";

describe("studentSchool routes (Phase 2B)", () => {
  test("parses /school as home", () => {
    expect(parseSchoolPath("/school")).toEqual({ view: "home", enrollmentId: null, lessonId: null });
    expect(parseSchoolPath("/school/")).toEqual({ view: "home", enrollmentId: null, lessonId: null });
  });

  test("parses course and lesson routes", () => {
    expect(parseSchoolPath("/school/course/abc-123")).toEqual({ view: "course", enrollmentId: "abc-123", lessonId: null });
    expect(parseSchoolPath("/school/course/abc-123/lesson/les-9")).toEqual({ view: "lesson", enrollmentId: "abc-123", lessonId: "les-9" });
  });

  test("parses simple views and falls back to home on junk", () => {
    expect(parseSchoolPath("/school/today").view).toBe("today");
    expect(parseSchoolPath("/school/progress").view).toBe("progress");
    expect(parseSchoolPath("/school/feedback").view).toBe("feedback");
    expect(parseSchoolPath("/school/nonsense").view).toBe("home");
  });

  test("pathFor round-trips every route shape", () => {
    for (const [args, expected] of [
      [["home"], "/school"],
      [["course", "e1"], "/school/course/e1"],
      [["lesson", "e1", "l2"], "/school/course/e1/lesson/l2"],
      [["today"], "/school/today"],
      [["progress"], "/school/progress"],
      [["feedback"], "/school/feedback"],
    ]) {
      const path = schoolPathFor(...args);
      expect(path).toBe(expected);
      const parsed = parseSchoolPath(path);
      expect(parsed.view).toBe(args[0]);
    }
  });
});
