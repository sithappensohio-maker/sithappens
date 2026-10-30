/* With Online School turned off, the forms and the guide stop offering it
 * (owner: "i still get some online school shit that pops up"). The label stays
 * known so older inquiries still read "Online School". Mounted; the flag is
 * the one value stubbed.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";

let mockFlags = {};
jest.mock("../lib/theme", () => {
  const actual = jest.requireActual("../lib/theme");
  return { ...actual, useFeature: (key) => mockFlags[key] !== false };
});
jest.mock("../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() }, formatErr: (d) => String(d || "") }));

const { api } = require("../lib/api");
const { default: ContactInquiryModal, INTEREST_OPTIONS, offeredInterests } = require("./ContactInquiryModal");
const RequestMeetGreetModal = require("./RequestMeetGreetModal").default;
const { guideFor } = require("../screens/Tutorials");
global.IS_REACT_ACT_ENVIRONMENT = true;

let container; let root;
beforeEach(() => {
  api.get.mockReset();
  api.get.mockImplementation((url) => (url === "/public/contact-inquiry-options"
    ? Promise.resolve({ data: { interests: INTEREST_OPTIONS } })        // an older server that still lists it
    : Promise.resolve({ data: { enabled: true, slots: [] } })));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const mount = async (el) => {
  await act(async () => { root.render(el); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
};

test.each([[false, false], [true, true]])("contact form offers Online School: flag %s → %s", async (on, offered) => {
  mockFlags = { online_school: on };
  await mount(<ContactInquiryModal open onClose={() => {}}/>);
  expect(!!q("ci-interest-online_school")).toBe(offered);
  expect(q("ci-interest-in_person_training")).toBeTruthy();
});

test.each([[false, false], [true, true]])("Meet & Greet form offers Online School: flag %s → %s", async (on, offered) => {
  mockFlags = { online_school: on };
  await mount(<RequestMeetGreetModal open onClose={() => {}}/>);
  expect(!!q("meet-greet-interest-online_school")).toBe(offered);
  expect(q("meet-greet-interest-daycare")).toBeTruthy();
});

test("the label stays known for older inquiries", () => {
  expect(INTEREST_OPTIONS.online_school).toBe("Online School");
  expect(offeredInterests(INTEREST_OPTIONS, false)).not.toHaveProperty("online_school");
});

test("the guide leaves out its Online School chapter, quick link and cards while it is off", () => {
  const words = (g) => JSON.stringify(g);
  const clientOff = guideFor("client", false);
  expect(clientOff.sections.map((s) => s.id)).not.toContain("online-school");
  expect(clientOff.quickActions.map((a) => a.target)).not.toContain("online-school");
  expect(guideFor("client", true).sections.map((s) => s.id)).toContain("online-school");
  const adminOff = guideFor("admin", false);
  expect(words(adminOff)).not.toContain("The Online School storefront");
  expect(words(adminOff)).not.toContain("School HQ — running Online School");
  expect(words(guideFor("admin", true))).toContain("The Online School storefront");
  expect(adminOff.sections.every((s) => s.cards.length > 0)).toBe(true);
  expect(words(clientOff)).not.toContain("Online School");
});
