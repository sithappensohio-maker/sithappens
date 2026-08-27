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
      try { clearSharedApiCache({ notify: false }); } catch (e) { /* ignore */ }
      // Avoid the redirect storm if we're already on the auth screen — and
      // never force-navigate a visitor off /shop. A guest on the public
      // storefront has no token at all (a stray 401 there means some code
      // path mistakenly called an authenticated endpoint, not that the
      // visitor needs to be bounced), and an authenticated client whose
      // token just expired mid-browse should fall back to the guest
      // storefront at the SAME URL (ShopRouteGate's own job), never be
      // yanked to the landing page.
      if (
        window.location.pathname !== "/"
        && !window.location.pathname.startsWith("/login")
        && !window.location.pathname.startsWith("/shop")
      ) {
        window.location.replace("/");
      }
    }
    // A 403 here means the backend's must-change-password gate just
    // rejected every endpoint except /auth/me and /auth/change-password.
    // App.js's own gate only re-evaluates from whatever `user` object is
    // already cached in React state, so if this flag flips true mid-session
    // (e.g. an admin forces a password reset while the client's tab is
    // still open), every subsequent request 403s with no way for the SPA
    // to notice — the token itself is still valid, so the 401 handler
    // above never fires. Force ONE reload so the app re-fetches the current
    // user and App.js's existing gate renders ForcedPasswordChange instead
    // of leaving the page stuck making doomed requests. The guard has to
    // survive the reload itself (sessionStorage, not an in-memory flag) —
    // ForcedPasswordChange's own screen still has other always-mounted
    // hooks (polling, etc.) that keep hitting blocked endpoints after
    // landing there, and each one is a fresh 403 that would otherwise
    // re-trigger another reload forever.
    if (
      err?.response?.status === 403
      && typeof err.response.data?.detail === "string"
      && err.response.data.detail.toLowerCase().includes("must be changed")
    ) {
      let alreadyTriggered = true;
      try { alreadyTriggered = sessionStorage.getItem("sh_password_reload_triggered") === "1"; } catch (e) { /* ignore */ }
      if (!alreadyTriggered) {
        try { sessionStorage.setItem("sh_password_reload_triggered", "1"); } catch (e) { /* ignore */ }
        window.location.reload();
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
      // Flattening `detail` to a string is what keeps legacy JSX renderers
      // from crashing on an object — but it also destroys every structured
      // error the backend sends, so a caller that needs to BRANCH on one
      // (an error_code, a list of validation problems, an id to confirm)
      // silently gets a sentence instead and falls through to a generic
      // banner. That is how the curriculum importer's own error list and
      // its archived-course confirmation both ended up unreachable.
      //
      // Keep the original object reachable alongside the flattened string,
      // so nothing existing changes and structured handling becomes possible.
      err.response.data.detail_object = d;
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


// Modernization Phase 3 — shared response cache for the small set of
// application-wide reference resources that used to be fetched independently
// by dozens of mounted screens. This is deliberately NOT a blanket HTTP cache:
// transactional/detail endpoints (ledger, bookings, dog timelines, etc.) keep
// their old always-fetch behavior. Cache keys are token-scoped and include
// query params, so two logins or two filtered variants can never share data.
const SHARED_GET_POLICIES = [
  { resource: "clients", ttl: 20000, paths: ["/clients"] },
  { resource: "dogs", ttl: 20000, paths: ["/dogs"] },
  { resource: "services", ttl: 60000, paths: ["/services"] },
  { resource: "programs", ttl: 60000, paths: ["/programs", "/programs/meta"] },
  { resource: "settings", ttl: 60000, paths: ["/settings", "/settings/public"] },
  {
    resource: "navCounts",
    ttl: 15000,
    paths: [
      "/admin/live-summary",
      // Keep the legacy counters cacheable for screens that still call one
      // directly during the gradual Phase 6 migration.
      "/admin/messages/unread-count",
      "/admin/shop-orders/unseen-count",
      "/admin/school/hq/attention-count",
      "/admin/pending-actions/count",
    ],
  },
];

const _sharedResponseCache = new Map();
const _sharedCacheListeners = new Set();
let _sharedCacheVersion = 0;

const _normalizedPath = (url = "") => {
  try {
    const raw = String(url || "");
    const noQuery = raw.split("?")[0];
    if (/^https?:\/\//i.test(noQuery)) return new URL(noQuery).pathname.replace(/^\/api(?=\/)/, "");
    return noQuery.replace(/^\/api(?=\/)/, "");
  } catch {
    return String(url || "").split("?")[0];
  }
};

const _stableValue = (value) => {
  if (Array.isArray(value)) return value.map(_stableValue);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((out, key) => {
      const v = value[key];
      if (v !== undefined) out[key] = _stableValue(v);
      return out;
    }, {});
  }
  return value;
};

const _sharedPolicyFor = (url) => {
  const path = _normalizedPath(url);
  return SHARED_GET_POLICIES.find((policy) => policy.paths.includes(path)) || null;
};

const _pruneSharedCache = (now = Date.now()) => {
  for (const [key, entry] of _sharedResponseCache.entries()) {
    if (!entry?.promise && entry?.expiresAt <= now) _sharedResponseCache.delete(key);
  }
  // Search/filter variants can create many legitimate keys. Keep the cache
  // bounded anyway; oldest Map entries are least useful once this cap is hit.
  while (_sharedResponseCache.size > 120) {
    const oldest = _sharedResponseCache.keys().next().value;
    if (oldest == null) break;
    _sharedResponseCache.delete(oldest);
  }
};

const _sharedKeyFor = (url, config = {}) => {
  const token = localStorage.getItem("sh_token") || "";
  const params = config?.params ? JSON.stringify(_stableValue(config.params)) : "";
  return `${token}::${String(url || "")}::${params}`;
};

const _emitSharedCache = (event) => {
  _sharedCacheVersion += 1;
  _sharedCacheListeners.forEach((listener) => {
    try { listener({ ...event, version: _sharedCacheVersion }); } catch { /* observer errors never break API calls */ }
  });
};

export function subscribeSharedApiCache(listener) {
  _sharedCacheListeners.add(listener);
  return () => _sharedCacheListeners.delete(listener);
}

export function getSharedApiCacheVersion() {
  return _sharedCacheVersion;
}

export function invalidateSharedApiData(resources) {
  const wanted = new Set(Array.isArray(resources) ? resources : [resources]);
  if (wanted.has("all")) SHARED_GET_POLICIES.forEach((p) => wanted.add(p.resource));
  const removed = new Set();
  for (const [key, entry] of _sharedResponseCache.entries()) {
    if (wanted.has(entry.resource)) {
      _sharedResponseCache.delete(key);
      removed.add(entry.resource);
    }
  }
  // Emit even if the cache is already empty. Hook consumers treat invalidation
  // as the instruction to re-fetch; the mutation may have happened before the
  // resource was cached in this tab.
  if (wanted.size) _emitSharedCache({ type: "invalidate", resources: [...wanted], removed: [...removed] });
}

export function clearSharedApiCache({ notify = true } = {}) {
  _sharedResponseCache.clear();
  if (notify) _emitSharedCache({ type: "clear", resources: SHARED_GET_POLICIES.map((p) => p.resource) });
}

export function sharedApiCacheStats() {
  const now = Date.now();
  const byResource = {};
  for (const entry of _sharedResponseCache.values()) {
    const r = entry.resource || "unknown";
    byResource[r] = (byResource[r] || 0) + (entry.response && entry.expiresAt > now ? 1 : 0);
  }
  return { entries: _sharedResponseCache.size, byResource, version: _sharedCacheVersion };
}

const _rawSharedGet = api.get.bind(api);
api.get = (url, config = {}) => {
  const policy = _sharedPolicyFor(url);
  if (!policy || config?.sharedCache === false) {
    if (!config?.sharedCache) return _rawSharedGet(url, config);
    const clean = { ...config }; delete clean.sharedCache;
    return _rawSharedGet(url, clean);
  }

  const forceRefresh = config?.sharedCache === "refresh";
  const cleanConfig = { ...config };
  delete cleanConfig.sharedCache;
  const key = _sharedKeyFor(url, cleanConfig);
  const now = Date.now();
  _pruneSharedCache(now);
  const existing = _sharedResponseCache.get(key);

  if (!forceRefresh && existing?.response && existing.expiresAt > now) {
    return Promise.resolve(existing.response);
  }
  if (!forceRefresh && existing?.promise) return existing.promise;

  const promise = _rawSharedGet(url, cleanConfig)
    .then((response) => {
      _sharedResponseCache.set(key, {
        resource: policy.resource,
        response,
        promise: null,
        expiresAt: Date.now() + policy.ttl,
      });
      _emitSharedCache({ type: "set", resource: policy.resource, key });
      return response;
    })
    .catch((err) => {
      const current = _sharedResponseCache.get(key);
      if (current?.promise === promise) _sharedResponseCache.delete(key);
      throw err;
    });

  _sharedResponseCache.set(key, {
    resource: policy.resource,
    response: existing?.response || null,
    expiresAt: existing?.expiresAt || 0,
    promise,
  });
  return promise;
};

const _resourcesForMutation = (url) => {
  const path = _normalizedPath(url);
  const resources = new Set();
  if (path === "/clients" || path.startsWith("/clients/") || path.startsWith("/pricing-tiers/") || path.startsWith("/admin/duplicates/clients")) resources.add("clients");
  if (path.startsWith("/pos/")) resources.add("clients");
  if (path === "/dogs" || path.startsWith("/dogs/") || path.startsWith("/portal/dogs") || path.startsWith("/admin/dogs/") || path.startsWith("/admin/duplicates/dogs")) resources.add("dogs");
  if (path === "/services" || path.startsWith("/services/")) resources.add("services");
  if (path === "/programs" || path.startsWith("/programs/")) resources.add("programs");
  if (path === "/settings" || path.startsWith("/settings/")) resources.add("settings");
  if (
    path.startsWith("/admin/messages")
    || path.startsWith("/admin/shop-orders")
    || path.startsWith("/admin/school")
    || path.startsWith("/admin/pending-actions")
    || path.startsWith("/bookings")
  ) resources.add("navCounts");
  return [...resources];
};

// Make invalidation automatic for existing code. Old call sites can continue
// using api.post/put/patch/delete; successful writes immediately evict the
// relevant shared resources. Phase 3 hook consumers then re-fetch through the
// subscription below, while legacy screens that already call their own load()
// simply receive a fresh response instead of a stale cached one.
for (const method of ["post", "put", "patch", "delete"]) {
  const raw = api[method].bind(api);
  api[method] = async (...args) => {
    const response = await raw(...args);
    const resources = _resourcesForMutation(args[0]);
    if (resources.length) invalidateSharedApiData(resources);
    return response;
  };
}

export function formatErr(detail) {
  if (detail == null) return "Something went wrong.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((e) => e?.msg || JSON.stringify(e)).join(" ");
  if (detail?.msg) return detail.msg;
  return String(detail);
}
