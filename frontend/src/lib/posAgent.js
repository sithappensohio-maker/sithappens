/* Front-desk POS hardware integration — talks ONLY to the local POS agent
 * running on 127.0.0.1 on the front-desk Linux Mint laptop. This module
 * never contacts the Sit Happens backend directly for hardware actions —
 * it only ever relays an opaque, server-issued, short-lived, single-use
 * token to the local agent. The agent is the only thing that talks to the
 * physical printer/drawer, and it independently verifies every token with
 * the Sit Happens backend before doing anything.
 *
 * IMPORTANT: every function here is designed to NEVER throw in a way that
 * could be mistaken for a financial failure. Hardware actions always run
 * strictly AFTER a payment/checkout has already committed successfully —
 * a hardware failure here must never be interpreted as "the payment failed"
 * by any caller. Every function returns a plain {ok, error} result instead
 * of throwing, so a caller can surface a hardware-only status message.
 */

const POS_AGENT_BASE = process.env.REACT_APP_POS_AGENT_URL || "http://127.0.0.1:8765";
const TIMEOUT_MS = 8000;

async function _call(path, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${POS_AGENT_BASE}${path}`, { ...options, signal: controller.signal });
    clearTimeout(timer);
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON or empty body */ }
    if (!res.ok) {
      return { ok: false, error: (data && (data.error || data.detail)) || `POS agent returned ${res.status}` };
    }
    // The agent always responds HTTP 200, even for an application-level
    // failure (token rejected, printer offline, write failed) — the real
    // outcome lives in the JSON body's "ok" field, never the HTTP status
    // alone. /health has no "ok" field, so it falls through unaffected.
    if (data && data.ok === false) {
      return { ok: false, error: data.error || "POS agent reported failure" };
    }
    return { ok: true, data };
  } catch (e) {
    clearTimeout(timer);
    if (e.name === "AbortError") {
      return { ok: false, error: "POS agent did not respond (timed out) — is the front-desk printer service running?" };
    }
    return { ok: false, error: "Could not reach the local POS agent — is the front-desk printer service running?" };
  }
}

/** GET /health — used for the small "Printer: Ready / Offline" indicator.
 * Never blocks or gates any normal app functionality. */
export async function checkPosHealth() {
  const result = await _call("/health", { method: "GET" });
  if (!result.ok) return { ready: false, error: result.error };
  return { ready: (result.data && result.data.printer === "ready") || false, error: null };
}

/** POST /print-receipt — relays a server-issued print_receipt token. The
 * agent fetches the actual canonical receipt content from the Sit Happens
 * backend using this token; the browser never supplies receipt content. */
export async function printReceipt(token) {
  if (!token) return { ok: false, error: "No print token available" };
  return _call("/print-receipt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
}

/** POST /open-drawer — relays a server-issued open_drawer token (either the
 * automatic post-cash-payment token, or a manually-issued admin token). */
export async function openDrawer(token) {
  if (!token) return { ok: false, error: "No drawer token available" };
  return _call("/open-drawer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
}
