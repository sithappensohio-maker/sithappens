/* Stage 10.5B — no assumed checkpoint scores on any entry surface, and
 * Stage 10.5A — the queue shows a grading-context problem instead of failing silently. */
const fs = require("fs");
const path = require("path");
const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");
const studentsSrc = read("school", "SchoolStudentsPanel.jsx");
const queueSrc = read("CheckpointReviewQueue.jsx");

test("live checkpoint: criteria start unscored, nothing defaults to 3, nothing is filled in at submit", () => {
  expect(studentsSrc).not.toMatch(/\|\|\s*3\)/);
  expect(studentsSrc).not.toMatch(/scores\[c\.id\]\|\|3/);
  expect(studentsSrc).toMatch(/useState\(\{ handler_scores:\{\}, dog_scores:\{\}, feedback:"", outcome:"advance" \}\)/);
  expect((studentsSrc.match(/<option value="">Not scored<\/option>/g) || []).length).toBe(2);
  expect(studentsSrc).toMatch(/if\(liveUnscored\.length\)\{toast\.error\(`Score every criterion first — still unscored: /);
  // submit sends exactly the trainer's numbers
  expect(studentsSrc).toMatch(/\[c\.id,Number\(liveCheckpoint\.handler_scores\[c\.id\]\)\]/);
  expect(studentsSrc).toMatch(/\[c\.id,Number\(liveCheckpoint\.dog_scores\[c\.id\]\)\]/);
});

test("live checkpoint: Not scored is visually distinct and the record button stays disabled with an explanation", () => {
  expect(studentsSrc).toMatch(/data-scored=\{Number\.isFinite\(liveCheckpoint\.handler_scores\[c\.id\]\)\?"1":"0"\}/);
  expect(studentsSrc).toMatch(/text-shTextMuted italic/);
  expect(studentsSrc).toMatch(/disabled=\{saving\|\|liveUnscored\.length>0\} onClick=\{recordLiveCheckpoint\} data-testid="live-checkpoint-record"/);
  expect(studentsSrc).toMatch(/data-testid="live-checkpoint-unscored"[^>]*>[\s\S]{0,120}still unscored: \{liveUnscored\.join\(", "\)\}\. No score is ever assumed\./);
  // clearing a select back to "Not scored" removes the key — it never becomes 0
  expect(studentsSrc).toMatch(/if\(e\.target\.value===""\)delete hs\[c\.id\];else hs\[c\.id\]=Number\(e\.target\.value\)/);
});

test("queue grader: nothing pre-filled, every criterion required, a context problem blocks grading and is shown", () => {
  expect(queueSrc).toMatch(/setHandlerScores\(\{\}\);\s+setDogScores\(\{\}\);/);
  expect(queueSrc).toMatch(/const allScored = !!active && !active\.context_problem/);
  expect(queueSrc).toMatch(/data-testid="checkpoint-review-context-problem"/);
  expect(queueSrc).toMatch(/disabled=\{busy \|\| !allScored\} data-testid="checkpoint-review-advance"/);
  // a grading failure renders the server's message and never sets the handoff
  expect(queueSrc).toMatch(/setErr\(\(d && d\.message\) \|\| d \|\| "Failed to grade\."\);/);
  const grade = queueSrc.slice(queueSrc.indexOf("const grade = async"), queueSrc.indexOf("const addAnnotation"));
  expect(grade.indexOf("setResult(checkpointGradeHandoff")).toBeLessThan(grade.indexOf("} catch"));
  expect(grade.slice(grade.indexOf("} catch"))).not.toMatch(/setResult\(/);
});
