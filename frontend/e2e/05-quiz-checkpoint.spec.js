// The two server-owned gates: Module Quiz at the end of a module, trainer checkpoint at the end of the course.
const { test, expect } = require("@playwright/test");
const H = require("./helpers");

test.describe("module quiz and checkpoint", () => {
  test("module quiz: Today → quiz → result → Today at the top with the next lesson", async ({ page, request }, testInfo) => {
    const client = H.clientFor(testInfo, 6);
    const token = await H.apiLogin(request, client);
    const api = H.apiFor(request, token);
    const eid = client.enrollment_id;
    const [l1, l2] = client.lessons.map((l) => l.id);
    await api.finishSetup(eid);
    await api.completeParts(eid, l1); await api.practice(eid, l1); await api.advance(eid);
    await api.completeParts(eid, l2); await api.practice(eid, l2);

    await H.loginInBrowser(page, request, client);
    await H.markWelcomeSeen(page, client);
    await page.goto("/school");
    const primary = page.getByTestId("today-primary-action");
    await H.expectInUsable(page, primary, "Today primary action (quiz)");
    await expect(primary).toHaveText(/quiz/i);
    await primary.click();

    const panel = page.getByTestId("module-quiz-panel");
    await expect(panel).toBeVisible();
    await panel.getByTestId("module-quiz-start").click();
    await panel.locator('[data-testid^="module-quiz-option-"]').first().click();
    await panel.getByTestId("module-quiz-next").click();
    await panel.locator('[data-testid^="module-quiz-option-"]').first().click();
    await panel.getByTestId("module-quiz-submit").click();
    await expect(panel.getByTestId("module-quiz-passed")).toBeVisible();
    await panel.getByTestId("module-quiz-continue").click();

    await expect(page.getByTestId("module-quiz-panel")).toHaveCount(0);
    await expect(page).toHaveURL(/\/school$/);
    await expect.poll(() => H.scrollRootTop(page)).toBe(0);
    await H.expectInUsable(page, page.getByTestId("today-primary-action"), "Today primary action after quiz");
    await expect(page.getByTestId("today-command-center")).toContainText(client.lessons[2].name);
    await H.snap(page, "15-today-after-quiz");
  });

  test("checkpoint: after practice the trainer check is the next action, and submitting leads to a clear waiting state", async ({ page, request }, testInfo) => {
    const client = H.clientFor(testInfo, 7);
    const token = await H.apiLogin(request, client);
    const api = H.apiFor(request, token);
    const l4 = await H.reachLesson4(api, client, { practiseLesson4: true });

    await H.loginInBrowser(page, request, client);
    await H.markWelcomeSeen(page, client);
    await page.goto(H.lessonUrl(client, l4));
    await expect(page.getByTestId("lesson-journey-then")).toContainText("Trainer check");
    // The lesson opens with the strip ("All 5 parts done · Then: Trainer check")
    // and the checkpoint panel's heading in view — no hunting for the form.
    const form = page.getByTestId("school-checkpoint-submit-form");
    await H.expectAtTop(page, form, "checkpoint form", 330);
    await expect(page.getByTestId("lesson-practice-unlocked")).toHaveCount(0);
    await H.snap(page, "16-checkpoint-form-on-open");

    await page.getByTestId("school-nav-m-today").click();
    const primary = page.getByTestId("today-primary-action");
    await H.expectInUsable(page, primary, "Today primary action (checkpoint)");
    await expect(primary).toHaveText(/checkpoint/i);

    await api.submitCheckpoint(client.enrollment_id, l4);
    await page.goto(H.lessonUrl(client, l4));
    await expect(page.getByTestId("school-checkpoint-awaiting-review")).toBeVisible();
    await expect(page.getByTestId("school-checkpoint-submit-form")).toHaveCount(0);
    await page.getByTestId("school-nav-m-today").click();
    await expect.poll(() => H.scrollRootTop(page)).toBe(0);
    await expect(page.getByTestId("today-command-center")).toContainText(/reviewing|done for now/i);
    await expect(page.getByTestId("today-primary-action")).toHaveCount(0);
    await H.snap(page, "17-today-awaiting-review");
  });
});
