import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, invalidateSharedApiData, subscribeSharedApiCache } from "./api";

// Modernization Phase 3 — one small data-access vocabulary for reference data.
// Existing screens may still call api.get() directly; the transport cache in
// api.js makes those calls share responses immediately. New/converted screens
// should use these hooks so loading/error/refresh/invalidation behavior is also
// shared instead of being reimplemented in every component.
const RESOURCE_ENDPOINTS = {
  clients: "/clients",
  dogs: "/dogs",
  services: "/services",
  programs: "/programs",
  settings: "/settings",
};

const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((out, key) => {
      if (value[key] !== undefined) out[key] = stable(value[key]);
      return out;
    }, {});
  }
  return value;
};

const stableKey = (value) => JSON.stringify(stable(value || {}));

export async function getSharedData(resource, { params, force = false, url } = {}) {
  const endpoint = url || RESOURCE_ENDPOINTS[resource];
  if (!endpoint) throw new Error(`Unknown shared data resource: ${resource}`);
  const config = {};
  if (params && Object.keys(params).length) config.params = params;
  if (force) config.sharedCache = "refresh";
  const { data } = await api.get(endpoint, config);
  return data;
}

export function refreshSharedData(resource) {
  invalidateSharedApiData(resource);
}

export function useSharedData(resource, {
  enabled = true,
  params = null,
  initialData = null,
  url = null,
} = {}) {
  const paramsKey = useMemo(() => stableKey(params), [params]);
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const load = useCallback(async ({ force = false, quiet = false } = {}) => {
    if (!enabled) return null;
    if (!quiet) setLoading(true);
    try {
      const next = await getSharedData(resource, { params: paramsRef.current, force, url });
      if (mountedRef.current) {
        setData(next);
        setError(null);
      }
      return next;
    } catch (err) {
      if (mountedRef.current) setError(err);
      return null;
    } finally {
      if (mountedRef.current && !quiet) setLoading(false);
    }
  }, [enabled, resource, url, paramsKey]); // paramsKey intentionally captures semantic param changes

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return undefined;
    }
    load();
    return subscribeSharedApiCache((event) => {
      if (event?.type !== "invalidate" && event?.type !== "clear") return;
      if (!event.resources?.includes(resource) && !event.resources?.includes("all")) return;
      // Every subscriber may ask to reload, but api.js coalesces the request,
      // so mounted consumers update together from one network response.
      load({ quiet: true });
    });
  }, [enabled, resource, load]);

  const refresh = useCallback(() => {
    invalidateSharedApiData(resource);
  }, [resource]);

  return { data, loading, error, refresh, reload: load };
}

export const useClientsData = (options = {}) => useSharedData("clients", { initialData: [], ...options });
export const useDogsData = (options = {}) => useSharedData("dogs", { initialData: [], ...options });
export const useServicesData = (options = {}) => useSharedData("services", { initialData: [], ...options });
export const useProgramsData = (options = {}) => useSharedData("programs", { initialData: [], ...options });
export const useSettingsData = (options = {}) => useSharedData("settings", { initialData: {}, ...options });

const EMPTY_COUNTS = {
  messagesUnread: 0,
  shopOrdersUnseen: 0,
  schoolAttention: 0,
  pendingActions: 0,
};

// The shell previously owned four separate polling effects, each duplicated
// the same lifecycle/error/event logic and re-ran whenever the active tab
// changed. Keep the backend endpoints unchanged for Phase 3, but centralize
// their frontend ownership now. Phase 6 can replace these four requests with
// one /admin/live-summary endpoint without touching App.js again.
export function useAdminNavCounts(access = {}) {
  const allowMessages = !!access.messages;
  const allowShopOrders = !!access.shopOrders;
  const allowSchool = !!access.school;
  const allowPending = !!access.pendingActions;
  const [counts, setCounts] = useState(EMPTY_COUNTS);
  const mountedRef = useRef(true);
  const loadingRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const load = useCallback(async ({ force = false } = {}) => {
    // Coalesce concurrent event-driven refreshes at the hook level too.
    if (loadingRef.current && !force) return loadingRef.current;
    const cfg = force ? { sharedCache: "refresh" } : undefined;
    // Phase 6 — one shell poll replaces four separate HTTP requests. The
    // backend still applies each counter's real permission gate and returns
    // zero for counters this role cannot see.
    const job = api.get("/admin/live-summary", cfg).catch(() => ({ data: {} })).then((summary) => {
      const payload = summary?.data || {};
      const next = {
        messagesUnread: allowMessages ? (payload.messages?.unread || 0) : 0,
        shopOrdersUnseen: allowShopOrders ? (payload.shop_orders?.unseen || 0) : 0,
        schoolAttention: allowSchool ? (payload.school?.count || 0) : 0,
        pendingActions: allowPending ? (payload.pending_actions?.total || 0) : 0,
      };
      if (mountedRef.current) setCounts(next);
      return next;
    }).finally(() => {
      if (loadingRef.current === job) loadingRef.current = null;
    });
    loadingRef.current = job;
    return job;
  }, [allowMessages, allowShopOrders, allowSchool, allowPending]);

  useEffect(() => {
    load();
    const timer = setInterval(() => load(), 60000);
    const refresh = () => load();
    const events = [
      "sh:shop-orders-seen",
      "sh:school-attention-changed",
      "sh:pending-actions-changed",
      "sh:messages-changed",
    ];
    events.forEach((name) => window.addEventListener(name, refresh));
    const unsubscribe = subscribeSharedApiCache((event) => {
      if ((event?.type === "invalidate" || event?.type === "clear") && event.resources?.includes("navCounts")) load();
    });
    return () => {
      clearInterval(timer);
      events.forEach((name) => window.removeEventListener(name, refresh));
      unsubscribe();
    };
  }, [load]);

  return { ...counts, refresh: load };
}
