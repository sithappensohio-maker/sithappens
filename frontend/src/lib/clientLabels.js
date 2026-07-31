/* Centralized client-facing wording — Focused Client Usability phase.
 *
 * These are DISPLAY-ONLY relabels for text a client actually reads. They
 * never rename a database field, an API response key, or any internal
 * status value — only what's rendered. Import these constants everywhere a
 * client-facing screen needs one of these concepts so the same idea never
 * reads differently on two different screens.
 */

export const CLIENT_LABELS = {
  creditPack: "Prepaid visits",
  creditPackSingular: "Prepaid visit",
  credits: "Visits remaining",
  invoice: "Bill",
  balanceDue: "Amount due",
  accountCredit: "Credit on your account",
  approvalRequired: "We'll confirm your request",
  openCapacity: "Spots available",
  fulfilled: "Completed",
};

/* Client-facing booking-status labels. A booking's raw `status` field
 * (pending/approved/rejected/completed/cancelled) is never renamed in the
 * database — this only maps it to plain language wherever a client sees it. */
export const BOOKING_STATUS_LABELS = {
  pending: "We'll confirm your request",
  approved: "Confirmed",
  rejected: "Not able to confirm",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function bookingStatusLabel(status) {
  return BOOKING_STATUS_LABELS[status] || status;
}

/* Waitlist entries are a separate resource from bookings but use the same
 * plain-language family of statuses where relevant. */
export const WAITLIST_STATUS_LABELS = {
  waiting: "On the waitlist",
  offered: "A spot opened up",
  accepted: "Confirmed",
  declined: "Declined",
  expired: "Offer expired",
};

export function waitlistStatusLabel(status) {
  return WAITLIST_STATUS_LABELS[status] || status;
}
