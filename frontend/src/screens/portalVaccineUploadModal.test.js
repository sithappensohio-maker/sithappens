/* The single-vaccine upload window (opened from a refused booking's "upload
 * vaccines" fix) sends an upload id: a retry of the same date and photo reuses
 * it, a changed date gets a new one, and a lost reply says a resend won't
 * duplicate it. Mounts the real VaccineUploadModal from Portal.jsx.
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
  "../components/PortalEventCard", "../components/ClientSidebar", "../components/ClientMobileNav",
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

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
  formatErr: (e) => e?.response?.data?.detail || "Something went wrong.",
}));
jest.mock("../lib/auth", () => ({ useAuth: () => ({ user: { name: "Pat", client_id: "c-pat" }, logout: () => {}, reloadUser: () => Promise.resolve() }) }));
jest.mock("../lib/useAuthCart", () => ({ useAuthCart: () => ({ notices: [], dismissNotices: () => {} }) }));
jest.mock("../lib/useConfirm", () => { const c = () => Promise.resolve(true); return { useConfirm: () => c }; });
jest.mock("../lib/useLiveRefresh", () => ({ useLiveRefresh: jest.fn() }));
jest.mock("../lib/imageCompress", () => ({ compressImage: jest.fn(async () => "data:image/jpeg;base64,QUJD") }));
jest.mock("../lib/freeCourseClaim", () => ({ consumeFreeClaimIntent: () => null }));
jest.mock("../lib/shopGuestCart", () => ({ readGuestCart: () => null, consumePendingShopRedirect: () => null }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../lib/theme", () => ({ useFeature: () => true, useTheme: () => ({ branding: {} }), PortalSurfaceProvider: ({ children }) => children }));

const { api } = require("../lib/api");
const { VaccineUploadModal } = require("./Portal");
global.IS_REACT_ACT_ENVIRONMENT = true;

const DOG = { id: "d1", name: "Rex", vaccines: {}, vaccines_pending_review: {} };
let container; let root;
beforeEach(() => {
  api.post.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const setDate = async (value) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(q("vaccine-expiry-input"), value);
  await act(async () => { q("vaccine-expiry-input").dispatchEvent(new Event("input", { bubbles: true })); });
};
const attach = async () => {
  const el = q("vaccine-photo-input");
  Object.defineProperty(el, "files", { configurable: true, value: [new File(["x"], "cert.jpg", { type: "image/jpeg" })] });
  await act(async () => { el.dispatchEvent(new Event("change", { bubbles: true })); });
  await flush();
};
const save = async () => { await act(async () => { q("vaccine-save").dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await flush(); };
const refused = (detail) => ({ response: { status: 400, data: { detail } } });

test("Submit again with the same date and photo reuses the id; a changed date gets a new one", async () => {
  const onSaved = jest.fn();
  api.post.mockRejectedValueOnce(refused("Please upload a vaccine certificate photo."))
    .mockRejectedValueOnce(refused("Invalid expiry date"))
    .mockResolvedValueOnce({ data: { ok: true } });
  await act(async () => { root.render(<VaccineUploadModal dog={DOG} vaccine="rabies" onClose={() => {}} onSaved={onSaved}/>); });
  await setDate("2031-01-01");
  await attach();
  await save();
  expect(container.textContent).toContain("Please upload a vaccine certificate photo.");
  await save();                          // same content again
  await setDate("2032-01-01");
  await save();                          // corrected date
  const [first, second, third] = api.post.mock.calls.map(([, body]) => body);
  expect(second.upload_id).toBe(first.upload_id);
  expect(third.upload_id).not.toBe(first.upload_id);
  expect(third.expires_on).toBe("2032-01-01");
  expect(onSaved).toHaveBeenCalledTimes(1);
});

test("a reply that can't be confirmed doesn't say 'something went wrong'", async () => {
  jest.useFakeTimers();
  try {
    api.post.mockRejectedValue(Object.assign(new Error("Network Error"), { request: {} }));
    await act(async () => { root.render(<VaccineUploadModal dog={DOG} vaccine="rabies" onClose={() => {}} onSaved={() => {}}/>); });
    await setDate("2031-01-01");
    await act(async () => { const el = q("vaccine-photo-input"); Object.defineProperty(el, "files", { configurable: true, value: [new File(["x"], "c.jpg", { type: "image/jpeg" })] }); el.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => { q("vaccine-save").dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(q("vaccine-expiry-input").disabled).toBe(true);   // locked while it sends
    await act(async () => { jest.advanceTimersByTime(1600); });
    await act(async () => { for (let i = 0; i < 6; i += 1) await Promise.resolve(); });
    expect(api.post).toHaveBeenCalledTimes(2);   // retried once, same id
    expect(api.post.mock.calls[1][1].upload_id).toBe(api.post.mock.calls[0][1].upload_id);
    expect(container.textContent).toContain("couldn't reach Sit Happens to confirm this upload");
    expect(container.textContent).not.toMatch(/something went wrong/i);
  } finally { jest.useRealTimers(); }
});
