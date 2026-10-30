/* The Today feed's payday card opens Staff on its Payroll tab, where the
 * payday card is; any other way into Staff still opens on the Ops Hub.
 * Mounts the real Staff screen.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import Staff from "./Staff";
import { runTodayBrainCTA, screenTabFor } from "../lib/todayBrain";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  formatErr: (x) => String(x || ""),
}));
jest.mock("../lib/auth", () => ({ useAuth: jest.fn() }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("../lib/useConfirm", () => ({
  useConfirm: () => async () => true,
  ConfirmProvider: ({ children }) => children,
}));

const { api } = require("../lib/api");
const { useAuth } = require("../lib/auth");
global.IS_REACT_ACT_ENVIRONMENT = true;

const CARD = {
  id: "payday-due:2026-10-30", kind: "payday_due", priority: "urgent",
  title: "Payday today — you owe $698.00 to 2 staff members",
  cta: { type: "open_screen", screen: "staff", tab: "payroll" },
};

let container; let root;
beforeEach(() => {
  sessionStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  useAuth.mockReturnValue({ isOwner: () => true, can: () => true });
  api.get.mockReset();
  api.get.mockImplementation((path) => {
    if (path === "/admin/employees") return Promise.resolve({ data: [] });
    if (path === "/admin/payroll/payday") return Promise.resolve({ data: { configured: false } });
    return Promise.resolve({ data: {} });
  });
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  container.remove();
});

const byTestId = (id) => container.querySelector(`[data-testid="${id}"]`);

async function mountStaff() {
  root = createRoot(container);
  await act(async () => { root.render(<Staff />); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

test("opening the payday card lands on Staff's Payroll tab, once", async () => {
  const onNavigate = jest.fn();
  runTodayBrainCTA(CARD, { onNavigate });
  expect(onNavigate).toHaveBeenCalledWith("staff");

  await mountStaff();
  expect(byTestId("payday-card")).not.toBeNull();
  expect(byTestId("payroll-tab")).not.toBeNull();
  expect(screenTabFor("staff")).toBeNull();
});

test("Staff opened any other way starts on the Ops Hub", async () => {
  await mountStaff();
  expect(byTestId("payday-card")).toBeNull();
});
