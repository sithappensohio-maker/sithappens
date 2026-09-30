/* "Open" on an Action Center item goes where the work is (audit #44).
 *
 * "Dogs not checked in", help requests, quote requests and stuck bookings all
 * said "the Today screen", which from Today did nothing. Now Open lands on
 * Today scrolled to that box — fetching the lists again first, so a request
 * that arrived after the page opened is there to scroll to. Mounted: the real
 * Today lists and the real help-requests box.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";

let mockQuotes = [];
let mockHelp = [];
jest.mock("../lib/auth", () => ({ useAuth: () => ({ can: () => true }) }));
jest.mock("../lib/api", () => ({
  api: {
    get: jest.fn((url) => Promise.resolve({ data: url.startsWith("/admin/quote-requests") ? mockQuotes
      : url === "/admin/help-requests" ? mockHelp : url === "/settings" ? {} : [] })),
    post: jest.fn(() => Promise.resolve({ data: {} })),
    put: jest.fn(() => Promise.resolve({ data: {} })),
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
jest.mock("./OwnerClockAndEndOfDay", () => ({ OwnerClock: () => null, EndOfDayPanel: () => null }));
jest.mock("./MileageDashTile", () => ({ MileageDashTile: () => null }));
jest.mock("./SalesTaxDueTile", () => ({ SalesTaxDueTile: () => null }));
jest.mock("./TaxCenter", () => ({ TaxCenterTile: () => null }));
jest.mock("./DogFactCard", () => ({ DogFactCard: () => null }));
jest.mock("./DailyTriviaCard", () => ({ DailyTriviaCard: () => null }));
jest.mock("./AdminTrainingTipCard", () => () => null);

const TodayOperations = require("./TodayOperations").default;
const { runTodayBrainCTA } = require("../lib/todayBrain");

global.IS_REACT_ACT_ENVIRONMENT = true;

const ROSTER = [{ id: "bk-1", dog_id: "d-1", dog_name: "Luna", client_id: "c-1", client_name: "Dana",
  service_type: "daycare", date: "2026-09-30", status: "approved" }];
const item = (kind) => ({ kind, cta: { type: "open_screen", screen: "dashboard" } });

let container; let root; let scrolled;
const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const flush = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });

beforeEach(async () => {
  mockQuotes = []; mockHelp = []; scrolled = [];
  Element.prototype.scrollIntoView = function () { scrolled.push(this.getAttribute("data-testid")); };
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  await act(async () => { root.render(<TodayOperations stats={{ today_roster: ROSTER }} can={() => true} />); });
  await flush();
});
afterEach(() => { act(() => root.unmount()); container.remove(); jest.useRealTimers(); delete Element.prototype.scrollIntoView; });

async function open(kind) {
  const onNavigate = jest.fn();
  jest.useFakeTimers();
  await act(async () => { runTodayBrainCTA(item(kind), { onNavigate }); });
  await flush();
  await act(async () => { jest.advanceTimersByTime(400); });
  return onNavigate;
}

test("a quote request that came in after Today opened: Open fetches it and scrolls to it", async () => {
  expect(q("today-quote-requests")).toBeNull();
  mockQuotes = [{ id: "q1", client_name: "Dana", item_name: "Board & Train", status: "open" }];
  const onNavigate = await open("quote_request");
  expect(onNavigate).toHaveBeenCalledWith("today");
  expect(q("today-quote-requests")).not.toBeNull();
  expect(scrolled).toContain("today-quote-requests");
  expect(q("today-quote-requests").classList.contains("ring-2")).toBe(true);
});

test("a help request: Open fetches the help box again and scrolls to it", async () => {
  expect(q("dashboard-help-requests")).toBeNull();
  mockHelp = [{ id: "h1", status: "new", type: "problem", subject: "Gate", message: "The gate is stuck" }];
  const onNavigate = await open("help_request");
  expect(onNavigate).toHaveBeenCalledWith("today");
  expect(scrolled).toContain("dashboard-help-requests");
});

test("dogs not checked in: Open scrolls to the check-in board", async () => {
  const onNavigate = await open("no_checkin");
  expect(onNavigate).toHaveBeenCalledWith("today");
  expect(scrolled).toContain("today-checkin-board-wrap");
  expect(q("today-checkin-board-wrap").classList.contains("ring-2")).toBe(true);
});

test("stuck bookings for staff who can't resolve them: the board, where they show as missed checkouts", async () => {
  const onNavigate = await open("stuck_checkout");
  expect(onNavigate).toHaveBeenCalledWith("today");
  expect(scrolled).toContain("today-checkin-board-wrap");
});
