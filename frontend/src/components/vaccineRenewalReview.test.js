/* A vaccine renewal keeps the approved certificate on file (audit #40).
 *
 * Staff reviewing a renewal see that an approved certificate stays on file,
 * Reject says it keeps it (instead of the old "kept unless it exactly
 * matches" warning), and every review names the upload the reviewer saw.
 * The client's card shows a current vaccine as current, with its renewal
 * under review. Mounted, because the screens are what staff and clients read.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";

let mockConfirmCalls = [];
jest.mock("../lib/useConfirm", () => ({ useConfirm: () => (opts) => { mockConfirmCalls.push(opts); return Promise.resolve(true); } }));
jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), delete: jest.fn(), defaults: { baseURL: "/api" } },
  formatErr: (e) => String(e || ""),
}));
jest.mock("sonner", () => ({ toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn(), info: jest.fn() }) }));
jest.mock("../lib/auth", () => ({ useAuth: () => ({ can: () => true }) }));
jest.mock("../lib/registerBus", () => ({ emitRegisterChanged: jest.fn() }));
jest.mock("../lib/useLiveRefresh", () => ({ useEditLock: jest.fn() }));
jest.mock("../lib/posAgent", () => ({ printReceipt: jest.fn(), openDrawer: jest.fn() }));
jest.mock("../lib/theme", () => ({ useTheme: () => ({ branding: {} }) }));
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
jest.mock("../lib/imageCompress", () => ({ compressImage: jest.fn() }));

const { api } = require("../lib/api");
const PendingVaccineUploads = require("./PendingVaccineUploads").default;
const TodayOperations = require("./TodayOperations").default;
const VaccineQuickUploadModal = require("./VaccineQuickUploadModal").default;
const { vaccineState, vaccineSummary, dogVaccineRollup, VACCINE_STATES } = require("../lib/vaccineStatus");

global.IS_REACT_ACT_ENVIRONMENT = true;

const RENEWAL = { dog_id: "basil", dog_name: "Basil", vaccine: "rabies", expires_on: "2031-01-01", photo: null,
  uploaded_at: "2026-09-30T10:00:00+00:00", approved_on_file: true, approved_before_expires_on: "2030-01-01", on_file_expires_on: "2030-01-01" };
const FIRST = { dog_id: "basil", dog_name: "Basil", vaccine: "dhpp", expires_on: "2029-02-01", photo: null,
  uploaded_at: "2026-09-30T11:00:00+00:00", approved_on_file: false, approved_before_expires_on: "", on_file_expires_on: "" };

let container; let root;
const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const flush = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
beforeEach(() => {
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  mockConfirmCalls = [];
  api.get.mockReset(); api.post.mockReset(); api.delete.mockReset();
  api.get.mockImplementation((url) => Promise.resolve({ data: url === "/admin/vaccine-cert-uploads" ? [RENEWAL, FIRST] : [] }));
  api.post.mockResolvedValue({ data: { ok: true, expires_on: "2031-01-01", approved_count: 2, approved: [], skipped: [] } });
  api.delete.mockResolvedValue({ data: { ok: true } });
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

// ───────────────────────────────────────────────────── the client's card

const TODAY = "2026-09-30";
test("a current vaccine with a renewal under review reads as current, renewal noted — both shapes", () => {
  const withCert = { vaccines: { rabies: "2026-10-15" }, vaccine_certs: { rabies: { status: "pending_review", pending_expires_on: "2027-10-15" } } };
  const listRow = { vaccines: { rabies: "2026-10-15" }, vaccines_pending_review: { rabies: true } };
  for (const dog of [withCert, listRow]) {
    expect(vaccineState(dog, "rabies", TODAY)).toEqual({ state: VACCINE_STATES.APPROVED, expiry: "2026-10-15", renewal: true });
    expect(vaccineSummary(dog, "rabies", TODAY).text).toMatch(/^valid until .* · renewal under review$/);
    expect(dogVaccineRollup({ ...dog, vaccines: { ...dog.vaccines, dhpp: "2027-01-01", bordetella: "2027-01-01" } }, null, TODAY)).toBe(VACCINE_STATES.APPROVED);
  }
  const afterReject = { vaccines: { rabies: "2026-10-15" }, vaccine_certs: { rabies: { status: "approved", reviewed_at: "x" } } };
  expect(vaccineState(afterReject, "rabies", TODAY)).toEqual({ state: VACCINE_STATES.APPROVED, expiry: "2026-10-15" });
  expect(vaccineSummary(afterReject, "rabies", TODAY).text).not.toMatch(/renewal/);
});

// ───────────────────────────────────────────────── the dog's review box

test("the dog's page says an approved certificate stays on file, and Reject says it keeps it", async () => {
  await act(async () => { root.render(<PendingVaccineUploads dogId="basil" />); });
  await flush();
  expect(q("dog-pending-vax-onfile-rabies").textContent).toMatch(/Approved certificate on file until .*2030.* — rejecting keeps it\./);
  expect(q("dog-pending-vax-onfile-dhpp")).toBeNull();
  await act(async () => { q("dog-pending-vax-reject-rabies").click(); });
  await flush();
  expect(mockConfirmCalls[0].body).toMatch(/only this new upload\. Basil's approved certificate \(valid until .*2030.*\) stays on file, and so does its date\./);
  expect(mockConfirmCalls[0].body).not.toMatch(/exactly matches/);
  expect(api.delete).toHaveBeenCalledWith("/admin/dogs/basil/vaccine-cert/rabies?uploaded_at=2026-09-30T10%3A00%3A00%2B00%3A00");
  await act(async () => { q("dog-pending-vax-reject-dhpp").click(); });
  await flush();
  expect(mockConfirmCalls[1].body).toBe("This removes the upload, and the client will need to upload again.");
});

test("Approve on the dog's page names the upload the reviewer saw", async () => {
  await act(async () => { root.render(<PendingVaccineUploads dogId="basil" />); });
  await flush();
  await act(async () => { q("dog-pending-vax-approve-rabies").click(); });
  await flush();
  expect(api.post).toHaveBeenCalledWith("/admin/dogs/basil/vaccine-cert/rabies/review?uploaded_at=2026-09-30T10%3A00%3A00%2B00%3A00");
});

test("a row warns when the new date is earlier than the one on file", async () => {
  api.get.mockImplementation(() => Promise.resolve({ data: [{ ...RENEWAL, expires_on: "2029-06-01" }] }));
  await act(async () => { root.render(<PendingVaccineUploads dogId="basil" />); });
  await flush();
  expect(q("dog-pending-vax-onfile-rabies").textContent).toMatch(/The new date is earlier than the one on file\./);
});

// ────────────────────────────────────────────── Today's review box

test("Today's review box shows the on-file line, the true Reject wording and sends what was seen", async () => {
  act(() => root.render(<TodayOperations stats={{ today_roster: [] }} can={() => true} />));
  await flush();
  expect(q("today-vax-onfile-basil-rabies").textContent).toMatch(/rejecting keeps it/);
  await act(async () => { q("today-vax-reject-basil-rabies").click(); });
  await flush();
  expect(mockConfirmCalls[0].body).toMatch(/stays on file, and so does its date/);
  expect(api.delete).toHaveBeenCalledWith("/admin/dogs/basil/vaccine-cert/rabies?uploaded_at=2026-09-30T10%3A00%3A00%2B00%3A00");
  await act(async () => { q("today-vax-approve-basil-dhpp").click(); });
  await flush();
  expect(api.post).toHaveBeenCalledWith("/admin/dogs/basil/vaccine-cert/dhpp/review?uploaded_at=2026-09-30T11%3A00%3A00%2B00%3A00");
});

test("Approve all sends each upload the reviewer saw", async () => {
  act(() => root.render(<TodayOperations stats={{ today_roster: [] }} can={() => true} />));
  await flush();
  await act(async () => { q("approve-all-vax").click(); });
  await flush();
  const bulk = api.post.mock.calls.find(([url]) => url === "/admin/vaccine-uploads/bulk-review");
  expect(bulk[1].items).toEqual([
    { dog_id: "basil", vaccine: "rabies", uploaded_at: "2026-09-30T10:00:00+00:00" },
    { dog_id: "basil", vaccine: "dhpp", uploaded_at: "2026-09-30T11:00:00+00:00" },
  ]);
});

// ───────────────────────────────────────────── the client's upload window

test("the upload window no longer says a current vaccine locks booking while it's reviewed", async () => {
  const dog = { id: "basil", name: "Basil", vaccines: { rabies: "2030-01-01" } };
  act(() => root.render(<VaccineQuickUploadModal dogs={[dog]} initialDogId="basil" onClose={() => {}} />));
  expect(container.textContent).toMatch(/If we've already approved a current certificate, booking stays open while we review the new one\./);
  expect(container.textContent).not.toMatch(/booking stays locked until we approve them/);
});

test("the upload window tells the portal which dog and which vaccines it sent", async () => {
  const dog = { id: "basil", name: "Basil", vaccines: { rabies: "2030-01-01" } };
  const onSaved = jest.fn();
  api.post.mockResolvedValue({ data: { ok: true } });
  act(() => root.render(<VaccineQuickUploadModal dogs={[dog]} initialDogId="basil" onClose={() => {}} onSaved={onSaved} />));
  const date = q("vquick-row-rabies").querySelector('input[type="date"]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(date, "2031-01-01");
    date.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const file = q("vquick-row-rabies").querySelector('input[type="file"]');
  require("../lib/imageCompress").compressImage.mockResolvedValue("data:image/png;base64,AA");
  await act(async () => {
    Object.defineProperty(file, "files", { value: [new File(["x"], "c.png", { type: "image/png" })], configurable: true });
    file.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flush();
  const submit = [...container.querySelectorAll("button")].find((b) => /submit|send|upload/i.test(b.textContent) && !b.disabled);
  await act(async () => { submit.click(); });
  await flush();
  expect(onSaved).toHaveBeenCalledWith({ dogId: "basil", vaccines: ["rabies"] });
});

// ───────────────────────────────────────────── the review fixes

test("renewing one vaccine keeps 'expiring soon' for the others, and a renewal-only upload keeps booking open", () => {
  const { withUsForReview, expiringNotSent, uploadedRenewalsOnly } = require("../lib/vaccineStatus");
  const dog = { vaccines: { rabies: "2026-10-10", bordetella: "2026-10-20", dhpp: "2027-06-01" }, vaccines_pending_review: { rabies: true } };
  const all = ["rabies", "bordetella", "dhpp"];
  expect(withUsForReview(dog, all, TODAY)).toEqual(["rabies"]);
  expect(expiringNotSent(dog, all, TODAY, "2026-10-30")).toEqual(["bordetella"]);
  expect(uploadedRenewalsOnly(dog, ["bordetella"], TODAY)).toBe(true);
  expect(uploadedRenewalsOnly({ vaccines: { rabies: "2026-01-01" } }, ["rabies"], TODAY)).toBe(false);
  expect(uploadedRenewalsOnly(dog, [], TODAY)).toBe(false);
});

test("the review line and Reject use the date booking uses, not the old certificate's", () => {
  const { onFileLine, rejectUploadMessage } = require("../lib/vaccineStatus");
  const row = { ...RENEWAL, expires_on: "2027-06-01", approved_before_expires_on: "2026-10-01", on_file_expires_on: "2027-10-01" };
  expect(onFileLine(row)).toMatch(/until .*2027 — rejecting keeps it\. The new date is earlier than the one on file\./);
  expect(onFileLine(row)).not.toMatch(/2026/);
  expect(rejectUploadMessage(row)).toMatch(/valid until .*2027/);
});

test("a double-click on Today's Approve sends one approval", async () => {
  let release;
  api.post.mockImplementation(() => new Promise((res) => { release = () => res({ data: { ok: true } }); }));
  act(() => root.render(<TodayOperations stats={{ today_roster: [] }} can={() => true} />));
  await flush();
  await act(async () => { q("today-vax-approve-basil-rabies").click(); q("today-vax-approve-basil-rabies").click(); });
  expect(api.post.mock.calls.filter(([u]) => u.includes("/vaccine-cert/rabies/review"))).toHaveLength(1);
  expect(q("today-vax-approve-basil-dhpp").disabled).toBe(true);
  await act(async () => { release(); });
  await flush();
});

test("the client's card counts a renewal as with us for review, so it stops asking them to renew", () => {
  const { withUsForReview } = require("../lib/vaccineStatus");
  const dog = { vaccines: { rabies: "2026-10-15", dhpp: "2027-05-01", bordetella: "" },
                vaccine_certs: { rabies: { status: "pending_review", pending_expires_on: "2027-10-15" },
                                 bordetella: { status: "pending_review", pending_expires_on: "2027-10-15" } } };
  expect(withUsForReview(dog, ["rabies", "bordetella", "dhpp"], TODAY)).toEqual(["rabies", "bordetella"]);
  expect(withUsForReview({ vaccines: { rabies: "2026-10-15" } }, ["rabies"], TODAY)).toEqual([]);
});

test("a certificate staff added says so on the dog's review box (audit #49)", async () => {
  api.get.mockImplementation(() => Promise.resolve({ data: [{ ...FIRST, uploaded_by_staff: true, uploaded_by: "Jamie" }] }));
  await act(async () => { root.render(<PendingVaccineUploads dogId="basil" />); });
  await flush();
  expect(container.querySelector('[data-testid="dog-pending-vax-dhpp"]').textContent).toMatch(/Added by Jamie \(staff\) expiry 2029-02-01/);
});
