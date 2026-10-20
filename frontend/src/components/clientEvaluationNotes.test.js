/**
 * `evaluation_notes` on the client record is written by two flows — the
 * auto-generated Meet & Greet summary, and the status-change note staff
 * type into ClientStatusPill ("Passed eval — friendly with all sizes") —
 * but nothing ever displayed it, so a note staff wrote vanished from the
 * UI for good. Mounted, not source-pinned.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import ClientHub from "./ClientHub";

jest.mock("../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() } }));
jest.mock("./IntakeFormsSection", () => () => null);
jest.mock("./CommunicationLog", () => () => null);
jest.mock("./TrophyWall", () => () => null);
jest.mock("./AdminClientPaymentPlans", () => () => null);
jest.mock("./BillFixModal", () => () => null);
jest.mock("./Avatar", () => () => null);

const { api } = require("../lib/api");

global.IS_REACT_ACT_ENVIRONMENT = true;

let container, root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset(); api.get.mockResolvedValue({ data: [] });
  api.post.mockReset();
});
afterEach(() => { act(() => root?.unmount()); container.remove(); });

const flush = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve(); }); };
const mount = async (client) => {
  await act(async () => {
    root = createRoot(container);
    root.render(<ClientHub client={client} onClose={() => {}} can={() => true} />);
  });
  await flush();
};
const q = (id) => container.querySelector(`[data-testid="${id}"]`);

test("evaluation notes staff wrote are shown on the client record", async () => {
  await mount({ id: "c-pat", name: "Pat", dogs: [],
    evaluation_notes: "Meet & Greet request (2026-10-15). Dog: Neo.\n[2026-10-16 · evaluated] Passed eval — friendly with all sizes" });
  expect(q("hub-evaluation-notes").textContent).toContain("Passed eval — friendly with all sizes");
});

test("no evaluation notes: nothing rendered, no empty card", async () => {
  await mount({ id: "c-sam", name: "Sam", dogs: [] });
  expect(q("hub-evaluation-notes")).toBeNull();
});
