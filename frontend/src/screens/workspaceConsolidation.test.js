import fs from "fs";
import path from "path";
import { NAV_ITEMS, WORKSPACE_ROOT_BY_TAB, workspaceRootForTab } from "../App";

const read = (name) => fs.readFileSync(path.join(__dirname, name), "utf8");
const appSrc = fs.readFileSync(path.join(__dirname, "..", "App.js"), "utf8");
const scheduleWorkspaceSrc = read("ScheduleWorkspace.jsx");
const trainingWorkspaceSrc = read("TrainingWorkspace.jsx");

const nav = (id) => NAV_ITEMS.find((item) => item.id === id);

test("legacy booking destinations collapse into the Schedule workspace without deleting their nav registry entries", () => {
  expect(workspaceRootForTab("schedule")).toBe("schedule");
  for (const id of ["bookings", "waitlist", "recurring"]) {
    expect(WORKSPACE_ROOT_BY_TAB[id]).toBe("schedule");
    expect(nav(id)).toBeTruthy();
    expect(nav(id).sidebar).toBe(false);
  }
  expect(nav("schedule").sidebar).not.toBe(false);
  expect(scheduleWorkspaceSrc).toMatch(/label: "Calendar"/);
  expect(scheduleWorkspaceSrc).toMatch(/label: "Bookings"/);
  expect(scheduleWorkspaceSrc).toMatch(/label: "Waitlist"/);
  expect(scheduleWorkspaceSrc).toMatch(/label: "Recurring"/);
  expect(scheduleWorkspaceSrc).toMatch(/section === "calendar" && <Schedule \/>/);
  expect(scheduleWorkspaceSrc).toMatch(/section === "bookings" && <Bookings \/>/);
  expect(scheduleWorkspaceSrc).toMatch(/section === "waitlist" && <Waitlist \/>/);
  expect(scheduleWorkspaceSrc).toMatch(/section === "recurring" && <RecurringTemplates \/>/);
});

test("legacy training destinations collapse into one Training workspace", () => {
  expect(nav("pipeline").label).toBe("Training");
  expect(nav("pipeline").sidebar).not.toBe(false);
  for (const id of ["school_hq", "rewards_center", "trophies"]) {
    expect(WORKSPACE_ROOT_BY_TAB[id]).toBe("pipeline");
    expect(nav(id).sidebar).toBe(false);
  }
  // Practice/Homework was already an internal-only destination rather than a
  // NAV_ITEMS row, but its deep-link id still maps to the Training workspace.
  expect(WORKSPACE_ROOT_BY_TAB.homework).toBe("pipeline");
  expect(trainingWorkspaceSrc).toMatch(/label: "Today"/);
  expect(trainingWorkspaceSrc).toMatch(/label: "School"/);
  expect(trainingWorkspaceSrc).toMatch(/label: "Practice"/);
  expect(trainingWorkspaceSrc).toMatch(/label: "Rewards"/);
  expect(trainingWorkspaceSrc).toMatch(/label: "Trophies"/);
});

test("App renders legacy destination ids through the consolidated workspace components", () => {
  expect(appSrc).toMatch(/\["schedule", "bookings", "waitlist", "recurring"\]\.includes\(tab\)/);
  expect(appSrc).toMatch(/<ScheduleWorkspace[\s\S]*?initialSection=\{tab\}[\s\S]*?onSectionChange=/);
  expect(appSrc).toMatch(/\["pipeline", "school_hq", "homework", "rewards_center", "trophies"\]\.includes\(tab\)/);
  expect(appSrc).toMatch(/<TrainingWorkspace[\s\S]*?initialSection=\{tab\}/);
});

test("Dashboard is no longer a competing sidebar destination and legacy Dashboard state highlights Today", () => {
  expect(nav("dashboard").sidebar).toBe(false);
  expect(workspaceRootForTab("dashboard")).toBe("today");
  expect(appSrc).toMatch(/const sidebarActiveId = workspaceRootForTab\(tab\)/);
});

test("Schedule calendar must size itself — percentage heights can't resolve inside the auto-height workspace", () => {
  // Regression: after ScheduleWorkspace wrapped Schedule in auto-height divs,
  // FullCalendar height="100%" resolved to 0px and the month grid vanished
  // (header + weekday row rendered, no day cells).
  const scheduleSrc = read("Schedule.jsx");
  expect(scheduleSrc).toMatch(/height="auto"/);
  expect(scheduleSrc).not.toMatch(/height=\{[^}]*"100%"/);
});

test("workspace tab clicks are wired back to the router instead of staying private local state", () => {
  expect(scheduleWorkspaceSrc).toMatch(/onSectionChange = \(\) => \{\}/);
  expect(scheduleWorkspaceSrc).toMatch(/onChange=\{\(next\) => \{ setSection\(next\); onSectionChange\(next\); \}\}/);
  expect(trainingWorkspaceSrc).toMatch(/onSectionChange = \(\) => \{\}/);
  expect(trainingWorkspaceSrc).toMatch(/onChange=\{\(next\) => \{ setSection\(next\); onSectionChange\(next\); \}\}/);
});
