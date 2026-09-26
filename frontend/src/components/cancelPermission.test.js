/**
 * Audit #6 — cancelling a booking needs booking_edit, and adding the
 * cancellation charge also needs take_payments (the server's rule on
 * DELETE /bookings/{id}). The buttons follow it, so Read-only staff aren't
 * shown actions the server now refuses. Mounted, not source-pinned.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";

let mockCan = () => true;
jest.mock("../lib/auth", () => ({ useAuth: () => (mockCan ? { can: (k) => mockCan(k) } : null) }));
jest.mock("../lib/api", () => ({
  api: {
    get: jest.fn(() => Promise.resolve({ data: [] })),
    post: jest.fn(() => Promise.resolve({ data: {} })),
    delete: jest.fn(() => Promise.resolve({ data: {} })),
    defaults: { baseURL: "/api" },
  },
  formatErr: (e) => String(e),
}));
jest.mock("../lib/registerBus", () => ({ emitRegisterChanged: jest.fn() }));
jest.mock("../lib/useLiveRefresh", () => ({ useEditLock: jest.fn() }));
jest.mock("../lib/posAgent", () => ({ printReceipt: jest.fn(), openDrawer: jest.fn() }));
jest.mock("../lib/useConfirm", () => ({ useConfirm: () => jest.fn(() => Promise.resolve(true)) }));
jest.mock("../lib/theme", () => ({ useTheme: () => ({ branding: {} }) }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("./ReceiptLogo", () => () => null);
jest.mock("./AdminBookingModal", () => () => null);
jest.mock("./BookingDetailModal", () => () => null);
jest.mock("./ReportCardModal", () => () => null);
jest.mock("./TrainingSessionWorkspace", () => () => null);
jest.mock("./HelpRequestsTile", () => () => null);
jest.mock("./OwnerClockAndEndOfDay", () => ({ OwnerClock: () => null, EndOfDayPanel: () => null }));
jest.mock("./MileageDashTile", () => ({ MileageDashTile: () => null }));
jest.mock("./SalesTaxDueTile", () => ({ SalesTaxDueTile: () => null }));
jest.mock("./TaxCenter", () => ({ TaxCenterTile: () => null }));
jest.mock("./DogFactCard", () => ({ DogFactCard: () => null }));
jest.mock("./DailyTriviaCard", () => ({ DailyTriviaCard: () => null }));
jest.mock("./AdminTrainingTipCard", () => () => null);

const { CancelBookingModal } = require("./CheckoutModal");
const TodayOperations = require("./TodayOperations").default;

global.IS_REACT_ACT_ENVIRONMENT = true;

const BOOKING = {
  id: "bk-1", dog_id: "d-1", dog_name: "Luna", client_id: "c-1", client_name: "Dana",
  service_type: "daycare", date: "2026-10-01", status: "approved", actual_price: 40,
};

let container; let root;
beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); mockCan = () => true; });

const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

test("no cancellation charge is offered, even to staff who could take one", () => {
  // The business doesn't charge for cancellations (OFFER_CANCELLATION_CHARGE).
  mockCan = () => true;
  act(() => root.render(<CancelBookingModal booking={BOOKING} onClose={() => {}} />));
  expect(q("cancel-refund")).not.toBeNull();
  expect(q("cancel-charge")).toBeNull();
  expect(q("cancel-modal").textContent).toContain("Nothing is charged");
});

test("without take_payments the charge option is gone, the plain cancel stays", () => {
  mockCan = (k) => k !== "take_payments";
  act(() => root.render(<CancelBookingModal booking={BOOKING} onClose={() => {}} />));
  expect(q("cancel-refund")).not.toBeNull();
  expect(q("cancel-charge")).toBeNull();
});

test("outside the signed-in app the charge option fails closed and nothing crashes", () => {
  mockCan = null;
  act(() => root.render(<CancelBookingModal booking={BOOKING} onClose={() => {}} />));
  expect(q("cancel-modal")).not.toBeNull();
  expect(q("cancel-charge")).toBeNull();
});

test("Today shows Cancel only to staff who may cancel", async () => {
  const stats = { today_roster: [BOOKING] };
  act(() => root.render(<TodayOperations stats={stats} can={(k) => k !== "booking_edit"} />));
  await flush();
  expect(container.querySelector('[data-testid="today-checkin-bk-1"]')).not.toBeNull();
  expect(q("today-cancel-bk-1")).toBeNull();

  act(() => root.render(<TodayOperations stats={stats} can={() => true} />));
  await flush();
  expect(q("today-cancel-bk-1")).not.toBeNull();
});
