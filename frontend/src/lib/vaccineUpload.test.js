/* A vaccine upload whose reply is lost is sent again once, with the same id,
 * so an upload that saved is never shown as failed and never stored twice. */
import { postVaccineUpload, replyWasLost, uploadErrorMessage } from "./vaccineUpload";

jest.mock("./api", () => ({
  api: { post: jest.fn() },
  formatErr: (e) => e?.response?.data?.detail || "Something went wrong.",
}));
const { api } = require("./api");

const lost = () => Object.assign(new Error("Network Error"), { request: {} });   // no response at all
const gateway = (status) => ({ response: { status, data: "<html>Bad gateway</html>" } });
const refused = (detail) => ({ response: { status: 400, data: { detail } } });

beforeEach(() => api.post.mockReset());

test("a lost reply is retried once with the same upload id", async () => {
  api.post.mockRejectedValueOnce(lost()).mockResolvedValueOnce({ data: { ok: true, already_received: true } });
  const res = await postVaccineUpload("d1", { vaccine: "rabies", expires_on: "2031-01-01", photo: "x" }, "up-1", { retryDelayMs: 0 });
  expect(res.data.already_received).toBe(true);
  expect(api.post).toHaveBeenCalledTimes(2);
  for (const [url, body] of api.post.mock.calls) {
    expect(url).toBe("/portal/dogs/d1/vaccine-update");
    expect(body).toEqual({ vaccine: "rabies", expires_on: "2031-01-01", photo: "x", upload_id: "up-1" });
  }
});

test("a gateway error page counts as a lost reply", async () => {
  api.post.mockRejectedValueOnce(gateway(504)).mockResolvedValueOnce({ data: { ok: true } });
  await postVaccineUpload("d1", { vaccine: "dhpp" }, "up-2", { retryDelayMs: 0 });
  expect(api.post).toHaveBeenCalledTimes(2);
});

test("a refusal from our server is not retried and its reason is shown", async () => {
  api.post.mockRejectedValueOnce(refused("Uploaded PDF is too large."));
  await expect(postVaccineUpload("d1", { vaccine: "rabies" }, "up-3", { retryDelayMs: 0 })).rejects.toMatchObject({ response: { status: 400 } });
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(uploadErrorMessage(refused("Uploaded PDF is too large."))).toBe("Uploaded PDF is too large.");
});

test("when it still can't be confirmed, the message says a resend won't duplicate it", async () => {
  api.post.mockRejectedValue(lost());
  let error;
  try { await postVaccineUpload("d1", { vaccine: "rabies" }, "up-4", { retryDelayMs: 0 }); } catch (e) { error = e; }
  expect(replyWasLost(error)).toBe(true);
  expect(uploadErrorMessage(error)).toMatch(/couldn't reach Sit Happens to confirm.*won't be sent twice/);
});
