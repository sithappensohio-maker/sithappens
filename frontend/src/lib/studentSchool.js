/* Student School (Phase 2A) — shared presentation helpers for the client-facing
 * Online School. Keeps greeting/label/icon logic out of the components so the
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
  awaiting_review:  { icon: "fa-hourglass-half",      accent: "cyan" },
  advance:          { icon: "fa-arrow-right",         accent: "lime" },
  course_complete:  { icon: "fa-graduation-cap",      accent: "lime" },
  access_expired:   { icon: "fa-lock",                accent: "neutral" },
  setup_required:   { icon: "fa-wrench",              accent: "neutral" },
  start:            { icon: "fa-play",                accent: "lime" },
};

export function actionMeta(type) {
  return ACTION_META[type] || { icon: "fa-paw", accent: "lime" };
}

/* Is the current action one the student acts on now vs. a "caught up / their
 * trainer's turn" state? Used to soften the hero when nothing is required. */
export function isCaughtUp(type) {
  return type === "awaiting_review" || type === "course_complete" || type === "access_expired";
}

/* Student School routes (Shop-style history.pushState, no react-router). */
export const SCHOOL_VIEWS = ["home", "course", "today", "progress", "feedback"];

export function parseSchoolPath(pathname) {
  const m = /^\/school(?:\/([^/?#]+))?(?:\/([^/?#]+))?/.exec(pathname || "");
  if (!m) return { view: "home", enrollmentId: null };
  const seg = m[1];
  if (!seg) return { view: "home", enrollmentId: null };
  if (seg === "course") return { view: "course", enrollmentId: m[2] || null };
  if (SCHOOL_VIEWS.includes(seg)) return { view: seg, enrollmentId: null };
  return { view: "home", enrollmentId: null };
}

export function schoolPathFor(view, enrollmentId) {
  if (view === "home") return "/school";
  if (view === "course" && enrollmentId) return `/school/course/${enrollmentId}`;
  return `/school/${view}`;
}

/* sessionStorage key for the selected enrollment (per the app's session-scoped
 * selection convention). */
export const SELECTED_ENROLLMENT_KEY = "sh_school_enrollment";
