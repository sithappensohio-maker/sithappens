/**
 * Homework's two dog pickers — HomeworkTemplatePicker's `template-dog-select`
 * and DailyTrackerBuilder's `dtb-dog` — now use the shared EntitySearchPicker
 * (search box + tappable result cards with real dog photos) instead of a
 * plain <select> of names only. Mounted, not source-read: a source pin could
 * not tell a real <select> from a search+cards picker that merely kept the
 * same test id.
 *
 * `dogs` here is the real shape Homework.jsx passes down — the /dogs/options
 * slim projection (id, name, breed, owner_id, vaccines; no photo, no owner
 * name) — so the picker's photo comes from a lazy per-dog GET /dogs/{id},
 * same pattern as Incidents.jsx's dog picker.
 *
 * Everything else — template selection, the assign call, the daily-tracker
 * 2-step wizard, the day/field editors — must stay completely untouched.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import Homework from "./Homework";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  formatErr: (v) => (typeof v === "string" ? v : v ? JSON.stringify(v) : ""),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../lib/useConfirm", () => ({ useConfirm: () => async () => true }));
jest.mock("../components/PageHero", () => (props) => props.right ?? null);
jest.mock("../components/HomeworkReportPanel", () => () => null);
jest.mock("../components/DailyReviewQueue", () => () => null);
jest.mock("../components/HomeworkAnalytics", () => () => null);

const { api } = require("../lib/api");
global.IS_REACT_ACT_ENVIRONMENT = true;

const PHOTO = "data:image/png;base64,AAAA";

// Real shape of /dogs/options — slim, no photo, no owner name.
const DOGS = [
  { id: "d1", name: "Luna", breed: "Lab", owner_id: "c1" },
  { id: "d2", name: "Rex", breed: "Poodle", owner_id: "c2" },
];

const TEMPLATE = {
  id: "t1", slug: "loose-leash", name: "Loose Leash", description: "Walk nicely",
  tier: "foundation", icon: "fa-paw", daily_tracker: false,
  sections: [{ id: "s1", title: "Walks", instructions: "do it", fields: [] }],
  default_duration_days: 7, practice_coach: { enabled: false }, global_rules_this_week: [],
};

let container, root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset().mockImplementation(async (url) => {
    if (url === "/homework") return { data: [] };
    if (url === "/dogs/options") return { data: DOGS };
    if (url === "/homework/counts") return { data: { all: 0, assigned: 0, completed: 0, active: 0 } };
    if (url === "/admin/homework/unreviewed-count") return { data: { unreviewed: 0, needs_attention: 0 } };
    if (url === "/homework-templates") return { data: [TEMPLATE] };
    if (url === "/dogs/d1") return { data: { id: "d1", name: "Luna", photo: PHOTO } };
    if (url === "/dogs/d2") return { data: { id: "d2", name: "Rex", photo: "" } };
    return { data: [] };
  });
  api.post.mockReset().mockResolvedValue({ data: { id: "hw-new" } });
});
afterEach(() => { act(() => root?.unmount()); container.remove(); });

const flush = async () => { for (let i = 0; i < 10; i += 1) await act(async () => { await Promise.resolve(); }); };
const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const setInputValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
const typeInto = async (el, value) => {
  await act(async () => {
    setInputValue.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

const mountHomework = async () => {
  await act(async () => { root = createRoot(container); root.render(<Homework />); });
  await flush();
};

// ---------------------------------------------------------------------------
// HomeworkTemplatePicker's "template-dog-select"
// ---------------------------------------------------------------------------

test("the template-assign dog picker is search+cards, not a plain <select>, and shows real photos", async () => {
  await mountHomework();
  await act(async () => { q("assign-from-template-button").click(); });
  await flush();
  await act(async () => { q("template-card-loose-leash").click(); });
  await flush();

  expect(container.querySelector('select[data-testid="template-dog-select"]')).toBeNull();
  expect(q("template-dog-select")).not.toBeNull();

  // Defaults to the first dog (Luna) as the old <select> did; its photo
  // arrives via the lazy GET /dogs/{id} fetch.
  expect(q("template-dog-select-selected-card").textContent).toContain("Luna");
  await flush();
  expect(q("template-dog-select-selected-card").querySelector("img")?.getAttribute("src")).toBe(PHOTO);

  await act(async () => { q("template-dog-select-change").click(); });
  await flush();
  expect(q("template-dog-select-result-d1")).not.toBeNull();
  expect(q("template-dog-select-result-d2")).not.toBeNull();
  // A dog with no real photo on record falls back to the initial circle.
  expect(q("template-dog-select-result-d2").querySelector("img")).toBeNull();
});

test("picking a different dog in the template-assign picker drives the same assign call", async () => {
  await mountHomework();
  await act(async () => { q("assign-from-template-button").click(); });
  await flush();
  await act(async () => { q("template-card-loose-leash").click(); });
  await flush();

  await act(async () => { q("template-dog-select-change").click(); });
  await flush();
  await act(async () => { q("template-dog-select-result-d2").click(); });
  await flush();

  expect(q("template-dog-select-selected-card").textContent).toContain("Rex");

  await act(async () => { q("template-assign-button").click(); });
  await flush();

  expect(api.post).toHaveBeenCalledWith("/homework/from-template", expect.objectContaining({ dog_id: "d2", template_id: "t1" }));
});

// ---------------------------------------------------------------------------
// DailyTrackerBuilder's "dtb-dog"
// ---------------------------------------------------------------------------

test("the daily-tracker dog picker is search+cards, not a plain <select>, and shows real photos", async () => {
  await mountHomework();
  await act(async () => { q("daily-tracker-button").click(); });
  await flush();

  expect(container.querySelector('select[data-testid="dtb-dog"]')).toBeNull();
  expect(q("dtb-dog")).not.toBeNull();

  expect(q("dtb-dog-selected-card").textContent).toContain("Luna");
  await flush();
  expect(q("dtb-dog-selected-card").querySelector("img")?.getAttribute("src")).toBe(PHOTO);

  await act(async () => { q("dtb-dog-change").click(); });
  await flush();
  expect(q("dtb-dog-result-d1")).not.toBeNull();
  expect(q("dtb-dog-result-d2")).not.toBeNull();
});

test("picking a different dog in the daily-tracker picker still drives the same Step-1-to-2 flow and final submit", async () => {
  await mountHomework();
  await act(async () => { q("daily-tracker-button").click(); });
  await flush();

  await act(async () => { q("dtb-dog-change").click(); });
  await flush();
  await act(async () => { q("dtb-dog-result-d2").click(); });
  await flush();
  expect(q("dtb-dog-selected-card").textContent).toContain("Rex");

  await typeInto(q("dtb-title"), "7-Day Bootcamp");
  await flush();

  // Step 1 -> Step 2, the step-numbered-header pattern stays untouched.
  await act(async () => { q("dtb-next").click(); });
  await flush();
  expect(container.textContent).toMatch(/Step 2 of 2/);

  await typeInto(q("dtb-day-focus"), "Loose leash in the yard");
  await flush();

  await act(async () => { q("dtb-assign").click(); });
  await flush();

  expect(api.post).toHaveBeenCalledWith("/homework/daily-tracker", expect.objectContaining({ dog_id: "d2", title: "7-Day Bootcamp" }));
});
