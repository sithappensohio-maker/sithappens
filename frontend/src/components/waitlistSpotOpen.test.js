/* A spot opening for a waitlisted dog reaches the desk (audit #33).
 *
 * Mounted, not source-read: what matters is what staff see and where the
 * button takes them. The Action Required card says a spot opened and where
 * the dog is in line; "Open Waitlist" lands on that entry — even an Offered
 * one the default filter hides — and changing an entry refreshes the badges.
 * Same createRoot/act harness as bookingBlocks.test.js.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { PendingActionCard, openPendingAction, PENDING_ACTION_TARGET_KEY } from "./PendingActionsPanel";
import Waitlist from "../screens/Waitlist";
import { scheduleActionCount } from "../lib/sharedData";
import { successDetail } from "../lib/bookingOutcome";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  formatErr: (e) => String(e || ""),
}));
jest.mock("sonner", () => ({ toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }) }));
jest.mock("../lib/useConfirm", () => ({ useConfirm: () => async () => true }));
jest.mock("../lib/useLiveRefresh", () => ({ useLiveRefresh: () => {} }));

const { api } = require("../lib/api");
const { toast } = require("sonner");

global.IS_REACT_ACT_ENVIRONMENT = true;

const ITEM = {
  id: "waitlist_spot_open:w1", type: "waitlist_spot_open", type_label: "Waitlist — Spot Opened",
  urgency: "action_required", urgency_label: "Action Required", status: "waiting",
  created_at: "2026-09-20T14:00:00+00:00", client_name: "Smith", dog_name: "Rosie", service_name: "Daycare",
  requested_date: "2026-10-03", requested_end_date: null, requested_time: null,
  waiting_label: "#1 of 2 in line · 1 spot open", notes: "",
  deep_link: { screen: "waitlist", waitlist_entry_id: "w1" },
};

const ENTRIES = [
  { id: "w1", dog_name: "Rosie", client_name: "Smith", service_type: "daycare", requested_date: "2026-10-03", status: "offered", priority: "normal" },
  { id: "w2", dog_name: "Biscuit", client_name: "Jones", service_type: "daycare", requested_date: "2026-10-03", status: "waiting", priority: "normal" },
];

let root, host;
const q = (sel) => host.querySelector(sel);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  api.get.mockReset();
  api.get.mockImplementation((url) => {
    if (url === "/waitlist") return Promise.resolve({ data: { entries: ENTRIES, statuses: ["waiting", "offered", "booked", "declined", "expired", "removed"] } });
    if (url === "/dogs") return Promise.resolve({ data: [] });
    return Promise.resolve({ data: {} });
  });
  api.put.mockReset().mockResolvedValue({ data: {} });
  api.delete.mockReset().mockResolvedValue({ data: {} });
  api.post.mockReset().mockResolvedValue({ data: {} });
  Element.prototype.scrollIntoView = jest.fn();
  sessionStorage.clear();
  toast.mockClear();
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

test("the card says a spot opened, where the dog is in line, and offers the Waitlist", async () => {
  const onOpen = jest.fn();
  await act(async () => { root.render(<PendingActionCard action={ITEM} onOpen={onOpen} testid="a" />); });
  expect(q('[data-testid="a-spot"]').textContent).toContain("Spot opened");
  expect(host.textContent).toContain("Smith");
  expect(host.textContent).toContain("Rosie");
  expect(host.textContent).toContain("#1 of 2 in line · 1 spot open");
  expect(q('[data-testid="a-review"]').textContent).toContain("Open Waitlist");
  await act(async () => { q('[data-testid="a-review"]').click(); });
  expect(onOpen).toHaveBeenCalledWith(ITEM);
});

test("opening it stores the entry and heads for the Waitlist screen", () => {
  const nav = jest.fn();
  window.addEventListener("sh:nav", nav);
  openPendingAction(ITEM);
  window.removeEventListener("sh:nav", nav);
  expect(nav.mock.calls[0][0].detail).toBe("waitlist");
  expect(JSON.parse(sessionStorage.getItem(PENDING_ACTION_TARGET_KEY))).toEqual({ screen: "waitlist", waitlist_entry_id: "w1" });
});

test("a Waitlist that failed to load keeps the link for the next try", async () => {
  sessionStorage.setItem(PENDING_ACTION_TARGET_KEY, JSON.stringify({ screen: "waitlist", waitlist_entry_id: "w1" }));
  api.get.mockImplementation(() => Promise.reject({ response: { data: { detail: "offline" } } }));
  await act(async () => { root.render(<Waitlist />); });
  await settle();
  expect(toast).not.toHaveBeenCalledWith("That waitlist entry has already been handled.");
  expect(sessionStorage.getItem(PENDING_ACTION_TARGET_KEY)).not.toBeNull();
});

test("offering, declining or deleting an entry refreshes the Action Required badges too", async () => {
  const changed = jest.fn();
  window.addEventListener("sh:pending-actions-changed", changed);
  await act(async () => { root.render(<Waitlist />); });
  await settle();
  const offer = [...host.querySelectorAll('[data-testid="waitlist-row-w2"] button')].find((b) => /^\s*offer/i.test(b.textContent));
  expect(offer).toBeTruthy();
  await act(async () => { offer.click(); });
  await settle();
  expect(api.put).toHaveBeenCalledWith("/waitlist/w2", { status: "offered" });
  expect(changed).toHaveBeenCalledTimes(1);
  const del = [...host.querySelectorAll('[data-testid="waitlist-row-w2"] button')].find((b) => b.querySelector(".fa-trash") || /delete/i.test(b.getAttribute("title") || b.textContent));
  expect(del).toBeTruthy();
  await act(async () => { del.click(); });
  await settle();
  window.removeEventListener("sh:pending-actions-changed", changed);
  expect(api.delete).toHaveBeenCalledWith("/waitlist/w2");
  expect(changed).toHaveBeenCalledTimes(2);
});

test("the Waitlist lands on that entry even when it is Offered and hidden by default", async () => {
  sessionStorage.setItem(PENDING_ACTION_TARGET_KEY, JSON.stringify({ screen: "waitlist", waitlist_entry_id: "w1" }));
  await act(async () => { root.render(<Waitlist />); });
  await settle();
  const row = q('[data-testid="waitlist-row-w1"]');
  expect(row).not.toBeNull();
  expect(row.getAttribute("data-highlight")).toBe("true");
  expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  expect(sessionStorage.getItem(PENDING_ACTION_TARGET_KEY)).toBeNull();
});

test("an entry already dealt with says so instead of landing nowhere", async () => {
  sessionStorage.setItem(PENDING_ACTION_TARGET_KEY, JSON.stringify({ screen: "waitlist", waitlist_entry_id: "gone" }));
  await act(async () => { root.render(<Waitlist />); });
  await settle();
  expect(toast).toHaveBeenCalledWith("That waitlist entry has already been handled.");
  expect(sessionStorage.getItem(PENDING_ACTION_TARGET_KEY)).toBeNull();
});

test("booking or changing an entry refreshes the Action Required badges", async () => {
  const changed = jest.fn();
  window.addEventListener("sh:pending-actions-changed", changed);
  await act(async () => { root.render(<Waitlist />); });
  await settle();
  const convert = [...host.querySelectorAll('[data-testid="waitlist-row-w2"] button')].find((b) => /convert|book/i.test(b.textContent));
  expect(convert).toBeTruthy();
  await act(async () => { convert.click(); });
  await settle();
  window.removeEventListener("sh:pending-actions-changed", changed);
  expect(api.post).toHaveBeenCalledWith("/waitlist/w2/convert-to-booking");
  expect(changed).toHaveBeenCalled();
});

test("the Schedule badge leaves them to Action Required, and the portal promises what really happens", () => {
  expect(scheduleActionCount({ waitlist_spots_open: 2, meet_and_greet_requests: 0, booking_approvals: 0, reschedule_requests: 0 })).toBe(0);
  expect(successDetail("pending", { waitlisted: true })).toBe("If a spot opens up, Sit Happens will contact you.");
});
