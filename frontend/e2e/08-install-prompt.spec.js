// The "add to home screen" prompt: present on an ordinary screen, above the tab bar,
// gone while an immersive workflow is open or the primary CTA is on screen, back
// afterwards without being dismissed.
const { test, expect } = require("@playwright/test");
const H = require("./helpers");

const PROMPT = '[data-testid="install-ios-hint"], [data-testid="install-app-prompt"]';

async function expectPromptAboveNav(page) {
  const prompt = page.locator(PROMPT).first();
  await expect(prompt).toBeVisible();
  const p = await prompt.boundingBox();
  const nav = await page.getByTestId("school-nav-mobile").boundingBox();
  expect(nav, "School tab bar is mounted").toBeTruthy();
  expect(p.y + p.height, "prompt bottom sits above the tab bar top").toBeLessThanOrEqual(nav.y + 1);
}

async function dismissalKey(page) {
  return page.evaluate(() => localStorage.getItem("sh_install_dismissed_at"));
}

/** Wheel the School container until no primary CTA is left in the usable window. */
async function scrollPrimaryOut(page) {
  for (let i = 0; i < 12; i += 1) {
    const anyVisible = await page.evaluate(() => {
      const u = document.querySelector('[data-testid="school-app"] > header');
      const top = u ? u.getBoundingClientRect().bottom : 0;
      return [...document.querySelectorAll("[data-school-primary]")].some((el) => {
        const r = el.getBoundingClientRect();
        return r.height > 0 && r.bottom > top && r.top < window.innerHeight;
      });
    });
    if (!anyVisible) return;
    await H.humanScroll(page, 400);
  }
  throw new Error("could not scroll every primary action out of view");
}

test.describe("install prompt vs School workflows", () => {
  test("iPhone hint: above the tab bar, hidden by Practice Coach and the dialogs, back without dismissal", async ({ page, request }, testInfo) => {
    const client = H.clientFor(testInfo, 11);
    const token = await H.apiLogin(request, client);
    const api = H.apiFor(request, token);
    await api.finishSetup(client.enrollment_id);
    await H.loginInBrowser(page, request, client, { keepInstallPrompt: true });
    await H.markWelcomeSeen(page, client);

    // Today: the primary CTA is on screen, so the pill waits; past it, it sits above the tab bar.
    await page.goto("/school");
    await H.expectInUsable(page, page.getByTestId("today-primary-action"), "Today primary action");
    await expect(page.locator(PROMPT)).toHaveCount(0);
    await scrollPrimaryOut(page);
    await expectPromptAboveNav(page);
    expect(await dismissalKey(page)).toBeNull();
    await H.snap(page, "22-install-prompt-above-nav");

    // New-lesson dialog hides it; Part 1 (no primary marker) shows it.
    await page.goto(H.lessonUrl(client, client.current_lesson_id));
    await expect(page.getByTestId("fresh-lesson-start")).toBeVisible();
    await expect(page.locator(PROMPT)).toHaveCount(0);
    await page.getByTestId("fresh-lesson-start-button").click();
    await expect(page.locator(PROMPT).first()).toBeVisible();

    // "How School works" hides it (the Today CTA underneath keeps it hidden after close).
    await page.getByTestId("school-nav-m-today").click();
    await page.getByTestId("school-how-it-works").click();
    await expect(page.getByTestId("school-orientation")).toBeVisible();
    await expect(page.locator(PROMPT)).toHaveCount(0);
    await page.getByTestId("school-orientation-start").click();
    await expect(page.getByTestId("school-orientation")).toHaveCount(0);
    await scrollPrimaryOut(page);
    await expect(page.locator(PROMPT).first()).toBeVisible();
    expect(await dismissalKey(page)).toBeNull();

    // Practice Coach hides it; the pinned save bar is clickable; closing restores eligibility.
    await api.completeParts(client.enrollment_id, client.current_lesson_id);
    await page.goto(H.lessonUrl(client, client.current_lesson_id));
    const startPractice = page.getByTestId("lesson-practice-unlocked-cta");
    await H.expectInUsable(page, startPractice, "Start Practice on load");
    await expect(page.locator(PROMPT)).toHaveCount(0); // Start Practice is the primary CTA on screen
    await startPractice.click();
    await expect(page.getByTestId("practice-panel")).toBeVisible();
    await expect(page.locator(PROMPT)).toHaveCount(0);
    await page.getByTestId("coach-overview-quick-practice").click();
    await H.expectNotCovered(page, page.getByTestId("practice-completion-submit"), "Coach save button");
    await page.getByTestId("practice-panel-close").click();
    await expect(page.getByTestId("practice-panel")).toHaveCount(0);
    await scrollPrimaryOut(page);
    await expectPromptAboveNav(page);
    expect(await dismissalKey(page)).toBeNull();
  });

  test("Chromium beforeinstallprompt path gets the same suppression", async ({ page, request }, testInfo) => {
    const client = H.clientFor(testInfo, 11);
    await H.loginInBrowser(page, request, client, { keepInstallPrompt: true });
    await H.markWelcomeSeen(page, client);
    await page.goto("/school");
    await page.evaluate(() => {
      const e = new Event("beforeinstallprompt", { cancelable: true });
      e.prompt = () => Promise.resolve();
      e.userChoice = Promise.resolve({ outcome: "dismissed" });
      window.dispatchEvent(e);
    });
    const pill = page.getByTestId("install-app-prompt");
    await H.expectInUsable(page, page.getByTestId("today-primary-action"), "Today primary action");
    await expect(pill).toHaveCount(0); // guard: primary CTA on screen
    await scrollPrimaryOut(page);
    await expect(pill).toBeVisible();
    const p = await pill.boundingBox();
    const nav = await page.getByTestId("school-nav-mobile").boundingBox();
    expect(p.y + p.height).toBeLessThanOrEqual(nav.y + 1);

    // A dialog on top hides it; after it closes the CTA is back on screen, so still hidden.
    await page.getByTestId("school-how-it-works").click();
    await expect(pill).toHaveCount(0);
    await page.getByTestId("school-orientation-start").click();
    await expect(page.getByTestId("school-orientation")).toHaveCount(0);
    await scrollPrimaryOut(page);
    await expect(pill).toBeVisible();
    expect(await dismissalKey(page)).toBeNull();
  });

  test("Module Quiz submit stays clickable with the prompt eligible", async ({ page, request }, testInfo) => {
    const client = H.clientFor(testInfo, 12);
    const token = await H.apiLogin(request, client);
    const api = H.apiFor(request, token);
    const eid = client.enrollment_id;
    const [l1, l2] = client.lessons.map((l) => l.id);
    await api.finishSetup(eid);
    await api.completeParts(eid, l1); await api.practice(eid, l1); await api.advance(eid);
    await api.completeParts(eid, l2); await api.practice(eid, l2);
    await H.loginInBrowser(page, request, client, { keepInstallPrompt: true });
    await H.markWelcomeSeen(page, client);
    await page.goto("/school");
    await scrollPrimaryOut(page);
    await expect(page.locator(PROMPT).first()).toBeVisible();
    await page.getByTestId("today-primary-action").click();
    const panel = page.getByTestId("module-quiz-panel");
    await expect(panel).toBeVisible();
    await expect(page.locator(PROMPT)).toHaveCount(0);
    await panel.getByTestId("module-quiz-start").click();
    await panel.locator('[data-testid^="module-quiz-option-"]').first().click();
    await panel.getByTestId("module-quiz-next").click();
    await panel.locator('[data-testid^="module-quiz-option-"]').first().click();
    await H.expectNotCovered(page, panel.getByTestId("module-quiz-submit"), "quiz submit");
    await panel.getByTestId("module-quiz-submit").click();
    await expect(panel.getByTestId("module-quiz-passed")).toBeVisible();
    await panel.getByTestId("module-quiz-continue").click();
    await expect(page.getByTestId("module-quiz-panel")).toHaveCount(0);
    await scrollPrimaryOut(page);
    await expect(page.locator(PROMPT).first()).toBeVisible();
    expect(await dismissalKey(page)).toBeNull();
  });

  test("checkpoint form hides the prompt and its submit stays reachable", async ({ page, request }, testInfo) => {
    const client = H.clientFor(testInfo, 13);
    const token = await H.apiLogin(request, client);
    const api = H.apiFor(request, token);
    const l4 = await H.reachLesson4(api, client, { practiseLesson4: true });
    await H.loginInBrowser(page, request, client, { keepInstallPrompt: true });
    await H.markWelcomeSeen(page, client);
    await page.goto(H.lessonUrl(client, l4));
    await expect(page.getByTestId("school-checkpoint-submit-form")).toBeVisible();
    await expect(page.locator(PROMPT)).toHaveCount(0);
    await H.expectNotCovered(page, page.getByTestId("school-checkpoint-submit"), "checkpoint submit");
    // Leaving the checkpoint workflow brings eligibility back, still undismissed.
    await page.getByTestId("school-nav-m-today").click();
    await H.expectInUsable(page, page.getByTestId("today-primary-action"), "Today primary action");
    await scrollPrimaryOut(page);
    await expect(page.locator(PROMPT).first()).toBeVisible();
    expect(await dismissalKey(page)).toBeNull();
  });
});
