// After the required practice is logged, Today and the Practice tab must say so —
// and unrelated trainer-prescribed work must still show as unfinished.
const { test, expect } = require("@playwright/test");
const H = require("./helpers");

test.describe("practice state after logging", () => {
  test("logged required practice reads as done; trainer-prescribed work stays open", async ({ page, request }, testInfo) => {
    const client = H.clientFor(testInfo, 10);
    expect(client.general_practice_id, "seed gives this slot a trainer-prescribed general row").toBeTruthy();
    const token = await H.apiLogin(request, client);
    const api = H.apiFor(request, token);
    await api.finishSetup(client.enrollment_id);
    const lessonId = client.current_lesson_id;
    await api.completeParts(client.enrollment_id, lessonId);

    await H.loginInBrowser(page, request, client);
    await H.markWelcomeSeen(page, client);

    // Before: Today still asks for the lesson's practice.
    await page.goto("/school");
    await expect(page.getByTestId("today-primary-action")).toHaveText(/start practice/i);
    await expect(page.getByTestId("school-assigned-practice")).toContainText("Open your Practice Coach and log a session");

    // Do the required guided practice for real.
    await page.goto(H.lessonUrl(client, lessonId));
    await page.getByTestId("lesson-practice-unlocked-cta").click();
    await page.getByTestId("coach-overview-start-guided").click();
    for (let i = 0; i < 10; i += 1) {
      await page.getByTestId("coach-guided-success").click();
      const next = page.getByTestId("coach-guided-next-rep");
      if (await next.count()) await next.click();
    }
    await page.getByTestId("coach-guided-finish-for-now").click();
    const submit = page.getByTestId("practice-completion-submit");
    await submit.scrollIntoViewIfNeeded();
    await submit.click();
    await expect(page.getByTestId("practice-complete-state")).toBeVisible();
    await page.getByTestId("practice-complete-continue").click();
    await expect(page).toHaveURL(/\/school$/, { timeout: 15_000 });

    // After: the stale instruction is gone for the lesson's row; the general
    // trainer-prescribed row still shows as unfinished.
    await H.expectInUsable(page, page.getByTestId("today-primary-action"), "Today primary action");
    await expect(page.getByTestId("today-primary-action")).toHaveText(/continue to your next lesson/i);
    const assigned = page.getByTestId("school-assigned-practice");
    await expect(assigned).toBeVisible();
    const loggedRow = assigned.locator('[data-testid^="school-assigned-practice-logged-"]');
    await expect(loggedRow).toHaveCount(1);
    await expect(loggedRow).toContainText(/Practice logged today/);
    await expect(loggedRow).toContainText(client.lessons[0].name); // named after the lesson, not the template
    await expect(loggedRow).toContainText(/1 session logged/);
    await expect(loggedRow).toContainText(/Practice again any time/);
    await expect(loggedRow).not.toContainText("Open your Practice Coach and log a session");
    const openRow = assigned.getByTestId(`school-assigned-practice-open-${client.general_practice_id}`);
    await expect(openRow).toBeVisible();
    await expect(openRow).toContainText(/Bonus/);
    // The Today practice card now points at the unfinished general row, not the lesson's.
    const due = page.getByTestId("today-practice-due");
    await expect(due).toBeVisible();
    await expect(due).toContainText(/Loose-Leash Bonus/);
    await H.snap(page, "20-today-practice-logged");

    // Practice tab: the lesson's practice is "Done for today", the general row is still assigned.
    await page.getByTestId("school-nav-m-practice").click();
    const done = page.getByTestId("practice-group-done");
    await expect(done).toBeVisible();
    await expect(done).toContainText(/Done for today/);
    await expect(done).toContainText(/Practice logged today/);
    await expect(done.getByRole("button", { name: /practice again/i })).toBeVisible();
    // Stage 4: the one unfinished row (the trainer's general Practice) is
    // today's featured item — rich card + one Start button — not a list row.
    const today = page.getByTestId("practice-today");
    await expect(today).toBeVisible();
    await expect(today).toHaveAttribute("data-practice-id", client.general_practice_id);
    await expect(today).toHaveAttribute("data-practice-kind", "start");
    await expect(today).toContainText(/Loose-Leash Bonus/);
    // Done sits below the unfinished work.
    const doneBox = await done.boundingBox();
    const openBox = await today.boundingBox();
    expect(doneBox.y).toBeGreaterThan(openBox.y);
    await H.snap(page, "21-practice-tab-done-for-today");
  });
});
