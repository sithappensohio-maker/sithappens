/* Client-facing words for the server's practice summary on a Today practice
 * row (portal_school_home.active_practice):
 *   required_practice_satisfied · sessions_logged · last_session_at
 *
 * These helpers only PHRASE what the server already decided. Nothing here
 * infers whether practice happened from raw logs — that stays on the server,
 * with the same predicate School's gates use. */

/** What the row is called on School surfaces: the lesson it belongs to when the
 *  server names one, otherwise the homework's own title. */
export function practiceTitle(hw) {
  return (hw && (hw.school_lesson_name || hw.title)) || "Practice";
}

export function isRequiredPracticeSatisfied(hw) {
  return !!(hw && hw.required_practice_satisfied === true);
}

export function loggedToday(hw, now = new Date()) {
  const at = hw?.last_session_at;
  if (!at) return false;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return false;
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

export function sessionsLabel(hw) {
  const n = Number(hw?.sessions_logged) || 0;
  if (n <= 0) return "";
  return `${n} session${n === 1 ? "" : "s"} logged`;
}

/** { title, detail } for a satisfied row, e.g.
 *  "Practice logged today" / "1 session logged · Practice again any time". */
export function practiceLoggedLabel(hw, now = new Date()) {
  const title = loggedToday(hw, now) ? "Practice logged today" : "Practice logged";
  const parts = [sessionsLabel(hw), "Practice again any time"].filter(Boolean);
  return { title, detail: parts.join(" · ") };
}
