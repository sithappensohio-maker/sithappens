/* Release closure — selling a program to a dog that is already enrolled.
 *
 * The server refuses that sale with a structured 409 and charges nothing. These
 * guards pin the operator-facing half of that contract: the refusal is shown as
 * itself, the extra block is a deliberate second action, and a sale can never
 * land as a bare "Sold" when the dog was not actually enrolled. */
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "Clients.jsx"), "utf8");
const modal = src.slice(src.indexOf("function SellProgramModal("));

test("the structured refusal is read from the server, not guessed from the status code", () => {
  // api.js flattens object details onto `detail_object` — read that, or the branch never fires
  expect(modal).toMatch(/detail_object/);
  expect(modal).toMatch(/d\.code === "dog_already_enrolled"/);
  expect(modal).toMatch(/setAlreadyEnrolled\(d\)/);
});

test("the refusal is shown as itself: already enrolled, nothing charged, in the server's words", () => {
  expect(modal).toMatch(/data-testid="sell-program-already-enrolled"/);
  expect(modal).toMatch(/Already enrolled · nothing charged/);
  // the sentence comes from the server so the screen and the API can never disagree
  expect(modal).toMatch(/\{alreadyEnrolled\.msg\}/);
});

test("selling another block is a separate, deliberate action that asks the server to allow it", () => {
  expect(modal).toMatch(/data-testid="sell-program-confirm-additional"/);
  expect(modal).toMatch(/onClick=\{\(\) => sell\(true\)\}/);
  expect(modal).toMatch(/if \(allowAdditional\) body\.allow_additional_sessions = true;/);
  // and the ordinary confirm never sends the flag
  expect(modal).toMatch(/onClick=\{\(\) => sell\(false\)\}/);
  // the two buttons are alternatives — the plain confirm is not offered once refused
  expect(modal).toMatch(/alreadyEnrolled \? \(/);
});

test("a sale that did not set the dog up to train can never look like a plain success", () => {
  // the server returns enrollment_warning when the credits landed but the training did not
  expect(modal).toMatch(/r\.data\.enrollment_warning/);
  expect(modal).toMatch(/toast\.warning\(r\.data\.enrollment_warning/);
  // the success toast still fires, but the warning is not optional beside it
  const sellFn = modal.slice(modal.indexOf("const sell = async"), modal.indexOf("// Preview the dates"));
  expect(sellFn).toMatch(/toast\.success/);
  expect(sellFn.indexOf("toast.warning")).toBeGreaterThan(sellFn.indexOf("toast.success"));
});

test("a fresh attempt clears the previous refusal so a stale panel never blocks a good sale", () => {
  expect(modal).toMatch(/setAlreadyEnrolled\(null\);/);
});
