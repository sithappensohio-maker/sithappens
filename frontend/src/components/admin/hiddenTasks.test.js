/* A to-do the owner hid stays reachable: Today, the Action Center and the
 * Dashboard tile list it under "Hidden", and its Un-hide control calls the
 * existing restore endpoint. Mounted, not source-pinned.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ConfirmProvider } from "../../lib/useConfirm";
import HiddenTasks from "./HiddenTasks";
import TodaysBrainTile from "../TodaysBrainTile";

jest.mock("../../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn(), defaults: { baseURL: "/api" } },
  formatErr: (e) => String(e || ""),
}));

const { api } = require("../../lib/api");
global.IS_REACT_ACT_ENVIRONMENT = true;

const HIDDEN = {
  id: "booking-pending:2", kind: "booking_pending", priority: "warn", signature: "booking_pending:2026-10-06:2",
  title: "2 booking requests awaiting approval", subtitle: "Tap to open the Bookings queue",
};

let container; let root;
beforeEach(() => {
  jest.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const byTestId = (id) => container.querySelector(`[data-testid="${id}"]`);
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); };
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

test("a dismissed item is listed under Hidden and its Un-hide control calls the restore endpoint", async () => {
  api.post.mockResolvedValue({ data: { ok: true, removed: 1 } });
  const onRestored = jest.fn();
  await act(async () => { root.render(<HiddenTasks items={[HIDDEN]} onRestored={onRestored} />); });

  expect(byTestId("hidden-task-unhide-booking-pending:2")).toBeNull();
  await click(byTestId("hidden-tasks-toggle"));
  expect(container.textContent).toContain("2 booking requests awaiting approval");

  await click(byTestId("hidden-task-unhide-booking-pending:2"));
  await flush();
  expect(api.post).toHaveBeenCalledWith("/admin/today-brain/restore", { item_id: "booking-pending:2" });
  expect(onRestored).toHaveBeenCalledTimes(1);
});

test("nothing hidden renders no Hidden control at all", async () => {
  await act(async () => { root.render(<HiddenTasks items={[]} />); });
  expect(byTestId("hidden-tasks")).toBeNull();
});

test("the Dashboard tile offers Un-hide for a hidden item and restores it through the endpoint", async () => {
  api.get.mockResolvedValue({ data: { items: [], hidden: [HIDDEN], counts: { urgent: 0, warn: 0, info: 0, total: 0 }, generated_at: "" } });
  api.post.mockResolvedValue({ data: { ok: true, removed: 1 } });
  await act(async () => { root.render(<ConfirmProvider><TodaysBrainTile /></ConfirmProvider>); });
  await flush();

  await click(byTestId("hidden-tasks-toggle"));
  await click(byTestId("hidden-task-unhide-booking-pending:2"));
  await flush();
  expect(api.post).toHaveBeenCalledWith("/admin/today-brain/restore", { item_id: "booking-pending:2" });
  expect(api.get).toHaveBeenCalledWith("/admin/today-brain");
});
