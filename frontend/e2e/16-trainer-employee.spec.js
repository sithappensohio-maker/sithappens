// Stage 11.5 — a REAL trainer employee (role employee, staff_role trainer)
// opens the app, lands in the Staff Portal, opens Training, and completes
// every training action they are authorized to do — without the admin role.
// Front Desk is the negative: same portal, no Training, no training API.
//
// Runs at the two phone sizes (390 / 320). Each project owns its own set of
// seeded work (`trainer_employee.flows[n]`) so finishing flows never collide.
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const H = require("./helpers");

const seed = JSON.parse(fs.readFileSync("e2e/.seed.json", "utf8"));
const emp = seed.trainer_employee;
const ownerDay = seed.trainer_day;

function flowFor(testInfo) {
  return emp.flows[testInfo.project.name === "phone-320" ? 1 : 0];
}

async function staffInBrowser(page, request, who) {
  const login = await request.post(`${H.API}/auth/login`, { data: { email: who.email, password: who.password } });
  expect(login.ok(), await login.text()).toBeTruthy();
  const j = await login.json();
  await page.addInitScript(({ t, u }) => {
    localStorage.setItem("sh_token", t); localStorage.setItem("sh_user", JSON.stringify(u));
    localStorage.setItem("sh_install_dismissed_at", String(Date.now()));
  }, { t: j.token, u: j.user });
  return j.token;
}

async function noOverflow(page) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(o.sw, `no horizontal overflow (${o.sw} > ${o.iw})`).toBeLessThanOrEqual(o.iw + 1);
}

async function openMyWork(page) {
  await page.goto("/");
  await expect(page.getByTestId("employee-portal")).toBeVisible({ timeout: 45_000 });
  await page.getByTestId("emp-tab-training").click();
  await expect(page.getByTestId("emp-training")).toBeVisible();
  await expect(page.getByTestId("trainer-day-queue")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("trainer-day-summary")).not.toHaveText(/Loading/, { timeout: 20_000 });
}

async function recordFirstSkill(page, { outcome, level }) {
  await expect(page.getByTestId("train-skills")).toBeVisible();
  // the lesson's planned skill card starts collapsed — open it, then record on THAT skill (it is required before finishing)
  const toggle = page.locator('[data-testid^="activity-"][data-testid$="-toggle"]').first();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  const outcomeBtn = page.locator(`[data-testid$="-assessment-${outcome}"]`).first();
  await outcomeBtn.scrollIntoViewIfNeeded();
  await outcomeBtn.click();
  const levelBtn = page.locator(`[data-testid$="-score-picker-${level}"]`).first();
  await levelBtn.scrollIntoViewIfNeeded();
  await levelBtn.click();
}

async function wrapUp(page, { nextStep }) {
  await page.getByTestId("workspace-to-wrap").click();
  await expect(page.getByTestId("workspace-wrap")).toBeVisible();
  await page.getByTestId("workspace-what-went-well").fill("Quick, happy sits.");
  await page.getByTestId("workspace-needs-work").fill("Duration with distractions.");
  await page.getByTestId("workspace-recap-note").fill("Great lesson today. Keep the sessions short and fun.");
  await page.getByTestId("workspace-next-lesson-focus").fill("Add distance before adding distraction.");
  const choice = page.getByTestId(`advancement-${nextStep}`);
  await choice.scrollIntoViewIfNeeded();
  await expect(choice).not.toHaveAttribute("data-locked", "1");
  await choice.click();
  await expect(page.getByTestId("workspace-complete-session")).toHaveAttribute("data-ready", "1");
  await page.getByTestId("workspace-complete-session").click();
  const confirm = page.getByTestId("progression-confirm-accept");
  await page.locator('[data-testid="workspace-finished"], [data-testid="progression-confirm-accept"]').first().waitFor();
  if (await confirm.count()) await confirm.click();
  await expect(page.getByTestId("workspace-finished")).toBeVisible({ timeout: 20_000 });
}

test.describe("trainer employee — my training day", () => {
  test("lands in the Staff Portal, Training is there, My Work shows only assigned dogs, owner-only screens stay closed", async ({ page, request }) => {
    const F = flowFor(test.info());
    const token = await staffInBrowser(page, request, emp.trainer);
    await openMyWork(page);
    await noOverflow(page);
    // the employee shell, not the owner's admin shell
    expect(await page.getByTestId("sidebar-toggle-collapse").count()).toBe(0); // the owner sidebar never mounts for an employee
    await expect(page.getByTestId("emp-nav")).toBeVisible();
    await expect(page.getByTestId("pipeline-screen")).toBeVisible();

    // Stage 12 — My Training Day: trainer words, my work only, no business-wide view, no unowned work
    await expect(page.getByTestId("pipeline-hero")).toContainText(/My Training Day/);
    await expect(page.getByTestId("pipeline-hero")).not.toContainText(/Training Operations|Assign today's trainer/);
    await expect(page.getByTestId("hub-stats-trainer")).toBeVisible();
    expect(await page.getByTestId("trainer-day-all").count()).toBe(0);
    expect(await page.getByTestId("trainer-day-needs-assignment").count()).toBe(0);
    const mine = page.getByTestId(`day-item-session:${F.stay.booking_id}`);
    await expect(mine).toBeVisible();
    await expect(mine).toHaveAttribute("data-mine", "1");
    await expect(mine.getByTestId("day-item-dog")).toContainText(F.stay.dog);
    await expect(page.getByTestId(`day-item-session:${ownerDay.booking_id}`)).toHaveCount(0);   // unassigned: the owner's to hand out
    await expect(page.getByTestId(`day-item-checkpoint:${ownerDay.checkpoint_submission_id}`)).toHaveCount(0);
    expect(await page.locator('[data-testid^="day-item-"][data-mine="0"]').count()).toBe(0);
    expect(await page.getByTestId("day-item-secondary-open_dog").count()).toBe(0);

    // no owner tooling on the hub: trainer assignment, tip import and the program pipeline are the owner's
    expect(await page.getByTestId("day-item-assign-trainer").count()).toBe(0);
    expect(await page.getByTestId("tips-csv-wrapper").count()).toBe(0);
    expect(await page.getByTestId("pipeline-filters").count()).toBe(0);
    expect(await page.getByTestId("pipeline-programs").count()).toBe(0);
    // the roster is a quiet secondary block BELOW the day, listing only my students
    const students = page.getByTestId("my-students");
    await expect(students).toBeVisible();
    const queueBox = await page.getByTestId("trainer-day-queue").boundingBox();
    const studentsBox = await students.boundingBox();
    expect(queueBox.y).toBeLessThan(studentsBox.y);
    await expect(students).toContainText(/My students · [1-9]/);
    // the assignment endpoint refuses this account with the capability name, not a role name
    const r = await request.patch(`${H.API}/admin/training/today/${F.stay.booking_id}/trainer`, { headers: { Authorization: `Bearer ${token}` }, data: { assigned_trainer_id: null } });
    expect(r.status()).toBe(403);
    expect(await r.text()).toMatch(/Assign training staff/);

    // Settings / Finance never open for this account — in the UI or the API
    await page.goto("/admin/settings");
    await expect(page.getByTestId("employee-portal")).toBeVisible();
    expect(await page.getByTestId("settings-screen").count()).toBe(0);
    for (const url of ["/settings", "/reports/pl?start_date=2026-01-01&end_date=2026-01-31", "/staff/roles"]) {
      const r = await request.get(`${H.API}${url}`, { headers: { Authorization: `Bearer ${token}` } });
      expect(r.status(), url).toBe(403);
    }
    // the Today → Training deep link lands on the Training tab for an employee too
    await page.goto(`/admin/training?focus=session:${F.stay.booking_id}`);
    await expect(page.getByTestId("emp-training")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId(`day-item-session:${F.stay.booking_id}`)).toHaveAttribute("data-focused", "1", { timeout: 20_000 });
  });

  test("starts a session, saves, resumes with the work intact, finishes with Stay Here", async ({ page, request }) => {
    const F = flowFor(test.info());
    await staffInBrowser(page, request, emp.trainer);
    await openMyWork(page);
    const card = page.getByTestId(`day-item-session:${F.stay.booking_id}`);
    await expect(card.getByTestId("day-item-action")).toHaveText(/start session/i);
    await card.getByTestId("day-item-action").click();
    await expect(page.getByTestId("trainer-briefing")).toBeVisible();
    await expect(page.getByTestId("workspace-dog-header")).toContainText(F.stay.dog);
    await page.getByTestId("briefing-primary-action").click();
    await recordFirstSkill(page, { outcome: "improving", level: 3 });
    // Save & Close → Resume, and the recorded outcome is still there when we come back
    await page.getByTestId("workspace-done").click();
    await expect(page.getByTestId("workspace-saved")).toBeVisible();
    await page.getByTestId("workspace-saved-action").click();
    await expect(page.getByTestId("workspace-saved")).toHaveCount(0);
    const again = page.getByTestId(`day-item-session:${F.stay.booking_id}`);
    await expect(again).toHaveAttribute("data-section", "continue");
    await expect(again.getByTestId("day-item-action")).toHaveText(/resume session/i);
    await again.getByTestId("day-item-action").click();
    await page.locator('[data-testid="briefing-primary-action"], [data-testid="train-skills"]').first().waitFor();
    if (await page.getByTestId("briefing-primary-action").count()) await page.getByTestId("briefing-primary-action").click();
    // the collapsed skill card still shows the recorded result — the draft came back with the work intact
    await expect(page.locator('[data-testid^="activity-"][data-testid$="-recorded"]').first()).toBeVisible();
    const toggle = page.locator('[data-testid^="activity-"][data-testid$="-toggle"]').first();
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    await expect(page.locator('[data-testid$="-assessment-improving"]').first()).toHaveAttribute("aria-pressed", "true");
    await wrapUp(page, { nextStep: "remain" });
    await expect(page.getByTestId("workspace-finished-title")).toContainText(/session (finished|saved|complete)/i);
    await page.getByTestId("workspace-close-after-complete").click();
    const done = page.getByTestId(`day-item-session:${F.stay.booking_id}`);
    await expect(done).toHaveAttribute("data-section", "done");
    await expect(done.getByTestId("day-item-state")).toHaveText(/session finished/i);
  });

  test("finishes a session with Ready for Next Lesson and the queue moves on", async ({ page, request }) => {
    const F = flowFor(test.info());
    await staffInBrowser(page, request, emp.trainer);
    await openMyWork(page);
    const lessons = seed.clients[0].lessons; // the seeded course, in order
    const card = page.getByTestId(`day-item-session:${F.ready.booking_id}`);
    await expect(card.getByTestId("day-item-context")).toContainText(lessons[0].name);
    await card.getByTestId("day-item-action").click();
    await expect(page.getByTestId("trainer-briefing")).toBeVisible();
    await page.getByTestId("briefing-primary-action").click();
    await recordFirstSkill(page, { outcome: "passed", level: 5 });
    await wrapUp(page, { nextStep: "advance_next" });
    await expect(page.getByTestId("workspace-next-training-step")).toContainText(new RegExp(`${lessons[1].name}|next lesson`, "i"));
    await page.getByTestId("workspace-close-after-complete").click();
    const done = page.getByTestId(`day-item-session:${F.ready.booking_id}`);
    await expect(done).toHaveAttribute("data-section", "done");
    await expect(done.getByTestId("day-item-context")).toContainText(lessons[1].name);
  });

  test("reviews Practice, approves daily work and grades a checkpoint from the queue", async ({ page, request }) => {
    const F = flowFor(test.info());
    await staffInBrowser(page, request, emp.trainer);
    await openMyWork(page);

    // Practice
    const practice = page.getByTestId(`day-item-practice:${F.practice.homework_id}:${F.practice.log_id}`);
    await expect(practice).toBeVisible();
    await practice.getByTestId("day-item-action").click();
    await expect(page.getByTestId("practice-review-modal")).toBeVisible();
    await expect(page.getByTestId("practice-review-detail")).toBeVisible();
    await page.getByTestId("practice-review-looks-good").click();
    await expect(page.getByTestId("practice-review-handoff")).toBeVisible();
    await page.getByTestId("practice-review-modal-close").click();
    await expect(page.getByTestId(`day-item-practice:${F.practice.homework_id}:${F.practice.log_id}`)).toHaveCount(0);

    // Daily work
    const daily = page.getByTestId(`day-item-daily:${F.daily.homework_id}:1`);
    await expect(daily).toBeVisible();
    await expect(daily.getByTestId("day-item-dog")).toContainText(F.daily.dog);
    await daily.getByTestId("day-item-action").click();
    await expect(page.getByTestId("review-detail-pane")).toBeVisible();
    await page.getByTestId("review-approve").click();
    await expect(page.getByTestId("daily-review-handoff")).toBeVisible();
    await page.getByTestId("review-queue-close").click();
    await expect(page.getByTestId(`day-item-daily:${F.daily.homework_id}:1`)).toHaveCount(0);

    // Checkpoint
    const cp = page.getByTestId(`day-item-checkpoint:${F.checkpoint.submission_id}`);
    await expect(cp).toBeVisible();
    await cp.getByTestId("day-item-action").click();
    await expect(page.getByTestId("checkpoint-review-detail-pane")).toContainText(F.checkpoint.dog);
    const scores = page.locator('[data-testid^="checkpoint-review-score-"][data-testid$="-4"]');
    const n = await scores.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) { await scores.nth(i).scrollIntoViewIfNeeded(); await scores.nth(i).click(); }
    await expect(page.getByTestId("checkpoint-review-advance")).toBeEnabled();
    await page.getByTestId("checkpoint-review-advance").click();
    await expect(page.getByTestId("checkpoint-review-handoff")).toBeVisible();
    await page.getByTestId("checkpoint-review-queue-close").click();
    await expect(page.getByTestId(`day-item-checkpoint:${F.checkpoint.submission_id}`)).toHaveCount(0);

    // Stage 12 — Done today confirms what I finished, derived from the records themselves
    const done = page.getByTestId("day-section-done");
    await expect(done).toBeVisible();
    await expect(done.getByTestId(`day-item-done:practice:${F.practice.homework_id}:${F.practice.log_id}`)).toContainText(/Practice reviewed/);
    await expect(done.getByTestId(`day-item-done:practice:${F.practice.homework_id}:${F.practice.log_id}`)).toContainText(/Looks good .* by you/);
    await expect(done.getByTestId(`day-item-done:daily:${F.daily.homework_id}:1`)).toContainText(/Daily work reviewed/);
    await expect(done.getByTestId(`day-item-done:checkpoint:${F.checkpoint.submission_id}`)).toContainText(/Checkpoint graded/);
    // reviews are confirmations, not tasks: no button on them (a finished booked session keeps its View session)
    for (const k of [`done:practice:${F.practice.homework_id}:${F.practice.log_id}`, `done:daily:${F.daily.homework_id}:1`, `done:checkpoint:${F.checkpoint.submission_id}`]) {
      expect(await done.getByTestId(`day-item-${k}`).getByTestId("day-item-action").count(), k).toBe(0);
    }
  });

  test("an unfinished session from yesterday is still here once, and Resume reopens THAT draft", async ({ page, request }) => {
    const F = flowFor(test.info());
    const token = await staffInBrowser(page, request, emp.trainer);
    await openMyWork(page);
    const stale = page.getByTestId(`day-item-draft:${F.stale_draft.draft_id}`);
    await expect(stale).toBeVisible();
    await expect(stale).toHaveAttribute("data-section", "continue");
    await expect(stale.getByTestId("day-item-today")).toContainText(/Started yesterday/);
    await expect(stale.getByTestId("day-item-action")).toHaveText(/resume session/i);
    await stale.getByTestId("day-item-action").click();
    await expect(page.getByTestId("training-session-workspace")).toBeVisible();
    await expect(page.getByTestId("workspace-dog-header")).toContainText(F.stale_draft.dog);
    await page.getByTestId("workspace-close").click();
    // resuming created nothing new: the day still lists this draft exactly once and no other draft for the dog
    const r = await request.get(`${H.API}/admin/training/day`, { headers: { Authorization: `Bearer ${token}` } });
    expect(r.status()).toBe(200);
    const drafts = (await r.json()).items.filter((it) => it.key.startsWith("draft:") && it.dog?.id === F.stale_draft.dog_id);
    expect(drafts.map((d) => d.key)).toEqual([`draft:${F.stale_draft.draft_id}`]);
  });
});

test.describe("front desk — no training", () => {
  test("same portal, Clients kept, no Training tab, no training API, deep link falls back to Clock", async ({ page, request }) => {
    const token = await staffInBrowser(page, request, emp.front_desk);
    await page.goto("/");
    await expect(page.getByTestId("employee-portal")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId("emp-tab-clients")).toBeVisible();   // explicitly granted overlap stays
    expect(await page.getByTestId("emp-tab-training").count()).toBe(0);
    await page.goto("/admin/training");
    await expect(page.getByTestId("employee-portal")).toBeVisible();
    await expect(page.getByTestId("clock-tab")).toBeVisible();
    expect(await page.getByTestId("emp-training").count()).toBe(0);
    for (const url of ["/admin/training/day", "/admin/homework/pending-reviews", "/admin/school/checkpoints/pending", "/settings"]) {
      const r = await request.get(`${H.API}${url}`, { headers: { Authorization: `Bearer ${token}` } });
      expect(r.status(), url).toBe(403);
    }
  });
});
