// Stage 11 — Trainer Daily Queue: "Open Training. This is your day."
//
// Runs at the phone sizes of the two projects (390 / 320) and once at
// 1440×900 inside the spec. Data comes from the seed's `trainer_day` block:
// an in-person student booked today and a pending, gradable checkpoint.
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const H = require("./helpers");

const seed = JSON.parse(fs.readFileSync("e2e/.seed.json", "utf8"));
const day = seed.trainer_day;
const env = Object.fromEntries(
  fs.readFileSync("../backend/.env", "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

async function adminInBrowser(page, request) {
  const login = await request.post(`${H.API}/auth/login`, { data: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD || "admin123" } });
  expect(login.ok(), await login.text()).toBeTruthy();
  const j = await login.json();
  await page.addInitScript(({ t, u }) => {
    localStorage.setItem("sh_token", t); localStorage.setItem("sh_user", JSON.stringify(u));
    localStorage.setItem("sh_install_dismissed_at", String(Date.now()));
  }, { t: j.token, u: j.user || { role: "admin", email: env.ADMIN_EMAIL } });
}

async function noOverflow(page) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(o.sw, `no horizontal overflow (${o.sw} > ${o.iw})`).toBeLessThanOrEqual(o.iw + 1);
}

async function openTraining(page) {
  await page.goto("/admin/training");
  // first paint after a cold dev-server start can take a while; the shell first, then the queue
  await expect(page.getByTestId("pipeline-screen")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId("trainer-day-queue")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("trainer-day-summary")).not.toHaveText(/Loading/, { timeout: 20_000 });
}

test.describe("trainer daily queue", () => {
  test("the day reads top-down: needs attention, today's training, one action per card, no overflow", async ({ page, request }) => {
    await adminInBrowser(page, request);
    await openTraining(page);
    await noOverflow(page);

    // Stage 12 — the owner sees the operation: owner words, business-wide view, program pipeline, who owns what
    await expect(page.getByTestId("pipeline-hero")).toContainText(/Training Operations/);
    await expect(page.getByTestId("hub-stats-operations")).toBeVisible();
    await expect(page.getByTestId("trainer-day-all")).toBeVisible();
    await expect(page.getByTestId("pipeline-programs")).toBeVisible();

    // the pending checkpoint is the first thing that needs the trainer
    const cp = page.getByTestId(`day-item-checkpoint:${day.checkpoint_submission_id}`);
    await expect(cp).toBeVisible();
    await expect(cp).toHaveAttribute("data-section", "needs_attention");
    await expect(cp.getByTestId("day-item-dog")).toContainText(day.checkpoint_dog);
    await expect(cp.getByTestId("day-item-state")).toHaveText(/checkpoint to review/i);
    await expect(cp.getByTestId("day-item-action")).toHaveText(/review checkpoint/i);
    expect(await cp.getByTestId("day-item-action").count()).toBe(1);

    // the booked in-person student is today's training with full context
    const sess = page.getByTestId(`day-item-session:${day.booking_id}`);
    await expect(sess).toBeVisible();
    // the 390 project may already have opened this session's plan (Save & Close below), so
    // the card is either scheduled (today) or resumable (continue) — never anything else
    expect(["today", "continue"]).toContain(await sess.getAttribute("data-section"));
    await expect(sess.getByTestId("day-item-dog")).toContainText(day.session_dog);
    await expect(sess.getByTestId("day-item-context")).toContainText(seed.program_name);
    await expect(sess.getByTestId("day-item-mode")).toHaveText(/in person/i);
    await expect(sess.getByTestId("day-item-next")).toContainText(/Run |Start |Resume /);
    await expect(sess.getByTestId("day-item-action")).toHaveText(/start session|resume session/i);

    // needs attention is above the session work (today's training / continue)
    const attentionBox = await page.getByTestId("day-section-needs_attention").boundingBox();
    const sessBox = await sess.boundingBox();
    expect(attentionBox.y).toBeLessThan(sessBox.y);

    // the primary action is a real, unclipped tap target inside the viewport width
    const btn = await sess.getByTestId("day-item-action").boundingBox();
    expect(btn.height).toBeGreaterThanOrEqual(44);
    expect(btn.x + btn.width).toBeLessThanOrEqual(page.viewportSize().width + 1);
  });

  test("Review checkpoint deep-links to that submission; Start session carries the dog straight into its lesson workspace", async ({ page, request }) => {
    await adminInBrowser(page, request);
    await openTraining(page);

    await page.getByTestId(`day-item-checkpoint:${day.checkpoint_submission_id}`).getByTestId("day-item-action").click();
    await expect(page.getByTestId("checkpoint-review-detail-pane")).toBeVisible();
    await expect(page.getByTestId("checkpoint-review-detail-pane")).toContainText(day.checkpoint_dog);
    await expect(page.getByTestId("checkpoint-review-detail-pane")).toContainText(day.checkpoint_lesson);
    await page.getByTestId("checkpoint-review-back").click();
    // closing the tool returns to the queue; the item is still there because nothing was graded
    await page.getByTestId("checkpoint-review-queue-close").click();
    await expect(page.getByTestId("checkpoint-review-queue-modal")).toHaveCount(0);
    await expect(page.getByTestId(`day-item-checkpoint:${day.checkpoint_submission_id}`)).toBeVisible();

    const sess = page.getByTestId(`day-item-session:${day.booking_id}`);
    await sess.getByTestId("day-item-action").click();
    // the workspace opens on the BEFORE briefing for THIS dog, on its current lesson — nothing to re-select
    await expect(page.getByTestId("trainer-briefing")).toBeVisible();
    await expect(page.getByTestId("workspace-dog-header")).toContainText(day.session_dog);
    await expect(page.getByTestId("briefing-today")).toContainText(/Lesson 1 of/);
    await expect(page.getByTestId("briefing-primary-action")).toHaveText(/start lesson|resume lesson/i);

    // Save & Close → the queue reloads and now offers Resume, never Start
    await page.getByTestId("briefing-primary-action").click();
    await expect(page.getByTestId("train-skills")).toBeVisible();
    await page.getByTestId("workspace-done").click();
    await expect(page.getByTestId("workspace-saved")).toBeVisible();
    await page.getByTestId("workspace-saved-action").click();
    await expect(page.getByTestId("workspace-saved")).toHaveCount(0);
    const again = page.getByTestId(`day-item-session:${day.booking_id}`);
    await expect(again).toHaveAttribute("data-section", "continue");
    await expect(again.getByTestId("day-item-action")).toHaveText(/resume session/i);
    await expect(again).not.toContainText(/start session/i);
  });

  test("Needs assignment shows the owner exactly the work with no trainer, and assigning clears it", async ({ page, request }) => {
    await adminInBrowser(page, request);
    await openTraining(page);
    const chip = page.getByTestId("trainer-day-needs-assignment");
    await expect(chip).toBeVisible();
    await expect(chip).toContainText(/Needs assignment · [1-9]/);
    // the unassigned in-person booking is unowned work; the online checkpoint is the owner's by default (not flagged)
    const sess = page.getByTestId(`day-item-session:${day.booking_id}`);
    await expect(sess.getByTestId("day-item-flag-unassigned")).toBeVisible();
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await expect(sess).toBeVisible();
    await expect(page.getByTestId(`day-item-checkpoint:${day.checkpoint_submission_id}`)).toHaveCount(0);
    // every card in this view carries the flag
    const flagged = await page.locator('[data-testid^="day-item-"][data-section]').count();
    expect(await page.getByTestId("day-item-flag-unassigned").count()).toBe(flagged);
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "false");
    // assigning the trainer from the card (owner capability) removes it from the unowned work
    const trainerName = seed.trainer_employee.trainer.name;
    await sess.getByTestId("day-item-assign-trainer").selectOption({ label: trainerName });
    await expect(sess.getByTestId("day-item-flag-unassigned")).toHaveCount(0, { timeout: 15_000 });
    await expect(sess.getByTestId("day-item-trainer")).toContainText(trainerName);
    // hand it back so the other phone project sees the same seed state
    await sess.getByTestId("day-item-assign-trainer").selectOption({ value: "" });
    await expect(sess.getByTestId("day-item-flag-unassigned")).toBeVisible({ timeout: 15_000 });
  });

  test("Today → a training row opens the Hub focused on that dog's queue item", async ({ page, request }) => {
    await adminInBrowser(page, request);
    await page.goto("/admin");
    const row = page.getByTestId(`today-training-plan-${day.booking_id}`);
    await expect(row).toBeVisible({ timeout: 45_000 });
    await row.click();
    await expect(page).toHaveURL(new RegExp(`/admin/training[?]focus=session(%3A|:)${day.booking_id}`));
    const card = page.getByTestId(`day-item-session:${day.booking_id}`);
    await expect(card).toHaveAttribute("data-focused", "1", { timeout: 20_000 });
    // the focused card ends up inside the viewport (the hub settles once late blocks above it load), not just marked
    await expect.poll(async () => {
      const box = await card.boundingBox();
      return box && box.y >= -1 && box.y < page.viewportSize().height * 0.6;
    }, { timeout: 8_000 }).toBe(true);
  });

  test("desktop 1440×900 keeps the same order and actions", async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await adminInBrowser(page, request);
    await openTraining(page);
    await noOverflow(page);
    await expect(page.getByTestId("day-section-needs_attention")).toBeVisible();
    const sess = page.getByTestId(`day-item-session:${day.booking_id}`);
    await expect(sess.getByTestId("day-item-action")).toBeVisible();
    // the hero stays above the queue, and the queue sits above the all-programs pipeline list
    const queue = await page.getByTestId("trainer-day-queue").boundingBox();
    const filters = await page.getByTestId("pipeline-filters").boundingBox();
    expect(queue.y).toBeLessThan(filters.y);
  });
});
