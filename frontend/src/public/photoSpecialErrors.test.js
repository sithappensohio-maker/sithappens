/* Photo Specials — every refusal tells the customer what happened and where
 * to go next. Mounted, because the bugs were behavioural: the page showed
 * "AxiosError: Request failed with status code 409", the "time was taken"
 * recovery never fired, a failed time load looked like a closed day, and
 * "Review booking" went faint without saying which field it wanted. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import PublicPhotoSpecial from "./PublicPhotoSpecial";

jest.mock("../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() }, formatErr: (e) => String(e || "") }));
jest.mock("./PublicSiteShell", () => ({ __esModule: true, default: ({ children }) => <div>{children}</div> }));
jest.mock("react-router-dom", () => ({ ...jest.requireActual("react-router-dom"), useParams: () => ({ slug: "fall-minis" }) }));

const { api } = require("../lib/api");
global.IS_REACT_ACT_ENVIRONMENT = true;
beforeAll(() => { Element.prototype.scrollIntoView = jest.fn(); });

const DAY = "2026-10-10";
const SPECIAL = { id: "ps1", name: "Fall Minis", slug: "fall-minis", booking_open: true, dates: [DAY], slot_minutes: 15, packages: [], what_to_expect: [] };
const SLOTS = { closed: false, slots: [{ time: "10:00", available: true }, { time: "10:15", available: true }] };

let special, slots;
beforeEach(() => {
  special = () => Promise.resolve({ data: SPECIAL });
  slots = () => Promise.resolve({ data: SLOTS });
  api.get.mockReset(); api.post.mockReset();
  api.get.mockImplementation((url) => {
    if (url === "/public/photo-specials/fall-minis") return special();
    if (url === "/public/photo-specials/fall-minis/availability") return slots();
    return Promise.resolve({ data: {} });
  });
});

const flush = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });

async function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(<MemoryRouter><PublicPhotoSpecial /></MemoryRouter>); });
  await flush();
  const q = (id) => host.querySelector(`[data-testid="${id}"]`);
  const click = async (id) => { await act(async () => { q(id).click(); }); await flush(); };
  const type = async (id, value) => act(async () => {
    const el = q(id);
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return { q, click, type, text: () => host.textContent || "", cleanup: () => act(() => root.unmount()) };
}

async function fillDetails(v) {
  await v.type("photo-special-first-name", "Sam");
  await v.type("photo-special-phone", "330-555-0101");
  await v.type("photo-special-email", "sam@example.com");
  await v.type("photo-special-dog-name", "Biscuit");
}

test("a taken time sends them back to fresh times, with the reason shown there", async () => {
  api.post.mockImplementation(() => Promise.reject({ response: { status: 409, data: {
    detail: "That time has just been taken. Please choose another.", block: { code: "slot_taken", action: "pick_time" } } } }));
  const v = await mount();
  await v.click(`photo-special-date-${DAY}`);
  await v.click("photo-special-slot-10:00");
  await fillDetails(v);
  await v.click("photo-special-to-review");
  await v.click("photo-special-reserve");
  expect(v.text()).not.toMatch(/AxiosError/);
  expect(v.q("photo-special-step-review")).toBeNull();
  expect(v.q("photo-special-step-time").textContent).toMatch(/just been taken/);
  expect(api.get).toHaveBeenCalledWith("/public/photo-specials/fall-minis/availability", expect.anything());
  // Their details survive the trip back.
  await v.click("photo-special-slot-10:15");
  expect(v.q("photo-special-first-name").value).toBe("Sam");
  expect(v.q("photo-special-error")).toBeNull();
  await v.cleanup();
});

test("a closed session says to call, on the review step", async () => {
  api.post.mockImplementation(() => Promise.reject({ response: { status: 409, data: {
    detail: "Booking for this session has closed. Give us a call and we'll see what we can do.", block: { code: "special_closed", action: "contact_us" } } } }));
  const v = await mount();
  await v.click(`photo-special-date-${DAY}`);
  await v.click("photo-special-slot-10:00");
  await fillDetails(v);
  await v.click("photo-special-to-review");
  await v.click("photo-special-reserve");
  expect(v.q("photo-special-step-review").textContent).toMatch(/Give us a call/);
  await v.cleanup();
});

test("a failed time load is a retry, not a closed day", async () => {
  slots = () => Promise.reject(new Error("offline"));
  const v = await mount();
  await v.click(`photo-special-date-${DAY}`);
  expect(v.q("photo-special-slots-failed").textContent).toMatch(/couldn't load the times/i);
  slots = () => Promise.resolve({ data: SLOTS });
  await v.click("photo-special-slots-retry");
  expect(v.q("photo-special-slot-10:00")).toBeTruthy();
  await v.cleanup();
});

test("Review booking says which detail it is waiting for", async () => {
  const v = await mount();
  await v.click(`photo-special-date-${DAY}`);
  await v.click("photo-special-slot-10:00");
  expect(v.q("photo-special-details-hint").textContent).toMatch(/first name.*mobile number.*email address and your dog's name/);
  await fillDetails(v);
  await v.type("photo-special-email", "sam@example");
  expect(v.q("photo-special-details-hint").textContent).toMatch(/email address doesn't look right/);
  await v.type("photo-special-email", "sam@example.com");
  expect(v.q("photo-special-details-hint")).toBeNull();
  await v.cleanup();
});

test("a missing session is explained in words, not an error dump", async () => {
  special = () => Promise.reject({ response: { status: 404, data: { detail: "Photo special not found" } } });
  const v = await mount();
  expect(v.q("photo-special-missing").textContent).toMatch(/couldn't find this photo session/i);
  expect(v.text()).not.toMatch(/AxiosError/);
  await v.cleanup();
});
