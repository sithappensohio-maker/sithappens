// Low-priority polish: the Employees roster had no search/filter box,
// unlike every other roster screen in the app. This mounts the real Staff
// screen (not a source-pinned regex) so a crash or a dropped row shows up.
import { act } from "react";
import { createRoot } from "react-dom/client";
import Staff from "./Staff";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  formatErr: (x) => String(x || ""),
}));
jest.mock("../lib/auth", () => ({ useAuth: jest.fn() }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../lib/useConfirm", () => ({
  useConfirm: () => async () => true,
  ConfirmProvider: ({ children }) => children,
}));

const { api } = require("../lib/api");
const { useAuth } = require("../lib/auth");

global.IS_REACT_ACT_ENVIRONMENT = true;

const EMPLOYEES = [
  { id: "e1", name: "Alice Baker", role: "front_desk", active: true, is_owner: false, email: "alice@example.com", phone: "555-1111", hourly_rate: 15, last_login_at: null },
  { id: "e2", name: "Bob Carter", role: "front_desk", active: true, is_owner: false, email: "bob@example.com", phone: "555-2222", hourly_rate: 16, last_login_at: null },
  { id: "e3", name: "Carla Diaz", role: "trainer", active: true, is_owner: false, email: "carla@example.com", phone: "555-3333", hourly_rate: 17, last_login_at: null },
];

let container, root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  useAuth.mockReturnValue({ isOwner: () => true, can: () => true });
  api.get.mockReset();
  api.get.mockImplementation((path) => {
    const byPath = {
      "/admin/employees": EMPLOYEES,
      "/admin/staff/pay-snapshot": { totals: { this_week_gross: 0, this_week_hours: 0, currently_clocked_in: 0, week_start: "2026-10-05" }, snapshot: [] },
      "/staff/roles": { roles: ["owner", "manager", "trainer", "daycare_staff", "boarding_staff", "front_desk", "read_only"], permissions: {} },
    };
    if (path in byPath) return Promise.resolve({ data: byPath[path] });
    return Promise.resolve({ data: {} });
  });
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  container.remove();
});

async function mountStaff() {
  root = createRoot(container);
  await act(async () => { root.render(<Staff />); });
}

const rowNames = () => [...container.querySelectorAll('[data-testid^="staff-row-"] p.text-base')]
  .map((p) => p.textContent.trim());

async function goToEmployeesTab() {
  const tab = container.querySelector('[data-testid="staff-subtab-employees"]');
  await act(async () => { tab.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}

test("the Employees roster has a name search box that filters the already-loaded list", async () => {
  await mountStaff();
  await goToEmployeesTab();

  // All three employees show before any filter is typed.
  expect(rowNames().length).toBe(3);

  const search = container.querySelector('[data-testid="staff-employee-search"]');
  expect(search).not.toBeNull();

  const setValue = (el, value) => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };

  await act(async () => { setValue(search, "ali"); });
  const afterFilter = rowNames();
  expect(afterFilter.length).toBe(1);
  expect(afterFilter[0]).toMatch(/Alice Baker/);

  // Case-insensitive.
  await act(async () => { setValue(search, "CARTER"); });
  const afterCaseInsensitive = rowNames();
  expect(afterCaseInsensitive.length).toBe(1);
  expect(afterCaseInsensitive[0]).toMatch(/Bob Carter/);

  // Clearing the box restores the full roster.
  await act(async () => { setValue(search, ""); });
  expect(rowNames().length).toBe(3);
});
