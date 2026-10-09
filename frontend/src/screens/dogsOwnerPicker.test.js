/**
 * The New/Edit Dog modal's Owner field used to be a plain <select> over
 * every client on file, labeled by bare client name only. It is now the
 * shared EntitySearchPicker (search box + tappable result cards, collapsing
 * into a selected-item card) — same CLIENT picker pattern as the Register
 * client field (clients have no stored photo field, so no `photos` map),
 * driving the SAME form.owner_id state the old <select> set. Mounted test
 * (not a source-pin) per house convention.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  formatErr: (e) => String(e || ""),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../lib/useConfirm", () => ({ useConfirm: () => jest.fn(async () => true) }));
jest.mock("../lib/imageCompress", () => ({ compressImage: jest.fn() }));

const { api } = require("../lib/api");
global.IS_REACT_ACT_ENVIRONMENT = true;

// Two clients on file. No dogs yet — the roster grid stays empty so the
// per-card sub-components (trophy wall, intake forms, etc.) never mount;
// only the New Dog modal under test is exercised.
const CLIENT_ALICE = { id: "c1", name: "Alice Anderson" };
const CLIENT_BOB = { id: "c2", name: "Bob Brown" };

let container, root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset().mockImplementation(async (url) => {
    if (url === "/dogs") return { data: [] };
    if (url === "/clients/options") return { data: [CLIENT_ALICE, CLIENT_BOB] };
    if (url === "/dogs/summary") return { data: { total: 0 } };
    if (url === "/settings") return { data: {} };
    if (url === "/admin/dog-trophies-summary") return { data: {} };
    if (url === "/programs/pipeline") return { data: [] };
    return { data: [] };
  });
  api.post.mockReset().mockResolvedValue({ data: { id: "new-dog" } });
});
afterEach(() => { act(() => root?.unmount()); container.remove(); });

const flush = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve(); }); };
const q = (id) => container.querySelector(`[data-testid="${id}"]`);

test("the New Dog modal's Owner field is the search+cards picker, not a plain dropdown, and the picked client drives form.owner_id", async () => {
  const Dogs = require("./Dogs").default;
  await act(async () => {
    root = createRoot(container);
    root.render(<Dogs />);
  });
  await flush();

  await act(async () => { q("add-dog-button").click(); });
  await flush();
  // New Dog opens on the Timeline tab; the Owner field lives under Basics.
  await act(async () => { q("dog-tab-basics").click(); });
  await flush();

  // The old plain <select> is gone; the new picker renders under the same testid root.
  expect(q("dog-owner-select")).not.toBeNull();
  expect(container.querySelector("select[data-testid='dog-owner-select']")).toBeNull();

  // Defaults to the first client (c1, Alice) same as the old <select>'s implicit first-option default —
  // a selection is already made, so the picker starts collapsed into the selected-item card.
  expect(q("dog-owner-select-selected-card")?.textContent).toContain("Alice Anderson");

  await act(async () => { q("dog-owner-select-change").click(); });
  await flush();

  const resultBob = q("dog-owner-select-result-c2");
  expect(resultBob).not.toBeNull();
  expect(resultBob.textContent).toContain("Bob Brown");

  await act(async () => { resultBob.click(); });
  await flush();

  expect(q("dog-owner-select-selected-card").textContent).toContain("Bob Brown");

  await act(async () => { q("dog-name-input").dispatchEvent(new Event("focus")); });
  const nameInput = q("dog-name-input");
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(nameInput, "Rex");
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));
  });

  await act(async () => { q("save-dog-button").click(); });
  await flush();

  expect(api.post).toHaveBeenCalledWith("/dogs", expect.objectContaining({ owner_id: "c2", name: "Rex" }));
});
