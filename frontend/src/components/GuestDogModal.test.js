/**
 * One-time guest dog (owner request 2026-11-26) — a family on file turns up
 * with an extra dog. The desk types one name, ticks the "no vaccine records"
 * box, and the dog is saved on that family and handed to the screen that
 * opened the form. Mounted, not source-pinned; the last two tests pin where
 * the button lives.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import GuestDogModal from "./GuestDogModal";
import { api } from "../lib/api";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn() },
  formatErr: (e) => (typeof e === "string" ? e : ""),
}));
global.IS_REACT_ACT_ENVIRONMENT = true;

let container, root, onCreated, onClose;
const q = (id) => document.body.querySelector(`[data-testid="${id}"]`);
const type = (el, value) => act(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));

beforeEach(async () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  api.post.mockReset();
  onCreated = jest.fn();
  onClose = jest.fn();
  await act(async () => {
    root = createRoot(container);
    root.render(<GuestDogModal clientId="c1" clientName="The Reyes family" onClose={onClose} onCreated={onCreated} />);
  });
});
afterEach(() => { act(() => root?.unmount()); container.remove(); root = null; });

test("it says whose guest this is and warns that no vaccine records are on file", () => {
  expect(q("guest-dog-modal").textContent).toContain("The Reyes family");
  expect(q("guest-dog-modal").textContent).toContain("One-time guest");
  expect(q("guest-dog-vaccine-warning").textContent).toContain("No vaccine records on file");
});

test("the dog cannot be added until it has a name AND the vaccine box is ticked", async () => {
  expect(q("guest-dog-save").disabled).toBe(true);
  await type(q("guest-dog-name"), "Pepper");
  expect(q("guest-dog-save").disabled).toBe(true);          // name alone is not enough
  await act(async () => { q("guest-dog-vaccine-confirm").click(); });
  expect(q("guest-dog-save").disabled).toBe(false);
  await type(q("guest-dog-name"), "   ");
  expect(q("guest-dog-save").disabled).toBe(true);          // the box alone is not enough
  expect(api.post).not.toHaveBeenCalled();
});

test("adding saves the dog on this family and hands it back", async () => {
  api.post.mockResolvedValue({ data: { dog: { id: "d9", name: "Pepper", owner_id: "c1" } } });
  await type(q("guest-dog-name"), " Pepper ");
  await type(q("guest-dog-breed"), "Beagle");
  await act(async () => { q("guest-dog-vaccine-confirm").click(); });
  await act(async () => { q("guest-dog-save").click(); });
  await flush();
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(api.post).toHaveBeenCalledWith("/clients/c1/guest-dog",
    { dog_name: "Pepper", breed: "Beagle", notes: "", no_vaccines_confirmed: true });
  expect(onCreated).toHaveBeenCalledWith({ id: "d9", name: "Pepper", owner_id: "c1" });
});

test("a refusal is shown in the form and the form stays open to try again", async () => {
  api.post.mockRejectedValue({ response: { data: { detail: "The Reyes family already has a dog named Pepper on file. Pick that dog instead." } } });
  await type(q("guest-dog-name"), "Pepper");
  await act(async () => { q("guest-dog-vaccine-confirm").click(); });
  await act(async () => { q("guest-dog-save").click(); });
  await flush();
  expect(q("guest-dog-error").textContent).toContain("Pick that dog instead");
  expect(onCreated).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(q("guest-dog-save").disabled).toBe(false);
});

test("a refusal from the screen that opened it (the visit could not take the dog) is shown too", async () => {
  api.post.mockResolvedValue({ data: { dog: { id: "d9", name: "Pepper" } } });
  onCreated.mockRejectedValue({ response: { data: { detail: "A dog on this booking has already gone home, so no dog can be added now. Book this dog on its own." } } });
  await type(q("guest-dog-name"), "Pepper");
  await act(async () => { q("guest-dog-vaccine-confirm").click(); });
  await act(async () => { q("guest-dog-save").click(); });
  await flush();
  expect(q("guest-dog-error").textContent).toContain("already gone home");
});

// ── where the button lives ────────────────────────────────────────────────
const fs = require("fs");
const path = require("path");
const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");

test("Quick Check-In offers it for the picked family, only while checking in now", () => {
  const src = read("AdminBookingModal.jsx");
  expect(src).toMatch(/const canGuest = canAddFamily && !!clientId && !!dogId && checkInNow && !existing/);
  expect(src).toMatch(/\{canGuest && \(\s*<button type="button" onClick=\{\(\) => setGuestAddOpen\(true\)\} data-testid="ab-add-guest-dog"/);
  // shown even when the family has a single dog on file
  expect(src).toMatch(/clientDogsForGroup\.length > 1 \|\| ffAllowed \|\| canGuest/);
  const mount = src.slice(src.indexOf("<GuestDogModal"), src.indexOf("<GuestDogModal") + 600);
  expect(mount).toMatch(/clientId=\{clientId\}/);
  expect(mount).toMatch(/setDogs\(prev =>/);
  expect(mount).toMatch(/addFriendDog\(dog\.id\)/);
});

test("a visit on today's Front Desk list offers it, adds the dog to that visit and checks it in", () => {
  const src = read("..", "screens", "Pos.jsx");
  expect(src).toMatch(/const canGuestDog = canBookingEdit && canClientsEdit && friendsFamilyOn\(auth\)/);
  const at = src.indexOf("pos-visit-guest-dog-");
  expect(at).toBeGreaterThan(-1);
  const button = src.slice(at - 300, at + 100);
  expect(button).toMatch(/canGuestDog && !missed/);
  expect(button).toMatch(/\["daycare", "boarding"\]\.includes\(row\.service_type\)/);
  const add = src.slice(src.indexOf("const addGuestToVisit"), src.indexOf("const addGuestToVisit") + 900);
  expect(add).toMatch(/api\.post\(`\/bookings\/\$\{row\.booking_id\}\/group-dogs`, \{ dog_id: dog\.id/);
  expect(add).toMatch(/api\.post\(`\/bookings\/\$\{data\.booking\.id\}\/check-in`, \{ \.\.\.geo, vaccine_ack: true \}\)/);
  expect(src).toMatch(/clientId=\{guestRow\.client_id\}/);
});
