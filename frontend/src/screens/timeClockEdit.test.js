/**
 * A timecard edit keeps the times the admin sees (audit #5: "Fixing a timecard on
 * the Staff screen moves the times 4-5 hours and can cut an employee's pay").
 * A stored time is UTC; the box must show the local wall clock, and saving a break
 * or a note must not send the clock times back at all. Mounted.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { TimeClockEditModal, toLocalDT } from "./Staff";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), defaults: { baseURL: "/api" } },
  formatErr: (e) => String(e),
}));
jest.mock("../lib/auth", () => ({ useAuth: () => ({ can: () => true, user: { role: "admin" } }) }));
jest.mock("../lib/registerBus", () => ({ emitRegisterChanged: jest.fn(), onRegisterChanged: () => () => {} }));
jest.mock("../lib/useConfirm", () => ({ useConfirm: () => jest.fn(async () => true) }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../components/PageHero", () => () => null);

const { api } = require("../lib/api");
global.IS_REACT_ACT_ENVIRONMENT = true;

// 13:00 UTC is 9:00 AM in New York; 21:30 UTC is 5:30 PM.
const ENTRY = { id: "tc-1", clock_in_at: "2026-10-04T13:00:00.000Z", clock_out_at: "2026-10-04T21:30:00.000Z", break_minutes: 0 };
const localWall = (iso) => {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

let container, root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  api.put.mockReset();
  api.put.mockResolvedValue({ data: {} });
});
afterEach(() => { act(() => root?.unmount()); container.remove(); });

const flush = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); }); };
const mount = async (entry = ENTRY) => {
  await act(async () => {
    root = createRoot(container);
    root.render(<TimeClockEditModal entry={entry} onClose={() => {}} onSaved={() => {}} />);
  });
  await flush();
};
const field = (id) => container.querySelector(`[data-testid="${id}"]`);
const save = async () => {
  const btn = [...container.querySelectorAll("button")].find((b) => /save/i.test(b.textContent));
  if (!btn) throw new Error("no save button");
  await act(async () => { btn.click(); });
  await flush();
};

test("the edit box shows the local clock time, not the stored UTC time", async () => {
  await mount();
  expect(field("tc-in").value).toBe(localWall(ENTRY.clock_in_at));
  expect(field("tc-out").value).toBe(localWall(ENTRY.clock_out_at));
  expect(toLocalDT(ENTRY.clock_in_at)).toBe(localWall(ENTRY.clock_in_at));
});

test("saving a break without touching the times sends no clock times", async () => {
  await mount();
  await act(async () => {
    const input = container.querySelector('input[type="number"]');
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setValue.call(input, "30");   // React's controlled input needs the native setter to see the change
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await save();
  const [, body] = api.put.mock.calls[0];
  expect(body.break_minutes).toBe(30);
  expect(body).not.toHaveProperty("clock_in_at");
  expect(body).not.toHaveProperty("clock_out_at");
});
