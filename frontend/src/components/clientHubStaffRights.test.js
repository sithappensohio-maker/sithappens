/**
 * The Client Hub's Edit Client and Add Dog buttons follow the viewer's rights (audit #94).
 * A staff member without clients_edit or dogs_edit saw both, then was refused. Mounted.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import ClientHub from "./ClientHub";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(async () => ({ data: [] })), post: jest.fn(), put: jest.fn(), delete: jest.fn(), defaults: { baseURL: "/api" } },
  formatErr: (e) => String(e || ""),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("../lib/useConfirm", () => ({ useConfirm: () => jest.fn(async () => true), usePromptDialog: () => jest.fn(async () => null) }));
jest.mock("./ClientMarketingOptOut", () => () => null);
jest.mock("./CommunicationLog", () => () => null);

global.IS_REACT_ACT_ENVIRONMENT = true;
const CLIENT = { id: "c1", name: "Pat Lee", email: "pat@example.com", dogs: [] };

let container, root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});
afterEach(() => { act(() => root?.unmount()); container.remove(); });
const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));

function mount(can, handlers = {}) {
  return act(async () => {
    root = createRoot(container);
    root.render(<ClientHub client={CLIENT} onClose={() => {}} can={can} {...handlers} />);
  }).then(flush);
}
const q = (id) => container.querySelector(`[data-testid="${id}"]`);

test("without clients_edit or dogs_edit, the hub offers no Edit Client or Add Dog", async () => {
  await mount(() => false, { onEditClient: jest.fn(), onAddDog: jest.fn() });
  expect(q("hub-action-edit")).toBeNull();
  expect(q("hub-action-add-dog")).toBeNull();
});

test("a viewer with the rights sees both, and Add Dog is wired", async () => {
  const onAddDog = jest.fn();
  await mount((perm) => perm === "clients_edit" || perm === "dogs_edit", { onEditClient: jest.fn(), onAddDog });
  expect(q("hub-action-edit")).not.toBeNull();
  await act(async () => { q("hub-action-add-dog").click(); });
  expect(onAddDog).toHaveBeenCalled();
});
