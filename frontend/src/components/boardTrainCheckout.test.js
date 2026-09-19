/* Checking out a Board & Train stay that has gaps in its training record.
 *
 * The point of this screen is that a missing session is a question, not a
 * wall. The desk is asked what happened to each one — the stay ended early,
 * we did not deliver it, or it happened and nobody wrote it up — and only
 * then can the checkout go through. Nothing is waived by accident, nothing is
 * waived silently, and no answer invents a training record for the dog. */
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "CheckoutModal.jsx"), "utf8");
const apiSrc = fs.readFileSync(path.join(__dirname, "..", "lib", "api.js"), "utf8");

test("the structured block is read from detail_object, not the flattened sentence", () => {
  // The axios interceptor replaces `detail` with a string and parks the real
  // object on detail_object. Reading `detail` here means the branch below can
  // never fire, which is exactly how this screen used to show a dead end.
  expect(apiSrc).toMatch(/err\.response\.data\.detail_object = d/);
  expect(src).toMatch(/const detail = e\.response\?\.data\?\.detail_object/);
  expect(src).toMatch(/detail\?\.code === "board_train_training_incomplete"/);
});

test("a blocked Board & Train checkout asks a question instead of showing an error", () => {
  expect(src).toContain('data-testid="checkout-board-train-block"');
  // the generic red sentence is cleared so the two never stack up
  expect(src).toMatch(/setBtBlock\(detail\);\s*\n\s*setErr\(""\);/);
  expect(src).toMatch(/Training sessions with no record/);
  expect(src).toMatch(/Say what happened to each one/);
});

test("every unanswered session blocks the button, and nothing is waived by default", () => {
  expect(src).toMatch(/const btUnanswered = btSessions\.filter\(\(s\) => !btAnswers\[`\$\{s\.date\}\|\$\{s\.slot\}`\]\)\.length/);
  const confirm = src.slice(src.indexOf('data-testid="confirm-checkout"') - 400,
                            src.indexOf('data-testid="confirm-checkout"'));
  expect(confirm).toMatch(/btUnanswered > 0/);
  // no answer is pre-selected anywhere
  expect(src).toMatch(/const \[btAnswers, setBtAnswers\] = useState\(\{\}\)/);
});

test("the three answers come from the server, never hard-coded in the screen", () => {
  // Adding a fourth reason must not need a frontend change, and the screen
  // must not be able to offer one the backend would reject.
  expect(src).toMatch(/const btChoices = btBlock\?\.resolutions \|\| \[\]/);
  expect(src).toMatch(/btChoices\.map\(\(c\) =>/);
  expect(src).not.toMatch(/"not_delivered"|"ended_early"|"recorded_late"/);
});

test("a long stay can be answered in one go without losing the per-session choice", () => {
  expect(src).toMatch(/const answerAll = \(outcome\) => setBtAnswers\(/);
  expect(src).toContain('data-testid="checkout-bt-all"');
  // one control per session, not three buttons — eighty-odd controls would
  // not fit across a phone and would bury the checkout button
  expect(src).toContain("data-testid={`checkout-bt-session-${s.date}-${s.slot}`}");
  expect(src).toMatch(/<option value="">What happened\?<\/option>/);
  // the list scrolls rather than pushing the checkout button off the screen
  expect(src).toMatch(/max-h-\[300px\] overflow-y-auto/);
});

test("the sessions are grouped by day and the day reads like a date", () => {
  expect(src).toMatch(/const btDays = btSessions\.reduce/);
  expect(src).toMatch(/const fmtBtDay = \(iso\) =>/);
  expect(src).toMatch(/weekday: "short", month: "short", day: "numeric"/);
});

test("the answers travel with the checkout body", () => {
  expect(src).toMatch(/body\.board_train_resolution = btSessions\.map/);
  expect(src).toMatch(/date: s\.date, slot: s\.slot, outcome: btAnswers/);
});

test("money is never adjusted behind the operator's back", () => {
  // Marking sessions undelivered must not silently discount the stay; it
  // says so and points at the discount field that is already on this screen.
  const panel = src.slice(src.indexOf('data-testid="checkout-board-train-block"'),
                          src.indexOf('data-testid="checkout-board-train-block"') + 4000);
  expect(panel).toMatch(/Nothing is adjusted automatically/);
  expect(panel).not.toMatch(/setCheckoutDiscount|body\.checkout_discount/);
});

test("a household checkout can name the dog that stopped it", () => {
  expect(src).toMatch(/btBlock\.dog_name/);
});

test("the generic checkout error is findable by tests now", () => {
  expect(src).toContain('data-testid="checkout-error"');
});
