/* Front desk staff finish a new client (audit #49). Mounted, with the owner
 * flag toggled: a certificate photo staff attach waits for the owner (the
 * typed date goes with the photo, not straight onto the dog), the screen
 * says so, and the owner-only controls (typed portal password, file delete,
 * statuses other than Active) are hidden from staff. */
import { act } from "react";
import { createRoot } from "react-dom/client";

let mockOwner = false;
jest.mock("../lib/auth", () => ({ useAuth: () => ({ isOwner: () => mockOwner, can: () => true }) }));
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

const PROSPECT = { id: "c1", name: "Sam Owner", email: "sam@example.com", phone: "", address: "", emerg: "", credits: 0,
  training_credits: 0, boarding_credits: 0, account_balance: 0, client_status: "prospect", dogs: [] };
const FILES = [{ id: "f1", client_id: "c1", name: "waiver.pdf", content_type: "application/pdf", size_bytes: 10, uploaded_at: "2026-09-30T12:00:00Z" }];

let container, root, items;
beforeEach(() => {
  mockOwner = false;
  items = [PROSPECT];
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  api.get.mockReset(); api.post.mockReset();
  api.get.mockImplementation((path) => {
    if (path === "/clients/page") return Promise.resolve({ data: { items, total: items.length, page: 1, pages: 1 } });
    if (path === "/clients/c1/files") return Promise.resolve({ data: FILES });
    if (String(path).startsWith("/communications")) return Promise.resolve({ data: { entries: [] } });
    return Promise.resolve({ data: [] });
  });
  api.post.mockImplementation((path) => {
    if (path === "/clients") { const c2 = { ...PROSPECT, id: "c2", name: "New Family" }; items = [...items, c2]; return Promise.resolve({ data: c2 }); }
    if (path === "/dogs") return Promise.resolve({ data: { id: "d2" } });
    if (path === "/dogs/d2/vaccine-cert") return Promise.resolve({ data: { ok: true, status: mockOwner ? undefined : "pending_review" } });
    return Promise.resolve({ data: { ok: true } });
  });
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

const $ = (id) => document.querySelector(`[data-testid="${id}"]`);
const flush = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); });
function type(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function addClientWithCert() {
  await act(async () => { root.render(<Clients userId="u1" can={() => true} />); });
  await flush();
  await act(async () => { $("add-client-button").click(); });
  await act(async () => { type($("client-name-input"), "New Family"); });
  const email = [...document.querySelectorAll('input[type="email"]')][0];
  await act(async () => { type(email, "new@example.com"); });
  await act(async () => { type($("quick-dog-name-input"), "Rex"); });
  await act(async () => { type($("quick-dog-rabies-input"), "2031-03-03"); });
  const file = $("quick-dog-rabies-photo-input");
  await act(async () => {
    Object.defineProperty(file, "files", { value: [new File(["x"], "cert.png", { type: "image/png" })], configurable: true });
    file.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flush();
  await act(async () => { $("save-client-button").click(); });
  await flush();
}

test("staff: the date goes with the photo for the owner's approval, and the screen says so", async () => {
  await addClientWithCert();
  const dogPost = api.post.mock.calls.find(([u]) => u === "/dogs");
  expect(dogPost[1].vaccines.rabies).toBe("");
  const certPost = api.post.mock.calls.find(([u]) => u === "/dogs/d2/vaccine-cert");
  expect(certPost[1]).toMatchObject({ vaccine: "rabies", expires_on: "2031-03-03" });
  expect($("claim-toast-c2").textContent).toMatch(/rabies certificate sent to the owner for approval/);
});

test("owner: the date is saved on the dog and nothing waits for approval", async () => {
  mockOwner = true;
  await addClientWithCert();
  const dogPost = api.post.mock.calls.find(([u]) => u === "/dogs");
  expect(dogPost[1].vaccines.rabies).toBe("2031-03-03");
  expect($("claim-toast-c2").textContent).not.toMatch(/approval/);
});

test("staff don't see the typed-password portal login; the owner does", async () => {
  await act(async () => { root.render(<Clients userId="u1" can={() => true} />); });
  await flush();
  await act(async () => { $("manage-client-toggle-c1").click(); });
  expect($("menu-set-password-c1")).toBeNull();
  expect($("menu-send-claim-c1")).not.toBeNull();
});

test("staff can move a prospect to Active and nothing else", async () => {
  await act(async () => { root.render(<Clients userId="u1" can={() => true} />); });
  await flush();
  await act(async () => { $("client-status-pill-c1").click(); });
  expect($("client-status-set-active")).not.toBeNull();
  expect($("client-status-set-rejected")).toBeNull();
  expect($("client-status-set-evaluated")).toBeNull();
  expect($("client-status-owner-note")).not.toBeNull();
});

test("staff see the client's files without a delete button", async () => {
  await act(async () => { root.render(<Clients userId="u1" can={() => true} />); });
  await flush();
  await act(async () => { $("manage-client-toggle-c1").click(); });
  await act(async () => { $("menu-files-c1").click(); });
  await flush();
  expect($("file-row-f1")).not.toBeNull();
  expect($("file-delete-f1")).toBeNull();
});

test("staff opening a Rejected family see it is the owner's call, with no button", async () => {
  items = [{ ...PROSPECT, client_status: "rejected" }];
  await act(async () => { root.render(<Clients userId="u1" can={() => true} />); });
  await flush();
  await act(async () => { $("client-status-pill-c1").click(); });
  expect(document.querySelector('[data-testid^="client-status-set-"]')).toBeNull();
  expect($("client-status-owner-note").textContent).toBe("A family marked Rejected can only be changed by the owner.");
});
