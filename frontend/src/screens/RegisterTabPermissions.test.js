/**
 * Real-RegisterTab render test: the front_desk role gets exactly its
 * permitted operational tools (Sell Credits + Record Payment), never a dead
 * or finance-only tab — while admin keeps the full strip. Companion to
 * PosNavigation.test.js (which mocks RegisterTab for the Pos-level tests).
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { RegisterTab } from "./Staff";

jest.mock("../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() }, formatErr: (x) => String(x || "") }));
jest.mock("../lib/auth", () => ({ useAuth: jest.fn() }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../lib/useConfirm", () => ({ useConfirm: () => async () => true, ConfirmProvider: ({ children }) => children }));

const { api } = require("../lib/api");
const { useAuth } = require("../lib/auth");

global.IS_REACT_ACT_ENVIRONMENT = true;

const FRONT_DESK_PERMS = ["take_payments", "sell_credits", "clients_view", "clients_edit", "dogs_view", "dogs_edit", "booking_edit", "messages"];

let container, root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset();
  api.get.mockImplementation((path) => {
    const byPath = {
      "/clients": [],
      "/credit-packs": [],
      "/expenses": [],
      "/expenses/categories": { categories: [] },
      "/admin/register/day": { totals: { expected_cash: 100 }, activity: [], register_closed: false, incoming_by_method: {}, incoming_sources: {} },
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

async function mountTab() {
  root = createRoot(container);
  await act(async () => { root.render(<RegisterTab excludeTabs={["sale"]} />); });
}
const tabIds = () => [...container.querySelectorAll('[data-testid^="register-mode-"]')]
  .map((b) => b.getAttribute("data-testid").replace("register-mode-", ""));

test("front_desk sees exactly its allowed operational tools", async () => {
  useAuth.mockReturnValue({ can: (k) => FRONT_DESK_PERMS.includes(k) });
  await mountTab();
  expect(tabIds()).toEqual(["pack", "payment"]);
  // The finance day summary is never requested for this role.
  expect(api.get.mock.calls.map(([p]) => p)).not.toContain("/admin/register/day");
});

test("admin keeps the full Register Tools strip (minus the excluded sale tab)", async () => {
  useAuth.mockReturnValue({ can: () => true });
  await mountTab();
  const ids = tabIds();
  expect(ids).toContain("overview");
  expect(ids).toContain("pack");
  expect(ids).toContain("payment");
  expect(ids).toContain("refund");
  expect(ids).toContain("closeout");
  expect(ids).toContain("reports");
  expect(ids).not.toContain("sale"); // excluded by the embedding screen
});
