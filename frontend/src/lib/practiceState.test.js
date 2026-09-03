import { practiceTitle, isRequiredPracticeSatisfied, loggedToday, sessionsLabel, practiceLoggedLabel } from "./practiceState";

test("only the server's explicit true counts as satisfied — never a guess from logs", () => {
  expect(isRequiredPracticeSatisfied({ required_practice_satisfied: true })).toBe(true);
  expect(isRequiredPracticeSatisfied({ required_practice_satisfied: false, section_logs: [{ section_id: "practice" }] })).toBe(false);
  expect(isRequiredPracticeSatisfied({ section_logs: [{ section_id: "practice" }], sessions_logged: 3 })).toBe(false);
  expect(isRequiredPracticeSatisfied(null)).toBe(false);
});

test("logged today compares the server timestamp to the local calendar day", () => {
  const now = new Date(2026, 8, 3, 15, 0, 0);
  expect(loggedToday({ last_session_at: new Date(2026, 8, 3, 9, 0, 0).toISOString() }, now)).toBe(true);
  expect(loggedToday({ last_session_at: new Date(2026, 8, 2, 23, 0, 0).toISOString() }, now)).toBe(false);
  expect(loggedToday({ last_session_at: null }, now)).toBe(false);
  expect(loggedToday({ last_session_at: "not a date" }, now)).toBe(false);
});

test("rows are named after their School lesson when the server names one", () => {
  expect(practiceTitle({ title: "TEST Template 0", school_lesson_name: "Name Response" })).toBe("Name Response");
  expect(practiceTitle({ title: "Loose-Leash Bonus Reps", school_lesson_name: null })).toBe("Loose-Leash Bonus Reps");
  expect(practiceTitle({})).toBe("Practice");
});

test("the words the customer reads", () => {
  expect(sessionsLabel({ sessions_logged: 1 })).toBe("1 session logged");
  expect(sessionsLabel({ sessions_logged: 3 })).toBe("3 sessions logged");
  expect(sessionsLabel({ sessions_logged: 0 })).toBe("");
  const now = new Date(2026, 8, 3, 15, 0, 0);
  expect(practiceLoggedLabel({ sessions_logged: 1, last_session_at: new Date(2026, 8, 3, 9).toISOString() }, now))
    .toEqual({ title: "Practice logged today", detail: "1 session logged · Practice again any time" });
  expect(practiceLoggedLabel({ sessions_logged: 2, last_session_at: new Date(2026, 8, 1, 9).toISOString() }, now))
    .toEqual({ title: "Practice logged", detail: "2 sessions logged · Practice again any time" });
});
