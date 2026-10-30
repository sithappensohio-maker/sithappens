/* Settings → Feature Visibility, Online School off: the card says what
 * Remove Online School will take (and what stays) before it does it, and
 * says so plainly once nothing is left. Mounted with the real confirm dialog.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { ConfirmProvider } from "../lib/useConfirm";
import OnlineSchoolRemovalCard from "./OnlineSchoolRemovalCard";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn() },
  formatErr: (d) => (typeof d === "string" ? d : ""),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const { api } = require("../lib/api");
const { toast } = require("sonner");
global.IS_REACT_ACT_ENVIRONMENT = true;

const PREVIEW = {
  enrollments: 4, dogs: 3, clients: 2, active: 1, files: 5, records: 60,
  courses_to_delete: [{ id: "c1", name: "Puppy Foundations Online" }],
  courses_to_convert: [{ id: "c2", name: "Leash Skills" }],
  warnings: ["Rex finished Leash Skills online, which another program needs first."],
};
const EMPTY = { enrollments: 0, dogs: 0, clients: 0, active: 0, files: 0, records: 0,
                courses_to_delete: [], courses_to_convert: [], warnings: [] };

let container; let root;
beforeEach(() => {
  api.get.mockReset(); api.post.mockReset(); toast.success.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const q = (id) => document.querySelector(`[data-testid="${id}"]`);
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const mount = async () => {
  await act(async () => { root.render(<ConfirmProvider><OnlineSchoolRemovalCard/></ConfirmProvider>); });
  await flush();
};

test("it says what goes, what is kept for in-person, and what stays", async () => {
  api.get.mockResolvedValue({ data: PREVIEW });
  await mount();
  const summary = q("os-removal-summary").textContent;
  expect(summary).toContain("4 online or hybrid enrollments (3 dogs, 2 clients)");
  expect(summary).toContain("1 still in progress");
  expect(summary).toContain("Courses deleted: Puppy Foundations Online");
  expect(summary).toContain("online settings switched off: Leash Skills");
  expect(summary).toContain("5 uploaded videos and photos");
  expect(q("os-removal-warnings").textContent).toContain("Rex finished Leash Skills online");
  expect(q("os-removal-card").textContent).toContain("every sale, payment, refund and tax record");
});

test("removing asks first, sends the confirmation, and then shows nothing is left", async () => {
  api.get.mockResolvedValueOnce({ data: PREVIEW }).mockResolvedValueOnce({ data: EMPTY });
  api.post.mockResolvedValue({ data: PREVIEW });
  await mount();
  await act(async () => { q("os-removal-go").click(); });
  expect(api.post).not.toHaveBeenCalled();   // the confirm dialog is up
  const yes = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Remove it");
  expect(yes).toBeTruthy();
  await act(async () => { yes.click(); });
  await flush();
  expect(api.post).toHaveBeenCalledWith("/admin/online-school/removal", { confirm: true });
  expect(toast.success).toHaveBeenCalledWith("Online School removed: 4 enrollments, 1 course deleted.");
  expect(q("os-removal-done").textContent).toContain("Nothing is left from Online School");
});

test("while something is still open it says what to finish, and Remove is not offered as possible", async () => {
  api.get.mockResolvedValue({ data: { ...PREVIEW, blockers: ["1 Board & Train stay still open. Check it out first."] } });
  await mount();
  expect(q("os-removal-blockers").textContent).toContain("Board & Train stay still open");
  expect(q("os-removal-go").disabled).toBe(true);
});

test("the server's refusal is shown in its own words", async () => {
  api.get.mockResolvedValue({ data: PREVIEW });
  api.post.mockRejectedValue({ response: { status: 403, data: { detail: "Removing training history needs the Delete records permission." } } });
  await mount();
  await act(async () => { q("os-removal-go").click(); });
  await act(async () => { [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Remove it").click(); });
  await flush();
  expect(q("os-removal-error").textContent).toContain("needs the Delete records permission");
});
