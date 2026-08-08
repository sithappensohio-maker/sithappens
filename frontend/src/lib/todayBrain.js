import { api } from "./api";
import { toast } from "sonner";

/* Shared /admin/today-brain CTA-routing — extracted from the copy that used
 * to live separately in ActionCenter.jsx and Dashboard.jsx's TodaysBrainTile
 * so every consumer (Action Center, Dashboard, Today) opens the exact same
 * destination for a given item instead of three slightly-different copies.
 * No new CTA types, no new business logic — same four cases as before.
 */
export function runTodayBrainCTA(item, { onJumpToDog, onJumpToClient, onNavigate }) {
  const cta = item?.cta || {};
  if (cta.type === "open_dog" && cta.id) onJumpToDog?.(cta.id);
  else if (cta.type === "open_client" && cta.id) onJumpToClient?.(cta.id);
  else if (cta.type === "open_screen" && cta.screen) onNavigate?.(cta.screen);
  else if (cta.type === "send_monday_digest") {
    api.post("/admin/homework/send-monday-digest")
      .then(() => toast.success("Monday digest sent — check your admin email."))
      .catch((e) => toast.error("Failed to send: " + (e.response?.data?.detail || e.message)));
  }
}
