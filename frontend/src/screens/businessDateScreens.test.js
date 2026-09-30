/**
 * Staff screens use Ohio's date for "today" (audit #47). At 9:30 PM Eastern
 * the UTC date is already tomorrow; the server's roster is still today's.
 * Mounted, not source-pinned; the clock is frozen at 2026-10-01T01:30:00Z
 * (Sep 30, 9:30 PM in Ohio).
 */
import { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() }, formatErr: (d) => String(d || "") }));
jest.mock("../lib/useLiveRefresh", () => ({ useLiveRefresh: jest.fn() }));
jest.mock("../lib/registerBus", () => ({ onRegisterChanged: () => () => {} }));
jest.mock("../lib/todayBrain", () => ({ runTodayBrainCTA: jest.fn() }));
jest.mock("../lib/recentlyOpened", () => ({ visibleRecents: () => [] }));
jest.mock("../lib/auth", () => ({ useAuth: () => ({ can: () => true }) }));
jest.mock("../lib/useConfirm", () => ({ useConfirm: () => jest.fn(() => Promise.resolve(true)) }));
jest.mock("../lib/usePullToRefresh", () => ({ __esModule: true, default: () => ({ pulling: false, progress: 0 }), RefreshSpinner: () => null }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../components/TodayOperations", () => () => null);
jest.mock("../components/TodayEventsCard", () => () => null);
jest.mock("../components/RescheduleRequestsInbox", () => () => null);
jest.mock("../components/AdminBookingModal", () => () => null);
jest.mock("../components/BookingDetailModal", () => () => null);

const { api } = require("../lib/api");
const Today = require("./Today").default;
const Bookings = require("./Bookings").default;

global.IS_REACT_ACT_ENVIRONMENT = true;

let container, root;
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-10-01T01:30:00Z"));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); jest.useRealTimers(); });

const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });
const q = (id) => container.querySelector(`[data-testid="${id}"]`);

// Tonight's booking: dated Sep 30 (Ohio's today), not checked in yet.
const TONIGHT = { id: "b1", dog_name: "Pip", client_name: "Rivera", service_type: "daycare",
                  date: "2026-09-30", status: "approved", dropoff_time: "19:00", pickup_time: "21:45" };

test("Today counts today's arrivals and pickups after 8 PM Eastern", async () => {
  api.get.mockImplementation((url) => Promise.resolve({
    data: String(url).includes("/dashboard/stats") ? { today_roster: [TONIGHT], amount_due_today: 0 } : null }));
  await act(async () => { root.render(<Today can={() => true} />); });
  await flush();
  expect(q("today-stat-arriving").textContent).toContain("1");
  expect(q("today-stat-leaving").textContent).toContain("1");
  expect(q("today-page-hero").textContent).toContain("Wednesday, September 30");   // the headline date too
});

test("Bookings keeps today's booking in the upcoming list after 8 PM Eastern", async () => {
  api.get.mockImplementation((url) => {
    if (url === "/bookings") return Promise.resolve({ data: [TONIGHT] });
    return Promise.reject(new Error("not needed"));
  });
  await act(async () => { root.render(<Bookings />); });
  await flush();
  expect(q("bookings-screen").textContent).toContain("1 upcoming");
  expect(q("show-history-btn")).toBeNull();
});
