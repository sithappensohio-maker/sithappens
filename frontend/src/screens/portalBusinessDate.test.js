/**
 * The client portal uses Ohio's date for "today" (audit #47): an
 * announcement that runs through Sep 30 is still up at 9:30 PM Eastern on
 * Sep 30, when the UTC date is already Oct 1. Mounted, not source-pinned.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";

const Null = () => null;
const stub = () => ({ __esModule: true, default: Null, PortalSetupSuccess: Null, PortalSetupPreview: Null,
                      DogFactCard: Null, DailyTriviaCard: Null });
for (const p of [
  "../components/WaiverModal", "../components/PortalAgreements", "../components/Lightbox", "../components/PortalDogModal",
  "../components/PortalProfileModal", "../components/PortalTrainingCard", "../components/PortalLearn", "../components/PortalProgress",
  "../components/PortalFilesSection", "../components/PortalGiftCards", "../components/IntakePortalSection", "../components/PortalBookWizard",
  "../components/HomeworkIncentivesPanel", "../components/training/ClientTodayPanel", "../components/training/PracticePanel", "./SchoolApp",
  "../components/school/OnlineSchoolHeroCard", "../components/MultiDateCalendar", "../components/PortalHomeActionCard",
  "../components/PortalEventCard", "../components/premium/PremiumButton", "../components/ClientSidebar", "../components/ClientMobileNav",
  "../components/ClientProfileMenu", "../components/TextSizePicker", "../components/TrophyWall", "../components/TrophyCelebration",
  "../components/CareLogStrip", "../components/HomeworkStreakTile", "../components/RescheduleRequestModal", "../components/PortalPaymentPlans",
  "../components/PortalMessages", "../components/PortalSetupChecklist", "../components/PortalBookingBlockedModal",
  "../components/RequestMeetGreetModal", "../components/SignedWaiverModal", "../components/NeedsPasswordCard",
  "../components/PaymentOptionsCard", "../components/PortalInvoices", "../components/PortalShop", "../components/GuestCartMergeReview",
  "../components/PortalPhotography", "../components/NeedHelpCard", "../components/VaccineUploadWizard",
  "../components/VaccineQuickUploadModal", "../components/PortalAnnouncementsCard", "../components/PortalTrainingTipCard",
  "../components/PortalEngagementHub", "../components/PortalNeedsAttentionCard", "../components/PortalSuccessPanel",
  "../components/ServicesByCategory", "../components/DogFactCard", "../components/DailyTriviaCard", "./Tutorials",
  "../components/brand/HuskyDogImage",
]) jest.doMock(p, stub);

jest.mock("../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn(), put: jest.fn() }, formatErr: (d) => String(d || "") }));
jest.mock("../lib/auth", () => {
  const auth = { user: { name: "Pat", client_id: "c-pat" }, logout: () => {}, reloadUser: () => Promise.resolve() };
  return { useAuth: () => auth };   // stable: Portal's loaders depend on reloadUser
});
jest.mock("../lib/useAuthCart", () => ({ useAuthCart: () => ({ notices: [], dismissNotices: () => {} }) }));
jest.mock("../lib/useConfirm", () => { const c = () => Promise.resolve(true); return { useConfirm: () => c }; });
jest.mock("../lib/useLiveRefresh", () => ({ useLiveRefresh: jest.fn() }));
jest.mock("../lib/imageCompress", () => ({ compressImage: jest.fn() }));
jest.mock("../lib/freeCourseClaim", () => ({ consumeFreeClaimIntent: () => null }));
jest.mock("../lib/shopGuestCart", () => ({ readGuestCart: () => null, consumePendingShopRedirect: () => null }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../lib/theme", () => {
  const theme = { branding: { client_portal_controls: { announcement: {
    enabled: true, title: "Closed tomorrow", message: "Back Friday.", start_date: "2026-09-28", end_date: "2026-09-30",
  } } } };
  return { useFeature: () => true, useTheme: () => theme, PortalSurfaceProvider: ({ children }) => children };
});

const { api } = require("../lib/api");
const Portal = require("./Portal").default;

global.IS_REACT_ACT_ENVIRONMENT = true;

let container, root;
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-10-01T01:30:00Z")); // Sep 30, 9:30 PM in Ohio
  const OBJECTS = {
    "/portal/trophies": { client_trophies: [], dog_trophies: [] },
    "/waivers/me": { signed: true },
    "/settings/public": {},
    "/portal/setup-status": { steps: [], booking_locked: false },
    "/me/messages-unread-count": { count: 0 },
    "/portal/me": {},
  };
  api.get.mockImplementation((url) => Promise.resolve({ data: OBJECTS[url] ?? [] }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); jest.useRealTimers(); });

test("an announcement that ends today is still shown at 9:30 PM Eastern", async () => {
  await act(async () => { root.render(<Portal />); });
  await act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });
  const banner = container.querySelector('[data-testid="portal-admin-announcement"]');
  expect(banner).toBeTruthy();
  expect(banner.textContent).toContain("Closed tomorrow");
});
