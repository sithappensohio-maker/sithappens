import { parseSchoolPath, schoolPathFor, trainingMode, trainingModeKey, deliveryLabel, TRAINING_MODES } from "./studentSchool";

/* Training Experience Clarity Pass — Stage 1. One client-facing explanation
   per delivery mode, derived from the server's existing field in every
   spelling it is emitted in. */
describe("trainingMode", () => {
  test("maps every backend spelling onto the three client modes", () => {
    for (const m of ["in_person", "trainer_led", "in_person_school"]) expect(trainingModeKey(m)).toBe("trainer_led");
    for (const m of ["hybrid", "hybrid_school", "both"]) expect(trainingModeKey(m)).toBe("hybrid");
    for (const m of ["online", "self_guided", "online_school"]) expect(trainingModeKey(m)).toBe("online");
  });

  test("legacy or missing modes read as trainer-led, never as an online course", () => {
    expect(trainingModeKey(undefined)).toBe("trainer_led");
    expect(trainingModeKey(null)).toBe("trainer_led");
    expect(trainingModeKey("")).toBe("trainer_led");
    expect(trainingModeKey("legacy_whatever")).toBe("trainer_led");
  });

  test("each mode carries the agreed title, short label and one-sentence explanation", () => {
    expect(trainingMode("in_person").title).toBe("Trainer-Led Program");
    expect(trainingMode("hybrid").title).toBe("Hybrid Program");
    expect(trainingMode("online").title).toBe("Online Program");
    expect(trainingMode("in_person").body).toMatch(/Your trainer guides you through the lessons/);
    expect(trainingMode("hybrid").body).toMatch(/in-person sessions/);
    expect(trainingMode("online").body).toMatch(/at your own pace/);
    for (const tm of Object.values(TRAINING_MODES)) {
      expect(tm.body.split(/[.!?]\s/).length).toBeLessThanOrEqual(2);
      // Internal vocabulary never leaks into the client sentence.
      expect(tm.body).not.toMatch(/enrollment|homework|curriculum|module state|self.guided/i);
    }
  });

  test("every screen that renders <TrainingModeNote imports it (a missing import only fails at runtime)", () => {
    const fs = require("fs"); const path = require("path");
    const root = path.join(__dirname, "..");
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
    const users = walk(root).filter((f) => f.endsWith(".jsx") && !f.endsWith("TrainingModeNote.jsx") && fs.readFileSync(f, "utf8").includes("<TrainingModeNote"));
    expect(users.length).toBeGreaterThanOrEqual(3);
    for (const f of users) expect(fs.readFileSync(f, "utf8")).toMatch(/import TrainingModeNote from "[./]+TrainingModeNote"/);
  });

  test("the chip label is the short mode name (no more 'In Person' vs 'Trainer-Led' split)", () => {
    expect(deliveryLabel("in_person")).toBe("Trainer-Led");
    expect(deliveryLabel("trainer_led")).toBe("Trainer-Led");
    expect(deliveryLabel("hybrid")).toBe("Hybrid");
    expect(deliveryLabel("online")).toBe("Online");
  });
});

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
