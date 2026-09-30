/* A dog nobody checked out after its stay is still on the Kennel Board, and
 * the card says so (audit #46). Mounted. */
import { act } from "react";
import { createRoot } from "react-dom/client";

const card = (over) => ({
  booking_id: "b1", dog_id: "d1", dog_name: "Rex", client_name: "Dana", service_type: "daycare", status: "approved",
  kennel: "", room: "", crate: "", yard_group: "", training_group: "", dropoff_time: "", pickup_time: "",
  end_date: "2026-09-29", safety_flags: [], warnings: { missed_checkout: true }, ...over,
});
let mockBoard;
jest.mock("../lib/api", () => ({
  api: { get: jest.fn((url) => Promise.resolve({ data: url === "/kennel-board" ? mockBoard : {} })), patch: jest.fn() },
  formatErr: (e) => String(e || ""),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../components/PageHero", () => () => null);
jest.mock("../components/Avatar", () => () => null);

const KennelBoard = require("./KennelBoard").default;
global.IS_REACT_ACT_ENVIRONMENT = true;

let container; let root;
beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

async function mount() {
  await act(async () => { root.render(<KennelBoard />); });
  await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
}

test("a missed checkout is on the board and says the stay has ended", async () => {
  mockBoard = { date: "2026-09-30", summary: { daycare: 2 }, on_site_count: 2,
    groups: { daycare: [card({}), card({ booking_id: "b2", dog_name: "Luna", warnings: { missed_checkout: false } })] } };
  await mount();
  const flag = container.querySelector('[data-testid="warn-missed-checkout-b1"]');
  expect(flag).not.toBeNull();
  expect(flag.textContent).toMatch(/Missed checkout — stay ended 2026-09-29/);
  expect(container.querySelector('[data-testid="warn-missed-checkout-b2"]')).toBeNull();
});
