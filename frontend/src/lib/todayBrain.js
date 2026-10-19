import { api, formatErr } from "./api";
import { toast } from "sonner";

/* Shared /admin/today-brain CTA-routing — extracted from the copy that used
 * to live separately in ActionCenter.jsx and Dashboard.jsx's TodaysBrainTile
 * so every consumer (Action Center, Dashboard, Today) opens the exact same
 * destination for a given item instead of three slightly-different copies.
 * No new CTA types, no new business logic — same four cases as before.
 */
// Where on the Today screen an item's work actually gets done. Its CTA only
// says "the Today screen" (legacy id "dashboard"), and from Today itself that
// navigated to the page already open — the Open button looked dead, and the
// Approve buttons sat unseen further down the page.
// Audit #44: the other items whose work sits on Today go to their box too.
const TODAY_SECTION_BY_KIND = {
  vaccine_upload_review: "today-pending-vax-reviews",
  no_checkin: "today-checkin-board-wrap",
  help_request: "dashboard-help-requests",
  quote_request: "today-quote-requests",
  // ActionRow opens the stuck-bookings window itself; staff who can't resolve
  // them land on the board, where those visits show as "Missed checkout".
  stuck_checkout: "today-checkin-board-wrap",
};

/** Today's lists load once; Open asks them to fetch again, so a request that
 * arrived after the page opened is on the page to scroll to. */
export const TODAY_LISTS_REFRESH = "sh:today-lists-refresh";

/** Scroll to a section once it has rendered (it loads after navigation). */
export function scrollToTodaySection(testid, { tries = 60, interval = 120 } = {}) {
  let n = 0;
  const tick = () => {
    const el = document.querySelector(`[data-testid="${testid}"]`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.classList.add("ring-2", "ring-shSecondary");
      setTimeout(() => el.classList.remove("ring-2", "ring-shSecondary"), 2000);
      return;
    }
    if (++n < tries) setTimeout(tick, interval);
    else toast.error("Couldn't open that list — refresh the page and try again.");
  };
  tick();
}

export function runTodayBrainCTA(item, { onJumpToDog, onJumpToClient, onNavigate }) {
  const cta = item?.cta || {};
  const section = TODAY_SECTION_BY_KIND[item?.kind];
  if (section) {
    onNavigate?.("today");
    window.dispatchEvent(new Event(TODAY_LISTS_REFRESH));
    scrollToTodaySection(section);
    return;
  }
  if (cta.type === "open_dog" && cta.id) onJumpToDog?.(cta.id);
  else if (cta.type === "open_client" && cta.id) onJumpToClient?.(cta.id);
  else if (cta.type === "open_screen" && cta.screen) onNavigate?.(cta.screen);
  else if (cta.type === "send_monday_digest") {
    api.post("/admin/homework/send-monday-digest")
      .then(({ data }) => showMondayBriefResult(data))
      // formatErr reads the server's own message, never a raw Axios string
      // like "Network Error" (same trap its own docstring names, audit #92).
      .catch((e) => toast.error("Failed to send: " + formatErr(e)));
  }
}

// Tell the owner what "Send now" on the Monday brief did (audit #69). Used by the Today brain, the
// Dashboard and the Homework screen, so the three cannot disagree about what a result means.
export function showMondayBriefResult(data) {
  if (data?.sent === 1) toast.success("Monday brief sent! Check the admin email.");
  else if (data?.reason === "nothing_to_report") toast.info("Nothing to report this week — no email sent.");
  else if (data?.skipped_already_sent) toast.info("The Monday brief already went out this week.");
  else if (data?.reason === "held_quiet_hours") toast.info("Quiet Hours are on. The Monday brief will go out when they end.");
  else if (data?.reason === "email_send_failed") toast.error("Email send failed — check Resend domain verification.");
  // An unrecognized shape used to dump the raw JSON at the owner. This can
  // only mean the backend changed its response without this list being
  // updated to match — a plain message beats a wall of braces either way.
  else toast.error("Something unexpected happened sending the Monday brief — check the admin email, or try again.");
}
