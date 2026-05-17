/**
 * Impersonation helpers — let an admin "View as Client" via a short-lived
 * client-scoped JWT minted by /api/admin/clients/{id}/impersonation-token.
 *
 * Mechanism:
 *  1. Save the current admin JWT under `sh_admin_token`
 *  2. Replace `sh_token` with the impersonation JWT
 *  3. Reload — the app boots as the client (Portal screen)
 *  4. A persistent yellow banner appears at the top with "Return to Admin"
 *  5. Clicking it restores the admin token, clears the impersonation token,
 *     and reloads — the admin is back where they started.
 */
import { api } from "./api";

const ADMIN_TOKEN_KEY = "sh_admin_token";
const TOKEN_KEY = "sh_token";
const IMP_META_KEY = "sh_imp_meta"; // { client_name, started_at }

export async function startImpersonation(clientId) {
  const { data } = await api.post(`/admin/clients/${clientId}/impersonation-token`);
  const currentToken = localStorage.getItem(TOKEN_KEY);
  if (!currentToken) throw new Error("Admin token missing");
  localStorage.setItem(ADMIN_TOKEN_KEY, currentToken);
  localStorage.setItem(TOKEN_KEY, data.token);
  localStorage.setItem(IMP_META_KEY, JSON.stringify({
    client_name: data.client_name,
    client_id: data.client_id,
    started_at: Date.now(),
    expires_in_minutes: data.expires_in_minutes,
  }));
  // Hard reload so every component refetches data with the new token.
  window.location.assign("/");
}

export function endImpersonation() {
  const admin = localStorage.getItem(ADMIN_TOKEN_KEY);
  if (admin) localStorage.setItem(TOKEN_KEY, admin);
  else localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(ADMIN_TOKEN_KEY);
  localStorage.removeItem(IMP_META_KEY);
  window.location.assign("/");
}

export function getImpersonationMeta() {
  try {
    const raw = localStorage.getItem(IMP_META_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function isImpersonating() {
  return !!localStorage.getItem(ADMIN_TOKEN_KEY) && !!localStorage.getItem(IMP_META_KEY);
}
