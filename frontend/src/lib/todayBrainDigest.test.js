/**
 * The Monday brief's "Send now" tells the owner what happened: sent, nothing to report,
 * or a failure. The Today and Dashboard buttons used to show "sent" whatever came back
 * (audit #69). Homework already branched on the result; the three now share one helper.
 */
jest.mock("./api", () => ({
  ...jest.requireActual("./api"),
  api: { post: jest.fn() },
}));
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

test("a brief held for Quiet Hours says it will send when they end, not that it failed", () => {
  showMondayBriefResult({ sent: 0, reason: "held_quiet_hours" });
  expect(toast.info).toHaveBeenCalledWith(expect.stringContaining("Quiet Hours"));
  expect(toast.error).not.toHaveBeenCalled();
});

// Owner-facing polish pass, 2026-10-19: a request that fails with no server
// detail (a dropped connection, a 500 with no JSON body) used to show the
// raw Axios wording ("Network Error", "Request failed with status code
// 500") instead of a plain sentence — the same trap formatErr's own
// docstring already names (audit #92) for every OTHER screen in the app.
test("a request that fails with no server detail shows a plain message, not the raw Axios wording", async () => {
  api.post.mockRejectedValue({ isAxiosError: true, message: "Network Error" });
  runTodayBrainCTA(SEND_NOW, {});
  await flush();
  expect(toast.error).toHaveBeenCalledWith("Failed to send: Something went wrong.");
});

// An unrecognized response shape used to dump the raw JSON at the owner
// (toast.error(`Result: ${JSON.stringify(data)}`)) instead of a sentence.
test("an unrecognized result shape shows a plain message, not a dump of raw JSON", () => {
  showMondayBriefResult({ some_future_field: "a shape this code doesn't know about yet" });
  expect(toast.error).toHaveBeenCalledWith(expect.not.stringContaining("{"));
  expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("check the admin email"));
});
