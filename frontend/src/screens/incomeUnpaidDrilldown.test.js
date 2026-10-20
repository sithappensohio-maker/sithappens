/**
 * The weekly "Unpaid" tile gave a total with no way to see which booking(s)
 * it was made of — a single ledger row's own stored balance_due can read
 * differently once a shared family bill or a tab credit is involved, so
 * staff could stare at the Transactions list and never find a matching
 * number. Clicking the tile now expands the exact rows behind it, sourced
 * from the same data the total itself is computed from. Mounted.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import Income from "./Income";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(async () => ({ data: [] })), post: jest.fn(), put: jest.fn(), delete: jest.fn(), defaults: { baseURL: "/api" } },
  formatErr: (e) => String(e || ""),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("../lib/useConfirm", () => ({ useConfirm: () => jest.fn(async () => true), usePromptDialog: () => jest.fn(async () => null) }));
jest.mock("../lib/auth", () => ({ useAuth: () => ({ can: () => true, user: { role: "admin" } }) }));
jest.mock("../components/PageHero", () => () => null);
jest.mock("../components/admin/AdminTabs", () => () => null);
jest.mock("../components/CollapsibleDateGroups", () => () => null);
jest.mock("../components/Lightbox", () => () => null);
jest.mock("./AccountsReceivable", () => () => null);
jest.mock("./SalesTaxFiling", () => () => null);
jest.mock("../components/TaxCenter", () => () => null);
jest.mock("../components/SalesTaxDueTile", () => ({ FINANCE_TARGET_KEY: "fin" }));
jest.mock("../components/TakePaymentModal", () => () => null);
jest.mock("../components/FinancialCorrectionModal", () => () => null);
jest.mock("../lib/imageCompress", () => ({ compressImage: jest.fn() }));

const { api } = require("../lib/api");
global.IS_REACT_ACT_ENVIRONMENT = true;

const WEEKLY_WITH_DETAIL = {
  week_start: "2026-10-12", week_end: "2026-10-18",
  completed_total: 600, booked_total: 0, paid_total: 578,
  unpaid_total: 22, ar_outstanding_total: 1800, ar_outstanding_count: 1,
  unpaid_detail: [{ booking_id: "bk-1", dog_name: "Rex", client_name: "Sam", billed_to: "Pat", amount: 22, service_type: "daycare", checked_out_at: "2026-10-15T20:00:00Z" }],
  credits_redeemed: 0, completed_count: 10, booked_count: 10,
  credit_pack_redeemed_count: 0, credit_pack_redeemed_value: 0,
  by_service: [{ name: "Credit Packs", count: 5, total: 515 }],
};
const WEEKLY_NO_DETAIL = { ...WEEKLY_WITH_DETAIL, unpaid_total: 0, unpaid_detail: [], ar_outstanding_total: 0, ar_outstanding_count: 0 };

let container, root;
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 9, 20, 12, 0));
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset();
});
afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  jest.useRealTimers();
});
const flush = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await Promise.resolve(); }); };
const q = (id) => container.querySelector(`[data-testid="${id}"]`);

test("the Unpaid tile expands to show the exact booking(s) behind the total", async () => {
  api.get.mockImplementation((url) => Promise.resolve({ data: url === "/transactions/weekly-summary" ? WEEKLY_WITH_DETAIL : [] }));
  await act(async () => { root = createRoot(container); root.render(<Income />); });
  await flush();

  expect(q("unpaid-detail-list")).toBeNull();
  await act(async () => { q("unpaid-tile-toggle").click(); });
  await flush();

  const row = q("unpaid-detail-row-bk-1");
  expect(row).not.toBeNull();
  expect(row.textContent).toContain("Rex");
  expect(row.textContent).toContain("Sam");
  expect(row.textContent).toContain("billed to Pat");
  expect(row.textContent).toContain("$22.00");
});

test("nothing unpaid: the tile isn't clickable", async () => {
  api.get.mockImplementation((url) => Promise.resolve({ data: url === "/transactions/weekly-summary" ? WEEKLY_NO_DETAIL : [] }));
  await act(async () => { root = createRoot(container); root.render(<Income />); });
  await flush();
  expect(q("unpaid-tile-toggle").disabled).toBe(true);
});
