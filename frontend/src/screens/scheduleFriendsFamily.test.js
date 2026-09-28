/**
 * The calendar's day list and friends & family bookings (owner request
 * 2026-09-28): a friend's dog says who pays for it, and never shows its own
 * family's prepaid credits (a friends & family visit goes on the paying
 * family's one bill). Mounted, with FullCalendar replaced by a stub.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";

let mockCal = {};
jest.mock("@fullcalendar/react", () => {
  const React = require("react");
  return { __esModule: true, default: React.forwardRef((props, _ref) => { mockCal = props; return null; }) };
});
jest.mock("@fullcalendar/daygrid", () => ({}));
jest.mock("@fullcalendar/list", () => ({}));
jest.mock("@fullcalendar/interaction", () => ({}));
jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), put: jest.fn(), post: jest.fn() },
  formatErr: (e) => (typeof e === "string" ? e : ""),
}));
jest.mock("../lib/useLiveRefresh", () => ({ useLiveRefresh: () => {} }));
jest.mock("../components/PageHero", () => (p) => p.right || null);
let mockDetail = {};
jest.mock("../components/BookingDetailModal", () => (props) => { mockDetail = props; return null; });

const { api } = require("../lib/api");
const Schedule = require("./Schedule").default;

global.IS_REACT_ACT_ENVIRONMENT = true;

const FF = { service_type: "daycare", group_id: "g1", bill_to_client_id: "c-pat", bill_to_client_name: "Pat", group_kind: "friends_family" };
const EVENTS = [
  { id: "rex", title: "Rex (daycare)", start: "2026-10-06", end: "2026-10-07",
    extendedProps: { ...FF, client_id: "c-sam", client_name: "Sam", dog_name: "Rex" } },
  { id: "luna", title: "Luna (daycare)", start: "2026-10-06", end: "2026-10-07",
    extendedProps: { ...FF, client_id: "c-pat", client_name: "Pat", dog_name: "Luna" } },
  { id: "own", title: "Bo (daycare)", start: "2026-10-06", end: "2026-10-07",
    extendedProps: { service_type: "daycare", client_id: "c-kim", client_name: "Kim", dog_name: "Bo" } },
];

let container; let root;
beforeEach(() => {
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  api.get.mockReset();
  api.get.mockImplementation((url) => Promise.resolve({ data: url === "/events" ? EVENTS
    : url === "/clients/balances" ? [{ id: "c-sam", credits: 5 }, { id: "c-pat", credits: 3 }, { id: "c-kim", credits: 2 }] : [] }));
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });
const q = (id) => container.querySelector(`[data-testid="${id}"]`);

test("a friend's dog says who pays, and no one's credits show on a friends & family visit", async () => {
  act(() => root.render(<Schedule />)); await flush();
  act(() => { mockCal.dateClick({ dateStr: "2026-10-06" }); }); await flush();
  expect(q("day-roster-paid-by-rex").textContent).toContain("Paid by Pat");
  expect(q("day-roster-paid-by-luna")).toBeNull();        // the paying family's own dog
  expect(q("day-roster-credits-rex")).toBeNull();
  expect(q("day-roster-credits-luna")).toBeNull();
  expect(q("day-roster-credits-own")).not.toBeNull();     // an ordinary visit, as before
});

test("adding or taking out a dog in the booking details refreshes the calendar", async () => {
  act(() => root.render(<Schedule />)); await flush();
  act(() => { mockCal.dateClick({ dateStr: "2026-10-06" }); }); await flush();
  await act(async () => { q("day-roster-row-rex").click(); });
  await flush();
  const before = api.get.mock.calls.filter(([url]) => url === "/events").length;
  await act(async () => { mockDetail.onChanged(); });
  await flush();
  expect(api.get.mock.calls.filter(([url]) => url === "/events").length).toBe(before + 1);
});
