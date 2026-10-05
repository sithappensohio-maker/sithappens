/**
 * Audit #36 — archiving a family, and bringing it back.
 *
 * Mounted, not source-read: an archive the server refuses lists the visits in
 * the way, each with a way through (Cancel through the normal cancel window,
 * where to check a dog out, a plain note for a visit already paid for); the
 * list drops what has been dealt with but never archives on its own; "Show
 * archived" lists archived families with Restore; and the Recurring tab says
 * why a schedule is paused and offers Resume only once the family is back.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  formatErr: (x) => String(x || ""),
  invalidateSharedApiData: jest.fn(),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() } }));
jest.mock("../lib/useConfirm", () => ({ useConfirm: () => async () => true, usePromptDialog: () => async () => null, ConfirmProvider: ({ children }) => children }));
jest.mock("../components/BookingDetailModal", () => ({
  __esModule: true,
  default: function MockBookingDetail(props) {
    const React = require("react");
    return React.createElement("div", { "data-testid": "booking-detail-modal" },
      props.booking.id, React.createElement("button", { "data-testid": "booking-detail-close", onClick: props.onClose }, "x"));
  },
}));
jest.mock("../components/CheckoutModal", () => ({
  CancelBookingModal: function MockCancel(props) {
    const React = require("react");
    return React.createElement("div", { "data-testid": "cancel-modal" },
      props.booking.id, React.createElement("button", { "data-testid": "mock-cancel-done", onClick: props.onClose }, "done"));
  },
}));

const { api, invalidateSharedApiData } = require("../lib/api");
const { toast } = require("sonner");
const Clients = require("./Clients").default;
const RecurringTemplates = require("./RecurringTemplates").default;

global.IS_REACT_ACT_ENVIRONMENT = true;

const CLIENT = { id: "c1", name: "Sam Owner", email: "sam@example.com", phone: "", address: "", emerg: "", credits: 0,
  training_credits: 0, boarding_credits: 0, account_balance: 0, client_status: "active", dogs: [] };
const ARCHIVED = { id: "c9", name: "Gone Family", email: "g@example.com", deleted_at: "2026-09-01T10:00:00", archived_by_name: "Owner",
  dogs: [{ id: "d9", name: "Rex" }], credits: 0, training_credits: 0, boarding_credits: 0, client_status: "active" };
const BLOCK = {
  code: "archive_blocked", action: "check_out", total: 3,
  on_site: [{ id: "b-here", dog_name: "Rosie", service_type: "boarding", date: "2026-09-28", can_cancel: false }],
  upcoming: [
    { id: "b-soon", dog_name: "Rosie", service_name: "Daycare", date: "2026-10-05", status: "approved", can_cancel: true },
    { id: "b-paid", dog_name: "Rosie", service_name: "Basics", date: "2026-10-07", status: "approved", can_cancel: false, prepaid: true },
  ],
};

let container, root, bookingStatus;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  jest.clearAllMocks();
  bookingStatus = "approved";
  api.get.mockImplementation((path, cfg) => {
    if (path === "/clients/page") {
      return Promise.resolve({ data: cfg?.params?.archived ? { items: [ARCHIVED], total: 1 } : { items: [CLIENT], total: 1, page: 1, pages: 1 } });
    }
    if (String(path).startsWith("/bookings/")) return Promise.resolve({ data: { id: path.split("/")[2], status: bookingStatus, dog_name: "Rosie" } });
    if (String(path).startsWith("/communications")) return Promise.resolve({ data: { entries: [] } });
    return Promise.resolve({ data: [] });
  });
  api.post.mockResolvedValue({ data: { ok: true } });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const $ = (id) => document.querySelector(`[data-testid="${id}"]`);
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const click = async (el) => { await act(async () => { el.click(); }); await flush(); };

test("an archive the server refuses lists each visit with a way through, and never archives on its own", async () => {
  api.delete.mockRejectedValueOnce({ response: { status: 409, data: { detail: "The Sam Owner family can't be archived yet.", block: BLOCK } } });
  await act(async () => { root.render(<Clients can={() => true} />); });
  await flush();
  await click($("archive-client-c1"));
  expect(api.delete).toHaveBeenCalledWith("/clients/c1");
  expect($("archive-blockers-message").textContent).toContain("can't be archived yet");
  // A dog that is here: where to check it out, no Cancel.
  expect($("archive-blocker-b-here-how").textContent).toContain("Check Rosie out on Today");
  expect($("archive-blocker-b-here-cancel")).toBeNull();
  // A visit already paid for: said plainly, no Cancel that would be refused.
  expect($("archive-blocker-b-paid-how").textContent).toContain("Prepaid program session");
  expect($("archive-blocker-b-paid-cancel")).toBeNull();
  // A visit that can be cancelled: the normal cancel window, then the list drops it.
  await click($("archive-blocker-b-soon-cancel"));
  expect(api.get).toHaveBeenCalledWith("/bookings/b-soon");
  expect($("cancel-modal").textContent).toContain("b-soon");
  bookingStatus = "cancelled";
  await click($("mock-cancel-done"));
  expect($("archive-blockers")).not.toBeNull();
  expect($("archive-blocker-b-soon")).toBeNull();
  expect($("archive-blocker-b-here")).not.toBeNull();
  // Details opens the visit and comes back to the list.
  bookingStatus = "approved";
  await click($("archive-blocker-b-here-open"));
  expect($("booking-detail-modal").textContent).toContain("b-here");
  await click($("booking-detail-close"));
  expect($("archive-blocker-b-here")).not.toBeNull();
  expect(api.delete).toHaveBeenCalledTimes(1);   // nothing was archived behind staff's back
  expect(toast.error).not.toHaveBeenCalled();
});

test("Try archiving again retries the same archive and closes the list when it goes through", async () => {
  api.delete
    .mockRejectedValueOnce({ response: { status: 409, data: { detail: "blocked", block: BLOCK } } })
    .mockResolvedValueOnce({ data: { ok: true, soft_deleted: true } });
  await act(async () => { root.render(<Clients can={() => true} />); });
  await flush();
  await click($("archive-client-c1"));
  await click($("archive-blockers-retry"));
  expect(api.delete).toHaveBeenCalledTimes(2);
  expect($("archive-blockers")).toBeNull();
  expect(toast.success).toHaveBeenCalledWith("Sam Owner archived");
  expect(invalidateSharedApiData).toHaveBeenCalledWith(["clients", "dogs", "navCounts"]);
});

test("any other failure is said out loud, not swallowed", async () => {
  api.delete.mockRejectedValueOnce({ response: { status: 403, data: { detail: "Missing permission: delete_records" } } });
  await act(async () => { root.render(<Clients can={() => true} />); });
  await flush();
  await click($("archive-client-c1"));
  expect($("archive-blockers")).toBeNull();
  expect(toast.error).toHaveBeenCalledWith("Missing permission: delete_records");
});

test("Show archived lists archived families with the dogs Restore brings back, and Restore restores", async () => {
  api.post.mockResolvedValueOnce({ data: { ok: true, restored_dogs: ["Rex"], paused_schedules: 2, still_removed: [] } });
  await act(async () => { root.render(<Clients can={() => true} />); });
  await flush();
  await click($("client-show-archived"));
  expect(api.get).toHaveBeenCalledWith("/clients/page", { params: { q: "", page: 1, page_size: 100, archived: true } });
  expect($("client-grid").className).toContain("hidden");
  expect($("archived-client-badge-c9").textContent).toContain("09/01/2026");
  expect($("archived-client-badge-c9").textContent).toContain("by Owner");
  expect($("archived-client-card-c9").textContent).toContain("Rex");
  expect($("archived-client-more")).toBeNull();
  await click($("restore-client-c9"));
  expect(api.post).toHaveBeenCalledWith("/clients/c9/restore");
  expect(toast.success.mock.calls[0][0]).toContain("2 weekly schedules still paused");
});

test("Show archived says when older families are beyond the newest page", async () => {
  api.get.mockImplementation((path, cfg) => {
    if (path === "/clients/page") {
      return Promise.resolve({ data: cfg?.params?.archived ? { items: [ARCHIVED], total: 150 } : { items: [CLIENT], total: 1, page: 1, pages: 1 } });
    }
    if (String(path).startsWith("/communications")) return Promise.resolve({ data: { entries: [] } });
    return Promise.resolve({ data: [] });
  });
  await act(async () => { root.render(<Clients can={() => true} />); });
  await flush();
  await click($("client-show-archived"));
  expect($("archived-client-more").textContent).toContain("1 of 150");
});

test("the Recurring tab says why a schedule is paused, and offers Resume only once the family is back", async () => {
  const rows = [
    { id: "t1", label: "Rex · M/W/F", client_name: "Gone Family", weekdays: [0], service_type: "daycare", default_horizon_weeks: 12,
      active: false, paused_reason: "family_archived", paused_at: "2026-09-01T10:00:00", family_archived: true, dog_removed: true },
    { id: "t2", label: "Max · Tue", client_name: "Back Family", weekdays: [1], service_type: "daycare", default_horizon_weeks: 12,
      active: false, paused_reason: "family_archived", paused_at: "2026-09-01T10:00:00", family_archived: false, dog_removed: false,
      last_booked_through: "2026-09-20", auto_extend: false },
  ];
  api.get.mockImplementation((path) => {
    if (path === "/recurring-templates") return Promise.resolve({ data: rows });
    if (path === "/admin/pending-actions") return Promise.resolve({ data: { items: [] } });
    return Promise.resolve({ data: [] });
  });
  await act(async () => { root.render(<RecurringTemplates />); });
  await flush();
  expect($("recurring-paused-t1").textContent).toContain("Restore the family first");
  expect($("recurring-resume-t1")).toBeNull();
  expect($("recurring-paused-t2").textContent).toContain("09/01/2026");
  expect($("recurring-paused-t2").textContent).toContain("Resume when they're ready");
  await click($("recurring-resume-t2"));
  expect(api.post).toHaveBeenCalledWith("/recurring-templates/t2/resume");
  expect($("recurring-toast").textContent).toContain("won't renew on its own");   // manual-extend-only: never promised
});
