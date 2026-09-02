/**
 * Recurring schedules are extended by the backend scheduler once the operator
 * has extended them the first time. The screen must expose the opt-out and
 * show which schedules are on autopilot.
 */
import fs from "fs";
import path from "path";

const src = fs.readFileSync(path.join(__dirname, "RecurringTemplates.jsx"), "utf8");

test("template form carries the auto_extend flag (default on) and a toggle", () => {
  expect(src).toMatch(/auto_extend: true \};/);
  expect(src).toMatch(/auto_extend: r\.auto_extend !== false,/);
  expect(src).toMatch(/data-testid="template-auto-extend"/);
  expect(src).toMatch(/setForm\(\{\.\.\.form, auto_extend: e\.target\.checked\}\)/);
});

test("rows show the auto-extend badge only once a schedule has been extended and is active", () => {
  expect(src).toMatch(/r\.last_booked_through && r\.auto_extend !== false && r\.active && \(/);
  expect(src).toMatch(/data-testid=\{`auto-extend-badge-\$\{r\.id\}`\}/);
  expect(src).toMatch(/Manual extend only/);
});
