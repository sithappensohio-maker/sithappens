/**
 * Check In is offered only for a booking that has been approved. A pending booking is
 * refused by the server, so the button is not shown for it (audit #78). Mounted.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";

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

const TodayOperations = require("./TodayOperations").default;

global.IS_REACT_ACT_ENVIRONMENT = true;

const ROW = (over) => ({
  id: "bk", dog_id: "d", dog_name: "Luna", client_id: "c", client_name: "Dana", service_type: "daycare",
  date: "2031-08-10", status: "approved", dropoff_time: "08:00", ...over,
});

let container; let root;
beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

test("an approved dog who has not arrived can be checked in; a pending one cannot", async () => {
  const stats = { today_roster: [ROW({ id: "bk-ok" }), ROW({ id: "bk-pending", status: "pending", dog_name: "Max" })] };
  await act(async () => { root.render(<TodayOperations stats={stats} can={() => true} />); });
  await flush();
  expect(q("today-checkin-bk-ok")).not.toBeNull();
  expect(q("today-checkin-bk-pending")).toBeNull();
  expect(q("today-awaiting-bk-pending")).not.toBeNull();
});
