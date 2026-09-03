// Finishing the last instructional part reveals the Practice card and its button —
// on an ordinary lesson and on a trainer-checkpoint lesson.
const { test, expect } = require("@playwright/test");
const H = require("./helpers");

test.describe("last part → Practice", () => {
  test("ordinary lesson: the unlock card and Start Practice are on screen", async ({ page, request }, testInfo) => {
    const client = H.clientFor(testInfo, 2);
    const token = await H.apiLogin(request, client);
    const api = H.apiFor(request, token);
    await api.finishSetup(client.enrollment_id);
    const lessonId = client.current_lesson_id;
    await api.completeParts(client.enrollment_id, lessonId, 4);

    await H.loginInBrowser(page, request, client);
    await H.markWelcomeSeen(page, client);
    await page.goto(H.lessonUrl(client, lessonId));
    await expect(page.getByTestId("lesson-journey-part")).toHaveText(/Part 5 of 5/);
    const last = page.getByTestId("lesson-section-continue-know_got_it");
    await last.scrollIntoViewIfNeeded();
    await last.click();

    const card = page.getByTestId("lesson-practice-unlocked");
    await H.expectInUsable(page, card.locator("h3"), "unlock headline");
    await H.expectInUsable(page, page.getByTestId("lesson-practice-unlocked-cta"), "Start Practice button");
    await expect(page.getByTestId("lesson-practice-locked")).toHaveCount(0);
    await expect(page.getByTestId("lesson-journey-part")).toHaveText(/All 5 parts done/);
    await H.snap(page, "09-practice-unlocked");
  });

  test("checkpoint lesson: Practice is the next action; the trainer check is a one-line promise, not a rubric", async ({ page, request }, testInfo) => {
    const client = H.clientFor(testInfo, 3);
    const token = await H.apiLogin(request, client);
    const api = H.apiFor(request, token);
    const l4 = await H.reachLesson4(api, client);
    await api.completeParts(client.enrollment_id, l4, 4);

    await H.loginInBrowser(page, request, client);
    await H.markWelcomeSeen(page, client);
    await page.goto(H.lessonUrl(client, l4));
    await expect(page.getByTestId("lesson-journey-then")).toContainText("Trainer check");
    const last = page.getByTestId("lesson-section-continue-know_got_it");
    await last.scrollIntoViewIfNeeded();
    await last.click();

    await H.expectInUsable(page, page.getByTestId("lesson-practice-unlocked-cta"), "Start Practice button (checkpoint lesson)");
    await expect(page.getByTestId("lesson-practice-unlocked-after")).toContainText(/trainer check/i);
    await expect(page.getByTestId("school-checkpoint-needs-practice-panel")).toHaveCount(0);
    await expect(page.getByTestId("checkpoint-criteria")).toHaveCount(0);
    await H.snap(page, "10-practice-unlocked-checkpoint-lesson");
  });
});
