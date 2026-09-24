/* "3 vaccine uploads awaiting approval" must lead somewhere you can approve.
 *
 * The alert's Open button navigated to the Today screen — the page it was
 * already on — so it did nothing visible, and opening the dog showed no way
 * to approve at all. Mounted, because both failures were behavioural.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import PendingVaccineUploads from "./PendingVaccineUploads";
import { runTodayBrainCTA } from "../lib/todayBrain";

jest.mock("../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn(), delete: jest.fn() }, formatErr: (e) => String(e || "") }));
jest.mock("sonner", () => ({ toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn(), info: jest.fn() }) }));
jest.mock("../lib/useConfirm", () => ({ useConfirm: () => () => Promise.resolve(true) }));

const { api } = require("../lib/api");
global.IS_REACT_ACT_ENVIRONMENT = true;

const UPLOADS = [
  { dog_id: "basil", dog_name: "Basil", vaccine: "rabies", expires_on: "2029-05-01", photo: "data:image/png;base64,AA" },
  { dog_id: "basil", dog_name: "Basil", vaccine: "dhpp", expires_on: "2028-02-01", photo: null },
  { dog_id: "rex", dog_name: "Rex", vaccine: "rabies", expires_on: "2028-01-01", photo: null },
];

const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });

async function mount(props) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(<PendingVaccineUploads dogId="basil" {...props} />); });
  await flush();
  const q = (id) => host.querySelector(`[data-testid="${id}"]`);
  return { host, q, cleanup: () => act(() => root.unmount()) };
}

beforeEach(() => {
  api.get.mockReset(); api.post.mockReset(); api.delete.mockReset();
  api.get.mockResolvedValue({ data: UPLOADS });
});

test("the dog's page lists only that dog's pending uploads, with Approve", async () => {
  const v = await mount();
  expect(v.q("dog-pending-vax")).toBeTruthy();
  expect(v.q("dog-pending-vax-rabies")).toBeTruthy();
  expect(v.q("dog-pending-vax-dhpp")).toBeTruthy();
  expect(v.q("dog-pending-vax").textContent).toMatch(/Waiting for your approval · 2/);
  await v.cleanup();
});

test("Approve calls the review endpoint and hands the approved date back to the form", async () => {
  api.post.mockResolvedValue({ data: { ok: true, expires_on: "2029-05-01" } });
  const onApproved = jest.fn(); const onChanged = jest.fn();
  const v = await mount({ onApproved, onChanged });
  await act(async () => { v.q("dog-pending-vax-approve-rabies").click(); });
  await flush();
  expect(api.post).toHaveBeenCalledWith("/admin/dogs/basil/vaccine-cert/rabies/review");
  expect(onApproved).toHaveBeenCalledWith("rabies", "2029-05-01");
  expect(onChanged).toHaveBeenCalledWith("rabies");
  expect(v.q("dog-pending-vax-rabies")).toBeNull();
  await v.cleanup();
});

test("Reject removes the upload", async () => {
  api.delete.mockResolvedValue({ data: { ok: true } });
  const v = await mount({ onChanged: jest.fn() });
  await act(async () => { v.q("dog-pending-vax-reject-dhpp").click(); });
  await flush();
  expect(api.delete).toHaveBeenCalledWith("/admin/dogs/basil/vaccine-cert/dhpp");
  expect(v.q("dog-pending-vax-dhpp")).toBeNull();
  await v.cleanup();
});

test("a list that fails to load says so instead of looking empty", async () => {
  api.get.mockRejectedValue(new Error("offline"));
  const v = await mount();
  expect(v.q("dog-pending-vax-failed")).toBeTruthy();
  await v.cleanup();
});

test("the alert's Open goes to Today and scrolls to the review box", async () => {
  jest.useFakeTimers();
  const onNavigate = jest.fn(); const onJumpToDog = jest.fn();
  const box = document.createElement("div");
  box.setAttribute("data-testid", "today-pending-vax-reviews");
  box.scrollIntoView = jest.fn();
  runTodayBrainCTA({ kind: "vaccine_upload_review", cta: { type: "open_screen", screen: "dashboard" } }, { onNavigate, onJumpToDog });
  expect(onNavigate).toHaveBeenCalledWith("today");
  expect(onJumpToDog).not.toHaveBeenCalled();
  // The box renders after navigation; the scroll waits for it.
  document.body.appendChild(box);
  jest.advanceTimersByTime(300);
  expect(box.scrollIntoView).toHaveBeenCalled();
  box.remove();
  jest.useRealTimers();
});
