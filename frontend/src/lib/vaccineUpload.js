import { api, formatErr } from "./api";

/* Sending one vaccine certificate from the client portal, safely.
 *
 * Clients reported "it said it worked, then it said it didn't, but it did":
 * a phone that loses the reply (screen locks, signal drops, a gateway error)
 * shows a failure for an upload the server already saved. Every upload now
 * carries an id; the server stores an upload once per id and answers a
 * repeat with the stored one. So when the reply is lost we send the same
 * upload again, once: either it arrived (the server says so, nothing is
 * duplicated) or this one delivers it. A manual "Submit again" reuses the
 * same id too, as long as the date and photos haven't changed.
 */

export function newUploadId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** No reply at all, or a gateway page instead of our server's answer. */
export function replyWasLost(error) {
  const status = error?.response?.status;
  return !error?.response || [502, 503, 504, 520, 521, 522, 523, 524].includes(status);
}

const RETRY_DELAY_MS = 1500;

export async function postVaccineUpload(dogId, body, uploadId, { retryDelayMs = RETRY_DELAY_MS } = {}) {
  const url = `/portal/dogs/${dogId}/vaccine-update`;
  const payload = { ...body, upload_id: uploadId };
  try {
    return await api.post(url, payload);
  } catch (error) {
    if (!replyWasLost(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    return await api.post(url, payload);   // same id: the server never stores it twice
  }
}

/** What to tell the client when an upload couldn't be confirmed. */
export function uploadErrorMessage(error) {
  if (replyWasLost(error)) {
    return "We couldn't reach Sit Happens to confirm this upload. Check your connection and tap Submit again. "
      + "If it already arrived, it won't be sent twice.";
  }
  return formatErr(error);
}
