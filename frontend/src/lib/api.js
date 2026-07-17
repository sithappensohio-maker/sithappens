import axios from "axios";

// Sprint 110di-46 — Self-hosting safe BACKEND_URL fallback.
// When REACT_APP_BACKEND_URL is missing/blank (e.g. same-origin Docker
// deploy where the frontend is served from the same host as the API),
// API_BASE becomes "/api" instead of the broken "undefined/api".
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";
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
  // Sprint 110ff — the dedup key used to omit who's asking. On a shared
  // device (a lobby tablet, a family handing off a phone), if person A
  // logs out and person B logs in right away, a request still in flight
  // for A could get handed to B's screen before B's own request even
  // went out. Scoping the key to the current token keeps de-duplication
  // working within one login (the original point of this cache — many
  // sibling components firing the same GET) while making sure a login
  // swap never shares an in-flight response across identities.
  const token = localStorage.getItem("sh_token") || "";
  const params = cfg.params ? JSON.stringify(cfg.params) : "";
  return `${token}::GET ${cfg.baseURL || ""}${cfg.url || ""}?${params}`;
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
//
// Also normalize FastAPI 422 validation errors: by default Pydantic returns
// `detail` as an array of `{type, loc, msg, input, ctx}` objects. Many call
// sites render `e.response.data.detail` directly into JSX which crashes the
// whole app ("Objects are not valid as a React child"). Coerce that array
// to a human-readable string here so every existing catch handler is safe.
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
    const d = err?.response?.data?.detail;
    if (Array.isArray(d)) {
      err.response.data.detail = d.map((e) => {
        if (!e || typeof e !== "object") return String(e);
        const loc = Array.isArray(e.loc) ? e.loc.filter((x) => x !== "body").join(".") : "";
        return loc ? `${loc}: ${e.msg || "invalid"}` : (e.msg || JSON.stringify(e));
      }).join("; ");
    } else if (d && typeof d === "object") {
      // Preserve machine-readable capacity metadata for the booking wizard,
      // while still exposing a plain string to legacy JSX error renderers.
      if (d.code === "capacity_full" || d.code === "capacity_busy") {
        err.response.data.capacity = d;
        err.response.data.detail = d.display_message || d.message || "That opening is no longer available.";
      } else {
        err.response.data.detail = d.msg || JSON.stringify(d);
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
