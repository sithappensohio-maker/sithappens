/**
 * The Custom Practice modal's Dog picker (data-testid "hw-dog") used to be a
 * plain <select> showing the dog's bare name only — two dogs named the same
 * from different families were indistinguishable. It is now an
 * EntitySearchPicker whose secondary label carries the owner's name (same
 * owner-resolution approach as Incidents.jsx: GET /clients, mapped by
 * dog.owner_id), and selecting a result still drives the same form.dog_id
 * state the old <select> set. Mounted, not source-read.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  formatErr: (e) => String(e || ""),
}));
jest.mock("sonner", () => ({ toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }) }));
jest.mock("../lib/useConfirm", () => ({ useConfirm: () => async () => true }));
jest.mock("../components/PageHero", () => (p) => p.right ?? null);
jest.mock("../components/HomeworkTemplatePicker", () => ({ __esModule: true, default: () => null, tierMeta: () => ({ bg: "", color: "", label: "" }) }));
jest.mock("../components/HomeworkReportPanel", () => () => null);
jest.mock("../components/DailyTrackerBuilder", () => () => null);
jest.mock("../components/DailyReviewQueue", () => () => null);
jest.mock("../components/HomeworkAnalytics", () => () => null);

const { api } = require("../lib/api");
global.IS_REACT_ACT_ENVIRONMENT = true;

const PHOTO = "data:image/png;base64,AAAA";

// Two dogs named "Rex", owned by two different families — exactly the
// collision a bare-name <select> could not disambiguate.
const DOG_ALICE = { id: "d1", name: "Rex", breed: "Lab", owner_id: "c1", vaccines: {} };
const DOG_BOB = { id: "d2", name: "Rex", breed: "Poodle", owner_id: "c2", vaccines: {} };
const CLIENT_ALICE = { id: "c1", name: "Alice Anderson" };
const CLIENT_BOB = { id: "c2", name: "Bob Brown" };

let container, root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset().mockImplementation(async (url) => {
    if (url === "/homework") return { data: [] };
    if (url === "/dogs/options") return { data: [DOG_ALICE, DOG_BOB] };
    if (url === "/homework/counts") return { data: { all: 0, assigned: 0, completed: 0, active: 0 } };
    if (url === "/admin/homework/unreviewed-count") return { data: { unreviewed: 0, needs_attention: 0 } };
    if (url === "/clients") return { data: [CLIENT_ALICE, CLIENT_BOB] };
    if (url === "/dogs/d1") return { data: { ...DOG_ALICE, photo: PHOTO } };
    if (url === "/dogs/d2") return { data: { ...DOG_BOB, photo: "" } };
    return { data: [] };
  });
  api.post.mockReset().mockResolvedValue({ data: { id: "new-hw" } });
});
afterEach(() => { act(() => root?.unmount()); container.remove(); });

const flush = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve(); }); };
const q = (id) => container.querySelector(`[data-testid="${id}"]`);

test("the Dog picker disambiguates same-named dogs by owner, and selecting one drives form.dog_id", async () => {
  const Homework = require("./Homework").default;
  await act(async () => {
    root = createRoot(container);
    root.render(<Homework />);
  });
  await flush();

  await act(async () => { q("add-homework-button").click(); });
  await flush();

  // The old plain <select> is gone; the new picker renders under the same testid root.
  expect(q("hw-dog")).not.toBeNull();
  expect(container.querySelector("select[data-testid='hw-dog']")).toBeNull();

  // Defaults to the first dog (d1); open the picker to see both candidates.
  expect(q("hw-dog-change")).not.toBeNull();
  await act(async () => { q("hw-dog-change").click(); });
  await flush();

  const resultAlice = q("hw-dog-result-d1");
  const resultBob = q("hw-dog-result-d2");
  expect(resultAlice).not.toBeNull();
  expect(resultBob).not.toBeNull();
  // Both are named "Rex" — only the secondary label (owner, plus breed) tells them apart.
  expect(resultAlice.textContent).toMatch(/Lab/);
  expect(resultAlice.textContent).toMatch(/Alice Anderson/);
  expect(resultBob.textContent).toMatch(/Poodle/);
  expect(resultBob.textContent).toMatch(/Bob Brown/);

  // Real dog photo: Alice's Rex has one, Bob's doesn't (falls back to initial).
  expect(resultAlice.querySelector("img")?.getAttribute("src")).toBe(PHOTO);
  expect(resultBob.querySelector("img")).toBeNull();

  // Pick Bob's Rex.
  await act(async () => { resultBob.click(); });
  await flush();

  const selectedCard = q("hw-dog-selected-card");
  expect(selectedCard.textContent).toMatch(/Bob Brown/);

  // Saving still posts the dog actually picked, not the default.
  await act(async () => { q("save-homework").click(); });
  await flush();

  expect(api.post).toHaveBeenCalledWith("/homework", expect.objectContaining({ dog_id: "d2" }));
});
