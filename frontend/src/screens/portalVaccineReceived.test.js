/**
 * "View Vaccine Records" (Home card, booking-blocked popup, setup checklist)
 * never asks again for a vaccine the client already sent for review. It used
 * to reopen the upload wizard at "Upload Rabies now — 0 of 3 submitted",
 * which clients read as their upload having failed. Mounts the real Portal.
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
  "../components/PortalPhotography", "../components/NeedHelpCard", "../components/PortalAnnouncementsCard", "../components/PortalTrainingTipCard",
  "../components/PortalEngagementHub", "../components/PortalSuccessPanel",
  "../components/ServicesByCategory", "../components/DogFactCard", "../components/DailyTriviaCard", "./Tutorials",
  "../components/brand/HuskyDogImage",
]) jest.doMock(p, stub);

// The Home card's "View Vaccine Records" button, and the two upload windows as markers.
jest.doMock("../components/PortalNeedsAttentionCard", () => ({
  __esModule: true,
  default: ({ onAction }) => <button data-testid="view-vaccine-records" onClick={() => onAction("vaccines")}>View Vaccine Records</button>,
}));
jest.doMock("../components/VaccineUploadWizard", () => ({
  __esModule: true,
  default: ({ queue }) => <div data-testid="upload-wizard">{queue.map((x) => `${x.dog.id}:${x.vaccine}`).join(",")}</div>,
}));
jest.doMock("../components/VaccineQuickUploadModal", () => ({
  __esModule: true,
  default: ({ initialDogId }) => <div data-testid="vaccine-records">{initialDogId}</div>,
}));

jest.mock("../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn(), put: jest.fn() }, formatErr: (d) => String(d || "") }));
jest.mock("../lib/auth", () => {
  const auth = { user: { name: "Pat", client_id: "c-pat" }, logout: () => {}, reloadUser: () => Promise.resolve() };
  return { useAuth: () => auth };
});
jest.mock("../lib/useAuthCart", () => ({ useAuthCart: () => ({ notices: [], dismissNotices: () => {} }) }));
jest.mock("../lib/useConfirm", () => { const c = () => Promise.resolve(true); return { useConfirm: () => c }; });
jest.mock("../lib/useLiveRefresh", () => ({ useLiveRefresh: jest.fn() }));
jest.mock("../lib/imageCompress", () => ({ compressImage: jest.fn() }));
jest.mock("../lib/freeCourseClaim", () => ({ consumeFreeClaimIntent: () => null }));
jest.mock("../lib/shopGuestCart", () => ({ readGuestCart: () => null, consumePendingShopRedirect: () => null }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../lib/theme", () => {
  const theme = { branding: {} };
  return { useFeature: () => true, useTheme: () => theme, PortalSurfaceProvider: ({ children }) => children };
});

const { api } = require("../lib/api");
const Portal = require("./Portal").default;
global.IS_REACT_ACT_ENVIRONMENT = true;

let container; let root; let dogs;
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-10-30T15:00:00Z"));
  const OBJECTS = {
    "/portal/trophies": { client_trophies: [], dog_trophies: [] },
    "/waivers/me": { signed: true },
    "/settings/public": {},
    "/portal/setup-status": { steps: [], booking_locked: false },
    "/me/messages-unread-count": { count: 0 },
    "/portal/me": {},
  };
  api.get.mockImplementation((url) => Promise.resolve({ data: url === "/dogs" ? dogs : (OBJECTS[url] ?? []) }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); jest.useRealTimers(); });

const q = (id) => container.querySelector(`[data-testid="${id}"]`);
async function openViewVaccineRecords() {
  await act(async () => { root.render(<Portal />); });
  await act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });
  await act(async () => { q("view-vaccine-records").dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}

test("with every vaccine already sent for review, it shows the records instead of asking to upload again", async () => {
  dogs = [{ id: "d1", name: "Rex", vaccines: {}, vaccines_pending_review: { rabies: true, bordetella: true, dhpp: true } }];
  await openViewVaccineRecords();
  expect(q("upload-wizard")).toBeNull();
  expect(q("vaccine-records").textContent).toBe("d1");
});

test("with some sent and some still missing, it asks only for the missing ones", async () => {
  dogs = [{ id: "d1", name: "Rex", vaccines: {}, vaccines_pending_review: { rabies: true } }];
  await openViewVaccineRecords();
  expect(q("upload-wizard").textContent).toBe("d1:bordetella,d1:dhpp");
});
