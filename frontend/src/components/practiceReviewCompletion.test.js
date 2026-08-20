// Training Practice — review, completion and the duplicate-card fix.
//
// Source-level regression guards, matching this repo's convention for screens
// with heavy wiring (see checkpointEntryPoints.test.js). Live behaviour was
// exercised in the browser.
//
// The bug being pinned: an ordinary section practice log showed "New"
// forever, was absent from both review queues, and the assignment could never
// be finished — so the same work appeared to keep coming back.
import fs from "fs";
import path from "path";

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");
/* Assertions about what the UI must NOT contain run against code with
   comments and user-facing strings removed. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const logicOnly = (src) => code(src).replace(/"[^"]*"/g, '""').replace(/`[^`]*`/g, "``");

const screenSrc = read("..", "screens", "Homework.jsx");
const panelSrc = read("HomeworkReportPanel.jsx");

// ---------------------------------------------------------------------------
// The Review count covers ALL unreviewed practice
// ---------------------------------------------------------------------------

test("the header count reads the unreviewed endpoint, not the daily-tracker queue", () => {
  // /admin/homework/pending-reviews is filtered to daily_tracker rows, so
  // section-based practice never appeared and the button stayed hidden
  // exactly when there was work to do.
  expect(screenSrc).toMatch(/api\.get\("\/admin\/homework\/unreviewed-count"\)/);
  expect(screenSrc).toMatch(/setPendingCount\(Number\(r\.data\?\.unreviewed\) \|\| 0\)/);
  expect(logicOnly(screenSrc)).not.toMatch(/api\.get\(""\)[\s\S]{0,40}pending-reviews/);
});

test("NEW/UNREVIEWED and NEEDS ATTENTION are tracked as separate numbers", () => {
  expect(screenSrc).toMatch(/setAttentionCount\(Number\(r\.data\?\.needs_attention\) \|\| 0\)/);
  expect(screenSrc).toMatch(/Unreviewed · \{pendingCount\}/);
  expect(screenSrc).toMatch(/data-testid="review-attention-badge"/);
  // the attention badge only appears when something actually needs attention
  expect(screenSrc).toMatch(/\{attentionCount > 0 && \(/);
});

test("an unreviewed log is counted regardless of any attention trigger", () => {
  // No mention of video / difficulty / could-not-complete in the client-side
  // unreviewed test — a plain log counts.
  const helper = screenSrc.slice(screenSrc.indexOf("const unreviewedLogs ="), screenSrc.indexOf("const completeAssignment"));
  expect(helper).toMatch(/!lo\.reviewed_at/);
  expect(logicOnly(helper)).not.toMatch(/__video_id|__difficulty|__could_not_complete|questions/);
});

test("rest days and trainer-entered rows are not treated as client submissions", () => {
  expect(screenSrc).toMatch(/!lo\.is_rest_day && lo\.logged_by_role !== "admin"/);
});

test("the card badges outstanding logs as NEW", () => {
  expect(screenSrc).toMatch(/data-testid=\{`hw-new-logs-\$\{h\.id\}`\}/);
  expect(screenSrc).toMatch(/new log\{unreviewedLogs\(h\)===1\?"":"s"\}/);
  // never on a finished assignment
  expect(screenSrc).toMatch(/\{h\.status !== "completed" && unreviewedLogs\(h\) > 0 && \(/);
});

// ---------------------------------------------------------------------------
// Inline review
// ---------------------------------------------------------------------------

test("the expanded report offers the three canonical review actions", () => {
  for (const t of ["looks-good", "keep-practicing", "attention"]) {
    expect(panelSrc).toMatch(new RegExp(`hw-report-review-${t}-`));
  }
  expect(panelSrc).toMatch(/Looks Good/);
  expect(panelSrc).toMatch(/Keep Practicing/);
  expect(panelSrc).toMatch(/Trainer Attention/);
});

test("inline review posts to the existing canonical review path", () => {
  // No second review model and no parallel state.
  expect(panelSrc).toMatch(/api\.post\(`\/admin\/school\/practice-reviews\/\$\{homeworkId\}\/\$\{logId\}`/);
  expect(logicOnly(panelSrc)).not.toMatch(/acknowledged|reviewedLocally|setReviewedIds/);
});

test("review controls only appear on a log that is still unreviewed", () => {
  expect(panelSrc).toMatch(/\{!e\.reviewed && \(/);
  expect(panelSrc).toMatch(/data-testid=\{`hw-report-review-actions-\$\{e\.id\}`\}/);
});

test("after reviewing, state is refetched from the server rather than assumed", () => {
  // A refresh must show exactly what the database says.
  expect(panelSrc).toMatch(/await refetch\(\)/);
  expect(panelSrc).toMatch(/api\.get\(`\/homework\/\$\{homeworkId\}`\)/);
  expect(panelSrc).toMatch(/onReviewed\?\.\(\)/);
  // and the screen refreshes its counts
  expect(screenSrc).toMatch(/onReviewed=\{load\}/);
});

test("a double-click cannot fire two reviews", () => {
  expect(panelSrc).toMatch(/if \(reviewingId\) return;/);
  expect(panelSrc).toMatch(/disabled=\{!!reviewingId\}/);
});

test("reviewing a log offers no way to complete the assignment", () => {
  // Reviewing and completing are separate decisions.
  const reviewFn = panelSrc.slice(panelSrc.indexOf("const reviewLog ="), panelSrc.indexOf("const reviewLog =") + 700);
  expect(logicOnly(reviewFn)).not.toMatch(/complete/i);
});

// ---------------------------------------------------------------------------
// Complete Assignment
// ---------------------------------------------------------------------------

test("every active assignment offers an explicit Complete action", () => {
  expect(screenSrc).toMatch(/data-testid=\{`hw-complete-\$\{h\.id\}`\}/);
  expect(screenSrc).toMatch(/Complete assignment/);
  expect(screenSrc).toMatch(/\{h\.status !== "completed" && \(/);
});

test("completion goes through the trainer endpoint that reuses canonical state", () => {
  expect(screenSrc).toMatch(/api\.post\(`\/admin\/homework\/\$\{h\.id\}\/complete`/);
  // never a second completion flag written from the client
  expect(logicOnly(screenSrc)).not.toMatch(/status:\s*""\s*,\s*completed_at|setStatus\(/);
});

test("completion is confirmed, and names the assignment and the dog", () => {
  expect(screenSrc).toMatch(/title: `Complete \$\{h\.title\} for \$\{h\.dog_name\}\?`/);
  expect(screenSrc).toMatch(/confirmText: "Complete assignment"/);
  // uses the app's own confirm dialog, not window.confirm
  expect(code(screenSrc)).not.toMatch(/window\.confirm/);
});

test("unreviewed logs warn but never block completion", () => {
  expect(screenSrc).toMatch(/unreviewed practice log\$\{outstanding === 1 \? "" : "s"\}/);
  expect(screenSrc).toMatch(/They will stay unreviewed\. Complete anyway\?/);
  // no early return that refuses when logs are outstanding
  const fn = screenSrc.slice(screenSrc.indexOf("const completeAssignment"), screenSrc.indexOf("const openNew"));
  expect(fn).not.toMatch(/if \(outstanding[^)]*\) return;/);
});

test("completing never marks the outstanding logs reviewed", () => {
  const fn = screenSrc.slice(screenSrc.indexOf("const completeAssignment"), screenSrc.indexOf("const openNew"));
  expect(logicOnly(fn)).not.toMatch(/practice-reviews|reviewed_at|reviewLog/);
});

test("a double-click cannot fire two completions", () => {
  expect(screenSrc).toMatch(/if \(completingId\) return;/);
  expect(screenSrc).toMatch(/disabled=\{completingId === h\.id\}/);
});

test("completing refetches the list so the card moves out of ASSIGNED", () => {
  const fn = screenSrc.slice(screenSrc.indexOf("const completeAssignment"), screenSrc.indexOf("const openNew"));
  expect(fn).toMatch(/await load\(\)/);
  // the filter counts are derived from the refreshed list, never held locally
  expect(screenSrc).toMatch(/completed: list\.filter\(h=>h\.status==="completed"\)\.length/);
  expect(screenSrc).toMatch(/assigned: list\.filter\(h=>h\.status==="assigned"\)\.length/);
});
