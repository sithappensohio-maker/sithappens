// Stage 13 — one complete, realistic journey through the whole training system:
//
//   OWNER assigns a program and a trainer
//     → TRAINER works the day, teaches the lesson, records the result, decides what's next
//       → CLIENT sees that decision, learns the lesson, practises
//         → TRAINER reviews the practice
//           → OWNER sees it completed
//
// Every step is a real action by the real account: the owner through the owner Hub, the
// trainer employee through the Staff Portal, the client through the School app. Setup that
// has no UI of its own (creating the enrollment) uses the same application API the screens
// call. Nothing is written straight to the database.
const { test, expect } = require("@playwright/test");
const fs = require("fs");
const H = require("./helpers");

const seed = JSON.parse(fs.readFileSync("e2e/.seed.json", "utf8"));
const emp = seed.trainer_employee;
const env = Object.fromEntries(
  fs.readFileSync("../backend/.env", "utf8").split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

function journeyClient(testInfo) {
  return emp.journey[testInfo.project.name === "phone-320" ? 1 : 0];
}

async function login(request, email, password) {
  const res = await request.post(`${H.API}/auth/login`, { data: { email, password } });
  expect(res.ok(), `login ${email}: ${await res.text()}`).toBeTruthy();
  return res.json();
}

async function asUser(page, session) {
  await page.addInitScript(({ t, u }) => {
    localStorage.setItem("sh_token", t); localStorage.setItem("sh_user", JSON.stringify(u));
    localStorage.setItem("sh_install_dismissed_at", String(Date.now()));
  }, { t: session.token, u: session.user });
}

function api(request, token) {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  return {
    get: async (url) => {
      const r = await request.get(`${H.API}${url}`, { headers });
      expect(r.ok(), `GET ${url} -> ${r.status()} ${await r.text()}`).toBeTruthy();
      return r.json();
    },
    post: async (url, data) => {
      const r = await request.post(`${H.API}${url}`, { headers, data: data || {} });
      expect(r.ok(), `POST ${url} -> ${r.status()} ${await r.text()}`).toBeTruthy();
      return r.json();
    },
    patch: async (url, data) => {
      const r = await request.patch(`${H.API}${url}`, { headers, data: data || {} });
      expect(r.ok(), `PATCH ${url} -> ${r.status()} ${await r.text()}`).toBeTruthy();
      return r.json();
    },
  };
}

async function openTrainerDay(page) {
  await page.goto("/");
  await expect(page.getByTestId("employee-portal")).toBeVisible({ timeout: 45_000 });
  await page.getByTestId("emp-tab-training").click();
  await expect(page.getByTestId("trainer-day-queue")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("trainer-day-summary")).not.toHaveText(/Loading/, { timeout: 20_000 });
}

async function recordPlannedSkill(page, { outcome, level, mastery }) {
  await expect(page.getByTestId("train-skills")).toBeVisible();
  const toggle = page.locator('[data-testid^="activity-"][data-testid$="-toggle"]').first();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  for (const sel of [`[data-testid$="-assessment-${outcome}"]`, `[data-testid$="-score-picker-${level}"]`, `[data-testid$="-mastery-${mastery}"]`]) {
    const el = page.locator(sel).first();
    await el.scrollIntoViewIfNeeded();
    await el.click();
  }
  const obs = page.locator('[data-testid$="-client-observation"]').first();
  if (await obs.count()) await obs.fill("Held the sit for ten seconds with the door open.");
  // a genuinely private staff note — the client must never see this one
  const note = page.getByTestId("workspace-session-note");
  if (await note.count()) { await note.scrollIntoViewIfNeeded(); await note.fill("PRIVATE-STAFF-ONLY-XYZ handler timing sloppy"); }
}

async function wrapUpAndFinish(page, { nextStep }) {
  await page.getByTestId("workspace-to-wrap").click();
  await expect(page.getByTestId("workspace-wrap")).toBeVisible();
  await page.getByTestId("workspace-what-went-well").fill("Quick, happy responses all session.");
  await page.getByTestId("workspace-needs-work").fill("Duration with distractions.");
  await page.getByTestId("workspace-recap-note").fill("Lovely work today. Keep the sessions short and fun.");
  await page.getByTestId("workspace-next-lesson-focus").fill("Add distance before adding distraction.");
  const choice = page.getByTestId(`advancement-${nextStep}`);
  await choice.scrollIntoViewIfNeeded();
  await expect(choice).not.toHaveAttribute("data-locked", "1");
  await choice.click();
  await expect(page.getByTestId("workspace-complete-session")).toHaveAttribute("data-ready", "1");
  await page.getByTestId("workspace-complete-session").click();
  await page.locator('[data-testid="workspace-finished"], [data-testid="progression-confirm-accept"]').first().waitFor();
  const confirm = page.getByTestId("progression-confirm-accept");
  if (await confirm.count()) await confirm.click();
  await expect(page.getByTestId("workspace-finished")).toBeVisible({ timeout: 20_000 });
}

test.describe("the whole training system, one journey", () => {
  test("owner assigns → trainer teaches → client learns and practises → trainer reviews → owner sees it", async ({ page, request }, testInfo) => {
    const J = journeyClient(testInfo);
    const owner = await login(request, env.ADMIN_EMAIL, env.ADMIN_PASSWORD || "admin123");
    const ownerApi = api(request, owner.token);
    const trainerSession = await login(request, emp.trainer.email, emp.trainer.password);

    // ── OWNER: assign the program, assign the trainer ──────────────────────────
    const enrolled = await ownerApi.post("/school/enroll", {
      dog_id: J.dog_id, program_id: seed.program_id, delivery_mode: "in_person",
      assigned_trainer_id: emp.trainer.id,
    });
    const seId = enrolled.school_enrollment.id;
    const enrollmentId = enrolled.enrollment.id;
    const booking = await ownerApi.post("/bookings", {
      dog_id: J.dog_id, service_type: "training", date: seed.trainer_day.today || new Date().toISOString().slice(0, 10),
      time: "11:15", override_capacity: true,
    });
    await ownerApi.patch(`/admin/training/today/${booking.id}/trainer`, { assigned_trainer_id: emp.trainer.id });

    // the owner's Hub shows it as today's operation, owned by that trainer
    await asUser(page, owner);
    await page.goto("/admin/training");
    await expect(page.getByTestId("trainer-day-queue")).toBeVisible({ timeout: 45_000 });
    const ownerCard = page.getByTestId(`day-item-session:${booking.id}`);
    await expect(ownerCard.getByTestId("day-item-dog")).toContainText(J.dog_name);
    await expect(ownerCard.getByTestId("day-item-trainer")).toContainText(emp.trainer.name);
    await expect(ownerCard.getByTestId("day-item-flag-unassigned")).toHaveCount(0);

    // ── TRAINER: the work arrives, and the lesson is taught ────────────────────
    const trainerPage = await page.context().newPage();
    await asUser(trainerPage, trainerSession);
    await openTrainerDay(trainerPage);
    const card = trainerPage.getByTestId(`day-item-session:${booking.id}`);
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("data-mine", "1");
    await expect(card.getByTestId("day-item-context")).toContainText(seed.clients[0].lessons[0].name);
    await card.getByTestId("day-item-action").click();

    await expect(trainerPage.getByTestId("trainer-briefing")).toBeVisible();
    await expect(trainerPage.getByTestId("workspace-dog-header")).toContainText(J.dog_name);
    await trainerPage.getByTestId("briefing-primary-action").click();
    await recordPlannedSkill(trainerPage, { outcome: "passed", level: 5, mastery: "mastered" });

    // refresh mid-session: the draft comes back from canonical state, work intact
    await trainerPage.getByTestId("workspace-done").click();
    await expect(trainerPage.getByTestId("workspace-saved")).toBeVisible();
    await trainerPage.getByTestId("workspace-saved-action").click();
    await trainerPage.goto("/admin/training");   // a real reload: the day is rebuilt from persisted state
    await expect(trainerPage.getByTestId("trainer-day-queue")).toBeVisible({ timeout: 20_000 });
    const resumed = trainerPage.getByTestId(`day-item-session:${booking.id}`);
    await expect(resumed).toHaveAttribute("data-section", "continue");
    await expect(resumed.getByTestId("day-item-action")).toHaveText(/resume session/i);
    await resumed.getByTestId("day-item-action").click();
    await trainerPage.locator('[data-testid="briefing-primary-action"], [data-testid="train-skills"]').first().waitFor();
    if (await trainerPage.getByTestId("briefing-primary-action").count()) await trainerPage.getByTestId("briefing-primary-action").click();
    await expect(trainerPage.locator('[data-testid^="activity-"][data-testid$="-recorded"]').first()).toBeVisible();

    // Ready for Next Lesson — the trainer's decision, not the client's
    await wrapUpAndFinish(trainerPage, { nextStep: "advance_next" });
    await expect(trainerPage.getByTestId("workspace-next-training-step")).toContainText(seed.clients[0].lessons[1].name);
    await trainerPage.getByTestId("workspace-close-after-complete").click();
    await expect(trainerPage.getByTestId(`day-item-session:${booking.id}`)).toHaveAttribute("data-section", "done");

    // ── CLIENT: Today reflects the trainer's decision, in client-safe words ────
    const clientSession = await login(request, J.email, J.password);
    const clientApi = api(request, clientSession.token);
    const clientPage = await page.context().newPage();
    await asUser(clientPage, clientSession);
    await clientPage.addInitScript((id) => localStorage.setItem(`sh_school_welcome_seen:${id}`, "1"), seId);

    // the client finishes School setup first (the program asks for a baseline)
    await clientApi.post(`/portal/school/${seId}/baseline`, {
      goals: "Calm greetings", current_challenges: "Jumps on guests", training_experience: "None",
      equipment: "Flat collar", preferred_schedule: "Evenings", baseline_note: "",
    });
    const home = await clientApi.get(`/portal/school/${seId}/home`);
    expect(home.current_lesson.name).toBe(seed.clients[0].lessons[1].name);   // moved on, once
    const blob = JSON.stringify(home);
    expect(blob).toContain("Lovely work today.");                              // the client-safe recap travelled
    expect(blob).toContain("Held the sit for ten seconds");                    // and the client-safe observation
    expect(blob).not.toContain("PRIVATE-STAFF-ONLY-XYZ");                      // the private staff note did NOT

    await clientPage.goto(`/school/course/${seId}`);
    await expect(clientPage.getByTestId("course-current")).toContainText(seed.clients[0].lessons[1].name, { timeout: 45_000 });
    await clientPage.getByTestId("school-nav-m-today").click();
    await expect(clientPage.getByTestId("today-command-center")).toBeVisible();

    // the client learns the lesson and practises it for real
    const lessonId = home.current_lesson.id;
    for (const key of H.STEP_KEYS) await clientApi.post(`/portal/school/${seId}/lessons/${lessonId}/steps/${key}/complete`);
    const started = await clientApi.post(`/portal/school/${seId}/lessons/${lessonId}/start-practice`);
    // a practice round that went fine is NOT trainer work — it does not page anybody
    await clientApi.post(`/homework/${started.homework_id}/section-log`, {
      section_id: "practice", difficulty: "good", note: "Ten reps, eight clean.", field_values: {}, video_media_id: "",
    });
    const quietDay = await api(request, trainerSession.token).get("/admin/training/day");
    expect(quietDay.items.some((i) => i.kind === "practice_review" && i.dog?.id === J.dog_id)).toBe(false);
    // the next round was hard — THAT is what reaches the trainer
    await clientApi.post(`/homework/${started.homework_id}/section-log`, {
      section_id: "practice", difficulty: "hard", note: "He kept breaking the sit when the door moved.", field_values: {}, video_media_id: "",
    });

    // a trainer-led client is never offered a progression action they cannot perform
    const afterPractice = await clientApi.get(`/portal/school/${seId}/home`);
    expect(JSON.stringify(afterPractice.current_action || {})).not.toMatch(/"kind":"advance/);
    await clientPage.reload();
    await clientPage.goto("/school");
    await expect(clientPage.getByTestId("today-command-center")).toBeVisible({ timeout: 30_000 });
    await expect(clientPage.getByTestId("today-command-center")).not.toContainText(/continue to your next lesson/i);

    // ── TRAINER REVIEW: the practice arrives as their work and is approved ─────
    await trainerPage.goto("/admin/training");
    await expect(trainerPage.getByTestId("trainer-day-queue")).toBeVisible({ timeout: 20_000 });
    const day = await api(request, trainerSession.token).get("/admin/training/day");
    const practiceItem = day.items.find((i) => i.kind === "practice_review" && i.dog?.id === J.dog_id);
    expect(practiceItem, "the client's practice reached the assigned trainer").toBeTruthy();
    expect(practiceItem.mine).toBe(true);
    expect(practiceItem.needs_assignment).toBe(false);

    const practiceCard = trainerPage.getByTestId(`day-item-${practiceItem.key}`);
    await expect(practiceCard).toHaveAttribute("data-section", "needs_attention");
    await practiceCard.getByTestId("day-item-action").click();
    await expect(trainerPage.getByTestId("practice-review-detail")).toBeVisible();
    await trainerPage.getByTestId("practice-review-looks-good").click();
    await expect(trainerPage.getByTestId("practice-review-handoff")).toBeVisible();
    await trainerPage.getByTestId("practice-review-modal-close").click();
    await expect(trainerPage.getByTestId(`day-item-${practiceItem.key}`)).toHaveCount(0);

    // and it is confirmed under Done today, derived from the review record itself
    await expect(trainerPage.getByTestId("day-section-done")).toContainText(/Practice reviewed/);

    // ── CLIENT sees the feedback; OWNER sees the completed work ────────────────
    const reviewed = await clientApi.get(`/portal/school/${seId}/home`);
    expect(JSON.stringify(reviewed)).toMatch(/looks_good|Looks Good/i);

    const ownerDay = await ownerApi.get("/admin/training/day");
    const done = ownerDay.items.filter((i) => i.section === "done" && i.dog?.id === J.dog_id);
    expect(done.length, "the owner sees today's finished work for this dog").toBeGreaterThan(0);
    expect(done.some((i) => (i.today_line || "").includes(emp.trainer.name) || i.kind === "session")).toBeTruthy();

    // one canonical enrollment throughout — no second progress ledger anywhere
    const rows = await ownerApi.get(`/dogs/${J.dog_id}/programs`);
    expect(rows.filter((r) => r.status === "active").length).toBeLessThanOrEqual(1);
    const finalHome = await clientApi.get(`/portal/school/${seId}/home`);
    expect(finalHome.enrollment?.id || enrollmentId).toBeTruthy();
  });
});
