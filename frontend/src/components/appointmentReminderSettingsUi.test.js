/**
 * Settings → Email Timing: "Reminder email — hours before" used to be a
 * disabled, unenforced field (comms.reminder_email_hours_before had nothing
 * reading it) — now daily_jobs.run_appointment_reminder_job actually sends
 * on it, so the field (and its new enable toggle) must be live, not greyed
 * out with a "Not enforced by the app yet" badge.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import DayToDayControls from "./DayToDayControls";

global.IS_REACT_ACT_ENVIRONMENT = true;

let container, root;
beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); });
afterEach(() => { act(() => root?.unmount()); container.remove(); root = null; });
const mount = (el) => act(() => { root = createRoot(container); root.render(el); });
const byTestId = (id) => document.querySelector(`[data-testid="${id}"]`);

test("the reminder lead time field is enabled and carries no 'not enforced' badge", () => {
  mount(<DayToDayControls section="comms" setD2d={() => {}}
                          d2d={{ comms: { reminder_email_hours_before: 24, appointment_reminder_enabled: true } }} />);
  const hours = byTestId("d2d-rmd-hours");
  expect(hours.disabled).toBe(false);
  expect(hours.value).toBe("24");
  expect(hours.closest("label").textContent).not.toContain("Not enforced by the app yet");
});

test("the enable toggle reflects the setting and is a real checkbox", () => {
  mount(<DayToDayControls section="comms" setD2d={() => {}}
                          d2d={{ comms: { appointment_reminder_enabled: false } }} />);
  const toggle = byTestId("d2d-rmd-enabled");
  expect(toggle.type).toBe("checkbox");
  expect(toggle.checked).toBe(false);
});

test("changing the hours field writes back through setD2d", () => {
  const setD2d = jest.fn();
  mount(<DayToDayControls section="comms" setD2d={setD2d}
                          d2d={{ comms: { reminder_email_hours_before: 24, appointment_reminder_enabled: true } }} />);
  const hours = byTestId("d2d-rmd-hours");
  act(() => { hours.dispatchEvent(new Event("input", { bubbles: true })); });
  const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  act(() => {
    nativeSetter.call(hours, "48");
    hours.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(setD2d).toHaveBeenCalledWith({ comms: { reminder_email_hours_before: 48, appointment_reminder_enabled: true } });
});

test("toggling the enable switch writes back through setD2d", () => {
  const setD2d = jest.fn();
  mount(<DayToDayControls section="comms" setD2d={setD2d}
                          d2d={{ comms: { appointment_reminder_enabled: true } }} />);
  act(() => { byTestId("d2d-rmd-enabled").click(); });
  expect(setD2d).toHaveBeenCalledWith({ comms: { appointment_reminder_enabled: false } });
});
