/* Stage 9 — the trainer's teaching guide over the canonical lesson, plus the
 * admin/trainer boundary: the live workspace never carries authoring UI. */
const fs = require("fs");
const path = require("path");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const TrainerLessonGuide = require("./TrainerLessonGuide.jsx").default;
const { guideFromActivities } = require("./TrainerLessonGuide.jsx");

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");
const baseSrc = read("..", "TrainingSessionWorkspaceBase.jsx");
const wrapperSrc = read("..", "TrainingSessionWorkspace.jsx");
const guideSrc = read("TrainerLessonGuide.jsx");
const briefingSrc = read("TrainerBriefing.jsx");
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

const guide = (over = {}) => ({
  lesson_id: "l6", lesson_name: "Adding Distance", module_name: "Place", estimated_minutes: 12,
  goal: "Hold Place while the handler moves away.", how_to_teach: "Start one step away; return and reward before the dog moves.",
  watch_for: "Handler moves too fast. Dog creeps forward.", success_looks_like: "Thirty seconds at ten feet, twice.",
  advancement_criteria: "Two clean sessions.", safety_notes: null, setup: "Mat on a non-slip surface.", equipment: "Mat, treats",
  why_it_matters: "Distance is the foundation of duration.", client_overview: "You'll work on staying in Place.", client_instructions: "Step back, return, reward.",
  demo_video_url: null,
  skills: [{ id: "s1", name: "Place — distance", objective: "Stay on Place at distance", pass_criteria: "10 ft for 30 s", starting_criteria: "1 step", reset_criteria: "Dog leaves mat", trainer_only_guidance: "Reward on the mat only.", client_explanation: "Stay while I step away.", targets: {}, manual_only: false }],
  practice: { configured: true, available: true, title: "Place With Distance", description: "5 minutes, twice today.", coach_mode: true },
  checkpoint: null, content_blocks: [{ id: "b1", type: "image", url: "data:image/png;base64,xx", config: { alt: "Hand target" }, order: 1 }, { id: "b2", type: "text", title: "Setup", body: "Mat in the corner.", order: 2 }],
  has_structured_content: true,
  ...over,
});

const render = (g, extra = {}) => renderToStaticMarkup(React.createElement(TrainerLessonGuide, { guide: g, ...extra }));

test("the guide reads Goal → How to teach it → Watch for → Success looks like → Skills → Practice, in that order", () => {
  const html = render(guide());
  const order = ["guide-goal", "guide-how", "guide-watch", "guide-success", "guide-skills", "guide-practice", "train-lesson-guide-full"].map((id) => html.indexOf(`data-testid="${id}"`));
  expect(order.every((i) => i > 0) && [...order].sort((a, b) => a - b).join() === order.join()).toBe(true);
  const t = text(html);
  expect(t).toMatch(/Goal · Hold Place while the handler moves away\./);
  expect(t).toMatch(/How to teach it · Start one step away/);
  expect(t).toMatch(/Watch for · Handler moves too fast\. Dog creeps forward\./);
  expect(t).toMatch(/Success looks like · Thirty seconds at ten feet, twice\./);
  expect(t).toMatch(/Skills to record Place — distance · pass when 10 ft for 30 s/);
  expect(t).toMatch(/Practice to send home Place With Distance 5 minutes, twice today\./);
  // the long material is one tap away and includes the lesson's own blocks/images through the shared renderer
  expect(text(html)).toMatch(/View full lesson guide/);
  expect(guideSrc).toMatch(/title="View full lesson guide"/);
  expect(guideSrc).toMatch(/<LessonContentBlocks blocks=\{guide\.content_blocks\} previewMode readOnly \/>/);
  expect(guideSrc).toMatch(/import LessonContentBlocks from "\.\.\/school\/student\/LessonContentBlocks"/);
});

test("a checkpoint lesson shows the trainer's mark scheme, the readiness guidance and the current state", () => {
  const cp = { title: "Place Skills", assessment_type: "checkpoint", submission_instructions: "Film from the side.", submission_requirements: "Good lighting.", pass_readiness_guidance: "3+ clean reps.",
    handler_criteria: [{ id: "h1", name: "Cue clarity", guidance: "One cue, no repeats." }], dog_criteria: [{ id: "d1", name: "Latency", guidance: "Under two seconds." }] };
  const html = render(guide({ checkpoint: cp }), { checkpointState: { state: "submitted", detail: "Client submitted Place Skills today. Review it before advancing." } });
  expect(html).toMatch(/data-testid="guide-checkpoint" data-state="submitted"/);
  const t = text(html);
  expect(t).toMatch(/Checkpoint · Place Skills State · Client submitted Place Skills today/);
  expect(t).toMatch(/Pass when · 3\+ clean reps\./);
  expect(t).toMatch(/Handler · scored 0–5 Cue clarity — One cue, no repeats\./);
  expect(t).toMatch(/Dog · scored 0–5 Latency — Under two seconds\./);
  expect(t).toMatch(/Client films: Good lighting\./);
});

test("a legacy lesson omits empty sections instead of printing blank labels", () => {
  const html = render(guide({ goal: null, how_to_teach: null, watch_for: null, success_looks_like: null, advancement_criteria: null, setup: null, equipment: null, why_it_matters: null, client_overview: null, client_instructions: null,
    practice: null, content_blocks: [], has_structured_content: false, skills: [{ id: "s1", name: "Sit", objective: null, pass_criteria: null, targets: {} }] }));
  expect(html).toMatch(/data-legacy="1"/);
  const t = text(html);
  expect(t).toMatch(/This lesson has no written teaching notes yet\. The skills below are what to record\. Skills to record Sit/);
  expect(t).not.toMatch(/Goal ·|How to teach it ·|Watch for ·|Success looks like ·|—\s*$/);
  expect(html).not.toMatch(/train-lesson-guide-full/);
  // nothing at all → nothing rendered
  expect(render({ goal: null, skills: [], checkpoint: null, content_blocks: [] })).toBe("");
});

test("older bootstraps without a guide fall back to the plan's own lesson fields", () => {
  const acts = [{ id: "a1", source: "skill", skill_id: "s1", name: "Sit", objective: "Sit on cue", trainer_instructions: "Lure up and back.", common_mistakes: "Luring too high.", pass_criteria: "5 in a row", setup: "Quiet room" }];
  const g = guideFromActivities(acts, { today: { lesson_name: "Sit", objective: "5 in a row" } }, { current_lesson_practice: { configured: true, title: "Sit Practice" } });
  expect(g).toMatchObject({ lesson_name: "Sit", goal: "5 in a row", how_to_teach: "Lure up and back.", watch_for: "Luring too high.", success_looks_like: "5 in a row", setup: "Quiet room" });
  expect(g.skills).toEqual([{ id: "s1", name: "Sit", objective: "Sit on cue", pass_criteria: "5 in a row", starting_criteria: null, reset_criteria: null, targets: {} }]);
  expect(g.practice.title).toBe("Sit Practice");
});

test("the live workspace is the teaching view even for an admin: no authoring controls, no Program Studio imports", () => {
  for (const src of [baseSrc, wrapperSrc, guideSrc, briefingSrc]) {
    expect(src).not.toMatch(/ProgramStudio|CurriculumTree|LessonEditor|LessonBlocksEditor|ModuleEditor|SkillEditor|CsvImport|PublishReadiness/);
    expect(src).not.toMatch(/\/admin\/programs|\/admin\/school\/programs|save_as_draft|cascade=/);
  }
  // the only staff request the guide makes is the read-only resource list for imported images
  expect(guideSrc).not.toMatch(/api\.(post|put|delete)\(/);
  expect(baseSrc).toMatch(/import TrainerLessonGuide, \{ guideFromActivities \} from "\.\/training\/TrainerLessonGuide"/);
});

test("lesson material inside the guide is reference-only: a client checklist renders without checkboxes, while the client keeps real boxes", () => {
  const LessonContentBlocks = require("../school/student/LessonContentBlocks.jsx").default;
  const blocks = [{ id: "c1", type: "checklist", title: "Before you start", items: ["Treats cut small", "Mat down"], order: 1 }];
  const staff = renderToStaticMarkup(React.createElement(LessonContentBlocks, { blocks, previewMode: true, readOnly: true }));
  expect(staff).not.toMatch(/<input/);
  expect(staff).toMatch(/data-testid="lesson-content-block-checklist-readonly"/);
  expect(text(staff)).toMatch(/Treats cut small Mat down/);
  const client = renderToStaticMarkup(React.createElement(LessonContentBlocks, { blocks, enrollmentId: "se1" }));
  expect((client.match(/type="checkbox"/g) || []).length).toBe(2);
  // the guide's full material (collapsed by default) is that read-only rendering
  expect(guideSrc).toMatch(/previewMode readOnly/);
});
