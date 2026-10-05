/**
 * A serious incident can be marked read from the Incidents list, and then shows
 * as read (audit #35). Minor incidents get no control. Mounted.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import Incidents from "./Incidents";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  formatErr: (e) => String(e),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../lib/useConfirm", () => ({ useConfirm: () => jest.fn(async () => true) }));
jest.mock("../lib/imageCompress", () => ({ compressImage: jest.fn() }));
jest.mock("../components/PageHero", () => () => null);

const { api } = require("../lib/api");
global.IS_REACT_ACT_ENVIRONMENT = true;

const BITE = { id: "inc-bite", dog_id: "d1", dog_name: "Biter", client_name: "Pat", type: "bite", severity: "severe",
  date: "2031-06-09", reported_by: "Staff", description: "Bit a visitor", photos: [], edit_history: [] };
const MINOR = { id: "inc-minor", dog_id: "d1", dog_name: "Scratch", client_name: "Pat", type: "other", severity: "minor",
  date: "2031-06-09", reported_by: "Staff", description: "Scratched a toy", photos: [], edit_history: [] };
let acked = false;

let container, root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  acked = false;
  api.get.mockReset().mockImplementation(async (url) => {
    if (url === "/incidents") return { data: [acked ? { ...BITE, owner_acknowledged_at: "2031-06-09T12:00:00+00:00", owner_acknowledged_by: "Owner" } : BITE, MINOR] };
    if (url === "/dogs") return { data: [{ id: "d1", name: "Biter" }] };
    return { data: [] };
  });
  api.post.mockReset().mockImplementation(async () => { acked = true; return { data: { ok: true } }; });
});
afterEach(() => { act(() => root?.unmount()); container.remove(); });

const flush = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve(); }); };
const q = (id) => container.querySelector(`[data-testid="${id}"]`);

test("a serious incident can be marked read, and then shows as read; a minor one has no control", async () => {
  await act(async () => {
    root = createRoot(container);
    root.render(<Incidents />);
  });
  await flush();

  expect(q("incident-inc-minor")).not.toBeNull();
  expect(q("ack-incident-inc-minor")).toBeNull();
  expect(q("ack-incident-inc-bite")).not.toBeNull();
  expect(q("incident-read-inc-bite")).toBeNull();

  await act(async () => { q("ack-incident-inc-bite").click(); });
  await flush();

  expect(api.post).toHaveBeenCalledWith("/admin/incidents/inc-bite/acknowledge");
  expect(q("incident-read-inc-bite")).not.toBeNull();
  expect(q("ack-incident-inc-bite")).toBeNull();
});
