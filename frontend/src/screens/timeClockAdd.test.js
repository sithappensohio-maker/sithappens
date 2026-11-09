/**
 * The owner can add a shift an employee never punched in or out for (Staff →
 * Timecards → Add entry). The times typed are the local wall clock and are sent
 * as real moments; a clock-out earlier than the clock-in is the next day; a
 * second tap can't add the shift twice. Mounted.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { TimeClockAddModal, shiftTimes } from "./Staff";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), defaults: { baseURL: "/api" } },
  formatErr: (e) => (e ? String(e) : ""),
}));
jest.mock("../lib/auth", () => ({ useAuth: () => ({ can: () => true, user: { role: "admin" } }) }));
jest.mock("../lib/registerBus", () => ({ emitRegisterChanged: jest.fn(), onRegisterChanged: () => () => {} }));
jest.mock("../lib/useConfirm", () => ({ useConfirm: () => jest.fn(async () => true) }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../components/PageHero", () => () => null);

const { api } = require("../lib/api");
global.IS_REACT_ACT_ENVIRONMENT = true;

const STAFF = [
  { id: "e1", name: "Sam", hourly_rate: 20, active: true },
  { id: "e2", name: "Riley", hourly_rate: 15, active: true },
  { id: "e3", name: "Gone", hourly_rate: 15, active: false },
];

let container, root, onSaved;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  api.post.mockReset();
  api.post.mockResolvedValue({ data: { id: "new-1", user_id: "e1", hours: 8 } });
  onSaved = jest.fn();
});
afterEach(() => { act(() => root?.unmount()); container.remove(); });

const flush = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); }); };
const mount = async (props = {}) => {
  await act(async () => {
    root = createRoot(container);
    root.render(<TimeClockAddModal employees={STAFF} onClose={() => {}} onSaved={onSaved} {...props} />);
  });
  await flush();
};
const el = (id) => container.querySelector(`[data-testid="${id}"]`);
// React's controlled inputs need the native setter to see a change.
const type = async (id, value) => {
  const node = el(id);
  const proto = node.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value").set.call(node, value);
    node.dispatchEvent(new Event(node.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
};
const fill = async ({ emp = "e1", day = "2026-10-05", timeIn = "09:00", timeOut = "17:30", brk } = {}) => {
  if (emp) await type("tc-add-emp", emp);
  await type("tc-add-day", day);
  await type("tc-add-in", timeIn);
  await type("tc-add-out", timeOut);
  if (brk !== undefined) await type("tc-add-break", brk);
};
const tapSave = async () => { await act(async () => { el("tc-add-save").click(); }); await flush(); };

test("the shift typed is sent as the real moments of that local day, with the break", async () => {
  await mount();
  await fill({ brk: "30" });
  expect(el("tc-add-preview").textContent).toContain("8.00 paid hours");
  expect(el("tc-add-preview").textContent).toContain("$160.00");
  await tapSave();
  expect(api.post).toHaveBeenCalledTimes(1);
  const [url, body] = api.post.mock.calls[0];
  expect(url).toBe("/admin/time-clock");
  expect(body).toEqual({
    user_id: "e1",
    clock_in_at: new Date("2026-10-05T09:00").toISOString(),
    clock_out_at: new Date("2026-10-05T17:30").toISOString(),
    break_minutes: 30,
    note: "",
  });
  expect(onSaved).toHaveBeenCalledWith({ id: "new-1", user_id: "e1", hours: 8 });
});

test("a clock-out earlier than the clock-in is the next day, and says so", async () => {
  await mount();
  await fill({ timeIn: "22:00", timeOut: "06:00" });
  expect(el("tc-add-overnight")).not.toBeNull();
  expect(el("tc-add-preview").textContent).toContain("8.00 paid hours");
  await tapSave();
  const [, body] = api.post.mock.calls[0];
  expect(body.clock_in_at).toBe(new Date("2026-10-05T22:00").toISOString());
  expect(body.clock_out_at).toBe(new Date("2026-10-06T06:00").toISOString());
});

test("nothing is sent until an employee and a real shift are filled in", async () => {
  await mount();
  expect(el("tc-add-save").disabled).toBe(true);
  await fill({ emp: "" });
  expect(el("tc-add-save").disabled).toBe(true);          // no employee yet
  await type("tc-add-emp", "e1");
  expect(el("tc-add-save").disabled).toBe(false);
  await type("tc-add-out", "09:00");                       // same time in and out
  expect(el("tc-add-save").disabled).toBe(true);
  await type("tc-add-out", "10:00");
  await type("tc-add-break", "60");                        // break eats the whole shift
  expect(el("tc-add-save").disabled).toBe(true);
  await tapSave();
  expect(api.post).not.toHaveBeenCalled();
});

test("a second tap while the first is still saving does not add the shift twice", async () => {
  let finish;
  api.post.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  await mount();
  await fill();
  await act(async () => { el("tc-add-save").click(); el("tc-add-save").click(); });
  await flush();
  expect(api.post).toHaveBeenCalledTimes(1);
  await act(async () => { finish({ data: { id: "new-1" } }); });
  await flush();
  expect(onSaved).toHaveBeenCalledTimes(1);
});

test("a refusal from the server is shown and the box stays open to fix it", async () => {
  api.post.mockRejectedValue({ response: { data: { detail: "Sam already has a shift on the timecard that overlaps these times. Edit that shift instead." } } });
  await mount();
  await fill();
  await tapSave();
  expect(el("tc-add-error").textContent).toContain("overlaps");
  expect(onSaved).not.toHaveBeenCalled();
  expect(el("tc-add-save").disabled).toBe(false);
});

test("only active staff are offered, and the timecard's employee filter is pre-picked", async () => {
  await mount({ defaultUserId: "e2" });
  const names = [...el("tc-add-emp").querySelectorAll("option")].map((o) => o.textContent);
  expect(names).toEqual(["Choose an employee…", "Sam", "Riley"]);
  expect(el("tc-add-emp").value).toBe("e2");
});

test("shiftTimes: null until complete, next day only when the clock-out is earlier", () => {
  expect(shiftTimes("2026-10-05", "09:00", "")).toBeNull();
  expect(shiftTimes("", "09:00", "10:00")).toBeNull();
  expect(shiftTimes("2026-10-05", "09:00", "09:00")).toBeNull();
  expect(shiftTimes("2026-10-05", "09:00", "17:00").overnight).toBe(false);
  const night = shiftTimes("2026-10-31", "23:00", "01:00");
  expect(night.overnight).toBe(true);
  expect(night.end.getDate()).toBe(1);
  expect(night.end.getMonth()).toBe(10);   // November
});
