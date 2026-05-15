import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API_BASE = `${BACKEND_URL}/api`;

export const api = axios.create({ baseURL: API_BASE });

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem("sh_token");
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

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
