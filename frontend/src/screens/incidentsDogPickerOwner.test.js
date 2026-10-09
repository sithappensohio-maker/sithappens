/**
 * The Log/Edit Incident modal's Dog picker used to be a plain <select>
 * showing the dog's bare name only — two dogs named the same from different
 * families were indistinguishable on this safety/legal record. It is now an
 * EntitySearchPicker whose secondary label carries the owner's name (and
 * breed, when on file), and selecting a result still drives the same
 * form.dog_id state the old <select> set. Mounted.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  formatErr: (e) => String(e),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../lib/useConfirm", () => ({ useConfirm: () => jest.fn(async () => true) }));
jest.mock("../lib/imageCompress", () => ({ compressImage: jest.fn() }));
jest.mock("../components/PageHero", () => ({ right }) => right ?? null);

const { api } = require("../lib/api");
global.IS_REACT_ACT_ENVIRONMENT = true;

// Two dogs named "Rex", owned by two different families — exactly the
// collision a bare-name <select> could not disambiguate.
const DOG_ALICE = { id: "d1", name: "Rex", breed: "Lab", owner_id: "c1" };
const DOG_BOB = { id: "d2", name: "Rex", breed: "Poodle", owner_id: "c2" };
const CLIENT_ALICE = { id: "c1", name: "Alice Anderson" };
const CLIENT_BOB = { id: "c2", name: "Bob Brown" };

let container, root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset().mockImplementation(async (url) => {
    if (url === "/incidents") return { data: [] };
    if (url === "/dogs") return { data: [DOG_ALICE, DOG_BOB] };
    if (url === "/clients") return { data: [CLIENT_ALICE, CLIENT_BOB] };
    return { data: [] };
  });
  api.post.mockReset().mockResolvedValue({ data: { id: "new-inc" } });
});
afterEach(() => { act(() => root?.unmount()); container.remove(); });

const flush = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve(); }); };
const q = (id) => container.querySelector(`[data-testid="${id}"]`);

test("the Dog picker disambiguates same-named dogs by owner, and selecting one drives form.dog_id", async () => {
  const Incidents = require("./Incidents").default;
  await act(async () => {
    root = createRoot(container);
    root.render(<Incidents />);
  });
  await flush();

  await act(async () => { q("add-incident-button").click(); });
  await flush();

  // The old plain <select> is gone; the new picker renders under the same testid root.
  expect(q("incident-dog-select")).not.toBeNull();
  expect(container.querySelector("select")).toBeNull();

  // Defaults to the first dog (d1); open the picker to see both candidates.
  expect(q("incident-dog-select-change")).not.toBeNull();
  await act(async () => { q("incident-dog-select-change").click(); });
  await flush();

  const resultAlice = q("incident-dog-select-result-d1");
  const resultBob = q("incident-dog-select-result-d2");
  expect(resultAlice).not.toBeNull();
  expect(resultBob).not.toBeNull();
  // Both are named "Rex" — only the secondary label (owner, plus breed) tells them apart.
  expect(resultAlice.textContent).toMatch(/Lab/);
  expect(resultAlice.textContent).toMatch(/Alice Anderson/);
  expect(resultBob.textContent).toMatch(/Poodle/);
  expect(resultBob.textContent).toMatch(/Bob Brown/);

  // Pick Bob's Rex.
  await act(async () => { resultBob.click(); });
  await flush();

  const selectedCard = q("incident-dog-select-selected-card");
  expect(selectedCard.textContent).toMatch(/Bob Brown/);

  // Saving the incident now posts the dog actually picked, not the default.
  await act(async () => { q("save-incident-button").click(); });
  await flush();

  expect(api.post).toHaveBeenCalledWith("/incidents", expect.objectContaining({ dog_id: "d2" }));
});

test("a client-scoped viewer (no clients_view) still gets a working picker, just without the owner name", async () => {
  api.get.mockReset().mockImplementation(async (url) => {
    if (url === "/incidents") return { data: [] };
    if (url === "/dogs") return { data: [DOG_ALICE] };
    if (url === "/clients") throw { response: { status: 403 } };
    return { data: [] };
  });
  const Incidents = require("./Incidents").default;
  await act(async () => {
    root = createRoot(container);
    root.render(<Incidents />);
  });
  await flush();

  await act(async () => { q("add-incident-button").click(); });
  await flush();

  expect(q("incident-dog-select")).not.toBeNull();
  await act(async () => { q("incident-dog-select-change").click(); });
  await flush();

  const resultAlice = q("incident-dog-select-result-d1");
  expect(resultAlice).not.toBeNull();
  expect(resultAlice.textContent).toMatch(/Lab/);
});
