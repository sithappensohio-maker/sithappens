/**
 * The public Meet & Greet request form submits what it collects: the
 * required interest chips (added for the "Service: Other" bug) and the
 * optional free-text note (added for the "no room to say anything else"
 * gap), the same quick-vs-rich-form pattern as the Contact Inquiry form.
 * Mounted, not source-pinned.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import RequestMeetGreetModal from "./RequestMeetGreetModal";

jest.mock("../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() }, formatErr: (d) => String(d || "") }));

const { api } = require("../lib/api");

global.IS_REACT_ACT_ENVIRONMENT = true;

let container, root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset();
  api.get.mockResolvedValue({ data: { enabled: true, closed: false, slot_minutes: 30, slots: [{ time: "10:00", available: true }] } });
  api.post.mockReset();
  api.post.mockResolvedValue({ data: { ok: true } });
});
afterEach(() => { act(() => root?.unmount()); container.remove(); });

const flush = async () => { for (let i = 0; i < 8; i += 1) await act(async () => { await Promise.resolve(); }); };
const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const setVal = (el, value) => {
  const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

test("submitting without an interest picked is refused client-side (the submit button is disabled)", async () => {
  await act(async () => { root = createRoot(container); root.render(<RequestMeetGreetModal open onClose={() => {}} />); });
  await flush();
  setVal(q("meet-greet-owner-name-input"), "Jessica Lee");
  setVal(q("meet-greet-email-input"), "jessica@example.com");
  setVal(q("meet-greet-phone-input"), "555-0101");
  setVal(q("meet-greet-dog-name-input"), "Neo");
  await act(async () => { q("meet-greet-slot-10:00").click(); });
  await flush();
  expect(q("meet-greet-submit").disabled).toBe(true);
  await act(async () => { q("meet-greet-submit").click(); });
  await flush();
  expect(api.post).not.toHaveBeenCalled();
});

test("submitting sends the chosen interests and the optional note", async () => {
  await act(async () => { root = createRoot(container); root.render(<RequestMeetGreetModal open onClose={() => {}} />); });
  await flush();
  setVal(q("meet-greet-owner-name-input"), "Jessica Lee");
  setVal(q("meet-greet-email-input"), "jessica@example.com");
  setVal(q("meet-greet-phone-input"), "555-0101");
  setVal(q("meet-greet-dog-name-input"), "Neo");
  await act(async () => { q("meet-greet-interest-boarding").click(); });
  await act(async () => { q("meet-greet-interest-grooming").click(); });
  setVal(q("meet-greet-message-input"), "Neo is reactive to other male dogs.");
  await act(async () => { q("meet-greet-slot-10:00").click(); });
  await flush();
  await act(async () => { q("meet-greet-submit").click(); });
  await flush();
  expect(api.post).toHaveBeenCalledWith("/public/meet-greet-request", expect.objectContaining({
    interests: ["boarding", "grooming"],
    message: "Neo is reactive to other male dogs.",
  }));
  expect(q("meet-greet-success")).not.toBeNull();
});
