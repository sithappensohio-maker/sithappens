// Training UI Phase 3 — source-level regression guards for the Client
// Today / Homework Practice redesign, matching this repo's established
// convention (see trainingEntryPoints.test.js): no React Testing Library
// rendering, so behaviors that depend on component wiring rather than pure
// function logic are verified by asserting the source contains the exact
// pattern that implements them. Interaction/visual behaviors (mobile nav
// not obscuring the primary action, missing-video fallback rendering) are
// verified live in the browser as part of the release report.
import fs from "fs";
import path from "path";

const portalSrc = fs.readFileSync(path.join(__dirname, "Portal.jsx"), "utf8");
const practicePanelSrc = fs.readFileSync(path.join(__dirname, "..", "components", "training", "PracticePanel.jsx"), "utf8");
const todayPanelSrc = fs.readFileSync(path.join(__dirname, "..", "components", "training", "ClientTodayPanel.jsx"), "utf8");
const difficultySelectorSrc = fs.readFileSync(path.join(__dirname, "..", "components", "training", "DifficultySelector.jsx"), "utf8");
const videoDemoCardSrc = fs.readFileSync(path.join(__dirname, "..", "components", "training", "VideoDemoCard.jsx"), "utf8");
const measurementChipsSrc = fs.readFileSync(path.join(__dirname, "..", "components", "training", "MeasurementChips.jsx"), "utf8");
const trainerFeedbackSrc = fs.readFileSync(path.join(__dirname, "..", "components", "training", "TrainerFeedbackNotice.jsx"), "utf8");

// 1. Existing assignment data renders as practice cards — Portal.jsx wires
// the live `homework`/`dogs`/`bookings` state (no new fetch) into the panel.
test("Portal.jsx renders ClientTodayPanel from its own already-loaded homework/dogs/bookings state", () => {
  expect(portalSrc).toMatch(/import ClientTodayPanel from ["']\.\.\/components\/training\/ClientTodayPanel["']/);
  expect(portalSrc).toMatch(/<ClientTodayPanel dogs=\{dogs\} homework=\{homework\} bookings=\{bookings\}/);
});

// 2. One assignment appears only once — the old, separate homework-list
// rendering (Sprint 110n) that duplicated this same `homework` array is
// gone; ClientTodayPanel is the only place `homework` is mapped into cards.
test("Portal.jsx no longer contains the old duplicate homework-card rendering block", () => {
  expect(portalSrc).not.toMatch(/Training Homework\./);
  expect(portalSrc).not.toMatch(/portal-complete-\$\{h\.id\}/);
  const todayMatches = portalSrc.match(/<ClientTodayPanel/g) || [];
  expect(todayMatches.length).toBe(1);
});

// 3. Multiple dogs are visually distinguishable — ClientTodayPanel groups by
// dog and only suppresses the per-card dog label when there's just one group
// (where a per-dog header already disambiguates).
test("ClientTodayPanel groups assignments by dog and shows a per-dog header when more than one dog is active", () => {
  expect(todayPanelSrc).toMatch(/groupByDog\(/);
  expect(todayPanelSrc).toMatch(/groups\.length > 1/);
  expect(todayPanelSrc).toMatch(/DogIdentityHeader/);
});

// 4. Missing video uses the fallback — VideoDemoCard (built in UI-1, reused
// here unmodified) already renders EmptyState when no url is provided.
test("PracticePanel reuses VideoDemoCard, which has a clean no-video fallback", () => {
  expect(practicePanelSrc).toMatch(/import VideoDemoCard from ["']\.\/VideoDemoCard["']/);
  expect(practicePanelSrc).toMatch(/<VideoDemoCard videoUrl=\{homework\.video_url\}/);
  expect(videoDemoCardSrc).toMatch(/if \(!videoUrl\)/);
  expect(videoDemoCardSrc).toMatch(/EmptyState/);
});

// 5. Missing optional fields do not create empty UI — every optional block
// in PracticePanel is conditionally rendered, and the shared chip components
// already early-return null when there's nothing to show.
test("PracticePanel only renders equipment/targets/trainer-note/resources sections when data exists", () => {
  expect(practicePanelSrc).toMatch(/\{homework\.trainer_personalized_note && \(/);
  expect(practicePanelSrc).toMatch(/\{\(section\.resources \|\| \[\]\)\.length > 0 && \(/);
  expect(practicePanelSrc).toMatch(/\{targetChips\.length > 0 && <MeasurementChips/);
  expect(measurementChipsSrc).toMatch(/if \(visible\.length === 0\) return null;/);
});

// 6. Difficulty selection maps to the existing stored values — the
// selector's choice values must exactly match DaySubmitIn.difficulty's
// backend enum, not an invented client-side scale.
test("DifficultySelector's values match the backend's existing difficulty enum exactly", () => {
  const backendEnum = ["easy", "good", "okay", "hard", "very_hard"];
  for (const v of backendEnum) {
    expect(difficultySelectorSrc).toMatch(new RegExp(`value: "${v}"`));
  }
});

// 7. "Could not complete" preserves its reason — same null-coalescing shape
// DailyCheckInCard already uses successfully.
test("PracticePanel submits could_not_complete_reason using the proven null-when-unchecked pattern", () => {
  expect(practicePanelSrc).toMatch(/could_not_complete_reason: couldNotComplete \? \(couldNotCompleteReason \|\| null\) : null/);
});

// 8. Practice submit cannot duplicate from double-clicking.
test("PracticePanel guards submit against double-tap and disables the button while saving", () => {
  expect(practicePanelSrc).toMatch(/if \(saveState === "saving"\) return;/);
});

// 9. A failed save remains retryable — the submit button is only disabled
// while actively saving, never permanently disabled after an error.
test("PracticeCompletionPanel's submit button is only disabled during 'saving', not 'error'", () => {
  const panelSrc = fs.readFileSync(path.join(__dirname, "..", "components", "training", "PracticeCompletionPanel.jsx"), "utf8");
  expect(panelSrc).toMatch(/disabled=\{saveState === "saving"\}/);
  expect(panelSrc).toMatch(/saveState === "error" \? "Retry"/);
});

// 10. Successful save updates the card state — PracticePanel calls the
// caller's onChanged (wired to Portal.jsx's loadAll, which re-fetches
// /homework) after a successful submit.
test("PracticePanel calls onChanged after a successful submit, and Portal.jsx wires it to loadAll", () => {
  expect(practicePanelSrc).toMatch(/setSaveState\("saved"\);\s*\n\s*onChanged\?\.\(\);/);
  expect(portalSrc).toMatch(/<PracticePanel homework=\{practiceFor\} onClose=\{\(\) => setPracticeFor\(null\)\} onChanged=\{loadAll\}\/>/);
});

// 11. Existing media upload remains functional — the video upload still
// posts to the exact same endpoint DailyCheckInCard already used.
test("PracticePanel's video upload uses the existing day-video endpoint, unchanged", () => {
  expect(practicePanelSrc).toMatch(/api\.post\(`\/homework\/\$\{homework\.id\}\/day\/\$\{activeDay\.day_number\}\/video`/);
});

// 12 / 13. Trainer feedback is shown without exposing internal notes, and
// client-safe field restrictions remain intact — the client-facing
// components never reference a trainer-only/internal field name.
test("Client-facing practice components never reference trainer-only/internal fields", () => {
  const internalFieldPattern = /internal_trainer_notes|trainer_only_guidance|internal_notes\b/;
  expect(practicePanelSrc).not.toMatch(internalFieldPattern);
  expect(todayPanelSrc).not.toMatch(internalFieldPattern);
  expect(trainerFeedbackSrc).not.toMatch(internalFieldPattern);
});

test("TrainerFeedbackNotice only renders text explicitly passed to it (no internal data source of its own)", () => {
  expect(trainerFeedbackSrc).not.toMatch(/api\.get|fetch\(/);
});

// 14. Existing homework deep links still open — the scroll-to-anchor id
// used by the app's existing deep-link/quick-link entry points is preserved
// on the new panel (previously on the removed block).
test("The portal-homework-anchor id used by existing deep links now lives on ClientTodayPanel", () => {
  expect(todayPanelSrc).toMatch(/id="portal-homework-anchor"/);
  expect(portalSrc).toMatch(/document\.getElementById\("portal-homework-anchor"\)/);
});
