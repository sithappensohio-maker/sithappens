/**
 * Audit #3 — the client edit form sends what it showed.
 *
 * The form is filled from the client list, which can be hours old. The
 * server now writes only the fields the operator changed (and moves credits
 * by the operator's change), but it can only do that if the screen says what
 * the form showed when it opened. This mounts the real Clients screen, opens
 * a client, changes the credits and saves.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
  formatErr: (x) => String(x || ""),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() } }));
jest.mock("../lib/useConfirm", () => ({ useConfirm: () => async () => true, usePromptDialog: () => async () => null, ConfirmProvider: ({ children }) => children }));

const { api } = require("../lib/api");
const Clients = require("./Clients").default;

global.IS_REACT_ACT_ENVIRONMENT = true;

const CLIENT = {
  id: "c1", name: "Sam Owner", email: "sam@example.com", phone: "614-555-0100", address: "", emerg: "",
  credits: 10, training_credits: 0, boarding_credits: 2, account_balance: 0, client_status: "active",
  evaluation_notes: "Met on Monday.", dogs: [],
};

let container, root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  api.get.mockReset();
  api.put.mockReset();
  api.put.mockResolvedValue({ data: CLIENT });
  api.get.mockImplementation((path) => {
    if (path === "/clients/page") return Promise.resolve({ data: { items: [CLIENT], total: 1, page: 1, pages: 1 } });
    if (path === `/clients/${CLIENT.id}`) return Promise.resolve({ data: CLIENT });
    if (String(path).startsWith("/communications")) return Promise.resolve({ data: { entries: [] } });
    return Promise.resolve({ data: [] });
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const $ = (id) => document.querySelector(`[data-testid="${id}"]`);
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

function type(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

test("saving sends the record as the form opened with it, alongside the edits", async () => {
  await act(async () => { root.render(<Clients userId="u1" can={() => true} />); });
  await flush();
  await act(async () => { $(`edit-client-${CLIENT.id}`).click(); });
  await act(async () => { type($("client-credits-input"), "12"); });
  await act(async () => { $("save-client-button").click(); });
  await flush();

  expect(api.put).toHaveBeenCalledTimes(1);
  const [url, body] = api.put.mock.calls[0];
  expect(url).toBe(`/clients/${CLIENT.id}`);
  expect(body.credits).toBe(12);
  // what the form showed: the server measures the +2 from here and leaves
  // every field the operator didn't touch alone
  expect(body.base).toMatchObject({ credits: 10, boarding_credits: 2, account_balance: 0, evaluation_notes: "Met on Monday." });
  expect(body.base.credits).not.toBe(body.credits);
});

test("a double-click saves once, and the save carries this form's id", async () => {
  let release;
  api.put.mockImplementation(() => new Promise((r) => { release = () => r({ data: CLIENT }); }));
  await act(async () => { root.render(<Clients userId="u1" can={() => true} />); });
  await flush();
  await act(async () => { $(`edit-client-${CLIENT.id}`).click(); });
  await act(async () => { $("save-client-button").click(); $("save-client-button").click(); });
  expect(api.put).toHaveBeenCalledTimes(1);
  expect(api.put.mock.calls[0][1].edit_id).toMatch(/^c1-/);
  await act(async () => { release(); });
  await flush();
});
