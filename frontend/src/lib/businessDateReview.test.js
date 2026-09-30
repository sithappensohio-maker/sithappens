/* Review follow-up for audit #47: the School Today card, "practice logged
 * today" and the Today events card use Ohio's day too, so a phone set to
 * another time zone sees the same "today" as the Practice tab and the
 * server. The clock is frozen at 2026-10-01T01:30:00Z — Sep 30, 9:30 PM in
 * Ohio. These checks bite on any device outside Eastern time (CI runs UTC). */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { loggedToday } from "./practiceState";
import { isEventDay } from "../components/TodayEventsCard";

jest.mock("../components/brand/HuskyDogImage", () => () => null);
const { PracticeCard } = require("../components/school/student/today/TodayCards");

global.IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date("2026-10-01T01:30:00Z")); });
afterEach(() => { jest.useRealTimers(); });

test("practice logged at 7:30 PM Ohio counts as logged today", () => {
  expect(loggedToday({ last_session_at: "2026-09-30T23:30:00Z" })).toBe(true);    // 7:30 PM Sep 30 in Ohio
  expect(loggedToday({ last_session_at: "2026-09-30T03:00:00Z" })).toBe(false);   // 11 PM Sep 29 in Ohio
  expect(loggedToday({ last_session_at: "not a date" })).toBe(false);
});

test("an event starting at 7 PM Ohio is today's event", () => {
  expect(isEventDay({ start_at: "2026-09-30T23:00:00Z" })).toBe(true);
  expect(isEventDay({ start_at: "2026-10-01T14:00:00Z" })).toBe(false);          // tomorrow in Ohio
});

test("the School Today card: practice due today is due today, not overdue", () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(<PracticeCard practice={[{ id: "hw1", title: "Sit drills", due_date: "2026-09-30" }]} onOpen={() => {}} />); });
  const card = host.querySelector('[data-testid="today-practice-due"]');
  expect(card).not.toBeNull();
  expect(card.getAttribute("data-overdue")).toBe("false");
  act(() => root.unmount());
  host.remove();
});
