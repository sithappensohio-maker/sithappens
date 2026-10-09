/**
 * Intake Forms "Send to client" modal — client picker EntitySearchPicker swap.
 *
 * SendModal's client <select> ("send-client") used to be a plain long
 * dropdown of every client, alphabetical by name only. This proves the swap
 * to EntitySearchPicker (search box + tappable result cards, collapsing into
 * a selected-item card) drives the SAME state (sendModal.client_id) and the
 * SAME confirm-send API call, with zero other behavior change. The dog
 * select underneath (already scoped to the picked client's dogs) is left
 * untouched. Mounted test (not a source-pin) per house convention.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import IntakeForms from "./IntakeForms";

jest.mock("../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() }, formatErr: (x) => String(x || "") }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), message: jest.fn() } }));
jest.mock("../lib/useConfirm", () => ({ useConfirm: () => async () => true, ConfirmProvider: ({ children }) => children }));

const { api } = require("../lib/api");

global.IS_REACT_ACT_ENVIRONMENT = true;

const TEMPLATES = [
  { id: "t1", name: "New Client Intake", form_type: "client_intake", description: "", active: true, fields: [{ id: "f1", label: "Name", field_type: "short_text" }] },
];
const CLIENTS = [
  { id: "c1", name: "Alex Morgan" },
  { id: "c2", name: "Jamie Lee" },
];
const DOGS = [
  { id: "d1", name: "Rex", owner_id: "c2" },
];

let container, root, posted;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  posted = [];
  api.get.mockReset();
  api.post.mockReset();
  api.get.mockImplementation((path) => {
    const byPath = {
      "/intake/templates": { templates: TEMPLATES },
      "/intake/submissions": { submissions: [] },
      "/clients/options": CLIENTS,
      "/dogs/options": DOGS,
    };
    if (path in byPath) return Promise.resolve({ data: byPath[path] });
    return Promise.resolve({ data: [] });
  });
  api.post.mockImplementation((path, body) => { posted.push({ path, body }); return Promise.resolve({ data: {} }); });
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  root = null;
  container.remove();
});

async function mount() {
  root = createRoot(container);
  await act(async () => { root.render(<IntakeForms />); });
}
const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const click = async (el) => { await act(async () => { el.click(); }); };
const setFieldValue = async (el, value) => {
  const isSelect = el.tagName.toLowerCase() === "select";
  const proto = isSelect ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  await act(async () => {
    setter.call(el, String(value));
    el.dispatchEvent(new Event(isSelect ? "change" : "input", { bubbles: true }));
  });
};

test("Send-to-client modal: client field is the search+cards picker, not a plain dropdown, and the picked client reaches the submission payload", async () => {
  await mount();
  await click(q("send-t1"));

  // The old plain <select> for client is gone — EntitySearchPicker is there instead.
  expect(q("send-client")).not.toBeNull();
  expect(q("send-client-search-input")).not.toBeNull();
  expect(container.querySelector('[data-testid="send-client"] select')).toBeNull();

  await setFieldValue(q("send-client-search-input"), "Jamie");
  const result = q("send-client-result-c2");
  expect(result).not.toBeNull();
  await click(result);

  // Selecting collapses into the selected-item card showing that client.
  expect(q("send-client-selected-card").textContent).toContain("Jamie Lee");

  // The dog select underneath (scoped to that client's dogs) still works untouched.
  expect(q("send-dog")).not.toBeNull();

  await click(q("send-confirm"));

  const call = posted.find((p) => p.path === "/intake/submissions");
  expect(call).toBeTruthy();
  expect(call.body.client_id).toBe("c2");
});

test("Send-to-client modal: picking a client with no dogs shows no dog select, and confirm without a pick errors instead of posting", async () => {
  await mount();
  await click(q("send-t1"));

  await click(q("send-confirm"));
  expect(posted.length).toBe(0);

  await setFieldValue(q("send-client-search-input"), "Alex");
  await click(q("send-client-result-c1"));
  expect(q("send-client-selected-card").textContent).toContain("Alex Morgan");
  expect(q("send-dog")).toBeNull();
});
