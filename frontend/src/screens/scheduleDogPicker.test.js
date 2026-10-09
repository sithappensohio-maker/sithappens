/**
 * Day Roster quick-add dog picker(s) — swapped from plain <select> elements
 * to the shared search+photo-card EntitySearchPicker (same component
 * AdminBookingModal's Quick Check-in uses), with zero other behavior change:
 * same state (newBooking.dog_id / extra_dogs), same handlers
 * (setPrimaryDog / updateExtraDog / removeExtraDog), same validation.
 *
 * GET /dogs (unlike the lighter /dogs/options) already returns each dog's
 * single `photo` field, so the picker gets real photos straight from the
 * `dogs` state already loaded here — no extra per-dog fetch.
 *
 * Mounted, not source-read: a source pin could not tell a real <img> from a
 * broken one, or that the old <select> tag is actually gone.
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

const PHOTO = "data:image/png;base64,AAAA";

// Rex, Fido and Bella share one household (owner c1); Luna is unrelated
// (owner c2), so the multi-dog section only ever offers the first three.
const DOGS = [
  { id: "d-rex", name: "Rex", breed: "Lab", owner_id: "c1", photo: PHOTO },
  { id: "d-fido", name: "Fido", breed: "Beagle", owner_id: "c1", photo: "" },
  { id: "d-bella", name: "Bella", breed: "Poodle", owner_id: "c1", photo: "" },
  { id: "d-luna", name: "Luna", breed: "Pug", owner_id: "c2", photo: "" },
];

let container; let root;
beforeEach(() => {
  window.matchMedia = window.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  api.get.mockReset();
  api.get.mockImplementation((url) => Promise.resolve({
    data: url === "/events" ? []
      : url === "/dogs" ? DOGS
      : url === "/clients/balances" ? []
      : url === "/services/addons" ? []
      : [],
  }));
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });
const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const click = async (id) => { await act(async () => { q(id).click(); }); await flush(); };

const openQuickAdd = async () => {
  act(() => root.render(<Schedule />)); await flush();
  act(() => { mockCal.dateClick({ dateStr: "2026-10-06" }); }); await flush();
  await click("day-roster-new-btn");
};

test("the primary dog field is the search+photo picker, not a plain <select>, and shows Rex's real photo", async () => {
  await openQuickAdd();
  const field = q("day-roster-dog-select");
  expect(field).toBeTruthy();
  expect(field.tagName).not.toBe("SELECT");
  expect(container.querySelector('select[data-testid="day-roster-dog-select"]')).toBeNull();
  // startNewBooking preselects dogs[0] (Rex, the first row from /dogs), same
  // as the old <select>'s implicit first-option default.
  const card = q("day-roster-dog-select-selected-card");
  expect(card).toBeTruthy();
  expect(card.textContent).toContain("Rex");
  expect(card.querySelector("img")?.getAttribute("src")).toBe(PHOTO);
});

test("switching the primary dog via search updates state, resets extras, and the multi-dog section follows the new household", async () => {
  await openQuickAdd();
  // Force a known starting point: pick Luna (no household) via search.
  await click("day-roster-dog-select-change");
  await click("day-roster-dog-select-result-d-luna");
  expect(q("day-roster-multidog")).toBeNull(); // Luna is an only dog

  // Now switch to Rex, who has two housemates (Fido, Bella).
  await click("day-roster-dog-select-change");
  await click("day-roster-dog-select-result-d-rex");
  expect(q("day-roster-multidog")).toBeTruthy();
  // Rex's photo shows on the now-selected card.
  const card = q("day-roster-dog-select-selected-card");
  expect(card.querySelector("img")?.getAttribute("src")).toBe(PHOTO);
});

test("the extra (friends & family style) dog row is the same picker, wired to the same updateExtraDog handler", async () => {
  await openQuickAdd();
  await click("day-roster-dog-select-change");
  await click("day-roster-dog-select-result-d-rex"); // household: Rex + Fido + Bella

  await click("day-roster-add-dog"); // picks the first available housemate (Fido)
  const extraField = q("day-roster-extra-dog-select-0");
  expect(extraField).toBeTruthy();
  expect(extraField.tagName).not.toBe("SELECT");
  expect(container.querySelector('select[data-testid="day-roster-extra-dog-select-0"]')).toBeNull();

  // Switch the extra dog to Bella instead of the auto-picked Fido.
  await click("day-roster-extra-dog-select-0-change");
  await click("day-roster-extra-dog-select-0-result-d-bella");
  expect(q("day-roster-extra-dog-select-0-selected-card").textContent).toContain("Bella");

  // Remove still works exactly as before.
  await click("day-roster-remove-dog-0");
  expect(q("day-roster-extra-dog-0")).toBeNull();
  expect(q("day-roster-multidog")).toBeTruthy(); // the section itself stays (3-dog household)
});

test("a dog with no photo on file falls back to an initial circle in the picker's results, never a broken image", async () => {
  await openQuickAdd();
  await click("day-roster-dog-select-change");
  const results = q("day-roster-dog-select-results");
  expect(results.querySelector("img[src='']")).toBeFalsy();
  expect(q("day-roster-dog-select-result-d-fido").textContent).toContain("F");
});

test("saving a group booking with a picker-selected extra dog still posts the same payload shape", async () => {
  await openQuickAdd();
  await click("day-roster-dog-select-change");
  await click("day-roster-dog-select-result-d-rex");
  await click("day-roster-add-dog");
  await click("day-roster-extra-dog-select-0-change");
  await click("day-roster-extra-dog-select-0-result-d-bella");

  api.post.mockResolvedValue({ data: {} });
  await click("day-roster-save-btn");
  expect(api.post).toHaveBeenCalledWith("/bookings/group", expect.objectContaining({
    dogs: [
      expect.objectContaining({ dog_id: "d-rex" }),
      expect.objectContaining({ dog_id: "d-bella" }),
    ],
  }));
});
