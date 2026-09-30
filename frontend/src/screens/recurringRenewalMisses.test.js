/* Days a weekly schedule's renewal couldn't book reach the desk (audit #35).
 *
 * Mounted, not source-read: the Action Required card says which days, the
 * Recurring tab shows them on the schedule's row with "Followed up", the
 * card's link lands on that row, and Extend says which days it skipped and
 * why instead of guessing "already booked / capacity".
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import RecurringTemplates from "./RecurringTemplates";
import { PendingActionCard, PENDING_ACTION_TARGET_KEY } from "../components/PendingActionsPanel";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  formatErr: (e) => String(e || ""),
}));
jest.mock("../lib/useConfirm", () => ({ useConfirm: () => async () => true }));

const { api } = require("../lib/api");

global.IS_REACT_ACT_ENVIRONMENT = true;

const ITEM = {
  id: "recurring_renewal_missed:t1", type: "recurring_renewal_missed", type_label: "Weekly Schedule — Days Not Booked",
  urgency: "action_required", urgency_label: "Action Required", template_id: "t1",
  created_at: "2026-09-28T06:00:00+00:00", client_name: "Smith", dog_name: "Rosie", service_name: "Daycare",
  summary: "Rosie's weekly schedule couldn't book Oct 12 (full), Oct 14 (closed)", waiting_label: "2 days not booked",
  recorded_through: "2026-09-28T06:00:00+00:00", deep_link: { screen: "recurring", recurring_template_id: "t1" },
};
const TEMPLATES = [
  { id: "t1", label: "Rosie · M-F daycare", client_name: "Smith", dog_name: "Rosie", weekdays: [0, 1, 2, 3, 4], service_type: "daycare",
    default_horizon_weeks: 12, active: true, last_booked_through: "2026-12-20", auto_extend: true },
  { id: "t2", label: "Max · Tue training", client_name: "Jones", dog_name: "Max", weekdays: [1], service_type: "training",
    default_horizon_weeks: 12, active: true, last_booked_through: "2026-12-20", auto_extend: true },
];

let root, host;
const q = (sel) => host.querySelector(sel);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  api.get.mockReset();
  api.get.mockImplementation((url) => {
    if (url === "/recurring-templates") return Promise.resolve({ data: TEMPLATES });
    if (url === "/dogs" || url === "/services") return Promise.resolve({ data: [] });
    if (url === "/admin/pending-actions") return Promise.resolve({ data: { items: [ITEM] } });
    return Promise.resolve({ data: {} });
  });
  api.post.mockReset().mockResolvedValue({ data: { ok: true } });
  Element.prototype.scrollIntoView = jest.fn();
  sessionStorage.clear();
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

test("the Action Required card says which days and offers the schedule", async () => {
  await act(async () => { root.render(<PendingActionCard action={ITEM} onOpen={() => {}} testid="a" />); });
  expect(q('[data-testid="a-missed"]').textContent).toBe(ITEM.summary);
  expect(q('[data-testid="a-review"]').textContent).toContain("Open Schedule");
  expect(host.textContent).toContain("2 days not booked");
});

test("the schedule's row shows its missed days, and Followed up marks what was shown", async () => {
  const changed = jest.fn();
  window.addEventListener("sh:pending-actions-changed", changed);
  await act(async () => { root.render(<RecurringTemplates />); });
  await settle();
  expect(q('[data-testid="recurring-missed-t1"]').textContent).toContain("couldn't book Oct 12 (full)");
  expect(q('[data-testid="recurring-missed-t2"]')).toBeNull();
  await act(async () => { q('[data-testid="recurring-followed-up-t1"]').click(); });
  await settle();
  window.removeEventListener("sh:pending-actions-changed", changed);
  expect(api.post).toHaveBeenCalledWith("/recurring-templates/t1/followed-up", { through: ITEM.recorded_through });
  expect(changed).toHaveBeenCalled();
});

test("Open Schedule lands on that schedule's row", async () => {
  sessionStorage.setItem(PENDING_ACTION_TARGET_KEY, JSON.stringify({ screen: "recurring", recurring_template_id: "t1" }));
  await act(async () => { root.render(<RecurringTemplates />); });
  await settle();
  expect(q('[data-testid="recurring-row-t1"]').getAttribute("data-highlight")).toBe("true");
  expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  expect(sessionStorage.getItem(PENDING_ACTION_TARGET_KEY)).toBeNull();
});

test("Extend says which days it skipped and why", async () => {
  api.post.mockResolvedValue({ data: { created: 3, window: { to: "2027-01-03" }, skipped: [
    { date: "2026-12-25", reason: "Sit Happens is closed on Fri, Dec 25, 2026. Please pick another date.", block: { code: "closed_date" } },
    { date: "2026-12-30", reason: { code: "capacity_full", message: "Daycare is full on Wed, Dec 30, 2026. Please pick another date." } },
  ] } });
  await act(async () => { root.render(<RecurringTemplates />); });
  await settle();
  await act(async () => { q('[data-testid="extend-btn-t1"]').click(); });
  await settle();
  const toast = q('[data-testid="recurring-toast"]').textContent;
  expect(toast).toContain("Not booked:");
  expect(toast).toMatch(/Dec 25.*\(closed\)/);
  expect(toast).toMatch(/Dec 30.*\(full\)/);
  expect(toast).not.toContain("[object Object]");
  expect(toast).not.toContain("already booked / capacity");
});
