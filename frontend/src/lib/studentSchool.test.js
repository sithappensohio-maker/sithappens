import { parseSchoolPath, schoolPathFor } from "./studentSchool";

/* Updated by the client redesign (phase 2). The default view was renamed
   "home" -> "today": the client had two landing pages rendering the same
   current_action, and Today is now the single one. "/school/home" is kept as
   a backward-compatible alias so existing links still resolve. */
describe("studentSchool routes", () => {
  test("parses /school as today, the single default landing page", () => {
    expect(parseSchoolPath("/school")).toEqual({ view: "today", enrollmentId: null, lessonId: null });
    expect(parseSchoolPath("/school/")).toEqual({ view: "today", enrollmentId: null, lessonId: null });
  });

  test("the legacy /school/home alias still resolves to today", () => {
    expect(parseSchoolPath("/school/home").view).toBe("today");
  });

  test("parses course and lesson routes", () => {
    expect(parseSchoolPath("/school/course/abc-123")).toEqual({ view: "course", enrollmentId: "abc-123", lessonId: null });
    expect(parseSchoolPath("/school/course/abc-123/lesson/les-9")).toEqual({ view: "lesson", enrollmentId: "abc-123", lessonId: "les-9" });
  });

  test("parses the program welcome route under its course", () => {
    expect(parseSchoolPath("/school/course/abc-123/welcome")).toEqual({ view: "welcome", enrollmentId: "abc-123", lessonId: null });
  });

  test("parses simple views and falls back to today on junk", () => {
    expect(parseSchoolPath("/school/today").view).toBe("today");
    expect(parseSchoolPath("/school/practice").view).toBe("practice");
    expect(parseSchoolPath("/school/progress").view).toBe("progress");
    expect(parseSchoolPath("/school/feedback").view).toBe("feedback");
    expect(parseSchoolPath("/school/nonsense").view).toBe("today");
  });

  test("pathFor round-trips every route shape", () => {
    // `parsedAs` differs from the input only for the "home" alias, which
    // deliberately normalises to the single Today landing page.
    for (const [args, expected, parsedAs] of [
      [["home"], "/school", "today"],
      [["today"], "/school", "today"],
      [["course", "e1"], "/school/course/e1", "course"],
      [["lesson", "e1", "l2"], "/school/course/e1/lesson/l2", "lesson"],
      [["welcome", "e1"], "/school/course/e1/welcome", "welcome"],
      [["practice"], "/school/practice", "practice"],
      [["progress"], "/school/progress", "progress"],
      [["feedback"], "/school/feedback", "feedback"],
    ]) {
      const path = schoolPathFor(...args);
      expect(path).toBe(expected);
      expect(parseSchoolPath(path).view).toBe(parsedAs);
    }
  });
});
