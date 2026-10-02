/**
 * Settings → Data Export (audit: "Data Export CSVs have empty money columns
 * and stop at 90 days"). The panel promised the row count would show "so
 * nothing is silently truncated", but nothing ever read it and the server
 * cut every file at 50,000 rows. Now every row is written and the download
 * message says how many. Mounted, not source-pinned.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import DataExportPanel, { downloadedMessage } from "./DataExportPanel";
import { api } from "../lib/api";
import { toast } from "sonner";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), defaults: { baseURL: "/api" } },
  formatErr: (e) => String(e || ""),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
global.IS_REACT_ACT_ENVIRONMENT = true;

let container, root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  global.URL.createObjectURL = jest.fn(() => "blob:x");
  global.URL.revokeObjectURL = jest.fn();
  jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});   // jsdom can't save files
  api.get.mockReset();
  toast.success.mockReset();
});
afterEach(() => { act(() => root?.unmount()); container.remove(); root = null; });
const flush = () => act(() => new Promise((r) => setTimeout(r, 0)));

test.each([
  ["Bookings", "1234", "Bookings CSV downloaded · 1,234 rows"],
  ["Income", "1", "Income CSV downloaded · 1 row"],
  ["Income", "0", "Income CSV downloaded · 0 rows"],
  ["Clients", undefined, "Clients CSV downloaded"],
  ["Clients", "", "Clients CSV downloaded"],
])("%s with %s rows", (label, n, message) => {
  expect(downloadedMessage(label, n)).toBe(message);
});

test("the download says how many rows the file holds, and the panel no longer promises what it didn't do", async () => {
  api.get.mockImplementation((url) => url === "/export-index"
    ? Promise.resolve({ data: { bookings: 1234, income: 5 } })
    : Promise.resolve({ data: "id\n", headers: { "x-row-count": "1234" } }));
  await act(async () => { root = createRoot(container); root.render(<DataExportPanel />); });
  await flush();
  expect(container.textContent).not.toContain("silently truncated");
  expect(container.textContent).toContain("nothing is cut off");
  expect(container.querySelector('[data-testid="export-row-bookings"]').textContent).toContain("archived ones included");
  await act(async () => { container.querySelector('[data-testid="export-btn-bookings"]').click(); });
  await flush();
  expect(api.get).toHaveBeenCalledWith("/export/bookings", { responseType: "blob" });
  expect(toast.success).toHaveBeenCalledWith("Bookings CSV downloaded · 1,234 rows");
});
