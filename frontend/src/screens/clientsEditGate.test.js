/**
 * Adding, editing and archiving a family needs clients_edit (audit #94). Staff who can only view
 * clients were shown the buttons and refused only after clicking. Mounted.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("../lib/auth", () => ({ useAuth: () => ({ isOwner: () => false, can: () => true }) }));
jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  formatErr: (x) => String(x || ""),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() } }));
jest.mock("../lib/useConfirm", () => ({ useConfirm: () => async () => true, usePromptDialog: () => async () => null, ConfirmProvider: ({ children }) => children }));
jest.mock("../lib/imageCompress", () => ({ compressImage: jest.fn(async () => "data:image/jpeg;base64,QUJD") }));

const { api } = require("../lib/api");
const Clients = require("./Clients").default;
global.IS_REACT_ACT_ENVIRONMENT = true;

const FAMILY = { id: "c1", name: "Sam Owner", email: "sam@example.com", phone: "", address: "", emerg: "", credits: 0,
  training_credits: 0, boarding_credits: 0, account_balance: 0, client_status: "active", dogs: [] };

let container, root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  api.get.mockReset().mockImplementation(async (url) => ({ data: url === "/clients" ? [FAMILY] : [] }));
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const flush = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve(); }); };
const q = (id) => container.querySelector(`[data-testid="${id}"]`);

test("a view-only member of staff is not offered Add Client", async () => {
  await act(async () => { root.render(<Clients userId="u1" can={(k) => k === "clients_view"} />); });
  await flush();
  expect(q("add-client-button")).toBeNull();
});

test("staff with clients_edit still see Add Client", async () => {
  await act(async () => { root.render(<Clients userId="u1" can={(k) => k === "clients_edit" || k === "clients_view"} />); });
  await flush();
  expect(q("add-client-button")).not.toBeNull();
});
