/**
 * Every "today" on the dog page, client page, payment plans, Meet & Greet
 * picker, portal calendar and vaccine badges is Ohio's date (audit #47).
 * The clock is frozen at 2026-10-01T01:30:00Z: Sep 30, 9:30 PM in Ohio, when
 * the UTC date is already Oct 1. Mounted, not source-pinned.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";

jest.mock("../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() }, formatErr: (d) => String(d || "") }));
jest.mock("../lib/useConfirm", () => ({ useConfirm: () => jest.fn(() => Promise.resolve(true)) }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("./IntakeFormsSection", () => () => null);
jest.mock("./DogTrainingTab", () => () => null);
jest.mock("./DogTimeline", () => () => null);
jest.mock("./TrophyWall", () => () => null);
jest.mock("./brand/HuskyDogImage", () => () => null);
jest.mock("./CommunicationLog", () => () => null);
jest.mock("./BillFixModal", () => () => null);
jest.mock("./Avatar", () => () => null);
jest.mock("./RichTextEditor", () => () => null);

const { api } = require("../lib/api");
const DogHub = require("./DogHub").default;
const ClientHub = require("./ClientHub").default;
const AdminClientPaymentPlans = require("./AdminClientPaymentPlans").default;
const RequestMeetGreetModal = require("./RequestMeetGreetModal").default;
const MultiDateCalendar = require("./MultiDateCalendar").default;
const { buildNeedsAttention } = require("./PortalNeedsAttentionCard");
const { vaccineState, VACCINE_STATES } = require("../lib/vaccineStatus");

global.IS_REACT_ACT_ENVIRONMENT = true;

let container, root;
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-10-01T01:30:00Z"));
  api.get.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); jest.useRealTimers(); });

const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });
const render = async (el) => { await act(async () => { root.render(el); }); await flush(); };
const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const TONIGHT = { id: "b1", dog_name: "Luna", service_type: "daycare", date: "2026-09-30", status: "approved" };
const LATER = { id: "b2", dog_name: "Luna", service_type: "boarding", date: "2026-10-04", status: "approved" };

test("dog page: tonight's booking is the next booking and a vaccine due today is not expired", async () => {
  const dog = { id: "d1", name: "Luna", vaccines: { rabies: "2026-09-30", dhpp: "2026-10-30", bordetella: "2027-01-01" } };
  api.get.mockImplementation((url) => Promise.resolve({ data: url === "/bookings" ? [TONIGHT, LATER] : dog }));
  await render(<DogHub dog={dog} initialTab="vaccines" onClose={() => {}} onEditDog={() => {}} />);
  const text = container.textContent;
  expect(text).not.toContain("Expired");        // rabies runs out tonight, not yesterday
  expect(text).toContain("Expiring Soon");       // rabies: today
  expect(text.match(/Valid/g)).toHaveLength(2);  // dhpp on Oct 30 is 30 days out: outside the 30-day window
  act(() => root.unmount());
  root = createRoot(container);
  await render(<DogHub dog={dog} initialTab="bookings" onClose={() => {}} onEditDog={() => {}} />);
  expect(container.textContent).toContain("daycare · 2026-09-30");
});

test("client page: tonight's booking is the next booking", async () => {
  api.get.mockImplementation((url) => Promise.resolve({ data: url === "/bookings" ? [LATER, TONIGHT] : [] }));
  await render(<ClientHub client={{ id: "c-pat", name: "Pat", dogs: [] }} onClose={() => {}} can={() => true} />);
  expect(container.textContent).toContain("Luna — daycare · 2026-09-30");
});

test("payment plan with no start date: the first payment is due today", async () => {
  api.get.mockResolvedValue({ data: [] });
  await render(<AdminClientPaymentPlans clientId="c-pat" plans={[]} />);
  await act(async () => { q("create-plan-btn").click(); });
  const total = q("plan-total");
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  await act(async () => { setter.call(total, "200"); total.dispatchEvent(new Event("input", { bubbles: true })); });
  const preview = q("plan-preview").textContent;
  expect(preview).toContain("1. 2026-09-30");
  expect(preview).toContain("2. 2026-10-14");   // bi-weekly
});

test("Meet & Greet form: today can still be picked at 9:30 PM Eastern", async () => {
  api.get.mockResolvedValue({ data: { enabled: true, slots: [] } });
  await render(<RequestMeetGreetModal open onClose={() => {}} />);
  const input = container.querySelector('input[type="date"]');
  expect(input.getAttribute("min")).toBe("2026-09-30");
  expect(input.value).toBe("2026-09-30");
  expect(api.get).toHaveBeenCalledWith("/public/meet-greet-slots", { params: { date_str: "2026-09-30" } });
});

test("portal day picker: today is open, yesterday is past", async () => {
  await render(<MultiDateCalendar selected={[]} onToggle={() => {}} />);
  expect(q("md-cell-2026-09-30").disabled).toBe(false);
  expect(q("md-cell-2026-09-29").disabled).toBe(true);
});

test("portal needs-attention: tonight's booking is the next visit, labelled Today", () => {
  const card = buildNeedsAttention({ setupStatus: null, dogs: [], bookings: [TONIGHT, LATER] });
  expect(card.kind).toBe("next_appointment");
  expect(card.title).toBe("Luna's next visit is Today");
});

test("vaccine state without an explicit today uses Ohio's date", () => {
  const dog = { vaccines: { rabies: "2026-09-30" } };
  expect(vaccineState(dog, "rabies").state).not.toBe(VACCINE_STATES.EXPIRED);
});
