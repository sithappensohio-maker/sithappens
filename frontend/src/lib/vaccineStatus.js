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
  // Two shapes, because two endpoints answer differently. GET /dogs sends a
  // photo-free `vaccines_pending_review` map (see backend/domains/vaccines.py);
  // the detail record carries the certificate itself. Either counts.
  const flagged = dog?.vaccines_pending_review;
  const certs = dog?.vaccine_certs;
  const cert = certs && !Array.isArray(certs) ? certs[type] : null;
  const waiting = !!(flagged && flagged[type]) || isCertPending(cert);
  // A renewal under review keeps the approved one on file (audit #40).
  if (expiry && expiry >= today) return waiting ? { state: VACCINE_STATES.APPROVED, expiry, renewal: true } : { state: VACCINE_STATES.APPROVED, expiry };
  if (waiting) return { state: VACCINE_STATES.PENDING, expiry: "" };
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
  const { state, expiry, renewal } = vaccineState(dog, type, todayIso);
  if (state === VACCINE_STATES.APPROVED) return { state, text: `valid until ${humanDate(expiry)}${renewal ? " · renewal under review" : ""}` };
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

/* Staff reviewing an upload (audit #40): a renewal keeps the approved
 * certificate on file until someone approves the new one. */

/** "?uploaded_at=…" — the review acts only on the upload the reviewer saw. */
export function reviewQuery(row) {
  return row?.uploaded_at ? `?uploaded_at=${encodeURIComponent(row.uploaded_at)}` : "";
}

/** The line under an upload in the review list, or "" when nothing is on file. */
export function onFileLine(row) {
  if (!row?.approved_on_file) return "";
  const onFile = row.on_file_expires_on || row.approved_before_expires_on;   // the date booking uses
  const until = onFile ? ` until ${humanDate(onFile)}` : "";
  const earlier = row.expires_on && row.on_file_expires_on && String(row.expires_on).slice(0, 10) < row.on_file_expires_on
    ? " The new date is earlier than the one on file." : "";
  return `Approved certificate on file${until} — rejecting keeps it.${earlier}`;
}

/** What Reject does, said before staff press it. */
export function rejectUploadMessage(row) {
  const dog = row?.dog_name || "The dog";
  if (row?.approved_on_file) {
    const onFile = row.on_file_expires_on || row.approved_before_expires_on;
    const until = onFile ? ` (valid until ${humanDate(onFile)})` : "";
    return `This throws away only this new upload. ${dog}'s approved certificate${until} stays on file, and so does its date.`;
  }
  return `This removes the upload, and the client will need to upload again.`;
}

/** The vaccines a client has sent us that we haven't reviewed yet — a
 * renewal of a current vaccine too (audit #40), so the card says "with us for
 * review" instead of "expiring soon · Renew Now" after they renewed. */
export function withUsForReview(dog, types, todayIso) {
  return (types || []).filter((t) => {
    const st = vaccineState(dog, t, todayIso);
    return st.state === VACCINE_STATES.PENDING || !!st.renewal;
  });
}

/** Current vaccines running out before `soonIso` that the client hasn't
 * already sent us a renewal for — the card's "expiring soon · Renew Now". */
export function expiringNotSent(dog, types, todayIso, soonIso) {
  const sent = withUsForReview(dog, types, todayIso);
  return (types || []).filter((t) => {
    const exp = approvedExpiry(dog, t);
    return exp && exp >= todayIso && exp < soonIso && !sent.includes(t);
  });
}

/** True when every vaccine just uploaded was already current — a renewal, so
 * booking stays open on the approved one while the new one is reviewed. */
export function uploadedRenewalsOnly(dog, types, todayIso) {
  return (types || []).length > 0
    && types.every((t) => vaccineState(dog, t, todayIso).state === VACCINE_STATES.APPROVED);
}
