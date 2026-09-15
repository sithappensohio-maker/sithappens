/* Stage 12 — ONE Training Hub, composed by capability.
 *
 * Source-level guards (this repo's no-RTL convention) prove the hub never grew a
 * second owner/trainer implementation: the same Pipeline screen and the same
 * TrainerDayQueue render owner-oriented or trainer-oriented presentation from
 * `can("assign_training_staff")`, never from a role name. Pure helpers are
 * rendered for real. */
const fs = require("fs");
const path = require("path");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { hubPresentation, needsAssignmentCount, groupTrainerDay } = require("../lib/trainerDay");
const TrainerDayQueue = require("../components/training/TrainerDayQueue.jsx").default;
const { TrainerDayCard } = require("../components/training/TrainerDayQueue.jsx");

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");
const pipelineSrc = read("Pipeline.jsx");
const portalSrc = read("EmployeePortal.jsx");
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

const item = (over = {}) => ({
  key: "session:b1", kind: "session", section: "today", priority: 40, since: null, time: "10:30", mine: true, needs_assignment: false,
  dog: { id: "d1", name: "Lexi", photo: "" }, client: { name: "Sam Lee" }, program: { name: "Level 1", enrollment_id: "e1" },
  lesson: { module_name: "Module 2", lesson_name: "Sit" }, delivery_mode: "in_person", state: "Scheduled",
  today_line: "In-person lesson at 10:30", next_line: "Run Sit.", last_activity: null,
  action: { kind: "start_session", label: "Start session", target: { booking_id: "b1" } }, no_action_reason: null, secondary: [], flags: [],
  assigned_trainer_id: null, ...over,
});

test("1/2. owner and trainer get different words over the same hub — chosen by capability, not role name", () => {
  const owner = hubPresentation({ canAssign: true });
  const trainer = hubPresentation({ canAssign: false });
  expect(owner.title).toMatch(/Training Operations/);
  expect(owner.subtitle).toMatch(/staff workload|reviews.*programs/i);
  expect(trainer.title).toMatch(/My Training Day/);
  expect(trainer.subtitle).toMatch(/Your assigned dogs/);
  expect(pipelineSrc).toMatch(/const canAssignStaff = can\("assign_training_staff"\)/);
  expect(pipelineSrc).toMatch(/hubPresentation\(\{ canAssign: operations \}\)/);
  // no role-name switch decides the presentation or the assignment control
  expect(pipelineSrc).not.toMatch(/canAssignTrainer=\{user\?\.role/);
  expect(pipelineSrc).not.toMatch(/isOwnerOrAdmin/);
  // ONE hub: no Owner/Trainer hub components exist
  expect(fs.existsSync(path.join(__dirname, "..", "components", "training", "OwnerTrainingHub.jsx"))).toBe(false);
  expect(fs.existsSync(path.join(__dirname, "..", "components", "training", "TrainerTrainingHub.jsx"))).toBe(false);
  expect(fs.existsSync(path.join(__dirname, "TrainerHub.jsx"))).toBe(false);
});

test("3. the trainer's surface leads with the day: no Everyone toggle, no pipeline filters, My students is a quiet secondary roster", () => {
  expect(pipelineSrc).toMatch(/onToggleMine=\{operations \? setMineOnly : undefined\}/);
  expect(pipelineSrc).toMatch(/\{operations \? \(\s*<div data-testid="pipeline-programs">/);
  expect(pipelineSrc).toMatch(/<details[^>]*data-testid="my-students"/);
  expect(pipelineSrc).toMatch(/if \(!operations && user\?\.id\) params\.trainer = user\.id;/);
  // the trainer hero stats come from the day, the owner's from the program pipeline
  expect(pipelineSrc).toMatch(/data-testid="hub-stats-trainer"/);
  expect(pipelineSrc).toMatch(/data-testid="hub-stats-operations"/);
  // the Staff Portal mounts the SAME Pipeline (no trainer copy)
  expect(portalSrc).toMatch(/import Pipeline from "\.\/Pipeline"/);
  expect(portalSrc).toMatch(/<Pipeline \/>/);
});

test("4/5. Needs assignment is an owner control over unowned work; a trainer never sees it", () => {
  const items = [item(), item({ key: "session:b2", needs_assignment: true, flags: ["unassigned"], dog: { id: "d2", name: "Bolt", photo: "" } }),
                 item({ key: "checkpoint:c1", kind: "checkpoint_review", section: "needs_attention", needs_assignment: true, flags: ["unassigned"], dog: { id: "d3", name: "Nala", photo: "" },
                        action: { kind: "review_checkpoint", label: "Review checkpoint", target: { submission_id: "c1" } } })];
  expect(needsAssignmentCount(items)).toBe(2);
  expect(groupTrainerDay(items, { needsAssignmentOnly: true }).flatMap((s) => s.items.map((i) => i.dog.name))).toEqual(["Nala", "Bolt"]);
  const owner = renderToStaticMarkup(React.createElement(TrainerDayQueue, {
    day: { items }, canAssignTrainer: true, onToggleNeedsAssignment: () => {}, onToggleMine: () => {}, onAction: () => {}, trainers: [],
  }));
  expect(owner).toMatch(/data-testid="trainer-day-needs-assignment"/);
  expect(text(owner)).toMatch(/Needs assignment · 2/);
  expect(text(owner)).toMatch(/2 need a trainer/);
  expect(owner).toMatch(/data-testid="day-item-flag-unassigned"/);
  const filtered = renderToStaticMarkup(React.createElement(TrainerDayQueue, {
    day: { items }, canAssignTrainer: true, needsAssignmentOnly: true, onToggleNeedsAssignment: () => {}, onAction: () => {},
  }));
  expect(filtered).toMatch(/Bolt/); expect(filtered).toMatch(/Nala/); expect(filtered).not.toMatch(/Lexi/);
  const trainer = renderToStaticMarkup(React.createElement(TrainerDayQueue, { day: { items: [item()] }, heading: "Your day", onAction: () => {} }));
  expect(trainer).not.toMatch(/trainer-day-needs-assignment/);
  expect(trainer).not.toMatch(/trainer-day-all/);
  expect(trainer).not.toMatch(/need a trainer/);
});

test("owner cards say which trainer owns the work; the trainer's own cards do not repeat their name", () => {
  const trainers = [{ id: "t1", name: "Jess" }];
  const owned = item({ assigned_trainer_id: "t1" });
  const owner = renderToStaticMarkup(React.createElement(TrainerDayCard, { item: owned, canAssignTrainer: true, trainers, onAction: () => {} }));
  expect(owner).toMatch(/data-testid="day-item-trainer"/);
  expect(text(owner)).toMatch(/Jess/);
  const mine = renderToStaticMarkup(React.createElement(TrainerDayCard, { item: owned, canAssignTrainer: false, trainers, onAction: () => {} }));
  expect(mine).not.toMatch(/day-item-trainer/);
});

test("10. Done today cards are quiet confirmations: what, when, by whom — no fake button", () => {
  const done = item({ key: "done:practice:h1:l1", kind: "done_practice_review", section: "done", state: "Practice reviewed",
                      today_line: "Looks good · 10:12 am by you", next_line: "Nothing more to do on this one.", action: null, no_action_reason: "Done." });
  const html = renderToStaticMarkup(React.createElement(TrainerDayQueue, { day: { items: [done] }, onAction: () => {} }));
  expect(html).toMatch(/data-testid="day-section-done"/);
  expect(text(html)).toMatch(/Practice reviewed/);
  expect(text(html)).toMatch(/Looks good · 10:12 am by you/);
  expect(html).not.toMatch(/data-testid="day-item-action"/);
  expect(html).not.toMatch(/data-testid="day-item-no-action"/);
  expect(text(html)).toMatch(/What got finished today/);
});
