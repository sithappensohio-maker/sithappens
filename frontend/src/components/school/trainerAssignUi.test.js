/**
 * Audit #55 — changing a dog's trainer needs 'Assign training staff'.
 * Every trainer picker offers only what the server allows; School HQ's
 * "Save student" sends the trainer only when it was changed (it used to send
 * HQ's possibly-stale copy back and wipe the real trainer), and a refused
 * save says why instead of looking saved.
 *
 * Mounted, not source-pinned.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { TRAINER_LOCKED_HINT, trainerChoices, trainerLabel, trainerPickerMode } from "../../lib/trainerAssign";
import TrainerAssignField from "./TrainerAssignField";
import SchoolStudentsPanel from "./SchoolStudentsPanel";

jest.mock("../../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn(), defaults: { baseURL: "/api" } },
  formatErr: (e) => String(e || ""),
}));
jest.mock("sonner", () => ({ toast: Object.assign(jest.fn(), { success: jest.fn(), error: jest.fn() }) }));
jest.mock("../../lib/auth", () => ({ useAuth: () => global.__auth }));
jest.mock("../../lib/impersonation", () => ({ startImpersonation: jest.fn() }));
jest.mock("../TrainingSessionWorkspace", () => () => null);
jest.mock("../HomeworkReportPanel", () => () => null);

const { api } = require("../../lib/api");
const { toast } = require("sonner");
global.IS_REACT_ACT_ENVIRONMENT = true;

const TRAINERS = [{ id: "t1", name: "Tess" }, { id: "t2", name: "Theo" }];
const OWNER = { can: () => true, user: { id: "owner" } };
const TRAINER_THEO = { can: () => false, user: { id: "t2" } };

describe("the rule, as the pickers show it", () => {
  test("who sees what", () => {
    expect(trainerPickerMode({ canAssign: true, currentId: "t1" })).toBe("full");
    expect(trainerPickerMode({ canAssign: false, currentId: null })).toBe("self_or_none");
    expect(trainerPickerMode({ canAssign: false, currentId: "t1" })).toBe("locked");
    expect(trainerPickerMode({ canAssign: false, currentId: "t2" })).toBe("locked");
  });
  test("a trainer without the permission can only offer themselves", () => {
    expect(trainerChoices("full", TRAINERS, "t2")).toEqual(TRAINERS);
    expect(trainerChoices("self_or_none", TRAINERS, "t2")).toEqual([{ id: "t2", name: "Theo" }]);
    expect(trainerChoices("self_or_none", TRAINERS, "front-desk")).toEqual([]);
    expect(trainerChoices("locked", TRAINERS, "t2")).toEqual([]);
  });
  test("a trainer's name, even one no longer on the list", () => {
    expect(trainerLabel(TRAINERS, "t1")).toBe("Tess");
    expect(trainerLabel(TRAINERS, "gone")).toBe("A trainer who is no longer on the team list");
    expect(trainerLabel(TRAINERS, "gone", "Old Tom")).toBe("Old Tom");
  });
});

let container, root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset(); api.patch.mockReset(); api.post.mockReset();
  toast.error.mockClear();
});
afterEach(() => {
  act(() => root?.unmount());
  container.remove();
  root = null;
  global.__auth = undefined;
});

const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };
const mount = async (el) => { await act(async () => { root = createRoot(container); root.render(el); }); await flush(); };
const byTestId = (id) => document.querySelector(`[data-testid="${id}"]`);

describe("the trainer field", () => {
  test("locked shows the trainer and why it can't be changed", async () => {
    await mount(<TrainerAssignField trainers={TRAINERS} value="t1" onChange={() => {}} canAssign={false} meId="t2" currentId="t1" testid="tf" />);
    expect(byTestId("tf-locked").textContent).toContain("Tess");
    expect(byTestId("tf-locked").textContent).toContain(TRAINER_LOCKED_HINT);
    expect(byTestId("tf-select")).toBeNull();
  });
  test("a dog with no trainer offers only 'me' to a trainer without the permission", async () => {
    await mount(<TrainerAssignField trainers={TRAINERS} value="" onChange={() => {}} canAssign={false} meId="t2" currentId={null} testid="tf" />);
    expect([...byTestId("tf-select").options].map((o) => o.textContent)).toEqual(["Sit Happens team", "Me (Theo)"]);
  });
  test("the owner gets every trainer", async () => {
    await mount(<TrainerAssignField trainers={TRAINERS} value="t1" onChange={() => {}} canAssign meId="owner" currentId="t1" testid="tf" />);
    expect([...byTestId("tf-select").options].map((o) => o.textContent)).toEqual(["Sit Happens team", "Tess", "Theo"]);
  });
});

const student = ({ realTrainer = "t1", copyTrainer = null } = {}) => ({
  school_enrollment: { id: "se1", assigned_trainer_id: copyTrainer, delivery_mode: "trainer_led" },
  enrollment: { id: "e1", dog_id: "d1", assigned_trainer_id: realTrainer, status: "active", delivery_channel: "in_person_school",
                program_snapshot: { name: "Rock Solid Recall", modules: [] } },
  trainer: realTrainer ? { id: realTrainer, name: realTrainer === "t1" ? "Tess" : "Theo" } : null,
  client: { id: "c1", name: "QA Family" }, dog: { id: "d1", name: "Rex" },
  progress: { course_pct: 10 }, checkpoints: [], practice: [], requests: [], support: {}, operations: {}, plans: [], notes: [], events: [],
});

const openStudent = async (data) => {
  api.get.mockImplementation((url) => {
    if (url === "/admin/school/students/se1") return Promise.resolve({ data });
    if (url === "/admin/school/trainers") return Promise.resolve({ data: TRAINERS });
    if (url === "/homework-templates") return Promise.resolve({ data: [] });
    if (url === "/admin/school/students") return Promise.resolve({ data: [] });
    return Promise.resolve({ data: {} });
  });
  await mount(<SchoolStudentsPanel initialStudentId="se1" />);
  await act(async () => { await new Promise((r) => setTimeout(r, 200)); });
  await flush();
};
const saveButton = () => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Save student");

describe("School HQ's Save student", () => {
  test("a trainer saving dates never sends the trainer — even when HQ's copy shows none", async () => {
    global.__auth = TRAINER_THEO;
    api.patch.mockResolvedValue({ data: { ok: true } });
    await openStudent(student({ realTrainer: "t1", copyTrainer: null }));
    expect(byTestId("school-student-trainer-locked").textContent).toContain("Tess");
    await act(async () => { saveButton().click(); });
    await flush();
    expect(api.patch).toHaveBeenCalledTimes(1);
    expect("assigned_trainer_id" in api.patch.mock.calls[0][1]).toBe(false);
  });

  test("the owner's change of trainer is sent", async () => {
    global.__auth = OWNER;
    api.patch.mockResolvedValue({ data: { ok: true } });
    await openStudent(student());
    const select = byTestId("school-student-trainer-select");
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
      setter.call(select, "t2");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => { saveButton().click(); });
    await flush();
    expect(api.patch.mock.calls[0][1].assigned_trainer_id).toBe("t2");
  });

  test("a refused save says why instead of looking saved", async () => {
    global.__auth = OWNER;
    api.patch.mockRejectedValue({ response: { status: 403, data: { detail: "This dog already has a trainer. Changing or removing a dog's trainer needs the 'Assign training staff' permission." } } });
    await openStudent(student());
    await act(async () => { saveButton().click(); });
    await flush();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Assign training staff"));
  });
});

describe("Move into School (legacy program)", () => {
  const { LegacyMigrationModal } = require("../DogTrainingTab");
  const legacy = { id: "leg1", program_id: "p1", assigned_trainer_id: "t1", current_lesson_id: "l1" };
  const programs = [{ id: "p1", name: "Recall", delivery_mode: "trainer_led",
                      modules: [{ id: "m1", name: "Foundations", lessons: [{ id: "l1", name: "Name game", order: 0 }] }] }];
  const moveIt = async () => {
    api.get.mockResolvedValue({ data: TRAINERS });
    api.post.mockResolvedValue({ data: { ok: true } });
    await mount(<LegacyMigrationModal legacy={legacy} programs={programs} dogName="Rex" onClose={() => {}} onMigrated={() => {}} />);
    await act(async () => { byTestId("legacy-migration-confirm").click(); });
    await flush();
    return api.post.mock.calls[0][1];
  };
  test("without the permission the trainer is shown, not sent — the server keeps it", async () => {
    global.__auth = TRAINER_THEO;
    const body = await moveIt();
    expect(byTestId("legacy-migration-trainer-locked").textContent).toContain("Tess");
    expect(body.assigned_trainer_id).toBeNull();
  });
  test("the owner's chosen trainer is sent as before", async () => {
    global.__auth = OWNER;
    const body = await moveIt();
    expect(body.assigned_trainer_id).toBe("t1");
  });
});
