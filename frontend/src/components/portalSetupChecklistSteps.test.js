/**
 * Setup checklist: the top badge and the green "Do This Next" box must not
 * disagree about which step the client is on.
 *
 * The badge used to read "Step {finished + 1} of {total}" while the green box
 * numbers the next step by its place in the list. A client with only step 3
 * unfinished saw "Step 6 of 6" and "Do This Next · Step 3 of 6" on one screen.
 * The badge now counts what is finished ("5 of 6 done"). Mounted.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import PortalSetupChecklist from "./PortalSetupChecklist";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn() },
  formatErr: (e) => String(e),
}));
jest.mock("./premium/PremiumButton", () => ({ children, variant, ...rest }) => <button {...rest}>{children}</button>);

const { api } = require("../lib/api");
global.IS_REACT_ACT_ENVIRONMENT = true;

const STEP_DEFS = [
  { id: "client_info",  label: "Your Info",         action_target: "profile",  action_label: "Add Your Info" },
  { id: "dog_info",     label: "Dog Profile",       action_target: "dogs",     action_label: "Add Your Dog" },
  { id: "emergency",    label: "Emergency Contact", action_target: "profile",  action_label: "Add Emergency Contact" },
  { id: "vaccines",     label: "Vaccine Records",   action_target: "vaccines", action_label: "Upload Vaccines" },
  { id: "waiver",       label: "Waiver",            action_target: "waiver",   action_label: "Sign Waiver" },
  { id: "intake_forms", label: "Intake Forms",      action_target: "intake",   action_label: "Fill Out Forms" },
];

// The same shape GET /portal/setup-status returns; `unfinished` lists the
// step ids the client still has to do.
const setupStatus = (unfinished) => {
  const steps = STEP_DEFS.map((s) => ({
    ...s,
    blurb: `${s.label} blurb`,
    status: unfinished.includes(s.id) ? "not_started" : "complete",
    missing: [],
    awaiting_review: [],
  }));
  const completed = steps.filter((s) => s.status === "complete").length;
  return {
    steps,
    completed_count: completed,
    total_count: steps.length,
    booking_locked: true,
    ready_to_book: false,
    overall: completed ? "in_progress" : "not_started",
  };
};

let container, root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  api.get.mockReset();
});
afterEach(() => { act(() => root?.unmount()); root = null; container.remove(); });

const flush = async () => { for (let i = 0; i < 6; i += 1) await act(async () => { await Promise.resolve(); }); };
const q = (id) => container.querySelector(`[data-testid="${id}"]`);
const text = (id) => q(id).textContent.replace(/\s+/g, " ").trim();

const mount = async (status) => {
  api.get.mockResolvedValue({ data: status });
  await act(async () => {
    root = createRoot(container);
    root.render(<PortalSetupChecklist />);
  });
  await flush();
};

test("only step 3 unfinished: badge counts 5 of 6 done and the green box points at step 3", async () => {
  await mount(setupStatus(["emergency"]));

  expect(api.get).toHaveBeenCalledWith("/portal/setup-status");
  expect(text("portal-setup-overall-badge")).toBe("5 of 6 done");
  expect(text("portal-setup-next-step")).toContain("Step 3 of 6");
  expect(text("portal-setup-next-step")).toContain("Emergency Contact");
  // The old badge said "Step 6 of 6" here, contradicting the green box.
  expect(text("portal-setup-overall-badge")).not.toContain("Step 6");
  expect(text("portal-setup-overall-badge")).not.toContain("Step");
});

test("nothing finished: badge says 0 of 6 done and the green box starts at step 1", async () => {
  await mount(setupStatus(STEP_DEFS.map((s) => s.id)));

  expect(text("portal-setup-overall-badge")).toBe("0 of 6 done");
  expect(text("portal-setup-next-step")).toContain("Step 1 of 6");
  expect(text("portal-setup-next-step")).toContain("Your Info");
  expect(text("portal-setup-overall-badge")).not.toContain("Step");
});

test("the badge and the checklist footer agree on how many are left", async () => {
  await mount(setupStatus(["emergency", "waiver"]));

  expect(text("portal-setup-overall-badge")).toBe("4 of 6 done");
  expect(text("portal-setup-next-step")).toContain("Step 3 of 6");
  expect(text("portal-setup-checklist")).toContain("Full setup checklist · 2 left");
});
