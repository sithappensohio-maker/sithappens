/**
 * Audit #9 — End of Day covers the whole day. Mounted, not source-pinned:
 * a boarding dog due out (or overdue) is shown as a blocker with why, Board
 * & Train stayovers are labelled, and a day with a blocker is never "All clear".
 */
import { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn() },
  formatErr: (e) => (typeof e === "string" ? e : e ? JSON.stringify(e) : ""),
}));
jest.mock("sonner", () => ({ toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn(), info: jest.fn() }) }));

const { api } = require("../lib/api");
const { EndOfDayPanel } = require("./OwnerClockAndEndOfDay");

global.IS_REACT_ACT_ENVIRONMENT = true;

let container; let root;
beforeEach(() => {
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  api.get.mockReset(); api.post.mockReset();
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await flush(); };

const BASE = {
  date: "2026-09-26",
  register: { drawer_session: { opening_cash: 100 }, totals: { expected_cash: 100 }, incoming_by_method: {} },
  staff_readiness: {},
  boarding_stayovers: [], still_on_premises: [], unpaid_bookings: [], missing_report_cards: [],
  revenue_cash: 0, completed_count: 0, care_log_totals: { feedings: 0, medications: 0, pee: 0, poop: 0 },
  all_clear: true, hard_clear: true,
};

test("a boarding dog due out today is a blocker, with why", async () => {
  api.get.mockResolvedValue({ data: { ...BASE, all_clear: false, hard_clear: false,
    still_on_premises: [
      { booking_id: "b-due", dog_name: "Biscuit", client_name: "Dana", service_type: "boarding", kennel: "Suite 2", reason: "due_out", note: "Due out today" },
      { booking_id: "b-late", dog_name: "Olive", client_name: "Sam", service_type: "daycare", kennel: "", reason: "overdue", days_late: 1, note: "Still checked in — visit was Thu, Sep 25, 2026 (1 day ago)" },
    ],
    unpaid_bookings: [{ booking_id: "b-paid", dog_name: "Pep", client_name: "Lee", service_type: "boarding", amount: 280 }],
  } });
  act(() => root.render(<EndOfDayPanel />)); await flush();
  expect(q("end-of-day-btn").textContent).toContain("Finish the day");
  await click(q("end-of-day-btn"));
  expect(q("eod-all-clear")).toBeNull();
  expect(q("eod-onsite-note-b-due").textContent).toBe("Due out today");
  expect(q("eod-onsite-note-b-late").textContent).toContain("1 day ago");
  expect(container.textContent).toContain("$280.00");
  expect(container.textContent).toContain("Paid at checkout");
});

test("stayovers don't block and Board & Train is labelled", async () => {
  api.get.mockResolvedValue({ data: { ...BASE,
    boarding_stayovers: [
      { booking_id: "s-1", dog_name: "Moose", client_name: "Kim", end_date: "2026-09-28", stay_kind: "boarding", reason: "stayover", note: "Checks out Mon, Sep 28, 2026" },
      { booking_id: "s-2", dog_name: "Juno", client_name: "Ari", end_date: "2026-10-10", stay_kind: "board_train", reason: "stayover", note: "Checks out Sat, Oct 10, 2026" },
    ] } });
  act(() => root.render(<EndOfDayPanel />)); await flush();
  expect(q("end-of-day-btn").textContent).toContain("Ready to close");
  await click(q("end-of-day-btn"));
  expect(q("eod-all-clear")).not.toBeNull();
  expect(container.textContent).toContain("Checks out Mon, Sep 28, 2026");
  expect(container.textContent).toContain("Board & Train · Checks out Sat, Oct 10, 2026");
});

test("rows from an older server without notes still render", async () => {
  api.get.mockResolvedValue({ data: { ...BASE, all_clear: false,
    boarding_stayovers: [{ booking_id: "o-1", dog_name: "Rex", client_name: "Bo", end_date: "2026-09-27" }],
    still_on_premises: [{ booking_id: "o-2", dog_name: "Zed", client_name: "Cy", service_type: "daycare", kennel: "" }] } });
  act(() => root.render(<EndOfDayPanel />)); await flush();
  await click(q("end-of-day-btn"));
  expect(container.textContent).toContain("checkout 2026-09-27");
  expect(q("eod-onsite-note-o-2")).toBeNull();
  expect(container.textContent).toContain("Zed");
});
