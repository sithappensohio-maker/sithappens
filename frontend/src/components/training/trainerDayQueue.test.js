/* Stage 11 — Trainer Daily Queue: grouping, one primary action, truthful
 * no-action rows, empty state, scoping and the mobile-first card. */
const fs = require("fs");
const path = require("path");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const TrainerDayQueue = require("./TrainerDayQueue.jsx").default;
const { TrainerDayCard } = require("./TrainerDayQueue.jsx");
const { groupTrainerDay, actionableCount, contextLine, waitedLabel, emptyStateCopy, SECTIONS } = require("../../lib/trainerDay");

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");
const queueSrc = read("TrainerDayQueue.jsx");
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

const item = (over = {}) => ({
  key: "session:b1", kind: "session", section: "today", priority: 40, since: null, time: "10:30", mine: true,
  dog: { id: "d1", name: "Lexi", photo: "" }, client: { name: "Sam Lee" }, program: { name: "Level 1 — Basic Manners", enrollment_id: "e1" },
  lesson: { module_name: "Module 2", lesson_name: "Lesson 4 — Loose Leash Walking" }, delivery_mode: "in_person",
  state: "Scheduled", today_line: "In-person lesson at 10:30", next_line: "Run Lesson 4 — Loose Leash Walking.",
  last_activity: null, action: { kind: "start_session", label: "Start session", target: { booking_id: "b1", dog_id: "d1", enrollment_id: "e1" } },
  no_action_reason: null, secondary: [{ kind: "check_in", label: "Check in", target: { booking_id: "b1" } }], flags: [],
  ...over,
});

test("sections keep the fixed order and drop empty ones; actionable excludes upcoming/done", () => {
  const items = [
    item({ key: "upcoming:u1", section: "upcoming", kind: "upcoming_booking", action: null, no_action_reason: "Starts on its scheduled day." }),
    item({ key: "checkpoint:c1", section: "needs_attention", kind: "checkpoint_review", action: { kind: "review_checkpoint", label: "Review checkpoint", target: { submission_id: "c1" } } }),
    item(),
    item({ key: "session:b2", section: "done", state: "Session finished", action: { kind: "view_session", label: "View session", target: { booking_id: "b2" } } }),
  ];
  expect(groupTrainerDay(items).map((s) => [s.key, s.items.length])).toEqual([["needs_attention", 1], ["today", 1], ["upcoming", 1], ["done", 1]]);
  expect(actionableCount(items)).toBe(2);
  expect(SECTIONS.map((s) => s.key)).toEqual(["needs_attention", "today", "continue", "upcoming", "done"]);
});

test("a card shows dog, client, program · lesson, delivery mode, state, TODAY, NEXT and exactly one primary action", () => {
  const html = renderToStaticMarkup(React.createElement(TrainerDayCard, { item: item(), onAction: () => {} }));
  const t = text(html);
  expect(t).toMatch(/Lexi · Sam Lee Level 1 — Basic Manners · Module 2 · Lesson 4 — Loose Leash Walking 10:30 Scheduled In person Today In-person lesson at 10:30 Next Run Lesson 4 — Loose Leash Walking\. Start session Check in/);
  expect((html.match(/data-testid="day-item-action"/g) || []).length).toBe(1);
  expect(html).toMatch(/data-testid="day-item-action" data-action-kind="start_session"/);
  expect(html).toMatch(/data-testid="day-item-b1"|data-testid="day-item-session:b1"/);
  expect(contextLine(item({ program: { name: "P" }, lesson: { lesson_name: "L" } }))).toBe("P · L");
});

test("resume really resumes: an in-progress item never offers Start session", () => {
  const it = item({ key: "session:b3", section: "continue", state: "Session in progress", action: { kind: "resume_session", label: "Resume session", target: { booking_id: "b3" } } });
  const html = renderToStaticMarkup(React.createElement(TrainerDayCard, { item: it, onAction: () => {} }));
  expect(text(html)).toMatch(/Session in progress .* Resume session/);
  expect(html).not.toMatch(/Start session/);
});

test("no real action → the reason is shown instead of a fake button; waiting age shows only in Needs attention", () => {
  const blocked = item({ key: "checkpoint:x", section: "needs_attention", kind: "checkpoint_context_problem", state: "Checkpoint cannot be graded", since: new Date(Date.now() - 3 * 3600e3).toISOString(),
    next_line: "This checkpoint submission has no rubric…", action: null, no_action_reason: "Nothing to grade until the client submits again.", secondary: [{ kind: "review_checkpoint", label: "Open in checkpoint queue", target: { submission_id: "x" } }] });
  const html = renderToStaticMarkup(React.createElement(TrainerDayCard, { item: blocked, onAction: () => {} }));
  expect(html).not.toMatch(/data-testid="day-item-action"/);
  expect(html).toMatch(/data-testid="day-item-no-action"[^>]*>Nothing to grade until the client submits again\./);
  expect(html).toMatch(/data-testid="day-item-waited"[^>]*>3h waiting/);
  expect(html).toMatch(/data-testid="day-item-secondary-review_checkpoint"/);
  expect(waitedLabel(new Date(Date.now() - 3 * 86400e3).toISOString())).toBe("3d waiting");
  expect(waitedLabel(null)).toBeNull();
});

test("empty state is calm and truthful, and mentions real upcoming lessons only", () => {
  const html = renderToStaticMarkup(React.createElement(TrainerDayQueue, { day: { items: [item({ key: "upcoming:u1", section: "upcoming", action: null, no_action_reason: "Starts on its scheduled day." })], counts: { upcoming: 1 } }, onAction: () => {} }));
  const t = text(html);
  expect(t).toMatch(/All clear You're caught up\. No training work currently needs your attention\. 1 lesson scheduled after today\./);
  expect(html).toMatch(/data-testid="trainer-day-empty"/);
  expect(html).toMatch(/data-testid="day-section-upcoming" data-count="1"/);
  expect(emptyStateCopy({ upcomingCount: 0, mineOnly: true }).body).toMatch(/assigned to you/);
  expect(emptyStateCopy({ upcomingCount: 0 }).upcoming).toBeNull();
});

test("My work hides items that are not the viewer's; Everyone shows all", () => {
  const items = [item(), item({ key: "session:b9", mine: false, dog: { name: "Bolt" } })];
  expect(groupTrainerDay(items, { mineOnly: true })[0].items.map((i) => i.dog.name)).toEqual(["Lexi"]);
  expect(groupTrainerDay(items, { mineOnly: false })[0].items.length).toBe(2);
  const html = renderToStaticMarkup(React.createElement(TrainerDayQueue, { day: { items }, mineOnly: true, onToggleMine: () => {}, onAction: () => {} }));
  expect(html).toMatch(/aria-pressed="true" data-testid="trainer-day-mine"/);
  expect(html).not.toMatch(/Bolt/);
});

test("mobile-first: the primary action is a full-width tap target on phones, cards stack, no hidden action", () => {
  expect(queueSrc).toMatch(/className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2"/);
  expect(queueSrc).toMatch(/min-h-\[48px\] px-4 rounded-xl font-black text-\[13px\] uppercase tracking-widest inline-flex items-center justify-center gap-2/);
  expect(queueSrc).not.toMatch(/hidden (md|lg):inline[^"]*"[^>]*data-testid="day-item-action"/);
  // urgent information (state/mode/flags) sits above the TODAY/NEXT rows and the action
  const stateIdx = queueSrc.indexOf('data-testid="day-item-state"');
  const nextIdx = queueSrc.indexOf('data-testid="day-item-next"');
  const actionIdx = queueSrc.indexOf('data-testid="day-item-action"');
  expect(stateIdx).toBeLessThan(nextIdx);
  expect(nextIdx).toBeLessThan(actionIdx);
  // the component makes no requests of its own
  expect(queueSrc).not.toMatch(/api\./);
});
