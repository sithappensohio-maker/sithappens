// Today / Practice rendering of the server's practice summary, and the install
// prompt's immersive-workflow behaviour. Behavioural where the logic is pure;
// source-pinned (this repo's convention) for the React wiring.
import fs from "fs";
import path from "path";
import { practiceBuckets, practiceCardModel } from "./practice/PracticeCards";

const read = (...p) => fs.readFileSync(path.join(__dirname, ...p), "utf8");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const cardsSrc = read("today", "TodayCards.jsx");
const extrasSrc = read("StudentWorkspaceExtras.jsx");
const practiceCardsSrc = read("practice", "PracticeCards.jsx");
const practiceScreenSrc = read("PracticeScreen.jsx");
const installSrc = read("..", "..", "InstallPrompt.jsx");
const navSrc = read("SchoolNav.jsx");
const clientNavSrc = read("..", "..", "ClientMobileNav.jsx");
const shopSrc = read("..", "..", "PortalShop.jsx");

const SATISFIED = { id: "cur", status: "assigned", due_date: "2026-09-10", required_practice_satisfied: true, sessions_logged: 1, last_session_at: new Date().toISOString() };
const GENERAL = { id: "gen", status: "assigned", required_practice_satisfied: false, sessions_logged: 0 };
const OVERDUE_GENERAL = { id: "late", status: "assigned", due_date: "2020-01-01", required_practice_satisfied: false };

test("a satisfied row is 'done for today' and never overdue, due, recommended or upcoming", () => {
  const b = practiceBuckets([SATISFIED, GENERAL, OVERDUE_GENERAL], { recommendedId: "cur", today: "2026-09-03" });
  expect(b.done.map(x => x.id)).toEqual(["cur"]);
  expect(b.overdue.map(x => x.id)).toEqual(["late"]);
  expect(b.upcoming.map(x => x.id)).toEqual(["gen"]);
  expect(b.due).toEqual([]);
  expect(b.recommended).toEqual([]);
});

test("satisfied is read from the server flag only — a row with logs but no flag stays open", () => {
  const b = practiceBuckets([{ id: "x", status: "assigned", section_logs: [{ section_id: "practice" }], sessions_logged: 2 }], { today: "2026-09-03" });
  expect(b.done).toEqual([]);
  expect(b.upcoming.map(x => x.id)).toEqual(["x"]);
});

test("the card model phrases a logged row and leaves others untouched", () => {
  expect(practiceCardModel(SATISFIED, { today: "2026-09-03" }).logged).toEqual({ title: "Practice logged today", detail: "1 session logged · Practice again any time" });
  expect(practiceCardModel(GENERAL, { today: "2026-09-03" }).logged).toBeNull();
});

test("Today's practice card and the assigned list stop saying 'log a session' once the server says satisfied", () => {
  expect(cardsSrc).toMatch(/const open = items\.filter\(p => !isRequiredPracticeSatisfied\(p\)\)/);
  expect(cardsSrc).toMatch(/data-testid="today-practice-satisfied"/);
  expect(cardsSrc).toMatch(/data-testid="today-practice-again"/);
  expect(cardsSrc).toMatch(/const next = open\[0\]/);
  // every surface names the row after its School lesson via the one helper
  expect(cardsSrc).toMatch(/\{practiceTitle\(next\)\}/);
  expect(practiceCardsSrc).toMatch(/renderPracticeCoachText\(practiceTitle\(hw\), tokens\)/);
  expect((extrasSrc.match(/\{practiceTitle\(hw\)\}/g) || []).length).toBe(2);
  for (const src of [cardsSrc, extrasSrc, practiceCardsSrc]) expect(src).not.toMatch(/hw\??\.title\s*\|\|\s*"Practice"/);
  expect(extrasSrc).toMatch(/const openPractice=assignedPractice\.filter\(hw=>!isRequiredPracticeSatisfied\(hw\)\)/);
  expect(extrasSrc).toMatch(/school-assigned-practice-logged-/);
  expect(extrasSrc).toMatch(/Today's practice is logged\. Practice again any time\./);
  // The stale copy survives ONLY on rows that genuinely have no session.
  expect(extrasSrc).toMatch(/openPractice\.map\(hw=>[\s\S]*Open your Practice Coach and log a session/);
  // Nothing on the client re-derives "satisfied" from raw logs.
  for (const src of [cardsSrc, extrasSrc, practiceCardsSrc, practiceScreenSrc]) {
    expect(code(src)).not.toMatch(/section_logs/);
  }
});

test("the Practice screen's Done for today group is secondary to unfinished work", () => {
  const upcomingAt = practiceScreenSrc.indexOf('testid="practice-group-upcoming"');
  const doneAt = practiceScreenSrc.indexOf('testid="practice-group-done"');
  const completedAt = practiceScreenSrc.indexOf('data-testid="practice-group-completed"');
  expect(upcomingAt).toBeGreaterThan(-1);
  expect(doneAt).toBeGreaterThan(upcomingAt);
  expect(completedAt).toBeGreaterThan(doneAt);
  expect(practiceCardsSrc).toMatch(/state === "done" \? "Practice again" : "Start practice"/);
});

test("the install prompt is suppressed (not dismissed) by immersive workflows and never outranks a dialog", () => {
  expect(installSrc).toMatch(/useImmersiveActive\(\)/);
  expect(installSrc).toMatch(/if \(immersive\) return null;/);
  // ...and while the customer's primary action is on screen (lib/primaryActionGuard)
  expect(installSrc).toMatch(/usePrimaryActionVisible\(eligible && !immersive\)/);
  expect(installSrc).toMatch(/if \(primaryOnScreen\) return null;/);
  // z-index below every dialog (50+), above the tab bars (30)
  expect(installSrc).toMatch(/z-40/);
  expect(installSrc).not.toMatch(/z-\[9998\]/);
  // dismissal is written only by the customer's own tap
  const dismissWrites = (installSrc.match(/localStorage\.setItem\(DISMISS_KEY/g) || []).length;
  expect(dismissWrites).toBe(1);
  expect(installSrc).toMatch(/const dismiss = \(\) => \{\s*localStorage\.setItem\(DISMISS_KEY/);
});

test("the install prompt sits above any mounted bottom dock, measured", () => {
  expect(installSrc).toMatch(/\[data-bottom-dock\]/);
  expect(installSrc).toMatch(/window\.innerHeight - r\.top/);
  expect(installSrc).toMatch(/bottom: `calc\(\$\{dock \+ 16\}px \+ env\(safe-area-inset-bottom\)\)`/);
  // index.css gives `.bg-bgPanel.rounded-xl` position:relative, which outranks
  // the `fixed` utility — the pill pins its position inline so it keeps floating.
  expect(installSrc).toMatch(/position: "fixed", bottom:/);
  expect(navSrc).toMatch(/data-testid="school-nav-mobile"\s+data-bottom-dock=""/);
  expect(clientNavSrc).toMatch(/data-testid="client-mobile-nav"\s+data-bottom-dock=""/);
  expect(shopSrc).toMatch(/data-testid="shop-checkout-tray-mobile" data-bottom-dock=""/);
});

test("every immersive workflow holds the signal while it is open", () => {
  const expectHook = (rel, pattern) => expect(read(...rel)).toMatch(pattern);
  expectHook(["..", "..", "training", "PracticePanel.jsx"], /useImmersiveWorkflow\(true\)/);
  expectHook(["ModuleQuizPanel.jsx"], /useImmersiveWorkflow\(true\)/);
  expectHook(["AskTrainerPanel.jsx"], /useImmersiveWorkflow\(!!open\)/);
  expectHook(["..", "..", "training", "TroubleshootingDrawer.jsx"], /useImmersiveWorkflow\(!!open\)/);
  expectHook(["lesson", "LessonGuide.jsx"], /useImmersiveWorkflow\(true\)/);
  expectHook(["SchoolOrientation.jsx"], /useImmersiveWorkflow\(open\)/);
  expectHook(["CheckpointPanel.jsx"], /useImmersiveWorkflow\(true\)/);
});
