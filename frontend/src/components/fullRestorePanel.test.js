/**
 * Settings → Restore from Backup, mounted. A real backup is bigger than one
 * request may be, so a file goes up in pieces, backups on the server restore
 * by name, and the restore itself is a job this panel follows.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  formatErr: (e) => (typeof e === "string" ? e : e ? JSON.stringify(e) : ""),
}));
jest.mock("../lib/useConfirm", () => ({ useConfirm: () => () => Promise.resolve(true) }));

const { api } = require("../lib/api");
const FullRestorePanel = require("./FullRestorePanel").default;

global.IS_REACT_ACT_ENVIRONMENT = true;

const FILES = [
  { name: "sit-happens-2026-09-26_030000_000001.json.gz", kind: "auto", size_bytes: 20_400_000, modified_at: "2026-09-26T03:00:00+00:00", total_docs: 265737 },
  { name: "uploads/uploaded-20260926T101500-laptop.json", kind: "uploaded", size_bytes: 154_000_000, modified_at: "2026-09-26T10:15:00+00:00" },
];

let container; let root; let ticks;
beforeEach(() => {
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  ticks = [];
  jest.spyOn(global, "setInterval").mockImplementation((fn) => { ticks.push(fn); return ticks.length; });
  jest.spyOn(global, "clearInterval").mockImplementation(() => {});
  api.get.mockReset(); api.post.mockReset(); api.put.mockReset(); api.delete.mockReset();
  api.delete.mockResolvedValue({ data: { ok: true } });
  localStorage.clear();
});
afterEach(() => { act(() => root.unmount()); container.remove(); jest.restoreAllMocks(); });

const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const flush = () => act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); });
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await flush(); };
const tick = async () => { await act(async () => { await ticks[ticks.length - 1](); }); await flush(); };

function routeGets({ jobs = [], job = null } = {}) {
  api.get.mockImplementation((url) => {
    if (url === "/backup/files") return Promise.resolve({ data: { files: FILES } });
    if (url === "/backup/restore-jobs") return Promise.resolve({ data: jobs });
    if (url.startsWith("/backup/restore-jobs/")) return Promise.resolve({ data: job() });
    return Promise.resolve({ data: {} });
  });
}

async function pick(file) {
  const input = q("backup-file");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
  await flush();
}

test("lists the backups on the server; only uploaded ones can be deleted", async () => {
  routeGets();
  act(() => root.render(<FullRestorePanel />)); await flush();
  expect(q(`server-backup-${FILES[0].name}`).textContent).toContain("Nightly backup");
  expect(q(`server-backup-${FILES[0].name}`).textContent).toContain("265737 records");
  expect(q(`server-backup-delete-${FILES[0].name}`)).toBeNull();
  expect(q(`server-backup-delete-${FILES[1].name}`)).not.toBeNull();
});

test("restoring a server backup starts a job and follows it to the end", async () => {
  let state = { id: "job-1", status: "running", phase: "restoring", current: "clients", collections_done: 3, collections_total: 140 };
  routeGets({ job: () => state });
  api.post.mockResolvedValue({ data: { id: "job-1", status: "running", phase: "queued" } });
  act(() => root.render(<FullRestorePanel />)); await flush();

  await click(q(`server-backup-restore-${FILES[0].name}`));
  expect(api.post).toHaveBeenCalledWith("/backup/restore-jobs", { name: FILES[0].name, mode: "merge" });
  await tick();
  expect(q("restore-progress").textContent).toContain("clients · 3 of 140 collections");

  state = { ...state, status: "done", phase: "done", summary: { clients: { mode: "merge", upserted: 13399 } },
            kept_live: 0, pre_restore_snapshot: { ok: true, filename: "pre-restore-full-x.json" } };
  await tick();
  expect(q("restore-progress")).toBeNull();
  expect(q("restore-msg").textContent).toContain("Restored ✓ clients: 13399");
  expect(q("restore-msg").textContent).toContain("pre-restore-full-x.json");
});

test("a file from this computer goes up in pieces, then restores from the server copy", async () => {
  routeGets({ job: () => ({ id: "job-2", status: "running", phase: "reading" }) });
  api.post.mockImplementation((url) => {
    if (url === "/backup/uploads") return Promise.resolve({ data: { upload_id: "u1", chunk_bytes: 4 } });
    if (url === "/backup/uploads/u1/finish") return Promise.resolve({ data: { name: "uploads/uploaded-x-mine.json.gz", total_docs: 7 } });
    if (url === "/backup/restore-jobs") return Promise.resolve({ data: { id: "job-2", status: "running", phase: "queued" } });
    return Promise.reject(new Error(`unexpected ${url}`));
  });
  api.put.mockResolvedValue({ data: { ok: true } });
  act(() => root.render(<FullRestorePanel />)); await flush();
  await click(q("mode-replace"));

  await pick(new File([new Uint8Array(10)], "mine.json.gz"));
  expect(q("backup-preview").textContent).toContain("uploaded in pieces");
  await click(q("backup-restore"));

  expect(api.put.mock.calls.map((c) => c[0])).toEqual([
    "/backup/uploads/u1/chunks/0", "/backup/uploads/u1/chunks/4", "/backup/uploads/u1/chunks/8"]);
  expect(api.put.mock.calls[2][1].size).toBe(2);
  expect(api.post).toHaveBeenCalledWith("/backup/restore-jobs", { name: "uploads/uploaded-x-mine.json.gz", mode: "replace" });
});

test("a restore already running is picked back up when the page opens", async () => {
  const running = { id: "job-3", status: "running", phase: "snapshot", started_at: "2026-09-26T10:00:00+00:00" };
  routeGets({ jobs: [running], job: () => running });
  act(() => root.render(<FullRestorePanel />)); await flush();
  expect(q("restore-progress").textContent).toContain("safety snapshot");
  expect(q("backup-restore").disabled).toBe(true);
  expect(q("mode-replace").disabled).toBe(true);
});

test("a restore that ended while the owner was away is reported once", async () => {
  const failed = { id: "job-4", status: "failed", error: "The backup file couldn't be read: BadGzipFile" };
  routeGets({ jobs: [failed] });
  act(() => root.render(<FullRestorePanel />)); await flush();
  expect(q("restore-msg").textContent).toContain("Restore failed: The backup file couldn't be read");
  act(() => root.unmount()); root = createRoot(container);
  act(() => root.render(<FullRestorePanel />)); await flush();
  expect(q("restore-msg")).toBeNull();
});

test("a failed upload says so and starts nothing", async () => {
  routeGets();
  api.post.mockImplementation((url) => (url === "/backup/uploads"
    ? Promise.resolve({ data: { upload_id: "u2", chunk_bytes: 4 } })
    : Promise.reject(new Error(`unexpected ${url}`))));
  api.put.mockRejectedValue({ response: { status: 400, data: { detail: "That piece falls outside the file" } } });
  act(() => root.render(<FullRestorePanel />)); await flush();
  await pick(new File([new Uint8Array(6)], "big.json.gz"));
  await click(q("backup-restore"));
  expect(q("restore-msg").textContent).toContain("Upload failed");
  expect(api.post).not.toHaveBeenCalledWith("/backup/restore-jobs", expect.anything());
  expect(api.delete).toHaveBeenCalledWith("/backup/uploads/u2");
});
