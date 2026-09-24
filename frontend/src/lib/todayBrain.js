import { api } from "./api";
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
const TODAY_SECTION_BY_KIND = {
  vaccine_upload_review: "today-pending-vax-reviews",
};

/** Scroll to a section once it has rendered (it loads after navigation). */
export function scrollToTodaySection(testid, { tries = 25, interval = 120 } = {}) {
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
  if (section) { onNavigate?.("today"); scrollToTodaySection(section); return; }
  if (cta.type === "open_dog" && cta.id) onJumpToDog?.(cta.id);
  else if (cta.type === "open_client" && cta.id) onJumpToClient?.(cta.id);
  else if (cta.type === "open_screen" && cta.screen) onNavigate?.(cta.screen);
  else if (cta.type === "send_monday_digest") {
    api.post("/admin/homework/send-monday-digest")
      .then(() => toast.success("Monday digest sent — check your admin email."))
      .catch((e) => toast.error("Failed to send: " + (e.response?.data?.detail || e.message)));
  }
}
