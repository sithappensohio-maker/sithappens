// Section 5 — shared status/wording definitions. Purely a presentation
// layer: internal backend values are never renamed or migrated here, only
// given a consistent display label/icon/treatment across every admin
// screen that shows them. Each entry: { label, short, icon, cls }
// `cls` is a Tailwind class string for a small pill/badge (color +
// background); never relies on color alone — every status also has a
// distinct label and icon.

export const BOOKING_STATUS = {
  pending: { label: "Pending Approval", short: "Pending", icon: "fa-hourglass-half", cls: "text-amber-300 bg-amber-500/10" },
  approved: { label: "Confirmed", short: "Confirmed", icon: "fa-check", cls: "text-shGreen bg-shGreen/10" },
  rejected: { label: "Declined", short: "Declined", icon: "fa-ban", cls: "text-red-400 bg-red-500/10" },
  completed: { label: "Completed", short: "Completed", icon: "fa-flag-checkered", cls: "text-shBlue bg-shBlue/10" },
  cancelled: { label: "Cancelled", short: "Cancelled", icon: "fa-xmark", cls: "text-gray-400 bg-gray-500/10" },
};

export const INVOICE_STATUS = {
  DRAFT: { label: "Draft", short: "Draft", icon: "fa-file", cls: "text-gray-400 bg-gray-500/10" },
  OPEN: { label: "Unpaid", short: "Unpaid", icon: "fa-file-invoice-dollar", cls: "text-amber-300 bg-amber-500/10" },
  PARTIALLY_PAID: { label: "Partially Paid", short: "Partial", icon: "fa-coins", cls: "text-amber-300 bg-amber-500/10" },
  PAID: { label: "Paid", short: "Paid", icon: "fa-check", cls: "text-shGreen bg-shGreen/10" },
  REFUNDED: { label: "Refunded", short: "Refunded", icon: "fa-rotate-left", cls: "text-purple-300 bg-purple-500/10" },
  PARTIALLY_REFUNDED: { label: "Partially Refunded", short: "Part. Refund", icon: "fa-rotate-left", cls: "text-purple-300 bg-purple-500/10" },
  VOID: { label: "Voided", short: "Voided", icon: "fa-ban", cls: "text-gray-400 bg-gray-500/10" },
};

export const PAYMENT_STATUS = {
  completed: { label: "Completed", short: "Paid", icon: "fa-check", cls: "text-shGreen bg-shGreen/10" },
  refunded: { label: "Refunded", short: "Refunded", icon: "fa-rotate-left", cls: "text-purple-300 bg-purple-500/10" },
  partially_refunded: { label: "Partially Refunded", short: "Part. Refund", icon: "fa-rotate-left", cls: "text-purple-300 bg-purple-500/10" },
  voided: { label: "Voided", short: "Voided", icon: "fa-ban", cls: "text-gray-400 bg-gray-500/10" },
};

export const SHOP_ORDER_STATUS = {
  pending_payment: { label: "Awaiting Payment", short: "Pending", icon: "fa-hourglass-half", cls: "text-amber-300 bg-amber-500/10" },
  paid: { label: "Paid", short: "Paid", icon: "fa-check", cls: "text-shGreen bg-shGreen/10" },
  refunded: { label: "Refunded", short: "Refunded", icon: "fa-rotate-left", cls: "text-purple-300 bg-purple-500/10" },
  cancelled: { label: "Cancelled", short: "Cancelled", icon: "fa-xmark", cls: "text-gray-400 bg-gray-500/10" },
};

export const SHOP_FULFILLMENT_STATUS = {
  pending: { label: "Needs Fulfillment", short: "Pending", icon: "fa-box-open", cls: "text-amber-300 bg-amber-500/10" },
  needs_attention: { label: "Needs Fulfillment", short: "Pending", icon: "fa-box-open", cls: "text-amber-300 bg-amber-500/10" },
  fulfilled: { label: "Fulfilled", short: "Fulfilled", icon: "fa-box", cls: "text-shGreen bg-shGreen/10" },
  picked_up: { label: "Picked Up", short: "Picked Up", icon: "fa-check", cls: "text-shBlue bg-shBlue/10" },
};

export const VACCINE_STATUS = {
  valid: { label: "Valid", short: "Valid", icon: "fa-shield", cls: "text-shGreen bg-shGreen/10" },
  expiring: { label: "Expiring Soon", short: "Expiring", icon: "fa-triangle-exclamation", cls: "text-amber-300 bg-amber-500/10" },
  expired: { label: "Expired", short: "Expired", icon: "fa-shield-halved", cls: "text-red-400 bg-red-500/10" },
  missing: { label: "Missing", short: "Missing", icon: "fa-circle-question", cls: "text-red-400 bg-red-500/10" },
};

export const REGISTER_STATUS = {
  OPEN: { label: "Open", short: "Open", icon: "fa-cash-register", cls: "text-shGreen bg-shGreen/10" },
  CLOSED: { label: "Closed", short: "Closed", icon: "fa-lock", cls: "text-gray-400 bg-gray-500/10" },
};

export const MESSAGE_STATUS = {
  unread: { label: "Unread", short: "Unread", icon: "fa-envelope", cls: "text-shBlue bg-shBlue/10" },
  read: { label: "Read", short: "Read", icon: "fa-envelope-open", cls: "text-gray-400 bg-gray-500/10" },
};

export const CARE_TASK_STATUS = {
  pending: { label: "Not Started", short: "Pending", icon: "fa-circle", cls: "text-gray-400 bg-gray-500/10" },
  done: { label: "Done", short: "Done", icon: "fa-check", cls: "text-shGreen bg-shGreen/10" },
  skipped: { label: "Skipped", short: "Skipped", icon: "fa-forward", cls: "text-amber-300 bg-amber-500/10" },
};

// Step 4C — Ohio sales-tax filing-period statuses (derived server-side by
// sales_tax_tracker.derive_period_state; this map is presentation only).
export const SALES_TAX_FILING_STATUS = {
  open:                 { label: "Accumulating", short: "Open", icon: "fa-hourglass-half", cls: "text-shBlue bg-shBlue/10" },
  ready_to_file:        { label: "Ready to File", short: "Ready", icon: "fa-file-signature", cls: "text-amber-300 bg-amber-500/10" },
  overdue:              { label: "Overdue", short: "Overdue", icon: "fa-triangle-exclamation", cls: "text-red-400 bg-red-500/10" },
  filed_payment_pending:{ label: "Filed — Payment Pending", short: "Filed", icon: "fa-coins", cls: "text-amber-300 bg-amber-500/10" },
  filed_paid:           { label: "Filed & Paid", short: "Paid", icon: "fa-check", cls: "text-shGreen bg-shGreen/10" },
  zero_return_filed:    { label: "Zero Return Filed", short: "$0 Filed", icon: "fa-circle-check", cls: "text-shGreen bg-shGreen/10" },
  historical_untracked: { label: "Historical — Not Tracked", short: "Untracked", icon: "fa-clock-rotate-left", cls: "text-gray-400 bg-gray-500/10" },
};

// Vaccine status is derived (no single stored field) — this helper
// centralizes the derivation so every screen that shows a vaccine badge
// (Dogs, Dog Hub, Care Board, Front Desk) computes it identically.
export function vaccineStatus(dateStr, warningDays = 30) {
  if (!dateStr) return VACCINE_STATUS.missing;
  const today = new Date().toISOString().slice(0, 10);
  const warnDate = new Date();
  warnDate.setDate(warnDate.getDate() + warningDays);
  const warnStr = warnDate.toISOString().slice(0, 10);
  if (dateStr < today) return VACCINE_STATUS.expired;
  if (dateStr < warnStr) return VACCINE_STATUS.expiring;
  return VACCINE_STATUS.valid;
}
