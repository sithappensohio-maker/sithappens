/**
 * Log Incident pre-fills the date and time from when the form opens, not from
 * when the app was loaded (audit #36). Mounted, with the clock moved in between.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { todayISO } from "../lib/date";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  formatErr: (e) => String(e),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../lib/useConfirm", () => ({ useConfirm: () => jest.fn(async () => true) }));
jest.mock("../lib/imageCompress", () => ({ compressImage: jest.fn() }));
jest.mock("../components/PageHero", () => ({ right }) => right ?? null);

const { api } = require("../lib/api");
global.IS_REACT_ACT_ENVIRONMENT = true;

let container, root;
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2031, 5, 9, 12, 0));
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset().mockImplementation(async (url) => {
    if (url === "/incidents") return { data: [] };
    if (url === "/dogs") return { data: [{ id: "d1", name: "Biter" }] };
    return { data: [] };
  });
});
afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  jest.useRealTimers();
});

const flush = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve(); }); };

test("opening Log Incident later in the day pre-fills the current date and time", async () => {
  // Load the screen while it is noon on 9 June, so the module is first evaluated then.
  const Incidents = require("./Incidents").default;
  await act(async () => {
    root = createRoot(container);
    root.render(<Incidents />);
  });
  await flush();

  // Later: 15:45 on 12 June, the same tab, without a reload.
  jest.setSystemTime(new Date(2031, 5, 12, 15, 45));
  await act(async () => {
    container.querySelector('[data-testid="add-incident-button"]').click();
  });
  await flush();

  expect(container.querySelector('input[type="time"]').value).toBe("15:45");
  expect(container.querySelector('input[type="date"]').value).toBe(todayISO());
});
