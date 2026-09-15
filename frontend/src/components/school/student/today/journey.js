/* Training Experience Clarity Pass — Stage 2 helpers for the client
 * LAST → NOW → NEXT rail on Today. Everything rendered comes from
 * `home.journey` (portal_school_home), which is derived server-side for the
 * SELECTED dog + program only; these helpers only phrase dates and decide
 * which secondary Today cards would merely repeat the rail. */
import { isRequiredPracticeSatisfied } from "../../../../lib/practiceState";

const DAY_MS = 24 * 60 * 60 * 1000;

/** "Today" / "Yesterday" / "3 days ago" / "Sep 12" for a server timestamp. */
export function journeyWhen(iso, now = new Date()) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / DAY_MS);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** "Mon, Jun 1 · 10:00 AM" for a booking's date/time; the date alone when
 *  there is no time. Pending requests are labelled so nothing reads as
 *  confirmed when it is not. */
export function appointmentLabel(appt) {
  if (!appt?.date) return "";
  let out = appt.date;
  try {
    out = new Date(`${appt.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  } catch { /* keep raw */ }
  if (appt.time) {
    const [h, m] = String(appt.time).split(":").map((n) => parseInt(n, 10));
    if (!Number.isNaN(h)) {
      const suffix = h >= 12 ? "PM" : "AM";
      const hh = ((h + 11) % 12) + 1;
      out += ` · ${hh}:${String(Number.isNaN(m) ? 0 : m).padStart(2, "0")} ${suffix}`;
    }
  }
  if (appt.status === "pending") out += " (requested)";
  return out;
}

/** The Today practice card would show exactly the row NOW already points at —
 *  so it is a repeat, not extra information. Any other open row (a second
 *  assignment, a trainer's general row) still earns the card. */
export function practiceCoveredByJourney(home) {
  const nowPractice = home?.journey?.now?.practice;
  if (!nowPractice?.id) return false;
  const open = (home?.active_practice || []).filter((p) => p && p.status !== "completed" && !isRequiredPracticeSatisfied(p));
  if (open.length === 0) return home.journey.now.kind === "done_today";
  return open.length === 1 && open[0].id === nowPractice.id;
}

/** Stage 3 — the post-lesson recap is told inside the rail. It is dominant
 *  ("prominent") until the client starts the Practice that session assigned
 *  (server-derived); afterwards it folds into the LAST step behind a
 *  "Show recap" disclosure. Returns null when there is no trainer session. */
export function recapMode(journey) {
  const recap = journey?.recap;
  if (!recap) return null;
  return recap.prominence === "prominent" ? "prominent" : "reduced";
}

/** Plain heading for the recap: "Today's training recap" when the session
 *  was today, otherwise "Your last lesson recap". */
export function recapHeading(recap, now = new Date()) {
  if (!recap?.session_at) return "Your last lesson recap";
  return journeyWhen(recap.session_at, now) === "Today" ? "Today's training recap" : "Your last lesson recap";
}

/** True when the Today practice card would only repeat the recap's Practice. */
export function practiceCoveredByRecap(home) {
  const rp = home?.journey?.recap?.practice;
  if (!rp?.id || home.journey.recap.prominence !== "prominent") return false;
  const open = (home?.active_practice || []).filter((p) => p && p.status !== "completed" && !isRequiredPracticeSatisfied(p));
  return open.length <= 1 && (open.length === 0 || open[0].id === rp.id);
}

export const JOURNEY_STEP_META = {
  last: { label: "Last", icon: "fa-clock-rotate-left" },
  now: { label: "Now", icon: "fa-location-arrow" },
  next: { label: "Next", icon: "fa-flag-checkered" },
};
