/* "Welcome back" is a claim, and it was being made to accounts that were
 * seconds old.
 *
 * It is derived from state the server already computes — the client's own
 * booking history — rather than a timer or a new persisted "has visited"
 * flag. One question decides it: have they ever booked with us?
 *
 * Booking history rather than "setup complete", for two reasons. It does not
 * flip to "Welcome back" the instant someone finishes onboarding, seconds
 * after signing up. And it does not flip BACK to "Welcome" months later when
 * a long-standing client adds a second dog and momentarily re-opens the setup
 * gate — which the first version of this did, and which the live run caught.
 *
 * The subtitle still reads setup status, because what to say next genuinely
 * does depend on where they are.
 */

/**
 * @param {object|null} setupStatus  GET /portal/setup-status payload
 * @param {Array}       bookings     the client's bookings (any status)
 * @returns {boolean} true when this person has history with us
 */
export function isEstablishedClient(setupStatus, bookings) {
  return Array.isArray(bookings) && bookings.length > 0;
}

/**
 * The greeting line. `name` is already the display name.
 *
 * While setup status is still loading we deliberately fall back to the
 * first-visit wording: greeting a brand-new customer with "Welcome" is
 * harmless, while greeting them with "Welcome back" is the bug.
 */
export function portalGreeting(name, setupStatus, bookings) {
  const first = String(name || "").trim().split(" ")[0] || String(name || "").trim();
  return isEstablishedClient(setupStatus, bookings)
    ? `Welcome back, ${first}!`
    : `Welcome, ${first}!`;
}

/** Sub-line under the greeting — must not mention a pup they haven't added. */
export function portalGreetingSubtitle(setupStatus, bookings, dogs) {
  // Outstanding setup is the most useful thing to say, whoever they are —
  // including a long-standing client who just added a dog.
  if (setupStatus && setupStatus.booking_locked === true) return "Let's finish setting up your account.";
  if (isEstablishedClient(setupStatus, bookings)) return "Here's what's happening with your pup.";
  const hasDogs = Array.isArray(dogs) && dogs.length > 0;
  return hasDogs
    ? "You're all set — book your first visit whenever you're ready."
    : "Add your dog to get started.";
}
