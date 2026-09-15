/* Stage 10 — trainer-side "what happens next": Save & Close, Finish Session
 * (Stay Here / Ready / Needs Review / Complete Program), Practice review,
 * checkpoint review — all read from the mutation response, none persisted. */
const fs = require("fs");
const path = require("path");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { finishHandoff, progressionOutcome } = require("../lib/sessionWrapUp");
const { trainerSaveHandoff, practiceReviewHandoff, checkpointGradeHandoff } = require("../lib/handoff");
const HandoffPanel = require("./HandoffPanel.jsx").default;

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");
const baseSrc = read("TrainingSessionWorkspaceBase.jsx");
const reviewsSrc = read("school", "SchoolReviewsPanel.jsx");
const dailySrc = read("DailyReviewQueue.jsx");
const cpQueueSrc = read("CheckpointReviewQueue.jsx");
const studentsSrc = read("school", "SchoolStudentsPanel.jsx");
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

const result = (action, over = {}) => ({
  session_log: { advancement_action: action, goal_updates: [{ goal_id: "g1" }], ...(over.log || {}) },
  enrollment: { status: "active", current_lesson_name: "Place With Distractions", current_module_name: "Module 2", program_name: "Basic Obedience", ...(over.enrollment || {}) },
  homework_assigned: over.homework_assigned || [{ id: "hw" }],
});

test("Save & Close says what it did NOT do and where to resume", () => {
  const h = trainerSaveHandoff({ dogName: "Milo" });
  expect(h).toMatchObject({ state: "saved", title: "Session saved", action: { label: "Return to Training", run: "close" }, secondary: { label: "Keep Editing", run: "resume" } });
  expect(h.summary).toBe("Your work is saved. This session is still open and has not been sent to Milo's owner as a completed lesson.");
  expect(h.next.label).toBe("Resume it later");
  // the workspace flushes the pending autosave first and never shows "saved" over a failed write
  expect(baseSrc).toMatch(/const saveAndClose = async \(\) => \{\s+const ok = await flushSave\(\);\s+if \(!ok\) return;/);
  expect(baseSrc).toMatch(/onClick=\{saveAndClose\} data-testid="workspace-done"/);
  expect(baseSrc).toMatch(/<HandoffPanel handoff=\{savedHandoff\} testid="workspace-saved"/);
  for (const ph of ["before", "train", "wrap"]) expect(baseSrc).toMatch(new RegExp(`\\{!savedHandoff && phase === "${ph}" && \\(`));
});

test("Finish Session — Stay Here", () => {
  const h = finishHandoff(result("remain"), { dogName: "Milo", sendRecap: true });
  expect(h.title).toBe("Session finished");
  expect(h.summary).toBe("The client recap is ready. Practice has been assigned. 1 skill result recorded.");
  expect(h.next.label).toBe("Next training step");
  expect(h.next.description).toBe("Stay on Place With Distractions. Milo will work on the same lesson next time.");
  expect(h.action).toMatchObject({ label: "Return to Training", run: "close" });
});

test("Finish Session — Ready for Next Lesson uses the response's new position", () => {
  const h = finishHandoff(result("advance_next", { log: { lesson_change: { to_lesson_id: "l6" } }, enrollment: { current_lesson_name: "Adding Distance" } }), { previousLessonName: "Place With Distractions", sendRecap: false, homework_assigned: [] });
  expect(h.state).toBe("complete");
  expect(h.summary).toMatch(/^No recap was sent\./);
  expect(h.next.description).toBe("Module 2 · Adding Distance — the program moved forward.");
  expect(progressionOutcome(result("advance_next", { log: { lesson_change: { to_lesson_id: "l6" } }, enrollment: { current_lesson_name: "Adding Distance" } })).detail).toBe("Module 2 · Adding Distance");
});

test("Finish Session — Needs Review shows the real meaning of assign_review, no invented review state", () => {
  const h = finishHandoff(result("assign_review"), { dogName: "Milo" });
  expect(h.summary).toMatch(/Review work was assigned\.$/);
  expect(h.next.description).toBe("Place With Distractions stays current until the review work is resolved.");
  expect(JSON.stringify(h)).not.toMatch(/needs_review|in_review/);
});

test("Finish Session — Complete Program and the final-lesson stay", () => {
  const done = finishHandoff(result("complete_program", { enrollment: { status: "completed" } }), { dogName: "Milo" });
  expect(done).toMatchObject({ state: "program_complete", title: "Program complete" });
  expect(done.summary).toMatch(/^Basic Obedience has been completed for Milo\./);
  expect(done.next.description).toMatch(/Course and Progress/);
  const finalStay = finishHandoff(result("advance_next", { log: { at_final_lesson: true } }), {});
  expect(finalStay.next.description).toMatch(/is the final lesson — the program stays open until it is completed\./);
});

test("the workspace renders Finish through the shared panel, keeps workspace-next-training-step + data-status, and leaves on Return to Training", () => {
  expect(baseSrc).toMatch(/<HandoffPanel handoff=\{finishHandoff\(completionResult, \{ previousLessonName: lessonName, dogName: dog\?\.name \|\| null, sendRecap \}\)\}/);
  expect(baseSrc).toMatch(/testid="workspace-finished" ids=\{\{ next: "workspace-next-training-step", action: "workspace-close-after-complete" \}\}/);
  expect(baseSrc).toMatch(/status=\{completionResult\.enrollment\?\.status \|\| ""\}/);
  expect(baseSrc).toMatch(/action: "workspace-close-after-complete"/);
  expect(baseSrc).toMatch(/phase !== "before" && !savedHandoff && !completionResult && \(/);
  expect(baseSrc).not.toMatch(/>\s*Done\s*<\/button>/);
});

test("Practice review → approved / sent back / attention, each saying what the client now sees", () => {
  const ok = practiceReviewHandoff("looks_good", { dogName: "Milo" });
  expect(ok).toMatchObject({ state: "complete", title: "Practice approved", action: { label: "Back to Reviews", run: "back" } });
  expect(ok.summary).toMatch(/^Milo's owner can continue according to the program's next step\./);
  const back = practiceReviewHandoff("keep_practicing", { clientName: "Sam" });
  expect(back).toMatchObject({ state: "needs_work", title: "Practice sent back" });
  expect(back.summary).toMatch(/^Sam will see your note in Coach/);
  const redo = practiceReviewHandoff("needs_redo", { dogName: "Ruby", backLabel: "Back to Queue" });
  expect(redo.summary).toBe("Ruby's owner will see your note and a Try Again on that day's Practice.");
  expect(redo.action.label).toBe("Back to Queue");
  expect(practiceReviewHandoff("trainer_attention", {}).state).toBe("waiting");
  // both review surfaces stay on the detail and show the handoff instead of bouncing to the list
  expect(reviewsSrc).toMatch(/setResult\(practiceReviewHandoff\(status, \{ dogName: row\.dog_name, clientName: row\.client_name \}\)\);\s+onReviewed\?\.\(\{ stay: true \}\);/);
  expect(reviewsSrc).toMatch(/if \(!opts\?\.stay\) setActive\(null\);/);
  expect(reviewsSrc).toMatch(/<HandoffPanel handoff=\{result\} testid="practice-review-handoff" onAction=\{onBack\} \/>/);
  expect(dailySrc).toMatch(/setResult\(practiceReviewHandoff\(action === "approve" \? "approved" : "needs_redo"/);
  expect(dailySrc).toMatch(/testid="daily-review-handoff"/);
});

test("checkpoint review → passed / more practice / trainer assist, from the grade response, idempotency untouched", () => {
  const pass = checkpointGradeHandoff({ outcome: "advance", grading_plan: { progression_deferred_for_module_quiz: false, intended_target_lesson_id: "l7" } }, { dogName: "Nala", lessonName: "Down" });
  expect(pass).toMatchObject({ state: "complete", title: "Checkpoint passed", summary: "Nala passed the Down checkpoint." });
  expect(pass.next.description).toMatch(/moved to the next lesson/);
  // a response without target info (older rows) never claims a move it cannot see
  expect(checkpointGradeHandoff({ outcome: "advance", grading_plan: {} }, {}).next.description).toMatch(/current position/);
  const quiz = checkpointGradeHandoff({ outcome: "advance", grading_plan: { progression_deferred_for_module_quiz: true } }, {});
  expect(quiz.next.description).toMatch(/Module Quiz is next/);
  const more = checkpointGradeHandoff({ outcome: "prescribe_practice", prescription: { action: "assign_recipe", min_practice_sessions_required: 3 } }, { dogName: "Duke", lessonName: "Down" });
  expect(more).toMatchObject({ state: "needs_work", title: "More Practice assigned" });
  expect(more.summary).toBe("Duke stays on Down. The client will work through the Practice you chose — at least 3 sessions before retrying the checkpoint.");
  const assist = checkpointGradeHandoff({ outcome: "trainer_assist_recommended" }, { dogName: "Duke" });
  expect(assist).toMatchObject({ state: "waiting", title: "Trainer Assist recommended" });
  // the queue reads the response it used to discard; no second grade call, no remediation created client-side
  expect(cpQueueSrc).toMatch(/const \{ data \} = await api\.post\(`\/admin\/school\/checkpoints\/\$\{active\.id\}\/grade`, body\);\s+setResult\(checkpointGradeHandoff\(data\?\.checkpoint \|\| \{ outcome \}/);
  expect((cpQueueSrc.match(/\/grade`/g) || []).length).toBe(1);
  expect(cpQueueSrc).not.toMatch(/api\.post\(`[^`]*(remediation\/start|prescribe-practice)/);
  // live checkpoint (students panel) lands on the same handoff instead of a toast
  expect(studentsSrc).toMatch(/setLiveResult\(checkpointGradeHandoff\(res\?\.checkpoint\|\|\{\}/);
  expect(studentsSrc).not.toMatch(/toast\.success\("Live checkpoint recorded"\)/);
});

test("trainer handoffs render Result → Next → one action; training corrections are not styled as errors", () => {
  const html = renderToStaticMarkup(React.createElement(HandoffPanel, { handoff: finishHandoff(result("remain"), { dogName: "Milo" }), testid: "workspace-finished", ids: { next: "workspace-next-training-step" }, status: "active", autoFocus: false }));
  expect(html).toMatch(/data-testid="workspace-finished" data-state="next" data-status="active"/);
  expect(html).toMatch(/data-testid="workspace-next-training-step" data-status="active"/);
  expect(text(html)).toMatch(/Done Session finished .* Next Next training step Stay on Place With Distractions\. Milo will work on the same lesson next time\. Return to Training/);
  const sentBack = renderToStaticMarkup(React.createElement(HandoffPanel, { handoff: practiceReviewHandoff("needs_redo", {}), autoFocus: false }));
  expect(sentBack).toMatch(/role="status"/);
  expect(sentBack).not.toMatch(/role="alert"|border-red/);
});
