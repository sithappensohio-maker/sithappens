/**
 * Item 56 — the business mileage rate is a per-tax-year IRS table on the
 * server, not an owner setting. The Day-to-Day finance controls no longer
 * offer a single rate that the deduction ignores. Mounted, not source-pinned.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import DayToDayControls from "./DayToDayControls";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(() => Promise.resolve({ data: [] })), post: jest.fn(), put: jest.fn(), delete: jest.fn(),
         defaults: { baseURL: "/api" } },
  formatErr: (e) => String(e || ""),
}));
jest.mock("../lib/auth", () => ({ useAuth: () => ({ can: () => true, user: { role: "admin" } }) }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
global.IS_REACT_ACT_ENVIRONMENT = true;

let container, root;
beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); });
afterEach(() => { act(() => root?.unmount()); container.remove(); root = null; });
const mount = (el) => act(() => { root = createRoot(container); root.render(el); });
const byTestId = (id) => document.querySelector(`[data-testid="${id}"]`);

const stored = { finance: { fiscal_year_start_month: 1, mileage_rate_per_mile: 0.99 } };

test("the Finance section has no business mileage rate input", () => {
  mount(<DayToDayControls section="finance" setD2d={jest.fn()} d2d={stored} />);
  expect(byTestId("d2d-fy")).not.toBeNull();
  expect(byTestId("d2d-mileage")).toBeNull();
  expect(container.textContent).not.toContain("Business mileage rate");
});

test("the Finance Defaults card does not show a mileage rate", () => {
  mount(<DayToDayControls d2d={stored} setD2d={jest.fn()} />);
  expect(container.textContent).toContain("Finance Defaults");
  expect(container.textContent).not.toContain("Mileage rate");
  expect(container.textContent).not.toContain("$0.99/mi");
});
