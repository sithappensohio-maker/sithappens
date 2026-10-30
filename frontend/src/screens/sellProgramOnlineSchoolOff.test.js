/* While Online School is off, the desk can't sell an Online School course: it
 * isn't offered in Sell Program (the server refuses it too, charging nothing).
 * Mounted.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";

let mockOnline = false;
jest.mock("../lib/theme", () => {
  const actual = jest.requireActual("../lib/theme");
  return { ...actual, useFeature: (key) => (key === "online_school" ? mockOnline : true) };
});
jest.mock("../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn(), put: jest.fn() }, formatErr: (d) => String(d || "") }));
jest.mock("sonner", () => ({ toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn(), warning: jest.fn() }) }));
jest.mock("../lib/useConfirm", () => { const c = () => Promise.resolve(true); return { useConfirm: () => c, usePromptDialog: () => c }; });

const { api } = require("../lib/api");
const { SellProgramModal } = require("./Clients");
global.IS_REACT_ACT_ENVIRONMENT = true;

const PROGRAMS = [
  { id: "course", name: "Puppy Course Online", active: true, format: { count: 6 }, price: 49,
    purchase_fulfillment: "online_school", delivery_mode: "self_guided" },
  { id: "class", name: "Puppy Class", active: true, format: { count: 6 }, price: 150, purchase_fulfillment: "credits_only" },
];

let container; let root;
beforeEach(() => {
  api.get.mockReset();
  api.get.mockImplementation((url) => Promise.resolve({ data: url.startsWith("/programs") ? PROGRAMS : url === "/dogs" ? [] : null }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const offered = async () => {
  await act(async () => { root.render(<SellProgramModal client={{ id: "c1", name: "Pat" }} onClose={() => {}} onSold={() => {}}/>); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return [...container.querySelectorAll('[data-testid="sell-program-select"] option')].map((o) => o.value).filter(Boolean);
};

test("with Online School off, only in-person programs are offered", async () => {
  mockOnline = false;
  expect(await offered()).toEqual(["class"]);
});

test("with it on, the course is offered again", async () => {
  mockOnline = true;
  expect(await offered()).toEqual(["course", "class"]);
});
