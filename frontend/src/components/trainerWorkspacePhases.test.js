/* Stage 7 — Trainer workspace BEFORE → TRAIN → WRAP UP.
 *
 * Pure-helper tests for readiness / client preview / resume phase, plus
 * source guards pinning how the workspace organises the EXISTING draft
 * pipeline: the phase nav, Start → Train, Save & Close vs Finish Session, the
 * canonical completion endpoint, the privacy labels, the moved progression
 * controls, and the removal of the floating control that overlapped Save &
 * Close on phones. Live interaction is verified in the browser.
 */
import fs from "fs";
import path from "path";
import { completionReadiness, clientHandoffPreview, resumePhase, sessionResultRows, skillRecordState, PHASES } from "../lib/sessionWrapUp";

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");
const baseSrc = read("TrainingSessionWorkspaceBase.jsx");
const wrapperSrc = read("TrainingSessionWorkspace.jsx");

const skill = (id, over = {}) => ({ id, source: "skill", skill_id: `s-${id}`, name: `Skill ${id}`, required_curriculum: true, ...over });
const draft = (over = {}) => ({
  id: "d1", status: "draft",
  plan: { activities: [skill("a"), skill("b"), { id: "c", source: "custom", name: "Extra" }] },
  actuals: {}, session_note: "", client_recap_note: "", what_went_well: "", needs_work: "", next_lesson_focus: "", practice_note: "",
  ...over,
});
const overview = { current_lesson_practice: { configured: true, available: true, title: "Place With Duration", description: "5 minutes, twice today." } };

test("the phases are Before → Train → Wrap Up", () => {
  expect(PHASES.map((p) => p.label)).toEqual(["Before", "Train", "Wrap Up"]);
});

test("readiness mirrors the backend rules: required skills need an outcome and a level, and the four Wrap Up fields are required", () => {
  const r = completionReadiness(draft());
  expect(r.ready).toBe(false);
  expect(r.missing.map((m) => m.label)).toEqual([
    "Skill a — add the outcome", "Skill a — add the skill level",
    "Skill b — add the outcome", "Skill b — add the skill level",
    "Say what went well", "Say what needs work", "Write the client recap (or turn off sending it)", "Enter the next lesson focus",
    "Choose what should happen next",
  ]);
  // every missing item points somewhere real
  expect(r.missing.every((m) => ["train", "wrap"].includes(m.phase) && m.target)).toBe(true);
  expect(r.done.map((d) => d.ok)).toEqual([false, false, false, false]);
});

test("readiness is complete once everything the backend requires is there; the custom activity never gates", () => {
  const d = draft({
    actuals: { a: { score: 3, outcome: "improving", client_observation: "Nice." }, b: { score: 4, outcome: "passed" } },
    what_went_well: "Held Place.", needs_work: "Door.", client_recap_note: "Great job.", next_lesson_focus: "Door distractions.",
  });
  const r = completionReadiness(d, { action: "remain", practice: { configured: true, assigned: true } });
  expect(r.ready).toBe(true);
  expect(r.missing).toEqual([]);
  expect(r.done.every((x) => x.ok)).toBe(true);
  expect(r.done.map((x) => x.label)).toEqual(["Skill results recorded", "Client recap ready", "Next focus entered", "Practice ready", "Next step chosen: Stay Here"]);
  // a missing client observation is recommended, never required
  expect(r.recommended.map((x) => x.label)).toEqual(["Add a client-safe observation for Skill b"]);
});

test("turning the recap off drops that requirement; skipping a lesson needs a reason; manual-only skills need no level", () => {
  const d = draft({ actuals: { a: { outcome: "improving", score: 2 }, b: { outcome: "passed", score: 5 } }, what_went_well: "w", needs_work: "n", next_lesson_focus: "f" });
  expect(completionReadiness(d, { sendRecap: false, action: "remain" }).ready).toBe(true);
  expect(completionReadiness(d, { sendRecap: true, action: "remain" }).missing.map((m) => m.key)).toEqual(["client_recap_note"]);
  expect(completionReadiness(d, { sendRecap: false, action: "skip_lesson", reason: "" }).missing.map((m) => m.key)).toEqual(["reason"]);
  const manual = draft({ plan: { activities: [skill("m", { manual_only: true })] }, actuals: { m: { outcome: "introduced" } }, what_went_well: "w", needs_work: "n", next_lesson_focus: "f", client_recap_note: "c" });
  expect(completionReadiness(manual, { action: "remain" }).ready).toBe(true);
  // a skipped required skill needs a reason
  const skipped = draft({ plan: { activities: [skill("a", { skipped: true, skip_reason: "" })] } });
  expect(skillRecordState(skipped.plan.activities[0], {}).missing).toEqual(["reason for skipping"]);
});

test("the client preview uses the same client-safe fields and never the private notes", () => {
  const d = draft({
    actuals: { a: { score: 3, outcome: "improving", client_observation: "Held it with the door open.", notes: "PRIVATE-SKILL-NOTE" } },
    session_note: "PRIVATE-SESSION-NOTE", what_went_well: "Stayed on Place for 30 seconds.", needs_work: "Door distractions.",
    client_recap_note: "Really nice work today.", next_lesson_focus: "Increase doorway distraction.", practice_note: "Twice today.",
  });
  const p = clientHandoffPreview(d, overview);
  expect(p).toEqual({
    wentWell: "Stayed on Place for 30 seconds.", needsWork: "Door distractions.", recap: "Really nice work today.",
    nextFocus: "Increase doorway distraction.", practice: { title: "Place With Duration", note: "Twice today." },
    observations: [{ name: "Skill a", text: "Held it with the door open." }],
  });
  expect(JSON.stringify(p)).not.toMatch(/PRIVATE/);
  // withholding Practice or the recap is reflected truthfully
  expect(clientHandoffPreview(d, overview, { assignPractice: false }).practice).toBeNull();
  expect(clientHandoffPreview(d, overview, { sendRecap: false }).recap).toBeNull();
  expect(clientHandoffPreview(d, { current_lesson_practice: { configured: false } }).practice).toBeNull();
});

test("a resumed draft lands on Train, on Wrap Up once Wrap Up fields were started, and on Wrap Up when completed", () => {
  expect(resumePhase(draft())).toBe("train");
  expect(resumePhase(draft({ actuals: { a: { score: 3, outcome: "improving" } } }))).toBe("train");
  expect(resumePhase(draft({ what_went_well: "Half done." }))).toBe("wrap");
  expect(resumePhase(draft({ status: "completed" }))).toBe("wrap");
});

test("the session result rows translate outcomes and mastery into plain words", () => {
  const rows = sessionResultRows(draft({ actuals: { a: { score: 3, outcome: "needs_more_work", mastery_decision: "not_yet" }, b: { outcome: "skipped" } } }));
  expect(rows.map((r) => [r.name, r.score, r.outcome, r.mastery, r.skipped, r.complete])).toEqual([
    ["Skill a", 3, "Needs work", "Not yet", false, true],
    ["Skill b", null, "Not worked", null, true, false],
    ["Extra", null, null, null, false, true],
  ]);
  expect(JSON.stringify(rows)).not.toMatch(/needs_more_work|not_yet/);
});

// ---------------------------------------------------------------------------
// Workspace wiring
// ---------------------------------------------------------------------------

test("phase navigation is semantic, always visible, and never a blocking wizard", () => {
  expect(baseSrc).toMatch(/<nav className="[^"]*" aria-label="Session phase" data-testid="phase-nav">/);
  expect(baseSrc).toMatch(/aria-current=\{current \? "step" : undefined\}/);
  expect(baseSrc).toMatch(/onClick=\{\(\) => setPhase\(p\.key\)\}/); // every phase reachable
  expect(baseSrc).toMatch(/data-testid="training-session-workspace" data-phase=\{phase\}/);
  // returning to Before renders the briefing over the same draft — no refetch, no reset
  expect(baseSrc).toMatch(/\{!savedHandoff && phase === "before" && \(/);
  expect((baseSrc.match(/api\.(get|post)\(/g) || []).length).toBe(3);
});

test("Train is lesson → skills → trainer notes, with required work marked before anyone presses Finish", () => {
  const order = ["train-lesson", "train-skills", "train-session-notes"].map((id) => baseSrc.indexOf(`data-testid="${id}"`));
  expect(order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2]).toBe(true);
  expect(baseSrc).toMatch(/Required before finishing/);
  expect(baseSrc).toMatch(/data-testid=\{`activity-\$\{a\.id\}-required`\}/);
  expect(baseSrc).toMatch(/data-testid=\{`activity-\$\{a\.id\}-recorded`\}/);
  // Stage 9 — the lesson guide is the trainer projection of the canonical lesson (components/training/TrainerLessonGuide.jsx)
  expect(baseSrc).toMatch(/<TrainerLessonGuide guide=\{overview\?\.current_lesson_guide \|\| guideFromActivities\(activities, briefing, overview\)\} checkpointState=\{checkpoint\}\/>/);
  const guideSrc = read("training", "TrainerLessonGuide.jsx");
  expect(guideSrc).toMatch(/label="How to teach it" value=\{guide\.how_to_teach\}/);
  expect(guideSrc).toMatch(/title="View full lesson guide"/);
});

test("skill rows keep every existing control: level, outcome, mastery, client observation, trainer note, metrics", () => {
  for (const id of ["score-picker", "assessment", "mastery-mastered", "mastery-not-yet", "client-observation", "private-note", "metrics", "metric-duration"]) {
    expect(baseSrc).toContain("testid={`activity-${a.id}-" + id + "`");
  }
});

test("privacy is textual on every note field, not colour alone", () => {
  expect(baseSrc).toMatch(/Trainer notes<\/label>/);
  expect(baseSrc).toMatch(/Staff only — clients will not see this\./);
  expect(baseSrc).toMatch(/Client recap note · the owner reads this on their Today screen and in Coach\./);
  expect(baseSrc).toMatch(/Client can see this\./);
  expect(baseSrc).toMatch(/<VisibilityBadge staffOnly\/>/);
  expect(baseSrc).toMatch(/This note is never visible to the client\./);
});

test("Wrap Up is client handoff → Practice → next focus → result → next step → preview → readiness, then one Finish", () => {
  const ids = ["wrap-client-handoff", "wrap-practice", "wrap-next-focus", "wrap-session-result", "wrap-next-step", "wrap-client-preview", "wrap-readiness"];
  const idx = ids.map((id) => baseSrc.indexOf(`data-testid="${id}"`));
  expect(idx.every((i) => i > 0)).toBe(true);
  expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  expect(baseSrc).toMatch(/What should the next trainer focus on\?/);
  expect(baseSrc).toMatch(/data-testid="workspace-complete-session"/);
  expect(baseSrc).toMatch(/"Finish Session"/);
  expect(baseSrc).not.toMatch(/Complete Session</);
});

test("Finish Session uses the canonical completion endpoint and body; readiness stops an incomplete finish client-side first", () => {
  expect(baseSrc).toMatch(/api\.post\(`\/training-session-drafts\/\$\{draft\.id\}\/complete`, \{\s*advancement_action: action,\s*advancement_reason: reason\.trim\(\) \|\| null,\s*assign_lesson_practice: canAssignLessonPractice \? assignLessonPractice : false,\s*send_recap: sendRecap,\s*\}\)/);
  expect(baseSrc).toMatch(/if \(!readiness\.ready\) \{ setShowGaps\(true\); goTo\(readiness\.missing\[0\]\); return; \}/);
  // pending autosave is written BEFORE the completion POST, so Finish never races the debounce
  expect(baseSrc).toMatch(/if \(!\(await flushSave\(\)\)\) return;\s*const \{ data \} = await api\.post\(`\/training-session-drafts\/\$\{draft\.id\}\/complete`/);
  expect(baseSrc).toMatch(/e\?\.response\?\.data\?\.detail_object \|\| e\?\.response\?\.data\?\.detail/);
  // backend rules remain authoritative — every 409 is shown, the draft stays open
  for (const code of ["checkpoint_required_before_advancement", "lesson_assessment_incomplete", "session_completion_incomplete"]) {
    expect(baseSrc).toContain(code);
  }
  expect(baseSrc).toMatch(/Everything you recorded is saved/);
  // Stage 10: the finished state is the shared handoff built from the completion response
  expect(baseSrc).toMatch(/finishHandoff\(completionResult/);
  expect(read("..", "lib", "sessionWrapUp.js")).toMatch(/title: "Session finished"/);
});

test("Save & Close keeps the session open and is worded unlike Finish", () => {
  expect(baseSrc).toMatch(/data-testid="workspace-done"/);
  expect(baseSrc).toMatch(/Keep this session open for later/);
  expect(baseSrc).toMatch(/Finalize and send the client handoff/);
});

test("autosave is preserved with a subtle state and a visible, retryable failure", () => {
  expect(baseSrc).toMatch(/api\.put\(`\/training-session-drafts\/\$\{d\.id\}`/);
  expect(baseSrc).toMatch(/setSavingLabel\("Saved"\)/);
  expect(baseSrc).toMatch(/data-testid="workspace-save-error"/);
  expect(baseSrc).toMatch(/Not saved · Retry/);
  expect(baseSrc).toMatch(/const retrySave = useCallback/);
});

test("progression moved into Wrap Up with every option kept, and the floating control is gone", () => {
  // Stage 8 — the nine actions live in the sessionWrapUp audit table; the
  // workspace renders the trainer decision + the advanced list from it.
  expect(baseSrc).toMatch(/progressionChoices\(\{ isFinalLesson, isAdmin, checkpoint/);
  expect(baseSrc).toMatch(/advancedActions\(\{ isAdmin, isFinalLesson \}\)/);
  expect(baseSrc).toMatch(/data-testid="advanced-progression"/);
  expect(baseSrc).toMatch(/data-testid="admin-advancement-overrides"/);
  expect(baseSrc).toMatch(/data-testid="in-person-manual-progress-open"/); // now inside Wrap Up
  expect(wrapperSrc).not.toMatch(/fixed z-\[70\]/);
  expect(wrapperSrc).not.toMatch(/in-person-manual-progress-open/);
  expect(wrapperSrc).toMatch(/data-testid="in-person-manual-progress-modal"/); // the modal itself stays
});
