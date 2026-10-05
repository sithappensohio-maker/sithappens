/**
 * Quiet Hours hold emails instead of dropping them (audit: "Quiet Hours drop
 * emails instead of holding them"). The screens that send now say "queued —
 * it goes out when quiet hours end" instead of "failed" or "sent", and the
 * settings say what Quiet Hours do. Mounted where it matters, not source-pinned.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QUIET_HOURS_HINT, asTimeValue, bulkSendMessage, statementMessage } from "../lib/quietHours";
import DayToDayControls from "./DayToDayControls";
import { ReportCardEmailStatus } from "./BookingDetailModal";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(() => Promise.resolve({ data: [] })), post: jest.fn(), put: jest.fn(), delete: jest.fn(),
         defaults: { baseURL: "/api" } },
  formatErr: (e) => String(e || ""),
}));
jest.mock("../lib/auth", () => ({ useAuth: () => ({ can: () => true, user: { role: "admin" } }) }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
global.IS_REACT_ACT_ENVIRONMENT = true;

let container, root;
beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); });
afterEach(() => { act(() => root?.unmount()); container.remove(); root = null; });
const mount = (el) => act(() => { root = createRoot(container); root.render(el); });
const byTestId = (id) => document.querySelector(`[data-testid="${id}"]`);

describe("what the bulk email screen says", () => {
  test.each([
    [{ success_count: 3, recipient_count: 3 }, false, "Sent 3 / 3 emails"],
    [{ success_count: 0, queued_count: 3, recipient_count: 3 }, false, "3 of 3 queued — they go out when quiet hours end"],
    [{ success_count: 1, queued_count: 2, recipient_count: 3 }, false, "Sent 1, 2 of 3 queued — they go out when quiet hours end"],
    [{ success_count: 1, recipient_count: 1 }, true, "Test email sent to 1/1."],
    [{ success_count: 0, queued_count: 1, recipient_count: 1 }, true, "Test email queued — it goes out when quiet hours end."],
    [{ status: "queueing", queued_count: 3, skipped_already_sent: 0, recipient_count: 3 }, false, "3 emails queued to send in the background."],
    [{ status: "queued", queued_count: 1, skipped_already_sent: 0, recipient_count: 1 }, false, "1 email queued to send in the background."],
    [{ status: "queueing", queued_count: 1, skipped_already_sent: 2, recipient_count: 3 }, false, "1 email queued to send in the background. 2 already had this message and were skipped."],
    [{ status: "queued", queued_count: 0, skipped_already_sent: 3, recipient_count: 3 }, false, "Nothing new to send — all 3 families already had this message."],
  ])("%j test=%s", (data, testOnly, message) => {
    expect(bulkSendMessage(data, testOnly)).toBe(message);
  });
});

test("a statement asked for in quiet hours says it is queued, not sent", () => {
  expect(statementMessage({ queued: true, sent_to: "dana@example.com" }, "Statement sent to dana@example.com."))
    .toBe("Statement queued for dana@example.com — it goes out when quiet hours end.");
  expect(statementMessage({ queued: false, sent_to: "dana@example.com" }, "Statement sent to dana@example.com."))
    .toBe("Statement sent to dana@example.com.");
});

describe("the Quiet Hours settings", () => {
  test.each([["9:00", "09:00"], ["21:00", "21:00"], ["", ""], [undefined, ""]])("%s shows as %s", (v, shown) => {
    expect(asTimeValue(v)).toBe(shown);
  });

  test("are time boxes, an older 9:00 shows, and they say emails wait", () => {
    const setD2d = jest.fn();
    mount(<DayToDayControls section="comms" setD2d={setD2d}
                            d2d={{ comms: { quiet_hours_enabled: true, quiet_hours_start: "21:00", quiet_hours_end: "9:00" } }} />);
    const start = byTestId("d2d-quiet-start");
    const end = byTestId("d2d-quiet-end");
    expect(start.type).toBe("time");
    expect(end.type).toBe("time");
    expect(end.value).toBe("09:00");
    expect(byTestId("d2d-quiet-hint").textContent).toBe(QUIET_HOURS_HINT);
    expect(QUIET_HOURS_HINT).toContain("wait and go out when quiet hours end");
  });
});

describe("a Day-in-Pictures email waiting for quiet hours", () => {
  const booking = { id: "b1", report_card_email_attempted_at: "2026-10-01T23:00:00Z" };
  test("says it is waiting, not that it failed", () => {
    mount(<ReportCardEmailStatus booking={{ ...booking, report_card_email_queued_at: "2026-10-01T23:00:00Z" }} />);
    expect(byTestId("report-card-email-status-queued").textContent).toContain("Waiting for quiet hours");
    expect(byTestId("report-card-email-status-failed")).toBeNull();
  });
  test("a real failure still says failed", () => {
    mount(<ReportCardEmailStatus booking={{ ...booking, report_card_email_error: "Resend rejected the send" }} />);
    expect(byTestId("report-card-email-status-failed")).not.toBeNull();
  });
  test("once it goes, it says emailed", () => {
    mount(<ReportCardEmailStatus booking={{ ...booking, report_card_email_sent_at: "2026-10-02T08:01:00Z" }} />);
    expect(byTestId("report-card-email-status-sent")).not.toBeNull();
  });
});
