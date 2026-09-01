/* Student School — shared presentation helpers for the client-facing
 * School. The same UI serves in-person, online, and hybrid enrollments. Keeps
 * greeting/label/icon logic out of the components so the
 * command-center screens stay small and consistent. The backend
 * (/portal/school/{id}/home) remains the source of truth for current_action;
 * this only maps its type to presentation. */

export function greeting(name) {
  const h = new Date().getHours();
  const part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const first = (name || "").trim().split(/\s+/)[0] || "";
  return first ? `${part}, ${first}` : part;
}

/* Presentation for each backend current_action.type. accent names map to the
 * premium token palette (lime/cyan/orange/amber/purple/neutral). */
export const ACTION_META = {
  practice:         { icon: "fa-dumbbell",           accent: "lime" },
  lesson:           { icon: "fa-book-open",           accent: "cyan" },
  submit_checkpoint:{ icon: "fa-clipboard-check",     accent: "amber" },
  remediation:      { icon: "fa-rotate-left",         accent: "amber" },
  trainer_assist:   { icon: "fa-hand-holding-heart",  accent: "purple" },
  trainer_guided:   { icon: "fa-person-chalkboard",   accent: "cyan" },
  awaiting_review:  { icon: "fa-hourglass-half",      accent: "cyan" },
  advance:          { icon: "fa-arrow-right",         accent: "lime" },
  course_complete:  { icon: "fa-graduation-cap",      accent: "lime" },
  access_expired:   { icon: "fa-lock",                accent: "neutral" },
  setup_required:   { icon: "fa-wrench",              accent: "neutral" },
  onboarding:       { icon: "fa-clipboard-user",      accent: "cyan" },
  course_paused:    { icon: "fa-pause",               accent: "neutral" },
  start:            { icon: "fa-play",                accent: "lime" },
};

export function deliveryLabel(mode) {
  if (mode === "in_person" || mode === "trainer_led") return "In Person";
  if (mode === "hybrid") return "Hybrid";
  return "Online";
}

export function deliveryIcon(mode) {
  if (mode === "in_person" || mode === "trainer_led") return "fa-person-chalkboard";
  if (mode === "hybrid") return "fa-shuffle";
  return "fa-laptop";
}

export function actionMeta(type) {
  return ACTION_META[type] || { icon: "fa-paw", accent: "lime" };
}

/* Is the current action one the student acts on now vs. a "caught up / their
 * trainer's turn" state? Used to soften the hero when nothing is required. */
export function isCaughtUp(type) {
  return type === "awaiting_review" || type === "course_complete" || type === "access_expired" || type === "course_paused";
}

/* Student School routes (Shop-style history.pushState, no react-router).
 * /school · /school/course/:enrollmentId · /school/course/:eid/lesson/:lessonId
 * /school/today · /school/progress · /school/feedback */
/* Client School views. "today" is the single default landing page; "home" is
 * retained ONLY as a backward-compatible alias for existing links/bookmarks
 * and is normalised to "today" by parseSchoolPath, so no client-facing
 * navigation offers both. */
export const SCHOOL_VIEWS = ["today", "course", "practice", "progress", "feedback", "resources", "search", "lesson_history", "home"];
export const SCHOOL_DEFAULT_VIEW = "today";

export function parseSchoolPath(pathname) {
  const m = /^\/school(?:\/([^/?#]+))?(?:\/([^/?#]+))?(?:\/([^/?#]+))?(?:\/([^/?#]+))?/.exec(pathname || "");
  if (!m) return { view: SCHOOL_DEFAULT_VIEW, enrollmentId: null, lessonId: null };
  const seg = m[1];
  if (!seg) return { view: SCHOOL_DEFAULT_VIEW, enrollmentId: null, lessonId: null };
  if (seg === "course") {
    if (m[3] === "lesson" && m[4]) return { view: "lesson", enrollmentId: m[2] || null, lessonId: m[4] };
    if (m[3] === "welcome") return { view: "welcome", enrollmentId: m[2] || null, lessonId: null };
    return { view: "course", enrollmentId: m[2] || null, lessonId: null };
  }
  // "home" is a legacy alias — normalise it so the app only ever renders,
  // and only ever highlights, the single Today destination.
  if (seg === "home") return { view: SCHOOL_DEFAULT_VIEW, enrollmentId: null, lessonId: null };
  if (SCHOOL_VIEWS.includes(seg)) return { view: seg, enrollmentId: null, lessonId: null };
  return { view: SCHOOL_DEFAULT_VIEW, enrollmentId: null, lessonId: null };
}

export function schoolPathFor(view, enrollmentId, lessonId) {
  if (view === "home" || view === SCHOOL_DEFAULT_VIEW) return "/school";
  if (view === "lesson" && enrollmentId && lessonId) return `/school/course/${enrollmentId}/lesson/${lessonId}`;
  if (view === "welcome" && enrollmentId) return `/school/course/${enrollmentId}/welcome`;
  if (view === "course" && enrollmentId) return `/school/course/${enrollmentId}`;
  return `/school/${view}`;
}

/* Program Welcome — first-visit flag, per enrollment. localStorage (not the
 * session-scoped convention) so the welcome page auto-opens once per device,
 * not once per tab; when storage is unavailable we report "seen" so a broken
 * store can never trap the client in a welcome-redirect loop. */
const welcomeSeenKey = (enrollmentId) => `sh_school_welcome_seen:${enrollmentId}`;
export function welcomeSeen(enrollmentId) {
  try { return !!localStorage.getItem(welcomeSeenKey(enrollmentId)); } catch { return true; }
}
export function markWelcomeSeen(enrollmentId) {
  try { localStorage.setItem(welcomeSeenKey(enrollmentId), "1"); } catch { /* ignore */ }
}

/* sessionStorage key for the selected enrollment (per the app's session-scoped
 * selection convention). */
export const SELECTED_ENROLLMENT_KEY = "sh_school_enrollment";
