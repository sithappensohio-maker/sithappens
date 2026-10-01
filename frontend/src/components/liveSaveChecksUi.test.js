/**
 * Audit #53 — every live save runs Publish's checks. A save that would put a
 * new problem live is refused and the problems are listed (and open the
 * lesson they're on); problems the live course already had don't block and
 * are shown after the save. Deleting a lesson or skill drops the links to
 * it, so a delete is never refused for a link left behind.
 *
 * Mounted, not source-pinned. The api module is mocked, so a refusal is
 * built the way lib/api.js leaves it: `detail` flattened to the sentence,
 * the original object on `detail_object`.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { ConfirmProvider } from "../lib/useConfirm";
import {
  structureRefusal, saveProblemLine, resolveSaveProblemTarget, liveProblemsHeadline,
  dropDeadLinks, curriculumIds, TEMPLATE_STRIP_FIELDS,
} from "../lib/programStudioPolish";
import ProgramStudio from "./ProgramStudio";
import { ProgramsPanel } from "./Programs";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn(), defaults: { baseURL: "/api" } },
  formatErr: (e) => String(e || ""),
}));
jest.mock("../lib/auth", () => ({ useAuth: () => ({ permissions: null, user: { role: "admin" }, isOwner: () => true }) }));
jest.mock("../lib/sharedData", () => ({
  useProgramsData: () => ({ data: [{ id: "prog-1", name: "Rock Solid Recall", type: "private_lessons", modules: [] }], refresh: jest.fn() }),
  useSharedData: () => ({ data: { types: [{ key: "private_lessons", label: "Private Lessons", color: "#8cc63f" }], focuses: [] } }),
}));
jest.mock("./ProgramStudio", () => {
  const Real = jest.requireActual("./ProgramStudio").default;
  const Mocked = (props) => (global.__studioStub
    ? <button data-testid="stub-studio-saved" onClick={() => props.onSaved(global.__studioStub)}>saved</button>
    : <Real {...props} />);
  return { __esModule: true, default: Mocked };
});

const { api } = require("../lib/api");
global.IS_REACT_ACT_ENVIRONMENT = true;

const MSG = "This save would put a problem live that would stop students — fix it first. Nothing was saved.";
const PROGRAM = {
  id: "prog-1", name: "Rock Solid Recall", type: "private_lessons", format: { count: 2, unit: "modules" }, price: 0,
  modules: [
    { id: "m1", name: "Foundations", order: 0,
      goals: [{ id: "g1", name: "Sit" }, { id: "g2", name: "Down", prerequisite_skill_ids: ["g1"], suggested_next_skill_id: "g1" }],
      lessons: [{ id: "l1", name: "Name game", order: 0 }, { id: "l2", name: "Hand target", order: 1 }],
      module_quiz: { enabled: true, questions: [{ id: "q1", question: "Sit?", review_lesson_id: "l2", options: [], correct_option_id: null }] } },
    { id: "m2", name: "Distance", order: 1, goals: [], lessons: [{ id: "l3", name: "Long line", order: 0 }] },
  ],
};
const refusal = (errors) => ({ response: { status: 422, data: { detail: MSG, detail_object: { error_code: "course_structure_problems", message: MSG, msg: MSG, errors } } } });

describe("the helpers", () => {
  test("a refusal's list is read from detail_object (detail is only the sentence)", () => {
    const e = refusal([{ code: "x", plain: "P" }]);
    expect(structureRefusal(e)).toEqual({ message: MSG, errors: [{ code: "x", plain: "P" }] });
    expect(structureRefusal({ response: { data: { detail: "nope" } } })).toBeNull();
    expect(structureRefusal({ response: { data: { detail_object: { errors: [] } } } })).toBeNull();
  });
  test("each problem reads as its plain sentence", () => {
    expect(saveProblemLine({ plain: "Lesson 'A' has a timer block with no duration.", message: "raw" })).toBe("Lesson 'A' has a timer block with no duration.");
    expect(saveProblemLine({ message: "raw" })).toBe("raw");
    expect(saveProblemLine("already words")).toBe("already words");
  });
  test("a problem opens its lesson by id, or by position when it only got its id in the refused save", () => {
    const mods = [{ id: "m1", _key: "k1", goals: [{ id: "g1", _key: "gk1" }], lessons: [{ id: "l1", _key: "lk1" }, { _key: "lk-new" }] }];
    expect(resolveSaveProblemTarget({ module_id: "m1", lesson_id: "l1" }, mods)).toEqual({ moduleKey: "k1", lessonKey: "lk1" });
    expect(resolveSaveProblemTarget({ module_id: "m1", lesson_id: "fresh", module_index: 0, lesson_index: 1 }, mods)).toEqual({ moduleKey: "k1", lessonKey: "lk-new" });
    expect(resolveSaveProblemTarget({ module_id: "fresh-m", skill_id: "fresh-s", module_index: 0, skill_index: 0 }, mods)).toEqual({ moduleKey: "k1", skillKey: "gk1" });
    expect(resolveSaveProblemTarget({ module_id: "gone" }, mods)).toBeNull();
    // A problem about no module/lesson/skill (e.g. a pathway slug) opens nothing —
    // never the first module that has no id yet.
    expect(resolveSaveProblemTarget({ code: "duplicate_program_slug", slug: "x" }, [{ _key: "k-new", goals: [], lessons: [] }])).toBeNull();
    expect(resolveSaveProblemTarget("words", mods)).toBeNull();
  });
  test("the after-save heading", () => {
    expect(liveProblemsHeadline(["a"])).toBe("Saved. This course still has a problem from before this save");
    expect(liveProblemsHeadline(["a", "b"])).toBe("Saved. This course still has 2 problems from before this save");
    expect(liveProblemsHeadline([])).toBe("");
  });
  test("deleting drops links to what is gone, and only touches fields already there", () => {
    const out = dropDeadLinks(PROGRAM.modules, { skillIds: ["g1"], lessonIds: ["l2"] });
    expect(out[0].goals[1].prerequisite_skill_ids).toEqual([]);
    expect(out[0].goals[1].suggested_next_skill_id).toBeNull();
    expect(out[0].module_quiz.questions[0].review_lesson_id).toBeNull();
    expect("prerequisite_skill_ids" in out[0].goals[0]).toBe(false);
    expect(dropDeadLinks(PROGRAM.modules, {})).toBe(PROGRAM.modules);
    expect(curriculumIds([PROGRAM.modules[0]])).toEqual({ skillIds: ["g1", "g2"], lessonIds: ["l1", "l2"] });
  });
  test("an exported template never carries a save's report", () => {
    expect(TEMPLATE_STRIP_FIELDS).toContain("_live_problems");
  });
});

let container, root, errors;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  errors = [];
  jest.spyOn(console, "error").mockImplementation((...a) => errors.push(String(a[0])));
  api.get.mockReset(); api.post.mockReset(); api.put.mockReset();
  api.get.mockImplementation((url) => {
    if (url.includes("active-enrollments-count")) return Promise.resolve({ data: { count: 0 } });
    if (url.includes("publish-impact")) return Promise.resolve({ data: { skills_added: 0, skills_removed: 0, enrollments_affected: 0, validation: { valid: true, errors: [], warnings: [] } } });
    if (url === "/programs/prog-1") return Promise.resolve({ data: PROGRAM });
    if (url.includes("/shop/categories")) return Promise.resolve({ data: { categories: [] } });
    return Promise.resolve({ data: [] });
  });
});
afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  root = null;
  console.error.mockRestore();
  global.__studioStub = undefined;
});

const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
const mount = async (el) => {
  await act(async () => {
    root = createRoot(container);
    root.render(<MemoryRouter><ConfirmProvider>{el}</ConfirmProvider></MemoryRouter>);
  });
  await flush();
};
const byTestId = (id) => document.querySelector(`[data-testid="${id}"]`);
const click = async (el) => { await act(async () => { el.click(); }); await flush(); };
const noCrash = () => expect(errors.filter((e) => /is not defined|Cannot access|is not a function|Cannot read prop|not valid as a React child/.test(e))).toEqual([]);
const studio = (program = PROGRAM, onSaved = jest.fn()) =>
  <ProgramStudio programId="prog-1" initialProgram={program} meta={{ types: [], focuses: [] }} allPrograms={[]} onClose={() => {}} onSaved={onSaved} />;

describe("Program Studio: Save Live that would put a problem live", () => {
  test("says why, lists each problem, and a click opens the lesson it's on", async () => {
    api.put.mockRejectedValue(refusal([
      { code: "timer_missing_duration", plain: "Lesson 'Hand target' has a timer block with no duration.", module_id: "m1", lesson_id: "l2", module_index: 0, lesson_index: 1 },
    ]));
    const onSaved = jest.fn();
    await mount(studio(PROGRAM, onSaved));
    await click(byTestId("studio-save-live"));
    expect(byTestId("studio-err").textContent).toBe(MSG);
    const list = byTestId("studio-save-problems");
    expect(list.textContent).toContain("Lesson 'Hand target' has a timer block with no duration.");
    expect(onSaved).not.toHaveBeenCalled();
    await click(byTestId("studio-save-problem-0"));
    expect([...document.querySelectorAll("input")].some((i) => i.value === "Hand target")).toBe(true);
    noCrash();
  });

  test("a refusal from Publish fills the Validation checklist (its list was being dropped)", async () => {
    api.post.mockRejectedValue({ response: { status: 422, data: {
      detail: "Draft has validation errors and cannot be published.",
      detail_object: { message: "Draft has validation errors and cannot be published.", errors: [{ code: "timer_missing_duration", message: "Lesson 'Name game' has a timer block with no duration.", module_id: "m1", lesson_id: "l1" }] } } } });
    await mount(studio({ ...PROGRAM, draft: { saved_at: "2026-10-01T10:00:00Z", modules: PROGRAM.modules } }));
    await click([...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Curriculum"));
    const publishBtn = byTestId("studio-publish-readiness-publish");
    expect(publishBtn).not.toBeNull();
    await click(publishBtn);
    expect(byTestId("studio-publish-readiness-badges").textContent).toContain("1 Blocking Error(s)");
    noCrash();
  });

  test("deleting a lesson a quiz question reviews, and a skill another skill builds on, saves without the dead links", async () => {
    api.put.mockResolvedValue({ data: PROGRAM });
    await mount(studio());
    const tab = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Curriculum");
    await click(tab);
    const removeLesson = [...document.querySelectorAll('button[aria-label="Remove lesson"]')][1];
    await click(removeLesson);
    const removeSkill = [...document.querySelectorAll('button[aria-label="Remove skill"]')][0];
    await click(removeSkill);
    await click(byTestId("studio-save-live"));
    const sent = api.put.mock.calls[0][1];
    const m1 = sent.modules[0];
    expect(m1.lessons.map((l) => l.name)).toEqual(["Name game"]);
    expect(m1.module_quiz.questions[0].review_lesson_id).toBeNull();
    expect(m1.goals.map((g) => g.name)).toEqual(["Down"]);
    expect(m1.goals[0].prerequisite_skill_ids).toEqual([]);
    expect(m1.goals[0].suggested_next_skill_id).toBeNull();
    noCrash();
  });
});

describe("the Programs list after a save that went through", () => {
  test("problems the course already had are listed until dismissed", async () => {
    global.__studioStub = { ...PROGRAM, _live_problems: ["Module 'Foundations', lesson 'Name game' links a Practice recipe that no longer exists."] };
    await mount(<ProgramsPanel />);
    await click(byTestId("prog-edit-prog-1"));
    await click(byTestId("stub-studio-saved"));
    const banner = byTestId("live-problems-summary");
    expect(banner.textContent).toContain("Saved. This course still has a problem from before this save");
    expect(banner.textContent).toContain("links a Practice recipe that no longer exists");
    expect(banner.textContent).toContain("Publish won't go through until they're fixed");
    await click(byTestId("live-problems-dismiss"));
    expect(byTestId("live-problems-summary")).toBeNull();
    noCrash();
  });
  test("no banner when the course had none", async () => {
    global.__studioStub = { ...PROGRAM, _live_problems: [] };
    await mount(<ProgramsPanel />);
    await click(byTestId("prog-edit-prog-1"));
    await click(byTestId("stub-studio-saved"));
    expect(byTestId("live-problems-summary")).toBeNull();
  });
});

describe("the curriculum ZIP import", () => {
  const choose = async () => {
    const input = byTestId("prog-import-zip-input");
    const file = new File(["PK"], "course.zip", { type: "application/zip" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
    for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    await flush();
  };
  test("a refused package lists why in words", async () => {
    api.post.mockRejectedValue({ response: { status: 422, data: { detail: "x", detail_object: {
      error_code: "invalid_curriculum_package", errors: ["Module 'M1', lesson 'L1' links a Practice recipe that no longer exists."] } } } });
    await mount(<ProgramsPanel />);
    await choose();
    const panel = byTestId("zip-import-errors");
    expect(panel.textContent).toContain("Nothing was created");
    expect(panel.textContent).toContain("links a Practice recipe that no longer exists");
    noCrash();
  });
  test("an import over a course with old problems says they're still there", async () => {
    api.post.mockResolvedValue({ data: { program_action: "updated", program_name: "Recall", modules: 1, lessons: 1, blocks: 1, images: 0, unplaced_media: 0,
      errors: [], existing_problems: ["Lesson 'L1' has a timer block with no duration."] } });
    await mount(<ProgramsPanel />);
    await choose();
    expect(byTestId("zip-import-summary")).not.toBeNull();
    expect(byTestId("zip-import-existing-problems").textContent).toContain("Lesson 'L1' has a timer block with no duration.");
    noCrash();
  });
});
