// Practice Coach from School: same lesson, first rep on screen, save → next action.
const { test, expect } = require("@playwright/test");
const H = require("./helpers");

/** Inside the Coach panel the scrolling element is the panel body. */
async function expectInPanel(page, locator, label) {
  await expect.poll(async () => {
    const box = await locator.boundingBox();
    const body = await page.getByTestId("practice-panel-body").boundingBox();
    if (!box || !body) return "not rendered";
    const ok = box.y >= body.y - 1 && box.y + box.height <= body.y + body.height + 1;
    return ok ? "in-view" : `${label}: y=${Math.round(box.y)} h=${Math.round(box.height)} panel=${Math.round(body.y)}..${Math.round(body.y + body.height)}`;
  }, { timeout: 10_000, message: `${label} inside the Coach panel` }).toBe("in-view");
}

async function openCoachFromLesson(page, request, client, slotLessonId) {
  await H.loginInBrowser(page, request, client);
  await H.markWelcomeSeen(page, client);
  await page.goto(H.lessonUrl(client, slotLessonId));
  const cta = page.getByTestId("lesson-practice-unlocked-cta");
  await H.expectInUsable(page, cta, "Start Practice on load");
  await cta.click();
  await expect(page.getByTestId("practice-panel")).toBeVisible();
}

test.describe("Practice Coach", () => {
  test("guided practice: lesson name, first rep on screen, save → Today shows the next action at the top", async ({ page, request }, testInfo) => {
    const client = H.clientFor(testInfo, 4);
    const token = await H.apiLogin(request, client);
    const api = H.apiFor(request, token);
    await api.finishSetup(client.enrollment_id);
    const lessonId = client.current_lesson_id;
    await api.completeParts(client.enrollment_id, lessonId);
    await openCoachFromLesson(page, request, client, lessonId);

    // Still the same lesson.
    await expect(page.getByTestId("practice-panel-title")).toHaveText(client.lessons[0].name);
    await expect(page.getByTestId("practice-panel-close")).toHaveAttribute("aria-label", /close/i);
    const guided = page.getByTestId("coach-overview-start-guided");
    await expectInPanel(page, guided, "Start Guided Practice");
    await expect(page.getByTestId("coach-overview-quick-practice")).toContainText(/already practiced/i);
    await H.snap(page, "11-coach-overview");
    await guided.click();

    // First rep: the cue and both scoring buttons, without scrolling.
    expect(await page.getByTestId("practice-panel-body").evaluate((el) => el.scrollTop)).toBe(0);
    await expectInPanel(page, page.getByTestId("coach-guided-cue"), "cue card");
    await expectInPanel(page, page.getByTestId("coach-guided-success"), "LOOKED button");
    await expectInPanel(page, page.getByTestId("coach-guided-miss"), "DIDN'T button");
    await H.snap(page, "12-coach-first-rep");

    for (let i = 0; i < 10; i += 1) {
      await page.getByTestId("coach-guided-success").click();
      const next = page.getByTestId("coach-guided-next-rep");
      if (await next.count()) await next.click();
    }
    await page.getByTestId("coach-guided-finish-for-now").click();
    // The wrap-up opens on the results; the pinned save bar is one scroll away
    // and stays pinned to the bottom of the panel from then on.
    await expect(page.getByTestId("practice-completion")).toBeVisible();
    const submit = page.getByTestId("practice-completion-submit");
    await submit.scrollIntoViewIfNeeded();
    await expectInPanel(page, submit, "Save practice button");
    await submit.click();
    await expect(page.getByTestId("practice-complete-state")).toBeVisible();

    // Return: Today, at the top, with the next action in view.
    await expect(page).toHaveURL(/\/school$/, { timeout: 15_000 });
    await expect(page.getByTestId("practice-panel")).toHaveCount(0);
    await expect.poll(() => H.scrollRootTop(page)).toBe(0);
    const primary = page.getByTestId("today-primary-action");
    await H.expectInUsable(page, primary, "Today primary action after practice");
    await expect(primary).toHaveText(/continue to your next lesson/i);
    // The practice cards agree with the command card: logged, not "log a session".
    await expect(page.getByTestId("today-practice-satisfied")).toContainText(/Practice logged today/);
    await expect(page.getByTestId("today-practice-due")).toHaveCount(0);
    await expect(page.getByTestId("student-workspace-extras")).not.toContainText("Open your Practice Coach and log a session");
    await H.snap(page, "13-today-after-practice");
  });

  test("'I already practiced' cannot save an empty session", async ({ page, request }, testInfo) => {
    const client = H.clientFor(testInfo, 5);
    const token = await H.apiLogin(request, client);
    const api = H.apiFor(request, token);
    await api.finishSetup(client.enrollment_id);
    const lessonId = client.current_lesson_id;
    await api.completeParts(client.enrollment_id, lessonId);
    await openCoachFromLesson(page, request, client, lessonId);

    await page.getByTestId("coach-overview-quick-practice").click();
    await expect(page.getByTestId("practice-quick-log-intro")).toBeVisible();
    const submit = page.getByTestId("practice-completion-submit");
    await expect(submit).toBeDisabled();
    await H.snap(page, "14-quick-log-blocked");
    await page.getByTestId("practice-completion-difficulty-good").click();
    await expect(submit).toBeDisabled();
    await page.getByTestId("practice-completion-note").fill("Ten name reps in the kitchen, eight clean.");
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByTestId("practice-complete-state")).toBeVisible();
    await expect(page).toHaveURL(/\/school$/, { timeout: 15_000 });
    await H.expectInUsable(page, page.getByTestId("today-primary-action"), "Today primary action after quick log");
  });
});
