/**
 * The Monday brief's "Send now" tells the owner what happened: sent, nothing to report,
 * or a failure. The Today and Dashboard buttons used to show "sent" whatever came back
 * (audit #69). Homework already branched on the result; the three now share one helper.
 */
jest.mock("./api", () => ({ api: { post: jest.fn() } }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), info: jest.fn(), error: jest.fn() } }));

const { api } = require("./api");
const { toast } = require("sonner");
const { runTodayBrainCTA, showMondayBriefResult } = require("./todayBrain");

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const SEND_NOW = { cta: { type: "send_monday_digest" } };

beforeEach(() => {
  api.post.mockReset();
  toast.success.mockReset();
  toast.info.mockReset();
  toast.error.mockReset();
});

test("Send now on the Today brain reports a sent brief as a success", async () => {
  api.post.mockResolvedValue({ data: { sent: 1 } });
  runTodayBrainCTA(SEND_NOW, {});
  await flush();
  expect(toast.success).toHaveBeenCalledWith("Monday brief sent! Check the admin email.");
});

test("Send now on the Today brain reports a failed send as an error, not a success", async () => {
  api.post.mockResolvedValue({ data: { sent: 0, reason: "email_send_failed" } });
  runTodayBrainCTA(SEND_NOW, {});
  await flush();
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Email send failed"));
});

test("Send now with nothing to report says no email was sent", () => {
  showMondayBriefResult({ sent: 0, reason: "nothing_to_report" });
  expect(toast.info).toHaveBeenCalledWith("Nothing to report this week — no email sent.");
  expect(toast.success).not.toHaveBeenCalled();
});

test("a request that fails outright shows the server's reason", async () => {
  api.post.mockRejectedValue({ response: { data: { detail: "Admins only" } } });
  runTodayBrainCTA(SEND_NOW, {});
  await flush();
  expect(toast.error).toHaveBeenCalledWith("Failed to send: Admins only");
});
