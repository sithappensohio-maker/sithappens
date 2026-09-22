/* What a client is told about a booking — before, during and after.
 *
 * `books_as` comes from GET /services and is resolved server-side by
 * backend/domains/booking_rules.py, the same function that decides the status
 * the booking row is actually written with. The wizard used to hardcode
 * "Your booking will be reviewed and approved by Sit Happens" for every
 * service, which was wrong for daycare — shipped as instant_book — and left
 * the customer reading "we'll review your request" on one screen and a
 * CONFIRMED badge on the next.
 *
 * After a booking exists, the created row's own status is the authority and
 * the prediction is discarded. Nothing here guesses.
 */

export const CONFIRMED = "approved";
export const REQUESTED = "pending";

/** Prediction for a service the client has selected but not yet booked. */
export function outcomeForService(service) {
  const value = service?.books_as;
  return value === CONFIRMED || value === REQUESTED ? value : null;
}

/** Truth for a booking that now exists. */
export function outcomeForBooking(booking) {
  const status = booking?.status;
  if (status === CONFIRMED) return CONFIRMED;
  if (status === REQUESTED) return REQUESTED;
  return null;
}

/**
 * One sentence for the review screen, before they press Confirm.
 * Returns null when we genuinely don't know, so the caller can say nothing
 * rather than assert something.
 */
export function reviewPromise(outcome) {
  if (outcome === CONFIRMED) return "This time is held for you as soon as you confirm — no waiting for approval.";
  if (outcome === REQUESTED) return "This sends a request. Sit Happens reviews it and you'll see the booking update once it's approved.";
  return null;
}

/** Heading on the success screen. */
export function successHeadline(outcome, { waitlisted } = {}) {
  if (waitlisted) return "Waitlist request submitted";
  if (outcome === CONFIRMED) return "You're booked!";
  return "Request submitted";
}

/** Sub-line on the success screen. */
export function successDetail(outcome, { waitlisted } = {}) {
  if (waitlisted) return "We'll let you know when a spot opens up.";
  if (outcome === CONFIRMED) return "Your spot is confirmed. You'll find it under My Bookings.";
  return "Sit Happens will review your request. You'll see it update under My Bookings.";
}

/** Badge text for a booking row — must match what the success screen said. */
export function bookingBadge(booking) {
  const outcome = outcomeForBooking(booking);
  if (outcome === CONFIRMED) return { label: "Confirmed", tone: "confirmed" };
  if (outcome === REQUESTED) return { label: "Pending approval", tone: "pending" };
  return null;
}
