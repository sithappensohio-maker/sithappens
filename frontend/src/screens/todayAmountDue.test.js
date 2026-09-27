/**
 * Today's "Amount Due" is what today's visits still owe on their bills — the
 * server's number (audit #18). A visit put on the tab and paid later keeps
 * its own stored balance_due, so adding those up showed paid money as owed.
 * Mounted, not source-pinned.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock("../lib/useLiveRefresh", () => ({ useLiveRefresh: jest.fn() }));
jest.mock("../lib/registerBus", () => ({ onRegisterChanged: () => () => {} }));
jest.mock("../lib/todayBrain", () => ({ runTodayBrainCTA: jest.fn() }));
jest.mock("../lib/recentlyOpened", () => ({ visibleRecents: () => [] }));
jest.mock("../components/TodayOperations", () => () => null);
jest.mock("../components/TodayEventsCard", () => () => null);

const { api } = require("../lib/api");
const Today = require("./Today").default;

global.IS_REACT_ACT_ENVIRONMENT = true;

let container, root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });

async function mountWith(stats) {
  api.get.mockImplementation((url) => Promise.resolve({ data: String(url).includes("/dashboard/stats") ? stats : null }));
  await act(async () => { root.render(<Today can={() => true} />); });
  await flush();
  return container.querySelector('[data-testid="today-stat-amount-due"]');
}

const PAID_LATER = {
  id: "b1", dog_name: "Pip", client_name: "Rivera", service_type: "daycare", date: "2026-09-27",
  checked_in_at: "2026-09-27T12:00:00Z", checked_out_at: "2026-09-27T16:00:00Z", status: "completed",
  payment_status: "paid_partial", balance_due: 40,
};

test("a visit whose bill was paid after checkout is not counted as owed", async () => {
  const card = await mountWith({ today_roster: [PAID_LATER], amount_due_today: 0 });
  expect(card).toBeTruthy();
  expect(card.textContent).toContain("$0.00");
  expect(card.textContent).not.toContain("$40.00");
});

test("what is still owed today shows as the amount due", async () => {
  const card = await mountWith({ today_roster: [PAID_LATER], amount_due_today: 55.5 });
  expect(card.textContent).toContain("$55.50");
});
