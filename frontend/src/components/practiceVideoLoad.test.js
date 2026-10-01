/* A practice video that can't be loaded says so (audit #50). The review
 * queue, Trainer Assist and the homework report used to swallow the refusal
 * and show "Loading video…" forever. Mounted. */
import { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("../lib/api", () => ({ api: { get: jest.fn() }, formatErr: (x) => String(x || "") }));
jest.mock("../lib/schoolMedia", () => ({ loadSchoolMediaUrl: jest.fn(() => Promise.reject(new Error("not school media"))) }));

const { api } = require("../lib/api");
const { ReviewVideo: QueueVideo } = require("./DailyReviewQueue");
const { ReviewVideo: AssistVideo } = require("./TrainerAssistQueue");
const { InlineHomeworkVideo } = require("./HomeworkReportPanel");

global.IS_REACT_ACT_ENVIRONMENT = true;

let container, root;
beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); api.get.mockReset(); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });

const CASES = [["the review queue", QueueVideo], ["Trainer Assist", AssistVideo], ["the homework report", InlineHomeworkVideo]];

test.each(CASES)("%s: a refused video says it couldn't be loaded", async (_name, Video) => {
  api.get.mockRejectedValue({ response: { status: 403 } });
  await act(async () => { root.render(<Video homeworkId="hw1" mediaId="m1" />); });
  await flush();
  expect(container.textContent).toMatch(/This video couldn't be loaded\./);
  expect(container.textContent).not.toMatch(/Loading video/);
});

test.each(CASES)("%s: a video that loads plays", async (_name, Video) => {
  api.get.mockResolvedValue({ data: { data: "data:video/mp4;base64,AAAA" } });
  await act(async () => { root.render(<Video homeworkId="hw1" mediaId="m1" />); });
  await flush();
  expect(container.querySelector("video")).not.toBeNull();
});
