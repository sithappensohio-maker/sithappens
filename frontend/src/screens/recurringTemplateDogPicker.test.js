/**
 * The New/Edit Recurring Schedule modal's dog field now uses the shared
 * EntitySearchPicker (search box + tappable result cards with real dog
 * photos), the same widget AdminBookingModal/Schedule/Incidents/Waitlist
 * already ship with — instead of a plain <select data-testid="template-dog-
 * select"> over every dog. Mounted, not source-read: a source pin could not
 * tell a real <select> from a search+cards picker that merely kept the same
 * test id.
 *
 * Everything else about the form (service picker, weekdays, dates, horizon,
 * auto-extend, notes, save/validation) must stay completely untouched.
 *
 * Also covers the new read-only "~$X per occurrence" line, sourced only from
 * the service already loaded into `services` state (base_price) for
 * whichever service is currently picked in the form — never invented.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import RecurringTemplates from "./RecurringTemplates";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  formatErr: (e) => String(e || ""),
}));
jest.mock("../lib/useConfirm", () => ({ useConfirm: () => async () => true }));

const { api } = require("../lib/api");

global.IS_REACT_ACT_ENVIRONMENT = true;

const PHOTO = "data:image/png;base64,AAAA";

// Real shape of GET /dogs: carries each dog's single `photo` field (only the
// gallery `photos` array is stripped server-side).
const DOGS = [
  { id: "d-luna", name: "Luna", breed: "Pug", photo: PHOTO },
  { id: "d-rex", name: "Rex", breed: "Lab", photo: "" },
];
const SERVICES = [
  { id: "s-daycare", name: "Daycare", service_type: "daycare", base_price: 35, active: true },
  { id: "s-train", name: "Private Lesson", service_type: "training", base_price: 90, active: true },
];

let container, root;
const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });
const click = async (id) => { await act(async () => { q(id).click(); }); await flush(); };

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  api.get.mockReset();
  api.get.mockImplementation((url) => {
    if (url === "/recurring-templates") return Promise.resolve({ data: [] });
    if (url === "/dogs") return Promise.resolve({ data: DOGS });
    if (url === "/services") return Promise.resolve({ data: SERVICES });
    if (url === "/admin/pending-actions") return Promise.resolve({ data: { items: [] } });
    return Promise.resolve({ data: {} });
  });
  api.post.mockReset().mockResolvedValue({ data: {} });
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const openNew = async () => {
  act(() => root.render(<RecurringTemplates />));
  await flush();
  await click("new-template-btn");
};

test("the dog field is the search+photo picker, not a plain <select>", async () => {
  await openNew();
  expect(container.querySelector('select[data-testid="template-dog-select"]')).toBeNull();
  const field = q("template-dog-select");
  expect(field).toBeTruthy();
  expect(field.tagName).not.toBe("SELECT");
  // A dog is preselected (dogs[0], same as the old <select>'s implicit
  // first option), so it starts collapsed into the selected card — open
  // search via "Change" to see the result cards.
  await click("template-dog-select-change");
  expect(q("template-dog-select-search-input")).toBeTruthy();
  expect(q("template-dog-select-result-d-luna")).toBeTruthy();
  expect(q("template-dog-select-result-d-rex")).toBeTruthy();
});

test("openNew preselects the first dog, same as the old <select>'s implicit first option, and shows its real photo", async () => {
  await openNew();
  const card = q("template-dog-select-selected-card");
  expect(card).toBeTruthy();
  expect(card.textContent).toContain("Luna");
  expect(card.querySelector("img")?.getAttribute("src")).toBe(PHOTO);
});

test("a dog with no photo on file falls back to an initial circle, never a broken image", async () => {
  await openNew();
  await click("template-dog-select-change");
  const rexRow = q("template-dog-select-result-d-rex");
  expect(rexRow.querySelector("img")).toBeFalsy();
  expect(rexRow.textContent).toContain("R");
});

test("picking a dog from search results is a single click, and saving still posts that dog_id — same state, same handler", async () => {
  await openNew();
  await click("template-dog-select-change");
  await click("template-dog-select-result-d-rex");
  expect(q("template-dog-select-selected-card").textContent).toContain("Rex");

  await click("weekday-0");
  await click("save-template-btn");
  await flush();
  expect(api.post).toHaveBeenCalledWith("/recurring-templates", expect.objectContaining({ dog_id: "d-rex" }));
});

test("not picking a dog still blocks save with the same validation message", async () => {
  api.get.mockImplementation((url) => {
    if (url === "/dogs") return Promise.resolve({ data: [] }); // no dogs on file
    if (url === "/recurring-templates") return Promise.resolve({ data: [] });
    if (url === "/services") return Promise.resolve({ data: SERVICES });
    if (url === "/admin/pending-actions") return Promise.resolve({ data: { items: [] } });
    return Promise.resolve({ data: {} });
  });
  await openNew();
  await click("weekday-0");
  await click("save-template-btn");
  await flush();
  expect(container.textContent).toContain("Pick a dog.");
  expect(api.post).not.toHaveBeenCalled();
});

test("a read-only per-occurrence price shows for the selected service, from the service's own base_price already in state", async () => {
  await openNew();
  // openNew's default service is the first daycare service (s-daycare, $35).
  expect(q("template-price-estimate")?.textContent).toContain("35");

  await act(async () => {
    const select = q("template-service-select");
    select.value = "s-train";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flush();
  expect(q("template-price-estimate")?.textContent).toContain("90");
});
