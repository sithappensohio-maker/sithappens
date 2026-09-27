/**
 * An email that is already registered never shows that registration (audit
 * #8) — the page says it's on the list and that the confirmation was sent to
 * that inbox. Mounted, not source-pinned.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn() },
  formatErr: (d) => (typeof d === "string" ? d : ""),
}));
jest.mock("../lib/auth", () => ({ useAuth: () => ({ user: null }) }));
jest.mock("./PublicSiteShell", () => ({ __esModule: true, default: ({ children }) => <div>{children}</div> }));
jest.mock("./publicSite", () => ({ usePublicSite: () => ({ site: {} }) }));

const { api } = require("../lib/api");
const PublicEvent = require("./PublicEvent").default;

global.IS_REACT_ACT_ENVIRONMENT = true;

const EVENT = {
  id: "ev1", slug: "trunk-or-treat", name: "Trunk or Treat", start_at: "2099-10-25T14:00:00Z",
  end_at: "2099-10-25T17:00:00Z", registration_open: true, features: { costume_contest: true },
};

let container, root;
beforeEach(() => {
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  api.get.mockReset(); api.post.mockReset();
  api.get.mockResolvedValue({ data: { event: EVENT } });
  Element.prototype.scrollIntoView = jest.fn();
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const flush = () => act(async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); });
const type = async (id, value) => {
  const el = q(id);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); });
};
const click = async (id) => { await act(async () => { q(id).click(); }); await flush(); };

async function fillAndSubmit() {
  act(() => root.render(
    <MemoryRouter initialEntries={["/events/trunk-or-treat"]}>
      <Routes><Route path="/events/:slug" element={<PublicEvent />} /></Routes>
    </MemoryRouter>,
  ));
  await flush();
  await type("ev-name", "Nosy Neighbour");
  await type("ev-email", "family@example.com");
  await type("ev-phone", "330-555-0100");
  await type("ev-dog-0", "Waffles");
  await click("ev-heard-facebook");
  await click("ev-rules");
  await act(async () => { q("event-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await flush();
}

test("an already-registered email shows no details, only that the confirmation went to that inbox", async () => {
  api.post.mockResolvedValue({ data: { ok: true, registration: null, already_registered: true, email_resent: true } });
  await fillAndSubmit();
  expect(api.post).toHaveBeenCalled();
  expect(q("event-already-registered")).toBeTruthy();
  expect(q("event-already-registered-note").textContent).toMatch(/emailed the confirmation to family@example\.com again/);
  expect(q("event-confirmation")).toBeFalsy();
  expect(q("event-confirmation-number")).toBeFalsy();
});

test("a first registration still shows its confirmation", async () => {
  api.post.mockResolvedValue({ data: { ok: true, registration: {
    id: "r1", confirmation_number: "TT-1234", primary_contact: "Me", email: "me@example.com",
    adults: 1, children: 0, dogs: [{ name: "Waffles" }], costume_contest: false, duplicate: false, email_sent: true } } });
  await fillAndSubmit();
  expect(q("event-confirmation-number").textContent).toBe("TT-1234");
  expect(q("event-already-registered")).toBeFalsy();
});


test("when no new copy could go out, the page never claims one was sent", async () => {
  api.post.mockResolvedValue({ data: { ok: true, registration: null, already_registered: true, email_resent: false } });
  await fillAndSubmit();
  const note = q("event-already-registered-note").textContent;
  expect(note).toMatch(/couldn't send another copy/i);
  expect(note).not.toMatch(/we sent/i);
});

test("a mistyped email can be changed without starting over", async () => {
  api.post.mockResolvedValue({ data: { ok: true, registration: null, already_registered: true, email_resent: true } });
  await fillAndSubmit();
  await click("event-already-change-email");
  expect(q("event-form")).toBeTruthy();
  expect(q("ev-email").value).toBe("family@example.com");
  expect(q("ev-name").value).toBe("Nosy Neighbour");
});
