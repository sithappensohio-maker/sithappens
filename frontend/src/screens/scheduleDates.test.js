/**
 * The Schedule calendar moves a visit by its date: a moved lesson no longer
 * gets "end − 1 day" (the day before it starts) as an end date, only a
 * boarding stretch sends a pickup date, a family card moves every dog, and
 * timed visits show in the Day Roster. Mounted, with FullCalendar replaced
 * by a stub that hands over its props.
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
  formatErr: (e) => (typeof e === "string" ? e : e ? JSON.stringify(e) : ""),
}));
jest.mock("../lib/useLiveRefresh", () => ({ useLiveRefresh: () => {} }));
jest.mock("../components/PageHero", () => (p) => p.right || null);
jest.mock("../components/BookingDetailModal", () => () => null);

const { api } = require("../lib/api");
const Schedule = require("./Schedule").default;

global.IS_REACT_ACT_ENVIRONMENT = true;

const EVENTS = [
  { id: "lesson-1", title: "Rex (training)", start: "2026-10-05T10:30:00", end: "2026-10-05T11:30:00", allDay: false,
    durationEditable: false, extendedProps: { service_type: "training", time: "10:30", client_name: "Kim", spans_days: false } },
  { id: "stay-1", title: "Moose (boarding)", start: "2026-10-05", end: "2026-10-08",
    extendedProps: { service_type: "boarding", client_name: "Lee", spans_days: true } },
  { id: "fam-a", title: "Ace (daycare)", start: "2026-10-06", end: "2026-10-07", durationEditable: false,
    extendedProps: { service_type: "daycare", group_id: "g1", dog_name: "Ace", client_name: "Bo", spans_days: false } },
  { id: "fam-b", title: "Bea (daycare)", start: "2026-10-06", end: "2026-10-07", durationEditable: false,
    extendedProps: { service_type: "daycare", group_id: "g1", dog_name: "Bea", client_name: "Bo", spans_days: false } },
];

let container; let root;
beforeEach(() => {
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  api.get.mockReset(); api.put.mockReset();
  api.get.mockImplementation((url) => Promise.resolve({ data: url === "/events" ? EVENTS : [] }));
  api.put.mockResolvedValue({ data: {} });
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });
const local = (y, m, d) => new Date(y, m - 1, d);
const info = (event) => ({ event: { allDay: true, extendedProps: {}, ...event }, revert: jest.fn() });

test("a lesson dragged to another day sends its date only", async () => {
  act(() => root.render(<Schedule />)); await flush();
  await act(async () => { await mockCal.eventDrop(info({ id: "lesson-1", start: new Date(2026, 9, 7, 10, 30), end: new Date(2026, 9, 7, 11, 30), allDay: false, extendedProps: EVENTS[0].extendedProps })); });
  expect(api.put).toHaveBeenCalledWith("/bookings/lesson-1/reschedule", { date: "2026-10-07" });
});

test("a moved stay sends its date and the server keeps its nights; a stretch sends the pickup", async () => {
  act(() => root.render(<Schedule />)); await flush();
  await act(async () => { await mockCal.eventDrop(info({ id: "stay-1", start: local(2026, 10, 9), end: local(2026, 10, 12), extendedProps: EVENTS[1].extendedProps })); });
  expect(api.put).toHaveBeenLastCalledWith("/bookings/stay-1/reschedule", { date: "2026-10-09" });
  await act(async () => { await mockCal.eventResize(info({ id: "stay-1", start: local(2026, 10, 5), end: local(2026, 10, 10), extendedProps: EVENTS[1].extendedProps })); });
  expect(api.put).toHaveBeenLastCalledWith("/bookings/stay-1/reschedule", { date: "2026-10-05", end_date: "2026-10-09" });
});

test("a family card moves every dog on it", async () => {
  act(() => root.render(<Schedule />)); await flush();
  const card = mockCal.events.find((e) => e.extendedProps?.group_count === 2);
  await act(async () => { await mockCal.eventDrop(info({ id: card.id, start: local(2026, 10, 9), end: local(2026, 10, 10), extendedProps: card.extendedProps })); });
  const moved = api.put.mock.calls.map((c) => c[0]).sort();
  expect(moved).toEqual(["/bookings/fam-a/reschedule", "/bookings/fam-b/reschedule"]);
});

test("a refused move puts the card back and says why", async () => {
  api.put.mockRejectedValue({ response: { data: { detail: "Biscuit is checked in, so this visit can't start after today." } } });
  act(() => root.render(<Schedule />)); await flush();
  const i = info({ id: "stay-1", start: local(2026, 10, 9), end: local(2026, 10, 12), extendedProps: EVENTS[1].extendedProps });
  await act(async () => { await mockCal.eventDrop(i); });
  expect(i.revert).toHaveBeenCalled();
  expect(container.textContent).toContain("can't start after today");
});

test("a timed lesson shows in its day's roster", async () => {
  act(() => root.render(<Schedule />)); await flush();
  act(() => { mockCal.dateClick({ dateStr: "2026-10-05" }); }); await flush();
  expect(container.querySelector('[data-testid="day-roster-row-lesson-1"]')).not.toBeNull();
  expect(container.querySelector('[data-testid="day-roster-row-stay-1"]')).not.toBeNull();
  act(() => { mockCal.dateClick({ dateStr: "2026-10-04" }); }); await flush();
  expect(container.querySelector('[data-testid="day-roster-row-lesson-1"]')).toBeNull();
});

test("stretching a stay to the spring-forward Sunday keeps that Sunday", async () => {
  act(() => root.render(<Schedule />)); await flush();
  await act(async () => { await mockCal.eventResize(info({ id: "stay-1", start: local(2027, 3, 12), end: local(2027, 3, 15), extendedProps: EVENTS[1].extendedProps })); });
  expect(api.put).toHaveBeenLastCalledWith("/bookings/stay-1/reschedule", { date: "2027-03-12", end_date: "2027-03-14" });
});

test("a family card whose dogs leave on different days can't be stretched as one", async () => {
  const fam = [
    { id: "fb-1", title: "A", start: "2026-11-02", end: "2026-11-05", extendedProps: { service_type: "boarding", group_id: "g2", dog_name: "A", spans_days: true } },
    { id: "fb-2", title: "B", start: "2026-11-02", end: "2026-11-07", extendedProps: { service_type: "boarding", group_id: "g2", dog_name: "B", spans_days: true } },
    { id: "fb-3", title: "C", start: "2026-11-09", end: "2026-11-11", extendedProps: { service_type: "boarding", group_id: "g3", dog_name: "C", spans_days: true } },
    { id: "fb-4", title: "D", start: "2026-11-09", end: "2026-11-11", extendedProps: { service_type: "boarding", group_id: "g3", dog_name: "D", spans_days: true } },
  ];
  api.get.mockImplementation((url) => Promise.resolve({ data: url === "/events" ? fam : [] }));
  act(() => root.render(<Schedule />)); await flush();
  const cards = mockCal.events.filter((e) => e.extendedProps?.group_count === 2);
  expect(cards.find((c) => c.extendedProps.group_id === "g2").durationEditable).toBe(false);
  expect(cards.find((c) => c.extendedProps.group_id === "g3").durationEditable).toBeUndefined();
});
