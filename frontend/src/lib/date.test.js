/* The business's calendar (audit #47). "Today" is Ohio's date on every
 * device, the same day the server's business_today() uses, so no screen
 * rolls to tomorrow at 8 PM Eastern (UTC) or disagrees with the server on a
 * device set to another time zone. */
import fs from "fs";
import path from "path";
import { BUSINESS_TZ, todayISO, businessDateOf, businessTimeHHMM, addDaysISO, daysAgoISO, daysFromTodayISO } from "./date";

const BACKEND = path.join(__dirname, "..", "..", "..", "backend");
const at = (instant) => { jest.useFakeTimers(); jest.setSystemTime(new Date(instant)); };
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });

test.each([
  ["2026-10-01T01:30:00Z", "2026-09-30"], // 9:30 PM EDT on Sep 30; UTC is already Oct 1
  ["2026-10-01T03:59:59Z", "2026-09-30"], // 11:59:59 PM EDT
  ["2026-10-01T04:00:00Z", "2026-10-01"], // midnight EDT
  ["2026-01-15T00:30:00Z", "2026-01-14"], // 7:30 PM EST: winter rolls at 7 PM
  ["2026-01-15T05:00:00Z", "2026-01-15"], // midnight EST
  ["2027-01-01T02:00:00Z", "2026-12-31"], // New Year's Eve, 9 PM
])("at %s it is %s in Ohio", (instant, ohio) => {
  at(instant);
  expect(todayISO()).toBe(ohio);
  expect(businessDateOf(instant)).toBe(ohio);
  expect(daysAgoISO(1)).toBe(addDaysISO(ohio, -1));
  expect(daysFromTodayISO(30)).toBe(addDaysISO(ohio, 30));
});

test("today never comes from the device's own date parts", () => {
  // On an Eastern machine the device's date IS Ohio's, so poison the device
  // parts: a device-local todayISO() reads them, the Ohio one must not.
  at("2026-10-01T01:30:00Z");
  const proto = Object.getPrototypeOf(new Date());
  for (const k of ["getFullYear", "getMonth", "getDate"]) jest.spyOn(proto, k).mockReturnValue(1);
  expect(todayISO()).toBe("2026-09-30");
  expect(daysFromTodayISO(1)).toBe("2026-10-01");
});

test.each([
  ["2026-10-01T01:30:00Z", "21:30"], // 9:30 PM EDT
  ["2026-01-15T00:30:00Z", "19:30"], // 7:30 PM EST
  ["2026-10-01T04:00:00Z", "00:00"], // midnight EDT: never "24:00"
  ["2026-06-12T19:45:00Z", "15:45"], // 3:45 PM EDT
])("businessTimeHHMM: at %s the Ohio clock reads %s", (instant, hhmm) => {
  expect(businessTimeHHMM(new Date(instant))).toBe(hhmm);
  at(instant);
  expect(businessTimeHHMM()).toBe(hhmm);
});

test("businessTimeHHMM never reads the device's own clock", () => {
  // Poison the device's hour and minute: a device-local read would show 03:07.
  at("2026-06-12T19:45:00Z");
  const proto = Object.getPrototypeOf(new Date());
  jest.spyOn(proto, "getHours").mockReturnValue(3);
  jest.spyOn(proto, "getMinutes").mockReturnValue(7);
  expect(businessTimeHHMM()).toBe("15:45");
});

test("businessTimeHHMM: an unreadable instant gives an empty string", () => {
  expect(businessTimeHHMM("not a date")).toBe("");
});

test("the old UTC slice really is tomorrow at 9:30 PM Eastern", () => {
  at("2026-10-01T01:30:00Z");
  expect(new Date().toISOString().slice(0, 10)).toBe("2026-10-01");
  expect(todayISO()).toBe("2026-09-30");
});

test("addDaysISO is calendar arithmetic: DST, month ends and leap days never shift it", () => {
  expect(addDaysISO("2026-11-01", 7)).toBe("2026-11-08");
  expect(addDaysISO("2026-03-15", -7)).toBe("2026-03-08");
  expect(addDaysISO("2026-12-31", 1)).toBe("2027-01-01");
  expect(addDaysISO("2028-02-28", 1)).toBe("2028-02-29");
  expect(addDaysISO("2026-09-30", 30)).toBe("2026-10-30");
  expect(addDaysISO("", 1)).toBe("");
  expect(addDaysISO("junk", 1)).toBe("");
});

test("businessDateOf: a stored timestamp lands on its Ohio day; a plain date stays itself", () => {
  expect(businessDateOf("2026-10-01T00:30:00+00:00")).toBe("2026-09-30");
  expect(businessDateOf("2026-10-01T00:30:00.123456+00:00")).toBe("2026-09-30");
  expect(businessDateOf("2026-09-30")).toBe("2026-09-30");
  expect(businessDateOf("")).toBe("");
  expect(businessDateOf(null)).toBe("");
  expect(businessDateOf("not a date")).toBe("");
});

test("the screens' time zone is the server's", () => {
  for (const file of ["server.py", "daily_jobs.py"]) {
    const py = fs.readFileSync(path.join(BACKEND, file), "utf8");
    expect(py).toContain(`BUSINESS_TZ = ZoneInfo("${BUSINESS_TZ}")`);
  }
});
