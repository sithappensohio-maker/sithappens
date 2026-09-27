/**
 * Selling a self-guided online course at the desk gives the dog course access
 * only: no "auto-book weekly sessions" option, and the dog must be picked.
 * Mounted (the Sell Program modal on its own), not source-pinned.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
  formatErr: (x) => String(x || ""),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() } }));
jest.mock("../lib/useConfirm", () => ({ useConfirm: () => async () => true, usePromptDialog: () => async () => null, ConfirmProvider: ({ children }) => children }));

const { api } = require("../lib/api");
const { SellProgramModal } = require("./Clients");

global.IS_REACT_ACT_ENVIRONMENT = true;

const CLIENT = { id: "c1", name: "Sam Owner" };
const ONLINE = { id: "p-online", name: "Puppy Basics Online", price: 99, active: true, format: { count: 6, unit: "lessons" },
                 purchase_fulfillment: "online_school", delivery_mode: "self_guided", type: "private_lessons" };
const IN_PERSON = { id: "p-private", name: "Private Lessons", price: 300, active: true, format: { count: 6, unit: "sessions" },
                    purchase_fulfillment: "credits_only", delivery_mode: "trainer_led", type: "private_lessons" };

let container, root;
beforeEach(() => {
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  api.get.mockReset(); api.post.mockReset();
  api.get.mockImplementation((path) => {
    if (String(path).startsWith("/programs")) return Promise.resolve({ data: [ONLINE, IN_PERSON] });
    if (path === "/dogs") return Promise.resolve({ data: [{ id: "d1", name: "Biscuit", owner_id: "c1", breed: "Mix" }] });
    return Promise.resolve({ data: null });
  });
  api.post.mockResolvedValue({ data: { lot: { pack_name: ONLINE.name }, scheduled_bookings: [], schedule_warnings: [] } });
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const flush = () => act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); });
const choose = async (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value").set;
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event("change", { bubbles: true })); });
  await flush();
};
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await flush(); };

test("an online course offers no weekly sessions and needs the dog", async () => {
  act(() => root.render(<SellProgramModal client={CLIENT} onClose={() => {}} onSold={() => {}} />)); await flush();
  await choose(q("sell-program-select"), ONLINE.id);
  await click(q("sell-program-confirm"));
  expect(api.post).not.toHaveBeenCalled();
  expect(q("sell-program-error").textContent).toMatch(/dog/i);
  await choose(q("sell-program-dog"), "d1");
  expect(q("sell-program-schedule")).toBeNull();
  expect(q("sell-program-summary").textContent).toMatch(/online course/i);
  await click(q("sell-program-confirm"));
  const body = api.post.mock.calls[0][1];
  expect(body.dog_id).toBe("d1");
  expect(body.schedule_day_of_week).toBeUndefined();
});

test("an in-person program still offers weekly sessions", async () => {
  act(() => root.render(<SellProgramModal client={CLIENT} onClose={() => {}} onSold={() => {}} />)); await flush();
  await choose(q("sell-program-select"), IN_PERSON.id);
  await choose(q("sell-program-dog"), "d1");
  expect(q("sell-program-schedule")).not.toBeNull();
});
