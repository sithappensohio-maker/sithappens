/* One vocabulary for "where is this vaccine record up to", shared by every
 * client-facing surface.
 *
 * The bug this exists to kill: the dog card read `dog.vaccines[type]` — the
 * map of APPROVED expiry dates — and printed "Missing" when it was empty. A
 * client who had just photographed their rabies certificate and submitted it
 * was told, on the very next screen, that it was missing. The record they
 * uploaded lives in `dog.vaccine_certs[type]` until an admin reviews it, and
 * nothing on the client side ever looked there.
 *
 * The pending test below is deliberately the same shape as the server's in
 * `_compute_setup_status_for_client` (backend/server.py). If the two ever
 * disagree, the client sees one thing and the booking gate enforces another,
 * which is exactly the class of bug this module is closing.
 */

export const VACCINE_STATES = {
  APPROVED: "approved",
  PENDING: "pending_review",
  EXPIRED: "expired",
  MISSING: "missing",
};

/** True when a stored cert is a client upload still awaiting admin review. */
export function isCertPending(cert) {
  if (!cert || typeof cert !== "object") return false;
  if (cert.reviewed_at) return false;
  if (cert.uploaded_by_admin) return false;
  return cert.status === "pending_review" || cert.status === "pending" || !!cert.pending_expires_on;
}

/** Read an approved expiry date out of either historical `vaccines` shape. */
export function approvedExpiry(dog, type) {
  const vacs = dog?.vaccines;
  if (vacs && !Array.isArray(vacs) && typeof vacs === "object") {
    return String(vacs[type] || "").slice(0, 10);
  }
  if (Array.isArray(vacs)) {
    const hit = vacs.find((v) => v && (v.type === type || v.name === type));
    return String(hit?.expires_on || hit?.expiration || "").slice(0, 10);
  }
  return "";
}

/**
 * Resolve one vaccine to exactly one state.
 *
 * Order matters: an approved-and-current record wins over anything sitting in
 * the queue, and a pending upload outranks "missing" so we never tell someone
 * they haven't done the thing they just did.
 */
export function vaccineState(dog, type, todayIso) {
  const today = todayIso || new Date().toISOString().slice(0, 10);
  const expiry = approvedExpiry(dog, type);
  if (expiry && expiry >= today) return { state: VACCINE_STATES.APPROVED, expiry };
  // Two shapes, because two endpoints answer differently. GET /dogs sends a
  // photo-free `vaccines_pending_review` map (see backend/domains/vaccines.py);
  // the detail record carries the certificate itself. Either counts.
  const flagged = dog?.vaccines_pending_review;
  if (flagged && flagged[type]) return { state: VACCINE_STATES.PENDING, expiry: "" };
  const certs = dog?.vaccine_certs;
  const cert = certs && !Array.isArray(certs) ? certs[type] : null;
  if (isCertPending(cert)) return { state: VACCINE_STATES.PENDING, expiry: "" };
  if (expiry) return { state: VACCINE_STATES.EXPIRED, expiry };
  return { state: VACCINE_STATES.MISSING, expiry: "" };
}

const LABELS = {
  [VACCINE_STATES.APPROVED]: "Approved",
  [VACCINE_STATES.PENDING]: "Uploaded — pending review",
  [VACCINE_STATES.EXPIRED]: "Expired — needs update",
  [VACCINE_STATES.MISSING]: "Missing",
};

const TONES = {
  [VACCINE_STATES.APPROVED]: "text-shGreen",
  [VACCINE_STATES.PENDING]: "text-shBlue",
  [VACCINE_STATES.EXPIRED]: "text-red-400",
  [VACCINE_STATES.MISSING]: "text-shOrange",
};

export function vaccineStateLabel(state) { return LABELS[state] || LABELS[VACCINE_STATES.MISSING]; }
export function vaccineStateTone(state) { return TONES[state] || TONES[VACCINE_STATES.MISSING]; }

/**
 * The one-line summary shown on a dog card, e.g.
 *   "Rabies: valid until 30 Jun 2027"
 *   "Rabies: uploaded — pending review"
 * Dates are rendered for humans; the raw ISO string is never shown.
 */
export function vaccineSummary(dog, type, todayIso) {
  const { state, expiry } = vaccineState(dog, type, todayIso);
  if (state === VACCINE_STATES.APPROVED) return { state, text: `valid until ${humanDate(expiry)}` };
  if (state === VACCINE_STATES.EXPIRED) return { state, text: `expired ${humanDate(expiry)}` };
  return { state, text: vaccineStateLabel(state).toLowerCase() };
}

/** "2027-06-30" → "30 Jun 2027". Anything unparseable is passed through. */
export function humanDate(value) {
  const text = String(value || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const d = new Date(`${text}T12:00:00`);
  if (Number.isNaN(d.getTime())) return text;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Whole-dog rollup for the card badge, using the same precedence the client
 * reads top-to-bottom: something expired is louder than something missing,
 * which is louder than something we are still reviewing.
 */
export function dogVaccineRollup(dog, types, todayIso) {
  const list = (types && types.length ? types : ["rabies", "bordetella", "dhpp"]);
  const states = list.map((t) => vaccineState(dog, t, todayIso).state);
  if (states.includes(VACCINE_STATES.EXPIRED)) return VACCINE_STATES.EXPIRED;
  if (states.includes(VACCINE_STATES.MISSING)) return VACCINE_STATES.MISSING;
  if (states.includes(VACCINE_STATES.PENDING)) return VACCINE_STATES.PENDING;
  return VACCINE_STATES.APPROVED;
}
