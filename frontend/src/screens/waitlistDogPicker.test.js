/**
 * Add to Waitlist's dog picker now uses the shared EntitySearchPicker
 * (search box + tappable result cards with real dog photos), the same
 * widget AdminBookingModal's Quick Check-in dog picker shipped with —
 * instead of a plain <select> over every dog. Mounted, not source-read: a
 * source pin could not tell a real <select> from a search+cards picker that
 * merely kept the same test id.
 *
 * This screen is used under time pressure (a spot just opened), so picking
 * a result must be a single click with no extra confirmation step, and the
 * rest of the Add form (service type, date, priority, notes, save) must be
 * completely untouched.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import Waitlist from "./Waitlist";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  formatErr: (e) => String(e || ""),
}));
jest.mock("sonner", () => ({ toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }) }));
jest.mock("../lib/useConfirm", () => ({ useConfirm: () => async () => true }));

const { api } = require("../lib/api");
const { toast } = require("sonner");

global.IS_REACT_ACT_ENVIRONMENT = true;

const PHOTO = "data:image/png;base64,AAAA";

// Real shape of GET /dogs: unlike /dogs/options, it is NOT capacity-trimmed
// and DOES carry each dog's single `photo` field (only the gallery `photos`
// array is stripped server-side) plus `client_name` for display.
const DOGS = [
  { id: "d-luna", name: "Luna", client_name: "Pat", photo: PHOTO },
  { id: "d-rex", name: "Rex", client_name: "Sam", photo: "" },
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
    if (url === "/waitlist") return Promise.resolve({ data: { entries: [], statuses: ["waiting", "offered", "booked", "declined", "expired", "removed"] } });
    if (url === "/dogs") return Promise.resolve({ data: DOGS });
    if (String(url).startsWith("/availability")) return Promise.resolve({ data: { has_limit: false } });
    return Promise.resolve({ data: {} });
  });
  api.post.mockReset().mockResolvedValue({ data: {} });
  toast.mockClear();
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

const openModal = async () => {
  await act(async () => { root.render(<Waitlist />); });
  await settle();
  await act(async () => { q('[data-testid="add-waitlist-btn"]').click(); });
  await settle();
};

test("the dog picker is search+cards, not a plain <select>", async () => {
  await openModal();
  expect(host.querySelector('select[data-testid="waitlist-dog"]')).toBeFalsy();
  expect(q('[data-testid="waitlist-dog"]')).toBeTruthy();
  expect(q('[data-testid="waitlist-dog-search-input"]')).toBeTruthy();
  expect(q('[data-testid="waitlist-dog-result-d-luna"]')).toBeTruthy();
  expect(q('[data-testid="waitlist-dog-result-d-rex"]')).toBeTruthy();
});

test("a dog with a photo shows it; one without falls back to an initial circle", async () => {
  await openModal();
  const lunaRow = q('[data-testid="waitlist-dog-result-d-luna"]');
  const rexRow = q('[data-testid="waitlist-dog-result-d-rex"]');
  expect(lunaRow.querySelector("img")?.getAttribute("src")).toBe(PHOTO);
  expect(rexRow.querySelector("img")).toBeFalsy();
  expect(rexRow.textContent).toContain("R"); // Rex's initial
});

test("picking a dog from search results is a single click — no extra confirmation step", async () => {
  await openModal();
  await act(async () => { q('[data-testid="waitlist-dog-result-d-luna"]').click(); });
  await settle();
  // Collapses straight to the selected-item card, no intermediate dialog.
  expect(q('[data-testid="waitlist-dog-selected-card"]')).toBeTruthy();
  expect(q('[data-testid="waitlist-dog-selected-card"]').textContent).toContain("Luna");
  expect(host.querySelector('[data-testid="confirm-dialog"]')).toBeFalsy();
});

test("saving still posts the dog_id picked through the new control, same as before", async () => {
  await openModal();
  await act(async () => { q('[data-testid="waitlist-dog-result-d-rex"]').click(); });
  await settle();
  await act(async () => { q('[data-testid="waitlist-date"]').dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => { q('[data-testid="waitlist-save"]').click(); });
  await settle();
  expect(api.post).toHaveBeenCalledWith("/waitlist", expect.objectContaining({ dog_id: "d-rex" }));
});

test("not picking a dog still blocks save with the same validation message", async () => {
  await openModal();
  await act(async () => { q('[data-testid="waitlist-save"]').click(); });
  await settle();
  expect(toast.error).toHaveBeenCalledWith("Pick a dog");
  expect(api.post).not.toHaveBeenCalled();
});
