// Turning a refused booking into "what is stopping you" + "how to fix it".
//
// The server keeps `detail` a readable sentence and sends a sibling `block`
// { code, action, ...ids } (backend/domains/bookings/blocks.py — keep the
// action list in sync). Capacity refusals arrive as an object `detail`,
// which lib/api.js flattens; its original survives on `data.capacity`.

// The button offered for each fix. `null` label = no button (the sentence
// itself says what to do, e.g. "we're reviewing your certificate").
export const FIX_ACTIONS = {
  upload_vaccines:    { label: "Upload vaccine record", icon: "fa-syringe" },
  sign_waiver:        { label: "Sign the waiver", icon: "fa-file-signature" },
  sign_agreements:    { label: "Open agreements", icon: "fa-file-contract" },
  pay_balance:        { label: "View balance & pay", icon: "fa-wallet" },
  request_evaluation: { label: "Request a Meet & Greet", icon: "fa-handshake" },
  contact_us:         { label: "Message us", icon: "fa-comments" },
  pick_date:          { label: "Choose another date", icon: "fa-calendar-days" },
  pick_time:          { label: "Choose another time", icon: "fa-clock" },
  pick_service:       { label: "Choose another service", icon: "fa-list" },
  edit_addons:        { label: "Change add-ons", icon: "fa-plus-circle" },
  refresh:            { label: "Refresh the page", icon: "fa-rotate-right" },
  retry:              { label: null },
  wait:               { label: null },
};

const NETWORK_MESSAGE = "We couldn't reach Sit Happens. Check your internet connection and try again.";
const SERVER_MESSAGE = "Something went wrong on our end, so nothing was booked. Please try again in a minute — if it keeps happening, message us.";

/**
 * Read any failed booking request into { message, block }.
 * `block` is null when the server gave no structured reason.
 */
export function bookingFailure(error, fallback = "We couldn't complete that booking.") {
  const res = error?.response;
  if (!res) return { message: NETWORK_MESSAGE, block: { code: "network", action: "retry" } };
  const data = res.data && typeof res.data === "object" ? res.data : {};
  if (res.status >= 500) return { message: SERVER_MESSAGE, block: { code: "server_error", action: "contact_us" } };
  const capacity = data.capacity;
  if (capacity && typeof capacity === "object") {
    return {
      message: capacity.display_message || capacity.message || "That opening is no longer available. Please pick another.",
      block: {
        code: capacity.code,
        action: capacity.action || (capacity.code === "capacity_busy" ? "retry" : "pick_date"),
        waitlist_allowed: !!capacity.waitlist_allowed,
        dog_id: capacity.dog_id,
        dog_name: capacity.dog_name,
      },
    };
  }
  const detail = data.detail;
  const message = typeof detail === "string" && detail.trim() ? detail : fallback;
  return { message, block: data.block && typeof data.block === "object" ? data.block : null };
}

/** A skipped day from /bookings/multi-dates or /bookings/recurring. */
export function skipReason(skip) {
  const r = skip?.reason;
  if (r && typeof r === "object") return r.display_message || r.message || "That day isn't available.";
  return r || "That day isn't available.";
}

/** 'YYYY-MM-DD' -> 'Wed, Oct 7' (local noon avoids the UTC day shift). */
export function shortDate(iso) {
  if (!iso) return "";
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/** Group skipped days by reason so ten identical refusals read as one line. */
export function groupSkips(skipped) {
  const groups = [];
  for (const s of skipped || []) {
    const reason = skipReason(s);
    let g = groups.find(x => x.reason === reason);
    if (!g) { g = { reason, dates: [], block: s.block || null, waitlisted: !!s.waitlisted }; groups.push(g); }
    g.dates.push(s.date);
  }
  return groups;
}
