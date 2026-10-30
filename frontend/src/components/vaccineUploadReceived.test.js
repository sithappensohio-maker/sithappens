/* After a client uploads a vaccine certificate, no screen may tell them it's
 * missing, and a multi-vaccine upload that partly fails says which arrived.
 * Clients reported "it said it worked, then it said it didn't, but it did".
 * Mounted, not source-pinned.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import VaccineQuickUploadModal from "./VaccineQuickUploadModal";
import VaccineUploadWizard from "./VaccineUploadWizard";
import PortalDogModal from "./PortalDogModal";
import { vaccinesToUpload } from "../lib/vaccineStatus";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
  formatErr: (e) => e?.response?.data?.detail || "Something went wrong.",
}));
jest.mock("../lib/imageCompress", () => ({ compressImage: jest.fn(async () => "data:image/jpeg;base64,QUJD") }));
jest.mock("../lib/useConfirm", () => { const c = () => Promise.resolve(true); return { useConfirm: () => c }; });

const { api } = require("../lib/api");
global.IS_REACT_ACT_ENVIRONMENT = true;

const RABIES_SENT = { id: "d1", name: "Rex", breed: "Lab", vaccines: {}, vaccines_pending_review: { rabies: true } };

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
const click = async (el) => { await act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); }); await flush(); };
const setDate = async (el, value) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, value);
  await act(async () => { el.dispatchEvent(new Event("input", { bubbles: true })); });
};
const attach = async (el) => {
  Object.defineProperty(el, "files", { configurable: true, value: [new File(["x"], "cert.jpg", { type: "image/jpeg" })] });
  await act(async () => { el.dispatchEvent(new Event("change", { bubbles: true })); });
  await flush();
};
const refused = (detail) => ({ response: { status: 400, data: { detail } } });

test("only vaccines that are missing or expired are asked for; one sent for review is not", () => {
  const today = "2026-10-30";
  const dogs = [
    RABIES_SENT,
    { id: "d2", name: "Mia", vaccines: { rabies: "2027-01-01", bordetella: "2026-01-01", dhpp: "2027-01-01" } },
  ];
  const pairs = vaccinesToUpload(dogs, today).map(({ dog, vaccine }) => `${dog.id}:${vaccine}`);
  expect(pairs).toEqual(["d1:bordetella", "d1:dhpp", "d2:bordetella"]);
  expect(vaccinesToUpload([{ ...RABIES_SENT, vaccines_pending_review: { rabies: true, bordetella: true, dhpp: true } }], today)).toEqual([]);
});

test("the quick upload window shows a vaccine already sent as Received, not Missing", async () => {
  await act(async () => { root.render(<VaccineQuickUploadModal dogs={[RABIES_SENT]} initialDogId="d1" onClose={() => {}} onSaved={() => {}}/>); });
  expect(q("vquick-status-rabies").textContent).toContain("Received");
  expect(q("vquick-status-rabies").textContent).not.toContain("Missing");
  expect(q("vquick-received-rabies")).not.toBeNull();
  expect(q("vquick-status-dhpp").textContent).toContain("Missing");
});

test("a partial failure says which vaccines arrived, and a retry sends only the rest with its same id", async () => {
  const onSaved = jest.fn(); const onSomeSaved = jest.fn();
  const dog = { ...RABIES_SENT, vaccines_pending_review: {} };
  api.post.mockResolvedValueOnce({ data: { ok: true } }).mockRejectedValueOnce(refused("Uploaded PDF is too large."));
  await act(async () => { root.render(<VaccineQuickUploadModal dogs={[dog]} initialDogId="d1" onClose={() => {}} onSaved={onSaved} onSomeSaved={onSomeSaved}/>); });
  for (const v of ["rabies", "bordetella"]) {
    await setDate(q(`vquick-date-${v}`), "2031-01-01");
    await attach(q(`vquick-photos-${v}`));
  }
  await click(q("vquick-submit"));

  expect(q("vquick-error").textContent).toContain("Rabies received. Bordetella didn't go through: Uploaded PDF is too large.");
  expect(onSomeSaved).toHaveBeenCalledTimes(1);
  expect(onSaved).not.toHaveBeenCalled();
  expect(q("vquick-status-rabies").textContent).toContain("Received");
  const bordetellaId = api.post.mock.calls[1][1].upload_id;

  api.post.mockResolvedValueOnce({ data: { ok: true } });
  await click(q("vquick-submit"));
  expect(api.post).toHaveBeenCalledTimes(3);
  expect(api.post.mock.calls[2][1]).toMatchObject({ vaccine: "bordetella", upload_id: bordetellaId });
  expect(onSaved).toHaveBeenCalledWith({ dogId: "d1", vaccines: ["rabies", "bordetella"] });
});

test("the wizard clears the last step's 'uploaded' notice when this step fails", async () => {
  const queue = [{ dog: RABIES_SENT, vaccine: "bordetella" }, { dog: RABIES_SENT, vaccine: "dhpp" }];
  api.post.mockResolvedValueOnce({ data: { ok: true } }).mockRejectedValueOnce(refused("Please upload no more than 4 photos."));
  await act(async () => { root.render(<VaccineUploadWizard queue={queue} onClose={() => {}} onAllDone={() => {}} onProgress={() => {}}/>); });
  await setDate(q("vaccine-wizard-date"), "2031-01-01");
  await attach(q("vaccine-wizard-photo"));
  await click(q("vaccine-wizard-save"));
  expect(q("vaccine-wizard-next-notice").textContent).toContain("Bordetella uploaded");

  await setDate(q("vaccine-wizard-date"), "2031-02-02");
  await attach(q("vaccine-wizard-photo"));
  await click(q("vaccine-wizard-save"));
  expect(q("vaccine-wizard-next-notice")).toBeNull();
  expect(q("vaccine-wizard-error").textContent).toContain("Please upload no more than 4 photos.");

  api.post.mockResolvedValueOnce({ data: { ok: true } });
  await click(q("vaccine-wizard-save"));   // Submit again: same date and file, same id
  expect(api.post.mock.calls[2][1].upload_id).toBe(api.post.mock.calls[1][1].upload_id);
});

test("a changed date after a failed attempt is a new upload with a new id (quick window)", async () => {
  const dog = { ...RABIES_SENT, vaccines_pending_review: {} };
  api.post.mockRejectedValueOnce(refused("Invalid expiry date")).mockResolvedValueOnce({ data: { ok: true } });
  await act(async () => { root.render(<VaccineQuickUploadModal dogs={[dog]} initialDogId="d1" onClose={() => {}} onSaved={() => {}}/>); });
  await setDate(q("vquick-date-rabies"), "2031-01-01");
  await attach(q("vquick-photos-rabies"));
  await click(q("vquick-submit"));
  await setDate(q("vquick-date-rabies"), "2032-01-01");
  await click(q("vquick-submit"));
  expect(api.post.mock.calls[1][1]).toMatchObject({ expires_on: "2032-01-01" });
  expect(api.post.mock.calls[1][1].upload_id).not.toBe(api.post.mock.calls[0][1].upload_id);
});

test("while it sends, nothing can be changed; a photo that lands meanwhile is not marked received", async () => {
  const { compressImage } = require("../lib/imageCompress");
  const dog = { ...RABIES_SENT, vaccines_pending_review: {} };
  let release; let finishPhoto;
  await act(async () => { root.render(<VaccineQuickUploadModal dogs={[dog]} initialDogId="d1" onClose={() => {}} onSaved={() => {}}/>); });
  await setDate(q("vquick-date-dhpp"), "2031-01-01");
  await attach(q("vquick-photos-dhpp"));                       // the wrong page
  compressImage.mockImplementationOnce(() => new Promise((r) => { finishPhoto = r; }));
  await attach(q("vquick-photos-dhpp"));                       // the right page, still being prepared…
  api.post.mockImplementationOnce(() => new Promise((r) => { release = r; }));
  await click(q("vquick-submit"));                             // …when Submit is tapped
  expect(q("vquick-photos-dhpp").disabled).toBe(true);
  expect(q("vquick-camera-dhpp").disabled).toBe(true);
  await act(async () => { finishPhoto("data:image/jpeg;base64,UklHSFQ="); });
  await act(async () => { release({ data: { ok: true } }); });
  await flush();
  // What's on screen now (two photos) was never sent: not "Received", and it goes with a new id.
  expect(q("vquick-received-dhpp")).toBeNull();
  api.post.mockResolvedValueOnce({ data: { ok: true } });
  await click(q("vquick-submit"));
  expect(api.post.mock.calls[1][1].photos).toHaveLength(2);
  expect(api.post.mock.calls[1][1].upload_id).not.toBe(api.post.mock.calls[0][1].upload_id);
});

test("a changed date after a failed attempt is a new upload with a new id (wizard)", async () => {
  api.post.mockRejectedValueOnce(refused("Invalid expiry date")).mockResolvedValueOnce({ data: { ok: true } });
  await act(async () => { root.render(<VaccineUploadWizard queue={[{ dog: RABIES_SENT, vaccine: "dhpp" }]} onClose={() => {}} onAllDone={() => {}} onProgress={() => {}}/>); });
  await setDate(q("vaccine-wizard-date"), "2031-01-01");
  await attach(q("vaccine-wizard-photo"));
  await click(q("vaccine-wizard-save"));
  await setDate(q("vaccine-wizard-date"), "2032-01-01");
  await click(q("vaccine-wizard-save"));
  expect(api.post.mock.calls[1][1]).toMatchObject({ expires_on: "2032-01-01" });
  expect(api.post.mock.calls[1][1].upload_id).not.toBe(api.post.mock.calls[0][1].upload_id);
});

test("the dog window shows a vaccine already sent as received, not 'Not on file'", async () => {
  await act(async () => { root.render(<PortalDogModal dog={RABIES_SENT} onClose={() => {}} onSaved={() => {}}/>); });
  expect(q("pd-vax-status-rabies").textContent).toContain("Received — waiting for review");
  expect(q("pd-vax-status-rabies").textContent).not.toContain("Not on file");
  expect(q("pd-vax-status-dhpp").textContent).toContain("Not on file");
});
