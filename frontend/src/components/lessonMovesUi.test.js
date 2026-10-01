/**
 * Audit #52 — a course edit pushed to enrolled dogs never strands one, and
 * the owner is told who moves where before and after.
 *
 * Mounted, not source-pinned: Save Live's preview → dialog → save → result
 * banner, and the Publish center's warning.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { ConfirmProvider } from "../lib/useConfirm";
import {
  describeLessonMove, lessonMoveLines, lessonMovePreviewIntro, lessonMovePreviewNote,
  lessonMovesHeadline, previewLessonMoves, removedLessonCount,
} from "../lib/lessonMoves";
import PublishReadinessPanel from "./training/PublishReadinessPanel";
import ProgramStudio from "./ProgramStudio";
import { ProgramsPanel } from "./Programs";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn(), defaults: { baseURL: "/api" } },
  formatErr: (e) => String(e || ""),
}));
jest.mock("../lib/auth", () => ({ useAuth: () => ({ permissions: null, user: { role: "admin" }, isOwner: () => true }) }));
const PROGRAM = {
  id: "prog-1", name: "Rock Solid Recall", type: "private_lessons", format: { count: 2, unit: "modules" }, price: 0,
  modules: [
    { id: "m1", name: "Foundations", order: 0, goals: [], lessons: [
      { id: "l-a", name: "Name game", order: 0 }, { id: "l-b", name: "Hand target", order: 1 }, { id: "l-c", name: "Check-ins", order: 2 }] },
    { id: "m2", name: "Distance", order: 1, goals: [], lessons: [{ id: "l-d", name: "Long line", order: 0 }] },
  ],
};
jest.mock("../lib/sharedData", () => ({
  useProgramsData: () => ({ data: [{ id: "prog-1", name: "Rock Solid Recall", type: "private_lessons", modules: [] }], refresh: jest.fn() }),
  useSharedData: () => ({ data: { types: [{ key: "private_lessons", label: "Private Lessons", color: "#8cc63f" }], focuses: [] } }),
}));

const { api } = require("../lib/api");
global.IS_REACT_ACT_ENVIRONMENT = true;

const MOVE_B = {
  enrollment_id: "e1", dog_id: "d1", dog_name: "Rex", rule: "next_in_module",
  from_module_id: "m1", from_lesson_id: "l-b", from_module_name: "Foundations", from_lesson_name: "Hand target",
  to_module_id: "m1", to_lesson_id: "l-c", to_module_name: "Foundations", to_lesson_name: "Check-ins",
};
const MOVE_QUIZ = { ...MOVE_B, enrollment_id: "e2", dog_name: "Luna", rule: "held_for_module_quiz", from_lesson_name: "Check-ins", to_lesson_name: "Hand target" };
const MOVE_MODULE = { ...MOVE_B, enrollment_id: "e3", dog_name: "Milo", rule: "lesson_moved_module", from_lesson_name: "Long line", to_module_name: "Foundations", to_lesson_name: "Long line" };

describe("how a lesson move is said", () => {
  test("a plain move names the dog, where they were and where they go", () => {
    expect(describeLessonMove(MOVE_B)).toBe('Rex: "Hand target" → "Check-ins" (Foundations)');
  });
  test("each rule reads as a sentence the owner can act on", () => {
    expect(describeLessonMove(MOVE_QUIZ)).toMatch(/Luna: "Check-ins" → "Hand target" \(Foundations\) — the Foundations quiz still comes first/);
    expect(describeLessonMove(MOVE_MODULE)).toBe('Milo: "Long line" now sits in Foundations — they stay on it');
    expect(describeLessonMove({ ...MOVE_B, rule: "was_already_missing", from_lesson_name: "" })).toMatch(/^Rex: was on a lesson that no longer exists → "Check-ins"/);
    expect(describeLessonMove({ ...MOVE_B, rule: "no_lessons_left" })).toMatch(/no lessons are left — add a lesson/);
    expect(describeLessonMove({ rule: "changed_during_save", dog_name: "Rex" })).toMatch(/changed lessons while this saved/);
    expect(describeLessonMove({ ...MOVE_B, dog_name: "" })).toMatch(/^A dog:/);
  });
  test("a long list is capped with a count of the rest", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ ...MOVE_B, dog_name: `Dog ${i}` }));
    const lines = lessonMoveLines(many);
    expect(lines).toHaveLength(7);
    expect(lines[6]).toBe("…and 3 more");
    expect(lessonMoveLines(null)).toEqual([]);
  });
  test("the preview heading counts only dogs whose lesson was removed", () => {
    expect(removedLessonCount({ lesson_moves: [MOVE_B, MOVE_MODULE] })).toBe(1);
    expect(lessonMovePreviewIntro({ students_on_removed_lessons: 2, lesson_moves: [MOVE_B, MOVE_QUIZ] }))
      .toBe("2 enrolled dogs are on a lesson you removed. With Yes, they move to the nearest lesson that still exists:");
    expect(lessonMovePreviewIntro({ students_on_removed_lessons: 0, lesson_moves: [MOVE_MODULE] }, "Publish & Update"))
      .toBe("With Publish & Update, this dog follows its lesson to the new module:");
    expect(lessonMovePreviewIntro({ students_on_removed_lessons: 0, lesson_moves: [] })).toBe("");
    expect(lessonMovePreviewNote(null)).toBe("");
  });
  test("the saved headline", () => {
    expect(lessonMovesHeadline([MOVE_B])).toBe("1 enrolled dog changed lesson because the course changed");
    expect(lessonMovesHeadline([])).toBe("");
  });
  test("a failed preview never blocks the save", async () => {
    const client = { post: jest.fn().mockRejectedValue(new Error("down")) };
    expect(await previewLessonMoves(client, "prog-1", [])).toBeNull();
    const ok = { post: jest.fn().mockResolvedValue({ data: { lesson_moves: [MOVE_B] } }) };
    expect(await previewLessonMoves(ok, "prog-1", [{ id: "m1" }])).toEqual({ lesson_moves: [MOVE_B] });
    expect(ok.post).toHaveBeenCalledWith("/programs/prog-1/cascade-preview", { modules: [{ id: "m1" }] });
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
    if (url.includes("active-enrollments-count")) return Promise.resolve({ data: { count: 2 } });
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
});

const mount = async (el) => {
  await act(async () => {
    root = createRoot(container);
    root.render(<MemoryRouter><ConfirmProvider>{el}</ConfirmProvider></MemoryRouter>);
  });
  await flush();
};
const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
const byTestId = (id) => document.querySelector(`[data-testid="${id}"]`);
const click = async (el) => { await act(async () => { el.click(); }); await flush(); };
const noCrash = () => expect(errors.filter((e) => /is not defined|Cannot access|is not a function|Cannot read prop/.test(e))).toEqual([]);

describe("the Publish center warns before a publish moves anyone", () => {
  const impact = { skills_added: 0, skills_removed: 0, enrollments_affected: 2, progress_entries_preserved: 0, progress_entries_orphaned: 0,
                   students_on_removed_lessons: 1, lesson_moves: [MOVE_B] };
  test("the dogs on a removed lesson are listed with where they go", async () => {
    await mount(<PublishReadinessPanel draftMeta={{ saved_at: "x" }} validation={{ valid: true, errors: [], warnings: [] }}
                                       impact={impact} onPublish={() => {}} testid="pr" />);
    const box = byTestId("pr-lesson-moves");
    expect(box).not.toBeNull();
    expect(box.textContent).toContain("1 enrolled dog is on a lesson you removed. With Publish & Update, it moves to the nearest lesson that still exists:");
    expect(box.textContent).toContain('Rex: "Hand target" → "Check-ins" (Foundations)');
    expect(box.textContent).toContain("Publish for Future Enrollments moves nobody");
    noCrash();
  });
  test("nothing extra when nobody moves", async () => {
    await mount(<PublishReadinessPanel draftMeta={{ saved_at: "x" }} validation={{ valid: true, errors: [], warnings: [] }}
                                       impact={{ ...impact, students_on_removed_lessons: 0, lesson_moves: [] }} onPublish={() => {}} testid="pr" />);
    expect(byTestId("pr-lesson-moves")).toBeNull();
  });
});

describe("Save Live asks with the list, then reports what happened", () => {
  test("the dialog lists who would move; Yes saves with the cascade and hands back the moves", async () => {
    api.post.mockImplementation((url) => url.endsWith("/cascade-preview")
      ? Promise.resolve({ data: { students_on_removed_lessons: 1, lesson_moves: [MOVE_B] } })
      : Promise.resolve({ data: {} }));
    api.put.mockResolvedValue({ data: { ...PROGRAM, _cascaded_enrollments: 2, _lesson_moves: [MOVE_B] } });
    const onSaved = jest.fn();
    await mount(<ProgramStudio programId="prog-1" initialProgram={PROGRAM} meta={{ types: [], focuses: [] }} allPrograms={[]} onClose={() => {}} onSaved={onSaved} />);
    await click(byTestId("studio-save-live"));
    const dialog = byTestId("confirm-dialog");
    expect(dialog).not.toBeNull();
    expect(api.post).toHaveBeenCalledWith("/programs/prog-1/cascade-preview", expect.objectContaining({ modules: expect.any(Array) }));
    expect(dialog.textContent).toContain("1 enrolled dog is on a lesson you removed. With Yes, it moves to the nearest lesson that still exists:");
    expect(dialog.textContent).toContain('• Rex: "Hand target" → "Check-ins" (Foundations)');
    await click(byTestId("confirm-yes"));
    expect(api.put).toHaveBeenCalledWith("/programs/prog-1?cascade=true", expect.any(Object));
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ _lesson_moves: [MOVE_B] }));
    noCrash();
  });
  test("a preview that fails still asks the question, just without the list", async () => {
    api.post.mockRejectedValue(new Error("down"));
    api.put.mockResolvedValue({ data: PROGRAM });
    await mount(<ProgramStudio programId="prog-1" initialProgram={PROGRAM} meta={{ types: [], focuses: [] }} allPrograms={[]} onClose={() => {}} onSaved={() => {}} />);
    await click(byTestId("studio-save-live"));
    const dialog = byTestId("confirm-dialog");
    expect(dialog.textContent).toContain("Apply changes to 2 enrolled dogs?");
    expect(dialog.textContent).not.toContain("on a lesson you removed");
    await click(byTestId("confirm-no"));
    expect(api.put).toHaveBeenCalledWith("/programs/prog-1", expect.any(Object));
  });
});

jest.mock("./ProgramStudio", () => {
  const Real = jest.requireActual("./ProgramStudio").default;
  const Mocked = (props) => (global.__studioStub
    ? <button data-testid="stub-studio-saved" onClick={() => props.onSaved(global.__studioStub)}>saved</button>
    : <Real {...props} />);
  return { __esModule: true, default: Mocked };
});

describe("the Programs list shows who a save moved", () => {
  afterEach(() => { global.__studioStub = undefined; });
  test("a banner lists every move until dismissed", async () => {
    global.__studioStub = { ...PROGRAM, _lesson_moves: [MOVE_B, MOVE_QUIZ] };
    await mount(<ProgramsPanel />);
    await click(byTestId("prog-edit-prog-1"));
    await click(byTestId("stub-studio-saved"));
    const banner = byTestId("lesson-moves-summary");
    expect(banner).not.toBeNull();
    expect(banner.textContent).toContain("2 enrolled dogs changed lesson because the course changed");
    expect(banner.textContent).toContain("Rock Solid Recall");
    expect(banner.textContent).toContain('Rex: "Hand target" → "Check-ins" (Foundations)');
    expect(banner.textContent).toContain("Luna:");
    await click(byTestId("lesson-moves-dismiss"));
    expect(byTestId("lesson-moves-summary")).toBeNull();
    noCrash();
  });
  test("no banner when nobody moved", async () => {
    global.__studioStub = { ...PROGRAM, _lesson_moves: [] };
    await mount(<ProgramsPanel />);
    await click(byTestId("prog-edit-prog-1"));
    await click(byTestId("stub-studio-saved"));
    expect(byTestId("lesson-moves-summary")).toBeNull();
  });
});
