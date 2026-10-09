/**
 * Per-employee permission overrides — the owner can grant ONE specific
 * employee an extra permission beyond their role's default (e.g. a
 * daycare_staff worker who should ALSO get Front Desk's sell_credits)
 * without moving their whole role. Mounted, not source-pinned.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import RolesPanel from "./RolesPanel";
import { api } from "../lib/api";
import { toast } from "sonner";

let mockIsOwner = () => true;
jest.mock("../lib/auth", () => ({ useAuth: () => ({ isOwner: () => mockIsOwner() }) }));
jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), put: jest.fn() },
  formatErr: (e) => String(e || ""),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

global.IS_REACT_ACT_ENVIRONMENT = true;

// Real default permissions for daycare_staff (backend/server.py
// ROLE_PERMISSIONS["daycare_staff"]) — take_payments is True by default, so
// the test grants sell_credits (False by default) as the meaningful "extra".
const MATRIX = {
  roles: ["owner", "manager", "trainer", "daycare_staff", "boarding_staff", "front_desk", "read_only"],
  permission_keys: ["clients_view", "dogs_view", "incidents", "care_complete", "booking_edit", "messages", "take_payments", "sell_credits", "manage_events", "clients_edit"],
  matrix: {
    daycare_staff: {
      clients_view: true, dogs_view: true, incidents: true, care_complete: true,
      booking_edit: true, messages: true, take_payments: true, sell_credits: false,
      manage_events: true, clients_edit: false,
    },
  },
  defaults: {},
  overrides: {},
};

const PLAIN_EMP = { id: "e1", display_name: "Dana Daycare", name: "Dana Daycare", email: "dana@example.com", staff_role: "daycare_staff", is_owner: false, permission_overrides: {} };
const OVERRIDDEN_EMP = { id: "e2", display_name: "Opal Overridden", name: "Opal Overridden", email: "opal@example.com", staff_role: "daycare_staff", is_owner: false, permission_overrides: { sell_credits: true } };

let container, root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  mockIsOwner = () => true;
  api.get.mockReset();
  api.put.mockReset();
  api.put.mockResolvedValue({ data: {} });
  toast.success.mockReset();
  toast.error.mockReset();
});
afterEach(() => { act(() => root?.unmount()); container.remove(); root = null; });

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const q = (id) => container.querySelector(`[data-testid="${id}"]`);

function mockEmployees(list) {
  api.get.mockImplementation((path) => {
    if (path === "/staff/roles") return mockIsOwner() ? Promise.resolve({ data: MATRIX }) : Promise.reject({ response: { status: 403 } });
    if (path === "/admin/employees") return Promise.resolve({ data: list });
    return Promise.resolve({ data: {} });
  });
}

async function mountPanel() {
  root = createRoot(container);
  await act(async () => { root.render(<RolesPanel />); });
  await flush();
}

test("non-owner viewer gets no Extra permissions toggle at all", async () => {
  mockIsOwner = () => false;
  mockEmployees([PLAIN_EMP]);
  await mountPanel();
  expect(q(`role-readonly-${PLAIN_EMP.id}`)).not.toBeNull();
  expect(q(`toggle-overrides-${PLAIN_EMP.id}`)).toBeNull();
});

test("clicking Extra permissions expands the panel; clicking again collapses it", async () => {
  mockEmployees([PLAIN_EMP]);
  await mountPanel();

  const toggle = q(`toggle-overrides-${PLAIN_EMP.id}`);
  expect(toggle).not.toBeNull();
  expect(toggle.textContent).toBe("Extra permissions");
  expect(q(`overrides-panel-${PLAIN_EMP.id}`)).toBeNull();

  await act(async () => { toggle.click(); });
  expect(q(`overrides-panel-${PLAIN_EMP.id}`)).not.toBeNull();
  expect(q(`override-${PLAIN_EMP.id}-sell_credits`)).not.toBeNull();

  await act(async () => { q(`toggle-overrides-${PLAIN_EMP.id}`).click(); });
  expect(q(`overrides-panel-${PLAIN_EMP.id}`)).toBeNull();
});

test("checking a box the role denies by default grants it as an override", async () => {
  mockEmployees([PLAIN_EMP]);
  await mountPanel();
  await act(async () => { q(`toggle-overrides-${PLAIN_EMP.id}`).click(); });

  const box = q(`override-${PLAIN_EMP.id}-sell_credits`).querySelector("input");
  expect(box.checked).toBe(false);

  await act(async () => { box.click(); }); // real checkbox: click flips checked + fires change

  expect(api.put).toHaveBeenCalled();
  const calls = api.put.mock.calls.filter(c => c[0] === `/staff/${PLAIN_EMP.id}/permission-overrides`);
  expect(calls.length).toBeGreaterThan(0);
  const body = calls[calls.length - 1][1];
  expect(body.overrides.sell_credits).toBe(true);
  expect(toast.success).toHaveBeenCalledWith("Permission updated");
});

test("an already-overridden box renders checked + marked, and unchecking back to the default drops it from overrides", async () => {
  mockEmployees([OVERRIDDEN_EMP]);
  await mountPanel();

  const extraLabel = q(`toggle-overrides-${OVERRIDDEN_EMP.id}`);
  expect(extraLabel.textContent).toBe("1 extra");

  await act(async () => { extraLabel.click(); });
  const row = q(`override-${OVERRIDDEN_EMP.id}-sell_credits`);
  const box = row.querySelector("input");
  expect(box.checked).toBe(true);
  expect(row.textContent).toContain("custom");

  await act(async () => { box.click(); });

  const calls = api.put.mock.calls.filter(c => c[0] === `/staff/${OVERRIDDEN_EMP.id}/permission-overrides`);
  expect(calls.length).toBeGreaterThan(0);
  const body = calls[calls.length - 1][1];
  expect(Object.prototype.hasOwnProperty.call(body.overrides, "sell_credits")).toBe(false);
});

test("Reset to role defaults only shows with existing overrides, and clears them all", async () => {
  mockEmployees([PLAIN_EMP]);
  await mountPanel();
  await act(async () => { q(`toggle-overrides-${PLAIN_EMP.id}`).click(); });
  expect(q(`reset-overrides-${PLAIN_EMP.id}`)).toBeNull();
  await act(async () => { root.unmount(); });

  mockEmployees([OVERRIDDEN_EMP]);
  root = createRoot(container);
  await act(async () => { root.render(<RolesPanel />); });
  await flush();
  await act(async () => { q(`toggle-overrides-${OVERRIDDEN_EMP.id}`).click(); });

  const resetBtn = q(`reset-overrides-${OVERRIDDEN_EMP.id}`);
  expect(resetBtn).not.toBeNull();
  await act(async () => { resetBtn.click(); });

  const calls = api.put.mock.calls.filter(c => c[0] === `/staff/${OVERRIDDEN_EMP.id}/permission-overrides`);
  expect(calls.length).toBeGreaterThan(0);
  expect(calls[calls.length - 1][1]).toEqual({ overrides: {} });
  expect(toast.success).toHaveBeenCalledWith("Reset to role defaults");
});
