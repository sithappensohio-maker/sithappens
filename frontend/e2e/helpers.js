// Shared helpers for the client-School mobile suite.
//
// Every spec owns ONE seeded client (see backend/e2e_school_seed.py) so specs
// never share state, and reaches the state it needs through the same client
// API calls the app makes — then drives the real UI from there.
const fs = require("fs");
const path = require("path");
const { expect } = require("@playwright/test");

const BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT || 8021);
const API = `http://127.0.0.1:${BACKEND_PORT}/api`;
const STEP_KEYS = ["learn", "get_ready", "train", "watch_for", "know_got_it"];

let seedCache = null;
function seed() {
  if (!seedCache) seedCache = JSON.parse(fs.readFileSync(path.join(__dirname, ".seed.json"), "utf8"));
  return seedCache;
}

/** Client N for this spec — the project (390 / 320) gets its own so the two
 *  projects can run back to back against one seed. */
function clientFor(testInfo, slot) {
  const s = seed();
  // Each project (390 / 320) owns half of the pool: a client's state is only
  // ever advanced by one spec, so the same spec on the other viewport must
  // start from a client nobody has touched.
  const projectOffset = testInfo.project.name === "phone-320" ? Math.floor(s.clients.length / 2) : 0;
  const c = s.clients[projectOffset + slot];
  if (!c) throw new Error(`Seed has no client for slot ${slot} in ${testInfo.project.name} (seed more with E2E_CLIENTS)`);
  return c;
}

async function apiLoginFull(request, client) {
  const res = await request.post(`${API}/auth/login`, { data: { email: client.email, password: client.password } });
  expect(res.ok(), `login ${client.email}`).toBeTruthy();
  return res.json();
}
async function apiLogin(request, client) {
  return (await apiLoginFull(request, client)).token;
}

function apiFor(request, token) {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const post = async (url, data) => {
    const res = await request.post(`${API}${url}`, { headers, data: data || {} });
    if (!res.ok()) throw new Error(`POST ${url} -> ${res.status()} ${await res.text()}`);
    return res.json();
  };
  const get = async (url) => {
    const res = await request.get(`${API}${url}`, { headers });
    if (!res.ok()) throw new Error(`GET ${url} -> ${res.status()} ${await res.text()}`);
    return res.json();
  };
  return {
    get, post,
    finishSetup: (eid) => post(`/portal/school/${eid}/baseline`, {
      goals: "Come when called and stop jumping on guests", current_challenges: "Pulls on leash",
      training_experience: "Puppy class", equipment: "Flat collar and 6 ft leash", preferred_schedule: "Evenings", baseline_note: "",
    }),
    completeParts: async (eid, lessonId, count = STEP_KEYS.length) => {
      for (const key of STEP_KEYS.slice(0, count)) await post(`/portal/school/${eid}/lessons/${lessonId}/steps/${key}/complete`);
    },
    practice: async (eid, lessonId) => {
      const sp = await post(`/portal/school/${eid}/lessons/${lessonId}/start-practice`);
      await post(`/homework/${sp.homework_id}/section-log`, { section_id: "practice", difficulty: "good", note: "Ten reps, eight clean. Went well.", field_values: {} });
      return sp.homework_id;
    },
    advance: (eid) => post(`/portal/school/${eid}/advance`),
    home: (eid) => get(`/portal/school/${eid}/home`),
    passQuiz: async (eid, moduleId) => {
      const quiz = await get(`/portal/school/${eid}/modules/${moduleId}/quiz`);
      // The seed's quiz keys the correct answer as the first option of each question.
      const answers = quiz.questions.map((q) => ({ question_id: q.id, selected_option_id: q.options[0].id }));
      return post(`/portal/school/${eid}/modules/${moduleId}/quiz/submit`, { answers, idempotency_key: `e2e-${Date.now()}-${Math.random()}` });
    },
    submitCheckpoint: (eid, lessonId) => post(`/portal/school/${eid}/lessons/${lessonId}/checkpoint`, {
      video: "data:video/mp4;base64," + Buffer.from("x".repeat(1000)).toString("base64"), filename: "clip.mp4", note: "here is my clip",
    }),
  };
}

/** Log the client in (token into localStorage before any page script runs). */
async function loginInBrowser(page, request, client, { keepInstallPrompt = false } = {}) {
  const j = await apiLoginFull(request, client);
  await page.addInitScript(({ t, u, keep }) => {
    try {
      localStorage.setItem("sh_token", t); localStorage.setItem("sh_user", JSON.stringify(u));
      // The "add to home screen" banner (InstallPrompt.jsx) is eligible on
      // iPhone user agents. Specs about it keep it; every other spec treats it
      // as already dismissed by the customer.
      if (!keep) localStorage.setItem("sh_install_dismissed_at", String(Date.now()));
    } catch { /* ignore */ }
  }, { t: j.token, u: j.user || { role: "client", email: client.email }, keep: keepInstallPrompt });
  return j.token;
}

/** The element under the centre of `locator` is the element itself (nothing
 *  fixed is covering it), so a real tap would reach it. */
async function expectNotCovered(page, locator, label = "element") {
  await locator.scrollIntoViewIfNeeded();
  await expect.poll(() => locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!hit) return "nothing at point";
    return el === hit || el.contains(hit) ? "clear" : `covered by ${hit.getAttribute("data-testid") || hit.tagName}`;
  }), { timeout: 8_000, message: `${label} is not covered` }).toBe("clear");
}

/** Skip the one-time Program Welcome for specs that are not about it. */
async function markWelcomeSeen(page, client) {
  await page.addInitScript(({ eid }) => { try { localStorage.setItem(`sh_school_welcome_seen:${eid}`, "1"); } catch { /* ignore */ } }, { eid: client.enrollment_id });
}

/** The School usable window: under the header, above the phone tab bar. */
async function usableWindow(page) {
  return page.evaluate(() => {
    const h = document.querySelector('[data-testid="school-app"] > header');
    const n = document.querySelector('[data-testid="school-nav-mobile"]');
    const top = h ? h.getBoundingClientRect().bottom : 0;
    let bottom = window.innerHeight;
    if (n) {
      const r = n.getBoundingClientRect();
      if (r.height > 0 && getComputedStyle(n).display !== "none") bottom = r.top;
    }
    return { top, bottom, scrollTop: (document.querySelector("[data-scroll-root]") || { scrollTop: 0 }).scrollTop };
  });
}

/** Optional screenshot at a named moment (E2E_SHOTS=1), for the human report. */
async function snap(page, name) {
  if (!process.env.E2E_SHOTS) return;
  try {
    const vp = page.viewportSize() || {};
    const dir = path.join(__dirname, "results", "shots");
    fs.mkdirSync(dir, { recursive: true });
    await page.waitForTimeout(350); // let a smooth scroll finish before the picture
    await page.screenshot({ path: path.join(dir, `${vp.width}x${vp.height}-${name}.jpg`), type: "jpeg", quality: 72 });
  } catch { /* never fail a test for a picture */ }
}

/** Every successful viewport assertion is also recorded (results/measurements.ndjson)
 *  so a run doubles as a measured report of where things landed. */
function recordMeasurement(page, entry) {
  try {
    const dir = path.join(__dirname, "results");
    fs.mkdirSync(dir, { recursive: true });
    const vp = page.viewportSize() || {};
    fs.appendFileSync(path.join(dir, "measurements.ndjson"), JSON.stringify({ viewport: `${vp.width}x${vp.height}`, url: page.url().replace(/^https?:\/\/[^/]+/, ""), ...entry }) + "\n");
  } catch { /* measurement logging must never fail a test */ }
}

/** Polls until the element is entirely inside the usable window (so a smooth
 *  scroll has finished), or fails with where it actually is. */
async function expectInUsable(page, locator, label = "element") {
  let last = null;
  await expect.poll(async () => {
    const box = await locator.boundingBox();
    if (!box) return "not rendered";
    const u = await usableWindow(page);
    last = { label, y: Math.round(box.y), h: Math.round(box.height), usableTop: Math.round(u.top), usableBottom: Math.round(u.bottom), scrollTop: Math.round(u.scrollTop) };
    const ok = box.y >= u.top - 1 && box.y + box.height <= u.bottom + 1;
    return ok ? "in-view" : `${label}: y=${last.y} h=${last.h} usable=${last.usableTop}..${last.usableBottom}`;
  }, { timeout: 10_000, message: `${label} inside the usable viewport` }).toBe("in-view");
  if (last) recordMeasurement(page, { check: "in-usable", ...last });
}

/** The top of the element sits just under the header (a "start" reveal). */
async function expectAtTop(page, locator, label = "element", maxOffset = 48) {
  let last = null;
  await expect.poll(async () => {
    const box = await locator.boundingBox();
    if (!box) return "not rendered";
    const u = await usableWindow(page);
    const off = box.y - u.top;
    last = { label, y: Math.round(box.y), h: Math.round(box.height), offsetUnderHeader: Math.round(off), usableTop: Math.round(u.top), usableBottom: Math.round(u.bottom), scrollTop: Math.round(u.scrollTop) };
    return off >= -2 && off <= maxOffset ? "at-top" : `${label}: top is ${Math.round(off)}px under the header`;
  }, { timeout: 10_000, message: `${label} lands under the header` }).toBe("at-top");
  if (last) recordMeasurement(page, { check: "at-top", ...last });
}

async function scrollRootTop(page) {
  return page.evaluate(() => (document.querySelector("[data-scroll-root]") || { scrollTop: -1 }).scrollTop);
}

/** Human scrolling: wheel the School container down by `px`. */
async function humanScroll(page, px) {
  const u = await usableWindow(page);
  await page.mouse.move(150, (u.top + u.bottom) / 2);
  await page.mouse.wheel(0, px);
  await page.waitForTimeout(150);
}

function lessonUrl(client, lessonId) {
  return `/school/course/${client.enrollment_id}/lesson/${lessonId}`;
}

/** Drive a client through lessons 1–3 (including the module quiz) so lesson
 *  4 — the trainer-checkpoint lesson — is current. Optionally practise it. */
async function reachLesson4(api, client, { practiseLesson4 = false } = {}) {
  const eid = client.enrollment_id;
  const [l1, l2, l3, l4] = client.lessons.map((l) => l.id);
  await api.finishSetup(eid);
  await api.completeParts(eid, l1); await api.practice(eid, l1); await api.advance(eid);
  await api.completeParts(eid, l2); await api.practice(eid, l2);
  await api.passQuiz(eid, client.module_ids[0]); // passing the module quiz advances
  await api.completeParts(eid, l3); await api.practice(eid, l3); await api.advance(eid);
  const home = await api.home(eid);
  expect(home.current_lesson.id).toBe(l4);
  if (practiseLesson4) { await api.completeParts(eid, l4); await api.practice(eid, l4); }
  return l4;
}

module.exports = { API, STEP_KEYS, seed, clientFor, apiLogin, apiFor, loginInBrowser, markWelcomeSeen, usableWindow, expectInUsable, expectAtTop, expectNotCovered, scrollRootTop, humanScroll, lessonUrl, reachLesson4, snap };
