/* Free Online School course claim — shared client helpers.
 *
 * A deliberately free course does not travel the checkout path. It has no
 * cart line, no $0 total and no order: the client presses START FREE COURSE
 * and the server grants the same canonical Online School enrollment a paid
 * purchase would. The $0 cart guard in checkout is untouched — this is a
 * different door, not a hole in that one.
 *
 * Everything here is PURE presentation logic over what the server already
 * says. `free_claim_available` is computed server-side by the same rule the
 * claim endpoint enforces, so the CTA a visitor sees and the answer they get
 * when they press it can never disagree. Nothing in this file decides
 * eligibility on its own.
 */

/** Is this catalog item a deliberately free, claimable course?
 *
 *  Reads ONLY the server's computed flag. Deliberately does not fall back to
 *  `price === 0`: an imported draft or a not-yet-priced program sits at $0
 *  too, and treating that as free would publish unfinished curricula. */
export function isFreeClaimable(item) {
  return !!(item && item.kind === "training_program" && item.free_claim_available === true);
}

/** What the price area should say. A claimable course reads FREE; a $0
 *  program that is NOT claimable is not "free", it is unpriced, and must not
 *  advertise itself as free. */
export function freePriceLabel(item) {
  return isFreeClaimable(item) ? "FREE" : null;
}

/** The single CTA for a free course, given who is looking and what they own.
 *
 *  `enrollments` is the client's own /portal/school list — the same source
 *  the School dashboard reads — so "already enrolled" is server truth rather
 *  than an optimistic local guess. */
export function freeCourseCta({ item, isGuest, dogs = [], selectedDogId = null, enrollments = null } = {}) {
  if (!isFreeClaimable(item)) return null;
  if (isGuest) return { type: "sign_in", label: "Start Free Course" };

  // Enrollment state wins over everything: never offer to start a course the
  // client is already in.
  const forDog = (dogId) => (enrollments || []).find(
    (e) => e.dog_id === dogId && e.program_id === item.id,
  );
  if (selectedDogId) {
    const existing = forDog(selectedDogId);
    if (existing?.status === "active") return { type: "continue", label: "Continue Free Course" };
    if (existing?.status === "completed") return { type: "completed", label: "View Completed Course" };
    if (existing?.status === "withdrawn") return { type: "blocked", label: "Contact Us to Re-enroll" };
  }

  if (dogs.length === 0) return { type: "add_dog", label: "Add Your Dog to Start" };
  if (!selectedDogId) return { type: "choose_dog", label: "Choose a Dog to Continue" };
  const dog = dogs.find((d) => d.id === selectedDogId);
  return {
    type: "claim",
    // One dog gets a confirmation naming them; a picker has already been used
    // by the time we get here, so the same wording reads correctly either way.
    label: dog?.name ? `Start this course with ${dog.name}` : "Start Free Course",
  };
}

/* ---------------------------------------------------------------- intent --- */

/* A logged-out visitor pressing Start Free Course must come back to the same
   course after signing in, not be dumped in the Shop having lost what they
   were doing. The intent is stored in sessionStorage — deliberately session-
   scoped, never a cookie or a URL parameter carrying account data — and is
   consumed exactly once. */
export const FREE_CLAIM_INTENT_KEY = "sh_free_course_intent";

export function rememberFreeClaimIntent(item) {
  if (!isFreeClaimable(item)) return false;
  try {
    sessionStorage.setItem(FREE_CLAIM_INTENT_KEY, JSON.stringify({
      program_id: item.id, program_name: item.name || "", at: new Date().toISOString(),
    }));
    return true;
  } catch { return false; }
}

/** Read and CLEAR the stored intent. Reading it twice must not re-trigger a
 *  claim, so consumption is part of the read. */
export function consumeFreeClaimIntent() {
  try {
    const raw = sessionStorage.getItem(FREE_CLAIM_INTENT_KEY);
    sessionStorage.removeItem(FREE_CLAIM_INTENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.program_id ? parsed : null;
  } catch { return null; }
}

export function clearFreeClaimIntent() {
  try { sessionStorage.removeItem(FREE_CLAIM_INTENT_KEY); } catch { /* ignore */ }
}

/* The "ready for more?" next step needs NOTHING here. The program-to-program
   recommendation mechanism already exists end to end — a program's own
   recommended_next_program_slugs are resolved server-side into
   home.program.recommended_next_programs and rendered by
   CourseCompletionCard. Adding a second resolver in the client would be a
   parallel path to maintain, and a hardcoded program id in React is exactly
   what that existing mechanism is there to prevent. */
