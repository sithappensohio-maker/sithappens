import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API_BASE = `${BACKEND_URL}/api`;

export const api = axios.create({ baseURL: API_BASE });

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem("sh_token");
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

// Sprint 110di-25 — In-flight GET de-duplication.
// When many sibling components mount simultaneously and each fires the
// SAME GET (e.g. 50 dog cards each calling /settings/review-links), they
// now share a single network request instead of stampeding the browser
// socket pool. The cache is keyed by `method + url + params` and clears
// the entry as soon as the response (success OR failure) resolves, so
// later renders still hit the network for fresh data.
const _inflight = new Map();
const _keyFor = (cfg) => {
  if ((cfg.method || "get").toLowerCase() !== "get") return null;
  // Auth header omitted on purpose — keys would needlessly miss otherwise.
  const params = cfg.params ? JSON.stringify(cfg.params) : "";
  return `GET ${cfg.baseURL || ""}${cfg.url || ""}?${params}`;
};
const _origRequest = api.request.bind(api);
api.request = (cfg) => {
  const key = _keyFor(cfg);
  if (!key) return _origRequest(cfg);
  const hit = _inflight.get(key);
  if (hit) return hit;
  const p = _origRequest(cfg).finally(() => { _inflight.delete(key); });
  _inflight.set(key, p);
  return p;
};

// Stale-token auto-clear: any 401 from the backend means the saved JWT
// is invalid (expired, server restart, role change). Drop it and bounce
// to the login screen instead of letting React crash on a half-loaded UI.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err?.response?.status === 401) {
      try { localStorage.removeItem("sh_token"); } catch (e) { /* ignore */ }
      // Avoid the redirect storm if we're already on the auth screen
      if (window.location.pathname !== "/" && !window.location.pathname.startsWith("/login")) {
        window.location.replace("/");
      }
    }
    return Promise.reject(err);
  }
);

export function formatErr(detail) {
  if (detail == null) return "Something went wrong.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((e) => e?.msg || JSON.stringify(e)).join(" ");
  if (detail?.msg) return detail.msg;
  return String(detail);
}
